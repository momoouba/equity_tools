/**
 * wewe 私有公众号专队：入队 / 出队 / 开关（P1）
 * 专队名单来源：新闻舆情监控对象（有企业公众号 id）+ 第三方/额外公众号；
 * 不再由新榜「数据不存在」自动入队、成功自动出队。
 */
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { IE_NEWS_APP_FILTER_SQL } = require('../investedEnterpriseNewsAppSql');

const DATA_MISSING_RE = /数据不存在|不存在|无数据|没有数据/;

function isDataMissingError(typeOrMessage) {
  const s = String(typeOrMessage || '');
  if (!s) return false;
  if (s === '数据不存在' || s.includes('404')) return true;
  return DATA_MISSING_RE.test(s);
}

function splitWechatAccountIds(raw) {
  if (raw == null) return [];
  return String(raw)
    .split(/[,，;\s]+/)
    .map((id) => id.trim())
    .filter((id) => id && id !== '');
}

async function getWewePrivateConfig() {
  const rows = await db.query(
    `SELECT * FROM wewe_private_config WHERE F_DeleteMark = 0 ORDER BY F_CreatorTime ASC LIMIT 1`
  );
  return rows[0] || null;
}

/** 入队是否启用：总开关 + 入队开关（默认均关，避免上线即灌专队） */
async function isEnqueueEnabled() {
  const cfg = await getWewePrivateConfig();
  if (!cfg) return false;
  return Number(cfg.wewe_enabled) === 1 && Number(cfg.enqueue_enabled) === 1;
}

async function resolveSourceType(wechatAccountId) {
  const gh = String(wechatAccountId || '').trim();
  if (!gh) return 'unknown';
  let invested = false;
  let additional = false;
  try {
    const ie = await db.query(
      `SELECT F_Id FROM invested_enterprises
       WHERE ${IE_NEWS_APP_FILTER_SQL} AND F_DeleteMark = 0
         AND COALESCE(exit_status, '') NOT IN ('完全退出', '不再观察')
         AND (wechat_official_account_id = ?
           OR wechat_official_account_id LIKE ?
           OR wechat_official_account_id LIKE ?
           OR wechat_official_account_id LIKE ?)
       LIMIT 1`,
      [gh, `${gh},%`, `%,${gh},%`, `%,${gh}`]
    );
    invested = ie.length > 0;
  } catch (_) {
    /* ignore */
  }
  try {
    const ad = await db.query(
      `SELECT F_Id FROM additional_wechat_accounts
       WHERE F_DeleteMark = 0 AND status = 'active' AND wechat_account_id = ?
       LIMIT 1`,
      [gh]
    );
    additional = ad.length > 0;
  } catch (_) {
    /* ignore */
  }
  if (invested && additional) return 'both';
  if (invested) return 'invested';
  if (additional) return 'additional';
  return 'unknown';
}

/**
 * 新榜「数据不存在」等 → 入专队（去重）
 * @returns {{ action: string, account?: object }}
 */
