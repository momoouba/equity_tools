/**
 * H5 上市进展只读接口（打新详情 / 底层项目上市进展详情）
 */
const express = require('express');
const db = require('../db');
const {
  getUserFromHeader,
  isAdminAccount,
  hasListingFeature,
  LISTING_FEATURE,
} = require('../utils/listing/listingAuth');
const {
  IPP_LIST_DEDUPE_ROW_NUMBER_SQL,
} = require('../utils/listing/listingProjectProgressDedupe');

const router = express.Router();

const NEW_SHARE_SELECT = `
  F_Id AS id, stock_code, stock_name,
  enterprise_full_name_cn, enterprise_full_name_en, enterprise_full_name_display,
  DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
  issue_weekday, issue_price, offer_pe, limit_shares,
  issue_total_wan, expected_raise_amount,
  exchange, DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date,
  win_rate, total_issued_shares, first_day_close, first_day_chg_pct, first_day_market_cap
`;

/**
 * GET /api/h5/listing/new-share/:id
 */
router.get('/listing/new-share/:id', async (req, res) => {
  try {
    const user = await getUserFromHeader(req);
    if (!user) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.NEW_SHARE))) {
      return res.status(403).json({ success: false, message: '无打新日历查看权限' });
    }
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: '缺少 id' });
    }
    const rows = await db.query(
      `SELECT ${NEW_SHARE_SELECT}
       FROM ipo_new_share
       WHERE F_Id = ?
       LIMIT 1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: '未找到该记录' });
    }
    return res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('[h5] new-share detail', e);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

/**
 * GET /api/h5/listing/ipo-project-progress/:id
 * 口径与列表一致：非管理员仅本人创建的持仓进展行
 */
router.get('/listing/ipo-project-progress/:id', async (req, res) => {
  try {
    const user = await getUserFromHeader(req);
    if (!user) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.IPO_PROJECT_PROGRESS))) {
      return res.status(403).json({ success: false, message: '无底层项目上市进展查看权限' });
    }
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: '缺少 id' });
    }

    const where = ['IFNULL(ipp.F_DeleteMark, 0) = 0', 'ipp.F_Id = ?'];
    const params = [id];
    if (!isAdminAccount(user.account)) {
      where.push('ipp.F_CreatorUserId = ?');
      params.push(user.id);
    }

    const rows = await db.query(
      `SELECT * FROM (
         SELECT
           ipp.F_Id AS f_id,
           ipp.F_Id AS id,
           ipp.ipo_progress_row_id,
           ipp.match_source,
           ipp.fund,
           ipp.sub,
           ipp.project_name,
           ipp.company,
           ipp.inv_amount,
           ipp.residual_amount,
           ipp.ratio,
           ipp.ct_amount,
           ipp.ct_residual,
           ipp.status,
           ipp.board,
           ipp.exchange,
           DATE_FORMAT(ipp.F_UpdateTime, '%Y-%m-%d %H:%i:%s') AS f_update_time,
           ip.company AS matched_progress_company,
           ip.project_name AS matched_progress_project_name,
           CASE
             WHEN ipp.match_source = 'new_share' AND ipp.ipo_progress_row_id IS NULL THEN 2
             WHEN ip.F_Id IS NOT NULL AND IFNULL(ip.F_DeleteMark, 0) = 0 THEN 1
             ELSE 0
           END AS matched_progress_valid,
           CASE
             WHEN ipp.ipo_progress_row_id IS NOT NULL
              AND (ip.F_Id IS NULL OR IFNULL(ip.F_DeleteMark, 0) = 1) THEN 1
             ELSE 0
           END AS matched_progress_deleted,
           ${IPP_LIST_DEDUPE_ROW_NUMBER_SQL} AS _dedupe_rn
         FROM ipo_project_progress ipp
         LEFT JOIN ipo_progress ip ON ip.F_Id = ipp.ipo_progress_row_id
         WHERE ${where.join(' AND ')}
       ) t
       WHERE t._dedupe_rn = 1
       LIMIT 1`,
      params
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: '未找到该记录或不在可见范围' });
    }
    return res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('[h5] ipo-project-progress detail', e);
    return res.status(500).json({ success: false, message: e.message || '查询失败' });
  }
});

module.exports = router;
