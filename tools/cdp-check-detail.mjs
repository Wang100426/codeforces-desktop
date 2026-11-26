import fs from 'node:fs';

const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('cf-pulse'));
if (!page) throw new Error('找不到 CF Desktop 页面');
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
const detailState = `(() => {
  const root = document.querySelector('#sub-detail');
  const panel = document.querySelector('.detail-panel');
  return {
    mounted: root.classList.contains('mounted'),
    open: root.classList.contains('open'),
    transform: getComputedStyle(panel).transform,
    scrimOpacity: getComputedStyle(document.querySelector('.detail-scrim')).opacity,
    subId: document.querySelector('#detail-sub-id').textContent,
    verdict: document.querySelector('.detail-verdict')?.textContent,
    problem: document.querySelector('.detail-problem')?.textContent,
    metrics: [...document.querySelectorAll('.detail-metric')].map(e => e.textContent.trim()),
    timeline: [...document.querySelectorAll('.detail-timeline .tl-time')].map(e => e.textContent),
    meta: [...document.querySelectorAll('.detail-meta-grid .dm')].map(e => e.textContent.trim()),
    trail: [...document.querySelectorAll('[data-detail-sub]')].map(e => e.dataset.detailSub),
    external: !!document.querySelector('#detail-open-code'),
    sync: document.querySelector('#detail-sync-tag')?.textContent || ''
  };
})()`;

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.bringToFront');
await send('Page.reload', { ignoreCache: true }); await wait(9000);

console.log('品牌:', JSON.stringify(await evalJS(`({
  title: document.title,
  brand: document.querySelector('.brand').textContent.trim(),
  status: document.querySelector('.status-right').textContent
})`)));

await evalJS(`document.querySelector('[data-view="submissions"]').click()`);
await wait(5000);
console.log('提交列表:', JSON.stringify(await evalJS(`({
  rows: document.querySelectorAll('#sub-list .row').length,
  first: document.querySelector('#sub-list .row-title')?.textContent,
  firstId: document.querySelector('#sub-list [data-submission]')?.dataset.submission
})`)));

await evalJS(`document.querySelector('#sub-list [data-submission]').click()`);
await wait(750);
console.log('滑入中:', JSON.stringify(await evalJS(detailState)));
await wait(2400);
const opened = await evalJS(detailState);
console.log('打开后:', JSON.stringify(opened));
let shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('D:/tmp/cf-detail-open.png', Buffer.from(shot.data, 'base64'));

if (opened.trail.length > 1) {
  await evalJS(`document.querySelectorAll('[data-detail-sub]')[1].click()`);
  await wait(600);
  console.log('切换同题:', JSON.stringify(await evalJS(`({
    subId: document.querySelector('#detail-sub-id').textContent,
    verdict: document.querySelector('.detail-verdict')?.textContent,
    trailCount: document.querySelectorAll('[data-detail-sub]').length
  })`)));
}

await evalJS(`document.querySelector('#detail-back').click()`);
await wait(200);
const closing = await evalJS(detailState);
console.log('滑出中:', JSON.stringify({ mounted: closing.mounted, open: closing.open, transform: closing.transform }));
await wait(600);
console.log('关闭后:', JSON.stringify(await evalJS(`({
  mounted: document.querySelector('#sub-detail').classList.contains('mounted'),
  open: document.querySelector('#sub-detail').classList.contains('open'),
  aria: document.querySelector('#sub-detail').getAttribute('aria-hidden')
})`)));

console.log('console 错误:', errors.length ? JSON.stringify(errors.slice(0, 5)) : '无');
ws.close();
process.exit(0);
