/**
 * wewe-rss 最小客户端（G0 探路 / 后续专队复用）
 * 上游：https://github.com/cooderl/wewe-rss
 */

const axios = require('axios');

/** 来自 wewe_private_config.wewe_base_url；优先于环境变量 */
let dbBaseUrlOverride = null;

function setWeweBaseUrlOverride(url) {
  const s = String(url || '').trim().replace(/\/$/, '');
  dbBaseUrlOverride = s || null;
}

function getWeweConfig() {
  const baseUrl = String(
    dbBaseUrlOverride || process.env.WEWE_RSS_BASE_URL || 'http://127.0.0.1:4000'
  ).replace(/\/$/, '');
  const authCode = process.env.WEWE_RSS_AUTH_CODE || process.env.AUTH_CODE || '';
  return { baseUrl, authCode };
}

function buildClient() {
  const { baseUrl, authCode } = getWeweConfig();
  const headers = {};
  if (authCode) {
    // 部分部署用 query code=；部分用 header；探路时两者都带上无害
    headers['Authorization'] = authCode;
    headers['x-auth-code'] = authCode;
  }
  const client = axios.create({
    baseURL: baseUrl,
    timeout: 60000,
    headers,
    validateStatus: () => true
  });
  return { client, baseUrl, authCode };
}

function withAuthQuery(params = {}) {
  const { authCode } = getWeweConfig();
  if (!authCode) return params;
  return { ...params, code: authCode };
}

/**
 * 规范化 all.json / feed.json 常见结构为文章数组
 */
function normalizeArticles(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.articles)) return payload.articles;
  if (payload.data && Array.isArray(payload.data)) return payload.data;
  if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;
  return [];
}

