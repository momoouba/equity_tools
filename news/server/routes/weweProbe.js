/**
 * G0 探路 + P1 专队只读/开关（非正式完整运维页，P6 再做 NewsConfig）
 * GET  /api/wewe-probe/health
 * GET  /api/wewe-probe/feeds
 * GET  /api/wewe-probe/feeds/:feedId
 * GET  /api/wewe-probe/team/config
 * PATCH /api/wewe-probe/team/config  { wewe_enabled, enqueue_enabled, ... }
 * GET  /api/wewe-probe/team/accounts
 */
const express = require('express');
const { getCurrentUser } = require('../middleware/auth');
const { probeHealth, fetchAllFeedsJson, fetchFeedJson, getWeweConfig, setWeweBaseUrlOverride, listWeweAccounts } = require('../utils/wewe/weweClient');
const { getWewePrivateConfig, enqueueFromXinbangError, unsubscribeFromWewe, setAccountEnqueueBlocked } = require('../utils/wewe/wewePrivateTeam');
const { mapAccountWithSampleUrl, tryAutoMapAfterEnqueue } = require('../utils/wewe/weweFeedMap');
const {
  extractOneAccount,
  runExtractTick,
  markAllActiveForExtract,
  setExtractPaused,
  formatBeijingYmd
} = require('../utils/wewe/weweExtractService');
const { updateWeweExtractScheduledTasks } = require('../utils/wewe/scheduledWeweExtractTasks');
const { updateWeweIngestScheduledTasks } = require('../utils/wewe/scheduledWeweIngestTasks');
const { updateWeweRemindScheduledTasks } = require('../utils/wewe/scheduledWeweRemindTasks');
const { runIngestTick, previewIngest } = require('../utils/wewe/weweIngestService');
const {
  runScanRemindTick,
  runPendingSubscribeRemindTick,
  issueLiveQrForMail,
  computeSessionPhase,
  ensureSessionRow,
  markSessionRecovered
} = require('../utils/wewe/weweRemindService');
const { IE_NEWS_APP_FILTER_SQL } = require('../utils/investedEnterpriseNewsAppSql');
const db = require('../db');

const router = express.Router();
router.use(getCurrentUser);

function requireAdmin(req, res, next) {
  const role = (req.currentUser && req.currentUser.role) || '';
  if (String(role).toLowerCase() !== 'admin') {
    return res.status(403).json({ success: false, message: '仅管理员可用于 wewe 探路接口' });
  }
  next();
}

