const db = require('../../db');
const { generateId } = require('../idGenerator');
const { logDataChange } = require('../logger');
const { relationCompetitorKey, collectCompetitorLookupKeys } = require('./competitorCompanyMatch');

async function loadComparablePrefsForSubject({
  subjectType,
  investedEnterpriseId,
  preInvestmentProjectId,
}) {
  const ieId = investedEnterpriseId ? String(investedEnterpriseId) : null;
  const pipId = preInvestmentProjectId ? String(preInvestmentProjectId) : null;
  const rows = await db.query(
    `SELECT competitor_key, include_in_comparable
     FROM sourcing_competitor_comparable_pref
     WHERE subject_type = ?
       AND (invested_enterprise_id <=> ?)
       AND (pre_investment_project_id <=> ?)
       AND include_in_comparable = 1`,
    [subjectType, ieId, pipId]
  );
  const map = new Map();
  for (const r of rows) {
    if (r.competitor_key) map.set(String(r.competitor_key), true);
  }
  return map;
}

async function upsertComparablePref({
  subjectType,
  investedEnterpriseId,
  preInvestmentProjectId,
  competitorKey,
  includeInComparable,
  userId,
}) {
  const ieId = investedEnterpriseId ? String(investedEnterpriseId) : null;
  const pipId = preInvestmentProjectId ? String(preInvestmentProjectId) : null;
  const key = strTrimCompetitorKey(competitorKey);
  if (!key) throw new Error('无效的竞品键');

  const existing = await db.query(
    `SELECT F_Id, include_in_comparable
     FROM sourcing_competitor_comparable_pref
     WHERE subject_type = ?
       AND (invested_enterprise_id <=> ?)
       AND (pre_investment_project_id <=> ?)
       AND competitor_key = ?
     LIMIT 1`,
    [subjectType, ieId, pipId, key]
  );

  const nextVal = includeInComparable ? 1 : 0;
  let recordId;

  if (existing.length) {
    recordId = existing[0].F_Id;
    const oldVal = Number(existing[0].include_in_comparable) === 1 ? '1' : '0';
    const newVal = String(nextVal);
    if (oldVal !== newVal) {
      await db.execute(
        `UPDATE sourcing_competitor_comparable_pref
         SET include_in_comparable = ?, F_LastModifyTime = NOW()
         WHERE F_Id = ?`,
        [nextVal, recordId]
      );
      await logDataChange(
        'sourcing_competitor_comparable_pref',
        recordId,
        { include_in_comparable: oldVal },
        { include_in_comparable: newVal },
        userId
      );
    }
    return { updated: true, include_in_comparable: nextVal, recordId };
  }
  if (nextVal === 1) {
    recordId = await generateId('sourcing_competitor_comparable_pref');
    await db.execute(
      `INSERT INTO sourcing_competitor_comparable_pref (
         F_Id, subject_type, invested_enterprise_id, pre_investment_project_id,
         competitor_key, include_in_comparable, F_CreatorTime, F_LastModifyTime
       ) VALUES (?,?,?,?,?,?,NOW(),NOW())`,
      [recordId, subjectType, ieId, pipId, key, nextVal]
    );
    await logDataChange(
      'sourcing_competitor_comparable_pref',
      recordId,
      { include_in_comparable: '' },
      { include_in_comparable: '1' },
      userId
    );
    return { updated: true, include_in_comparable: nextVal, recordId };
  }
  return { updated: false, include_in_comparable: 0, recordId: null };
}

function strTrimCompetitorKey(k) {
  return k != null ? String(k).trim() : '';
}

function competitorKeyFromRelationRow(rel) {
  return relationCompetitorKey({
    unified_credit_code: rel.unified_credit_code,
    competitor_display_name: rel.competitor_display_name,
    competitor_weak_key: rel.competitor_weak_key,
  });
}

/** 勾选/取消可比时同步写入 canonical 与历史 alias 键，避免重跑后恢复失败 */
async function upsertComparablePrefForRelation(rel, includeInComparable, userId) {
  const subjectType =
    rel.subject_type === 'pre_investment_project' ? 'pre_investment_project' : 'invested_enterprise';
  const fields = {
    unified_credit_code: rel.unified_credit_code,
    competitor_display_name: rel.competitor_display_name,
    competitor_weak_key: rel.competitor_weak_key,
  };
  const canonical = relationCompetitorKey(fields);
  const keys = [...new Set([canonical, ...collectCompetitorLookupKeys(fields)].filter(Boolean))];
  if (!keys.length) throw new Error('无法识别竞品键');

  let last = null;
  for (const competitorKey of keys) {
    last = await upsertComparablePref({
      subjectType,
      investedEnterpriseId: rel.invested_enterprise_id,
      preInvestmentProjectId: rel.pre_investment_project_id,
      competitorKey,
      includeInComparable,
      userId,
    });
  }
  return { ...last, competitor_key: canonical || keys[0] };
}

module.exports = {
  loadComparablePrefsForSubject,
  upsertComparablePref,
  upsertComparablePrefForRelation,
  competitorKeyFromRelationRow,
};
