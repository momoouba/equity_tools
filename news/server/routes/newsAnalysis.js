const express = require('express');
const newsAnalysis = require('../utils/newsAnalysis');
const db = require('../db');

const router = express.Router();

// 测试端点
router.get('/test', (req, res) => {
  console.log('收到测试请求');
  res.json({ success: true, message: 'newsAnalysis路由工作正常' });
});

// 权限检查中间件
const checkAdminPermission = (req, res, next) => {
  const userRole = req.headers['x-user-role'] || 'user';
  const userId = req.headers['x-user-id'] || null;

  if (!userId) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  if (userRole !== 'admin') {
    return res.status(403).json({ success: false, message: '权限不足' });
  }

  req.currentUserId = userId;
  next();
};

// 手动触发新闻分析
router.post('/analyze', checkAdminPermission, async (req, res) => {
  try {
    const { limit = 50 } = req.body;
    
    console.log(`管理员 ${req.currentUserId} 触发新闻分析，限制条数: ${limit}`);
    
    const result = await newsAnalysis.batchAnalyzeNews(limit);
    
    res.json({
      success: true,
      message: result.message,
      data: {
        processed: result.processed,
        successCount: result.successCount,
        errorCount: result.errorCount
      }
    });
  } catch (error) {
    console.error('手动触发新闻分析失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '分析失败: ' + error.message 
    });
  }
});

