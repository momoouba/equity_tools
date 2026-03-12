const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db');
const { generateId } = require('../utils/idGenerator');

const router = express.Router();

/**
 * 生成分享链接token
 */
function generateShareToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 权限检查中间件
 */
const checkAuth = (req, res, next) => {
  const userId = req.headers['x-user-id'] || null;
  if (!userId) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  req.currentUserId = userId;
  next();
};

/**
 * 创建或更新分享链接
 * POST /api/news-share/create
 * 如果用户已有活跃的分享链接，则更新它；否则创建新的
 */
router.post('/create', checkAuth, async (req, res) => {
  try {
    const userId = req.currentUserId;
    const { hasExpiry, expiryTime, hasPassword, password } = req.body;

    // 检查是否已有活跃的分享链接
    const existingLinks = await db.query(
      `SELECT id, share_token, status
       FROM news_share_links
       WHERE user_id = ? AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    // 处理密码（每次都需要重新生成）
    let passwordHash = null;
    if (hasPassword && password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    // 处理有效期
    let expiryTimeValue = null;
    if (hasExpiry && expiryTime) {
      expiryTimeValue = new Date(expiryTime);
    }

    let shareId, shareToken;

    if (existingLinks.length > 0) {
      // 更新已有链接
      shareId = existingLinks[0].id;
      shareToken = existingLinks[0].share_token;

      // 更新数据库
      await db.execute(
        `UPDATE news_share_links 
         SET has_expiry = ?, expiry_time = ?, has_password = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [
          hasExpiry ? 1 : 0,
          expiryTimeValue,
          hasPassword ? 1 : 0,
          passwordHash,
          shareId,
          userId
        ]
      );
    } else {
      // 创建新链接
      shareToken = generateShareToken();
      shareId = await generateId('news_share_links');

      // 插入数据库
      await db.execute(
        `INSERT INTO news_share_links 
         (id, user_id, share_token, status, has_expiry, expiry_time, has_password, password_hash)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
        [
          shareId,
          userId,
          shareToken,
          hasExpiry ? 1 : 0,
          expiryTimeValue,
          hasPassword ? 1 : 0,
          passwordHash
        ]
      );
    }

    // 生成分享链接URL（前端路由）
    // 开发环境使用前端端口5173，生产环境使用环境变量或默认前端域名
    let frontendHost;
    const requestHost = req.get('host') || '';
    // 判断是否为本地开发环境：检查是否为 localhost:3001 或 127.0.0.1:3001
    if (process.env.NODE_ENV === 'development' || 
        requestHost.includes('localhost:3001') || 
        requestHost.includes('127.0.0.1:3001')) {
      // 开发环境：使用localhost:5173（Vite默认端口）
      frontendHost = 'localhost:5173';
    } else {
      // 生产环境：使用环境变量或从请求头获取
      frontendHost = process.env.FRONTEND_HOST || req.get('host');
    }
    const shareUrl = `${req.protocol}://${frontendHost}/share/${shareToken}`;

    res.json({
      success: true,
      data: {
        id: shareId,
        shareToken,
        shareUrl,
        status: 'active',
        hasExpiry: hasExpiry || false,
        expiryTime: expiryTimeValue,
        hasPassword: hasPassword || false
      }
    });
  } catch (error) {
    console.error('创建/更新分享链接失败:', error);
    res.status(500).json({
      success: false,
      message: '创建/更新分享链接失败：' + error.message
    });
  }
});

/**
 * 获取当前用户最新的活跃分享链接
 * GET /api/news-share/current
 */
router.get('/current', checkAuth, async (req, res) => {
  try {
    const userId = req.currentUserId;

    const links = await db.query(
      `SELECT id, share_token, status, has_expiry, expiry_time, has_password, created_at, updated_at
       FROM news_share_links
       WHERE user_id = ? AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (links.length === 0) {
      return res.json({
        success: true,
        data: null
      });
    }

    const link = links[0];

    // 检查有效期
    let isValid = true;
    if (link.has_expiry && link.expiry_time) {
      const now = new Date();
      const expiryTime = new Date(link.expiry_time);
      if (now > expiryTime) {
        isValid = false;
      }
    }

    // 生成完整URL（前端路由）
    let frontendHost;
    const requestHost = req.get('host') || '';
    // 判断是否为本地开发环境：检查是否为 localhost:3001 或 127.0.0.1:3001
    if (process.env.NODE_ENV === 'development' || 
        requestHost.includes('localhost:3001') || 
        requestHost.includes('127.0.0.1:3001')) {
      frontendHost = 'localhost:5173';
    } else {
      frontendHost = process.env.FRONTEND_HOST || req.get('host');
    }

    res.json({
      success: true,
      data: {
        id: link.id,
        shareToken: link.share_token,
        shareUrl: `${req.protocol}://${frontendHost}/share/${link.share_token}`,
        status: link.status,
        hasExpiry: link.has_expiry === 1,
        expiryTime: link.expiry_time,
        hasPassword: link.has_password === 1,
        isValid: isValid
      }
    });
  } catch (error) {
    console.error('获取当前分享链接失败:', error);
    res.status(500).json({
      success: false,
      message: '获取当前分享链接失败：' + error.message
    });
  }
});

