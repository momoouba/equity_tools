/**
 * 探测 wewe-rss 生成活码依赖的微信读书中转（PLATFORM_URL /api/v2/login/platform）
 * Usage: node server/scripts/wewePlatformLoginProbe.js
 */
const https = require('https');

const PATH = '/api/v2/login/platform';
const HOSTS = [
  process.env.WEWE_PLATFORM_URL || '',
  'https://weread.111965.xyz',
  'https://weread.965111.xyz'
]
  .map((s) => String(s || '').trim().replace(/\/$/, ''))
  .filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i);

function probe(base) {
  const url = `${base}${PATH}`;
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
        if (body.length > 200) body = body.slice(0, 200);
      });
      res.on('end', () => {
        resolve({ url, status: res.statusCode, ok: res.statusCode === 200, snippet: body.replace(/\s+/g, ' ') });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ url, status: 0, ok: false, snippet: 'timeout' });
    });
    req.on('error', (e) => {
      resolve({ url, status: 0, ok: false, snippet: e.message });
    });
  });
}

async function main() {
  const rows = [];
  for (const host of HOSTS) {
    rows.push(await probe(host));
  }
  for (const r of rows) {
    console.log(`${r.ok ? 'OK' : 'FAIL'} ${r.status} ${r.url} ${r.snippet || ''}`.trim());
  }
  const anyOk = rows.some((r) => r.ok);
  if (!anyOk) {
    console.error(
      'wewePlatformLoginProbe: 中转均不可用。活码页的 404/500 来自 PLATFORM_URL，不是新闻站路由缺失。'
    );
    process.exit(2);
  }
  console.log('wewePlatformLoginProbe ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
