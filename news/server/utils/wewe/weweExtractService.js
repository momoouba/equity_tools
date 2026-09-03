/**
 * P3：专队提取（刷新 wewe feed → 按日过滤 → 写入 stage）
 */
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { fetchFeedJson, getMpArticles, htmlToPlainText } = require('./weweClient');
const { getWewePrivateConfig } = require('./wewePrivateTeam');
const {
  isSessionDeadError,
  isWeweUnavailableError,
  isSessionTtlExpired
} = require('./weweExtractErrors');

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

function formatBeijingDateTime(date = new Date()) {
  return date
    .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
    .replace('T', ' ')
    .slice(0, 19);
}

function extractKindLabel(kind) {
  if (kind === 'evening') return '当晚';
  if (kind === 'catchup') return '隔日补抓';
  if (kind === 'manual') return '手工';
  return kind || '-';
}

function formatAccountLabel(gh, name) {
  const id = String(gh || '').trim() || '-';
  const n = String(name || '').trim();
  return n ? `${n}(${id})` : id;
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

/** 目录用不含全文的 json，避免 200 篇 HTML 撑爆；正文再按标题小批量拉 */
const CATALOG_LIMIT = 80;
const FULLTEXT_LIMIT = 8;
const MIN_CN_CHARS = 40;
const MIN_PLAIN_LEN = 120;
/** 当晚提取不收当天此时刻及之后的稿，留给次日隔日补抓 */
const LATE_PUBLISH_MINUTES = 21 * 60;
const DEFAULT_CATCHUP_START_MINUTES = 6 * 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function weixinUrlKey(url) {
  const keys = weixinUrlKeys(url);
  return keys[0] || '';
}

function weixinUrlKeys(url) {
  const s = String(url || '').trim().split('#')[0];
  const keys = [];
  if (!s) return keys;
  const short = s.match(/mp\.weixin\.qq\.com\/s\/([A-Za-z0-9_-]+)/i);
  if (short) keys.push(`s:${short[1]}`);
  try {
    const u = new URL(s);
    const sn = u.searchParams.get('sn');
    const mid = u.searchParams.get('mid');
    const idx = u.searchParams.get('idx');
    if (sn) {
      keys.push(`sn:${sn}:${mid || ''}:${idx || ''}`);
      keys.push(`s:${sn}`);
    }
  } catch (_) {
    /* ignore */
  }
  keys.push(s);
  return [...new Set(keys)];
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
  const picked = (s.match(/[\u4e00-\u9fff0-9A-Za-z，。；：、！？“”‘’（）\s]{20,}/g) || [])
    .filter((chunk) => (chunk.match(/[\u4e00-\u9fff]/g) || []).length >= 8)
    .join('');
  const pickedCn = (picked.match(/[\u4e00-\u9fff]/g) || []).length;
  if (pickedCn >= MIN_CN_CHARS) return picked.replace(/\s+/g, ' ').trim().slice(0, 80000);
  return '';
}

function indexFeedContent(feedArticles) {
  const byUrl = new Map();
  const byTitle = new Map();
  for (const a of feedArticles || []) {
    const body = a.contentFull || '';
    if (!String(body).trim()) continue;
    for (const uk of weixinUrlKeys(a.link)) {
      byUrl.set(uk, body);
    }
    if (a.link) byUrl.set(String(a.link).split('#')[0], body);
    const tk = titleKey(a.title);
    if (tk) byTitle.set(tk, body);
  }
  return { byUrl, byTitle };
}

function contentFromIndex(index, link, title) {
  for (const uk of weixinUrlKeys(link)) {
    const hit = index.byUrl.get(uk);
    if (hit) return hit;
  }
  return (
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

async function loadFeedArticles(feedId, { update = false, titleInclude = '', mode = 'fulltext', limit } = {}) {
  const n = Number(limit) > 0 ? Number(limit) : mode === 'fulltext' ? FULLTEXT_LIMIT : CATALOG_LIMIT;
  const result = await fetchFeedJson(feedId, { limit: n, update, titleInclude, mode });
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

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + days);
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

function beijingMinutesAt(date = new Date()) {
  const s = date.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const hm = String(s).slice(11, 16);
  const [hh, mm] = hm.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return hh * 60 + mm;
}

function beijingMinutesNow() {
  return beijingMinutesAt(new Date());
}

function parseHmToMinutes(hm, fallbackMinutes) {
  const m = String(hm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallbackMinutes;
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mi = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return h * 60 + mi;
}

function extractStartMinutes(cfg) {
  return parseHmToMinutes((cfg && cfg.extract_start) || '21:00', 21 * 60);
}

function catchupStartMinutes(cfg) {
  return parseHmToMinutes(
    (cfg && cfg.catchup_extract_start) || '06:00',
    DEFAULT_CATCHUP_START_MINUTES
  );
}

function beijingMinutesFromUnknown(value) {
  if (value == null || value === '') return 0;
  let date = null;
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    date = new Date(ms);
  } else {
    const str = String(value).trim();
    if (/^\d{10,13}$/.test(str)) {
      const n = Number(str);
      const ms = n < 1e12 ? n * 1000 : n;
      date = new Date(ms);
    } else {
      date = new Date(str);
    }
  }
  if (!date || Number.isNaN(date.getTime())) return 0;
  return beijingMinutesAt(date);
}

/**
 * 当晚 extract_start 之后：抓今天、跳过 21:00 及以后。
 * 隔日补抓 catchup_extract_start～extract_start：抓昨天（含 21:00 后，并补漏当晚已扫过的号）。
 * 0 点到隔日补抓开始：不跑，避免 ymd 滚到新一天。
 */
function resolveExtractWindow(cfg, now = new Date()) {
  const today = formatBeijingYmd(now);
  const yesterday = addDaysYmd(today, -1);
  const nowMin = beijingMinutesAt(now);
  const extractStart = extractStartMinutes(cfg);
  const catchupStart = catchupStartMinutes(cfg);
  if (nowMin >= extractStart) {
    return { kind: 'evening', extractYmd: today, skipLate: true };
  }
  if (nowMin >= catchupStart) {
    return { kind: 'catchup', extractYmd: yesterday, skipLate: false };
  }
  return { kind: 'idle', extractYmd: null, skipLate: false };
}

function mappedActivePendingSql() {
  return `F_DeleteMark = 0
       AND team_status = 'active'
       AND map_status = 'mapped'
       AND feed_id IS NOT NULL
       AND feed_id != ''`;
}

/**
 * 当前窗口进度：已完成 + 仍 pending（含正在抓的这个）。
 * 第 index/total 个。
 */
async function getExtractProgress(kind) {
  const today = formatBeijingYmd();
  const rows = await db.query(
    `SELECT
       SUM(CASE WHEN extract_pending = 1 THEN 1 ELSE 0 END) AS pending,
       SUM(CASE
             WHEN extract_pending = 0
              AND last_extract_kind = ?
              AND last_extract_at IS NOT NULL
              AND DATE(last_extract_at) = ?
             THEN 1 ELSE 0 END) AS done
     FROM wewe_private_accounts
     WHERE ${mappedActivePendingSql()}`,
    [kind || '', today]
  );
  const pending = Number(rows[0]?.pending || 0);
  const done = Number(rows[0]?.done || 0);
  return {
    index: done + 1,
    total: done + pending,
    pending,
    done
  };
}

async function resolveAccountDisplayName(wechatAccountId) {
  const gh = String(wechatAccountId || '').trim();
  if (!gh) return '';
  try {
    const ad = await db.query(
      `SELECT account_name FROM additional_wechat_accounts
       WHERE F_DeleteMark = 0 AND wechat_account_id = ? LIMIT 1`,
      [gh]
    );
    if (ad[0] && ad[0].account_name) return String(ad[0].account_name);
  } catch (_) {
    /* ignore */
  }
  try {
    const { IE_NEWS_APP_FILTER_SQL } = require('../investedEnterpriseNewsAppSql');
    const ie = await db.query(
      `SELECT project_abbreviation, enterprise_full_name
       FROM invested_enterprises
       WHERE ${IE_NEWS_APP_FILTER_SQL} AND F_DeleteMark = 0
         AND (wechat_official_account_id = ?
           OR wechat_official_account_id LIKE ?
           OR wechat_official_account_id LIKE ?
           OR wechat_official_account_id LIKE ?)
       LIMIT 1`,
      [gh, `${gh},%`, `%,${gh},%`, `%,${gh}`]
    );
    if (ie[0]) {
      return String(ie[0].project_abbreviation || ie[0].enterprise_full_name || '');
    }
  } catch (_) {
    /* ignore */
  }
  try {
    const nd = await db.query(
      `SELECT account_name FROM news_detail
       WHERE F_DeleteMark = 0 AND wechat_account = ?
         AND account_name IS NOT NULL AND account_name != ''
       ORDER BY F_CreatorTime DESC LIMIT 1`,
      [gh]
    );
    if (nd[0] && nd[0].account_name) return String(nd[0].account_name);
  } catch (_) {
    /* ignore */
  }
  return '';
}

/**
 * app / wewe 重启：按当前窗口补队。
 * 隔日补抓窗口：今晚 success 的号也要再入队（21:00 后稿）。
 * 未到隔日补抓开始不补，避免凌晨把昨天队列用「今天」ymd 再跑一遍。
 */
async function catchUpExtractQueueAfterRestart() {
  const cfg = await getWewePrivateConfig();
  if (!cfg || Number(cfg.wewe_enabled) !== 1 || Number(cfg.extract_enabled) !== 1) {
    return { action: 'skip_disabled', marked: 0 };
  }
  const window = resolveExtractWindow(cfg);
  if (window.kind === 'idle') {
    console.log('[wewe提取] 未到隔日补抓/当晚提取，跳过重启补队');
    return { action: 'before_start', marked: 0 };
  }
  const today = formatBeijingYmd();
  const kind = window.kind;
  const doneStatuses =
    kind === 'catchup'
      ? "('success', 'partial', 'empty', 'empty_content')"
      : "('success', 'partial')";
  const result = await db.execute(
    `UPDATE wewe_private_accounts
     SET extract_pending = 1, F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE ${mappedActivePendingSql()}
       AND NOT (
         last_extract_kind = ?
         AND last_extract_status IN ${doneStatuses}
         AND last_extract_at IS NOT NULL
         AND DATE(last_extract_at) = ?
       )`,
    [kind, today]
  );
  const n = result?.affectedRows != null ? result.affectedRows : 0;
  console.log(
    `[wewe提取] 重启补队：${kind} 窗口尚未完成的账号 ${n} 个重新入队 ymd=${window.extractYmd}`
  );
  return { action: 'caught_up', marked: n, extractYmd: window.extractYmd, extractKind: kind };
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
 * @param {{ extractYmd?: string, updateFeed?: boolean, extractKind?: string, skipLate?: boolean, progress?: object, accountName?: string }} options
 */
async function extractOneAccount(accountRow, options = {}) {
  const extractYmd = options.extractYmd || formatBeijingYmd();
  const updateFeed = options.updateFeed !== false;
  const extractKind = options.extractKind || 'manual';
  const skipLate = options.skipLate === true;
  const gh = accountRow.wechat_account_id;
  const feedId = accountRow.feed_id;
  const startedAt = Date.now();
  const progress = options.progress || (await getExtractProgress(extractKind));
  const accountName =
    options.accountName != null
      ? options.accountName
      : await resolveAccountDisplayName(gh);
  const accountLabel = formatAccountLabel(gh, accountName);
  const seq =
    progress && progress.total > 0
      ? `第${progress.index}/${progress.total}个`
      : '第?/??个';
  const windowLabel = extractKindLabel(extractKind);

  const logPrefix = () =>
    `[wewe提取] ${formatBeijingDateTime()} ${seq} 公众号=${accountLabel} 窗口=${windowLabel}`;

  console.log(
    `${logPrefix()} 开始抓取 业务日=${extractYmd} 剩余待抓=${Number(progress.pending || 0)}`
  );

  if (!feedId) {
    console.warn(`${logPrefix()} 跳过：未映射 feed`);
    return { action: 'skip_unmapped', wechatAccountId: gh };
  }

  try {
    // 先读 sqlite 目录（mode=- 无 HTML）。getMpArticles 易被限流成 0，不能当唯一目录。
    let rawList = [];
    let mpError = null;
    let feedArticles = [];
    try {
      feedArticles = await loadFeedArticles(feedId, {
        update: false,
        mode: 'text',
        limit: CATALOG_LIMIT
      });
    } catch (e) {
      console.warn(`[wewe提取] 目录 feed.json 失败 account=${gh}: ${e.message}`);
      if (isSessionDeadError(e)) throw e;
      if (isWeweUnavailableError(e)) {
        return keepPendingWeweDown(accountRow, e.message);
      }
    }

    if (feedArticles.length === 0) {
      try {
        rawList = await getMpArticles(feedId);
      } catch (e) {
        mpError = e;
        console.warn(`[wewe提取] getMpArticles 失败 account=${gh}: ${e.message}`);
        if (isSessionDeadError(e)) throw e;
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
      return (feeds || []).map((a) => {
        let link = a.link || '';
        if (!link && a.weweArticleId && !String(a.weweArticleId).startsWith('MP_WXS')) {
          link = `https://mp.weixin.qq.com/s/${a.weweArticleId}`;
        }
        return {
          weweArticleId: a.weweArticleId || null,
          title: a.title,
          link,
          publicTime: a.publicTime,
          contentFull: a.contentFull || contentFromIndex(index, link, a.title) || ''
        };
      });
    };

    let index = indexFeedContent(feedArticles);
    let candidates = buildCandidates(rawList, feedArticles, index);
    const catalogSnapshot = candidates.slice();

    const isTargetDayArticle = (a) => {
      if (toBeijingYmdFromUnknown(a.publicTime) !== extractYmd) return false;
      if (skipLate && beijingMinutesFromUnknown(a.publicTime) >= LATE_PUBLISH_MINUTES) return false;
      return true;
    };
    const dayItems = () => candidates.filter(isTargetDayArticle);
    const missingContent = () =>
      dayItems().filter((a) => a.link && !toUsableContent(a.contentFull));

    const titleIncludeFromMissing = () =>
      missingContent()
        .map((a) => String(a.title || '').trim())
        .filter(Boolean)
        .slice(0, 8)
        .join('|')
        .slice(0, 400);

    const mergeFulltext = (fulltextList) => {
      index = indexFeedContent(fulltextList);
      candidates = attachFeedContent(catalogSnapshot.length ? catalogSnapshot : candidates, index);
    };

    const refreshFeedForContent = async (reason) => {
      const titleInclude = titleIncludeFromMissing();
      console.log(
        `[wewe提取] 补全文 ${reason} account=${gh} feed=${feedId} titles=${titleInclude} catalog=${feedArticles.length} mpList=${rawList.length}`
      );
      try {
        const fulltextList = await loadFeedArticles(feedId, {
          update: false,
          titleInclude,
          mode: 'fulltext',
          limit: 30
        });
        mergeFulltext(fulltextList);
      } catch (e) {
        console.warn(`[wewe提取] 全文 json 失败 account=${gh}: ${e.message}`);
        if (isSessionDeadError(e)) throw e;
        try {
          const fulltextList = await loadFeedArticles(feedId, {
            update: false,
            titleInclude,
            mode: 'fulltext',
            limit: FULLTEXT_LIMIT
          });
          mergeFulltext(fulltextList);
        } catch (e2) {
          console.warn(`[wewe提取] 全文 json 降级失败 account=${gh}: ${e2.message}`);
          if (isSessionDeadError(e2)) throw e2;
        }
      }
      if (!updateFeed || missingContent().length === 0) return;
      try {
        await loadFeedArticles(feedId, {
          update: true,
          titleInclude,
          mode: 'fulltext',
          limit: FULLTEXT_LIMIT
        });
        await sleep(3000);
        const fulltextList = await loadFeedArticles(feedId, {
          update: false,
          titleInclude,
          mode: 'fulltext',
          limit: FULLTEXT_LIMIT
        });
        mergeFulltext(fulltextList);
      } catch (e) {
        console.warn(`[wewe提取] feed 刷新失败 account=${gh}: ${e.message}`);
        if (isSessionDeadError(e)) throw e;
      }
    };

    const missing = missingContent();
    if (rawList.length === 0 && feedArticles.length === 0) {
      await refreshFeedForContent('目录为空');
    } else if (missing.length > 0) {
      await refreshFeedForContent(`当日缺正文 ${missing.length} 篇`);
    } else if (dayItems().length === 0 && feedArticles.length > 0) {
      console.warn(
        `${logPrefix()} 目录${feedArticles.length}篇均未匹配业务日=${extractYmd} 样例日期=${toBeijingYmdFromUnknown(
          feedArticles[0] && feedArticles[0].publicTime
        )} 样例标题=${String((feedArticles[0] && feedArticles[0].title) || '').slice(0, 30)}`
      );
    }

    let staged = 0;
    let matched = 0;
    let skippedEmpty = 0;
    let deferredLate = 0;
    const stagedTitles = [];
    const skippedEmptyItems = [];
    for (const a of candidates) {
      const ymd = toBeijingYmdFromUnknown(a.publicTime);
      if (ymd !== extractYmd) continue;
      if (skipLate && beijingMinutesFromUnknown(a.publicTime) >= LATE_PUBLISH_MINUTES) {
        deferredLate += 1;
        continue;
      }
      matched += 1;
      if (!a.link) {
        skippedEmpty += 1;
        skippedEmptyItems.push({
          title: String(a.title || '').slice(0, 80),
          url: '',
          contentLen: 0,
          reason: 'no_link'
        });
        console.warn(
          `[wewe提取] 跳过无链接 account=${gh} title=${String(a.title || '').slice(0, 40)}`
        );
        continue;
      }
      let content = toUsableContent(a.contentFull);
      if (!content && a.link) {
        const placeholder = [
          String(a.title || '').trim(),
          `原文链接：${a.link}`,
          '（公众号原文未解析出足够正文，已保留标题与链接，请打开原文阅读。）'
        ].join('\n\n');
        content = toUsableContent(placeholder);
        if (content) {
          console.warn(
            `[wewe提取] 空正文改用标题占位 account=${gh} title=${String(a.title || '').slice(0, 40)}`
          );
        }
      }
      if (!content) {
        skippedEmpty += 1;
        const rawLen = String(a.contentFull || '').length;
        skippedEmptyItems.push({
          title: String(a.title || '').slice(0, 80),
          url: a.link,
          contentLen: rawLen
        });
        console.warn(
          `[wewe提取] 跳过空正文 account=${gh} title=${String(a.title || '').slice(0, 40)} url=${a.link} contentLen=${rawLen}`
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
      if (ok) {
        staged += 1;
        const t = String(a.title || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (t) stagedTitles.push(t);
      } else {
        skippedEmpty += 1;
      }
    }

    let status = 'empty';
    if (staged > 0 && skippedEmpty === 0) status = 'success';
    else if (staged > 0) status = 'partial';
    else if (matched > 0) status = 'empty_content';

    await db.execute(
      `UPDATE wewe_private_accounts
       SET extract_pending = 0,
           last_extract_status = ?,
           last_extract_kind = ?,
           last_extract_at = NOW(),
           note = ?,
           F_LastModifyTime = CURRENT_TIMESTAMP
       WHERE F_Id = ?`,
      [
        status,
        extractKind,
        `kind=${extractKind} extract_ymd=${extractYmd} staged=${staged} skippedEmpty=${skippedEmpty} matchedDay=${matched} deferredLate=${deferredLate} candidates=${candidates.length}`,
        accountRow.F_Id
      ]
    );

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    const titlePart = stagedTitles.length
      ? ` 标题=${stagedTitles.join('；')}`
      : '';
    console.log(
      `${logPrefix()} 完成抓取 业务日=${extractYmd} 暂存入库=${staged}篇 当日匹配=${matched} 空正文=${skippedEmpty} 延后21点后=${deferredLate} 目录=${candidates.length} 状态=${status} 用时=${elapsedSec}s${titlePart}`
    );
    return {
      action: 'extracted',
      wechatAccountId: gh,
      accountName: accountName || '',
      feedId,
      extractYmd,
      extractKind,
      seqIndex: progress.index,
      seqTotal: progress.total,
      staged,
      skippedEmpty,
      matchedDay: matched,
      deferredLate,
      totalFetched: candidates.length,
      skippedEmptyItems,
      status,
      elapsedSec: Number(elapsedSec)
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
      console.warn(`${logPrefix()} 会话失效，整队暂停: ${e.message}`);
      return { action: 'session_dead', wechatAccountId: gh, error: e.message };
    }

    if (isWeweUnavailableError(e)) {
      return keepPendingWeweDown(accountRow, e.message);
    }

    await db.execute(
      `UPDATE wewe_private_accounts
       SET extract_pending = 0,
           last_extract_status = 'failed',
           last_extract_kind = ?,
           last_extract_at = NOW(),
           note = ?,
           F_LastModifyTime = CURRENT_TIMESTAMP
       WHERE F_Id = ?`,
      [extractKind, String(e.message || 'extract failed').slice(0, 500), accountRow.F_Id]
    );
    console.warn(`${logPrefix()} 失败: ${e.message}`);
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
  const cfg = await getWewePrivateConfig();
  const session = await getSessionRow();
  if (isSessionTtlExpired(session, cfg || {})) {
    await setExtractPaused(true, '会话已过期，暂停提取');
    console.warn('[wewe提取] 会话已过期但 pause_extract=0，已暂停提取，请扫码恢复');
    return { action: 'session_dead', error: 'session_ttl_expired' };
  }
  const window = options.extractYmd
    ? {
        kind: options.extractKind || 'manual',
        extractYmd: options.extractYmd,
        skipLate: options.skipLate === true
      }
    : resolveExtractWindow(cfg);
  if (window.kind === 'idle') {
    return { action: 'skip_idle_window' };
  }
  const account = await pickNextPendingAccount();
  if (!account) {
    return {
      action: 'idle_empty_queue',
      extractKind: window.kind,
      extractYmd: window.extractYmd
    };
  }
  const progress = await getExtractProgress(window.kind);
  const accountName = await resolveAccountDisplayName(account.wechat_account_id);
  return extractOneAccount(account, {
    ...options,
    extractYmd: window.extractYmd,
    extractKind: window.kind,
    skipLate: window.skipLate,
    progress,
    accountName
  });
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
  LATE_PUBLISH_MINUTES,
  formatBeijingYmd,
  formatBeijingDateTime,
  toBeijingYmdFromUnknown,
  parseHmToMinutes,
  resolveExtractWindow,
  isSessionDeadError,
  isWeweUnavailableError,
  isSessionTtlExpired,
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
