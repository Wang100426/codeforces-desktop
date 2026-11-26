import fs from 'node:fs';

const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('cf-pulse'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push('LOG: ' + msg.params.entry.text);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }));
});
const evalJS = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.reload', { ignoreCache: true }); await wait(9000);

// 个人中心
await evalJS(`document.querySelector('[data-view="profile"]').click()`);
await wait(13000);
console.log('个人中心:', JSON.stringify(await evalJS(`({
  title: document.querySelector('#view-profile h1').textContent,
  hero: document.querySelector('#profile-hero .hero-name')?.textContent,
  stats: [...document.querySelectorAll('#profile-stats .stat-box .v')].map(e=>e.textContent),
  bars: document.querySelectorAll('#profile-bars .bar-row').length,
  contests: document.querySelectorAll('#profile-contests .contest-history-row').length,
  feed: document.querySelectorAll('#profile-submissions .compact-row').length,
  chartPoints: document.querySelector('#profile-chart polyline')?.getAttribute('points')?.split(' ').length || 0,
  error: document.querySelector('#profile-hero .error-box')?.textContent?.slice(0,80) || null
})`)));
let shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('D:/tmp/cf-pulse-profile.png', Buffer.from(shot.data, 'base64'));

// 题目搜索
await evalJS(`document.querySelector('[data-view="problems"]').click()`);
await wait(8000);
console.log('题目搜索:', JSON.stringify(await evalJS(`({
  title: document.querySelector('#view-problems h1').textContent,
  rows: document.querySelectorAll('#problem-list .row').length,
  submitButtons: document.querySelectorAll('#problem-list [data-submit]').length,
  firstSubmit: document.querySelector('#problem-list [data-submit]')?.dataset.submit,
  quickTags: document.querySelectorAll('#quick-tags .quick-tag').length,
  stats: document.querySelector('#problem-stats').textContent
})`)));
await evalJS(`(() => { const el=document.querySelector('#problem-search'); el.value='1931D'; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
console.log('搜索 1931D:', JSON.stringify(await evalJS(`({
  rows: document.querySelectorAll('#problem-list .row').length,
  first: document.querySelector('#problem-list .row-title')?.textContent,
  history: [...document.querySelectorAll('#search-history .history-chip')].map(e=>e.textContent)
})`)));
await evalJS(`(() => { const el=document.querySelector('#problem-search'); el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#problem-random').click(); })()`);
console.log('随机一题:', JSON.stringify(await evalJS(`({
  visible: !document.querySelector('#random-card').classList.contains('hidden'),
  title: document.querySelector('#random-card .rc-title')?.textContent,
  submit: document.querySelector('#random-card [data-submit]')?.dataset.submit
})`)));
await evalJS(`document.querySelector('#quick-tags .quick-tag').click()`);
console.log('快捷标签:', JSON.stringify(await evalJS(`({
  selected: document.querySelector('#problem-tags').value,
  active: document.querySelector('#quick-tags .quick-tag.active')?.textContent,
  rows: document.querySelectorAll('#problem-list .row').length
})`)));
shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('D:/tmp/cf-pulse-search.png', Buffer.from(shot.data, 'base64'));

// 提交记录跳转目标
await evalJS(`document.querySelector('[data-view="submissions"]').click()`);
await wait(4000);
console.log('提交入口:', JSON.stringify(await evalJS(`({
  banner: document.querySelector('#view-submissions .info-banner')?.textContent?.slice(0,50),
  rows: document.querySelectorAll('#sub-list [data-submission]').length,
  first: document.querySelector('#sub-list [data-submission]')?.dataset.submission
})`)));
console.log('ERRORS:', errors.length ? errors.slice(0, 6) : 'none');
ws.close();
