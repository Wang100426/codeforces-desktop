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
const state = `({
  mounted: document.querySelector('#sub-detail').classList.contains('mounted'),
  open: document.querySelector('#sub-detail').classList.contains('open'),
  sub: document.querySelector('#detail-sub-id').textContent,
  verdict: document.querySelector('.detail-verdict')?.textContent
})`;

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('Page.bringToFront');
await send('Page.reload', { ignoreCache: true }); await wait(9000);

await evalJS(`document.querySelector('[data-view="profile"]').click()`);
await wait(13000);
console.log('个人中心最近提交入口:', await evalJS(`document.querySelectorAll('#profile-submissions [data-submission]').length`));
await evalJS(`document.querySelector('#profile-submissions [data-submission]').click()`);
await wait(500);
console.log('从个人中心打开:', JSON.stringify(await evalJS(state)));

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await wait(200);
console.log('Esc 后:', JSON.stringify(await evalJS(`({ open: document.querySelector('#sub-detail').classList.contains('open'), aria: document.querySelector('#sub-detail').getAttribute('aria-hidden') })`)));
await wait(600);

await evalJS(`document.querySelector('[data-view="submissions"]').click()`);
await wait(3500);
await evalJS(`document.querySelector('#sub-list [data-submission]').click()`);
await wait(400);
await evalJS(`document.querySelector('.detail-scrim').click()`);
await wait(200);
console.log('遮罩点击后:', JSON.stringify(await evalJS(`({ open: document.querySelector('#sub-detail').classList.contains('open'), aria: document.querySelector('#sub-detail').getAttribute('aria-hidden') })`)));
console.log('console 错误:', errors.length ? JSON.stringify(errors.slice(0, 5)) : '无');
ws.close();
process.exit(0);
