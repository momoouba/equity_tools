const db = require('../../db');
const { normalizeCompanyNameForMatch } = require('./listingCompanyNormalize');

/**
 * 匹配 ipo_progress �?ipo_project，笛卡尔组合写入 ipo_project_progress�? * @param {object} opts
 * @param {string} opts.startDate YYYY-MM-DD
 * @param {string} opts.endDate YYYY-MM-DD
 * @param {string|null} [opts.restrictProjectUserId] 若提供则仅该用户的底层项目参与匹配；定时任务�?null 表示全部项目
 */
async function runListingMatchBatch({ startDate, endDate, restrictProjectUserId = null }) {
  const progressRows = await db.query(
    `SELECT * FROM ipo_progress
     WHERE F_DeleteMark = 0
       AND DATE(f_update_time) >= ?
       AND DATE(f_update_time) <= ?
     ORDER BY f_id`,
    [startDate, endDate]
  );

  let projectSql = `SELECT * FROM ipo_project WHERE F_DeleteMark = 0`;
  const projectParams = [];
  if (restrictProjectUserId) {
    projectSql += ` AND F_CreatorUserId = ?`;
    projectParams.push(restrictProjectUserId);
  }
  projectSql += ` ORDER BY f_id`;
  const projectRows = await db.query(projectSql, projectParams);

  const progressIds = progressRows.map((r) => r.f_id);
  if (progressIds.length) {
    const ph = progressIds.map(() => '?').join(',');
    await db.query(`DELETE FROM ipo_project_progress WHERE ipo_progress_row_id IN (${ph})`, progressIds);
  }

  const now = new Date();
  let inserted = 0;

  for (const ip of progressRows) {
    const nip = normalizeCompanyNameForMatch(ip.company);
    for (const p of projectRows) {
      const np = normalizeCompanyNameForMatch(p.company);
      if (!nip || nip !== np) continue;

      await db.execute(
        `INSERT INTO ipo_project_progress (
          f_create_date, F_CreatorUserId, ipo_project_f_id, ipo_progress_row_id,
          fund, sub, project_name, company,
          inv_amount, residual_amount, ratio, ct_amount, ct_residual,
          status, board, exchange, f_update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          now,
          p.F_CreatorUserId,
          p.f_id,
          ip.f_id,
          p.fund,
          p.sub,
          p.project_name,
          p.company,
          p.inv_amount,
          p.residual_amount,
          p.ratio,
          p.ct_amount,
          p.ct_residual,
          ip.status,
          ip.board,
          ip.exchange,
          ip.f_update_time,
        ]
      );
      inserted += 1;
    }
  }

  return {
    progressCount: progressRows.length,
    projectCount: projectRows.length,
    inserted,
  };
}

module.exports = { runListingMatchBatch };
