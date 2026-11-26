/**
 * H5 项目估值只读：案件摘要（草稿/版本结论 + 足球场图所需区间），不返回工作台全量 payload
 */
const express = require('express');
const db = require('../db');
const {
  getUserFromHeader,
  isAdminUser,
} = require('../utils/valuation/routeAuth');
const { checkProjectValuationPermission } = require('../utils/valuation/permission');
const { getCase } = require('../utils/valuation/caseService');
const { loadComparison } = require('../utils/valuation/workspaceStore');
const { DRAFT_VERSION_ID } = require('../utils/valuation/targetFinancials');

const router = express.Router();

function fmtTs(v) {
  if (!v) return null;
  return String(v).replace('T', ' ').slice(0, 19);
}

function pickConclusion(c) {
  if (!c) return null;
  return {
    display_yi: c.display_yi || null,
    formula: c.formula || null,
  };
}

/** PC 足球场图 comparison 入参实际是 display_yi */
function footballComparison(c) {
  if (!c?.display_yi) return null;
  return c.display_yi;
}

async function loadDcfExitViews(caseId, versionId) {
  const runs = await db.query(
    `SELECT role_key, exit_view_json
     FROM valuation_dcf_run
     WHERE case_id = ? AND version_id = ?`,
    [caseId, versionId]
  );
  if (!runs.length) return { primary: null, secondary: null };
  const parseExit = (row) => {
    if (!row?.exit_view_json) return null;
    try {
      const exit_view =
        typeof row.exit_view_json === 'string'
          ? JSON.parse(row.exit_view_json)
          : row.exit_view_json;
      return exit_view ? { exit_view, terminals: exit_view.terminals || null } : null;
    } catch {
      return null;
    }
  };
  const primaryRow = runs.find((r) => r.role_key === 'primary') || runs[0];
  const secondaryRow = runs.find((r) => r.role_key === 'secondary');
  return {
    primary: parseExit(primaryRow),
    secondary: secondaryRow ? parseExit(secondaryRow) : null,
  };
}

async function loadDilution(caseId, versionId) {
  const rows = await db.query(
    `SELECT follow_on_dilution FROM valuation_assumption
     WHERE case_id = ? AND version_id = ? LIMIT 1`,
    [caseId, versionId]
  );
  if (!rows.length || rows[0].follow_on_dilution == null || rows[0].follow_on_dilution === '') {
    return null;
  }
  const n = Number(rows[0].follow_on_dilution);
  return Number.isFinite(n) ? n : null;
}

/** 总览：区间图 + 市场法/DCF 卡片所需字段 */
async function buildOverview(caseId, versionId, comparison, dealYi) {
  const { primary, secondary } = await loadDcfExitViews(caseId, versionId);
  const dilution = await loadDilution(caseId, versionId);
  return {
    comparison: footballComparison(comparison),
    primary,
    secondary,
    deal_yi: dealYi != null && dealYi !== '' ? Number(dealYi) : null,
    dilution,
  };
}

async function requireH5ValuationAccess(req, res) {
  const user = await getUserFromHeader(req);
  if (!user) {
    res.status(401).json({ success: false, message: '未登录' });
    return null;
  }
  if (isAdminUser(user)) return user;
  if (await checkProjectValuationPermission(user.id)) return user;
  res.status(403).json({ success: false, message: '无项目估值访问权限' });
  return null;
}

/**
 * GET /api/h5/valuation/cases/:id
 */
router.get('/valuation/cases/:id', async (req, res) => {
  try {
    const user = await requireH5ValuationAccess(req, res);
    if (!user) return;
    req.valUser = user;

    const cse = await getCase(req, req.params.id);
    if (!cse) {
      return res.status(404).json({ success: false, message: '未找到案件' });
    }

    let draftComparison = null;
    let draftUpdatedAt = null;
    let draftOverview = null;
    try {
      draftComparison = await loadComparison(cse.id, DRAFT_VERSION_ID);
      const draftRows = await db.query(
        'SELECT F_LastModifyTime AS updated_at FROM valuation_draft WHERE case_id = ? LIMIT 1',
        [cse.id]
      );
      draftUpdatedAt = draftRows[0]?.updated_at ? fmtTs(draftRows[0].updated_at) : null;
      draftOverview = await buildOverview(
        cse.id,
        DRAFT_VERSION_ID,
        draftComparison,
        cse.round_deal_value_yi
      );
    } catch (e) {
      console.warn('[h5] valuation draft', e.message || e);
    }

    const versions = [];
    for (const v of cse.versions || []) {
      let overview = null;
      try {
        overview = await buildOverview(
          cse.id,
          v.id,
          v.conclusion,
          v.round_deal_value_yi ?? cse.round_deal_value_yi
        );
      } catch (e) {
        console.warn('[h5] valuation version overview', v.id, e.message || e);
      }
      versions.push({
        id: String(v.id),
        version_no: v.version_no,
        remark: v.remark || '',
        round_deal_value_yi: v.round_deal_value_yi,
        created_at: fmtTs(v.created_at),
        conclusion: pickConclusion(v.conclusion),
        overview,
        football: overview,
      });
    }

    const subject = cse.subject || {};
    const data = {
      id: String(cse.id),
      case_type: cse.case_type,
      subject_display_name: cse.subject_display_name || subject.display_name || '',
      enterprise_full_name: subject.enterprise_full_name || subject.display_name || '',
      project_abbreviation: subject.project_abbreviation || '',
      unified_credit_code: subject.unified_credit_code || '',
      round_deal_value_yi: cse.round_deal_value_yi,
      status: cse.status,
      created_at: fmtTs(cse.created_at),
      updated_at: fmtTs(cse.updated_at),
      draft: {
        conclusion: pickConclusion(draftComparison),
        updated_at: draftUpdatedAt,
        overview: draftOverview,
        football: draftOverview,
      },
      versions,
    };

    return res.json({ success: true, data });
  } catch (e) {
    const code = e.code === 403 ? 403 : e.code === 404 ? 404 : 500;
    if (code === 500) console.error('[h5] valuation case detail', e);
    return res.status(code).json({ success: false, message: e.message || '查询失败' });
  }
});

module.exports = router;
