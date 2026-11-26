'use strict';

const crypto = require('node:crypto');
const auth = require('../auth.cjs');

// 1. 官方文档示例：key=xxx, secret=yyy, rand=123456, contestId=566, time=1795662610
const expectedBase = '123456/contest.hacks?apiKey=xxx&contestId=566&time=1795662610#yyy';
const expectedSig = '123456' + crypto.createHash('sha512').update(expectedBase).digest('hex');
const actualSig = auth.sign('contest.hacks', { contestId: 566 }, 'xxx', 'yyy', '123456', 1795662610);
console.log('官方示例签名一致:', actualSig === expectedSig ? 'PASS' : `FAIL\n  got: ${actualSig}\n  exp: ${expectedSig}`);

// 2. 多参数排序：多个 handles 的分号值不应被提前编码进签名串
const multi = auth.sign('user.info', { handles: 'tourist;Kevin114514' }, 'key1', 'secret1', 'abcdef', 1795662610);
const multiBase = 'abcdef/user.info?apiKey=key1&handles=tourist;Kevin114514&time=1795662610#secret1';
const multiExpected = 'abcdef' + crypto.createHash('sha512').update(multiBase).digest('hex');
console.log('多参数排序与原始值:', multi === multiExpected ? 'PASS' : 'FAIL');

// 3. 随机前缀
console.log('随机前缀格式:', /^[0-9a-f]{6}$/.test(auth.randomRand()) ? 'PASS' : 'FAIL');

// 4. 真实服务器：用假 key 发一次正确签名的请求，看服务器是否识别 apiKey 参数
(async () => {
  const time = Math.floor(Date.now() / 1000);
  const rand = auth.randomRand();
  const params = { handles: 'tourist', apiKey: 'xxx', time: String(time) };
  const sig = auth.sign('user.info', { handles: 'tourist' }, 'xxx', 'yyy', rand, time);
  const url = new URL('https://codeforces.com/api/user.info');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apiSig', sig);
  const res = await fetch(url, { headers: { 'User-Agent': 'CF Pulse signature check' }, signal: AbortSignal.timeout(30000) });
  const payload = await res.json();
  console.log('服务器响应（假 key，预期 FAILED）:', payload.status, '|', payload.comment);
  console.log('请求 URL:', url.toString().replace(sig, sig.slice(0, 12) + '…'));
})().catch((error) => console.log('网络验证失败:', error.message));