async function enqueueFromXinbangError(wechatAccountId, errorMeta = {}) {
  const gh = String(wechatAccountId || '').trim();
  if (!gh) return { action: 'skip_empty' };

  try {
    if (!(await isEnqueueEnabled())) {
      return { action: 'skip_disabled' };
    }

    const type = errorMeta.type || '';
    const message = errorMeta.message || '';
    if (!isDataMissingError(type) && !isDataMissingError(message)) {
      return { action: 'skip_not_data_missing' };
    }

    const existing = await db.query(
      `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [gh]
    );

    const sourceType = await resolveSourceType(gh);
    const errText = String(message || type || '').slice(0, 500);

    if (existing.length > 0) {
      const row = existing[0];
      if (Number(row.enqueue_blocked) === 1) {
        console.log(`[wewe专队] 跳过入队（人工禁止重新入队） account=${gh} status=${row.team_status}`);
        return { action: 'skip_enqueue_blocked', account: row };
      }
      if (row.team_status === 'active' || row.team_status === 'pending_subscribe') {
        await db.execute(
          `UPDATE wewe_private_accounts
           SET last_xinbang_error = ?, source_type = COALESCE(NULLIF(source_type,''), ?),
               F_LastModifyTime = CURRENT_TIMESTAMP
           WHERE F_Id = ?`,
          [errText, sourceType, row.F_Id]
        );
        console.log(`[wewe专队] 已在队，刷新错误 account=${gh} status=${row.team_status}`);
        return { action: 'already_in_team', account: row };
      }
      // exited / disabled → 重新入队
      await db.execute(
        `UPDATE wewe_private_accounts
         SET team_status = 'pending_subscribe',
             map_status = CASE WHEN feed_id IS NOT NULL AND feed_id != '' THEN 'mapped' ELSE 'pending_subscribe' END,
             source_type = ?,
             last_xinbang_error = ?,
             last_enqueued_at = NOW(),
             last_exited_at = NULL,
             F_LastModifyTime = CURRENT_TIMESTAMP
         WHERE F_Id = ?`,
        [sourceType, errText, row.F_Id]
      );
      console.log(`[wewe专队] 重新入队 account=${gh}`);
      // 异步尝试映射，不阻塞新榜
      setImmediate(() => {
        try {
          const { tryAutoMapAfterEnqueue } = require('./weweFeedMap');
          tryAutoMapAfterEnqueue(gh).catch((e) =>
            console.warn(`[wewe映射] 入队后自动映射失败 account=${gh}: ${e.message}`)
          );
        } catch (e) {
          console.warn(`[wewe映射] 加载失败: ${e.message}`);
        }
      });
      return { action: 're_enqueued', accountId: row.F_Id };
    }

    const id = await generateId('wewe_private_accounts');
    await db.execute(
      `INSERT INTO wewe_private_accounts
       (F_Id, wechat_account_id, source_type, team_status, map_status, feed_id, sample_article_url,
        last_xinbang_error, last_enqueued_at)
       VALUES (?, ?, ?, 'pending_subscribe', 'pending_subscribe', NULL, NULL, ?, NOW())`,
      [id, gh, sourceType, errText]
    );
    console.log(`[wewe专队] 入队 account=${gh} source=${sourceType}`);
    setImmediate(() => {
      try {
        const { tryAutoMapAfterEnqueue } = require('./weweFeedMap');
        tryAutoMapAfterEnqueue(gh).catch((e) =>
          console.warn(`[wewe映射] 入队后自动映射失败 account=${gh}: ${e.message}`)
        );
      } catch (e) {
        console.warn(`[wewe映射] 加载失败: ${e.message}`);
      }
    });
    return { action: 'enqueued', accountId: id };
  } catch (e) {
    console.warn(`[wewe专队] 入队失败 account=${gh}: ${e.message}`);
    return { action: 'error', error: e.message };
  }
}

/**
 * 新榜对该号同步成功（有文，或明确空成功且非数据不存在）→ 出队
 */
async function dequeueOnXinbangSuccess(wechatAccountId, meta = {}) {
  const gh = String(wechatAccountId || '').trim();
  if (!gh) return { action: 'skip_empty' };

  try {
    const cfg = await getWewePrivateConfig();
    // 出队不要求 extract 开：只要总开关开（或已有队员）就允许出队，避免关开关后队员卡死
    // 若从未启用过，表中可能无队员，查询即可

    const existing = await db.query(
      `SELECT * FROM wewe_private_accounts
       WHERE wechat_account_id = ? AND F_DeleteMark = 0
         AND team_status IN ('active', 'pending_subscribe')
       LIMIT 1`,
      [gh]
    );
    if (existing.length === 0) {
      return { action: 'not_in_team' };
    }

    const reason = String(meta.reason || 'xinbang_ok').slice(0, 200);
    await db.execute(
      `UPDATE wewe_private_accounts
       SET team_status = 'exited',
           last_exited_at = NOW(),
           last_xinbang_error = NULL,
           extract_pending = 0,
           F_LastModifyTime = CURRENT_TIMESTAMP
       WHERE F_Id = ?`,
      [existing[0].F_Id]
    );
    console.log(`[wewe专队] 出队 account=${gh} reason=${reason} wewe_enabled=${cfg ? cfg.wewe_enabled : 'n/a'}`);
    return { action: 'dequeued', accountId: existing[0].F_Id };
  } catch (e) {
    console.warn(`[wewe专队] 出队失败 account=${gh}: ${e.message}`);
    return { action: 'error', error: e.message };
  }
}

/**
 * 手动出队 + 从 wewe-rss 删除订阅源。
 * 新闻库 wewe_private_accounts 只改 team_status=exited，不软删（F_DeleteMark 仍为 0）。
 */
async function unsubscribeFromWewe(wechatAccountId) {
  const gh = String(wechatAccountId || '').trim();
  if (!gh) return { action: 'skip_empty' };

  const existing = await db.query(
    `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [gh]
  );
  if (existing.length === 0) {
    return { action: 'not_found' };
  }
  const row = existing[0];
  const feedId = String(row.feed_id || '').trim();
  let wewe = { skipped: true };

  if (feedId) {
    const { deleteWeweFeed } = require('./mpClient');
    try {
      wewe = await deleteWeweFeed(feedId);
    } catch (e) {
      wewe = { deleted: false, feedId, error: e.message };
    }
  }

  const weweOk = !feedId || wewe.deleted === true;
  const note = weweOk
    ? (feedId ? `已从 wewe 退订 ${feedId}` : '已出队（无 wewe feed）')
    : `wewe 退订失败: ${String(wewe.error || '').slice(0, 200)}`;

  await db.execute(
    `UPDATE wewe_private_accounts
     SET team_status = 'exited',
         last_exited_at = NOW(),
         extract_pending = 0,
         feed_id = CASE WHEN ? = 1 THEN NULL ELSE feed_id END,
         note = ?,
         F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ?`,
    [weweOk && feedId ? 1 : 0, note.slice(0, 500), row.F_Id]
  );

  console.log(
    `[wewe专队] 退订 account=${gh} feed=${feedId || '-'} weweOk=${weweOk} weweErr=${wewe.error || '-'}`
  );
  return {
    action: weweOk ? 'unsubscribed' : 'dequeued_wewe_failed',
    accountId: row.F_Id,
    feedId: feedId || null,
    wewe
  };
}

/**
 * 人工禁止/恢复新榜自动重新入队（单条账号）。
 * 禁止时标为 exited 并清 extract_pending，不删 wewe 订阅（需退订请走 unsubscribe）。
 */
async function setAccountEnqueueBlocked(wechatAccountId, blocked, opts = {}) {
  const gh = String(wechatAccountId || '').trim();
  if (!gh) return { action: 'skip_empty' };

  const existing = await db.query(
    `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [gh]
  );
  if (!existing.length) {
    return { action: 'not_found' };
  }
  const row = existing[0];
  const wantBlock = blocked !== false && blocked !== 0 && blocked !== '0';

  if (wantBlock) {
    const noteExtra = String(opts.note || '人工禁止重新入队').slice(0, 200);
    const prevNote = String(row.note || '').trim();
    const note = prevNote && !prevNote.includes(noteExtra)
      ? `${prevNote}；${noteExtra}`.slice(0, 500)
      : prevNote || noteExtra;
    await db.execute(
      `UPDATE wewe_private_accounts
       SET enqueue_blocked = 1,
           team_status = 'exited',
           extract_pending = 0,
           last_exited_at = COALESCE(last_exited_at, NOW()),
           note = ?,
           F_LastModifyTime = CURRENT_TIMESTAMP
       WHERE F_Id = ?`,
      [note, row.F_Id]
    );
    console.log(`[wewe专队] 禁止重新入队 account=${gh}`);
    return { action: 'enqueue_blocked', accountId: row.F_Id, blocked: true };
  }

  await db.execute(
    `UPDATE wewe_private_accounts
     SET enqueue_blocked = 0,
         F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ?`,
    [row.F_Id]
  );
  console.log(`[wewe专队] 恢复允许重新入队 account=${gh}`);
  return { action: 'enqueue_unblocked', accountId: row.F_Id, blocked: false };
}

/**
 * 新榜收尾钩子：专队已改为监控对象/第三方同步，不再因新榜结果入队或出队。
 * 保留函数以免调用方报错；仅记一条 debug 级日志。
 */
async function handleXinbangAccountFinish(wechatAccountId, result) {
  return {
    action: 'skip_roster_from_monitor',
    wechatAccountId: String(wechatAccountId || '').trim() || null,
    hasData: Boolean(result && result.hasData)
  };
}

/**
 * 收集监控侧应进专队的公众号 id → Map<gh, sourceType>
 * - invested：新闻舆情监控对象且填写了企业公众号 id（含已上市；排除完全退出/不再观察）
 * - additional：第三方/额外公众号 active
 * - both：两边都有
 */
async function collectMonitorWechatAccounts() {
  const sourceByGh = new Map();

  const mark = (gh, kind) => {
    const id = String(gh || '').trim();
    if (!id) return;
    const prev = sourceByGh.get(id);
    if (!prev) sourceByGh.set(id, kind);
    else if (prev !== kind) sourceByGh.set(id, 'both');
  };

  try {
    const enterprises = await db.query(
      `SELECT wechat_official_account_id
       FROM invested_enterprises
       WHERE ${IE_NEWS_APP_FILTER_SQL}
         AND F_DeleteMark = 0
         AND wechat_official_account_id IS NOT NULL
         AND TRIM(wechat_official_account_id) != ''
         AND COALESCE(exit_status, '') NOT IN ('完全退出', '不再观察')`
    );
    for (const row of enterprises) {
      for (const gh of splitWechatAccountIds(row.wechat_official_account_id)) {
        mark(gh, 'invested');
      }
    }
  } catch (e) {
    console.warn(`[wewe专队] 读取监控对象公众号失败: ${e.message}`);
  }

  try {
    const additional = await db.query(
      `SELECT wechat_account_id
       FROM additional_wechat_accounts
       WHERE F_DeleteMark = 0
         AND status = 'active'
         AND wechat_account_id IS NOT NULL
         AND TRIM(wechat_account_id) != ''`
    );
    for (const row of additional) {
      mark(row.wechat_account_id, 'additional');
    }
  } catch (e) {
    console.warn(`[wewe专队] 读取第三方公众号失败: ${e.message}`);
  }

  return sourceByGh;
}

/**
 * 从监控对象 + 第三方公众号同步专队名单（只增改，不自动退订）。
 * @param {{ autoMap?: boolean }} options autoMap 默认 true，对新入队异步尝试历史链接映射
 */
async function syncTeamFromMonitorSources(options = {}) {
  const autoMap = options.autoMap !== false;
  const sourceByGh = await collectMonitorWechatAccounts();
  const summary = {
    action: 'synced_from_monitor',
    sourceCount: sourceByGh.size,
    inserted: 0,
    reEnqueued: 0,
    refreshed: 0,
    skippedBlocked: 0,
    mappedKickoff: 0
  };
  const kickoffMap = [];

  for (const [gh, sourceType] of sourceByGh) {
    const existing = await db.query(
      `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [gh]
    );

    if (existing.length === 0) {
      const id = await generateId('wewe_private_accounts');
      await db.execute(
        `INSERT INTO wewe_private_accounts
         (F_Id, wechat_account_id, source_type, team_status, map_status, feed_id, sample_article_url,
          last_xinbang_error, last_enqueued_at)
         VALUES (?, ?, ?, 'pending_subscribe', 'pending_subscribe', NULL, NULL, ?, NOW())`,
        [id, gh, sourceType, 'sync:monitor']
      );
      summary.inserted += 1;
      kickoffMap.push(gh);
      continue;
    }

    const row = existing[0];
    if (Number(row.enqueue_blocked) === 1) {
      await db.execute(
        `UPDATE wewe_private_accounts
         SET source_type = ?, F_LastModifyTime = CURRENT_TIMESTAMP
         WHERE F_Id = ?`,
        [sourceType, row.F_Id]
      );
      summary.skippedBlocked += 1;
      continue;
    }

    if (row.team_status === 'active' || row.team_status === 'pending_subscribe') {
      await db.execute(
        `UPDATE wewe_private_accounts
         SET source_type = ?, F_LastModifyTime = CURRENT_TIMESTAMP
         WHERE F_Id = ?`,
        [sourceType, row.F_Id]
      );
      summary.refreshed += 1;
      if (row.map_status !== 'mapped' || !row.feed_id) kickoffMap.push(gh);
      continue;
    }

    // exited / disabled → 拉回待订阅（保留已有 feed_id）
    await db.execute(
      `UPDATE wewe_private_accounts
       SET team_status = 'pending_subscribe',
           map_status = CASE WHEN feed_id IS NOT NULL AND feed_id != '' THEN 'mapped' ELSE 'pending_subscribe' END,
           source_type = ?,
           last_enqueued_at = NOW(),
           last_exited_at = NULL,
           last_xinbang_error = ?,
           F_LastModifyTime = CURRENT_TIMESTAMP
       WHERE F_Id = ?`,
      [sourceType, 'sync:monitor_reenqueue', row.F_Id]
    );
    summary.reEnqueued += 1;
    if (!(row.feed_id && String(row.feed_id).trim())) kickoffMap.push(gh);
  }

  if (autoMap && kickoffMap.length) {
    summary.mappedKickoff = kickoffMap.length;
    setImmediate(() => {
      try {
        const { tryAutoMapAfterEnqueue } = require('./weweFeedMap');
        (async () => {
          for (const gh of kickoffMap) {
            try {
              await tryAutoMapAfterEnqueue(gh, { notify: false });
            } catch (e) {
              console.warn(`[wewe映射] 同步后自动映射失败 account=${gh}: ${e.message}`);
            }
          }
        })().catch((e) => console.warn(`[wewe映射] 同步后批量映射异常: ${e.message}`));
      } catch (e) {
        console.warn(`[wewe映射] 加载失败: ${e.message}`);
      }
    });
  }

  console.log(
    `[wewe专队] 从监控同步 source=${summary.sourceCount} +${summary.inserted} re=${summary.reEnqueued} refresh=${summary.refreshed} blocked=${summary.skippedBlocked}`
  );
  return summary;
}

module.exports = {
  DATA_MISSING_RE,
  isDataMissingError,
  getWewePrivateConfig,
  isEnqueueEnabled,
  enqueueFromXinbangError,
  dequeueOnXinbangSuccess,
  unsubscribeFromWewe,
  setAccountEnqueueBlocked,
  handleXinbangAccountFinish,
  syncTeamFromMonitorSources,
  collectMonitorWechatAccounts,
  resolveSourceType,
  splitWechatAccountIds
};
