/**
 * H5 融资事件只读接口（三期起步：详情）
 */
const express = require('express');
const db = require('../db');
const {
  getUserFromHeader,
  isAdminUser,
} = require('../utils/project-sourcing/projectSourcingRouteAuth');
const { checkProjectSourcingPermission } = require('../utils/project-sourcing/projectSourcingPermission');

const router = express.Router();

const DETAIL_SELECT = `
  F_Id AS id, event_id, event_date, company_name, company_credit_code,
  project_name, project_desc, latest_round, round,
  funding_amt_raw, estimated_amt_raw, post_valuation_raw,
  industry_source_lv1, industry_source_lv2,
  track_primary, track_secondary,
  investor_names, lead_investor, funding_status,
  ai_product_intro, ai_company_tags_display
`;

async function requireH5FinancingAccess(req, res) {
  const user = await getUserFromHeader(req);
  if (!user) {
    res.status(401).json({ success: false, message: '未登录' });
    return null;
  }
  if (isAdminUser(user)) return user;
  if (await checkProjectSourcingPermission(user.id)) return user;
  res.status(403).json({ success: false, message: '无项目挖掘访问权限' });
  return null;
}

/**
 * GET /api/h5/financing-events/:id
 */
router.get('/financing-events/:id', async (req, res) => {
  try {
    const user = await requireH5FinancingAccess(req, res);
    if (!user) return;

    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: '缺少 id' });
    }

    const rows = await db.query(
      `SELECT ${DETAIL_SELECT}
       FROM sourcing_financing_event
       WHERE F_Id = ? AND IFNULL(F_DeleteMark, 0) = 0
       LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '未找到该记录' });
    }
    const row = rows[0];
    return res.json({
      success: true,
      data: {
        ...row,
        id: row.id != null ? String(row.id) : row.id,
        event_date: row.event_date
          ? String(row.event_date).slice(0, 10)
          : row.event_date,
      },
    });
  } catch (e) {
    console.error('[h5] financing-events detail', e);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

module.exports = router;