// 分析单条新闻
router.post('/analyze/:id', checkAdminPermission, async (req, res) => {
  try {
    const { id } = req.params;
    const { forceReanalyze = false } = req.body;
    
    console.log(`\n========== 开始重新分析新闻 ==========`);
    console.log(`新闻ID: ${id}`);
    console.log(`强制重新分析: ${forceReanalyze}`);
    
    // 获取新闻详情，包括公众号信息
    const newsItems = await db.query(
      'SELECT id, title, content, source_url, enterprise_full_name, wechat_account, account_name FROM news_detail WHERE id = ?',
      [id]
    );
    
    if (newsItems.length === 0) {
      console.log(`❌ 新闻不存在: ${id}`);
      return res.status(404).json({ success: false, message: '新闻不存在' });
    }
    
    const newsItem = newsItems[0];
    console.log(`新闻标题: ${newsItem.title}`);
    console.log(`当前企业全称: "${newsItem.enterprise_full_name || '(空)'}"`);
    console.log(`公众号ID (wechat_account): "${newsItem.wechat_account || '(空)'}"`);
    console.log(`公众号名称 (account_name): "${newsItem.account_name || '(空)'}"`);
    
    // 如果是强制重新分析，先清空相关字段（但不清空企业全称，因为需要根据公众号重新匹配）
    if (forceReanalyze) {
      await db.execute(
        'UPDATE news_detail SET news_abstract = NULL, news_sentiment = "neutral", keywords = NULL WHERE id = ?',
        [id]
      );
      console.log(`✓ 已清空分析结果字段（保留企业全称）`);
    }
    
    // 在重新分析前，先根据公众号匹配企业（如果新闻来自invested_enterprises表的公众号）
    // 对于invested_enterprises表中状态不为"完全退出"的数据对应的公众号的新闻，
    // 被投企业全称应该是这个被投企业的全称，不管是否跟这个企业有关
    // 先判断是否是企业公众号发的，如果是，直接设置企业全称
    console.log(`\n--- 步骤1: 检查是否需要匹配企业 ---`);
    console.log(`当前企业全称: "${newsItem.enterprise_full_name || '(空)'}"`);
    console.log(`是否需要匹配: ${!newsItem.enterprise_full_name || forceReanalyze ? '是' : '否'}`);
    
    if (!newsItem.enterprise_full_name || forceReanalyze) {
      try {
        const db = require('../db');
        console.log(`\n--- 步骤2: 开始匹配企业公众号 ---`);
        console.log(`wechat_account: "${newsItem.wechat_account || '(空)'}"`);
        console.log(`account_name: "${newsItem.account_name || '(空)'}"`);
        
        // 优先使用wechat_account匹配（这是最准确的匹配方式）
        if (newsItem.wechat_account) {
          console.log(`\n尝试方式1: 使用wechat_account匹配`);
          console.log(`查询SQL: SELECT enterprise_full_name FROM invested_enterprises WHERE wechat_official_account_id = '${newsItem.wechat_account}' AND exit_status NOT IN ('完全退出', '已上市') AND delete_mark = 0`);
          
          // 支持逗号分隔的多个公众号ID
          const enterpriseResult = await db.query(
            `SELECT enterprise_full_name, exit_status, delete_mark
             FROM invested_enterprises 
             WHERE (wechat_official_account_id = ? 
               OR wechat_official_account_id LIKE ?
               OR wechat_official_account_id LIKE ?
               OR wechat_official_account_id LIKE ?)
             AND exit_status NOT IN ('完全退出', '已上市')
             AND delete_mark = 0 
             LIMIT 1`,
            [
              newsItem.wechat_account,
              `${newsItem.wechat_account},%`,
              `%,${newsItem.wechat_account},%`,
              `%,${newsItem.wechat_account}`
            ]
          );
          
          console.log(`查询结果数量: ${enterpriseResult.length}`);
          if (enterpriseResult.length > 0) {
            console.log(`查询结果详情:`, enterpriseResult[0]);
            newsItem.enterprise_full_name = enterpriseResult[0].enterprise_full_name;
            console.log(`✓ 匹配成功！企业全称: ${newsItem.enterprise_full_name}`);
            
            // 更新数据库中的企业全称
            console.log(`\n--- 步骤3: 更新数据库中的企业全称 ---`);
            console.log(`执行SQL: UPDATE news_detail SET enterprise_full_name = '${newsItem.enterprise_full_name}' WHERE id = '${id}'`);
            await db.execute(
              'UPDATE news_detail SET enterprise_full_name = ? WHERE id = ?',
              [newsItem.enterprise_full_name, id]
            );
            
            // 验证更新是否成功
            const verifyResult = await db.query(
              'SELECT enterprise_full_name FROM news_detail WHERE id = ?',
              [id]
            );
            if (verifyResult.length > 0) {
              console.log(`✓ 更新成功！数据库中的企业全称: "${verifyResult[0].enterprise_full_name}"`);
            } else {
              console.log(`❌ 更新失败！无法验证更新结果`);
            }
          } else {
            console.log(`✗ 未找到匹配的企业`);
            // 查询所有相关记录以便调试
            // 支持逗号分隔的多个公众号ID
            const allResults = await db.query(
              `SELECT enterprise_full_name, wechat_official_account_id, exit_status, delete_mark
               FROM invested_enterprises 
               WHERE (wechat_official_account_id = ? 
                 OR wechat_official_account_id LIKE ?
                 OR wechat_official_account_id LIKE ?
                 OR wechat_official_account_id LIKE ?)`,
              [
                newsItem.wechat_account,
                `${newsItem.wechat_account},%`,
                `%,${newsItem.wechat_account},%`,
                `%,${newsItem.wechat_account}`
              ]
            );
            console.log(`所有相关记录（不限制状态）:`, allResults);
          }
        } else {
          console.log(`⚠️ wechat_account为空，跳过方式1`);
        }
        
        // 如果wechat_account匹配失败，尝试使用account_name匹配
        if (!newsItem.enterprise_full_name && newsItem.account_name) {
          console.log(`\n尝试方式2: 使用account_name匹配`);
          console.log(`查询SQL: SELECT enterprise_full_name FROM invested_enterprises WHERE wechat_official_account_id = '${newsItem.account_name}' AND exit_status NOT IN ('完全退出', '已上市') AND delete_mark = 0`);
          
          const enterpriseResultByName = await db.query(
            `SELECT enterprise_full_name, exit_status, delete_mark
             FROM invested_enterprises 
             WHERE wechat_official_account_id = ? 
             AND exit_status NOT IN ('完全退出', '已上市')
             AND delete_mark = 0 
             LIMIT 1`,
            [newsItem.account_name]
          );
          
          console.log(`查询结果数量: ${enterpriseResultByName.length}`);
          if (enterpriseResultByName.length > 0) {
            console.log(`查询结果详情:`, enterpriseResultByName[0]);
            newsItem.enterprise_full_name = enterpriseResultByName[0].enterprise_full_name;
            console.log(`✓ 匹配成功！企业全称: ${newsItem.enterprise_full_name}`);
            
            // 更新数据库中的企业全称
            console.log(`\n--- 步骤3: 更新数据库中的企业全称 ---`);
            console.log(`执行SQL: UPDATE news_detail SET enterprise_full_name = '${newsItem.enterprise_full_name}' WHERE id = '${id}'`);
            await db.execute(
              'UPDATE news_detail SET enterprise_full_name = ? WHERE id = ?',
              [newsItem.enterprise_full_name, id]
            );
            
            // 验证更新是否成功
            const verifyResult = await db.query(
              'SELECT enterprise_full_name FROM news_detail WHERE id = ?',
              [id]
            );
            if (verifyResult.length > 0) {
              console.log(`✓ 更新成功！数据库中的企业全称: "${verifyResult[0].enterprise_full_name}"`);
            }
          } else {
            console.log(`✗ 未找到匹配的企业`);
          }
        } else if (!newsItem.enterprise_full_name) {
          console.log(`⚠️ account_name为空或已匹配，跳过方式2`);
        }
        
        // 如果还是没匹配到，说明这个公众号可能不在invested_enterprises表中
        if (!newsItem.enterprise_full_name) {
          console.log(`\n⚠️ 无法根据公众号信息匹配到企业`);
          console.log(`wechat_account: "${newsItem.wechat_account || '(空)'}"`);
          console.log(`account_name: "${newsItem.account_name || '(空)'}"`);
          console.log(`将使用AI分析来判断是否与企业相关`);
        }
      } catch (e) {
        console.error(`\n❌ 根据公众号匹配企业时出错:`);
        console.error(`错误消息: ${e.message}`);
        console.error(`错误堆栈:`, e.stack);
      }
    } else {
      console.log(`\n--- 跳过匹配步骤 ---`);
      console.log(`新闻已有企业关联: ${newsItem.enterprise_full_name}`);
    }
    
    console.log(`\n--- 步骤4: 开始AI分析 ---`);
    console.log(`当前企业全称: "${newsItem.enterprise_full_name || '(空)'}"`);
    
    let result;
    if (newsItem.enterprise_full_name) {
      // 如果有企业关联，使用processNewsWithEnterprise（会保护来自invested_enterprises的企业关联）
      console.log(`使用processNewsWithEnterprise处理（有企业关联）`);
      result = await newsAnalysis.processNewsWithEnterprise(newsItem);
    } else {
      // 对于无企业关联的新闻，重新进行企业关联分析
      console.log(`使用processNewsWithoutEnterprise处理（无企业关联）`);
      result = await newsAnalysis.processNewsWithoutEnterprise(newsItem);
    }
    
    console.log(`\n--- 步骤5: 分析完成，验证最终结果 ---`);
    if (result) {
      // 返回更新后的新闻信息
      const updatedNews = await db.query(
        'SELECT id, title, enterprise_full_name, news_sentiment, keywords, news_abstract FROM news_detail WHERE id = ?',
        [id]
      );
      
      if (updatedNews.length > 0) {
        console.log(`最终企业全称: "${updatedNews[0].enterprise_full_name || '(空)'}"`);
        console.log(`最终情绪: ${updatedNews[0].news_sentiment}`);
        console.log(`最终关键词: ${updatedNews[0].keywords || '(空)'}`);
        console.log(`最终摘要: ${updatedNews[0].news_abstract ? updatedNews[0].news_abstract.substring(0, 50) + '...' : '(空)'}`);
      }
      
      console.log(`\n========== 重新分析完成 ==========\n`);
      
      res.json({
        success: true,
        message: '分析完成',
        data: updatedNews[0]
      });
    } else {
      console.log(`\n❌ AI分析失败`);
      console.log(`\n========== 重新分析失败 ==========\n`);
      
      res.status(500).json({
        success: false,
        message: '分析失败'
      });
    }
  } catch (error) {
    console.error('单条新闻分析失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '分析失败: ' + error.message 
    });
  }
});