/** 去掉脚本/样式/base64 图，优先切到微信正文容器，避免 50 万字整页把正文挤出窗口 */
function compactWeixinHtml(html) {
  const s = String(html || '');
  if (!s) return '';
  const noHeavy = s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=\s]+/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  const marker = noHeavy.search(/id=["']js_content["']|class=["'][^"']*rich_media_content/i);
  const body = marker >= 0 ? noHeavy.slice(marker, marker + 250000) : noHeavy;
  return body.slice(0, 250000);
}

/** 从微信整页 HTML / 富文本抽出可读正文 */
function htmlToPlainText(html, maxLen = 80000) {
  const s = compactWeixinHtml(html);
  if (!s) return '';
  let text = s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cnStart = text.search(/[\u4e00-\u9fff]{6,}/);
  if (cnStart > 0) text = text.slice(cnStart);
  return text.slice(0, maxLen);
}

/** 从微信整页 HTML / 富文本里抽出可读纯文本预览（G0 探路用） */
function htmlToTextPreview(html, maxLen = 240) {
  return htmlToPlainText(html, maxLen);
}

function pickArticleFields(raw, feedHint = null) {
  const title = raw.title || raw.name || '';
  let link = raw.url || raw.link || raw.source_url || raw.external_url || '';
  const rawId = raw.id != null ? String(raw.id) : '';
  if (!link && /^https?:\/\//i.test(rawId)) link = rawId;
  if (!link && /^[A-Za-z0-9_-]{8,}$/.test(rawId) && !rawId.startsWith('MP_WXS')) {
    link = `https://mp.weixin.qq.com/s/${rawId}`;
  }
  const content =
    raw.content ||
    raw.content_html ||
    raw.content_text ||
    raw.contentHtml ||
    raw.contentText ||
    raw.html ||
    raw.description ||
    raw.summary ||
    '';
  // wewe JSON Feed 常见为 date_modified，不一定有 date_published
  const publicTime =
    raw.date_published ||
    raw.published ||
    raw.pubDate ||
    raw.publishTime ||
    raw.date ||
    raw.date_modified ||
    raw.created ||
    raw.updateTime ||
    null;
  const feedId = raw.feed_id || raw.feedId || feedHint || null;
  const contentStr = compactWeixinHtml(String(content));
  return {
    title: String(title).slice(0, 500),
    link: String(link).slice(0, 1000),
    contentPreview: htmlToTextPreview(contentStr, 240),
    contentFull: contentStr,
    contentLength: contentStr.length,
    hasHtmlBody: contentStr.includes('<') && contentStr.length > 500,
    publicTime,
    author: raw.author || null,
    feedId,
    weweArticleId: rawId || null,
    rawKeys: Object.keys(raw || {}).slice(0, 20)
  };
}

async function probeHealth() {
  const { client, baseUrl } = buildClient();
  const started = Date.now();
  const res = await client.get('/', { responseType: 'text', transformResponse: [(d) => d] });
  return {
    ok: res.status >= 200 && res.status < 500,
    status: res.status,
    baseUrl,
    latencyMs: Date.now() - started,
    bodySnippet: String(res.data || '').slice(0, 120)
  };
}

async function fetchAllFeedsJson(limitPerFeed = 5) {
  const { client, baseUrl } = buildClient();
  const res = await client.get('/feeds/all.json', { params: withAuthQuery({ limit: limitPerFeed }) });
  if (res.status >= 400) {
    const err = new Error(`wewe all.json HTTP ${res.status}`);
    err.status = res.status;
    err.body = typeof res.data === 'string' ? res.data.slice(0, 300) : res.data;
    throw err;
  }
  const articles = normalizeArticles(res.data).map((a) => pickArticleFields(a));
  return { baseUrl, status: res.status, count: articles.length, articles: articles.slice(0, limitPerFeed * 10) };
}

async function fetchFeedJson(feedId, { limit = 10, update = false, titleInclude = '', mode = 'fulltext' } = {}) {
  const id = String(feedId || '').trim();
  if (!id) throw new Error('feedId required');
  const { client, baseUrl } = buildClient();

  if (update) {
    // 官方：单 feed 刷新 GET /feeds/:feed.rss?update=true
    // 刷新响不含文章；正文另用小 limit 的 json，避免 200 篇全文 JSON.stringify 撑爆
    const upd = await client.get(`/feeds/${encodeURIComponent(id)}.rss`, {
      params: withAuthQuery({ update: true }),
      timeout: 180000,
      responseType: 'text',
      transformResponse: [(d) => d]
    });
    if (upd.status >= 400) {
      const err = new Error(`wewe feed update HTTP ${upd.status}`);
      err.status = upd.status;
      throw err;
    }
  }

  const readJson = async (n) => {
    const params = withAuthQuery({ limit: n, mode: mode || 'fulltext' });
    const include = String(titleInclude || '').trim();
    if (include) params.title_include = include.slice(0, 400);
    return client.get(`/feeds/${encodeURIComponent(id)}.json`, { params });
  };

  let res = await readJson(limit);
  if (res.status >= 400) {
    res = await readJson(Math.min(5, limit));
  }
  if (res.status >= 400) {
    const err = new Error(`wewe feed.json HTTP ${res.status}`);
    err.status = res.status;
    err.body = typeof res.data === 'string' ? res.data.slice(0, 300) : res.data;
    throw err;
  }
  const articles = normalizeArticles(res.data).map((a) => pickArticleFields(a, id));
  return {
    baseUrl,
    feedId: id,
    updated: Boolean(update),
    status: res.status,
    count: articles.length,
    articles
  };
}

/** tRPC mutation：body 直接传 procedure input（不要包 json 层）。字符串须 JSON 编码。 */
async function trpcMutation(procedurePath, input) {
  const { client, baseUrl } = buildClient();
  const payload = typeof input === 'string' ? JSON.stringify(input) : input;
  const res = await client.post(`/trpc/${procedurePath}`, payload, {
    headers: { 'Content-Type': 'application/json' }
  });
  if (res.status >= 400 || res.data?.error) {
    const msg =
      res.data?.error?.message ||
      (typeof res.data?.message === 'string' ? res.data.message : null) ||
      `tRPC ${procedurePath} HTTP ${res.status}`;
    const err = new Error(String(msg).slice(0, 500));
    err.status = res.status;
    err.body = res.data;
    throw err;
  }
  return res.data?.result?.data !== undefined ? res.data.result.data : res.data;
}

/** tRPC query（GET）。本镜像 wewe-rss 入参为裸 JSON，不要包 `{ json: ... }`（否则 required 字段读不到）。 */
async function trpcQuery(procedurePath, inputObj) {
  const { client } = buildClient();
  const input = encodeURIComponent(JSON.stringify(inputObj || {}));
  const res = await client.get(`/trpc/${procedurePath}?input=${input}`);
  if (res.status >= 400 || res.data?.error) {
    const msg = res.data?.error?.message || `tRPC ${procedurePath} HTTP ${res.status}`;
    const err = new Error(String(msg).slice(0, 500));
    err.status = res.status;
    err.body = res.data;
    throw err;
  }
  const data = res.data?.result?.data !== undefined ? res.data.result.data : res.data;
  // 兼容个别带 superjson 的部署
  if (data && typeof data === 'object' && data.json !== undefined && data.meta) {
    return data.json;
  }
  return data;
}

async function listWeweFeeds(limit = 200) {
  const data = await trpcQuery('feed.list', { limit });
  const items = data?.items || data?.json?.items || [];
  return Array.isArray(items) ? items : [];
}

/**
 * 用公众号文章分享链接解析 wewe 侧 mp 信息
 * @returns {{ id, name, cover, intro, updateTime }}
 */
async function getMpInfoByArticleUrl(wxsLink) {
  const url = String(wxsLink || '').trim();
  if (!url.startsWith('https://mp.weixin.qq.com/s/')) {
    throw new Error('sample_article_url 须为 https://mp.weixin.qq.com/s/ 开头的分享链接');
  }
  const data = await trpcMutation('platform.getMpInfo', { wxsLink: url });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.id) {
    throw new Error('getMpInfo 未返回 feed id');
  }
  return {
    id: String(row.id),
    name: row.name || row.mpName || '',
    cover: row.cover || row.mpCover || '',
    intro: row.intro || row.mpIntro || '',
    updateTime: Number(row.updateTime) || Math.floor(Date.now() / 1000)
  };
}

function isWeweFeedGoneError(err) {
  const msg = String((err && err.message) || err || '');
  const body = err && err.body ? JSON.stringify(err.body) : '';
  return /No feed|does not exist|Record to delete|P2025|not found/i.test(`${msg} ${body}`);
}

/** 从 wewe-rss 硬删除订阅源（wewe SQLite/MySQL，不是新闻库软删） */
async function deleteWeweFeed(feedId) {
  const id = String(feedId || '').trim();
  if (!id) throw new Error('feedId required');
  try {
    await trpcMutation('feed.delete', id);
    return { deleted: true, feedId: id };
  } catch (e) {
    if (isWeweFeedGoneError(e)) {
      return { deleted: true, alreadyGone: true, feedId: id };
    }
    throw e;
  }
}

/** 若 wewe 尚无该 feed 则 upsert 订阅 */
async function ensureWeweFeedSubscribed(mpInfo) {
  const feeds = await listWeweFeeds(1000);
  const exists = feeds.some((f) => f.id === mpInfo.id);
  if (exists) {
    return { created: false, feedId: mpInfo.id };
  }
  await trpcMutation('feed.add', {
    id: mpInfo.id,
    mpName: mpInfo.name || mpInfo.id,
    mpCover: mpInfo.cover || '',
    mpIntro: mpInfo.intro || '',
    syncTime: Math.floor(Date.now() / 1000),
    updateTime: mpInfo.updateTime || Math.floor(Date.now() / 1000),
    status: 1
  });
  return { created: true, feedId: mpInfo.id };
}

/** 触发 wewe 侧刷新该公众号文章入库 */
async function refreshMpArticles(mpId) {
  return trpcMutation('feed.refreshArticles', { mpId: String(mpId) });
}

/**
 * 直接从微信读书通道拉文章列表（比空的 feeds/*.json 更可靠）
 * @returns {Array<{id,title,url,publishTime,picUrl}>}
 */
async function getMpArticles(mpId) {
  const data = await trpcMutation('platform.getMpArticles', { mpId: String(mpId) });
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

async function listWeweAccounts(limit = 50) {
  const data = await trpcQuery('account.list', { limit });
  const items = data?.items || [];
  return Array.isArray(items) ? items : [];
}

/** 是否有 status=启用(1) 的读书账号 */
async function hasEnabledWeweAccount() {
  const items = await listWeweAccounts(100);
  return items.some((a) => Number(a.status) === 1);
}

/** 生成微信读书扫码登录 URL */
async function createLoginUrl() {
  const data = await trpcMutation('platform.createLoginUrl', {});
  const row = data && data.json ? data.json : data;
  if (!row || (!row.uuid && !row.id)) {
    throw new Error('createLoginUrl 未返回 uuid');
  }
  return {
    uuid: String(row.uuid || row.id),
    scanUrl: row.scanUrl || row.url || row.qrUrl || ''
  };
}

/** 轮询扫码结果：waiting | { vid, token, username } */
async function getLoginResult(uuid) {
  const data = await trpcQuery('platform.getLoginResult', { id: String(uuid) });
  return data && data.json ? data.json : data;
}

/** 将读书账号写入 wewe（upsert，可把失效账号重新启用） */
async function addWeweAccount({ id, token, name, status = 1 }) {
  return trpcMutation('account.add', {
    id: String(id),
    token: String(token || ''),
    name: String(name || id),
    status: Number(status) || 1
  });
}

module.exports = {
  getWeweConfig,
  setWeweBaseUrlOverride,
  probeHealth,
  fetchAllFeedsJson,
  fetchFeedJson,
  normalizeArticles,
  pickArticleFields,
  htmlToPlainText,
  htmlToTextPreview,
  trpcMutation,
  trpcQuery,
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
  addWeweAccount
};
