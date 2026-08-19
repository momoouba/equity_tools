/**
 * P3：专队提取（刷新 wewe feed → 按日过滤 → 写入 stage）
 */
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { fetchFeedJson, refreshMpArticles, getMpArticles, htmlToPlainText } = require('./weweClient');
const { getWewePrivateConfig } = require('./wewePrivateTeam');

const SESSION_DEAD_RE = /登录|失效|扫码|未登录|auth|token|session|账号.*(过期|无效)|请重新/i;
const WEWE_DOWN_RE =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|暂无可用读书账号|无可用读书账号/i;

function formatBeijingYmd(date = new Date()) {
  const s = date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const part = s.split(' ')[0];
  const [y, m, d] = part.split(/[\/\-]/).map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toBeijingYmdFromUnknown(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    return formatBeijingYmd(new Date(ms));
  }
  const str = String(value).trim();
  if (/^\d{10,13}$/.test(str)) {
    const n = Number(str);
    const ms = n < 1e12 ? n * 1000 : n;
    return formatBeijingYmd(new Date(ms));
  }
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return formatBeijingYmd(d);
}

function isSessionDeadError(err) {
  const msg = String((err && err.message) || err || '');
  const body = err && err.body ? JSON.stringify(err.body) : '';
  return SESSION_DEAD_RE.test(msg) || SESSION_DEAD_RE.test(body);
}

function isWeweUnavailableError(err) {
  if (!err) return false;
  const msg = String(err.message || err || '');
  const code = String(err.code || '');
  const status = Number(err.status || 0);
  if (WEWE_DOWN_RE.test(msg) || WEWE_DOWN_RE.test(code)) return true;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

const FEED_LIMIT = 50;
const MIN_CN_CHARS = 40;
const MIN_PLAIN_LEN = 120;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function weixinUrlKey(url) {
  const s = String(url || '').trim().split('#')[0];
  if (!s) return '';
  const short = s.match(/mp\.weixin\.qq\.com\/s\/([A-Za-z0-9_-]+)/i);
  if (short) return `s:${short[1]}`;
  try {
    const u = new URL(s);
    const sn = u.searchParams.get('sn');
    const mid = u.searchParams.get('mid');
    const idx = u.searchParams.get('idx');
    if (sn) return `sn:${sn}:${mid || ''}:${idx || ''}`;
  } catch (_) {
    /* ignore */
  }
  return s;
}

function titleKey(title) {
  return String(title || '').replace(/\s+/g, '').slice(0, 80);
}

function toUsableContent(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const text = htmlToPlainText(s, 80000);
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cn >= MIN_CN_CHARS) return text;
  if (!s.includes('<') && text.length >= MIN_PLAIN_LEN) return text;
  return '';
}

function indexFeedContent(feedArticles) {
  const byUrl = new Map();
  const byTitle = new Map();
  for (const a of feedArticles || []) {
    const body = a.contentFull || '';
    if (!String(body).trim()) continue;
    const uk = weixinUrlKey(a.link);
    if (uk) byUrl.set(uk, body);
    if (a.link) byUrl.set(String(a.link).split('#')[0], body);
    const tk = titleKey(a.title);
    if (tk) byTitle.set(tk, body);
  }
  return { byUrl, byTitle };
}

function contentFromIndex(index, link, title) {
  const uk = weixinUrlKey(link);
  return (
    (uk && index.byUrl.get(uk)) ||
    index.byUrl.get(String(link || '').split('#')[0]) ||
    index.byTitle.get(titleKey(title)) ||
    ''
  );
}

function attachFeedContent(candidates, index) {
  return (candidates || []).map((a) => ({
    ...a,
    contentFull: a.contentFull || contentFromIndex(index, a.link, a.title) || ''
  }));
}

async function loadFeedArticles(feedId, { update = false } = {}) {
  const result = await fetchFeedJson(feedId, { limit: FEED_LIMIT, update });
  return result.articles || [];
}

