/**
 * 四家交易所 IPO 进展爬虫：HTTP + JSON/JSONP 接口直连。
 * - 深交所：https://www.szse.cn/api/ras/projectrends/query ?bizType=1 IPO
 * - 上交所：https://query.sse.com.cn/commonSoaQuery.do ?sqlId=SH_XM_LB
 * - 北交所：https://www.bse.cn/projectNewsController/infoResult.do (JSONP，需先获取 Cookie)
 */

const axios = require('axios');
const db = require('../../db');
const { runHkexAkshareIpoSync } = require('./hkexAkshareIpoSync');
const { runIfindIpoSync } = require('./ifindIpoSync');
const { decryptText } = require('./listingSecret');
const { containsTraditional, normalizeCompanyName } = require('./zhconvUtils');

const HK_IPO_PROGRESS_EXCHANGES = new Set(['港交所', '香港联交所']);

/**
 * 港股抓取若为公司名繁体：除保留原文一行外，再追加一行简体（company/project_name 转简体），便于邮件与匹配统一使用简体键。
 */
function expandHkIpoProgressTradSimpRows(rows) {
  const out = [];
  for (const r of rows) {
    const ex = String(r.exchange || '').trim();
    out.push(r);
    if (!HK_IPO_PROGRESS_EXCHANGES.has(ex)) continue;
    const company = String(r.company || '').trim();
    if (!company) continue;
    const projRaw = String(r.project_name || '').trim();
    const companyTrad = company && containsTraditional(company);
    const projTrad = projRaw && containsTraditional(projRaw);
    if (!companyTrad && !projTrad) continue;
    const simpCo = companyTrad ? normalizeCompanyName(company) : company;
    const simpPn = projTrad ? normalizeCompanyName(projRaw) : projRaw || simpCo;
    if (simpCo === company && simpPn === (projRaw || company)) continue;
    out.push({
      ...r,
      company: simpCo,
      project_name: simpPn || simpCo,
    });
  }
  return out;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const axiosJson = axios.create({
  timeout: 60000,
  headers: {
    'User-Agent': UA,
    Accept: 'application/json, text/javascript, */*; q=0.01',
  },
  validateStatus: (s) => s >= 200 && s < 500,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRiskBlockedBodyText(text) {
  const t = String(text || '');
  if (!t) return false;
  return /云安全平台|访问行为存在异常|403 Forbidden|forbidden|验证|captcha|人机校验/i.test(t);
}

function isRiskBlockedError(e) {
  const msg = String(e?.message || e || '');
  if (/403|forbidden|captcha|云安全|访问行为存在异常/i.test(msg)) return true;
  const body = e?.response?.data;
  if (typeof body === 'string' && isRiskBlockedBodyText(body)) return true;
  return false;
}

async function getWithRetry(url, options = {}, retry = {}) {
  const attempts = Math.max(1, Number(retry.attempts || 3));
  const baseDelayMs = Math.max(100, Number(retry.baseDelayMs || 500));
  const maxDelayMs = Math.max(baseDelayMs, Number(retry.maxDelayMs || 5000));
  const factor = Math.max(1.2, Number(retry.factor || 2));
  const blockedCooldownMs = Math.max(1000, Number(retry.blockedCooldownMs || 3 * 60 * 1000));
  const maxBlockedWaits = Math.max(1, Number(retry.maxBlockedWaits || 3));
  const label = String(retry.label || url);
  let lastErr = null;
  let attempt = 1;
  let blockedWaits = 0;
  while (attempt <= attempts) {
    try {
      const resp = await axiosJson.get(url, options);
      if (resp.status === 401 || resp.status === 403 || resp.status === 429) {
        const err = new Error(`HTTP ${resp.status}`);
        err._riskBlocked = true;
        throw err;
      }
      if (typeof resp.data === 'string' && isRiskBlockedBodyText(resp.data)) {
        const err = new Error('risk blocked by response body');
        err._riskBlocked = true;
        throw err;
      }
      if (resp.status >= 500) {
        throw new Error(`HTTP ${resp.status}`);
      }
      return resp;
    } catch (e) {
      lastErr = e;
      const blocked = e?._riskBlocked || isRiskBlockedError(e);
      if (blocked) {
        blockedWaits += 1;
        if (blockedWaits > maxBlockedWaits) break;
        console.warn(
          `[风控退避] ${label} blocked=${blockedWaits}/${maxBlockedWaits} cooldown=${blockedCooldownMs}ms err=${e.message || e}`
        );
        await sleep(blockedCooldownMs);
        continue;
      }
      if (attempt >= attempts) break;
      const exp = Math.min(maxDelayMs, Math.round(baseDelayMs * factor ** (attempt - 1)));
      const jitter = Math.round(exp * (Math.random() * 0.2));
      const delay = exp + jitter;
      console.warn(`[重试] ${label} attempt=${attempt + 1}/${attempts} delay=${delay}ms err=${e.message || e}`);
      await sleep(delay);
      attempt += 1;
    }
  }
  throw lastErr;
}

function parseJsonpBody(text) {
  const t = String(text || '').trim();
  const m = t.match(/^[\w$]+\(([\s\S]*)\)\s*;?\s*$/);
  if (!m) {
    throw new Error('??JSONP ?????');
  }
  return JSON.parse(m[1]);
}

function ymdInRange(ymd, startYmd, endYmd) {
  if (!ymd) return false;
  const d = String(ymd).slice(0, 10);
  return d >= startYmd && d <= endYmd;
}

function toYmdLoose(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const mm = m[2].padStart(2, '0');
    const dd = m[3].padStart(2, '0');
    return `${m[1]}-${mm}-${dd}`;
  }
  return s.slice(0, 10);
}

function normalizeStatusText(s) {
  return String(s || '')
    .replace(/[()（）]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function isStatusLikelySame(a, b) {
  const x = normalizeStatusText(a);
  const y = normalizeStatusText(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function normalizeTimelineRows(rows) {
  const out = [];
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    const status = String(r?.status || '').trim();
    const ymd = toYmdLoose(r?.ymd);
    if (!status || !ymd) return;
    const key = `${status}__${ymd}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ status, ymd });
  });
  return out;
}

function expandRowsWithTimeline(rows, logTag = '[上市进展爬虫]') {
  const base = Array.isArray(rows) ? rows : [];
  const expanded = [];
  let added = 0;
  base.forEach((row) => {
    expanded.push(row);
    const timeline = normalizeTimelineRows(row?._timeline_rows || []);
    if (!timeline.length) return;
    timeline.forEach((t) => {
      const sameCurrentStatus = isStatusLikelySame(t.status, row.status || '');
      const sameCurrentDate = toYmdLoose(row.f_update_time) === t.ymd;
      if (sameCurrentStatus && sameCurrentDate) return;
      expanded.push({
        ...row,
        status: t.status,
        receive_date: t.ymd,
        f_update_time: `${t.ymd} 00:00:00`,
      });
      added += 1;
    });
  });
  if (added > 0) {
    console.log(`${logTag} 详情时间轴状态扩展：新增候选行=${added}`);
  }
  return expanded;
}

async function pruneMismatchedTimelineRows(rows, adminId, logTag = '[上市进展爬虫]') {
  const list = Array.isArray(rows) ? rows : [];
  const group = new Map();
  list.forEach((r) => {
    const exchange = String(r.exchange || '').trim();
    const company = String(r.company || '').trim();
    const board = String(r.board || '').trim();
    if (!exchange || !company || !board) return;
    const timeline = normalizeTimelineRows(r._timeline_rows || []);
    if (!timeline.length) return;
    const key = `${exchange}__${company}__${board}`;
    if (!group.has(key)) {
      group.set(key, { exchange, company, board, allowed: new Set(), statuses: new Set() });
    }
    const g = group.get(key);
    timeline.forEach((t) => {
      g.allowed.add(`${t.status}__${t.ymd}`);
      g.statuses.add(t.status);
    });
  });

  let softDeleted = 0;
  for (const g of group.values()) {
    const statuses = Array.from(g.statuses);
    if (!statuses.length) continue;
    const statusPlaceholders = statuses.map(() => '?').join(',');
    const sql = `
      UPDATE ipo_progress
      SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?
      WHERE F_DeleteMark = 0
        AND exchange = ?
        AND company = ?
        AND board = ?
        AND status IN (${statusPlaceholders})
    `;
    const params = [adminId, g.exchange, g.company, g.board, ...statuses];
    // 先查候选，避免误删；仅删除不在时间轴集合的状态+日期。
    const candidates = await db.query(
      `SELECT f_id, status, DATE_FORMAT(f_update_time, '%Y-%m-%d') AS ymd
       FROM ipo_progress
       WHERE F_DeleteMark = 0
         AND exchange = ?
         AND company = ?
         AND board = ?
         AND status IN (${statusPlaceholders})`,
      [g.exchange, g.company, g.board, ...statuses]
    );
    const toDeleteIds = candidates
      .filter((x) => !g.allowed.has(`${String(x.status || '').trim()}__${String(x.ymd || '').slice(0, 10)}`))
      .map((x) => x.f_id)
      .filter(Boolean);
    if (!toDeleteIds.length) continue;
    if (toDeleteIds.length > 500) {
      console.warn(`[pruneMismatchedTimelineRows] toDeleteIds 过长(${toDeleteIds.length})，截断至 500`);
      toDeleteIds.length = 500;
    }
    const idPlaceholders = toDeleteIds.map(() => '?').join(',');
    // 先清理关联的 ipo_project_progress（硬删除）
    await db.execute(
      `DELETE FROM ipo_project_progress WHERE ipo_progress_row_id IN (${idPlaceholders})`,
      [...toDeleteIds]
    );
    const header = await db.execute(
      `UPDATE ipo_progress
       SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?
       WHERE F_DeleteMark = 0 AND f_id IN (${idPlaceholders})`,
      [adminId, ...toDeleteIds]
    );
    softDeleted += Number(header?.affectedRows || 0);
  }
  if (softDeleted > 0) {
    console.log(`${logTag} 详情时间轴反向清理：软删除错日期记录=${softDeleted}`);
  }
  return { softDeleted };
}

/**
 * 修正历史记录的 f_update_time 日期，使其与详情页时间轴日期一致。
 *
 * 背景：早期插入的记录可能使用了上交所列表页的 updateDate（项目最后修改时间）作为
 * f_update_time，而非时间轴上的审核状态达成日期。这会导致同一审核状态在 DB 中出现
 * 两条日期不同的记录（一条旧的用 SSE 时间戳，一条新的用时间轴日期），且去重机制
 * （mergeDuplicateIpoProgressExchangeRows）因 DATE(f_update_time) 不同而无法合并。
 *
 * 此函数在 insertRows 之前运行，将旧记录的 f_update_time 就地修正为时间轴日期，
 * 从而让后续的业务键查重和去重逻辑正常工作。
 */
async function migrateStaleTimelineDates(rows, adminId, logTag = '[上市进展爬虫]') {
  const list = Array.isArray(rows) ? rows : [];
  const group = new Map();

  list.forEach((r) => {
    const exchange = String(r.exchange || '').trim();
    const company = String(r.company || '').trim();
    const board = String(r.board || '').trim();
    if (!exchange || !company || !board) return;
    const timeline = normalizeTimelineRows(r._timeline_rows || []);
    if (!timeline.length) return;
    const key = `${exchange}__${company}__${board}`;
    if (!group.has(key)) {
      group.set(key, { exchange, company, board, timeline });
    }
  });

  let migrated = 0;

  for (const g of group.values()) {
    // 收集时间轴中该组所有状态和日期
    const timelineDates = new Set(g.timeline.map((t) => t.ymd));
    const timelineStatuses = [...new Set(g.timeline.map((t) => t.status))];
    if (!timelineStatuses.length) continue;

    // 查询 DB 中该公司这些状态的所有活跃记录
    const statusPlaceholders = timelineStatuses.map(() => '?').join(',');
    const candidates = await db.query(
      `SELECT f_id, status, DATE_FORMAT(f_update_time, '%Y-%m-%d') AS ymd
       FROM ipo_progress
       WHERE F_DeleteMark = 0
         AND exchange = ?
         AND company = ?
         AND board = ?
         AND status IN (${statusPlaceholders})`,
      [g.exchange, g.company, g.board, ...timelineStatuses]
    );

    for (const c of candidates) {
      const cStatus = String(c.status || '').trim();
      const cYmd = String(c.ymd || '').slice(0, 10);
      // 如果该记录的日期已在时间轴中，无需修正
      if (timelineDates.has(cYmd)) continue;

      // 找到时间轴中匹配该记录状态的日期
      const matchingEntry = g.timeline.find((t) => isStatusLikelySame(t.status, cStatus));
      if (!matchingEntry) continue;

      const targetYmd = matchingEntry.ymd;

      // 检查目标日期是否已有记录存在（避免迁移后产生新重复）
      const existingAtTarget = await db.query(
        `SELECT f_id FROM ipo_progress
         WHERE F_DeleteMark = 0
           AND exchange = ? AND company = ? AND board = ?
           AND status = ?
           AND COALESCE(DATE(receive_date), DATE(f_update_time)) = ?
           AND f_id <> ?`,
        [g.exchange, g.company, g.board, cStatus, targetYmd, c.f_id]
      );
      if (existingAtTarget.length > 0) {
        // 目标日期已有正确记录，软删当前旧记录即可
        // 同步清理关联的 ipo_project_progress（该表使用硬删除，无 F_DeleteMark）
        await db.execute(
          `DELETE FROM ipo_project_progress WHERE ipo_progress_row_id = ?`,
          [c.f_id]
        );
        await db.execute(
          `UPDATE ipo_progress
           SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?
           WHERE f_id = ? AND F_DeleteMark = 0`,
          [adminId, c.f_id]
        );
        migrated += 1;
        continue;
      }

      // 就地修正 f_update_time 为时间轴日期（00:00:00），与 expandRowsWithTimeline 保持一致
      await db.execute(
        `UPDATE ipo_progress
         SET f_update_time = CONCAT(?, ' 00:00:00'),
             receive_date = ?,
             F_LastModifyUserId = ?, F_LastModifyTime = NOW()
         WHERE f_id = ? AND F_DeleteMark = 0`,
        [targetYmd, targetYmd, adminId, c.f_id]
      );
      // 清理关联的 ipo_project_progress 旧记录，由下次匹配流程（listingMatchRunner）自动重建正确数据
      await db.execute(
        `DELETE FROM ipo_project_progress WHERE ipo_progress_row_id = ?`,
        [c.f_id]
      );
      migrated += 1;
    }
  }

  if (migrated > 0) {
    console.log(`${logTag} 时间轴日期迁移：修正旧记录 f_update_time=${migrated}`);
  }
  return { migrated };
}

async function runWithConcurrency(items, worker, concurrency = 6) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const c = Math.max(1, Number(concurrency) || 1);
  const out = new Array(list.length);
  let idx = 0;
  async function runOne() {
    while (idx < list.length) {
      const cur = idx;
      idx += 1;
      try {
        out[cur] = await worker(list[cur], cur);
      } catch (e) {
        out[cur] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(c, list.length) }, () => runOne()));
  return out;
}

/**
 * 接口按「更新日期降序」分页时，应用本页的最大更新日判断是否已无更多可能落在 [startYmd,∞) 的数据。
 * 误用「本页最小更新日 < start」会提前停页：同一页若混有更早的记录，会漏掉后续页里仍在区间内的行。
 */
function shouldStopDescPagedFetch(pageMaxYmd, startYmd) {
  return Boolean(pageMaxYmd && pageMaxYmd < startYmd);
}

/** SSE updateDate: 20260330100926 */
function sseUpdateToSqlDateTime(s) {
  const x = String(s || '');
  if (x.length < 14) return null;
  const y = x.slice(0, 4);
  const mo = x.slice(4, 6);
  const day = x.slice(6, 8);
  const h = x.slice(8, 10);
  const mi = x.slice(10, 12);
  const se = x.slice(12, 14);
  return `${y}-${mo}-${day} ${h}:${mi}:${se}`;
}

function sseUpdateToYmd(s) {
  const dt = sseUpdateToSqlDateTime(s);
  return dt ? dt.slice(0, 10) : null;
}

function sseAuditApplyToYmd(s) {
  return sseUpdateToYmd(s);
}

/** ??sse ?? statusTransform ????ipo ????*/
function sseStatusToZh(v) {
  const status = String(v.currStatus);
  const subStatus = v.commitiResult != null ? String(v.commitiResult) : '';
  const registeResult = v.registeResult != null ? String(v.registeResult) : '';
  const suspendStatus = v.suspendStatus ? String(v.suspendStatus) : '';
  if (status === '1') return '\u5df2\u53d7\u7406';
  if (status === '2') return '\u5df2\u95ee\u8be2';
  if (status === '3') {
    if (subStatus === '1') return '\u4e0a\u5e02\u59d4\u4f1a\u8bae\u901a\u8fc7';
    if (subStatus === '2') return '\u6709\u6761\u4ef6\u901a\u8fc7';
    if (subStatus === '3') return '\u4e0a\u5e02\u59d4\u4f1a\u8bae\u672a\u901a\u8fc7';
    if (subStatus === '6') return '\u6682\u7f13\u5ba1\u8bae';
    return '\u4e0a\u5e02\u59d4\u4f1a\u8bae';
  }
  if (status === '4') return '\u63d0\u4ea4\u6ce8\u518c';
  if (status === '5') {
    if (registeResult === '1') return '\u6ce8\u518c\u751f\u6548';
    if (registeResult === '2') return '\u4e0d\u4e88\u6ce8\u518c';
    if (registeResult === '3') return '\u7ec8\u6b62\u6ce8\u518c';
    return '\u6ce8\u518c\u7ed3\u679c';
  }
  if (status === '6') return '\u5df2\u53d1\u884c';
  if (status === '7') {
    if (suspendStatus === '1') return '\u4e2d\u6b62(\u8d22\u62a5\u66f4\u65b0)';
    if (suspendStatus === '2') return '\u4e2d\u6b62(\u5176\u4ed6\u4e8b\u9879)';
    return '\u4e2d\u6b62\u53ca\u8d22\u62a5\u66f4\u65b0';
  }
  if (status === '8') return '\u7ec8\u6b62';
  if (status === '9') {
    if (subStatus === '4') return '\u590d\u5ba1\u59d4\u4f1a\u8bae\u901a\u8fc7';
    if (subStatus === '5') return '\u590d\u5ba1\u59d4\u4f1a\u8bae\u672a\u901a\u8fc7';
    return '\u590d\u5ba1\u59d4\u4f1a\u8bae';
  }
  if (status === '10') return '\u8865\u5145\u5ba1\u6838';
  return '-';
}

function ssePlateZh(issueMarketType) {
  const n = Number(issueMarketType);
  if (n === 1) return '\u79d1\u521b\u677f';
  if (n === 2) return '\u4e3b\u677f';
  return '\u4e0a\u4ea4\u6240';
}

async function fetchSzseIpoInRange(startYmd, endYmd) {
  const out = [];
  const pageSize = 100;
  let pageIndex = 0;
  let totalPage = 1;
  while (pageIndex < totalPage && pageIndex < 500) {
    const { data } = await getWithRetry(
      'https://www.szse.cn/api/ras/projectrends/query',
      {
        params: {
          bizType: 1,
          pageIndex,
          pageSize,
          random: Math.random(),
        },
        headers: { Referer: 'https://www.szse.cn/listing/projectdynamic/ipo/index.html' },
      },
      { attempts: 4, baseDelayMs: 800, maxDelayMs: 8000, factor: 2, label: `SZSE列表 pageIndex=${pageIndex}` }
    );
    if (!data || data.totalPage == null) break;
    totalPage = data.totalPage;
    const rows = data.data || [];
    let pageMaxU = '';
    for (const r of rows) {
      const u = r.updtdt ? String(r.updtdt).slice(0, 10) : '';
      if (u && (!pageMaxU || u > pageMaxU)) pageMaxU = u;
      if (!ymdInRange(u, startYmd, endYmd)) continue;
      out.push({
        exchange: '\u6df1\u4ea4\u6240',
        board: r.boardName || (r.boardCode === '16' ? '\u521b\u4e1a\u677f' : '\u4e3b\u677f'),
        company: (r.cmpnm || '').trim(),
        project_name: (r.cmpsnm || '').trim() || (r.cmpnm || '').trim(),
        status: (r.prjst || '').trim() || '-',
        register_address: (r.regloc || '').trim(),
        code: (r.cmpcode || '').trim(),
        receive_date: u || null,
        f_update_time: r.updtdt ? `${String(r.updtdt).slice(0, 10)} 00:00:00` : null,
        _szse_prjid: r.prjid ? String(r.prjid).trim() : '',
        _update_ymd: u || '',
        _filing_ymd: r.acptdt ? String(r.acptdt).slice(0, 10) : '',
      });
    }
    if (rows.length === 0) break;
    if (shouldStopDescPagedFetch(pageMaxU, startYmd)) break;
    pageIndex += 1;
  }
  return out;
}

async function fetchSseIpoInRange(startYmd, endYmd) {
  const out = [];
  const pageSize = 25;
  let pageNo = 1;
  let pageCount = 1;
  while (pageNo <= pageCount && pageNo <= 600) {
    const params = {
      sqlId: 'SH_XM_LB',
      isPagination: true,
      'pageHelp.cacheSize': 1,
      'pageHelp.beginPage': 1,
      'pageHelp.endPage': 1,
      'pageHelp.pageSize': pageSize,
      'pageHelp.pageNo': pageNo,
      issueMarketType: '1,2',
      order: 'updateDate|desc,stockAuditNum|desc',
      keyword: '',
      currStatus: '',
      province: '',
      csrcCode: '',
      auditApplyDateBegin: '',
      auditApplyDateEnd: '',
    };
    const { data } = await getWithRetry(
      'https://query.sse.com.cn/commonSoaQuery.do',
      {
        params,
        headers: { Referer: 'https://www.sse.com.cn/' },
      },
      { attempts: 4, baseDelayMs: 500, maxDelayMs: 5000, factor: 2, label: `SSE列表 pageNo=${pageNo}` }
    );
    const list = data && data.result ? data.result : [];
    const ph = data && data.pageHelp ? data.pageHelp : {};
    pageCount = ph.pageCount || 1;
    let pageMaxYmd = '';
    for (const v of list) {
      const u = sseUpdateToYmd(v.updateDate);
      if (u && (!pageMaxYmd || u > pageMaxYmd)) pageMaxYmd = u;
      if (!u || !ymdInRange(u, startYmd, endYmd)) continue;
      const issuer = v.stockIssuer && v.stockIssuer[0] ? v.stockIssuer[0] : {};
      const company = (issuer.s_issueCompanyFullName || v.stockAuditName || '').trim();
      const fUpdate = sseUpdateToSqlDateTime(v.updateDate);
      const filingYmd = sseAuditApplyToYmd(v.auditApplyDate) || '';
      const recv = u || null;
      out.push({
        exchange: '\u4e0a\u4ea4\u6240',
        board: ssePlateZh(v.issueMarketType),
        company,
        project_name: (issuer.s_issueCompanyAbbrName || '').trim() || company,
        status: sseStatusToZh(v),
        register_address: (issuer.s_province || '').trim(),
        code: (issuer.s_companyCode || '').trim(),
        receive_date: recv,
        f_update_time: fUpdate,
        _sse_audit_id: v.stockAuditNum ? String(v.stockAuditNum).trim() : '',
        _update_ymd: u || '',
        _filing_ymd: filingYmd,
      });
    }
    if (list.length === 0) break;
    if (shouldStopDescPagedFetch(pageMaxYmd, startYmd)) break;
    pageNo += 1;
  }
  return out;
}

async function enrichSzseStatusDate(rows, logTag) {
  const targets = (Array.isArray(rows) ? rows : []).filter((r) => r.exchange === '\u6df1\u4ea4\u6240' && r._szse_prjid);
  if (!targets.length) return { ok: 0, failed: 0, matched: 0 };
  let ok = 0;
  let failed = 0;
  let matched = 0;
  let skippedFresh = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const row = targets[i];
    if (row._filing_ymd && row._update_ymd && row._filing_ymd === row._update_ymd) {
      skippedFresh += 1;
      continue;
    }
    try {
      const { data } = await getWithRetry(
        'https://www.szse.cn/api/ras/projectrends/details',
        {
          params: { id: row._szse_prjid },
          headers: {
            Referer: `https://www.szse.cn/listing/projectdynamic/ipo/detail/index.html?prjid=${row._szse_prjid}`,
          },
        },
        {
          attempts: 3,
          baseDelayMs: 600,
          maxDelayMs: 5000,
          factor: 2,
          blockedCooldownMs: 15 * 60 * 1000,
          maxBlockedWaits: 2,
          label: `SZSE详情 id=${row._szse_prjid} row=${i + 1}/${targets.length}`,
        }
      );
      const detail = data && data.data ? data.data : null;
      if (!detail) {
        failed += 1;
        continue;
      }
      const progs = Array.isArray(detail.prjprogs) ? detail.prjprogs : [];
      row._timeline_rows = progs
        .map((p) => ({ status: String(p.caption || '').trim(), ymd: toYmdLoose(p.date) }))
        .filter((x) => x.status && x.ymd);
      const status = row.status || '';
      const candidates = progs.filter((p) => isStatusLikelySame(p.caption, status) && toYmdLoose(p.date));
      const chosen =
        candidates.find((p) => p.finished) ||
        candidates.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] ||
        null;
      const ymd = toYmdLoose(chosen?.date) || toYmdLoose(detail.updtdt);
      if (ymd) {
        row.receive_date = ymd;
        matched += chosen ? 1 : 0;
        ok += 1;
      } else {
        failed += 1;
      }
    } catch (e) {
      failed += 1;
    }
  }
  console.log(`${logTag} 深交所详情状态日期补齐：跳过新备案=${skippedFresh} 命中=${matched} 成功=${ok} 失败=${failed}`);
  return { ok, failed, matched };
}

