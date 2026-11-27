'use strict';

const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
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
const statementCache = new Map();
const STATEMENT_TTL = 24 * 60 * 60 * 1000;
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

// 题面获取：优先直连 Codeforces 官网解析 HTML（国内可达，无需第三方），
// Jina Reader 降级为备用（境外网络 / 直连被 Cloudflare 拦时使用）
function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function htmlToText(html) {
  return decodeEntities(html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<img[^>]*>/gi, '[图]')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim());
}

function parseStatementHtml(html, fallbackCode) {
  const root = html.match(/<div class="problem-statement"[^>]*>([\s\S]*)/i);
  if (!root) return null;
  let body = root[1];
  const tailMarkers = ['<div class="sidebar', '<div id="footer', '<div class="roundbox'];
  for (const m of tailMarkers) {
    const at = body.indexOf(m);
    if (at > 0) body = body.slice(0, at);
  }
  const SECTION_CLASSES = ['input-specification', 'output-specification', 'note', 'sample-tests'];
  // 按节切分：每节从自己的 class 起点到下一节起点，避免嵌套 div 截断
  const marks = SECTION_CLASSES
    .map((cls) => ({ cls, at: body.indexOf(`<div class="${cls}`) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  const sectionText = (cls) => {
    const i = marks.findIndex((m) => m.cls === cls);
    if (i < 0) return '';
    const start = marks[i].at + `<div class="${cls}">`.length;
    const end = i + 1 < marks.length ? marks[i + 1].at : body.length;
    return htmlToText(body.slice(start, end));
  };
  // header 以连续两个 </div> 收尾；题干在 header 之后的无名 <div> 里
  const headerMatch = body.match(/<div class="header">([\s\S]*?<\/div>\s*<\/div>)/i);
  const headerHtml = headerMatch ? headerMatch[1] : '';
  const headerEnd = headerMatch ? headerMatch.index + headerMatch[0].length : 0;
  const firstSection = marks.length ? marks[0].at : body.length;
  const legend = headerMatch ? htmlToText(body.slice(headerEnd, firstSection)) : '';
  const title = (headerHtml.match(/<div class="title"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || fallbackCode).trim();
  const timeLimit = (headerHtml.match(/<div class="time-limit">([\s\S]*?)<\/div>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/time limit per test/gi, '').trim();
  const memLimit = (headerHtml.match(/<div class="memory-limit">([\s\S]*?)<\/div>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/memory limit per test/gi, '').trim();
  const io = ['input', 'output'].map((k) => (headerHtml.match(new RegExp(`<div class="${k}-file">([\\s\\S]*?)</div>`, 'i'))?.[1] || '').replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  const limits = [timeLimit, memLimit].filter(Boolean).join(' · ') + (io.length ? ` · ${io.join(' / ')}` : '');
  const inputSpec = sectionText('input-specification').replace(/^Input\s*/i, '');
  const outputSpec = sectionText('output-specification').replace(/^Output\s*/i, '');
  const note = sectionText('note').replace(/^Note\s*/i, '');
  const samples = [...body.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)]
    .map((m) => htmlToText(m[1]).replace(/^Copy\s*/i, ''))
    .filter((t) => t.length);
  const parts = [`# ${decodeEntities(title).replace(/^\w+\.\s*/, '')}`, limits ? `_${limits}_` : '', legend];
  if (inputSpec) parts.push('## Input', inputSpec);
  if (outputSpec) parts.push('## Output', outputSpec);
  if (samples.length) {
    parts.push('## Example');
    samples.forEach((s, i) => {
      parts.push(i % 2 === 0 ? '**输入**' : '**输出**');
      parts.push('```\n' + s + '\n```');
    });
  }
  if (note) parts.push('## Note', note);
  const content = parts.filter(Boolean).join('\n\n');
  return content.length > 200 ? content : null;
}

let statementWin = null;
// 隐藏窗口真实加载 CF 页面：真 Chromium 能自动过 Cloudflare JS 挑战，主进程任何 fetch 都过不了
async function fetchStatementDirect(contestId, index) {
  const url = `https://codeforces.com/problemset/problem/${encodeURIComponent(contestId)}/${encodeURIComponent(index)}`;
  if (!statementWin || statementWin.isDestroyed()) {
    statementWin = new BrowserWindow({
      show: false, width: 1100, height: 800, webPreferences: {
        offscreen: true, backgroundThrottling: false,
        partition: 'statement-fetch'
      }
    });
    statementWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }
  const wc = statementWin.webContents;
  await wc.loadURL(url, { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
  // 轮询等题面 DOM 出现（挑战页会自动跳转成真页面）
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const check = await wc.executeJavaScript(
      `(function(){const el=document.querySelector('.problem-statement');return el?el.outerHTML:null;})()`,
      true
    );
    if (check && check.length > 500) return parseStatementHtml(`<div class="problem-statement">${check}`, `${contestId}${index}`);
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error('加载题面超时（网络较慢或被 Cloudflare 拦截）');
}

async function fetchStatementJina(contestId, index) {
  const url = `https://r.jina.ai/https://codeforces.com/problemset/problem/${encodeURIComponent(contestId)}/${encodeURIComponent(index)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'CF Desktop / Electron Client', Accept: 'text/plain' },
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error(`题面服务返回 HTTP ${response.status}（免费额度可能用尽）`);
  const raw = await response.text();
  const marker = 'Markdown Content:';
  const markerAt = raw.indexOf(marker);
  const content = (markerAt >= 0 ? raw.slice(markerAt + marker.length) : raw).trim();
  if (!content || /Just a moment|Cloudflare|Rate limit/i.test(content)) {
    throw new Error('题面服务暂时不可用，请稍后重试或打开原网页');
  }
  return content;
}

async function fetchStatement(contestId, index, force) {
  const key = `${contestId}|${index}`;
  const hit = statementCache.get(key);
  if (!force && hit && Date.now() - hit.at < STATEMENT_TTL) {
    return { content: hit.content, cached: true, fetchedAt: hit.at, source: hit.source };
  }
  let content = null, source = '', directError = null;
  try {
    content = await fetchStatementDirect(contestId, index);
    source = 'direct';
  } catch (error) {
    directError = error;
  }
  if (!content) {
    try {
      content = await fetchStatementJina(contestId, index);
      source = 'jina';
    } catch {
      throw directError || new Error('直连与第三方题面源均不可用');
    }
  }
  const at = Date.now();
  statementCache.set(key, { content, at, source });
  return { content, cached: false, fetchedAt: at, source };
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

ipcMain.handle('problem:statement', async (_event, { contestId, index, force = false }) => {
  try {
    if (!/^\d+$/.test(String(contestId)) || !/^[A-Za-z]\d?$/.test(String(index))) {
      throw new Error('题号格式不对');
    }
    return { ok: true, ...(await fetchStatement(contestId, index, force)) };
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