// 获取分析统计信息
router.get('/stats', checkAdminPermission, async (req, res) => {
  try {
    // 总新闻数
    const totalNews = await db.query(
      'SELECT COUNT(*) as total FROM news_detail WHERE delete_mark = 0'
    );
    
    // 已分析新闻数
    const analyzedNews = await db.query(
      'SELECT COUNT(*) as analyzed FROM news_detail WHERE news_abstract IS NOT NULL AND delete_mark = 0'
    );
    
    // 待分析新闻数
    const pendingNews = await db.query(
      `SELECT COUNT(*) as pending FROM news_detail 
       WHERE news_abstract IS NULL 
       AND content IS NOT NULL 
       AND content != '' 
       AND delete_mark = 0`
    );
    
    // 情绪分布统计
    const sentimentStats = await db.query(
      `SELECT news_sentiment, COUNT(*) as count 
       FROM news_detail 
       WHERE news_sentiment IS NOT NULL 
       AND delete_mark = 0
       GROUP BY news_sentiment`
    );
    
    // 最近7天的分析数量
    const recentAnalysis = await db.query(
      `SELECT DATE(updated_at) as date, COUNT(*) as count
       FROM news_detail 
       WHERE news_abstract IS NOT NULL 
       AND updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       AND delete_mark = 0
       GROUP BY DATE(updated_at)
       ORDER BY date DESC`
    );
    
    res.json({
      success: true,
      data: {
        total: totalNews[0].total,
        analyzed: analyzedNews[0].analyzed,
        pending: pendingNews[0].pending,
        sentimentDistribution: sentimentStats,
        recentAnalysis: recentAnalysis
      }
    });
  } catch (error) {
    console.error('获取分析统计失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '获取统计失败: ' + error.message 
    });
  }
});