async function enrichSseStatusDate(rows, logTag) {
  const targets = (Array.isArray(rows) ? rows : []).filter((r) => r.exchange === '\u4e0a\u4ea4\u6240' && r._sse_audit_id);
  if (!targets.length) return { ok: 0, failed: 0, matched: 0 };
  let ok = 0;
  let failed = 0;
  let matched = 0;
  let skippedFresh = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const row = targets[i];
    if (row._filing_ymd && row._update_ymd && row._filing_ymd === row._update_ymd) {
      skippedFresh += 1;
      continue;
    }
    try {
      const params = {
        sqlId: 'GP_GPZCZ_XMDTZTTLB',
        stockAuditNum: row._sse_audit_id,
        isPagination: false,
      };
      const { data } = await getWithRetry(
        'https://query.sse.com.cn/commonSoaQuery.do',
        {
          params,
          headers: { Referer: `https://www.sse.com.cn/listing/renewal/ipo/index_listing_detail.shtml?auditId=${row._sse_audit_id}` },
        },
        {
          attempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 4000,
          factor: 2,
          blockedCooldownMs: 15 * 60 * 1000,
          maxBlockedWaits: 2,
          label: `SSE详情 auditId=${row._sse_audit_id} row=${i + 1}/${targets.length}`,
        }
      );
      const list = Array.isArray(data?.result) ? data.result : Array.isArray(data?.pageHelp?.data) ? data.pageHelp.data : [];
      const mapped = list
        .map((x) => ({
          status: sseStatusToZh({
            currStatus: x.auditStatus,
            commitiResult: x.commitiResult,
            registeResult: x.registeResult,
            suspendStatus: x.suspendStatus,
          }),
          ymd: toYmdLoose(x.publishDate || x.qianDate || x.timesave),
        }))
        .filter((x) => x.ymd);
      row._timeline_rows = mapped;
      const status = row.status || '';
      const candidates = mapped.filter((x) => isStatusLikelySame(x.status, status));
      const chosen =
        candidates.sort((a, b) => String(b.ymd || '').localeCompare(String(a.ymd || '')))[0] ||
        mapped.sort((a, b) => String(b.ymd || '').localeCompare(String(a.ymd || '')))[0] ||
        null;
      if (chosen?.ymd) {
        row.receive_date = chosen.ymd;
        matched += candidates.length ? 1 : 0;
        ok += 1;
      } else {
        failed += 1;
      }
    } catch (e) {
      failed += 1;
    }
  }
  console.log(`${logTag} 上交所详情状态日期补齐：跳过新备案=${skippedFresh} 命中=${matched} 成功=${ok} 失败=${failed}`);
  return { ok, failed, matched };
}

