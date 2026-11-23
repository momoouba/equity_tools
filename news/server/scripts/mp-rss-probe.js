/**
 * we-mp-rss 本地探活（不依赖 MySQL）
 *
 *   cd news
 *   node server/scripts/mp-rss-probe.js
 *   node server/scripts/mp-rss-probe.js MP_WXS_xxx
 *
 * 环境变量：MP_RSS_BASE_URL / MP_RSS_USERNAME / MP_RSS_PASSWORD
 */
process.env.MP_RSS_PROVIDER = process.env.MP_RSS_PROVIDER || 'werss';

const {
  probeHealth,
  fetchAllFeedsJson,
  fetchFeedJson,
  listWeweFeeds,
  hasEnabledWeweAccount,
  getWeweConfig
} = require('../utils/wewe/mpRssClient');

async function main() {
  const feedId = process.argv[2] || '';
  const cfg = getWeweConfig();
  console.log('[mp-rss-probe] baseUrl=', cfg.baseUrl);

  const health = await probeHealth();
  console.log('[mp-rss-probe] health=', JSON.stringify(health));

  try {
    const loggedIn = await hasEnabledWeweAccount();
    console.log('[mp-rss-probe] weread configured=', loggedIn);
  } catch (e) {
    console.warn('[mp-rss-probe] weread status:', e.message);
  }

  try {
    const feeds = await listWeweFeeds(20);
    console.log(`[mp-rss-probe] feeds count=${feeds.length}`);
    feeds.slice(0, 5).forEach((f) => console.log('  -', f.id, f.name || f.mpName));
  } catch (e) {
    console.warn('[mp-rss-probe] list feeds:', e.message);
  }

  if (feedId) {
    const one = await fetchFeedJson(feedId, { limit: 5, update: false });
    console.log(`[mp-rss-probe] feed ${feedId} articles=${one.count}`);
    one.articles.slice(0, 3).forEach((a) => {
      console.log('  ·', a.title?.slice(0, 60), a.link?.slice(0, 80));
    });
  } else {
    try {
      const all = await fetchAllFeedsJson(3);
      console.log(`[mp-rss-probe] all.json articles=${all.count}`);
    } catch (e) {
      console.warn('[mp-rss-probe] all.json:', e.message);
    }
  }
}

main().catch((e) => {
  console.error('[mp-rss-probe] FAILED', e.message);
  process.exit(1);
});