async function getSessionRow() {
  const rows = await db.query(
    `SELECT * FROM wewe_private_session WHERE F_DeleteMark = 0 ORDER BY F_CreatorTime ASC LIMIT 1`
  );
  return rows[0] || null;
}

async function setExtractPaused(paused, note) {
  const row = await getSessionRow();
  if (!row) return;
  await db.execute(
    `UPDATE wewe_private_session
     SET pause_extract = ?,
         session_status = ?,
         note = COALESCE(?, note),
         F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ?`,
    [paused ? 1 : 0, paused ? 'expired' : 'ok', note || null, row.F_Id]
  );
}

async function isExtractPaused() {
  const row = await getSessionRow();
  return Boolean(row && Number(row.pause_extract) === 1);
}

async function isExtractEnabled() {
  const cfg = await getWewePrivateConfig();
  return Boolean(cfg && Number(cfg.wewe_enabled) === 1 && Number(cfg.extract_enabled) === 1);
}

/** 当晚窗口：将所有已映射 active 号标为待提取 */
async function markAllActiveForExtract() {
  const result = await db.execute(
    `UPDATE wewe_private_accounts
     SET extract_pending = 1, F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_DeleteMark = 0
       AND team_status = 'active'
       AND map_status = 'mapped'
       AND feed_id IS NOT NULL
       AND feed_id != ''`
  );
  const n = result?.affectedRows != null ? result.affectedRows : 0;
  console.log(`[wewe提取] 已标记待提取账号数≈${n}`);
  return n;
}

function beijingMinutesNow() {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const hm = String(s).slice(11, 16);
  const [hh, mm] = hm.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return hh * 60 + mm;
}

function extractStartMinutes(cfg) {
  const m = String((cfg && cfg.extract_start) || '21:00').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 21 * 60;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return h * 60 + mi;
}

/**
 * app / wewe 在 extract_start 之后重启：把今天还没 success/partial 的号重新入队。
 * 未到 extract_start 不补，避免凌晨重启把昨天的号再跑一遍。
 */
async function catchUpExtractQueueAfterRestart() {
  const cfg = await getWewePrivateConfig();
  if (!cfg || Number(cfg.wewe_enabled) !== 1 || Number(cfg.extract_enabled) !== 1) {
    return { action: 'skip_disabled', marked: 0 };
  }
  if (beijingMinutesNow() < extractStartMinutes(cfg)) {
    console.log('[wewe提取] 未到 extract_start，跳过重启补队');
    return { action: 'before_start', marked: 0 };
  }
  const ymd = formatBeijingYmd();
  const result = await db.execute(
    `UPDATE wewe_private_accounts
     SET extract_pending = 1, F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_DeleteMark = 0
       AND team_status = 'active'
       AND map_status = 'mapped'
       AND feed_id IS NOT NULL
       AND feed_id != ''
       AND NOT (
         last_extract_status IN ('success', 'partial')
         AND last_extract_at IS NOT NULL
         AND DATE(last_extract_at) = ?
       )`,
    [ymd]
  );
  const n = result?.affectedRows != null ? result.affectedRows : 0;
  console.log(`[wewe提取] 重启补队：今日尚未 success/partial 的账号 ${n} 个重新入队`);
  return { action: 'caught_up', marked: n, extractYmd: ymd };
}

async function keepPendingWeweDown(accountRow, message) {
  await db.execute(
    `UPDATE wewe_private_accounts
     SET last_extract_status = 'wewe_down',
         last_extract_at = NOW(),
         note = ?,
         F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ?`,
    [String(message || 'wewe unavailable').slice(0, 500), accountRow.F_Id]
  );
  console.warn(`[wewe提取] wewe 不可用，保留队列 account=${accountRow.wechat_account_id}: ${message}`);
  return {
    action: 'wewe_unavailable',
    wechatAccountId: accountRow.wechat_account_id,
    error: message
  };
}