async function enrichBseStatusDate(rows, logTag) {
  const targets = (Array.isArray(rows) ? rows : []).filter((r) => r.exchange === '\u5317\u4ea4\u6240' && r._bse_id);
  if (!targets.length) return { ok: 0, failed: 0, matched: 0 };
  let fastApplied = 0;
  targets.forEach((row) => {
    const ymd = toYmdLoose(row._bse_operating_date);
    if (ymd) {
      row.receive_date = ymd;
      fastApplied += 1;
    }
  });
  let skippedFresh = 0;
  const detailTargets = targets.filter((r) => {
    if (r._filing_ymd && r._update_ymd && r._filing_ymd === r._update_ymd) {
      skippedFresh += 1;
      return false;
    }
    return !toYmdLoose(r._bse_operating_date);
  });
  if (!detailTargets.length) {
    console.log(`${logTag} 北交所状态日期补齐：跳过新备案=${skippedFresh} 列表operatingTime直取成功=${fastApplied}（无需详情页）`);
    return { ok: fastApplied, failed: 0, matched: fastApplied };
  }
  await ensureBseCookie();
  let detailUrlTemplates = null;
  try {
    const resp = await axiosJson.get('https://www.bse.cn/audit/project_news.html', {
      headers: {
        Referer: 'https://www.bse.cn/',
        Cookie: bseCookieHeader || undefined,
      },
      responseType: 'text',
    });
    const html = String(resp?.data || '');
    const pickValue = (id) => {
      const re = new RegExp(`<[^>]*id=["']${id}["'][^>]*value=["']([^"']+)["'][^>]*>`, 'i');
      const m = html.match(re);
      return m && m[1] ? String(m[1]).trim() : '';
    };
    const detail = pickValue('project_news_detail');
    const select = pickValue('project_news_select');
    const toAbs = (u) => {
      const s = String(u || '').trim();
      if (!s) return '';
      if (/^https?:\/\//i.test(s)) return s;
      if (s.startsWith('/')) return `https://www.bse.cn${s}`;
      return `https://www.bse.cn/${s}`;
    };
    detailUrlTemplates = [toAbs(detail), toAbs(select)].filter(Boolean);
  } catch (e) {
    detailUrlTemplates = null;
  }
  let ok = 0;
  let failed = 0;
  let matched = 0;
  const failedSamples = [];
  const statusDateRe =
    /(已受理|已问询|上市委会议通过|上市委会议未通过|上市委会议暂缓|提交注册|注册|不予注册|中止|终止)[^\d]{0,24}(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/g;
  for (let i = 0; i < detailTargets.length; i += 1) {
    const row = detailTargets[i];
      const id = String(row._bse_id || '').trim();
      if (!id) {
        failed += 1;
        if (failedSamples.length < 5) {
          failedSamples.push({
            company: row.company || '',
            status: row.status || '',
            id: id || '',
            update: String(row.f_update_time || '').slice(0, 10),
            reason: 'missing_id',
          });
        }
        continue;
      }
      const fromTpl = (Array.isArray(detailUrlTemplates) ? detailUrlTemplates : []).map((tpl) => {
        if (/[?&]id=/.test(tpl)) return tpl.replace(/([?&]id=)[^&#]*/i, `$1${encodeURIComponent(id)}`);
        return `${tpl}${tpl.includes('?') ? '&' : '?'}id=${encodeURIComponent(id)}`;
      });
      const urls = Array.from(
        new Set([
          ...fromTpl,
          `https://www.bse.cn/audit/project_news_detail.html?id=${encodeURIComponent(id)}`,
          `https://www.bse.cn/audit/project_news_details.html?id=${encodeURIComponent(id)}`,
          `https://www.bse.cn/audit/project_detail.html?id=${encodeURIComponent(id)}`,
        ])
      );
      let html = '';
      for (const url of urls) {
        try {
          const resp = await getWithRetry(
            url,
            {
              headers: {
                Referer: 'https://www.bse.cn/audit/project_news.html',
                Cookie: bseCookieHeader || undefined,
              },
              responseType: 'text',
            },
            {
              attempts: 2,
              baseDelayMs: 700,
              maxDelayMs: 5000,
              factor: 2,
              blockedCooldownMs: 15 * 60 * 1000,
              maxBlockedWaits: 1,
              label: `BSE详情 id=${id} row=${i + 1}/${detailTargets.length}`,
            }
          );
          const body = String(resp?.data || '');
          if (body && !/404 Not Found|系统繁忙|302 Found/i.test(body)) {
            html = body;
            break;
          }
        } catch (e) {
          // ignore and try next url
        }
      }
      if (!html) {
        failed += 1;
        if (failedSamples.length < 5) {
          failedSamples.push({
            company: row.company || '',
            status: row.status || '',
            id,
            update: String(row.f_update_time || '').slice(0, 10),
            reason: 'empty_detail_html',
          });
        }
        continue;
      }
      const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const candidates = [];
      let m;
      while ((m = statusDateRe.exec(text))) {
        candidates.push({ status: m[1], ymd: toYmdLoose(m[2]) });
      }
      const status = row.status || '';
      const chosen =
        candidates.find((x) => isStatusLikelySame(x.status, status) && x.ymd) ||
        candidates.find((x) => x.ymd) ||
        null;
      if (chosen?.ymd) {
        row.receive_date = chosen.ymd;
        ok += 1;
        matched += isStatusLikelySame(chosen.status, status) ? 1 : 0;
        return;
      }
      failed += 1;
      if (failedSamples.length < 5) {
        failedSamples.push({
          company: row.company || '',
          status: row.status || '',
          id,
          update: String(row.f_update_time || '').slice(0, 10),
          reason: 'no_status_date_match',
        });
      }
  }
  console.log(
    `${logTag} 北交所状态日期补齐：跳过新备案=${skippedFresh} 列表直取=${fastApplied} 详情命中=${matched} 详情成功=${ok} 详情失败=${failed} 模板=${
      Array.isArray(detailUrlTemplates) && detailUrlTemplates.length ? detailUrlTemplates.join(',') : '-'
    }`
  );
  if (failedSamples.length > 0) {
    const lines = failedSamples.map(
      (x, i) =>
        `  [${i + 1}] 公司=${x.company || '-'} | 状态=${x.status || '-'} | id=${x.id || '-'} | 更新=${x.update || '-'} | 原因=${x.reason}`
    );
    console.log(`${logTag} 北交所详情状态日期补齐失败样本（最多5条）:\n${lines.join('\n')}`);
  }
  return { ok, failed, matched };
}

let bseCookieHeader = '';

function pickCookiePair(setCookieValue) {
  if (!setCookieValue) return '';
  return String(setCookieValue).split(';')[0].trim();
}

function mergeCookieHeader(origin, extraPairs) {
  const m = new Map();
  const add = (s) => {
    const t = String(s || '').trim();
    if (!t) return;
    const idx = t.indexOf('=');
    if (idx <= 0) return;
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    if (!k || !v) return;
    m.set(k, v);
  };
  String(origin || '')
    .split(';')
    .forEach(add);
  (Array.isArray(extraPairs) ? extraPairs : [extraPairs]).forEach(add);
  return Array.from(m.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function ensureBseCookie(forceRefresh = false) {
  if (bseCookieHeader && !forceRefresh) return;
  if (forceRefresh) bseCookieHeader = '';
  const homeRes = await axiosJson.get('https://www.bse.cn/', {
    maxRedirects: 0,
    headers: { Referer: 'https://www.bse.cn/' },
    responseType: 'text',
  });
  const homeSetCookie = homeRes.headers['set-cookie'];
  const headerPairs = (Array.isArray(homeSetCookie) ? homeSetCookie : [homeSetCookie])
    .filter(Boolean)
    .map(pickCookiePair);

  // bse ????? JS ????????document.cookie="C3VK=xxxx; ..."
  const body = String(homeRes.data || '');
  const jsCookieMatches = [...body.matchAll(/document\.cookie\s*=\s*"([^"]+)"/g)];
  const jsPairs = jsCookieMatches.map((m) => pickCookiePair(m[1]));
  bseCookieHeader = mergeCookieHeader('', [...headerPairs, ...jsPairs]);

  // ???????????????????????? cookie???????30x ?????????
  const warmRes = await axiosJson.get('https://www.bse.cn/audit/project_news.html', {
    maxRedirects: 0,
    responseType: 'text',
    headers: {
      Referer: 'https://www.bse.cn/',
      Cookie: bseCookieHeader || undefined,
    },
  });
  const warmSetCookie = warmRes.headers['set-cookie'];
  const warmPairs = (Array.isArray(warmSetCookie) ? warmSetCookie : [warmSetCookie])
    .filter(Boolean)
    .map(pickCookiePair);
  bseCookieHeader = mergeCookieHeader(bseCookieHeader, warmPairs);
}

function bseStatusToZh(code) {
  const m = {
    P01: '\u5df2\u53d7\u7406',
    P02: '\u5df2\u95ee\u8be2',
    P03: '\u4e0a\u5e02\u59d4\u4f1a\u8bae\u901a\u8fc7',
    P04: '\u4e0a\u5e02\u59d4\u4f1a\u8bae\u672a\u901a\u8fc7',
    P05: '\u4e0a\u5e02\u59d4\u4f1a\u8bae\u6682\u7f13',
    P06: '\u63d0\u4ea4\u6ce8\u518c',
    P07: '\u6ce8\u518c',
    P08: '\u4e0d\u4e88\u6ce8\u518c',
    P09: '\u4e2d\u6b62',
    P10: '\u7ec8\u6b62',
  };
  return m[code] || code || '-';
}

function bseTimeToYmd(t) {
  if (t == null) return null;
  if (typeof t === 'object' && t.time != null) {
    const ms = Number(t.time);
    if (!Number.isFinite(ms)) return null;
    // Avoid Intl edge case that may output 24:00:00 at midnight.
    const bj = new Date(ms + 8 * 60 * 60 * 1000);
    const y = bj.getUTCFullYear();
    const m = String(bj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(bj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function bseTimeToSqlDateTime(t) {
  if (t == null || typeof t !== 'object' || t.time == null) return null;
  const ms = Number(t.time);
  if (!Number.isFinite(ms)) return null;
  // Build Beijing local datetime with a stable 00-23 hour range.
  const bj = new Date(ms + 8 * 60 * 60 * 1000);
  const y = bj.getUTCFullYear();
  const m = String(bj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bj.getUTCDate()).padStart(2, '0');
  const h = String(bj.getUTCHours()).padStart(2, '0');
  const mi = String(bj.getUTCMinutes()).padStart(2, '0');
  const s = String(bj.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${mi}:${s}`;
}

function bsePickStatusDateYmd(row) {
  const op = bseTimeToYmd(row?.operatingTime);
  if (op) return op;
  const upd = bseTimeToYmd(row?.updateDate);
  if (upd) return upd;
  return null;
}

async function fetchBseIpoInRange(startYmd, endYmd) {
  await ensureBseCookie();
  const out = [];
  const pageSize = 20;
  let page = 0;
  let totalPages = 1;
  const statetypes = 'P01';
  const needFields = [
    'id',
    'stockCode',
    'stockName',
    'companyName',
    'status',
    'registerAddress',
    'updateDate',
    'receiveDate',
    'operatingTime',
  ].join(',');

  while (page < totalPages && page < 500) {
    const callback = `jsonp_${Date.now()}`;
    const url = 'https://www.bse.cn/projectNewsController/infoResult.do';
    const params = {
      callback,
      page,
      isNewThree: 1,
      sortfield: 'updateDate',
      sorttype: 'desc',
      companyCode: '',
      keyword: '',
      statetypes,
      needFields,
    };
    let resp = await getWithRetry(
      url,
      {
        maxRedirects: 0,
        params,
        headers: {
          Referer: 'https://www.bse.cn/audit/project_news.html',
          Cookie: bseCookieHeader || undefined,
        },
        responseType: 'text',
      },
      { attempts: 4, baseDelayMs: 700, maxDelayMs: 6000, factor: 2, label: `BSE列表 page=${page}` }
    );
    // ??????? 302?????/?????? Cookie ?????
    if (resp.status >= 300 && resp.status < 400) {
      await ensureBseCookie(true);
      resp = await axiosJson.get(url, {
        maxRedirects: 0,
        params,
        headers: {
          Referer: 'https://www.bse.cn/audit/project_news.html',
          Cookie: bseCookieHeader || undefined,
        },
        responseType: 'text',
      });
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers?.location || '';
        throw new Error(`????????(${resp.status})${loc ? ` -> ${loc}` : ''}`);
      }
    }
    const raw = resp.data;
    let parsed;
    try {
      parsed = parseJsonpBody(raw);
    } catch (e) {
      throw new Error(`??? JSONP ????: ${e.message}`);
    }
    const pack = Array.isArray(parsed) ? parsed[0] : parsed;
    const listInfo = pack && pack.listInfo ? pack.listInfo : {};
    totalPages = listInfo.totalPages != null ? Number(listInfo.totalPages) : 1;
    const content = listInfo.content || [];
    let pageMaxYmd = '';
    for (const r of content) {
      const u = bseTimeToYmd(r.updateDate);
      const statusDateYmd = bsePickStatusDateYmd(r) || u;
      const filingYmd = bseTimeToYmd(r.receiveDate) || '';
      if (u && (!pageMaxYmd || u > pageMaxYmd)) pageMaxYmd = u;
      if (!u || !ymdInRange(u, startYmd, endYmd)) continue;
      out.push({
        exchange: '\u5317\u4ea4\u6240',
        board: '\u5317\u4ea4\u6240',
        company: (r.companyName || '').trim(),
        project_name: (r.stockName || '').trim() || (r.companyName || '').trim(),
        status: bseStatusToZh(r.status),
        register_address: (r.registerAddress || '').trim(),
        code: (r.stockCode || '').trim(),
        receive_date: statusDateYmd || null,
        f_update_time: bseTimeToSqlDateTime(r.updateDate),
        _bse_id: r.id ? String(r.id).trim() : '',
        _bse_operating_date: statusDateYmd || '',
        _update_ymd: u || '',
        _filing_ymd: filingYmd,
      });
    }
    if (content.length === 0) break;
    if (shouldStopDescPagedFetch(pageMaxYmd, startYmd)) break;
    page += 1;
  }
  return out;
}

function stringifyFetchedSampleRow(row, idx) {
  const exchange = row.exchange || '-';
  const board = row.board || '-';
  const company = row.company || '-';
  const projectName = row.project_name || company;
  const status = row.status || '-';
  const fUpdateTime = row.f_update_time || '-';
  const receiveDate = row.receive_date || '-';
  const code = row.code || '-';
  return `  [${idx + 1}] ${exchange} | ${board} | ${company} | 项目=${projectName} | 状态=${status} | 更新=${fUpdateTime} | 受理=${receiveDate} | 代码=${code}`;
}

async function logFetchedDetails(logTag, rows, emitLine) {
  const list = Array.isArray(rows) ? rows : [];
  const push = async (s) => {
    if (typeof emitLine === 'function') {
      try {
        await emitLine(s);
      } catch (_) {}
    } else {
      console.log(s);
    }
  };
  if (!list.length) {
    await push(`${logTag} 抓取明细：本次区间内未返回任何记录`);
    return;
  }

  const exchangeCounter = {};
  const exchangeCompanySet = {};
  let minUpdate = '';
  let maxUpdate = '';
  list.forEach((r) => {
    const ex = String(r.exchange || '-').trim() || '-';
    exchangeCounter[ex] = (exchangeCounter[ex] || 0) + 1;
    if (!exchangeCompanySet[ex]) exchangeCompanySet[ex] = new Set();
    if (r.company) exchangeCompanySet[ex].add(String(r.company).trim());
    const t = String(r.f_update_time || '').slice(0, 19);
    if (t) {
      if (!minUpdate || t < minUpdate) minUpdate = t;
      if (!maxUpdate || t > maxUpdate) maxUpdate = t;
    }
  });

  const exchangeSummary = Object.keys(exchangeCounter)
    .sort()
    .map((ex) => `${ex}=${exchangeCounter[ex]}(公司${exchangeCompanySet[ex]?.size || 0})`)
    .join(' / ');
  await push(
    `${logTag} 抓取明细汇总：总记录=${list.length}；按交易所=${exchangeSummary || '-'}；更新时间范围=${minUpdate || '-'} ~ ${maxUpdate || '-'}`
  );

  const sampleLimit = 20;
  const sampleRows = list.slice(0, sampleLimit);
  const lines = sampleRows.map((r, i) => stringifyFetchedSampleRow(r, i));
  await push(`${logTag} 抓取明细样例（原始抓取，最多${sampleLimit}条）:\n${lines.join('\n')}`);
}

const EXCHANGES_IPO_PROGRESS_DEDUPE = ['深交所', '上交所', '北交所', '港交所'];

/**
 * 同步入库前：按与 insertRows 一致的业务键合并历史重复行（仅四家交易所，不含证监会辅导备案）。
 * 业务键包含受理日期（日粒度），同键保留 f_id 最小的一条；其余 F_DeleteMark=1。
 * @returns {Promise<{ softDeleted: number }>}
 */
async function mergeDuplicateIpoProgressExchangeRows(adminId, logTag = '[上市进展爬虫]') {
  const now = new Date();
  const placeholders = EXCHANGES_IPO_PROGRESS_DEDUPE.map(() => '?').join(',');

  // 先清理将被软删的 ipo_progress 所关联的 ipo_project_progress（硬删除，无 F_DeleteMark）
  const delSql = `
    DELETE ipp FROM ipo_project_progress ipp
    INNER JOIN ipo_progress p1 ON ipp.ipo_progress_row_id = p1.f_id AND p1.F_DeleteMark = 0
    INNER JOIN ipo_progress p2
      ON p2.F_DeleteMark = 0
      AND p2.exchange = p1.exchange
      AND p2.company = p1.company
      AND p2.status = p1.status
      AND p2.board = p1.board
      AND COALESCE(DATE(p2.receive_date), DATE(p2.f_update_time)) = COALESCE(DATE(p1.receive_date), DATE(p1.f_update_time))
      AND p2.f_id <> p1.f_id
      AND p2.f_id < p1.f_id
    WHERE p1.exchange IN (${placeholders})`;
  const delHeader = await db.execute(delSql, [...EXCHANGES_IPO_PROGRESS_DEDUPE]);
  const progressDeleted = Number(delHeader?.affectedRows || 0);

  const sql = `
    UPDATE ipo_progress p
    INNER JOIN (
      SELECT p1.f_id
      FROM ipo_progress p1
      INNER JOIN ipo_progress p2
        ON p2.F_DeleteMark = 0
        AND p1.F_DeleteMark = 0
        AND p2.exchange = p1.exchange
        AND p2.company = p1.company
        AND p2.status = p1.status
        AND p2.board = p1.board
        AND COALESCE(DATE(p2.receive_date), DATE(p2.f_update_time)) = COALESCE(DATE(p1.receive_date), DATE(p1.f_update_time))
        AND p2.f_id <> p1.f_id
        AND p2.f_id < p1.f_id
      WHERE p1.exchange IN (${placeholders})
    ) d ON p.f_id = d.f_id
    SET p.F_DeleteMark = 1, p.F_DeleteTime = ?, p.F_DeleteUserId = ?
    WHERE p.F_DeleteMark = 0`;
  const header = await db.execute(sql, [...EXCHANGES_IPO_PROGRESS_DEDUPE, now, adminId]);
  const softDeleted = Number(header?.affectedRows || 0);
  if (softDeleted > 0 || progressDeleted > 0) {
    console.log(`${logTag} 同步前已合并同键重复行，ipo_progress 软删除=${softDeleted}，ipo_project_progress 清理=${progressDeleted}（业务键含受理日期，保留每键 f_id 最小的一条）`);
  }
  return { softDeleted };
}

/**
 * 业务唯一键：交易所 + 公司全称 + 审核状态 + 上市板块 + 受理日期(YYYY-MM-DD)。
 * 同一键仅入库一次；同状态若受理日期相同则视为同一事件，不重复入库。
 * 受理日期优先取时间轴日期（receive_date），无时间轴时回退到 f_update_time。
 */
async function insertRows(rows, adminId, logTag = '[上市进展爬虫]') {
  const { softDeleted: dedupeSoftDeleted } = await mergeDuplicateIpoProgressExchangeRows(adminId, logTag);

  let inserted = 0;
  const updatedEarlier = 0;
  let updatedExisting = 0;
  let revivedExisting = 0;
  let skipped = 0;
  const insertedByExchange = {};
  let skippedNoCompany = 0;
  let skippedNoDate = 0;
  let skippedDupSameOrLater = 0;
  /** @type {{ exchange: string, company: string, project_name: string, status: string, f_update_time: string }[]} */
  const insertedSamples = [];

  for (const r of rows) {
    const company = (r.company || '').trim();
    if (!company) {
      skippedNoCompany += 1;
      skipped += 1;
      continue;
    }
    const dateStr = r.f_update_time ? String(r.f_update_time).slice(0, 10) : '';
    if (!dateStr) {
      skippedNoDate += 1;
      skipped += 1;
      continue;
    }
    // 业务去重日期：优先使用时间轴状态日期（receive_date），无时间轴时回退到 f_update_time
    const dedupeDateStr = r.receive_date ? String(r.receive_date).slice(0, 10) : dateStr;
    const exchange = String(r.exchange || '').trim();
    const status = String(r.status || '-').trim() || '-';
    const board = String(r.board || '').trim();

    const existing = await db.query(
      `SELECT f_id, receive_date, project_name, register_address, code FROM ipo_progress
       WHERE F_DeleteMark = 0
         AND exchange = ?
         AND company = ?
         AND status = ?
         AND board = ?
         AND COALESCE(DATE(receive_date), DATE(f_update_time)) = ?
       ORDER BY f_id ASC LIMIT 1`,
      [exchange, company, status, board, dedupeDateStr]
    );

    if (existing.length) {
      const old = existing[0] || {};
      const newReceive = r.receive_date || null;
      const oldReceive = old.receive_date ? String(old.receive_date).slice(0, 10) : null;
      const oldProject = String(old.project_name || '').trim();
      const oldAddr = String(old.register_address || '').trim();
      const oldCode = String(old.code || '').trim();
      const newProject = String(r.project_name || company).trim();
      const newAddr = String(r.register_address || '').trim();
      const newCode = String(r.code || '').trim();
      const needRefresh =
        oldReceive !== newReceive ||
        oldProject !== newProject ||
        oldAddr !== newAddr ||
        oldCode !== newCode;
      if (needRefresh) {
        await db.execute(
          `UPDATE ipo_progress
           SET receive_date = ?, project_name = ?, register_address = ?, code = ?,
               F_LastModifyUserId = ?, F_LastModifyTime = NOW()
           WHERE f_id = ? AND F_DeleteMark = 0`,
          [newReceive, newProject, newAddr, newCode, adminId, old.f_id]
        );
        updatedExisting += 1;
      }
      skippedDupSameOrLater += 1;
      skipped += 1;
      continue;
    }

    // 同键若存在历史软删记录，优先恢复并以抓取结果覆盖，避免同键反复新增新行。
    const deletedSameKey = await db.query(
      `SELECT f_id FROM ipo_progress
       WHERE F_DeleteMark = 1
         AND exchange = ?
         AND company = ?
         AND status = ?
         AND board = ?
         AND COALESCE(DATE(receive_date), DATE(f_update_time)) = ?
       ORDER BY F_DeleteTime DESC, f_id DESC
       LIMIT 1`,
      [exchange, company, status, board, dedupeDateStr]
    );
    if (deletedSameKey.length) {
      await db.execute(
        `UPDATE ipo_progress SET
           f_create_date = ?, f_update_time = ?, code = ?, project_name = ?, status = ?, register_address = ?,
           receive_date = ?, company = ?, board = ?, exchange = ?,
           F_DeleteMark = 0, F_DeleteTime = NULL, F_DeleteUserId = NULL,
           F_LastModifyUserId = ?, F_LastModifyTime = NOW()
         WHERE f_id = ?`,
        [
          dateStr,
          r.f_update_time || `${dateStr} 00:00:00`,
          r.code || '',
          r.project_name || company,
          status,
          r.register_address || '',
          r.receive_date || null,
          company,
          board,
          exchange,
          adminId,
          deletedSameKey[0].f_id,
        ]
      );
      revivedExisting += 1;
      const ex = exchange || '-';
      insertedByExchange[ex] = (insertedByExchange[ex] || 0) + 1;
      if (insertedSamples.length < 10) {
        insertedSamples.push({
          exchange: ex,
          company,
          project_name: (r.project_name || company).slice(0, 80),
          status: status.slice(0, 40),
          f_update_time: String(r.f_update_time || '').slice(0, 19),
        });
      }
      continue;
    }

    await db.execute(
      `INSERT INTO ipo_progress (
        f_create_date, f_update_time, code, project_name, status, register_address, receive_date,
        company, board, exchange, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime, F_DeleteMark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
      [
        dateStr,
        r.f_update_time || `${dateStr} 00:00:00`,
        r.code || '',
        r.project_name || company,
        status,
        r.register_address || '',
        r.receive_date || null,
        company,
        board,
        exchange,
        adminId,
        adminId,
      ]
    );
    inserted += 1;
    const ex = exchange || '-';
    insertedByExchange[ex] = (insertedByExchange[ex] || 0) + 1;
    if (insertedSamples.length < 10) {
      insertedSamples.push({
        exchange: ex,
        company,
        project_name: (r.project_name || company).slice(0, 80),
        status: status.slice(0, 40),
        f_update_time: String(r.f_update_time || '').slice(0, 19),
      });
    }
  }
  return {
    inserted,
    updatedEarlier,
    updatedExisting,
    revivedExisting,
    skipped,
    dedupeSoftDeleted,
    insertedByExchange,
    skipBreakdown: { skippedNoCompany, skippedNoDate, skippedDupSameOrLater },
    insertedSamples,
  };
}

/**
 * @param {{ startDate: string, endDate: string, logTag?: string, config?: object|null, progressReporter?: (line: string) => Promise<void>|void }} opts
 * @returns {Promise<object>}
 */
async function runListingExchangeCrawler({
  startDate,
  endDate,
  logTag = '[上市进展爬虫]',
  config = null,
  progressReporter = null,
} = {}) {
  const adminRows = await db.query(`SELECT id FROM users WHERE account = 'admin' LIMIT 1`);
  const adminId = adminRows[0]?.id;
  if (!adminId) throw new Error('未找到 account=admin 用户，无法写入上市进展数据');

  const startYmd = String(startDate).trim().slice(0, 10);
  const endYmd = String(endDate).trim().slice(0, 10);
  const start = new Date(`${startYmd}T00:00:00+08:00`);
  const end = new Date(`${endYmd}T23:59:59+08:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('上市进展爬虫：日期区间无效');
  }

  const emit = async (line, err = false) => {
    if (err) console.error(line);
    else console.log(line);
    if (typeof progressReporter === 'function') {
      try {
        await progressReporter(err ? `[stderr] ${line}` : line);
      } catch (_) {}
    }
  };

  await emit(`${logTag} 开始拉取 日期闭区间=${startYmd}~${endYmd}（按各所「更新日期」筛选落在此区间内）`);

  const settled = await Promise.allSettled([
    fetchSzseIpoInRange(startYmd, endYmd),
    fetchSseIpoInRange(startYmd, endYmd),
    fetchBseIpoInRange(startYmd, endYmd),
  ]);
  const labels = ['深交所', '上交所', '北交所'];
  const parts = [[], [], []];
  /** @type {{ exchange: string, message: string }[]} */
  const exchangeErrors = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === 'fulfilled') {
      parts[i] = s.value;
      await emit(`${logTag} ${labels[i]} 接口返回 ${parts[i].length} 条（区间内）`);
    } else {
      const msg = s.reason?.message || String(s.reason);
      exchangeErrors.push({ exchange: labels[i], message: msg });
      await emit(`${logTag} ${labels[i]} 拉取失败: ${msg}`, true);
    }
  }
  const merged = [...parts[0], ...parts[1], ...parts[2]];
  await enrichSzseStatusDate(merged, logTag);
  await enrichSseStatusDate(merged, logTag);
  await enrichBseStatusDate(merged, logTag);
  await migrateStaleTimelineDates(merged, adminId, logTag);
  await pruneMismatchedTimelineRows(merged, adminId, logTag);
  const mergedExpanded = expandRowsWithTimeline(merged, logTag);
  await emit(`${logTag} 三家合并共 ${mergedExpanded.length} 条，开始去重入库 ipo_progress`);
  await logFetchedDetails(logTag, mergedExpanded, (line) => emit(line));

  let ifindIpo = null;
  let hkexIpo = null;
  let mergedAll = mergedExpanded;
  let hkexFetchedRows = 0;
  const cfg = config || {};
  const ifindEnabled = cfg.ifind_enabled === 1 || cfg.ifind_enabled === true;
  await emit(
    `${logTag} 港股阶段开始：iFinD=${ifindEnabled ? '已启用' : '未启用'}；随后执行港交所 hk_ipo_sync.py；最后 insertRows 写沪深北+iFinD 合并结果`
  );
  if (ifindEnabled) {
    const username = decryptText(cfg.ifind_username || '');
    const password = decryptText(cfg.ifind_password || '');
    const token = decryptText(cfg.ifind_token || '');
    ifindIpo = runIfindIpoSync({
      startDate: startYmd,
      endDate: endYmd,
      username,
      password,
      token,
      drCode: cfg.ifind_dr_code || 'p04920',
      queryParams: cfg.ifind_query_params || 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0',
      fields:
        cfg.ifind_fields ||
        'p04920_f001:Y,p04920_f002:Y,p04920_f003:Y,p04920_f004:Y,p04920_f005:Y,p04920_f006:Y,p04920_f037:Y,p04920_f007:Y,p04920_f008:Y,p04920_f021:Y,p04920_f022:Y',
      format: cfg.ifind_format || 'json',
      logTag: `${logTag}[港交所iFinD]`,
    });
    if (ifindIpo.ok && Array.isArray(ifindIpo.rows) && ifindIpo.rows.length > 0) {
      mergedAll = [...mergedExpanded, ...ifindIpo.rows];
      await emit(`${logTag}[港交所iFinD] 合并后总记录=${mergedAll.length}`);
    }
    await emit(
      `${logTag}[港交所iFinD] 阶段结束 ok=${!!ifindIpo?.ok} rows=${Array.isArray(ifindIpo?.rows) ? ifindIpo.rows.length : 0}`
    );
  }

  // 始终跑港交所官方脚本（consolidated index xlsx + 新上市信息页），再与 iFinD 行一起由 insertRows 去重。
  // 若仅在「iFinD 有数据且未开回退」时跳过脚本，会出现网站披露条数多于 iFinD 的漏抓。
  hkexIpo = runHkexAkshareIpoSync({
    startDate: startYmd,
    endDate: endYmd,
    logTag: `${logTag}[港交所]`,
  });
  const officialBuilt = Number(hkexIpo?.summary?.builtRows || 0);
  const ifindN = ifindIpo?.ok && Array.isArray(ifindIpo.rows) ? ifindIpo.rows.length : 0;
  hkexFetchedRows = officialBuilt > 0 ? officialBuilt : ifindN;
  await emit(
    `${logTag}[港交所] 阶段结束 ok=${!!hkexIpo?.ok} skipped=${!!hkexIpo?.skipped} builtRows=${officialBuilt}；开始 insertRows（${mergedAll.length} 条候选）`
  );

  const hkSummary = hkexIpo?.summary;
  if (hkSummary && typeof hkSummary === 'object') {
    await emit(
      `${logTag}[港交所] Python摘要 数据源=${hkSummary.resolvedSource ?? '-'} 生成待写=${hkSummary.builtRows ?? '-'} 新增=${hkSummary.inserted ?? '-'} 跳过=${hkSummary.skipped ?? '-'}`
    );
    const det = hkSummary.builtRowsDetail;
    if (Array.isArray(det) && det.length > 0) {
      await emit(`${logTag}[港交所] 待写入明细共 ${det.length} 条（完整清单见运行 API 的终端日志）`);
    }
  }

  mergedAll = expandHkIpoProgressTradSimpRows(mergedAll);
  const result = await insertRows(mergedAll, adminId, logTag);

  const ins = result.insertedByExchange || {};
  const sb = result.skipBreakdown || {};
  const dsd = result.dedupeSoftDeleted ?? 0;
  const uex = result.updatedExisting ?? 0;
  const rev = result.revivedExisting ?? 0;
  await emit(
    `${logTag} 入库完成 同步前合并软删重复=${dsd} 新增=${result.inserted} 同键刷新=${uex} 恢复软删=${rev} 跳过=${result.skipped}（无公司名=${sb.skippedNoCompany ?? 0} 无更新日=${sb.skippedNoDate ?? 0} ` +
      `同键同更新日期已存在=${sb.skippedDupSameOrLater ?? 0}） ` +
      `分所写入(新增): 深交所=${ins['深交所'] ?? 0} 上交所=${ins['上交所'] ?? 0} 北交所=${ins['北交所'] ?? 0} 港交所=${ins['港交所'] ?? 0}`
  );
  if (result.insertedSamples && result.insertedSamples.length > 0) {
    const lines = result.insertedSamples.map(
      (s, idx) =>
        `  [${idx + 1}] ${s.exchange} | ${s.company} | ${s.project_name} | 状态=${s.status} | 更新=${s.f_update_time}`
    );
    await emit(`${logTag} 本次写入样例（新插入或更正，最多10条）:\n${lines.join('\n')}`);
  } else if (result.inserted === 0 && mergedExpanded.length > 0) {
    await emit(`${logTag} 本次无写入（同交易所+公司+状态+板块+更新日期已存在）`);
  }

  return {
    ...result,
    fetched: {
      szse: parts[0].length,
      sse: parts[1].length,
      bse: parts[2].length,
      hkex: hkexFetchedRows,
      total: mergedExpanded.length,
    },
    hkexSourceMeta: {
      ifindEnabled,
      ifindOk: !!ifindIpo?.ok,
      ifindRows: Array.isArray(ifindIpo?.rows) ? ifindIpo.rows.length : 0,
      ifindError: ifindIpo?.stderr || '',
      officialHkPythonRan: true,
      fallbackTriggered: !!(hkexIpo && !hkexIpo.skipped),
      fallbackOk: !!hkexIpo?.ok,
      fallbackSkipped: !!hkexIpo?.skipped,
      fallbackExitCode: hkexIpo?.exitCode ?? null,
      fallbackSource: hkexIpo?.summary?.resolvedSource || '',
      fallbackSourceRows: Number(hkexIpo?.summary?.sourceRows || 0),
      fallbackBuiltRows: Number(hkexIpo?.summary?.builtRows || 0),
      fallbackError: hkexIpo?.stderr || '',
    },
    exchangeErrors,
    ifindIpo,
    hkexIpo,
  };
}

module.exports = { runListingExchangeCrawler };
