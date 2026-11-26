'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

let configPath = null;
let cached = null;

function filePath() {
  if (!configPath) configPath = path.join(app.getPath('userData'), 'auth.json');
  return configPath;
}

function load() {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    cached = { apiKey: String(raw.apiKey || '').trim(), apiSecret: String(raw.apiSecret || '').trim() };
  } catch {
    cached = { apiKey: '', apiSecret: '' };
  }
  return cached;
}

function save(credentials) {
  cached = {
    apiKey: String(credentials?.apiKey || '').trim(),
    apiSecret: String(credentials?.apiSecret || '').trim()
  };
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(cached, null, 2), { mode: 0o600 });
  return cached;
}

function clear() {
  cached = { apiKey: '', apiSecret: '' };
  try { fs.unlinkSync(filePath()); } catch { /* 文件本来就不存在 */ }
  return cached;
}

function status() {
  const creds = load();
  const configured = Boolean(creds.apiKey && creds.apiSecret);
  return {
    configured,
    apiKey: configured ? `${creds.apiKey.slice(0, 4)}…${creds.apiKey.slice(-4)}` : '',
    path: filePath()
  };
}

function randomRand() {
  return crypto.randomBytes(3).toString('hex'); // 官方文档要求前 6 位随机
}

// 参数按 key 再 value 字典序排序；签名串里用原始值，URL 里由 URLSearchParams 负责编码
function sign(method, params, apiKey, apiSecret, rand, time) {
  const all = { ...(params || {}), apiKey, time: String(time) };
  const entries = Object.entries(all)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => [key, String(value)]);
  entries.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] === b[1] ? 0 : (a[1] < b[1] ? -1 : 1);
  });
  const query = entries.map(([key, value]) => `${key}=${value}`).join('&');
  const base = `${rand}/${method}?${query}#${apiSecret}`;
  return rand + crypto.createHash('sha512').update(base, 'utf8').digest('hex');
}

module.exports = { load, save, clear, status, randomRand, sign };