function splitWechatIds(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 从公众号管理 / 监控对象补全名称 */
async function enrichWeweTeamAccounts(rows) {
  if (!rows || rows.length === 0) return [];
  const ghs = [...new Set(rows.map((r) => String(r.wechat_account_id || '').trim()).filter(Boolean))];
  const nameByGh = new Map();
  const enterpriseByGh = new Map();

  if (ghs.length > 0) {
    try {
      const placeholders = ghs.map(() => '?').join(',');
      const addRows = await db.query(
        `SELECT wechat_account_id, account_name
         FROM additional_wechat_accounts
         WHERE F_DeleteMark = 0 AND wechat_account_id IN (${placeholders})`,
        ghs
      );
      for (const a of addRows) {
        const gh = String(a.wechat_account_id || '').trim();
        if (gh && a.account_name) nameByGh.set(gh, String(a.account_name));
      }
    } catch (_) {
      /* ignore */
    }

    try {
      const ieRows = await db.query(
        `SELECT enterprise_full_name, project_abbreviation, wechat_official_account_id
         FROM invested_enterprises
         WHERE ${IE_NEWS_APP_FILTER_SQL}
           AND F_DeleteMark = 0
           AND wechat_official_account_id IS NOT NULL
           AND wechat_official_account_id != ''`
      );
      for (const ie of ieRows) {
        const ids = splitWechatIds(ie.wechat_official_account_id);
        for (const gh of ids) {
          if (!enterpriseByGh.has(gh)) {
            enterpriseByGh.set(gh, {
              enterprise_full_name: ie.enterprise_full_name || null,
              project_abbreviation: ie.project_abbreviation || null
            });
          }
        }
      }
    } catch (_) {
      /* ignore */
    }

    // 兜底：从近期 news_detail 取公众号名称（新榜入库的 account_name）
    const missingName = ghs.filter((gh) => !nameByGh.has(gh));
    if (missingName.length > 0) {
      try {
        const ph = missingName.map(() => '?').join(',');
        const ndRows = await db.query(
          `SELECT wechat_account, account_name
           FROM news_detail
           WHERE F_DeleteMark = 0
             AND wechat_account IN (${ph})
             AND account_name IS NOT NULL AND account_name != ''
           ORDER BY F_CreatorTime DESC
           LIMIT 500`,
          missingName
        );
        for (const n of ndRows) {
          const gh = String(n.wechat_account || '').trim();
          if (gh && !nameByGh.has(gh) && n.account_name) {
            nameByGh.set(gh, String(n.account_name));
          }
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  return rows.map((r) => {
    const gh = String(r.wechat_account_id || '').trim();
    const ent = enterpriseByGh.get(gh) || {};
    return {
      ...r,
      account_name: nameByGh.get(gh) || null,
      enterprise_full_name: ent.enterprise_full_name || null,
      project_abbreviation: ent.project_abbreviation || null
    };
  });
}

router.get('/health', requireAdmin, async (req, res) => {
  try {
    const cfg = getWeweConfig();
    const health = await probeHealth();
    res.json({
      success: true,
      phase: 'G0',
      config: { baseUrl: cfg.baseUrl, authConfigured: Boolean(cfg.authCode) },
      health
    });
  } catch (e) {
    res.status(502).json({
      success: false,
      message: e.message || 'wewe health failed',
      config: getWeweConfig()
    });
  }
});

router.get('/feeds', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 30);
    const result = await fetchAllFeedsJson(limit);
    res.json({
      success: true,
      phase: 'G0',
      message: result.count ? '已读到 wewe 文章' : '未读到文章：请先在 wewe 管理页扫码并订阅公众号',
      ...result
    });
  } catch (e) {
    res.status(502).json({
      success: false,
      message: e.message || 'fetch all feeds failed',
      status: e.status,
      body: e.body
    });
  }
});

router.get('/feeds/:feedId', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const update = req.query.update === '1' || req.query.update === 'true';
    const result = await fetchFeedJson(req.params.feedId, { limit, update });
    res.json({
      success: true,
      phase: 'G0',
      message: result.count ? '已读到该 feed 文章' : '该 feed 暂无文章',
      ...result
    });
  } catch (e) {
    res.status(502).json({
      success: false,
      message: e.message || 'fetch feed failed',
      status: e.status,
      body: e.body
    });
  }
});

