import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { ADMIN_PASSWORD, ADMIN_USER } from './config.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === calc.length && crypto.timingSafeEqual(known, calc);
}

function sameText(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function ensureAdmin() {
  const user = getSetting('admin_user');
  if (!getSetting('admin_hash') || user !== ADMIN_USER) {
    setSetting('admin_user', ADMIN_USER);
    setSetting('admin_hash', hashPassword(ADMIN_PASSWORD));
  }
}

export function checkAdminPassword(password) {
  const stored = getSetting('admin_hash');
  return stored ? verifyPassword(password, stored) : false;
}

export function checkCredentials(username, password) {
  const storedUser = getSetting('admin_user');
  const storedHash = getSetting('admin_hash');
  if (!storedUser || !storedHash) return false;
  const userOk = sameText(username, storedUser);
  const passOk = verifyPassword(password, storedHash);
  return userOk && passOk;
}

export function setAdminPassword(password) {
  setSetting('admin_hash', hashPassword(password));
}

export function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/login');
}

const attempts = new Map();

export function tooManyAttempts(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  return recent.length >= 15;
}

export function recordAttempt(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  attempts.set(ip, recent);
}
