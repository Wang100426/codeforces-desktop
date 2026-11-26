'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const auth = require('./auth.cjs');

// 固定用户数据目录：productName 变化也不再重置 handle / 关注列表 / API key
app.setPath('userData', path.join(app.getPath('appData'), 'CF Desktop'));

const API_ROOT = 'https://codeforces.com/api/';
const MIN_INTERVAL_MS = 2100; // 官方限制：每 2 秒最多一次请求

const TTL = [
  ['contest.list', 5 * 60 * 1000],
  ['problemset.problems', 6 * 60 * 60 * 1000],
  ['user.info', 10 * 60 * 1000],
  ['user.rating', 60 * 60 * 1000],
  ['user.status', 3 * 60 * 1000],
  ['user.ratedList', 60 * 60 * 1000]
];

const cache = new Map();
let queueTail = Promise.resolve();
let lastRequestAt = 0;

function ttlFor(method) {
  return TTL.find(([prefix]) => method.startsWith(prefix))?.[1] ?? 5 * 60 * 1000;
}

function cacheKey(method, params) {
  const sorted = Object.keys(params || {})
    .sort()
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  return `${method}?${sorted}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 全局串行队列：不管渲染层同时发多少请求，主进程永远按 2.1s 间隔发出
function enqueue(task) {
  const run = queueTail.then(async () => {
    const gap = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (gap > 0) await sleep(gap);
    lastRequestAt = Date.now();
    return task();
  });
  queueTail = run.catch(() => undefined);
  return run;
}

async function callCodeforces(method, params = {}) {
  if (typeof method !== 'string' || !/^[a-zA-Z]+\.[a-zA-Z.]+$/.test(method)) {
    throw new Error('非法 API 方法名');
  }
  const url = new URL(API_ROOT + method);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  // 签名在实际发出请求前生成，避免队列等待导致 time 与服务器差太大
  const creds = auth.load();
  if (creds.apiKey && creds.apiSecret) {
    const time = Math.floor(Date.now() / 1000);
    const rand = auth.randomRand();
    url.searchParams.set('apiKey', creds.apiKey);
    url.searchParams.set('time', String(time));
    url.searchParams.set('apiSig', auth.sign(method, params, creds.apiKey, creds.apiSecret, rand, time));
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'CF Desktop / Electron Client',
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!text.trimStart().startsWith('{')) {
    throw new Error(`HTTP ${response.status}：Codeforces 返回的不是 JSON，可能正在维护或触发了风控`);
  }
  const payload = JSON.parse(text);
  if (payload.status !== 'OK') {
    // 认证失败时 CF 会回 400 + JSON comment，必须解析出来，不能只报 HTTP 状态码
    throw new Error(payload.comment || `Codeforces API 请求失败（HTTP ${response.status}）`);
  }
  return payload.result;
}

async function apiCall(method, params, force) {
  const key = cacheKey(method, params);
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < ttlFor(method)) {
    return { data: hit.data, cached: true, fetchedAt: hit.at };
  }
  const data = await enqueue(() => callCodeforces(method, params));
  const now = Date.now();
  cache.set(key, { data, at: now });
  return { data, cached: false, fetchedAt: now };
}

// 从改名前（cf-pulse）的 userData 一次性迁移本地设置，避免 handle 被重置为 tourist
function migrateLegacyStorage() {
  const legacy = path.join(app.getPath('appData'), 'cf-pulse');
  const legacyLS = path.join(legacy, 'Local Storage');
  const newLS = path.join(app.getPath('userData'), 'Local Storage');
  if (path.resolve(legacy) === path.resolve(app.getPath('userData'))) return;
  if (!fs.existsSync(legacyLS)) return;
  try {
    const logs = fs.readdirSync(path.join(newLS, 'leveldb')).filter((f) => f.endsWith('.log'));
    if (logs.some((f) => fs.readFileSync(path.join(newLS, 'leveldb', f), 'utf8').includes('cf.handle'))) return;
    fs.rmSync(newLS, { recursive: true, force: true });
    fs.cpSync(legacyLS, newLS, { recursive: true });
    console.log('[CF Desktop] 已从 cf-pulse 迁移本地设置');
  } catch (error) {
    console.warn('[CF Desktop] 迁移本地设置失败：', error?.message);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1060,
    minHeight: 660,
    frame: false,
    backgroundColor: '#0b0f16',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('cf:call', async (_event, { method, params = {}, force = false }) => {
  try {
    return { ok: true, ...(await apiCall(method, params, force)) };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('auth:status', () => auth.status());

ipcMain.handle('auth:save', (_event, credentials) => {
  const saved = auth.save(credentials);
  cache.clear(); // 换凭证后必须丢弃匿名缓存，否则界面拿到的还是旧数据
  if (!saved.apiKey || !saved.apiSecret) throw new Error('Key 和 Secret 都不能为空');
  return auth.status();
});

ipcMain.handle('auth:clear', () => {
  auth.clear();
  cache.clear();
  return auth.status();
});

ipcMain.handle('app:openExternal', async (_event, url) => {
  if (typeof url !== 'string' || !/^https:\/\/(codeforces\.com|www\.codeforces\.com)\//.test(url)) {
    return { ok: false, error: '仅允许打开 Codeforces 链接' };
  }
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.on('window:control', (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});

app.whenReady().then(() => {
  migrateLegacyStorage();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
