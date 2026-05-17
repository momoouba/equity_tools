const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const { isAdminUser } = require('./competitorAnalysisRouteAuth');

/**
 * 竞品分析「底层项目」列表与导出、企查查全量同步共用的 WHERE 子句（不含 ORDER/LIMIT）。
 * @param {{ id?: string|number, role?: string, account?: string }|null} psUser
 * @param {string} [keyword]
 * @param {string} [creatorUserId] admin 筛选创建人 users.id
 */
async function buildProjectSourcingIpoWhereClause({ psUser, keyword = '', creatorUserId = '' }) {
  const kw = String(keyword || '').trim();
  const creator = String(creatorUserId || '').trim();
  const where = ['p.F_DeleteMark = 0'];
  const params = [];

  const psId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  if (psId) {
    where.push('p.data_app_id = ?');
    params.push(psId);
  } else {
    where.push('1=0');
  }

  const user = psUser;
  if (user && !isAdminUser(user)) {
    where.push('p.F_CreatorUserId = ?');
    params.push(user.id);
  } else if (user && isAdminUser(user) && creator) {
    where.push('p.F_CreatorUserId = ?');
    params.push(creator);
  }

  if (kw) {
    const like = `%${kw}%`;
    where.push(
      `(p.project_no LIKE ? OR p.fund LIKE ? OR p.sub LIKE ? OR p.project_name LIKE ? OR p.company LIKE ? OR CAST(p.inv_amount AS CHAR) LIKE ? OR IFNULL(p.unified_credit_code,'') LIKE ? OR IFNULL(p.ai_product_intro,'') LIKE ? OR IFNULL(p.ai_industry_tags_display,'') LIKE ? OR IFNULL(p.qcc_company_intro,'') LIKE ?)`
    );
    params.push(like, like, like, like, like, like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

/** @deprecated 使用 buildCompetitorAnalysisIpoWhereClause */
const buildCompetitorAnalysisIpoWhereClause = buildProjectSourcingIpoWhereClause;

module.exports = {
  buildProjectSourcingIpoWhereClause,
  buildCompetitorAnalysisIpoWhereClause,
};
