const db = require('../../db');
const {
  buildEvidenceMeta,
  normalizeEvidenceTier,
  scoreFromEvidenceTier,
} = require('./competitorEvidenceUtils');
const { loadInternalDisplayFields } = require('./competitorInternalDisplayLoader');
const { runUnifiedCreditQccSync, isCrossTableUnifiedCredit } = require('./competitorQccCrossTableSync');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const {
  strTrim,
  normalizeCreditCode,
  candidateDedupeKey,
} = require('./competitorMatchUtils');

const VALID_DISPOSITIONS = new Set([
  'confirm',
  'reject_not_competitor',
  'corrected',
  'refresh_evidence',
]);

const VALID_REVIEW_STATUSES = new Set(['pending', 'confirmed', 'dismissed', 'corrected']);

function parseJsonField(raw, fallback = null) {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseEventDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function loadRelationRowFull(relationId) {
  const rows = await db.query(
    `SELECT F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id,
            run_id, pre_investment_run_id, competitor_display_name, unified_credit_code,
            competitor_weak_key, competitor_type, relevance_score, confidence_grade, score_breakdown_json,
            dimension_scores, evidence_summary, evidence_confidence, needs_review,
            evidence_breakdown_json, data_sources_json,
            competitor_product_intro, competitor_tags_display,
            review_status, review_disposition, reviewed_by_user_id, reviewed_at, review_note,
            human_locked, include_in_comparable, F_CreatorUserId AS creator_user_id, F_DeleteMark AS delete_mark
     FROM sourcing_competitor_relation WHERE F_Id = ? LIMIT 1`,
    [relationId]
  );
  return rows[0] || null;
}

async function fetchQccIntroForCredit(credit) {
  const code = normalizeCreditCode(credit);
  if (code.length < 15) return '';
  const psAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  if (!psAppId) return '';
  const rows = await db.query(
    `SELECT qcc_company_intro, COALESCE(biz_update_time, F_LastModifyTime) AS ref_time
     FROM ipo_project
     WHERE F_DeleteMark = 0 AND data_app_id = ? AND unified_credit_code = ?
     ORDER BY COALESCE(biz_update_time, F_LastModifyTime) DESC
     LIMIT 1`,
    [psAppId, code]
  );
  return rows[0] ? { intro: strTrim(rows[0].qcc_company_intro), refTime: rows[0].ref_time } : null;
}

async function fetchLatestEventDate(credit, name) {
  let best = null;
  const code = normalizeCreditCode(credit);
  if (code.length >= 15) {
    const fin = await db.query(
      `SELECT event_date FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND company_credit_code = ?
       ORDER BY event_date DESC LIMIT 1`,
      [code]
    );
    if (fin[0]?.event_date) best = parseEventDate(fin[0].event_date);
    const psAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
    if (psAppId) {
      const ipo = await db.query(
        `SELECT COALESCE(biz_update_time, F_LastModifyTime) AS ref_time FROM ipo_project
         WHERE F_DeleteMark = 0 AND data_app_id = ? AND unified_credit_code = ?
         ORDER BY COALESCE(biz_update_time, F_LastModifyTime) DESC LIMIT 1`,
        [psAppId, code]
      );
      if (ipo[0]?.ref_time) {
        const d = parseEventDate(ipo[0].ref_time);
        if (d && (!best || d > best)) best = d;
      }
    }
  }
  if (!best && name) {
    const fin = await db.query(
      `SELECT event_date FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND TRIM(company_name) = ?
       ORDER BY event_date DESC LIMIT 1`,
      [strTrim(name)]
    );
    if (fin[0]?.event_date) best = parseEventDate(fin[0].event_date);
  }
  return best;
}

async function buildCandidateForEvidence(rel) {
  const credit = normalizeCreditCode(rel.unified_credit_code);
  const name = strTrim(rel.competitor_display_name);
  const internal = await loadInternalDisplayFields(credit, name);
  let qccIntro = '';
  if (credit.length >= 15) {
    const qccRow = await fetchQccIntroForCredit(credit);
    if (qccRow?.intro) qccIntro = qccRow.intro;
  }
  const eventDate = await fetchLatestEventDate(credit, name);
  return {
    product_intro: internal.product_intro || rel.competitor_product_intro || '',
    qcc_intro: qccIntro,
    qcc_intro_effective: qccIntro,
    event_date: eventDate,
  };
}

async function recomputeRelationEvidence(rel) {
  const breakdown = parseJsonField(rel.score_breakdown_json, {});
  const validation = breakdown?.validation || null;
  const sources = parseJsonField(rel.data_sources_json, []);
  const candidate = await buildCandidateForEvidence(rel);
  return buildEvidenceMeta(Array.isArray(sources) ? sources : [], candidate, validation);
}

async function refreshRelationEvidence(relationId) {
  const rel = await loadRelationRowFull(relationId);
  if (!rel || Number(rel.delete_mark) !== 0) {
    const e = new Error('竞品记录不存在');
    e.code = 404;
    throw e;
  }
  const credit = normalizeCreditCode(rel.unified_credit_code);
  if (isCrossTableUnifiedCredit(credit)) {
    try {
      await runUnifiedCreditQccSync(credit);
    } catch (err) {
      console.warn('[relationReview] qcc refresh skipped', relationId, err.message);
    }
  }
  const meta = await recomputeRelationEvidence(rel);
  const productFields = await loadInternalDisplayFields(credit, rel.competitor_display_name);
  await db.execute(
    `UPDATE sourcing_competitor_relation SET
       evidence_confidence = ?, needs_review = ?, evidence_breakdown_json = ?,
       competitor_product_intro = COALESCE(?, competitor_product_intro),
       review_disposition = 'refresh_evidence',
       F_LastModifyTime = NOW()
     WHERE F_Id = ? AND F_DeleteMark = 0`,
    [
      meta.evidenceConfidence,
      meta.needsReview,
      JSON.stringify(meta.evidenceBreakdown),
      productFields.product_intro || null,
      relationId,
    ]
  );
  return { meta, message: meta.needsReview ? '证据已刷新，仍建议人工确认' : '证据已刷新，可信度已提升' };
}

/**
 * @param {object} opts
 * @param {string} opts.relationId
 * @param {string} opts.userId
 * @param {string} opts.disposition confirm|reject_not_competitor|corrected|refresh_evidence
 * @param {string} [opts.note]
 * @param {string} [opts.competitorType]
 * @param {string} [opts.competitorProductIntro]
 * @param {string} [opts.evidenceConfidenceTier] high|medium|low（确认竞品时必选）
 */
async function applyRelationReview(opts) {
  const relationId = String(opts.relationId || '').trim();
  const userId = opts.userId ? String(opts.userId) : null;
  const disposition = String(opts.disposition || '').trim();
  const note = strTrim(opts.note).slice(0, 500) || null;

  if (!VALID_DISPOSITIONS.has(disposition)) {
    const e = new Error('无效的复核处置类型');
    e.code = 400;
    throw e;
  }

  const rel = await loadRelationRowFull(relationId);
  if (!rel || Number(rel.delete_mark) !== 0) {
    const e = new Error('竞品记录不存在');
    e.code = 404;
    throw e;
  }

  if (disposition === 'refresh_evidence') {
    const refreshed = await refreshRelationEvidence(relationId);
    return { relationId, disposition, ...refreshed };
  }

  let reviewStatus = 'confirmed';
  let competitorType = rel.competitor_type;
  let includeComparable = Number(rel.include_in_comparable) === 1 ? 1 : 0;
  let needsReview = 0;
  let humanLocked = 1;
  let evidenceConfidence = rel.evidence_confidence;
  let evidenceBreakdownJson = rel.evidence_breakdown_json;
  let productIntro = rel.competitor_product_intro;

  if (disposition === 'confirm') {
    reviewStatus = 'confirmed';
    needsReview = 0;
    const tier = normalizeEvidenceTier(opts.evidenceConfidenceTier);
    if (!tier) {
      const e = new Error('确认竞品时需选择证据可信度（高/中/低）');
      e.code = 400;
      throw e;
    }
    evidenceConfidence = scoreFromEvidenceTier(tier);
    const bd = parseJsonField(evidenceBreakdownJson, {});
    evidenceBreakdownJson = JSON.stringify({
      ...bd,
      human_confirmed_evidence_tier: tier,
    });
  } else if (disposition === 'reject_not_competitor') {
    reviewStatus = 'dismissed';
    competitorType = 'not_competitor';
    includeComparable = 0;
    needsReview = 0;
  } else if (disposition === 'corrected') {
    reviewStatus = 'corrected';
    const nextType = strTrim(opts.competitorType);
    if (!nextType) {
      const e = new Error('修正类型时需选择竞品类型');
      e.code = 400;
      throw e;
    }
    competitorType = nextType;
    needsReview = 0;
    if (opts.competitorProductIntro != null) {
      productIntro = strTrim(opts.competitorProductIntro) || null;
    }
    if (nextType === 'same_track') includeComparable = 0;
    else if (nextType === 'not_competitor') includeComparable = 0;
  }

  await db.execute(
    `UPDATE sourcing_competitor_relation SET
       review_status = ?, review_disposition = ?, reviewed_by_user_id = ?, reviewed_at = NOW(),
       review_note = ?, human_locked = ?, needs_review = ?,
       competitor_type = ?, include_in_comparable = ?,
       evidence_confidence = ?, evidence_breakdown_json = ?,
       competitor_product_intro = ?,
       F_LastModifyTime = NOW()
     WHERE F_Id = ? AND F_DeleteMark = 0`,
    [
      reviewStatus,
      disposition,
      userId,
      note,
      humanLocked,
      needsReview,
      competitorType,
      includeComparable,
      evidenceConfidence,
      typeof evidenceBreakdownJson === 'string'
        ? evidenceBreakdownJson
        : evidenceBreakdownJson
          ? JSON.stringify(evidenceBreakdownJson)
          : null,
      productIntro,
      relationId,
    ]
  );

  return { relationId, reviewStatus, disposition };
}

async function loadHumanLockedDedupeKeys({ subjectType, investedEnterpriseId, preInvestmentProjectId }) {
  let rows = [];
  if (subjectType === 'pre_investment_project' && preInvestmentProjectId) {
    rows = await db.query(
      `SELECT unified_credit_code, competitor_display_name, competitor_weak_key
       FROM sourcing_competitor_relation
       WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project'
         AND F_DeleteMark = 0 AND human_locked = 1`,
      [preInvestmentProjectId]
    );
  } else if (investedEnterpriseId) {
    rows = await db.query(
      `SELECT unified_credit_code, competitor_display_name, competitor_weak_key
       FROM sourcing_competitor_relation
       WHERE invested_enterprise_id = ? AND F_DeleteMark = 0 AND human_locked = 1
         AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)`,
      [investedEnterpriseId]
    );
  }
  const keys = new Set();
  for (const r of rows) {
    keys.add(
      candidateDedupeKey({
        unified_credit_code: r.unified_credit_code,
        display_name: r.competitor_display_name || r.competitor_weak_key,
      })
    );
  }
  return keys;
}

async function relinkHumanLockedRelationsToRun({
  subjectType,
  investedEnterpriseId,
  preInvestmentProjectId,
  runId,
  preInvestmentRunId,
  executor,
}) {
  const dbExec = executor || db.execute.bind(db);
  if (subjectType === 'pre_investment_project' && preInvestmentProjectId) {
    await dbExec(
      `UPDATE sourcing_competitor_relation
       SET pre_investment_run_id = ?, F_LastModifyTime = NOW()
       WHERE pre_investment_project_id = ? AND subject_type = 'pre_investment_project'
         AND F_DeleteMark = 0 AND human_locked = 1`,
      [preInvestmentRunId || null, preInvestmentProjectId]
    );
  } else if (investedEnterpriseId) {
    await dbExec(
      `UPDATE sourcing_competitor_relation
       SET run_id = ?, F_LastModifyTime = NOW()
       WHERE invested_enterprise_id = ? AND F_DeleteMark = 0 AND human_locked = 1
         AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)`,
      [runId || null, investedEnterpriseId]
    );
  }
}

module.exports = {
  VALID_DISPOSITIONS,
  VALID_REVIEW_STATUSES,
  loadRelationRowFull,
  recomputeRelationEvidence,
  refreshRelationEvidence,
  applyRelationReview,
  loadHumanLockedDedupeKeys,
  relinkHumanLockedRelationsToRun,
};