// 获取待分析新闻列表
router.get('/pending', checkAdminPermission, async (req, res) => {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (page - 1) * pageSize;
    
    const pendingNews = await db.query(
      `SELECT id, title, account_name, enterprise_full_name, created_at, public_time
       FROM news_detail 
       WHERE news_abstract IS NULL 
       AND content IS NOT NULL 
       AND content != '' 
       AND delete_mark = 0
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [parseInt(pageSize), offset]
    );
    
    const totalRows = await db.query(
      `SELECT COUNT(*) as total FROM news_detail 
       WHERE news_abstract IS NULL 
       AND content IS NOT NULL 
       AND content != '' 
       AND delete_mark = 0`
    );
    
    res.json({
      success: true,
      data: pendingNews,
      total: totalRows[0].total,
      page: parseInt(page),
      pageSize: parseInt(pageSize)
    });
  } catch (error) {
    console.error('获取待分析新闻列表失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '获取列表失败: ' + error.message 
    });
  }
});

// 清理错误的企业关联
router.post('/clean-associations', checkAdminPermission, async (req, res) => {
  try {
    const { keyword, dryRun = true } = req.body;
    
    if (!keyword) {
      return res.status(400).json({ 
        success: false, 
        message: '请提供关键词' 
      });
    }
    
    // 查找可能错误关联的新闻
    const suspiciousNews = await db.query(
      `SELECT id, title, content, enterprise_full_name, source_url
       FROM news_detail 
       WHERE title LIKE ? 
       AND enterprise_full_name IS NOT NULL 
       AND enterprise_full_name != ''
       ORDER BY created_at DESC`,
      [`%${keyword}%`]
    );
    
    let cleanedCount = 0;
    const results = [];
    
    for (const news of suspiciousNews) {
      const fullContent = (news.title + ' ' + (news.content || '')).toLowerCase();
      const enterpriseName = news.enterprise_full_name.toLowerCase();
      
      // 检查企业名称是否真的在内容中出现
      const nameInContent = fullContent.includes(enterpriseName);
      
      if (!nameInContent) {
        results.push({
          id: news.id,
          title: news.title,
          enterprise_full_name: news.enterprise_full_name,
          action: dryRun ? 'would_clean' : 'cleaned'
        });
        
        if (!dryRun) {
          // 清除错误的企业关联
          await db.execute(
            'UPDATE news_detail SET enterprise_full_name = NULL WHERE id = ?',
            [news.id]
          );
          cleanedCount++;
        }
      }
    }
    
    res.json({
      success: true,
      message: dryRun 
        ? `找到 ${results.length} 条可能错误关联的新闻` 
        : `已清理 ${cleanedCount} 条错误关联的新闻`,
      data: {
        total: results.length,
        cleaned: cleanedCount,
        results: results.slice(0, 20) // 最多返回20条
      }
    });
  } catch (error) {
    console.error('清理企业关联失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '清理失败: ' + error.message 
    });
  }
});


// 批量分析选中的新闻
router.post('/batch-analyze-selected', async (req, res) => {
  try {
    console.log('收到批量分析请求');
    console.log('请求体:', req.body);
    console.log('请求头:', req.headers);
    
    const { newsIds } = req.body;
    const userId = req.headers['x-user-id'] || null;
    
    console.log('解析的newsIds:', newsIds);
    console.log('解析的userId:', userId);
    
    if (!newsIds || !Array.isArray(newsIds) || newsIds.length === 0) {
      console.log('新闻ID列表无效');
      return res.status(400).json({ 
        success: false, 
        message: '请提供要分析的新闻ID列表' 
      });
    }

    if (!userId) {
      console.log('用户未登录');
      return res.status(401).json({ success: false, message: '未登录' });
    }

    console.log(`用户 ${userId} 触发批量分析，新闻数量: ${newsIds.length}`);
    
    // 查询选中的新闻，包括公众号信息
    const placeholders = newsIds.map(() => '?').join(',');
    const newsToAnalyze = await db.query(
      `SELECT id, title, content, source_url, enterprise_full_name, wechat_account, account_name
       FROM news_detail 
       WHERE id IN (${placeholders}) AND delete_mark = 0`,
      newsIds
    );

    if (newsToAnalyze.length === 0) {
      return res.json({
        success: true,
        message: '没有找到要分析的新闻',
        data: { total: 0, processed: 0, successCount: 0, errorCount: 0 }
      });
    }

    // 创建一个唯一的任务ID
    const taskId = `analysis_${userId}_${Date.now()}`;
    
    // 立即返回响应，告知前端开始处理
    res.json({
      success: true,
      message: `开始分析 ${newsToAnalyze.length} 条新闻，请稍候...`,
      processed: newsToAnalyze.length,
      successCount: 0,
      errorCount: 0,
      status: 'processing',
      taskId: taskId,
      data: {
        total: newsToAnalyze.length,
        processed: 0,
        successCount: 0,
        errorCount: 0,
        results: []
      }
    });

    // 初始化进度状态
    global.analysisProgress = global.analysisProgress || {};
    global.analysisProgress[taskId] = {
      total: newsToAnalyze.length,
      processed: 0,
      successCount: 0,
      errorCount: 0,
      status: 'processing',
      startTime: new Date(),
      currentItem: null,
      results: []
    };
    
    console.log(`初始化进度状态，任务ID: ${taskId}`, global.analysisProgress[taskId]);

    // 异步处理分析任务
    setImmediate(async () => {
      let successCount = 0;
      let errorCount = 0;
      const results = [];

      console.log(`开始异步处理 ${newsToAnalyze.length} 条新闻的AI分析...`);

      for (let i = 0; i < newsToAnalyze.length; i++) {
        const news = newsToAnalyze[i];
        
        try {
          console.log(`\n========== 开始批量分析新闻 (${i + 1}/${newsToAnalyze.length}) ==========`);
          console.log(`新闻ID: ${news.id}`);
          console.log(`新闻标题: ${news.title}`);
          console.log(`当前企业全称: "${news.enterprise_full_name || '(空)'}"`);
          console.log(`公众号ID (wechat_account): "${news.wechat_account || '(空)'}"`);
          console.log(`公众号名称 (account_name): "${news.account_name || '(空)'}"`);
          
          // 更新进度状态
          global.analysisProgress[taskId] = {
            ...global.analysisProgress[taskId],
            processed: i,
            successCount: successCount,
            errorCount: errorCount,
            currentItem: {
              index: i + 1,
              total: newsToAnalyze.length,
              title: news.title.substring(0, 50) + (news.title.length > 50 ? '...' : ''),
              id: news.id
            }
          };
          
          // 清空现有的分析结果，强制重新分析（但保留企业全称，因为需要根据公众号重新匹配）
          await db.execute(
            `UPDATE news_detail 
             SET news_abstract = NULL, news_sentiment = 'neutral', keywords = NULL 
             WHERE id = ?`,
            [news.id]
          );
          console.log(`✓ 已清空分析结果字段（保留企业全称）`);

          // 在重新分析前，先根据公众号匹配企业（如果新闻来自invested_enterprises表的公众号）
          // 对于invested_enterprises表中状态不为"完全退出"的数据对应的公众号的新闻，
          // 被投企业全称应该是这个被投企业的全称，不管是否跟这个企业有关
          console.log(`\n--- 步骤1: 检查是否需要匹配企业 ---`);
          console.log(`当前企业全称: "${news.enterprise_full_name || '(空)'}"`);
          console.log(`是否需要匹配: ${!news.enterprise_full_name ? '是' : '否（已有企业全称，但会重新验证）'}`);
          
          // 即使已有企业全称，也要重新匹配以确保正确性（强制重新分析）
          if (!news.enterprise_full_name || true) { // 强制重新匹配
            try {
              console.log(`\n--- 步骤2: 开始匹配企业公众号 ---`);
              console.log(`wechat_account: "${news.wechat_account || '(空)'}"`);
              console.log(`account_name: "${news.account_name || '(空)'}"`);
              
              // 优先使用wechat_account匹配（这是最准确的匹配方式）
              if (news.wechat_account) {
                console.log(`\n尝试方式1: 使用wechat_account匹配`);
                console.log(`查询SQL: SELECT enterprise_full_name FROM invested_enterprises WHERE wechat_official_account_id = '${news.wechat_account}' AND exit_status NOT IN ('完全退出', '已上市') AND delete_mark = 0`);
                
                // 支持逗号分隔的多个公众号ID
                const enterpriseResult = await db.query(
                  `SELECT enterprise_full_name, exit_status, delete_mark
                   FROM invested_enterprises 
                   WHERE (wechat_official_account_id = ? 
                     OR wechat_official_account_id LIKE ?
                     OR wechat_official_account_id LIKE ?
                     OR wechat_official_account_id LIKE ?)
                   AND exit_status NOT IN ('完全退出', '已上市')
                   AND delete_mark = 0 
                   LIMIT 1`,
                  [
                    news.wechat_account,
                    `${news.wechat_account},%`,
                    `%,${news.wechat_account},%`,
                    `%,${news.wechat_account}`
                  ]
                );
                
                console.log(`查询结果数量: ${enterpriseResult.length}`);
                if (enterpriseResult.length > 0) {
                  console.log(`查询结果详情:`, enterpriseResult[0]);
                  news.enterprise_full_name = enterpriseResult[0].enterprise_full_name;
                  console.log(`✓ 匹配成功！企业全称: ${news.enterprise_full_name}`);
                  
                  // 更新数据库中的企业全称
                  console.log(`\n--- 步骤3: 更新数据库中的企业全称 ---`);
                  console.log(`执行SQL: UPDATE news_detail SET enterprise_full_name = '${news.enterprise_full_name}' WHERE id = '${news.id}'`);
                  await db.execute(
                    'UPDATE news_detail SET enterprise_full_name = ? WHERE id = ?',
                    [news.enterprise_full_name, news.id]
                  );
                  
                  // 验证更新是否成功
                  const verifyResult = await db.query(
                    'SELECT enterprise_full_name FROM news_detail WHERE id = ?',
                    [news.id]
                  );
                  if (verifyResult.length > 0) {
                    console.log(`✓ 更新成功！数据库中的企业全称: "${verifyResult[0].enterprise_full_name}"`);
                  } else {
                    console.log(`❌ 更新失败！无法验证更新结果`);
                  }
                } else {
                  console.log(`✗ 未找到匹配的企业`);
                  // 查询所有相关记录以便调试
                  // 支持逗号分隔的多个公众号ID
                  const allResults = await db.query(
                    `SELECT enterprise_full_name, wechat_official_account_id, exit_status, delete_mark
                     FROM invested_enterprises 
                     WHERE (wechat_official_account_id = ? 
                       OR wechat_official_account_id LIKE ?
                       OR wechat_official_account_id LIKE ?
                       OR wechat_official_account_id LIKE ?)`,
                    [
                      news.wechat_account,
                      `${news.wechat_account},%`,
                      `%,${news.wechat_account},%`,
                      `%,${news.wechat_account}`
                    ]
                  );
                  console.log(`所有相关记录（不限制状态）:`, allResults);
                }
              } else {
                console.log(`⚠️ wechat_account为空，跳过方式1`);
              }
              
              // 如果wechat_account匹配失败，尝试使用account_name匹配
              if (!news.enterprise_full_name && news.account_name) {
                console.log(`\n尝试方式2: 使用account_name匹配`);
                console.log(`查询SQL: SELECT enterprise_full_name FROM invested_enterprises WHERE wechat_official_account_id = '${news.account_name}' AND exit_status NOT IN ('完全退出', '已上市') AND delete_mark = 0`);
                
                const enterpriseResultByName = await db.query(
                  `SELECT enterprise_full_name, exit_status, delete_mark
                   FROM invested_enterprises 
                   WHERE wechat_official_account_id = ? 
                   AND exit_status NOT IN ('完全退出', '已上市')
                   AND delete_mark = 0 
                   LIMIT 1`,
                  [news.account_name]
                );
                
                console.log(`查询结果数量: ${enterpriseResultByName.length}`);
                if (enterpriseResultByName.length > 0) {
                  console.log(`查询结果详情:`, enterpriseResultByName[0]);
                  news.enterprise_full_name = enterpriseResultByName[0].enterprise_full_name;
                  console.log(`✓ 匹配成功！企业全称: ${news.enterprise_full_name}`);
                  
                  // 更新数据库中的企业全称
                  console.log(`\n--- 步骤3: 更新数据库中的企业全称 ---`);
                  console.log(`执行SQL: UPDATE news_detail SET enterprise_full_name = '${news.enterprise_full_name}' WHERE id = '${news.id}'`);
                  await db.execute(
                    'UPDATE news_detail SET enterprise_full_name = ? WHERE id = ?',
                    [news.enterprise_full_name, news.id]
                  );
                  
                  // 验证更新是否成功
                  const verifyResult = await db.query(
                    'SELECT enterprise_full_name FROM news_detail WHERE id = ?',
                    [news.id]
                  );
                  if (verifyResult.length > 0) {
                    console.log(`✓ 更新成功！数据库中的企业全称: "${verifyResult[0].enterprise_full_name}"`);
                  }
                } else {
                  console.log(`✗ 未找到匹配的企业`);
                }
              } else if (!news.enterprise_full_name) {
                console.log(`⚠️ account_name为空或已匹配，跳过方式2`);
              }
              
              // 如果还是没匹配到，说明这个公众号可能不在invested_enterprises表中
              if (!news.enterprise_full_name) {
                console.log(`\n⚠️ 无法根据公众号信息匹配到企业`);
                console.log(`wechat_account: "${news.wechat_account || '(空)'}"`);
                console.log(`account_name: "${news.account_name || '(空)'}"`);
                console.log(`将使用AI分析来判断是否与企业相关`);
              }
            } catch (e) {
              console.error(`\n❌ 根据公众号匹配企业时出错:`);
              console.error(`错误消息: ${e.message}`);
              console.error(`错误堆栈:`, e.stack);
            }
          } else {
            console.log(`\n--- 跳过匹配步骤 ---`);
            console.log(`新闻已有企业关联: ${news.enterprise_full_name}`);
          }

          console.log(`\n--- 步骤4: 开始AI分析 ---`);
          console.log(`当前企业全称: "${news.enterprise_full_name || '(空)'}"`);
          
          let result;
          if (news.enterprise_full_name) {
            // 如果有企业关联，使用processNewsWithEnterprise（会保护来自invested_enterprises的企业关联）
            console.log(`使用processNewsWithEnterprise处理（有企业关联）`);
            result = await newsAnalysis.processNewsWithEnterprise(news);
          } else {
            // 对于无企业关联的新闻，重新进行企业关联分析
            console.log(`使用processNewsWithoutEnterprise处理（无企业关联）`);
            result = await newsAnalysis.processNewsWithoutEnterprise(news);
          }
          
          console.log(`\n--- 步骤5: 分析完成，验证最终结果 ---`);
          if (result) {
            // 验证最终结果
            const finalNews = await db.query(
              'SELECT id, title, enterprise_full_name, news_sentiment, keywords, news_abstract FROM news_detail WHERE id = ?',
              [news.id]
            );
            
            if (finalNews.length > 0) {
              console.log(`最终企业全称: "${finalNews[0].enterprise_full_name || '(空)'}"`);
              console.log(`最终情绪: ${finalNews[0].news_sentiment}`);
              console.log(`最终关键词: ${finalNews[0].keywords || '(空)'}`);
              console.log(`最终摘要: ${finalNews[0].news_abstract ? finalNews[0].news_abstract.substring(0, 50) + '...' : '(空)'}`);
            }
          }
          
          console.log(`\n========== 批量分析完成 (${i + 1}/${newsToAnalyze.length}) ==========\n`);

          if (result) {
            successCount++;
            results.push({
              id: news.id,
              title: news.title,
              status: 'success'
            });
          } else {
            errorCount++;
            results.push({
              id: news.id,
              title: news.title,
              status: 'error',
              error: '分析处理失败'
            });
          }

          // 添加延迟避免API频率限制
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
          console.error(`分析新闻失败 (${news.id}):`, error);
          errorCount++;
          results.push({
            id: news.id,
            title: news.title,
            status: 'error',
            error: error.message
          });
        }
      }
      
      // 更新最终状态
      global.analysisProgress[taskId] = {
        ...global.analysisProgress[taskId],
        processed: newsToAnalyze.length,
        successCount: successCount,
        errorCount: errorCount,
        status: 'completed',
        endTime: new Date(),
        currentItem: null,
        results: results
      };
      
      console.log('异步AI分析完成:');
      console.log('- 总数:', newsToAnalyze.length);
      console.log('- 成功:', successCount);
      console.log('- 失败:', errorCount);
      console.log(`批量分析完成：成功处理 ${successCount} 条，失败 ${errorCount} 条，总计 ${newsToAnalyze.length} 条`);
      
      // 5分钟后清理进度数据
      setTimeout(() => {
        if (global.analysisProgress && global.analysisProgress[taskId]) {
          delete global.analysisProgress[taskId];
        }
      }, 5 * 60 * 1000);
    });
    
  } catch (error) {
    console.error('批量分析失败:', error);
    res.status(500).json({
      success: false,
      message: '批量分析失败: ' + error.message
    });
  }
});

// 检查最近的AI分析状态
router.get('/analysis-status', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '用户未登录'
      });
    }

    // 查询最近5分钟内的新闻分析情况
    const recentAnalysis = await db.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN news_abstract IS NOT NULL THEN 1 ELSE 0 END) as analyzed,
        MAX(updated_at) as last_update
      FROM news_detail 
      WHERE delete_mark = 0 
        AND created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        AND (enterprise_full_name IS NOT NULL OR source_url LIKE '%additional%')
    `);

    const result = recentAnalysis[0] || { total: 0, analyzed: 0, last_update: null };
    
    res.json({
      success: true,
      data: {
        total: result.total,
        analyzed: result.analyzed,
        pending: result.total - result.analyzed,
        lastUpdate: result.last_update,
        isProcessing: result.total > result.analyzed
      }
    });

  } catch (error) {
    console.error('查询分析状态失败:', error);
    res.status(500).json({
      success: false,
      message: '查询分析状态失败: ' + error.message
    });
  }
});


