import fs from 'node:fs';

const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('cf-pulse'));
if (!page) throw new Error('no cf-pulse page target');
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
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    errors.push(`${msg.params.type.toUpperCase()}: ` + msg.params.args.map((a) => a.value || a.description).join(' '));
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push('LOG: ' + msg.params.entry.text);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 10000));

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result.value;
};

const summary = await evaluate(`({
  title: document.title,
  ready: document.readyState,
  apiState: document.querySelector('#api-state')?.textContent,
  status: document.querySelector('#status-message')?.textContent,
  hero: document.querySelector('#dash-hero')?.innerText?.slice(0, 300),
  chartPoints: document.querySelector('#dash-chart polyline')?.getAttribute('points')?.split(' ').length || 0,
  chartMeta: document.querySelector('#chart-meta')?.textContent,
  upcomingRows: document.querySelectorAll('#dash-contests .compact-row').length,
  subRows: document.querySelectorAll('#dash-submissions .compact-row').length,
  watchRows: document.querySelectorAll('#side-watch .watch-row').length,
  topRows: document.querySelectorAll('#top-list .row').length,
  windowSize: [innerWidth, innerHeight],
  bodyScroll: [document.querySelector('.content').scrollWidth, document.querySelector('.content').scrollHeight]
})`);
console.log(JSON.stringify(summary, null, 2));
console.log('ERRORS:', errors.length ? errors.slice(0, 12) : 'none');

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync('/tmp/cf-pulse-dash.png', Buffer.from(shot.data, 'base64'));
console.log('screenshot: /tmp/cf-pulse-dash.png');
ws.close();
