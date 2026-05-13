const db = require('../../db');
const { DATA_APP_PROJECT_SOURCING } = require('../enterpriseDataApp');
const { fetchCompanyBriefGetInfo } = require('../qichachaCompanyBrief');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickQccSearchKey(row) {
  const credit = row.unified_credit_code != null ? String(row.unified_credit_code).replace(/\s+/g, '').trim() : '';
  if (credit.length >= 2) return credit;
  const name = row.enterprise_full_name != null ? String(row.enterprise_full_name).trim() : '';
  if (name.length >= 2) return name;
  return '';
}

/**
 * 单条：拉取企查查企业简介并写入 invested_enterprises。
 * @param {string} enterpriseId
 * @returns {Promise<{ ok: true, desc_len: number, search_key_hint: string }>}
 */
async function syncInvestedEnterpriseQccCompanyBrief(enterpriseId) {
  const id = String(enterpriseId || '').trim();
  if (!id) {
    const e = new Error('无效的企业 id');
    e.code = 400;
    throw e;
  }
  const rows = await db.query(
    `SELECT id, enterprise_full_name, unified_credit_code, data_app_name, delete_mark
     FROM invested_enterprises WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length || Number(rows[0].delete_mark) !== 0) {
    const e = new Error('被投企业不存在或已删除');
    e.code = 404;
    throw e;
  }
  if (String(rows[0].data_app_name || '') !== DATA_APP_PROJECT_SOURCING) {
    const e = new Error('仅支持项目挖掘应用下的被投企业');
    e.code = 400;
    throw e;
  }
  const searchKey = pickQccSearchKey(rows[0]);
  if (!searchKey) {
    const e = new Error('统一社会信用代码或企业全称至少 2 个字符方可查询企查查企业简介');
    e.code = 400;
    throw e;
  }

  const r = await fetchCompanyBriefGetInfo(searchKey);
  const desc = r.desc;
  const intro = desc != null && String(desc).trim() !== '' ? String(desc).trim() : null;

  await db.execute(
    `UPDATE invested_enterprises SET
       qcc_company_intro = ?,
       qcc_sync_at = NOW(),
       qcc_sync_error = NULL,
       updated_at = NOW()
     WHERE id = ? AND delete_mark = 0`,
    [intro, id]
  );

  const hint =
    searchKey.length > 18 ? `${searchKey.slice(0, 10)}…(${searchKey.length}字)` : searchKey;
  return {
    ok: true,
    desc_len: intro ? intro.length : 0,
    search_key_hint: hint,
  };
}

/**
 * 批量：按 id 顺序调用，间隔减轻频控（毫秒）。
 * @param {string[]} enterpriseIds
 * @param {{ gapMs?: number }} [opts]
 */
async function batchSyncInvestedEnterpriseQccCompanyBrief(enterpriseIds, opts = {}) {
  const gapMs = Math.max(0, Math.min(5000, parseInt(opts.gapMs ?? '400', 10) || 400));
  const ids = Array.from(new Set((enterpriseIds || []).map((x) => String(x || '').trim()).filter(Boolean)));
  if (!ids.length) {
    return { ok: false, code: 400, message: '请提供至少一个企业 id' };
  }
  if (ids.length > 80) {
    return { ok: false, code: 400, message: '单次最多同步 80 条，请分批操作' };
  }
  const results = [];
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < ids.length; i++) {
    const eid = ids[i];
    try {
      const one = await syncInvestedEnterpriseQccCompanyBrief(eid);
      ok += 1;
      results.push({ id: eid, success: true, desc_len: one.desc_len });
    } catch (err) {
      fail += 1;
      const msg = (err && err.message) || String(err);
      try {
        await db.execute(
          `UPDATE invested_enterprises SET qcc_sync_error = ?, updated_at = NOW() WHERE id = ? AND delete_mark = 0`,
          [String(msg).slice(0, 480), eid]
        );
      } catch {
        /* ignore */
      }
      results.push({ id: eid, success: false, error: msg });
    }
    if (i + 1 < ids.length && gapMs > 0) await sleep(gapMs);
  }
  return {
    ok: true,
    data: { total: ids.length, success: ok, failed: fail, results },
  };
}

module.exports = {
  syncInvestedEnterpriseQccCompanyBrief,
  batchSyncInvestedEnterpriseQccCompanyBrief,
};
