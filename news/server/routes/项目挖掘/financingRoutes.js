const db = require('../../db');
const { syncFinancingDateRange } = require('../../utils/项目挖掘/financingIngestService');
const {
  requireProjectSourcingAccess,
  requireAdmin,
} = require('../../utils/项目挖掘/projectSourcingRouteAuth');

function registerFinancingRoutes(router) {
  router.post('/sync', requireAdmin, async (req, res) => {
    try {
      const { config_id, start_date, end_date } = req.body || {};
      if (!config_id || !start_date || !end_date) {
        return res.status(400).json({
          success: false,
          message: '缺少参数：config_id、start_date、end_date（yyyy-MM-dd）',
        });
      }
      const result = await syncFinancingDateRange(
        String(config_id),
        {
          startDate: String(start_date).slice(0, 10),
          endDate: String(end_date).slice(0, 10),
        },
        {
          executionType: 'manual',
          userId: req.psUser && req.psUser.id ? String(req.psUser.id) : null,
        }
      );
      res.json(result);
    } catch (e) {
      console.error('[project-sourcing/sync]', e);
      res.status(500).json({ success: false, message: e.message || '同步失败' });
    }
  });

  router.get('/events', requireProjectSourcingAccess, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 100));
      const offset = (page - 1) * pageSize;
      const keyword = req.query.keyword ? String(req.query.keyword).trim() : '';
      const dateFrom = req.query.date_from ? String(req.query.date_from).slice(0, 10) : '';
      const dateTo = req.query.date_to ? String(req.query.date_to).slice(0, 10) : '';

      const where = ['is_deleted = 0'];
      const params = [];
      if (keyword) {
        where.push('(company_name LIKE ? OR project_name LIKE ? OR company_credit_code LIKE ?)');
        const k = `%${keyword}%`;
        params.push(k, k, k);
      }
      if (dateFrom) {
        where.push('event_date >= ?');
        params.push(dateFrom);
      }
      if (dateTo) {
        where.push('event_date <= ?');
        params.push(dateTo);
      }

      const sqlWhere = `WHERE ${where.join(' AND ')}`;
      const countRows = await db.query(`SELECT COUNT(*) AS total FROM sourcing_financing_event ${sqlWhere}`, params);
      const total = Number(countRows[0].total || 0);

      const rows = await db.query(
        `SELECT id, source_record_id, event_id, event_date, company_name, company_credit_code,
                project_name, project_desc, latest_round, round,
                funding_amt_raw, estimated_amt_raw, post_valuation_raw,
                industry_source_lv1, industry_source_lv2,
                investor_names, lead_investor, funding_status,
                classification_status, created_at, updated_at
         FROM sourcing_financing_event
         ${sqlWhere}
         ORDER BY event_date DESC, id DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset]
      );

      const list = rows.map((r) => ({
        ...r,
        id: r.id != null ? String(r.id) : r.id,
        source_record_id: r.source_record_id != null ? String(r.source_record_id) : r.source_record_id,
      }));

      res.json({
        success: true,
        data: { list, total, page, pageSize },
      });
    } catch (e) {
      console.error('[project-sourcing/events]', e);
      res.status(500).json({ success: false, message: e.message || '查询失败' });
    }
  });
}

module.exports = { registerFinancingRoutes };