async function pickNextPendingAccount() {
  // 有文(success)优先，未知/失败其次，连续 empty 最后；同组按最久未提
  const rows = await db.query(
    `SELECT * FROM wewe_private_accounts
     WHERE F_DeleteMark = 0
       AND extract_pending = 1
       AND team_status = 'active'
       AND map_status = 'mapped'
       AND feed_id IS NOT NULL AND feed_id != ''
     ORDER BY
       CASE last_extract_status
         WHEN 'success' THEN 0
         WHEN 'partial' THEN 1
         WHEN 'empty' THEN 3
         WHEN 'empty_content' THEN 3
         ELSE 2
       END,
       last_extract_at IS NULL DESC,
       last_extract_at ASC,
       F_CreatorTime ASC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function stageArticle(row) {
  const content = String(row.content || '').trim();
  if (!content) {
    return false;
  }
  const id = await generateId('wewe_private_article_stage');
  try {
    await db.execute(
      `INSERT INTO wewe_private_article_stage
       (F_Id, wechat_account_id, feed_id, wewe_article_id, title, source_url, content, public_time, extract_ymd, ingest_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         content = VALUES(content),
         public_time = VALUES(public_time),
         wewe_article_id = COALESCE(VALUES(wewe_article_id), wewe_article_id),
         ingest_status = IF(ingest_status IN ('ingested', 'skipped'), ingest_status, 'pending'),
         ingest_error = NULL,
         F_LastModifyTime = CURRENT_TIMESTAMP`,
      [
        id,
        row.wechatAccountId,
        row.feedId,
        row.weweArticleId || null,
        (row.title || '').slice(0, 500),
        (row.sourceUrl || '').slice(0, 1000),
        content,
        row.publicTime || null,
        row.extractYmd
      ]
    );
    return true;
  } catch (e) {
    // 无 ON DUPLICATE 时唯一冲突
    if (String(e.message || '').includes('Duplicate')) {
      await db.execute(
        `UPDATE wewe_private_article_stage
         SET title = ?, content = ?, public_time = ?, wewe_article_id = COALESCE(?, wewe_article_id),
             ingest_status = IF(ingest_status IN ('ingested', 'skipped'), ingest_status, 'pending'),
             ingest_error = NULL,
             F_LastModifyTime = CURRENT_TIMESTAMP
         WHERE source_url = ? AND extract_ymd = ? AND F_DeleteMark = 0`,
        [
          (row.title || '').slice(0, 500),
          content,
          row.publicTime || null,
          row.weweArticleId || null,
          row.sourceUrl,
          row.extractYmd
        ]
      );
      return true;
    }
    throw e;
  }
}

/**
 * 提取单个已映射账号
 * @param {object} accountRow wewe_private_accounts 行
 * @param {{ extractYmd?: string, updateFeed?: boolean }} options
 */
async function extractOneAccount(accountRow, options = {}) {
  const extractYmd = options.extractYmd || formatBeijingYmd();
  const updateFeed = options.updateFeed !== false;
  const gh = accountRow.wechat_account_id;
  const feedId = accountRow.feed_id;

  if (!feedId) {
    return { action: 'skip_unmapped', wechatAccountId: gh };
  }

  try {
    // 主路径：platform.getMpArticles 拿当日目录（不含正文）
    // 先 refresh 再 getMpArticles 易被 wewe 限流成空列表，故不前置 refresh
    let rawList = [];
    let mpError = null;
    try {
      rawList = await getMpArticles(feedId);
    } catch (e) {
      mpError = e;
      console.warn(`[wewe提取] getMpArticles 失败，回退 feed.json account=${gh}: ${e.message}`);
      if (isSessionDeadError(e)) throw e;
    }

    let feedArticles = [];
    try {
      feedArticles = await loadFeedArticles(feedId, { update: false });
    } catch (e) {
      console.warn(`[wewe提取] feed.json 失败 account=${gh}: ${e.message}`);
      if (isSessionDeadError(e) && rawList.length === 0) throw e;
      if (isWeweUnavailableError(e) && rawList.length === 0) {
        return keepPendingWeweDown(accountRow, e.message);
      }
    }

    if (isWeweUnavailableError(mpError)) {
      return keepPendingWeweDown(accountRow, mpError.message);
    }

    const buildCandidates = (list, feeds, index) => {
      if (list.length > 0) {
        return attachFeedContent(
          list.map((a) => {
            const link = a.url || a.link || '';
            const pub = a.publishTime != null ? a.publishTime : a.publicTime;
            return {
              weweArticleId: a.id != null ? String(a.id) : null,
              title: a.title || '',
              link,
              publicTime: pub,
              contentFull: contentFromIndex(index, link, a.title || '')
            };
          }),
          index
        );
      }
      return (feeds || []).map((a) => ({
        weweArticleId: a.weweArticleId || null,
        title: a.title,
        link: a.link,
        publicTime: a.publicTime,
        contentFull: a.contentFull || ''
      }));
    };

    let index = indexFeedContent(feedArticles);
    let candidates = buildCandidates(rawList, feedArticles, index);

    const dayItems = () =>
      candidates.filter((a) => toBeijingYmdFromUnknown(a.publicTime) === extractYmd);
    const missingContent = () =>
      dayItems().filter((a) => a.link && !toUsableContent(a.contentFull));

    const refreshFeedForContent = async (reason) => {
      if (!updateFeed) return;
      console.log(`[wewe提取] 补全文 ${reason} account=${gh} feed=${feedId}`);
      try {
        await loadFeedArticles(feedId, { update: true });
        await sleep(2000);
        feedArticles = await loadFeedArticles(feedId, { update: false });
        index = indexFeedContent(feedArticles);
        candidates = buildCandidates(rawList, feedArticles, index);
      } catch (e) {
        console.warn(`[wewe提取] feed 刷新失败 account=${gh}: ${e.message}`);
        if (isSessionDeadError(e)) throw e;
      }
      if (missingContent().length === 0) return;
      try {
        await refreshMpArticles(feedId);
        await sleep(2000);
        feedArticles = await loadFeedArticles(feedId, { update: false });
        index = indexFeedContent(feedArticles);
        candidates = buildCandidates(rawList, feedArticles, index);
      } catch (e2) {
        console.warn(`[wewe提取] refreshArticles 回退警告 account=${gh}: ${e2.message}`);
        if (isSessionDeadError(e2)) throw e2;
      }
    };

    const missing = missingContent();
    if (rawList.length === 0 && feedArticles.length === 0) {
      await refreshFeedForContent('目录为空');
    } else if (missing.length > 0) {
      await refreshFeedForContent(`当日缺正文 ${missing.length} 篇`);
    }

    let staged = 0;
    let matched = 0;
    let skippedEmpty = 0;
    for (const a of candidates) {
      const ymd = toBeijingYmdFromUnknown(a.publicTime);
      if (ymd !== extractYmd) continue;
      matched += 1;
      if (!a.link) continue;
      const content = toUsableContent(a.contentFull);
      if (!content) {
        skippedEmpty += 1;
        console.warn(
          `[wewe提取] 跳过空正文 account=${gh} title=${String(a.title || '').slice(0, 40)} url=${a.link}`
        );
        continue;
      }
      let publicTimeStr = null;
      if (typeof a.publicTime === 'number') {
        const ms = a.publicTime < 1e12 ? a.publicTime * 1000 : a.publicTime;
        publicTimeStr = new Date(ms)
          .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
          .replace('T', ' ')
          .slice(0, 19);
      } else if (typeof a.publicTime === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a.publicTime)) {
        publicTimeStr = String(a.publicTime).slice(0, 19).replace('T', ' ');
      }
      const ok = await stageArticle({
        wechatAccountId: gh,
        feedId,
        weweArticleId: a.weweArticleId || null,
        title: a.title,
        sourceUrl: a.link,
        content,
        publicTime: publicTimeStr,
        extractYmd
      });
      if (ok) staged += 1;
      else skippedEmpty += 1;
    }

    let status = 'empty';
    if (staged > 0 && skippedEmpty === 0) status = 'success';
    else if (staged > 0) status = 'partial';
    else if (matched > 0) status = 'empty_content';

    await db.execute(
      `UPDATE wewe_private_accounts
       SET extract_pending = 0,
           last_extract_status = ?,
           last_extract_at = NOW(),
           note = ?,
           F_LastModifyTime = CURRENT_TIMESTAMP
       WHERE F_Id = ?`,
      [
        status,
        `extract_ymd=${extractYmd} staged=${staged} skippedEmpty=${skippedEmpty} matchedDay=${matched} candidates=${candidates.length}`,
        accountRow.F_Id
      ]
    );

    console.log(
      `[wewe提取] account=${gh} feed=${feedId} ymd=${extractYmd} staged=${staged} skippedEmpty=${skippedEmpty} matchedDay=${matched} candidates=${candidates.length}`
    );
    return {
      action: 'extracted',
      wechatAccountId: gh,
      feedId,
      extractYmd,
      staged,
      skippedEmpty,
      matchedDay: matched,
      totalFetched: candidates.length,
      status
    };
  } catch (e) {
    if (isSessionDeadError(e)) {
      await setExtractPaused(true, `会话失效: ${e.message}`.slice(0, 500));
      await db.execute(
        `UPDATE wewe_private_accounts
         SET last_extract_status = 'session_dead',
             last_extract_at = NOW(),
             F_LastModifyTime = CURRENT_TIMESTAMP
         WHERE F_Id = ?`,
        [accountRow.F_Id]
      );
      console.warn(`[wewe提取] 会话失效，整队暂停 account=${gh}: ${e.message}`);
      return { action: 'session_dead', wechatAccountId: gh, error: e.message };
    }

    if (isWeweUnavailableError(e)) {
      return keepPendingWeweDown(accountRow, e.message);
    }

    await db.execute(
      `UPDATE wewe_private_accounts
       SET extract_pending = 0,
           last_extract_status = 'failed',
           last_extract_at = NOW(),
           note = ?,
           F_LastModifyTime = CURRENT_TIMESTAMP
       WHERE F_Id = ?`,
      [String(e.message || 'extract failed').slice(0, 500), accountRow.F_Id]
    );
    console.warn(`[wewe提取] 失败 account=${gh}: ${e.message}`);
    return { action: 'failed', wechatAccountId: gh, error: e.message };
  }
}

/** 调度 tick：取 1 个待提取号 */
async function runExtractTick(options = {}) {
  if (!(await isExtractEnabled()) && !options.force) {
    return { action: 'skip_disabled' };
  }
  if (await isExtractPaused()) {
    return { action: 'skip_paused' };
  }
  const account = await pickNextPendingAccount();
  if (!account) {
    return { action: 'idle_empty_queue' };
  }
  return extractOneAccount(account, options);
}

async function resumeExtractAfterLogin() {
  await setExtractPaused(false, '扫码恢复，继续补提');
  // 将 failed/session_dead 且仍 active 的重新入队待提取
  await db.execute(
    `UPDATE wewe_private_accounts
     SET extract_pending = 1, F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_DeleteMark = 0
       AND team_status = 'active'
       AND map_status = 'mapped'
       AND (extract_pending = 1 OR last_extract_status IN ('session_dead', 'failed') OR last_extract_at IS NULL)`
  );
  console.log('[wewe提取] 已恢复提取，待补提队列已刷新');
  return { action: 'resumed' };
}

module.exports = {
  formatBeijingYmd,
  toBeijingYmdFromUnknown,
  isSessionDeadError,
  isExtractPaused,
  isExtractEnabled,
  markAllActiveForExtract,
  catchUpExtractQueueAfterRestart,
  pickNextPendingAccount,
  extractOneAccount,
  runExtractTick,
  resumeExtractAfterLogin,
  setExtractPaused,
  getSessionRow
};
