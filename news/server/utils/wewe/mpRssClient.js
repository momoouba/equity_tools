/**
 * we-mp-rss（WeRSS）客户端：对齐 weweClient 对外能力，供专队提取/映射/催登复用。
 * 上游：https://github.com/rachelos/we-mp-rss
 * API：/api/v1/wx/* ；Feed：/feed/{id}.json
 */

const axios = require('axios');
const {
  normalizeArticles,
  pickArticleFields,
  htmlToPlainText,
  htmlToTextPreview
} = require('./weweClient');

let dbBaseUrlOverride = null;
let cachedToken = null;
let cachedTokenAt = 0;

function setMpRssBaseUrlOverride(url) {
  const s = String(url || '').trim().replace(/\/$/, '');
  dbBaseUrlOverride = s || null;
  cachedToken = null;
}

function getMpRssConfig() {
  const baseUrl = String(
    dbBaseUrlOverride || process.env.MP_RSS_BASE_URL || process.env.WEWE_RSS_BASE_URL || 'http://127.0.0.1:8001'
  ).replace(/\/$/, '');
  const username = process.env.MP_RSS_USERNAME || 'admin';
  const password = process.env.MP_RSS_PASSWORD || 'admin@123';
  const accessKey = String(process.env.MP_RSS_ACCESS_KEY || '').trim();
  const staticToken = String(process.env.MP_RSS_TOKEN || '').trim();
  return { baseUrl, username, password, accessKey, staticToken };
}

function buildClient(extraHeaders = {}) {
  const { baseUrl } = getMpRssConfig();
  return axios.create({
    baseURL: baseUrl,
    timeout: 60000,
    headers: { Accept: 'application/json', ...extraHeaders },
    validateStatus: () => true
  });
}

function unwrapPayload(data) {
  if (data == null) return data;
  if (typeof data === 'object' && data.code === 0 && data.data !== undefined) return data.data;
  if (typeof data === 'object' && data.data !== undefined && data.message != null) return data.data;
  return data;
}

async function ensureAuthHeaders() {
  const { accessKey, staticToken } = getMpRssConfig();
  if (accessKey) {
    return { Authorization: `AK-SK ${accessKey}` };
  }
  if (staticToken) {
    return { Authorization: `Bearer ${staticToken}` };
  }
  // 缓存 token 约 50 分钟（默认 expires 常为数小时，保守刷新）
  if (cachedToken && Date.now() - cachedTokenAt < 50 * 60 * 1000) {
    return { Authorization: `Bearer ${cachedToken}` };
  }
  const { username, password } = getMpRssConfig();
  const client = buildClient({ 'Content-Type': 'application/x-www-form-urlencoded' });
  const body = new URLSearchParams({ username, password, grant_type: 'password' });
  const res = await client.post('/api/v1/wx/auth/login', body.toString());
  if (res.status >= 400) {
    const err = new Error(`we-mp-rss 登录失败 HTTP ${res.status}`);
    err.status = res.status;
    err.body = res.data;
    throw err;
  }
  const data = unwrapPayload(res.data) || res.data;
  const token = data && (data.access_token || data.token);
  if (!token) {
    const err = new Error('we-mp-rss 登录未返回 access_token');
    err.body = res.data;
    throw err;
  }
  cachedToken = String(token);
  cachedTokenAt = Date.now();
  return { Authorization: `Bearer ${cachedToken}` };
}

