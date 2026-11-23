import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const TOKEN = (process.env.HF_TOKEN || '').trim();
const REPO = (process.env.HF_BACKUP_REPO || '').trim();
export const hfBackupEnabled = Boolean(TOKEN && REPO);

const BASE = 'https://huggingface.co';
const auth = () => ({ Authorization: `Bearer ${TOKEN}` });

function localFiles() {
  const files = [];
  const dbFile = path.join(DATA_DIR, 'app.db');
  if (fs.existsSync(dbFile)) files.push({ abs: dbFile, rel: 'data/app.db' });

  const waDir = path.join(DATA_DIR, 'wa_auth');
  if (fs.existsSync(waDir)) {
    for (const name of fs.readdirSync(waDir)) {
      if (!name.endsWith('.json')) continue;
      const abs = path.join(waDir, name);
      try {
        if (fs.statSync(abs).isFile()) files.push({ abs, rel: `data/wa_auth/${name}` });
      } catch {
        // ملف اختفى أثناء القراءة — تجاهل
      }
    }
  }
  return files;
}

async function ensureRepo() {
  const res = await fetch(`${BASE}/api/repos/create`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'dataset', name: REPO.split('/').pop(), private: true }),
  });
  if (res.ok || res.status === 409) return;
  const text = await res.text().catch(() => '');
  if (/exist/i.test(text)) return;
  throw new Error(`إنشاء مستودع النسخ فشل (${res.status})`);
}

export async function restoreFromHub() {
  if (!hfBackupEnabled) return 0;
  if (fs.existsSync(path.join(DATA_DIR, 'app.db'))) return 0;

  const tree = await fetch(`${BASE}/api/datasets/${REPO}/tree/main?recursive=true`, {
    headers: auth(),
  });
  if (!tree.ok) return 0;

  const entries = (await tree.json()).filter((e) => e.type === 'file' && e.path.startsWith('data/'));
  let restored = 0;

  for (let i = 0; i < entries.length; i += 6) {
    await Promise.all(
      entries.slice(i, i + 6).map(async (entry) => {
        const r = await fetch(`${BASE}/datasets/${REPO}/resolve/main/${entry.path}`, { headers: auth() });
        if (!r.ok) return;
        const dest = path.join(DATA_DIR, ...entry.path.split('/').slice(1));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
        restored += 1;
      })
    );
  }

  if (restored) console.log(`HF: تم استرجاع ${restored} ملف من النسخة الاحتياطية`);
  return restored;
}

const uploadedMtimes = new Map();
let busy = false;
let ready = false;

export async function backupNow({ force = false } = {}) {
  if (!hfBackupEnabled || busy) return;

  const { db } = await import('./db.js');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

  const files = localFiles();
  const changed = files.filter((f) => {
    try {
      return force || uploadedMtimes.get(f.rel) !== fs.statSync(f.abs).mtimeMs;
    } catch {
      return false;
    }
  });
  if (!changed.length) return;

  busy = true;
  try {
    if (!ready) {
      await ensureRepo();
      ready = true;
    }

    const lines = [
      JSON.stringify({ key: 'header', value: { summary: 'نسخة احتياطية تلقائية', description: '' } }),
    ];
    for (const f of changed) {
      lines.push(
        JSON.stringify({
          key: 'file',
          value: { path: f.rel, encoding: 'base64', content: fs.readFileSync(f.abs).toString('base64') },
        })
      );
    }

    const res = await fetch(`${BASE}/api/datasets/${REPO}/commit/main`, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/x-ndjson' },
      body: lines.join('\n'),
    });
    if (!res.ok) throw new Error(`رفع النسخة فشل (${res.status})`);

    for (const f of changed) {
      try {
        uploadedMtimes.set(f.rel, fs.statSync(f.abs).mtimeMs);
      } catch {
        // تجاهل
      }
    }
    console.log(`HF: نسخة احتياطية (${changed.length} ملف)`);
  } finally {
    busy = false;
  }
}

export function startHfBackup() {
  if (!hfBackupEnabled) return;

  const loop = () => backupNow().catch((err) => console.error('HF backup:', err.message));
  setTimeout(loop, 15 * 1000);
  setInterval(loop, 3 * 60 * 1000);

  const flush = () => {
    backupNow({ force: false })
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', flush);
  process.on('SIGINT', flush);
}
