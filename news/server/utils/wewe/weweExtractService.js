/**
 * P3：专队提取（刷新 wewe feed → 按日过滤 → 写入 stage）
 */
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { fetchFeedJson, refreshMpArticles, getMpArticles } = require('./weweClient');
const { getWewePrivateConfig } = require('./wewePrivateTeam');

const SESSION_DEAD_RE = /登录|失效|扫码|未登录|auth|token|session|账号.*(过期|无效)|请重新/i;

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

async function pickNextPendingAccount() {
  const rows = await db.query(
    `SELECT * FROM wewe_private_accounts
     WHERE F_DeleteMark = 0
       AND extract_pending = 1
       AND team_status = 'active'
       AND map_status = 'mapped'
       AND feed_id IS NOT NULL AND feed_id != ''
     ORDER BY last_extract_at IS NULL DESC, last_extract_at ASC, F_CreatorTime ASC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function stageArticle(row) {
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
         F_LastModifyTime = CURRENT_TIMESTAMP`,
      [
        id,
        row.wechatAccountId,
        row.feedId,
        row.weweArticleId || null,
        (row.title || '').slice(0, 500),
        (row.sourceUrl || '').slice(0, 1000),
        row.content || null,
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
             F_LastModifyTime = CURRENT_TIMESTAMP
         WHERE source_url = ? AND extract_ymd = ? AND F_DeleteMark = 0`,
        [
          (row.title || '').slice(0, 500),
          row.content || null,
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
    // 主路径：platform.getMpArticles（新订阅 feeds/*.json 常为空）
    // 注意：先 refresh 再 getMpArticles 易被 wewe 限流成空列表，故不前置 refresh
    let rawList = [];
    try {
      rawList = await getMpArticles(feedId);
    } catch (e) {
      console.warn(`[wewe提取] getMpArticles 失败，回退 feed.json account=${gh}: ${e.message}`);
      if (isSessionDeadError(e)) throw e;
    }

    // 回退 / 补全文：feed.json（含 content_html）。仅当主路径为空时才带 update 刷新
    let feedArticles = [];
    try {
      const needUpdate = updateFeed && rawList.length === 0;
      const feedResult = await fetchFeedJson(feedId, { limit: 30, update: needUpdate });
      feedArticles = feedResult.articles || [];
      if (rawList.length === 0 && feedArticles.length === 0) {
        try {
          await refreshMpArticles(feedId);
          const again = await fetchFeedJson(feedId, { limit: 30, update: false });
          feedArticles = again.articles || [];
        } catch (e2) {
          console.warn(`[wewe提取] refresh+feed 回退警告 account=${gh}: ${e2.message}`);
        }
      }
    } catch (e) {
      console.warn(`[wewe提取] feed.json 失败 account=${gh}: ${e.message}`);
      if (isSessionDeadError(e) && rawList.length === 0) throw e;
    }

    const contentByUrl = new Map();
    for (const a of feedArticles) {
      if (a.link) contentByUrl.set(a.link, a.contentFull || '');
    }

    const candidates = [];
    if (rawList.length > 0) {
      for (const a of rawList) {
        const link = a.url || a.link || '';
        const pub = a.publishTime != null ? a.publishTime : a.publicTime;
        candidates.push({
          weweArticleId: a.id != null ? String(a.id) : null,
          title: a.title || '',
          link,
          publicTime: pub,
          contentFull: contentByUrl.get(link) || ''
        });
      }
    } else {
      for (const a of feedArticles) {
        candidates.push({
          weweArticleId: a.weweArticleId || null,
          title: a.title,
          link: a.link,
          publicTime: a.publicTime,
          contentFull: a.contentFull || ''
        });
      }
    }

    let staged = 0;
    let matched = 0;
    for (const a of candidates) {
      const ymd = toBeijingYmdFromUnknown(a.publicTime);
      if (ymd !== extractYmd) continue;
      matched += 1;
      if (!a.link) continue;
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
      await stageArticle({
        wechatAccountId: gh,
        feedId,
        weweArticleId: a.weweArticleId || null,
        title: a.title,
        sourceUrl: a.link,
        content: a.contentFull || '',
        publicTime: publicTimeStr,
        extractYmd
      });
      staged += 1;
    }

    const status = staged > 0 ? 'success' : 'empty';
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
        `extract_ymd=${extractYmd} staged=${staged} matchedDay=${matched} candidates=${candidates.length}`,
        accountRow.F_Id
      ]
    );

    console.log(
      `[wewe提取] account=${gh} feed=${feedId} ymd=${extractYmd} staged=${staged} matchedDay=${matched} candidates=${candidates.length}`
    );
    return {
      action: 'extracted',
      wechatAccountId: gh,
      feedId,
      extractYmd,
      staged,
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
  pickNextPendingAccount,
  extractOneAccount,
  runExtractTick,
  resumeExtractAfterLogin,
  setExtractPaused,
  getSessionRow
};