function assertApiOk(method, path, res) {
  const data = res && res.data;
  const detail = data && data.detail;
  const bizCode =
    (detail && typeof detail === 'object' && detail.code != null ? Number(detail.code) : null) ??
    (data && data.code != null && data.message !== 'success' ? Number(data.code) : null);
  // we-mp-rss 常把业务失败包在 HTTP 201 + detail.code
  const httpBad = res.status >= 400 || res.status === 201;
  const codeBad = bizCode != null && bizCode !== 0;
  if (httpBad || codeBad) {
    const msg =
      (detail && (detail.message || (typeof detail === 'string' ? detail : ''))) ||
      (data && data.message) ||
      '';
    const err = new Error(
      `we-mp-rss ${method.toUpperCase()} ${path} HTTP ${res.status}${msg ? `: ${String(msg).slice(0, 200)}` : ''}`
    );
    err.status = res.status;
    err.code = bizCode;
    err.body = data;
    throw err;
  }
  return unwrapPayload(data);
}

async function apiRequest(method, path, { params, data, auth = true, timeout } = {}) {
  const headers = auth ? await ensureAuthHeaders() : {};
  const client = buildClient(headers);
  const res = await client.request({
    method,
    url: path,
    params,
    data,
    timeout: timeout || 60000
  });
  if (res.status === 401 && auth && !process.env.MP_RSS_ACCESS_KEY) {
    cachedToken = null;
    const headers2 = await ensureAuthHeaders();
    const res2 = await buildClient(headers2).request({ method, url: path, params, data, timeout });
    return assertApiOk(method, path, res2);
  }
  return assertApiOk(method, path, res);
}

async function probeHealth() {
  const { baseUrl } = getMpRssConfig();
  const client = buildClient();
  const started = Date.now();
  const res = await client.get('/', { responseType: 'text', transformResponse: [(d) => d] });
  return {
    ok: res.status >= 200 && res.status < 500,
    status: res.status,
    baseUrl,
    provider: 'werss',
    latencyMs: Date.now() - started,
    bodySnippet: String(res.data || '').slice(0, 120)
  };
}

async function fetchFeedJson(feedId, { limit = 10, update = false } = {}) {
  const id = String(feedId || '').trim();
  if (!id) throw new Error('feedId required');
  const { baseUrl } = getMpRssConfig();

  if (update) {
    try {
      await refreshMpArticles(id);
    } catch (e) {
      // 更新失败仍尝试读缓存 feed（可能已有历史文）
      console.warn(`[mp-rss] feed update 警告 ${id}: ${e.message}`);
    }
  }

  const client = buildClient();
  const res = await client.get(`/feed/${encodeURIComponent(id)}.json`, {
    params: { limit, is_update: update ? true : undefined }
  });
  if (res.status >= 400) {
    const err = new Error(`we-mp-rss feed.json HTTP ${res.status}`);
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
    articles,
    provider: 'werss'
  };
}

async function fetchAllFeedsJson(limitPerFeed = 5) {
  const { baseUrl } = getMpRssConfig();
  const client = buildClient();
  const res = await client.get('/feed/all.json', { params: { limit: limitPerFeed } });
  if (res.status >= 400) {
    const err = new Error(`we-mp-rss all.json HTTP ${res.status}`);
    err.status = res.status;
    err.body = typeof res.data === 'string' ? res.data.slice(0, 300) : res.data;
    throw err;
  }
  const articles = normalizeArticles(res.data).map((a) => pickArticleFields(a));
  return {
    baseUrl,
    status: res.status,
    count: articles.length,
    articles: articles.slice(0, limitPerFeed * 10),
    provider: 'werss'
  };
}

