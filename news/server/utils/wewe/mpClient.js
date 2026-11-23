/**
 * 私有公众号采集门面：按 collector_provider 在 wewe / we-mp-rss(werss) 间切换。
 * 调用方应 require('./mpClient')，勿再直接绑死 weweClient（催登/提取/映射）。
 */

const weweClient = require('./weweClient');
const mpRssClient = require('./mpRssClient');

/** @type {'wewe'|'werss'|null} */
let providerOverride = null;

function setCollectorProviderOverride(provider) {
  const p = String(provider || '').trim().toLowerCase();
  if (p === 'wewe' || p === 'werss' || p === 'we-mp-rss' || p === 'werss-mp') {
    providerOverride = p === 'wewe' ? 'wewe' : 'werss';
  } else if (!p) {
    providerOverride = null;
  }
}

function resolveProviderSync() {
  if (providerOverride) return providerOverride;
  const env = String(process.env.MP_RSS_PROVIDER || process.env.WEWE_COLLECTOR_PROVIDER || '')
    .trim()
    .toLowerCase();
  if (env === 'werss' || env === 'we-mp-rss' || env === 'mp-rss' || env === 'werss-mp') {
    return 'werss';
  }
  if (env === 'wewe') return 'wewe';
  return 'wewe';
}

async function resolveProvider() {
  if (providerOverride) return providerOverride;
  try {
    const { getWewePrivateConfig } = require('./wewePrivateTeam');
    const cfg = await getWewePrivateConfig();
    const p = String((cfg && cfg.collector_provider) || '')
      .trim()
      .toLowerCase();
    if (p === 'werss' || p === 'we-mp-rss' || p === 'mp-rss') return 'werss';
    if (p === 'wewe') return 'wewe';
  } catch (_) {
    /* ignore */
  }
  return resolveProviderSync();
}

function backendSync() {
  return resolveProviderSync() === 'werss' ? mpRssClient : weweClient;
}

async function backend() {
  return (await resolveProvider()) === 'werss' ? mpRssClient : weweClient;
}

function setWeweBaseUrlOverride(url) {
  const p = resolveProviderSync();
  if (p === 'werss') mpRssClient.setWeweBaseUrlOverride(url);
  else weweClient.setWeweBaseUrlOverride(url);
}

async function applyBaseUrlFromConfig(cfg) {
  const p = String((cfg && cfg.collector_provider) || process.env.MP_RSS_PROVIDER || 'wewe')
    .trim()
    .toLowerCase();
  const isWerss = p === 'werss' || p === 'we-mp-rss' || p === 'mp-rss';
  setCollectorProviderOverride(isWerss ? 'werss' : 'wewe');
  const url = cfg && cfg.wewe_base_url ? String(cfg.wewe_base_url).trim() : '';
  if (isWerss) mpRssClient.setWeweBaseUrlOverride(url);
  else weweClient.setWeweBaseUrlOverride(url);
}

async function getWeweConfig() {
  return (await backend()).getWeweConfig();
}

async function probeHealth() {
  const b = await backend();
  const r = await b.probeHealth();
  return { ...r, provider: await resolveProvider() };
}

async function fetchFeedJson(...args) {
  return (await backend()).fetchFeedJson(...args);
}

async function fetchAllFeedsJson(...args) {
  return (await backend()).fetchAllFeedsJson(...args);
}

async function listWeweFeeds(...args) {
  return (await backend()).listWeweFeeds(...args);
}

async function listWeweAccounts(...args) {
  return (await backend()).listWeweAccounts(...args);
}

async function hasEnabledWeweAccount(...args) {
  return (await backend()).hasEnabledWeweAccount(...args);
}

async function getMpInfoByArticleUrl(...args) {
  return (await backend()).getMpInfoByArticleUrl(...args);
}

async function ensureWeweFeedSubscribed(...args) {
  return (await backend()).ensureWeweFeedSubscribed(...args);
}

async function deleteWeweFeed(...args) {
  return (await backend()).deleteWeweFeed(...args);
}

async function refreshMpArticles(...args) {
  return (await backend()).refreshMpArticles(...args);
}

async function getMpArticles(...args) {
  return (await backend()).getMpArticles(...args);
}

async function createLoginUrl(...args) {
  return (await backend()).createLoginUrl(...args);
}

async function getLoginResult(...args) {
  return (await backend()).getLoginResult(...args);
}

async function addWeweAccount(...args) {
  return (await backend()).addWeweAccount(...args);
}

// 纯工具仍来自 weweClient（HTML 清洗），与后端无关
const { normalizeArticles, pickArticleFields, htmlToPlainText, htmlToTextPreview } = weweClient;

module.exports = {
  setCollectorProviderOverride,
  resolveProvider,
  resolveProviderSync,
  applyBaseUrlFromConfig,
  setWeweBaseUrlOverride,
  getWeweConfig,
  probeHealth,
  fetchAllFeedsJson,
  fetchFeedJson,
  normalizeArticles,
  pickArticleFields,
  htmlToPlainText,
  htmlToTextPreview,
  listWeweFeeds,
  listWeweAccounts,
  hasEnabledWeweAccount,
  getMpInfoByArticleUrl,
  ensureWeweFeedSubscribed,
  deleteWeweFeed,
  refreshMpArticles,
  getMpArticles,
  createLoginUrl,
  getLoginResult,
  addWeweAccount,
  // 透传 wewe 专用（仅 wewe 后端有意义；werss 调用会抛错）
  trpcMutation: (...a) => backendSync().trpcMutation?.(...a) ?? Promise.reject(new Error('trpc 仅 wewe 支持')),
  trpcQuery: (...a) => backendSync().trpcQuery?.(...a) ?? Promise.reject(new Error('trpc 仅 wewe 支持'))
};
