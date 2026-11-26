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
const fill = async (selector, text) => {
  await evalJS(`document.querySelector('${selector}').focus()`);
  await send('Input.insertText', { text });
};

await send('Runtime.enable'); await send('Page.enable');
await send('Page.reload', { ignoreCache: true }); await wait(9000);

console.log('初始状态:', JSON.stringify(await evalJS(`({
  text: document.querySelector('#auth-status').textContent,
  on: document.querySelector('#auth-btn').classList.contains('auth-on')
})`)));

await evalJS(`document.querySelector('#auth-btn').click()`);
await wait(400);
console.log('弹窗:', JSON.stringify(await evalJS(`({
  visible: !document.querySelector('#auth-modal').classList.contains('hidden'),
  title: document.querySelector('.modal-head h2').textContent,
  status: document.querySelector('#auth-status').textContent
})`)));
let shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('D:/tmp/cf-pulse-auth.png', Buffer.from(shot.data, 'base64'));

// 写入假凭证，验证签名请求确实被服务器拒绝
await fill('#auth-key', 'deadbeef1234');
await fill('#auth-secret', 'fakesecret');
await evalJS(`document.querySelector('#auth-save').click()`);
await wait(1500);
console.log('保存后:', JSON.stringify(await evalJS(`({
  text: document.querySelector('#auth-status').textContent,
  on: document.querySelector('#auth-btn').classList.contains('auth-on'),
  modalHidden: document.querySelector('#auth-modal').classList.contains('hidden'),
  status: document.querySelector('#status-message').textContent
})`)));
await wait(13000);
console.log('假 key 下的首页:', JSON.stringify(await evalJS(`({
  error: document.querySelector('#dash-hero .error-box')?.innerText?.slice(0, 90),
  hero: document.querySelector('.hero-name')?.textContent || null
})`)));

// 清除，回到匿名模式
await evalJS(`document.querySelector('#auth-btn').click()`);
await wait(300);
await evalJS(`document.querySelector('#auth-clear').click()`);
await wait(14000);
console.log('清除后:', JSON.stringify(await evalJS(`({
  text: document.querySelector('#auth-status').textContent,
  on: document.querySelector('#auth-btn').classList.contains('auth-on'),
  hero: document.querySelector('.hero-name')?.textContent,
  error: document.querySelector('#dash-hero .error-box')?.innerText?.slice(0, 60) || null
})`)));
console.log('ERRORS:', errors.length ? errors.slice(0, 5) : 'none');
ws.close();
