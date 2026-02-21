/**
 * 对外 news_detail 只读接口（按 docs/openapi.yaml 实现）
 * 域名：https://news.gf-dsai.com
 * 鉴权：请求头需带 Authorization: Bearer <token> 或 X-Api-Token: <token>，token 存于 users.api_token
 */
const express = require('express');
const db = require('../db');
const { requireApiToken } = require('../middleware/apiTokenAuth');

const router = express.Router();

// 所有对外接口均需携带用户 api_token
router.use(requireApiToken);

function parseKeywords(keywords) {
  if (keywords == null) return null;
  try {
    if (typeof keywords === 'string') return JSON.parse(keywords);
    return keywords;
  } catch (e) {
    return null;
  }
}

/**
 * GET /api/news-detail
 * 分页列表，仅 delete_mark=0；支持 keyword、enterpriseFullName、wechatAccount、entityType、startTime、endTime
 */
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const keyword = (req.query.keyword || '').trim();
    const enterpriseFullName = (req.query.enterpriseFullName || '').trim();
    const wechatAccount = (req.query.wechatAccount || '').trim();
    const entityType = (req.query.entityType || '').trim();
    const startTime = (req.query.startTime || '').trim();
    const endTime = (req.query.endTime || '').trim();

    const conditions = ['delete_mark = 0'];
    const params = [];

    if (keyword) {
      conditions.push('(title LIKE ? OR account_name LIKE ? OR wechat_account LIKE ? OR enterprise_full_name LIKE ?)');
      const term = `%${keyword}%`;
      params.push(term, term, term, term);
    }
    if (enterpriseFullName) {
      conditions.push('enterprise_full_name = ?');
      params.push(enterpriseFullName);
    }
    if (wechatAccount) {
      conditions.push('wechat_account = ?');
      params.push(wechatAccount);
    }
    if (entityType) {
      conditions.push('entity_type = ?');
      params.push(entityType);
    }
    if (startTime) {
      conditions.push('public_time >= ?');
      params.push(startTime);
    }
    if (endTime) {
      conditions.push('public_time <= ?');
      params.push(endTime);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // 列表字段与 OpenAPI NewsDetailListItem 一致（表中可能无 fund/sub_fund 则选不到会为 null）
    const listFields = [
      'id', 'account_name', 'wechat_account', 'enterprise_full_name', 'enterprise_abbreviation',
      'entity_type', 'public_time', 'title', 'source_url', 'keywords',
      'fund', 'sub_fund', 'news_abstract', 'news_sentiment'
    ].join(', ');
    const offset = (page - 1) * pageSize;

    const data = await db.query(
      `SELECT ${listFields}
       FROM news_detail
       ${whereClause}
       ORDER BY public_time DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    const totalRows = await db.query(
      `SELECT COUNT(*) as total FROM news_detail ${whereClause}`,
      params
    );
    const total = totalRows[0]?.total ?? 0;

    const formattedData = data.map((item) => ({
      id: item.id,
      account_name: item.account_name || '',
      wechat_account: item.wechat_account || '',
      enterprise_full_name: item.enterprise_full_name || null,
      enterprise_abbreviation: item.enterprise_abbreviation || null,
      entity_type: item.entity_type || null,
      public_time: item.public_time || null,
      title: item.title || null,
      source_url: item.source_url || null,
      keywords: parseKeywords(item.keywords),
      fund: item.fund ?? null,
      sub_fund: item.sub_fund ?? null,
      news_abstract: item.news_abstract || null,
      news_sentiment: item.news_sentiment || 'neutral'
    }));

    res.json({
      success: true,
      data: formattedData,
      total,
      page,
      pageSize
    });
  } catch (error) {
    console.error('[news-detail] list error:', error);
    res.status(500).json({
      success: false,
      message: '查询失败：' + (error.message || '未知错误')
    });
  }
});

/**
 * GET /api/news-detail/:id
 * 单条详情，不存在或已删除返回 404
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: '缺少 id' });
    }

    const detailFields = [
      'id', 'account_name', 'wechat_account', 'enterprise_full_name', 'enterprise_abbreviation',
      'entity_type', 'created_at', 'source_url', 'title', 'summary', 'public_time',
      'content', 'keywords', 'news_abstract', 'news_sentiment', 'APItype', 'news_category',
      'fund', 'sub_fund'
    ].join(', ');

    const rows = await db.query(
      `SELECT ${detailFields}
       FROM news_detail
       WHERE id = ? AND delete_mark = 0`,
      [id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: '未找到该 ID 或已删除'
      });
    }

    const item = rows[0];
    const data = {
      id: item.id,
      account_name: item.account_name || '',
      wechat_account: item.wechat_account || '',
      enterprise_full_name: item.enterprise_full_name || null,
      enterprise_abbreviation: item.enterprise_abbreviation || null,
      entity_type: item.entity_type || null,
      created_at: item.created_at || null,
      source_url: item.source_url || null,
      title: item.title || null,
      summary: item.summary || null,
      public_time: item.public_time || null,
      content: item.content || null,
      keywords: parseKeywords(item.keywords),
      news_abstract: item.news_abstract || null,
      news_sentiment: item.news_sentiment || 'neutral',
      APItype: item.APItype || null,
      news_category: item.news_category || null,
      fund: item.fund ?? null,
      sub_fund: item.sub_fund ?? null
    };

    res.json({ success: true, data });
  } catch (error) {
    console.error('[news-detail] getById error:', error);
    res.status(500).json({
      success: false,
      message: '查询失败：' + (error.message || '未知错误')
    });
  }
});

module.exports = router;
