// Shared server-side helpers. Files starting with "_" are NOT public endpoints.
const crypto = require('crypto');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function configured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

// Secret used to scramble IC digits and sign tokens. Derived from the server key,
// so there is one less setting to configure. It never leaves the server.
function secret(label) {
  return crypto.createHash('sha256').update(`fm1|${label}|${SERVICE_KEY}`).digest();
}

function hmac(label, value) {
  return crypto.createHmac('sha256', secret(label)).update(String(value)).digest('hex');
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// The stored value for a team's IC last-4. Different for every team even if digits match.
function codeHash(team, code) {
  return hmac('code', `${team}:${code}`);
}

// Short-lived proof that a leader passed verification (15 minutes).
function makeToken(team) {
  const exp = Date.now() + 15 * 60 * 1000;
  return `${team}.${exp}.${hmac('token', `${team}.${exp}`)}`;
}

function readToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const team = Number(parts[0]);
  const exp = Number(parts[1]);
  if (!Number.isInteger(team) || team < 1 || team > 24) return null;
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  if (!safeEqual(parts[2], hmac('token', `${team}.${exp}`))) return null;
  return team;
}

function clientIp(req) {
  const raw = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'unknown');
  const ip = raw.split(',')[0].trim();
  return hmac('ip', ip).slice(0, 24); // store a scrambled address, not the real one
}

async function rpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args || {}),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`rpc ${fn} failed: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function send(res, body, code) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(code || 200).json(body);
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

module.exports = {
  ADMIN_PASSWORD, configured, safeEqual, codeHash, makeToken, readToken, clientIp, rpc, send, body,
};
