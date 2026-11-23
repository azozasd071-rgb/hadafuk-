import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from 'baileys';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { WA_AUTH_DIR } from './config.js';
import * as store from './db.js';

const logger = pino({ level: 'silent' });

let sock = null;
let starting = false;
let manualClose = false;
let groups = [];
let queue = Promise.resolve();

const state = {
  status: 'disconnected',
  qr: null,
  number: null,
  error: '',
  since: null,
};

export function waStatus() {
  return {
    status: state.status,
    qr: state.qr,
    number: state.number,
    error: state.error,
    groups: groups.length,
    since: state.since,
  };
}

export function autoConnectWhatsApp() {
  if (fs.existsSync(path.join(WA_AUTH_DIR, 'creds.json'))) {
    connectWhatsApp().catch(() => {});
  }
}

export async function connectWhatsApp() {
  if (sock || starting) return;
  starting = true;
  manualClose = false;
  state.status = 'connecting';
  state.error = '';

  try {
    const { state: authState, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const s = makeWASocket({
      version,
      auth: authState,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });

    sock = s;
    s.ev.on('creds.update', saveCreds);

    s.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        state.status = 'qr';
        state.qr = await QRCode.toDataURL(qr, { margin: 1, width: 340 }).catch(() => null);
      }

      if (connection === 'open') {
        state.status = 'connected';
        state.qr = null;
        state.error = '';
        state.since = Date.now();
        const id = s.user?.id || '';
        state.number = id.split(':')[0].split('@')[0] || null;
        console.log('WhatsApp: متصل');
        refreshGroups().catch(() => {});
      }

      if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        sock = null;
        state.qr = null;

        if (manualClose) {
          state.status = 'disconnected';
          return;
        }

        if (code === DisconnectReason.loggedOut) {
          state.status = 'logged_out';
          state.number = null;
          state.error = 'تم تسجيل الخروج من واتساب — امسح رمز QR من جديد.';
          try {
            fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
          } catch {
            // تجاهل
          }
        } else {
          state.status = 'reconnecting';
          state.error = 'انقطع الاتصال — جارٍ إعادة المحاولة تلقائياً...';
          setTimeout(() => {
            if (!manualClose) connectWhatsApp().catch(() => {});
          }, 3000);
        }
      }
    });
  } catch (err) {
    state.status = 'disconnected';
    state.error = err.message || String(err);
    sock = null;
  } finally {
    starting = false;
  }
}

export async function refreshGroups() {
  if (!sock || state.status !== 'connected') return groups;
  try {
    const obj = await sock.groupFetchAllParticipating();
    groups = Object.values(obj)
      .filter((g) => String(g.id).endsWith('@g.us'))
      .map((g) => ({ jid: g.id, name: g.subject || g.id }));
    store.upsertWaGroups(groups);
  } catch (err) {
    console.error('WhatsApp groups:', err.message);
  }
  return groups;
}

export async function logoutWhatsApp() {
  manualClose = true;
  const old = sock;
  sock = null;
  groups = [];
  state.qr = null;
  state.number = null;
  state.since = null;
  try {
    await old?.logout();
  } catch {
    // تجاهل
  }
  try {
    fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
  } catch {
    // تجاهل
  }
  state.status = 'disconnected';
  state.error = '';
}

export function startBroadcast(deliveries, text) {
  queue = queue.then(async () => {
    for (const d of deliveries) {
      if (!sock || state.status !== 'connected') {
        store.updateDelivery(d.id, 'failed', 'واتساب غير متصل');
        continue;
      }
      try {
        await sock.sendMessage(d.jid, { text });
        store.updateDelivery(d.id, 'sent');
        console.log(`WhatsApp: أُرسل إلى ${d.name || d.jid}`);
      } catch (err) {
        store.updateDelivery(d.id, 'failed', err.message || 'فشل الإرسال');
      }
      // فاصل 4-9 ثواني لتقليل خطر الحظر
      await new Promise((r) => setTimeout(r, 4000 + Math.floor(Math.random() * 5000)));
    }
  });
  return queue;
}