/**
 * 获取当前用户的分享链接列表
 * GET /api/news-share/list
 */
router.get('/list', checkAuth, async (req, res) => {
  try {
    const userId = req.currentUserId;

    const links = await db.query(
      `SELECT id, share_token, status, has_expiry, expiry_time, has_password, created_at, updated_at
       FROM news_share_links
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    // 生成完整URL（前端路由）
    let frontendHost;
    const requestHost = req.get('host') || '';
    // 判断是否为本地开发环境：检查是否为 localhost:3001 或 127.0.0.1:3001
    if (process.env.NODE_ENV === 'development' || 
        requestHost.includes('localhost:3001') || 
        requestHost.includes('127.0.0.1:3001')) {
      frontendHost = 'localhost:5173';
    } else {
      frontendHost = process.env.FRONTEND_HOST || req.get('host');
    }
    const linksWithUrl = links.map(link => ({
      ...link,
      shareUrl: `${req.protocol}://${frontendHost}/share/${link.share_token}`
    }));

    res.json({
      success: true,
      data: linksWithUrl
    });
  } catch (error) {
    console.error('获取分享链接列表失败:', error);
    res.status(500).json({
      success: false,
      message: '获取分享链接列表失败：' + error.message
    });
  }
});

/**
 * 更新分享链接设置
 * PUT /api/news-share/:id
 */
router.put('/:id', checkAuth, async (req, res) => {
  try {
    const userId = req.currentUserId;
    const shareId = req.params.id;
    const { status, hasExpiry, expiryTime, hasPassword, password } = req.body;

    // 检查链接是否存在且属于当前用户
    const existingLinks = await db.query(
      'SELECT * FROM news_share_links WHERE id = ? AND user_id = ?',
      [shareId, userId]
    );

    if (existingLinks.length === 0) {
      return res.status(404).json({
        success: false,
        message: '分享链接不存在或无权访问'
      });
    }

    const updateFields = [];
    const updateValues = [];

    // 更新状态
    if (status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }

    // 更新有效期设置
    if (hasExpiry !== undefined) {
      updateFields.push('has_expiry = ?');
      updateValues.push(hasExpiry ? 1 : 0);
    }

    // 更新有效期时间
    if (expiryTime !== undefined) {
      updateFields.push('expiry_time = ?');
      updateValues.push(hasExpiry && expiryTime ? new Date(expiryTime) : null);
    }

    // 更新密码设置
    if (hasPassword !== undefined) {
      updateFields.push('has_password = ?');
      updateValues.push(hasPassword ? 1 : 0);
    }

    // 更新密码
    if (password !== undefined) {
      if (hasPassword && password) {
        const passwordHash = await bcrypt.hash(password, 10);
        updateFields.push('password_hash = ?');
        updateValues.push(passwordHash);
      } else {
        updateFields.push('password_hash = ?');
        updateValues.push(null);
      }
    }

    if (updateFields.length === 0) {
      return res.json({
        success: true,
        message: '没有需要更新的字段'
      });
    }

    updateValues.push(shareId, userId);

    await db.execute(
      `UPDATE news_share_links 
       SET ${updateFields.join(', ')}
       WHERE id = ? AND user_id = ?`,
      updateValues
    );

    res.json({
      success: true,
      message: '更新成功'
    });
  } catch (error) {
    console.error('更新分享链接失败:', error);
    res.status(500).json({
      success: false,
      message: '更新分享链接失败：' + error.message
    });
  }
});

