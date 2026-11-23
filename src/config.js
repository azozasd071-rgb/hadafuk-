import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .env غير موجود — نستخدم القيم الافتراضية
}

export const PORT = Number(process.env.PORT || 3000);
export const ADMIN_USER = (process.env.ADMIN_USER || 'admin').trim();
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';
export const SESSION_SECRET = process.env.SESSION_SECRET || 'dr-quiz-hub-secret';
export const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
export const WA_AUTH_DIR = path.join(DATA_DIR, 'wa_auth');
