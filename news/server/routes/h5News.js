/**
 * H5 只读舆情接口（一期）
 * - 口径与 /api/news/user-news 一致：按当前用户创建的监控企业 + 额外公众号可见范围
 * - 管理员在 H5 同样走该口径（不做全量）
 */
const express = require('express');
const db = require('../db');
const { checkNewsPermission } = require('../utils/permissionChecker');
const { IE_NEWS_APP_FILTER_SQL } = require('../utils/investedEnterpriseNewsAppSql');

const router = express.Router();

function splitAccountIds(accountIdsStr) {
  if (!accountIdsStr || typeof accountIdsStr !== 'string') return [];
  return accountIdsStr
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id && id !== '');
}

async function getUserVisibility(userId) {
  const enterprises = await db.query(
    `SELECT DISTINCT wechat_official_account_id, enterprise_full_name
     FROM invested_enterprises
     WHERE ${IE_NEWS_APP_FILTER_SQL} AND F_CreatorUserId = ?
       AND F_DeleteMark = 0`,
    [userId]
  );
  const userAdditionalAccounts = await db.query(
    `SELECT DISTINCT wechat_account_id
     FROM additional_wechat_accounts
     WHERE F_CreatorUserId = ?
       AND status = 'active'
       AND wechat_account_id IS NOT NULL
       AND wechat_account_id != ''
       AND F_DeleteMark = 0`,
    [userId]
  );

  const accountIds = enterprises
    .filter((item) => item.wechat_official_account_id)
    .flatMap((item) => splitAccountIds(item.wechat_official_account_id));
  userAdditionalAccounts.forEach((item) => {
    if (item.wechat_account_id) accountIds.push(item.wechat_account_id);
  });
  const uniqueAccountIds = [...new Set(accountIds)];
  const enterpriseNames = enterprises
    .filter((item) => item.enterprise_full_name)
    .map((item) => item.enterprise_full_name);

  return { uniqueAccountIds, enterpriseNames };
}

function formatNewsRow(item) {
  let keywords = [];
  if (item.keywords) {
    try {
      keywords = typeof item.keywords === 'string' ? JSON.parse(item.keywords) : item.keywords;
    } catch (_) {
      keywords = [];
    }
  }
  return {
    id: item.id || item.F_Id || null,
    account_name: item.account_name || '',
    wechat_account: item.wechat_account || '',
    enterprise_full_name: item.enterprise_full_name || '',
    enterprise_abbreviation: item.enterprise_abbreviation || null,
    public_time: item.public_time || '',
    title: item.title || '',
    source_url: item.source_url || '',
    keywords,
    fund: item.fund || null,
    sub_fund: item.sub_fund || null,
    entity_type: item.entity_type || null,
    news_abstract: item.news_abstract || null,
    news_sentiment: item.news_sentiment || null
  };
}

/**
 * GET /api/h5/news/:id
 */
router.get('/news/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';
    const newsId = String(req.params.id || '').trim();

    if (!userId) {
      return res.status(401).json({ success: false, message: '未登录' });
    }
    if (!newsId) {
      return res.status(400).json({ success: false, message: '缺少新闻 id' });
    }

    // 与 user-news 一致：非管理员需新闻舆情权限；管理员也可访问但数据仍按本人企业口径
    if (userRole !== 'admin') {
      const hasPermission = await checkNewsPermission(userId);
      if (!hasPermission) {
        return res.status(403).json({ success: false, message: '您没有访问舆情信息的权限' });
      }
    }

    const { uniqueAccountIds, enterpriseNames } = await getUserVisibility(userId);
    if (uniqueAccountIds.length === 0 && enterpriseNames.length === 0) {
      return res.status(404).json({ success: false, message: '未找到该舆情或不在可见范围' });
    }

    const conditions = ['F_DeleteMark = 0', 'F_Id = ?'];
    const params = [newsId];
    const scope = [];
    if (uniqueAccountIds.length > 0) {
      scope.push(`wechat_account IN (${uniqueAccountIds.map(() => '?').join(',')})`);
      params.push(...uniqueAccountIds);
    }
    if (enterpriseNames.length > 0) {
      scope.push(`enterprise_full_name IN (${enterpriseNames.map(() => '?').join(',')})`);
      params.push(...enterpriseNames);
    }
    conditions.push(`(${scope.join(' OR ')})`);

    const rows = await db.query(
      `SELECT F_Id AS id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation,
              public_time, title, source_url, keywords, fund, sub_fund, entity_type, news_abstract, news_sentiment
       FROM news_detail
       WHERE ${conditions.join(' AND ')}
       LIMIT 1`,
      params
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: '未找到该舆情或不在可见范围' });
    }

    return res.json({ success: true, data: formatNewsRow(rows[0]) });
  } catch (error) {
    console.error('[h5] 查询舆情详情失败:', error);
    return res.status(500).json({ success: false, message: '查询失败' });
  }
});

module.exports = router;
