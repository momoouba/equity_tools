const db = require('../../db');
const { collectCompetitorLookupKeys, relationCompetitorKey } = require('./competitorCompanyMatch');
const { upsertComparablePrefForRelation } = require('./competitorComparablePrefService');
const {
  listInvestedEnterpriseCompetitorRuns,
  listPreInvestmentCompetitorRuns,
  getLatestRunIdForInvestedEnterprise,
  getLatestRunIdForPreInvestmentProject,
  getPreviousRunIdByVersionLabel,
} = require('./competitorRunVersionService');

function relationKeys(row) {
  const fields = {
    unified_credit_code: row.unified_credit_code,
    competitor_display_name: row.competitor_display_name,
    competitor_weak_key: row.competitor_weak_key,
  };
  return [...new Set([relationCompetitorKey(fields), ...collectCompetitorLookupKeys(fields)].filter(Boolean))];
}

function subjectTables(subjectType) {
  if (subjectType === 'pre_investment_project') {
    return {
      runTable: 'sourcing_pre_investment_competitor_run',
      subjectColumn: 'pre_investment_project_id',
      relationRunColumn: 'pre_investment_run_id',
      entityTable: 'pre_investment_project',
    };
  }
  return {
    runTable: 'sourcing_competitor_run',
    subjectColumn: 'invested_enterprise_id',
    relationRunColumn: 'run_id',
    entityTable: 'invested_enterprises',
  };
}

async function listRunRelations(subjectType, subjectId, runId) {
  const { subjectColumn, relationRunColumn } = subjectTables(subjectType);
  const typeSql =
    subjectType === 'pre_investment_project'
      ? `subject_type = 'pre_investment_project'`
      : `(subject_type = 'invested_enterprise' OR subject_type IS NULL)`;
  return db.query(
    `SELECT F_Id, competitor_display_name, unified_credit_code, competitor_weak_key,
            include_in_comparable, invested_enterprise_id, pre_investment_project_id, subject_type,
            F_CreatorUserId, human_locked
     FROM sourcing_competitor_relation
     WHERE \`${subjectColumn}\` = ? AND \`${relationRunColumn}\` = ?
       AND ${typeSql}
       AND F_DeleteMark = 0`,
    [subjectId, runId]
  );
}

async function assertNoRunningRun(subjectType, subjectId) {
  const { runTable, subjectColumn } = subjectTables(subjectType);
  const rows = await db.query(
    `SELECT F_Id, status FROM \`${runTable}\`
     WHERE \`${subjectColumn}\` = ? AND F_DeleteMark = 0 AND status IN ('queued', 'running')
     LIMIT 1`,
    [subjectId]
  );
  if (rows.length) {
    const err = new Error('有正在进行的竞品分析，完成或失败后再删除版本');
    err.code = 409;
    throw err;
  }
}

async function rollbackLensMemory(subjectType, subjectId, cutoff) {
  if (!cutoff) return { restored_version: null };
  const { entityTable } = subjectTables(subjectType);
  await db.execute(
    `DELETE FROM sourcing_competition_lens_version
     WHERE subject_type = ? AND subject_id = ? AND F_CreatorTime >= ?`,
    [subjectType, subjectId, cutoff]
  );
  const remain = await db.query(
    `SELECT version, lens_json, F_CreatorTime
     FROM sourcing_competition_lens_version
     WHERE subject_type = ? AND subject_id = ?
     ORDER BY version DESC
     LIMIT 1`,
    [subjectType, subjectId]
  );
  if (!remain.length) {
    await db.execute(
      `UPDATE \`${entityTable}\`
       SET competition_lens_json = NULL, competition_lens_version = 0, competition_lens_at = NULL,
           F_LastModifyTime = NOW()
       WHERE F_Id = ?`,
      [subjectId]
    );
    return { restored_version: null };
  }
  const row = remain[0];
  const json = typeof row.lens_json === 'string' ? row.lens_json : JSON.stringify(row.lens_json);
  await db.execute(
    `UPDATE \`${entityTable}\`
     SET competition_lens_json = ?, competition_lens_version = ?, competition_lens_at = ?,
         F_LastModifyTime = NOW()
     WHERE F_Id = ?`,
    [json, row.version, row.F_CreatorTime, subjectId]
  );
  return { restored_version: row.version };
}

async function clearComparablePrefs(subjectType, subjectId) {
  if (subjectType === 'pre_investment_project') {
    await db.execute(
      `DELETE FROM sourcing_competitor_comparable_pref
       WHERE subject_type = 'pre_investment_project' AND pre_investment_project_id = ?`,
      [subjectId]
    );
    return;
  }
  await db.execute(
    `DELETE FROM sourcing_competitor_comparable_pref
     WHERE subject_type = 'invested_enterprise' AND invested_enterprise_id = ?`,
    [subjectId]
  );
}