// 清理无效的企业关联
router.post('/clean-invalid-associations', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    
    if (!userId || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以执行清理操作'
      });
    }

    console.log(`管理员 ${userId} 开始清理无效企业关联`);

    // 查找所有有企业关联的新闻
    const newsWithEnterprises = await db.query(`
      SELECT id, enterprise_full_name, title
      FROM news_detail 
      WHERE enterprise_full_name IS NOT NULL 
        AND enterprise_full_name != ''
        AND delete_mark = 0
    `);
    
    console.log(`找到 ${newsWithEnterprises.length} 条有企业关联的新闻`);

    let cleanedCount = 0;
    const invalidEnterprises = [];

    for (const news of newsWithEnterprises) {
      // 检查企业是否在被投企业表中存在
      const existsInDB = await db.query(
        `SELECT enterprise_full_name FROM invested_enterprises 
         WHERE enterprise_full_name = ? AND delete_mark = 0`,
        [news.enterprise_full_name]
      );

      if (existsInDB.length === 0) {
        // 企业不存在，清理关联
        await db.execute(
          `UPDATE news_detail 
           SET enterprise_full_name = NULL 
           WHERE id = ?`,
          [news.id]
        );

        cleanedCount++;
        invalidEnterprises.push({
          newsId: news.id,
          title: news.title.substring(0, 50) + '...',
          invalidEnterprise: news.enterprise_full_name
        });

        console.log(`清理无效企业关联: ${news.enterprise_full_name} -> ${news.title.substring(0, 50)}...`);
      }
    }

    res.json({
      success: true,
      data: {
        totalChecked: newsWithEnterprises.length,
        cleanedCount: cleanedCount,
        invalidEnterprises: invalidEnterprises.slice(0, 20), // 最多返回20条示例
        message: `清理完成：检查了 ${newsWithEnterprises.length} 条新闻，清理了 ${cleanedCount} 个无效企业关联`
      }
    });

  } catch (error) {
    console.error('清理无效企业关联失败:', error);
    res.status(500).json({
      success: false,
      message: '清理失败: ' + error.message
    });
  }
});

