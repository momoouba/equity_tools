/**
 * 一次性数据迁移：将 ipo_progress 表中境外发行备案行的 project_name / company
 * 从繁体统一为简体，与 normalizeOverseasNameKey / canonicalCompanyForMatchCross 对齐。
 *
 * 幂等：已简体的行不受影响（WHERE 条件过滤掉无需变更的行）。
 */
const { normalizeCompanyName, containsTraditional } = require('./zhconvUtils');

/**
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<number>} 更新的行数
 */
async function migrateOverseasNameNormalization(pool) {
  const [rows] = await pool.query(
    `SELECT f_id, project_name, company
     FROM ipo_progress
     WHERE F_DeleteMark = 0 AND board = '境外发行备案'`
  );
  if (!rows.length) return 0;

  let updated = 0;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const r of rows) {
      const rawName = String(r.project_name || '');
      const rawCompany = String(r.company || '');
      // 仅处理含繁体字符的行
      if (!containsTraditional(rawName) && !containsTraditional(rawCompany)) continue;

      const newName = containsTraditional(rawName) ? normalizeCompanyName(rawName) : rawName;
      const newCompany = containsTraditional(rawCompany) ? normalizeCompanyName(rawCompany) : rawCompany;

      if (newName === rawName && newCompany === rawCompany) continue;

      await conn.execute(
        `UPDATE ipo_progress SET project_name = ?, company = ?, F_LastModifyTime = NOW()
         WHERE f_id = ? AND F_DeleteMark = 0`,
        [newName, newCompany, r.f_id]
      );
      updated += 1;
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    console.error('[migrateOverseasNameNormalization] 迁移失败，已回滚:', e.message);
    throw e;
  } finally {
    conn.release();
  }

  if (updated > 0) {
    console.log(`[migrateOverseasNameNormalization] 已清洗 ${updated} 条境外备案繁简不一致数据`);
  }
  return updated;
}

module.exports = { migrateOverseasNameNormalization };