async function syncComparableMemory({ subjectType, subjectId, deletedRows, previousRows, userId }) {
  const keep = new Set();
  for (const row of previousRows) {
    for (const key of relationKeys(row)) keep.add(key);
  }
  const drop = new Set();
  for (const row of deletedRows) {
    if (row.F_CreatorUserId || Number(row.human_locked) === 1) continue;
    for (const key of relationKeys(row)) {
      if (!keep.has(key)) drop.add(key);
    }
  }
  for (const row of previousRows) {
    if (row.F_CreatorUserId || Number(row.human_locked) === 1) continue;
    await upsertComparablePrefForRelation(row, Number(row.include_in_comparable) === 1, userId);
  }
  if (!drop.size) return;
  const keys = [...drop];
  const placeholders = keys.map(() => '?').join(',');
  const subjectSql =
    subjectType === 'pre_investment_project'
      ? `subject_type = 'pre_investment_project' AND pre_investment_project_id = ?`
      : `subject_type = 'invested_enterprise' AND invested_enterprise_id = ?`;
  await db.execute(
    `DELETE FROM sourcing_competitor_comparable_pref
     WHERE ${subjectSql} AND competitor_key IN (${placeholders})`,
    [subjectId, ...keys]
  );
}

/**
 * 只删除最新成功版本：该版本竞品数据，以及这一版写下的可比勾选记忆和对标焦点。
 * 上一有效版本成为当前版本，可比记忆改成与上一版勾选一致。
 */
async function deleteLatestCompetitorVersion({ subjectType, subjectId, userId }) {
  const id = String(subjectId || '').trim();
  if (!id) {
    const err = new Error('缺少企业或项目');
    err.code = 400;
    throw err;
  }
  if (!['invested_enterprise', 'pre_investment_project'].includes(subjectType)) {
    const err = new Error('不支持的主体类型');
    err.code = 400;
    throw err;
  }

  await assertNoRunningRun(subjectType, id);

  const runs =
    subjectType === 'pre_investment_project'
      ? await listPreInvestmentCompetitorRuns(id)
      : await listInvestedEnterpriseCompetitorRuns(id);
  const latestId =
    subjectType === 'pre_investment_project'
      ? await getLatestRunIdForPreInvestmentProject(id)
      : await getLatestRunIdForInvestedEnterprise(id);
  if (!latestId) {
    const err = new Error('没有可删除的最新版本');
    err.code = 404;
    throw err;
  }
  const latest = runs.find((run) => String(run.id) === String(latestId)) || null;
  const previousId = getPreviousRunIdByVersionLabel(runs, latestId);
  const { runTable, subjectColumn, relationRunColumn } = subjectTables(subjectType);
  const typeSql =
    subjectType === 'pre_investment_project'
      ? `subject_type = 'pre_investment_project'`
      : `(subject_type = 'invested_enterprise' OR subject_type IS NULL)`;

  const runRows = await db.query(
    `SELECT started_at, F_CreatorTime FROM \`${runTable}\` WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [latestId]
  );
  if (!runRows.length) {
    const err = new Error('最新版本不存在');
    err.code = 404;
    throw err;
  }
  const cutoff = runRows[0].started_at || runRows[0].F_CreatorTime;

  const deletedRows = await listRunRelations(subjectType, id, latestId);
  const previousRows = previousId ? await listRunRelations(subjectType, id, previousId) : [];

  const uid = userId ? String(userId) : null;
  await db.execute(
    `UPDATE sourcing_competitor_relation
     SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?, F_LastModifyTime = NOW()
     WHERE \`${subjectColumn}\` = ? AND \`${relationRunColumn}\` = ?
       AND ${typeSql}
       AND F_DeleteMark = 0
       AND F_CreatorUserId IS NULL
       AND COALESCE(human_locked, 0) = 0`,
    [uid, id, latestId]
  );

  if (previousId) {
    await db.execute(
      `UPDATE sourcing_competitor_relation
       SET \`${relationRunColumn}\` = ?, F_LastModifyTime = NOW()
       WHERE \`${subjectColumn}\` = ? AND \`${relationRunColumn}\` = ?
         AND ${typeSql}
         AND F_DeleteMark = 0
         AND COALESCE(human_locked, 0) = 1`,
      [previousId, id, latestId]
    );
  } else {
    await db.execute(
      `UPDATE sourcing_competitor_relation
       SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?, F_LastModifyTime = NOW()
       WHERE \`${subjectColumn}\` = ? AND \`${relationRunColumn}\` = ?
         AND ${typeSql}
         AND F_DeleteMark = 0`,
      [uid, id, latestId]
    );
  }

  await db.execute(
    `UPDATE \`${runTable}\`
     SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ?, F_LastModifyTime = NOW()
     WHERE F_Id = ? AND F_DeleteMark = 0`,
    [uid, latestId]
  );
  await db.execute(`DELETE FROM sourcing_competitor_run_step_log WHERE run_id = ?`, [latestId]);

  const lens = await rollbackLensMemory(subjectType, id, cutoff);
  if (previousId) {
    await syncComparableMemory({
      subjectType,
      subjectId: id,
      deletedRows,
      previousRows,
      userId: uid,
    });
  } else {
    await clearComparablePrefs(subjectType, id);
  }

  return {
    deleted_run_id: latestId,
    version_label: latest?.version_label || null,
    previous_run_id: previousId,
    restored_lens_version: lens.restored_version,
  };
}

module.exports = {
  deleteLatestCompetitorVersion,
};