// 获取分析进度
router.get('/analysis-progress/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '用户未登录'
      });
    }

    // 检查任务ID是否属于当前用户
    if (!taskId.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: '无权访问此任务进度'
      });
    }

    console.log(`查询进度，任务ID: ${taskId}`);
    console.log(`当前所有任务:`, Object.keys(global.analysisProgress || {}));
    
    const progress = global.analysisProgress && global.analysisProgress[taskId];
    
    console.log(`找到的进度数据:`, progress);
    
    if (!progress) {
      console.log(`任务 ${taskId} 不存在`);
      return res.json({
        success: true,
        data: {
          status: 'not_found',
          message: '任务不存在或已完成'
        }
      });
    }

    // 计算进度百分比
    const percentage = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
    
    // 计算预估剩余时间
    let estimatedTimeLeft = null;
    if (progress.processed > 0 && progress.status === 'processing') {
      const elapsed = new Date() - progress.startTime;
      const avgTimePerItem = elapsed / progress.processed;
      const remainingItems = progress.total - progress.processed;
      estimatedTimeLeft = Math.ceil((avgTimePerItem * remainingItems) / 1000); // 秒
    }

    res.json({
      success: true,
      data: {
        taskId: taskId,
        status: progress.status,
        total: progress.total,
        processed: progress.processed,
        successCount: progress.successCount,
        errorCount: progress.errorCount,
        percentage: percentage,
        currentItem: progress.currentItem,
        estimatedTimeLeft: estimatedTimeLeft,
        startTime: progress.startTime,
        endTime: progress.endTime
      }
    });

  } catch (error) {
    console.error('获取分析进度失败:', error);
    res.status(500).json({
      success: false,
      message: '获取进度失败: ' + error.message
    });
  }
});

