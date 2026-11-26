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
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }));
});
const evalJS = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Runtime.enable'); await send('Page.enable');
await send('Page.reload', { ignoreCache: true }); await wait(9000);

// 真实键盘输入切换 handle
await evalJS(`document.querySelector('#handle-input').focus(); document.querySelector('#handle-input').select()`);
await send('Input.insertText', { text: 'Kevin114514' });
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await wait(10000);
console.log('切换用户:', JSON.stringify(await evalJS(`({
  handle: document.querySelector('#status-handle').textContent,
  hero: document.querySelector('.hero-name')?.textContent,
  rating: document.querySelector('.hero-rating .big')?.textContent,
  subs: document.querySelectorAll('#dash-submissions .compact-row').length
})`)));

// 恢复默认
await evalJS(`document.querySelector('#handle-input').focus(); document.querySelector('#handle-input').select()`);
await send('Input.insertText', { text: 'tourist' });
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await wait(2000);

// 题库筛选
await evalJS(`document.querySelector('[data-view="problems"]').click()`); await wait(6500);
await evalJS(`(() => { const el = document.querySelector('#problem-search'); el.value = '1931D'; el.dispatchEvent(new Event('input', {bubbles:true})); })()`);
console.log('题号搜索:', JSON.stringify(await evalJS(`({
  rows: document.querySelectorAll('#problem-list .row').length,
  first: document.querySelector('#problem-list .row-title')?.textContent,
  sub: document.querySelector('#problem-list .row-sub')?.textContent
})`)));
await evalJS(`(() => { const el = document.querySelector('#problem-search'); el.value = ''; el.dispatchEvent(new Event('input', {bubbles:true})); const s = document.querySelector('#problem-rating'); s.value='2400-9999'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
console.log('2400+ 筛选:', JSON.stringify(await evalJS(`({
  rows: document.querySelectorAll('#problem-list .row').length,
  ratings: [...document.querySelectorAll('#problem-list .row .rating')].slice(0,5).map(e=>e.textContent),
  total: document.querySelector('.page-info')?.textContent
})`)));
console.log('ERRORS:', errors.length ? errors.slice(0, 5) : 'none');
ws.close();
