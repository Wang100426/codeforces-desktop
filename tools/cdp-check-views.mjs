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
    errors.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
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
await send('Page.reload', { ignoreCache: true });
await wait(9000);

const views = [
  ['contests', 3500], ['problems', 7000], ['submissions', 4000], ['users', 9000]
];
for (const [view, delay] of views) {
  await evalJS(`document.querySelector('[data-view="${view}"]').click()`);
  await wait(delay);
  const info = await evalJS(`({
    view: document.querySelector('.view.active')?.id,
    api: document.querySelector('#api-state')?.textContent,
    rows: document.querySelectorAll('.view.active .row, .view.active .contest-card, .view.active .user-card').length,
    text: document.querySelector('.view.active')?.innerText?.slice(0, 260).replace(/\\n+/g, ' | ')
  })`);
  console.log(view, JSON.stringify(info));
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`D:/tmp/cf-pulse-${view}.png`, Buffer.from(shot.data, 'base64'));
}
console.log('ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
ws.close();