// 调试：检查特定企业是否在被投企业表中
router.get('/debug-enterprise/:enterpriseName', async (req, res) => {
  try {
    const { enterpriseName } = req.params;
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    
    if (!userId || userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以使用调试功能'
      });
    }

    console.log(`调试：检查企业"${enterpriseName}"是否在被投企业表中`);

    // 检查企业是否在被投企业表中
    const enterpriseExists = await db.query(
      `SELECT enterprise_full_name, project_abbreviation, exit_status 
       FROM invested_enterprises 
       WHERE enterprise_full_name = ? AND delete_mark = 0`,
      [enterpriseName]
    );

    // 同时检查是否有相似的企业名称
    const similarEnterprises = await db.query(
      `SELECT enterprise_full_name, project_abbreviation, exit_status 
       FROM invested_enterprises 
       WHERE enterprise_full_name LIKE ? AND delete_mark = 0 
       LIMIT 10`,
      [`%${enterpriseName}%`]
    );

    res.json({
      success: true,
      data: {
        enterpriseName: enterpriseName,
        exists: enterpriseExists.length > 0,
        exactMatches: enterpriseExists,
        similarMatches: similarEnterprises,
        message: enterpriseExists.length > 0 ? '企业存在于被投企业表中' : '企业不在被投企业表中'
      }
    });

  } catch (error) {
    console.error('调试企业检查失败:', error);
    res.status(500).json({
      success: false,
      message: '调试失败: ' + error.message
    });
  }
});


module.exports = router;
