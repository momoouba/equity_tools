/**
 * 业绩看板应用 - 分享路由
 * 复用 news_share_links 表，通过 link_type='performance' 区分
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../../db');
const { generateId } = require('../../utils/idGenerator');
const { getCurrentUser } = require('../../middleware/auth');

router.use(getCurrentUser);

/**
 * 创建/更新分享链接
 * POST /api/performance/share/create
 */
router.post('/create', async (req, res) => {
  try {
    const userId = req.currentUserId;
    const {
      version,
      hasExpiry,
      expiryTime,
      hasPassword,
      password,
      canExport
    } = req.body;
    
    if (!version) {
      return res.status(400).json({ success: false, message: '版本号不能为空' });
    }
    
    // 检查是否已有活跃的业绩看板分享链接
    const existingLinks = await db.query(
      `SELECT id, share_token FROM news_share_links
       WHERE user_id = ? AND status = 'active' AND link_type = 'performance'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    
    // 处理密码
    let passwordHash = null;
    if (hasPassword && password) {
      passwordHash = await bcrypt.hash(password, 10);
    }
    
    // 处理有效期
    let expiryTimeValue = null;
    if (hasExpiry && expiryTime) {
      expiryTimeValue = new Date(expiryTime);
    }
    
    // 生成分享Token
    const shareToken = crypto.randomBytes(32).toString('hex');
    
    if (existingLinks.length > 0) {
      // 更新已有链接
      await db.execute(
        `UPDATE news_share_links 
         SET share_token = ?, has_expiry = ?, expiry_time = ?, 
             has_password = ?, password_hash = ?, performance_version = ?, can_export = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`,
        [
          shareToken,
          hasExpiry ? 1 : 0,
          expiryTimeValue,
          hasPassword ? 1 : 0,
          passwordHash,
          version,
          canExport ? 1 : 0,
          existingLinks[0].id,
          userId
        ]
      );
    } else {
      // 创建新链接
      const id = await generateId('news_share_links');
      
      await db.execute(
        `INSERT INTO news_share_links 
         (id, user_id, share_token, status, has_expiry, expiry_time, 
          has_password, password_hash, link_type, performance_version, can_export,
          created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, 'performance', ?, ?, NOW(), NOW())`,
        [
          id,
          userId,
          shareToken,
          hasExpiry ? 1 : 0,
          expiryTimeValue,
          hasPassword ? 1 : 0,
          passwordHash,
          version,
          canExport ? 1 : 0
        ]
      );
    }
    
    // 构建分享URL
    const shareUrl = `/performance/share/${shareToken}`;
    
    res.json({
      success: true,
      message: '分享链接已创建',
      data: {
        shareToken,
        shareUrl,
        version,
        hasExpiry: hasExpiry || false,
        expiryTime: expiryTimeValue,
        hasPassword: hasPassword || false,
        canExport: canExport || false
      }
    });
  } catch (error) {
    console.error('创建分享链接失败:', error);
    res.status(500).json({ success: false, message: '创建分享链接失败' });
  }
});

/**
 * 验证分享Token
 * GET /api/performance/share/verify
 */
router.get('/verify', async (req, res) => {
  try {
    const { token, password } = req.query;
    
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token不能为空' });
    }
    
    // 查询分享链接
    const links = await db.query(
      `SELECT * FROM news_share_links 
       WHERE share_token = ? AND link_type = 'performance' AND status = 'active'`,
      [token]
    );
    
    if (links.length === 0) {
      return res.json({ success: false, message: '分享链接无效' });
    }
    
    const link = links[0];
    
    // 检查有效期
    if (link.has_expiry && link.expiry_time) {
      if (new Date() > new Date(link.expiry_time)) {
        return res.json({ success: false, message: '分享链接已过期' });
      }
    }
    
    // 检查密码
    if (link.has_password && link.password_hash) {
      if (!password) {
        return res.json({ success: false, message: '需要访问密码' });
      }
      const isValid = await bcrypt.compare(password, link.password_hash);
      if (!isValid) {
        return res.json({ success: false, message: '密码错误' });
      }
    }
    
    res.json({
      success: true,
      data: {
        valid: true,
        shareId: link.id,
        version: link.performance_version,
        hasExpiry: link.has_expiry === 1,
        expiryTime: link.expiry_time,
        isExpired: link.has_expiry && new Date() > new Date(link.expiry_time),
        canExport: link.can_export === 1
      }
    });
  } catch (error) {
    console.error('验证分享链接失败:', error);
    res.status(500).json({ success: false, message: '验证分享链接失败' });
  }
});

/**
 * 获取分享页面数据
 * GET /api/performance/share/data
 */
router.get('/data', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ success: false, message: 'Token不能为空' });
    }
    
    // 查询分享链接
    const links = await db.query(
      `SELECT * FROM news_share_links 
       WHERE share_token = ? AND link_type = 'performance' AND status = 'active'`,
      [token]
    );
    
    if (links.length === 0) {
      return res.status(404).json({ success: false, message: '分享链接无效' });
    }
    
    const link = links[0];
    const version = link.performance_version;
    
    // 检查有效期
    if (link.has_expiry && link.expiry_time) {
      if (new Date() > new Date(link.expiry_time)) {
        return res.status(403).json({ success: false, message: '分享链接已过期' });
      }
    }
    
    // TODO: 获取完整的业绩看板数据
    // 这里简化处理，仅返回版本信息
    
    res.json({
      success: true,
      data: {
        version,
        canExport: link.can_export === 1,
        // TODO: 添加完整的数据查询
        manager: null,
        funds: [],
        portfolio: null,
        underlying: null
      }
    });
  } catch (error) {
    console.error('获取分享数据失败:', error);
    res.status(500).json({ success: false, message: '获取分享数据失败' });
  }
});

/**
 * 关闭分享链接
 * POST /api/performance/share/close
 */
router.post('/close', async (req, res) => {
  try {
    const userId = req.currentUserId;
    const { shareToken } = req.body;
    
    if (!shareToken) {
      return res.status(400).json({ success: false, message: '分享Token不能为空' });
    }
    
    // 只能关闭自己创建的链接
    await db.execute(
      `UPDATE news_share_links 
       SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
       WHERE share_token = ? AND user_id = ? AND link_type = 'performance'`,
      [shareToken, userId]
    );
    
    res.json({ success: true, message: '分享链接已关闭' });
  } catch (error) {
    console.error('关闭分享链接失败:', error);
    res.status(500).json({ success: false, message: '关闭分享链接失败' });
  }
});

module.exports = router;
