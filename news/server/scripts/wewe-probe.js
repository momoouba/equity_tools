#!/usr/bin/env node
/**
 * G0.3 独立探路脚本：不依赖 MySQL，直接打 wewe-rss
 * 与本地 `npm run dev` 并列：先起 wewe(4000)，再在本目录执行本脚本。
 *
 *   cd news && npm run probe:wewe
 *   WEWE_UPDATE=1 node server/scripts/wewe-probe.js MP_WXS_xxx
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), override: false });

const {
  probeHealth,
  fetchAllFeedsJson,
  fetchFeedJson,
  getWeweConfig
} = require('../utils/wewe/weweClient');

async function main() {
  const feedId = process.argv[2] || '';
  const cfg = getWeweConfig();
  console.log('[wewe-probe] config', { baseUrl: cfg.baseUrl, authConfigured: Boolean(cfg.authCode) });

  const health = await probeHealth();
  console.log('[wewe-probe] health', health);
  if (!health.ok) {
    console.error('[wewe-probe] wewe 不可达。本地 news 用 npm run dev；wewe 需另起：');
    console.error('  cd news/deploy/wewe-rss && docker compose up -d');
    console.error('详见 news/deploy/wewe-rss/README.md');
    process.exit(1);
  }

  if (feedId) {
    const one = await fetchFeedJson(feedId, { limit: 5, update: process.env.WEWE_UPDATE === '1' });
    console.log('[wewe-probe] feed', JSON.stringify(one, null, 2));
  } else {
    const all = await fetchAllFeedsJson(5);
    console.log('[wewe-probe] all.json count=', all.count);
    console.log(JSON.stringify(all.articles.slice(0, 10), null, 2));
    if (!all.count) {
      console.warn('[wewe-probe] 无文章：请在管理页扫码并添加公众号分享链接后再跑');
      process.exit(2);
    }
  }
  console.log('[wewe-probe] G0 读文探路 OK');
}

main().catch((e) => {
  console.error('[wewe-probe] failed', e.message, e.status || '', e.body || '');
  process.exit(1);
});