async function listWeweFeeds(limit = 200) {
  const out = [];
  let offset = 0;
  const pageSize = 100;
  const max = Math.max(1, Number(limit) || 200);
  while (out.length < max) {
    const data = await apiRequest('get', '/api/v1/wx/mps', {
      params: { limit: pageSize, offset }
    });
    const list = (data && data.list) || [];
    for (const mp of list) {
      out.push({
        id: mp.id || mp.mp_id,
        name: mp.mp_name || mp.name,
        mpName: mp.mp_name || mp.name,
        status: mp.status,
        cover: mp.mp_cover
      });
      if (out.length >= max) break;
    }
    if (list.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

async function listWeweAccounts() {
  try {
    const data = await apiRequest('get', '/api/v1/wx/weread');
    if (data && data.configured) {
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      if (accounts.length) {
        return accounts.map((a, i) => ({
          id: a.vid || `werss-${i + 1}`,
          name: a.name || `微信读书账号${i + 1}`,
          status: 1
        }));
      }
      return [{ id: data.vid || 'werss', name: data.name || '微信读书', status: 1 }];
    }
  } catch (_) {
    /* ignore */
  }
  return [];
}

async function hasEnabledWeweAccount() {
  const items = await listWeweAccounts();
  return items.some((a) => Number(a.status) === 1);
}

/**
 * 从文章链接解析公众号 → { id: MP_WXS_*, name, cover, intro, fakerId }
 * 注意：by_article 的 data.id 是**文章** id，公众号在 mp_id / mp_info.biz。
 */
async function getMpInfoByArticleUrl(wxsLink) {
  const url = String(wxsLink || '').trim();
  if (!url.startsWith('https://mp.weixin.qq.com/s/')) {
    throw new Error('sample_article_url 须为 https://mp.weixin.qq.com/s/ 开头的分享链接');
  }
  const info = await apiRequest('post', '/api/v1/wx/mps/by_article', {
    params: { url }
  });
  if (!info || typeof info !== 'object') {
    throw new Error('by_article 未返回公众号信息');
  }

  const mpInfo = info.mp_info && typeof info.mp_info === 'object' ? info.mp_info : {};
  let fakerId = String(mpInfo.biz || info.faker_id || info.biz || '').trim() || null;

  let feedId = String(info.mp_id || info.mpId || (info.feed && info.feed.id) || '').trim();

  // 有 biz（base64 数字）→ MP_WXS_*
  if ((!feedId || !feedId.startsWith('MP_WXS_')) && fakerId) {
    try {
      const decoded = Buffer.from(fakerId, 'base64').toString('utf8');
      if (/^\d+$/.test(decoded)) {
        feedId = `MP_WXS_${decoded}`;
      }
    } catch (_) {
      /* keep */
    }
  }

  // 兼容：若误把 base64 biz 放在其它字段
  if (feedId && !feedId.startsWith('MP_WXS_')) {
    try {
      const decoded = Buffer.from(feedId, 'base64').toString('utf8');
      if (/^\d+$/.test(decoded)) {
        fakerId = fakerId || feedId;
        feedId = `MP_WXS_${decoded}`;
      }
    } catch (_) {
      /* keep */
    }
  }

  if (!fakerId && feedId && feedId.startsWith('MP_WXS_')) {
    const digits = feedId.slice('MP_WXS_'.length);
    if (/^\d+$/.test(digits)) {
      fakerId = Buffer.from(digits, 'utf8').toString('base64');
    }
  }

  const name =
    mpInfo.mp_name || info.mp_name || info.name || info.nick_name || info.author || '';
  const cover = mpInfo.logo || info.mp_cover || info.avatar || info.cover || info.pic_url || '';
  const intro = info.mp_intro || info.intro || '';

  if (!feedId || !feedId.startsWith('MP_WXS_')) {
    throw new Error(
      'by_article 未解析出 MP_WXS_*；请确认文章页含 biz，或在 we-mp-rss 管理页手动订阅后再映射'
    );
  }
  if (!fakerId) {
    throw new Error(`缺少 faker_id/biz，无法向 we-mp-rss 订阅 ${feedId}`);
  }

  return {
    id: feedId,
    name: String(name || feedId),
    cover: String(cover || ''),
    intro: String(intro || ''),
    fakerId,
    raw: info,
    updateTime: Math.floor(Date.now() / 1000)
  };
}

async function ensureWeweFeedSubscribed(mpInfo) {
  const wantId = String(mpInfo.id || '').trim();
  const feeds = await listWeweFeeds(500);
  const exists = feeds.some((f) => f.id === wantId);
  if (exists) {
    return { created: false, feedId: wantId };
  }

  // POST /mps 的 mp_id 必须是 base64(biz 数字)，服务端会生成 id=MP_WXS_{digits}
  let mpIdBody = mpInfo.fakerId;
  if (!mpIdBody && wantId.startsWith('MP_WXS_')) {
    const digits = wantId.slice('MP_WXS_'.length);
    if (/^\d+$/.test(digits)) {
      mpIdBody = Buffer.from(digits, 'utf8').toString('base64');
    }
  }
  if (!mpIdBody) {
    throw new Error(
      `we-mp-rss 尚无订阅 ${wantId}，且缺少 faker_id；请在管理页手动订阅后再映射`
    );
  }

  const created = await apiRequest('post', '/api/v1/wx/mps', {
    data: {
      mp_name: mpInfo.name || wantId,
      mp_id: mpIdBody,
      avatar: mpInfo.cover || '',
      mp_cover: mpInfo.cover || '',
      mp_intro: mpInfo.intro || ''
    }
  });
  const feedId = String((created && created.id) || wantId).trim();
  return { created: true, feedId };
}

async function deleteWeweFeed(feedId) {
  const id = String(feedId || '').trim();
  if (!id) throw new Error('feedId required');
  try {
    await apiRequest('delete', `/api/v1/wx/mps/${encodeURIComponent(id)}`);
    return { deleted: true, feedId: id };
  } catch (e) {
    if (e.status === 404 || /不存在|not found/i.test(e.message)) {
      return { deleted: true, alreadyGone: true, feedId: id };
    }
    throw e;
  }
}

/**
 * weread_mp 模式下 /mps/update 常返回空列表；改走 /weread/collect 增量采集。
 */
async function refreshMpArticles(mpId) {
  const id = String(mpId || '').trim();
  if (!id) throw new Error('mpId required');
  try {
    const collected = await apiRequest('post', '/api/v1/wx/weread/collect', {
      data: {
        mp_id: id,
        faker_id: id,
        mp_name: id,
        max_page: 1,
        gather_content: true
      },
      timeout: 180000
    });
    return { mode: 'weread_collect', ...((collected && typeof collected === 'object') ? collected : {}) };
  } catch (e) {
    // 回退旧更新接口（web/api 采集模式）
    console.warn(`[mp-rss] weread/collect 失败，回退 mps/update: ${e.message}`);
    return apiRequest('get', `/api/v1/wx/mps/update/${encodeURIComponent(id)}`, {
      params: { start_page: 0, end_page: 1 },
      timeout: 180000
    });
  }
}

async function getMpArticles(mpId) {
  const feed = await fetchFeedJson(mpId, { limit: 50, update: false });
  return (feed.articles || []).map((a) => ({
    id: a.weweArticleId || a.link,
    title: a.title,
    url: a.link,
    publishTime: a.publicTime,
    picUrl: null
  }));
}

/** 把 we-mp-rss 内网地址改成新闻站可给浏览器加载的 /we-mp-rss/ 路径 */
function toBrowserMpRssUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^data:image\//i.test(raw)) return raw;
  const { baseUrl } = getMpRssConfig();
  let path = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const baseHost = (() => {
        try {
          return new URL(baseUrl).host;
        } catch (_) {
          return '';
        }
      })();
      // Docker 服务名 / 本机回环 → 走 nginx 反代，手机才能打开图
      if (
        /we-mp-rss/i.test(u.hostname) ||
        u.hostname === '127.0.0.1' ||
        u.hostname === 'localhost' ||
        (baseHost && u.host === baseHost)
      ) {
        path = u.pathname + u.search;
      } else {
        return raw;
      }
    } catch (_) {
      return raw;
    }
  }
  path = path.replace(/^\.\//, '');
  if (!path.startsWith('/')) path = `/${path}`;
  return `/we-mp-rss${path}`;
}

function looksLikeQrImage(url, row = {}) {
  const s = String(url || '');
  if (!s) return false;
  if (/^data:image\//i.test(s)) return true;
  if (row.image || row.qr_image || row.img || row.code_img || row.is_image) return true;
  if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(s)) return true;
  if (/\/(qr|weread).*\/(image|code|img)/i.test(s)) return true;
  if (/\/static\//i.test(s) && /qr|code|weread/i.test(s)) return true;
  return false;
}

/** 微信读书扫码：对齐 wewe createLoginUrl 返回形状 */
async function createLoginUrl() {
  const data = await apiRequest('get', '/api/v1/wx/weread/qr/code');
  const row = data && typeof data === 'object' ? data : {};
  const code =
    row.image ||
    row.qr_image ||
    row.img ||
    row.code_img ||
    row.code ||
    row.code_url ||
    row.scanUrl ||
    row.url ||
    '';
  const uuid = String(row.uid || row.uuid || row.id || `werss-${Date.now()}`);
  const { baseUrl } = getMpRssConfig();
  let scanUrl = String(code || '');
  if (scanUrl && scanUrl.startsWith('/')) {
    scanUrl = `${baseUrl}${scanUrl}`;
  } else if (scanUrl && !/^https?:\/\//i.test(scanUrl) && !/^data:image\//i.test(scanUrl) && scanUrl.includes('static/')) {
    scanUrl = `${baseUrl}/${scanUrl.replace(/^\.\//, '')}`;
  }
  if (!scanUrl) {
    throw new Error(
      'we-mp-rss weread qr 未返回二维码地址。请改用 we-mp-rss 管理页（/we-mp-rss/ 或 :8443）「微信读书」扫码/粘贴 Cookie'
    );
  }
  const isImage = looksLikeQrImage(scanUrl, row);
  // 浏览器展示用公网可访问地址；服务端仍可用原 scanUrl 语义
  const browserUrl = isImage ? toBrowserMpRssUrl(scanUrl) : scanUrl;
  return {
    uuid,
    scanUrl: browserUrl || scanUrl,
    isImage,
    provider: 'werss',
    hint: '推荐直接在 we-mp-rss 管理页完成微信读书登录；本活码页为兼容入口'
  };
}

async function getLoginResult(uuid) {
  const data = await apiRequest('get', '/api/v1/wx/weread/qr/status');
  const row = data && typeof data === 'object' ? data : {};
  const payload = row.data && typeof row.data === 'object' ? row.data : row;
  const status = String(row.status || payload.status || '').toLowerCase();
  const loggedIn =
    row.login_status === true ||
    payload.login_status === true ||
    row.ok === true ||
    payload.ok === true ||
    row.configured === true ||
    status === 'success' ||
    status === 'ok' ||
    status === 'done' ||
    status === 'scanned' ||
    status === 'confirmed' ||
    Boolean(payload.vid || payload.userVid || row.vid);
  if (!loggedIn) {
    return { message: 'waiting', ...row };
  }
  const vid = payload.vid || payload.userVid || row.vid || uuid;
  // Cookie 已由 we-mp-rss 写入；返回占位 token 让 completeLoginFromPoll 走通
  return {
    vid: String(vid),
    token: 'werss-cookie-managed',
    username: payload.name || payload.username || row.name || '微信读书',
    message: 'ok',
    ...row
  };
}

/** we-mp-rss 侧 Cookie 已落盘，无需再 account.add */
async function addWeweAccount() {
  return { ok: true, provider: 'werss', skipped: true };
}

function getWeweConfig() {
  const c = getMpRssConfig();
  return { baseUrl: c.baseUrl, authCode: '' };
}

module.exports = {
  setMpRssBaseUrlOverride,
  setWeweBaseUrlOverride: setMpRssBaseUrlOverride,
  getMpRssConfig,
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
  addWeweAccount
};