/**
 * 删除分享链接
 * DELETE /api/news-share/:id
 */
router.delete('/:id', checkAuth, async (req, res) => {
  try {
    const userId = req.currentUserId;
    const shareId = req.params.id;

    // 检查链接是否存在且属于当前用户
    const existingLinks = await db.query(
      'SELECT * FROM news_share_links WHERE id = ? AND user_id = ?',
      [shareId, userId]
    );

    if (existingLinks.length === 0) {
      return res.status(404).json({
        success: false,
        message: '分享链接不存在或无权访问'
      });
    }

    await db.execute(
      'DELETE FROM news_share_links WHERE id = ? AND user_id = ?',
      [shareId, userId]
    );

    res.json({
      success: true,
      message: '删除成功'
    });
  } catch (error) {
    console.error('删除分享链接失败:', error);
    res.status(500).json({
      success: false,
      message: '删除分享链接失败：' + error.message
    });
  }
});

/**
 * 通过token获取分享链接信息（用于验证）
 * GET /api/news-share/verify/:token
 */
router.get('/verify/:token', async (req, res) => {
  try {
    const token = req.params.token;

    const links = await db.query(
      `SELECT id, user_id, status, has_expiry, expiry_time, has_password
       FROM news_share_links
       WHERE share_token = ?`,
      [token]
    );

    if (links.length === 0) {
      return res.status(404).json({
        success: false,
        message: '分享链接不存在'
      });
    }

    const link = links[0];

    // 检查状态
    if (link.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: '分享链接已禁用'
      });
    }

    // 检查有效期
    if (link.has_expiry && link.expiry_time) {
      const now = new Date();
      const expiryTime = new Date(link.expiry_time);
      if (now > expiryTime) {
        return res.status(403).json({
          success: false,
          message: '分享链接已过期'
        });
      }
    }

    res.json({
      success: true,
      data: {
        userId: link.user_id,
        hasPassword: link.has_password === 1
      }
    });
  } catch (error) {
    console.error('验证分享链接失败:', error);
    res.status(500).json({
      success: false,
      message: '验证分享链接失败：' + error.message
    });
  }
});

/**
 * 验证分享链接密码
 * POST /api/news-share/verify-password/:token
 */
router.post('/verify-password/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const { password } = req.body;

    const links = await db.query(
      `SELECT id, user_id, password_hash, status, has_expiry, expiry_time, has_password
       FROM news_share_links
       WHERE share_token = ?`,
      [token]
    );

    if (links.length === 0) {
      return res.status(404).json({
        success: false,
        message: '分享链接不存在'
      });
    }

    const link = links[0];

    // 检查状态
    if (link.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: '分享链接已禁用'
      });
    }

    // 检查有效期
    if (link.has_expiry && link.expiry_time) {
      const now = new Date();
      const expiryTime = new Date(link.expiry_time);
      if (now > expiryTime) {
        return res.status(403).json({
          success: false,
          message: '分享链接已过期'
        });
      }
    }

    // 检查密码
    if (link.has_password === 1) {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: '请输入密码'
        });
      }

      if (!link.password_hash) {
        return res.status(500).json({
          success: false,
          message: '密码验证失败'
        });
      }

      const isValidPassword = await bcrypt.compare(password, link.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: '密码错误'
        });
      }
    }

    res.json({
      success: true,
      data: {
        userId: link.user_id
      }
    });
  } catch (error) {
    console.error('验证密码失败:', error);
    res.status(500).json({
      success: false,
      message: '验证密码失败：' + error.message
    });
  }
});

/**
 * 通过分享链接获取舆情信息（公共接口，不需要认证）
 * GET /api/news-share/news/:token
 */