router.get('/team/config', requireAdmin, async (req, res) => {
  try {
    const cfg = await getWewePrivateConfig();
    res.json({ success: true, phase: 'P1', config: cfg });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.patch('/team/config', requireAdmin, async (req, res) => {
  try {
    const cfg = await getWewePrivateConfig();
    if (!cfg) {
      return res.status(404).json({ success: false, message: 'wewe_private_config 不存在，请重启服务以建表' });
    }
    const fields = [];
    const values = [];
    const boolKeys = [
      'wewe_enabled',
      'enqueue_enabled',
      'extract_enabled',
      'ingest_enabled',
      'remind_enabled'
    ];
    for (const k of boolKeys) {
      if (req.body[k] !== undefined) {
        fields.push(`${k} = ?`);
        values.push(req.body[k] ? 1 : 0);
      }
    }
    if (req.body.wewe_base_url !== undefined) {
      fields.push('wewe_base_url = ?');
      values.push(String(req.body.wewe_base_url || '').slice(0, 500));
    }
    if (req.body.ops_email !== undefined) {
      fields.push('ops_email = ?');
      values.push(String(req.body.ops_email || '').slice(0, 1000));
    }
    if (req.body.ingest_at !== undefined) {
      fields.push('ingest_at = ?');
      values.push(String(req.body.ingest_at || '00:00').slice(0, 10));
    }
    if (req.body.extract_start !== undefined) {
      fields.push('extract_start = ?');
      values.push(String(req.body.extract_start || '21:00').slice(0, 10));
    }
    if (req.body.catchup_extract_start !== undefined) {
      fields.push('catchup_extract_start = ?');
      values.push(String(req.body.catchup_extract_start || '06:00').slice(0, 10));
    }
    if (req.body.poll_interval_minutes !== undefined) {
      fields.push('poll_interval_minutes = ?');
      values.push(Math.min(60, Math.max(1, parseInt(req.body.poll_interval_minutes, 10) || 5)));
    }
    const intKeys = [
      'session_ttl_hours',
      'remind_before_hours',
      'remind_interval_buffer_hours',
      'remind_interval_dead_minutes',
      'remind_daily_cap'
    ];
    for (const k of intKeys) {
      if (req.body[k] !== undefined) {
        fields.push(`${k} = ?`);
        values.push(Math.max(1, parseInt(req.body[k], 10) || 1));
      }
    }
    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: '无更新字段' });
    }
    values.push(cfg.F_Id);
    await db.execute(
      `UPDATE wewe_private_config SET ${fields.join(', ')}, F_LastModifyTime = CURRENT_TIMESTAMP WHERE F_Id = ?`,
      values
    );
    const next = await getWewePrivateConfig();
    if (next && next.wewe_base_url) {
      setWeweBaseUrlOverride(next.wewe_base_url);
    } else {
      setWeweBaseUrlOverride('');
    }
    try {
      await updateWeweExtractScheduledTasks();
    } catch (e) {
      console.warn('[wewe-probe] 刷新提取调度失败:', e.message);
    }
    try {
      await updateWeweIngestScheduledTasks();
    } catch (e) {
      console.warn('[wewe-probe] 刷新入库调度失败:', e.message);
    }
    try {
      await updateWeweRemindScheduledTasks();
    } catch (e) {
      console.warn('[wewe-probe] 刷新催办调度失败:', e.message);
    }
    res.json({ success: true, message: '已更新', config: next });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/team/accounts', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    let sql = `SELECT * FROM wewe_private_accounts WHERE F_DeleteMark = 0`;
    const params = [];
    if (status) {
      sql += ` AND team_status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY last_enqueued_at DESC, F_CreatorTime DESC LIMIT 200`;
    const rows = await db.query(sql, params);
    const enriched = await enrichWeweTeamAccounts(rows);
    res.json({ success: true, phase: 'P1', count: enriched.length, accounts: enriched });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P6：管理员获取 wewe AUTH_CODE（仅用于同源嵌入自动登录，不写日志明文外传） */
router.get('/team/wewe-auth-bootstrap', requireAdmin, async (req, res) => {
  try {
    const { signWeweEmbedTicket } = require('./weweRssProxy');
    const { authCode, baseUrl } = getWeweConfig();
    const embedTicket = signWeweEmbedTicket(authCode || '', 180);
    res.json({
      success: true,
      phase: 'P6',
      authEnabled: Boolean(authCode),
      upstreamBaseUrl: baseUrl,
      embedGatePath: '/wewe-rss-gate',
      embedDashPath: '/dash',
      embedTicket,
      // 不回传明文 authCode 到前端（改由 gate ticket 注入）
      authCode: undefined
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P1 自检：模拟「数据不存在」入队（不打新榜；需已开 wewe_enabled+enqueue_enabled） */
router.post('/team/enqueue-test', requireAdmin, async (req, res) => {
  try {
    const gh = String(req.body.wechat_account_id || req.body.account || '').trim();
    if (!gh) {
      return res.status(400).json({ success: false, message: '请提供 wechat_account_id，如 gh_23e6d7335515' });
    }
    const result = await enqueueFromXinbangError(gh, {
      type: '数据不存在',
      message: req.body.message || '数据不存在（P1 自检模拟）'
    });
    // 同步等一小会让 setImmediate 映射有机会跑完（测服用）
    await new Promise((r) => setTimeout(r, 800));
    const mapPreview = await tryAutoMapAfterEnqueue(gh, { notify: false }).catch((e) => ({
      action: 'map_error',
      error: e.message
    }));
    const rows = await db.query(
      `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [gh]
    );
    res.json({ success: true, phase: 'P1', result, mapPreview, account: rows[0] || null });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** 出队并删除 wewe-rss 订阅源（新闻库不软删，只把 team_status 标为 exited） */
router.post('/team/unsubscribe', requireAdmin, async (req, res) => {
  try {
    const gh = String(req.body.wechat_account_id || req.body.account || '').trim();
    if (!gh) {
      return res.status(400).json({ success: false, message: '需要 wechat_account_id' });
    }
    const result = await unsubscribeFromWewe(gh);
    if (result.action === 'not_found') {
      return res.status(404).json({ success: false, message: '专队无此账号' });
    }
    const rows = await db.query(
      `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [gh]
    );
    const weweFailed = result.action === 'dequeued_wewe_failed';
    res.status(weweFailed ? 502 : 200).json({
      success: !weweFailed,
      message: weweFailed
        ? `专队已出队，但 wewe-rss 退订失败：${result.wewe?.error || '未知错误'}`
        : '已出队并从 wewe-rss 删除订阅',
      result,
      account: rows[0] || null
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** 人工禁止/恢复新榜自动重新入队（单条；禁止时标 exited，不删 wewe 订阅） */
router.post('/team/enqueue-block', requireAdmin, async (req, res) => {
  try {
    const gh = String(req.body.wechat_account_id || req.body.account || '').trim();
    if (!gh) {
      return res.status(400).json({ success: false, message: '需要 wechat_account_id' });
    }
    const blockedRaw = req.body.blocked ?? req.body.enqueue_blocked;
    const blocked = blockedRaw !== false && blockedRaw !== 0 && blockedRaw !== '0';
    const result = await setAccountEnqueueBlocked(gh, blocked, {
      note: req.body.note || undefined
    });
    if (result.action === 'not_found') {
      return res.status(404).json({ success: false, message: '专队无此账号' });
    }
    const rows = await db.query(
      `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [gh]
    );
    res.json({
      success: true,
      message: blocked
        ? '已禁止该账号被新榜自动重新入队（已标为已出队）'
        : '已恢复允许新榜自动入队',
      result,
      account: rows[0] || null
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P2：粘贴分享链接完成映射 */
router.post('/team/map-url', requireAdmin, async (req, res) => {
  try {
    const gh = String(req.body.wechat_account_id || req.body.account || '').trim();
    const url = String(req.body.sample_article_url || req.body.url || '').trim();
    if (!gh || !url) {
      return res.status(400).json({
        success: false,
        message: '需要 wechat_account_id 与 sample_article_url（https://mp.weixin.qq.com/s/...）'
      });
    }
    const mapped = await mapAccountWithSampleUrl(gh, url);
    const rows = await db.query(
      `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [gh]
    );
    res.json({
      success: true,
      phase: 'P2',
      message: mapped?.feedId ? `已映射 feed=${mapped.feedId}` : '映射完成',
      mapped,
      account: rows[0] || null
    });
  } catch (e) {
    let message = e.message || '映射失败';
    if (/暂无可用读书账号/.test(message)) {
      message =
        '暂无可用读书账号：微信读书会话已失效。请先点「打开活码页」扫码登录成功（页内应显示绿色扫码成功），再粘贴链接。';
    }
    res.status(500).json({ success: false, message });
  }
});

/** P2：仅用历史 source_url 自动映射 */
router.post('/team/auto-map', requireAdmin, async (req, res) => {
  try {
    const gh = String(req.body.wechat_account_id || req.body.account || '').trim();
    if (!gh) {
      return res.status(400).json({ success: false, message: '需要 wechat_account_id' });
    }
    const mapped = await tryAutoMapAfterEnqueue(gh, { notify: req.body.notify === true });
    const rows = await db.query(
      `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [gh]
    );
    res.json({ success: true, phase: 'P2', mapped, account: rows[0] || null });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P3：标记全部 active 入提取队列 */
router.post('/team/extract-enqueue-all', requireAdmin, async (req, res) => {
  try {
    const n = await markAllActiveForExtract();
    res.json({ success: true, phase: 'P3', marked: n });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P3：提取队列 tick 一次（1 个号） */
router.post('/team/extract-tick', requireAdmin, async (req, res) => {
  try {
    const extractYmd = req.body.extract_ymd || formatBeijingYmd();
    const result = await runExtractTick({
      force: req.body.force === true,
      extractYmd,
      updateFeed: req.body.update !== false
    });
    res.json({ success: true, phase: 'P3', result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P3：指定账号立即提取 */
router.post('/team/extract-one', requireAdmin, async (req, res) => {
  try {
    const gh = String(req.body.wechat_account_id || req.body.account || '').trim();
    if (!gh) {
      return res.status(400).json({ success: false, message: '需要 wechat_account_id' });
    }
    const rows = await db.query(
      `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [gh]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: '专队无此账号' });
    }
    const extractYmd = req.body.extract_ymd || formatBeijingYmd();
    const result = await extractOneAccount(rows[0], {
      extractYmd,
      updateFeed: req.body.update !== false
    });
    const staged = await db.query(
      `SELECT F_Id, title, source_url, extract_ymd, ingest_status, LEFT(content, 80) AS content_head
       FROM wewe_private_article_stage
       WHERE wechat_account_id = ? AND extract_ymd = ? AND F_DeleteMark = 0
       ORDER BY F_CreatorTime DESC LIMIT 20`,
      [gh, extractYmd]
    );
    res.json({ success: true, phase: 'P3', result, stagedCount: staged.length, staged });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P3：会话暂停 / 恢复补提 */
router.post('/team/session-pause', requireAdmin, async (req, res) => {
  try {
    await setExtractPaused(true, req.body.note || '手动暂停提取');
    res.json({ success: true, phase: 'P3', paused: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.post('/team/session-resume', requireAdmin, async (req, res) => {
  try {
    const recovered = await markSessionRecovered({
      vid: req.body.vid,
      username: req.body.username || 'session-resume'
    });
    res.json({ success: true, phase: 'P5', result: recovered });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

router.get('/team/stage', requireAdmin, async (req, res) => {
  try {
    const ymd = req.query.extract_ymd || formatBeijingYmd();
    const rows = await db.query(
      `SELECT F_Id, wechat_account_id, feed_id, title, source_url, extract_ymd, ingest_status, public_time,
              CHAR_LENGTH(content) AS content_len, ingested_news_id, ingest_error
       FROM wewe_private_article_stage
       WHERE extract_ymd = ? AND F_DeleteMark = 0
       ORDER BY F_CreatorTime DESC LIMIT 100`,
      [ymd]
    );
    res.json({ success: true, phase: 'P3', extract_ymd: ymd, count: rows.length, items: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P4：预览入库账本窗与 pending 计数 */
router.get('/team/ingest-preview', requireAdmin, async (req, res) => {
  try {
    const runDate = req.query.run_date ? new Date(String(req.query.run_date)) : new Date();
    const preview = await previewIngest(runDate);
    res.json({ success: true, phase: 'P4', preview });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * P4：手动触发工作日入库
 * body: { force?: true, run_date?: 'YYYY-MM-DD', biz_dates?: string[] }
 * force=true 可跳过开关/非工作日（验收用）
 */
router.post('/team/ingest-run', requireAdmin, async (req, res) => {
  try {
    const force = req.body.force === true;
    const runDate = req.body.run_date ? new Date(String(req.body.run_date)) : new Date();
    const bizDates = Array.isArray(req.body.biz_dates) ? req.body.biz_dates : undefined;
    const result = await runIngestTick({ force, runDate, bizDates });
    res.json({ success: true, phase: 'P4', result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P5：会话状态 + 预计失效 + wewe 读书账号 */
router.get('/team/session', requireAdmin, async (req, res) => {
  try {
    const cfg = await getWewePrivateConfig();
    const session = await ensureSessionRow();
    const phaseInfo = computeSessionPhase(session, cfg || {});
    let weweAccounts = [];
    let hasEnabledAccount = false;
    try {
      weweAccounts = await listWeweAccounts(20);
      hasEnabledAccount = weweAccounts.some((a) => Number(a.status) === 1);
    } catch (e) {
      weweAccounts = [{ error: e.message }];
    }
    res.json({
      success: true,
      phase: 'P5',
      session,
      phaseInfo,
      weweAccounts,
      hasEnabledAccount
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P5：签发活码页链接（邮件用） */
router.post('/team/live-qr-link', requireAdmin, async (req, res) => {
  try {
    const issued = await issueLiveQrForMail(req);
    res.json({ success: true, phase: 'P5', ...issued });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P5：手动触发扫码催办（force 可跳过间隔） */
router.post('/team/remind-scan', requireAdmin, async (req, res) => {
  try {
    const result = await runScanRemindTick({ force: req.body.force === true, req });
    res.json({ success: true, phase: 'P5', result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P5：手动触发待订阅催办 */
router.post('/team/remind-pending', requireAdmin, async (req, res) => {
  try {
    const result = await runPendingSubscribeRemindTick({ force: req.body.force === true, req });
    res.json({ success: true, phase: 'P5', result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/** P5：标记会话已恢复（人工确认或联调） */
router.post('/team/session-recovered', requireAdmin, async (req, res) => {
  try {
    const recovered = await markSessionRecovered({
      vid: req.body.vid,
      username: req.body.username || 'manual'
    });
    res.json({ success: true, phase: 'P5', recovered });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