router.get('/news/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const { page = 1, pageSize = 10, timeRange = 'all', search = '', enterpriseFilter = 'all' } = req.query;

    // 验证token
    const links = await db.query(
      `SELECT user_id, status, has_expiry, expiry_time
       FROM news_share_links
       WHERE share_token = ?`,
      [token]
    );

    if (links.length === 0) {
      return res.status(404).json({
        success: false,
        message: '分享链接不存在'
      });
    }

    const link = links[0];

    // 检查状态
    if (link.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: '分享链接已禁用'
      });
    }

    // 检查有效期
    if (link.has_expiry && link.expiry_time) {
      const now = new Date();
      const expiryTime = new Date(link.expiry_time);
      if (now > expiryTime) {
        return res.status(403).json({
          success: false,
          message: '分享链接已过期'
        });
      }
    }

    const userId = link.user_id;

    // 获取用户信息以判断是否为管理员
    const users = await db.query(
      'SELECT role FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    const isAdmin = users[0].role === 'admin';

    // 构建查询条件
    let whereConditions = [];
    let queryParams = [];

    // 时间范围过滤（使用北京时区）
    if (timeRange !== 'all') {
      const now = new Date();
      // 使用北京时区获取当前日期
      const beijingDateStr = now.toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const [beijingYear, beijingMonth, beijingDay] = beijingDateStr.split(/[\/\-]/).map(Number);
      const beijingNow = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-${String(beijingDay).padStart(2, '0')}T00:00:00+08:00`);
      
      let startDate = null;

      switch (timeRange) {
        case 'yesterday':
          // 昨日舆情：显示今天创建的数据（created_at是今天，北京时区）
          const todayStart = new Date(beijingNow);
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date(beijingNow);
          todayEnd.setHours(23, 59, 59, 999);
          whereConditions.push('nd.created_at >= ? AND nd.created_at <= ?');
          queryParams.push(todayStart, todayEnd);
          break;
        case 'thisWeek':
          // 本周：本周一00:00:00到现在（北京时区）
          const beijingDayOfWeek = beijingNow.getDay(); // 0=周日, 1=周一, ..., 6=周六
          const daysToMonday = beijingDayOfWeek === 0 ? 6 : beijingDayOfWeek - 1; // 0是周日，需要调整
          const thisWeekStart = new Date(beijingNow);
          thisWeekStart.setDate(thisWeekStart.getDate() - daysToMonday);
          thisWeekStart.setHours(0, 0, 0, 0);
          whereConditions.push('nd.public_time >= ?');
          queryParams.push(thisWeekStart);
          break;
        case 'lastWeek':
          // 上周：上周一00:00:00到上周日23:59:59（北京时区）
          const beijingDayOfWeekForLast = beijingNow.getDay(); // 0=周日, 1=周一, ..., 6=周六
          // 计算上周一：周日需要回退14天（本周一往前推7天），其他天回退(dayOfWeek - 1 + 7)天
          const daysToLastMonday = beijingDayOfWeekForLast === 0 ? 14 : beijingDayOfWeekForLast - 1 + 7; // 上周一
          const lastWeekStart = new Date(beijingNow);
          lastWeekStart.setDate(lastWeekStart.getDate() - daysToLastMonday);
          lastWeekStart.setHours(0, 0, 0, 0);
          const lastWeekEnd = new Date(lastWeekStart);
          lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);
          lastWeekEnd.setHours(23, 59, 59, 999);
          whereConditions.push('nd.public_time >= ? AND nd.public_time <= ?');
          queryParams.push(lastWeekStart, lastWeekEnd);
          break;
        case 'thisMonth':
          // 本月：本月1日00:00:00到现在（北京时区）
          const thisMonthStart = new Date(`${beijingYear}-${String(beijingMonth).padStart(2, '0')}-01T00:00:00+08:00`);
          whereConditions.push('nd.public_time >= ?');
          queryParams.push(thisMonthStart);
          break;
      }
    }

    // 权限过滤：如果不是管理员，只显示用户创建的被投企业相关的新闻
    if (!isAdmin) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM invested_enterprises ie
        WHERE ie.creator_user_id = ? AND ie.enterprise_full_name = nd.enterprise_full_name
      )`);
      queryParams.push(userId);
    }

    // 搜索条件（支持多标签搜索）
    const searchTags = req.query.searchTags ? req.query.searchTags.split(',').filter(tag => tag.trim()) : [];
    if (searchTags.length > 0) {
      // 多标签搜索：每个标签都要匹配至少一个字段
      const tagConditions = searchTags.map(() => `(
        nd.title LIKE ? OR 
        nd.account_name LIKE ? OR 
        nd.wechat_account LIKE ?
      )`).join(' AND ');
      whereConditions.push(`(${tagConditions})`);
      searchTags.forEach(tag => {
        const searchPattern = `%${tag.trim()}%`;
        queryParams.push(searchPattern, searchPattern, searchPattern);
      });
    } else if (search) {
      whereConditions.push(`(
        nd.title LIKE ? OR 
        nd.account_name LIKE ? OR 
        nd.wechat_account LIKE ?
      )`);
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    // 企业相关过滤（客户端过滤，这里先获取所有数据）
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // 查询总数
    const countQuery = `
      SELECT COUNT(*) as total
      FROM news_detail nd
      ${whereClause}
    `;
    const countResult = await db.query(countQuery, queryParams);
    const total = countResult[0].total;

    // 查询数据
    const dataQuery = `
      SELECT 
        nd.id,
        nd.title,
        nd.content,
        nd.source_url,
        nd.public_time,
        nd.created_at,
        nd.account_name,
        nd.wechat_account,
        nd.enterprise_full_name,
        nd.enterprise_abbreviation,
        nd.entity_type,
        nd.fund,
        nd.sub_fund,
        nd.news_abstract,
        nd.keywords,
        nd.news_sentiment
      FROM news_detail nd
      ${whereClause}
      ORDER BY nd.public_time DESC
      LIMIT ? OFFSET ?
    `;

    const pageNum = parseInt(page, 10);
    const pageSizeNum = parseInt(pageSize, 10);
    const offset = (pageNum - 1) * pageSizeNum;

    queryParams.push(pageSizeNum, offset);
    const newsData = await db.query(dataQuery, queryParams);

    // 处理关键词（如果是JSON字符串，解析为数组）
    const processedNews = newsData.map(news => {
      let keywords = [];
      if (news.keywords) {
        try {
          // 尝试解析JSON字符串
          if (typeof news.keywords === 'string') {
            // 先检查是否是有效的JSON
            const trimmed = news.keywords.trim();
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              const parsed = JSON.parse(trimmed);
              keywords = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
            } else if (trimmed !== '') {
              // 如果不是JSON格式，作为单个关键词处理
              keywords = [trimmed];
            }
          } else if (Array.isArray(news.keywords)) {
            keywords = news.keywords;
          } else if (news.keywords !== null && news.keywords !== undefined) {
            keywords = [String(news.keywords)];
          }
        } catch (e) {
          // 解析失败，尝试作为普通字符串处理
          console.warn('解析keywords失败:', e.message, '原始值:', news.keywords);
          if (typeof news.keywords === 'string' && news.keywords.trim() !== '') {
            keywords = [news.keywords.trim()];
          }
        }
      }
      return {
        ...news,
        keywords: Array.isArray(keywords) ? keywords.filter(k => k && k.trim() !== '') : []
      };
    });

    // 应用企业相关过滤
    let filteredNews = processedNews;
    if (enterpriseFilter === 'enterprise') {
      filteredNews = processedNews.filter(news => 
        news.enterprise_full_name && news.enterprise_full_name.trim() !== ''
      );
    }

    res.json({
      success: true,
      data: filteredNews,
      total: enterpriseFilter === 'enterprise' ? filteredNews.length : total,
      page: pageNum,
      pageSize: pageSizeNum
    });
  } catch (error) {
    console.error('获取分享的舆情信息失败:', error);
    res.status(500).json({
      success: false,
      message: '获取舆情信息失败：' + error.message
    });
  }
});

module.exports = router;

