const express = require('express');
const newsAnalysis = require('../utils/newsAnalysis');
const db = require('../db');
const { logWithTag, errorWithTag } = require('../utils/logUtils');

const router = express.Router();

// 测试端点
router.get('/test', (req, res) => {
  logWithTag('[AI分析]', '收到测试请求');
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
    
    logWithTag('[AI分析]', `管理员 ${req.currentUserId} 触发新闻分析，限制条数: ${limit}`);
    
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
    errorWithTag('[AI分析]', '手动触发新闻分析失败:', error);
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
    
    logWithTag('[AI分析]', '\n========== 开始重新分析新闻 ==========');
    logWithTag('[AI分析]', `新闻ID: ${id}`);
    logWithTag('[AI分析]', `强制重新分析: ${forceReanalyze}`);
    
    // 获取新闻详情，包括公众号信息和现有分析结果
    const newsItems = await db.query(
      'SELECT id, title, content, source_url, enterprise_full_name, wechat_account, account_name, news_abstract, news_sentiment, keywords, APItype FROM news_detail WHERE id = ?',
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
    console.log(`接口类型 (APItype): "${newsItem.APItype || '(空)'}"`);
    console.log(`当前摘要: "${newsItem.news_abstract ? newsItem.news_abstract.substring(0, 80) + '...' : '(空)'}"`);
    
    // 检查摘要是否不完整（以数字结尾、以省略号结尾等）
    const isAbstractIncomplete = newsItem.news_abstract && (
      /[\d\.]+[。！？.!?]?$/.test(newsItem.news_abstract.trim()) || // 以数字结尾
      /\.{2,}$/.test(newsItem.news_abstract.trim()) || // 以省略号结尾
      /…+$/.test(newsItem.news_abstract.trim()) || // 以中文省略号结尾
      newsItem.news_abstract.length < 30 // 摘要太短
    );
    
    if (isAbstractIncomplete) {
      console.log(`⚠️ 检测到摘要不完整，将强制重新分析`);
      console.log(`摘要问题: ${newsItem.news_abstract.substring(Math.max(0, newsItem.news_abstract.length - 20))}`);
    }
    
    // 如果是强制重新分析，先清空相关字段（但不清空企业全称，因为需要根据公众号重新匹配）
    // 注意：即使forceReanalyze为false，如果摘要、情绪或关键词为空或不完整，也应该重新分析
    const shouldClearResults = forceReanalyze || !newsItem.news_abstract || !newsItem.news_sentiment || !newsItem.keywords || isAbstractIncomplete;
    
    // 检查content是否有效（为空、太短或包含错误消息）
    const hasValidContent = newsItem.content && 
                            newsItem.content.trim() !== '' && 
                            newsItem.content.length > 50 &&
                            !newsItem.content.includes('无法提取正文内容') &&
                            !newsItem.content.includes('正文无文字');
    
    // 如果content无效，也清空content字段，强制重新抓取
    // 如果是强制重新分析，即使content有效，也要清空分析结果字段，强制重新生成摘要和关键词
    if (shouldClearResults || !hasValidContent) {
      if (!hasValidContent && newsItem.source_url) {
        console.log(`⚠️ 检测到content无效（${newsItem.content ? `长度: ${newsItem.content.length}字符` : '为空'}），将清空content字段并重新抓取`);
        await db.execute(
          'UPDATE news_detail SET news_abstract = NULL, news_sentiment = "neutral", keywords = NULL, content = NULL WHERE id = ?',
          [id]
        );
        // 更新newsItem对象
        newsItem.content = null;
      } else {
        // 即使content有效，如果是强制重新分析，也要清空分析结果字段
        await db.execute(
          'UPDATE news_detail SET news_abstract = NULL, news_sentiment = "neutral", keywords = NULL WHERE id = ?',
          [id]
        );
        console.log(`✓ 已清空分析结果字段（保留企业全称和content），将重新生成摘要和关键词`);
      }
      console.log(`✓ 已清空分析结果字段（保留企业全称）`);
      if (forceReanalyze) {
        console.log(`清空原因: 强制重新分析`);
      } else if (isAbstractIncomplete) {
        console.log(`清空原因: 摘要不完整（以数字结尾或太短）`);
      } else if (!hasValidContent) {
        console.log(`清空原因: content无效，需要重新抓取`);
      } else {
        console.log(`清空原因: 分析结果不完整（缺少摘要、情绪或关键词）`);
      }
    } else {
      console.log(`⚠️ 分析结果已存在且完整，如需重新分析请设置forceReanalyze=true`);
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
          // 一次性查询企业全称、简称、entity_type、fund、sub_fund，避免二次查询失败导致 entity_type 为空但简称不为空的不一致
          const enterpriseResult = await db.query(
            `SELECT enterprise_full_name, project_abbreviation, entity_type, fund, sub_fund, exit_status, delete_mark
             FROM invested_enterprises 
             WHERE (wechat_official_account_id = ? 
               OR wechat_official_account_id LIKE ?
               OR wechat_official_account_id LIKE ?
               OR wechat_official_account_id LIKE ?)
             AND exit_status NOT IN ('完全退出', '已上市', '不再观察')
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
            const row = enterpriseResult[0];
            newsItem.enterprise_full_name = row.enterprise_full_name;
            newsItem.enterprise_abbreviation = row.project_abbreviation || null;
            const entityType = row.entity_type;
            const fund = row.fund;
            const sub_fund = row.sub_fund;
            console.log(`✓ 匹配成功！企业全称: ${newsItem.enterprise_full_name}, 简称: ${newsItem.enterprise_abbreviation || 'NULL'}, entity_type: ${entityType || 'NULL'}, fund: ${fund || 'NULL'}, sub_fund: ${sub_fund || 'NULL'}`);
            
            // 更新数据库中的企业全称、企业简称、entity_type、fund和sub_fund（同一次查询结果，保证一致性）
            console.log(`\n--- 步骤3: 更新数据库中的企业全称、企业简称、entity_type、fund和sub_fund ---`);
            console.log(`执行SQL: UPDATE news_detail SET enterprise_full_name = '${newsItem.enterprise_full_name}', enterprise_abbreviation = '${newsItem.enterprise_abbreviation || 'NULL'}', entity_type = '${entityType || 'NULL'}', fund = '${fund || 'NULL'}', sub_fund = '${sub_fund || 'NULL'}' WHERE id = '${id}'`);
            await db.execute(
              'UPDATE news_detail SET enterprise_full_name = ?, enterprise_abbreviation = ?, entity_type = ?, fund = ?, sub_fund = ? WHERE id = ?',
              [newsItem.enterprise_full_name, newsItem.enterprise_abbreviation, entityType, fund, sub_fund, id]
            );
            
            // 验证更新是否成功
            const verifyResult = await db.query(
              'SELECT enterprise_full_name, enterprise_abbreviation, entity_type, fund, sub_fund FROM news_detail WHERE id = ?',
              [id]
            );
            if (verifyResult.length > 0) {
              console.log(`✓ 更新成功！数据库中的企业全称: "${verifyResult[0].enterprise_full_name}", 简称: "${verifyResult[0].enterprise_abbreviation || 'NULL'}", entity_type: "${verifyResult[0].entity_type || 'NULL'}", fund: "${verifyResult[0].fund || 'NULL'}", sub_fund: "${verifyResult[0].sub_fund || 'NULL'}"`);
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
          
          // 一次性查询企业全称、简称、entity_type、fund、sub_fund，避免二次查询失败导致 entity_type 为空但简称不为空的不一致
          const enterpriseResultByName = await db.query(
            `SELECT enterprise_full_name, project_abbreviation, entity_type, fund, sub_fund, exit_status, delete_mark
             FROM invested_enterprises 
             WHERE wechat_official_account_id = ? 
             AND exit_status NOT IN ('完全退出', '已上市', '不再观察')
             AND delete_mark = 0 
             LIMIT 1`,
            [newsItem.account_name]
          );
          
          console.log(`查询结果数量: ${enterpriseResultByName.length}`);
          if (enterpriseResultByName.length > 0) {
            console.log(`查询结果详情:`, enterpriseResultByName[0]);
            const row = enterpriseResultByName[0];
            newsItem.enterprise_full_name = row.enterprise_full_name;
            newsItem.enterprise_abbreviation = row.project_abbreviation || null;
            const entityType = row.entity_type;
            const fund = row.fund;
            const sub_fund = row.sub_fund;
            console.log(`✓ 匹配成功！企业全称: ${newsItem.enterprise_full_name}, 简称: ${newsItem.enterprise_abbreviation || 'NULL'}, entity_type: ${entityType || 'NULL'}, fund: ${fund || 'NULL'}, sub_fund: ${sub_fund || 'NULL'}`);
            
            // 更新数据库中的企业全称、企业简称、entity_type、fund和sub_fund（同一次查询结果，保证一致性）
            console.log(`\n--- 步骤3: 更新数据库中的企业全称、企业简称、entity_type、fund和sub_fund ---`);
            console.log(`执行SQL: UPDATE news_detail SET enterprise_full_name = '${newsItem.enterprise_full_name}', enterprise_abbreviation = '${newsItem.enterprise_abbreviation || 'NULL'}', entity_type = '${entityType || 'NULL'}', fund = '${fund || 'NULL'}', sub_fund = '${sub_fund || 'NULL'}' WHERE id = '${id}'`);
            await db.execute(
              'UPDATE news_detail SET enterprise_full_name = ?, enterprise_abbreviation = ?, entity_type = ?, fund = ?, sub_fund = ? WHERE id = ?',
              [newsItem.enterprise_full_name, newsItem.enterprise_abbreviation, entityType, fund, sub_fund, id]
            );
            
            // 验证更新是否成功
            const verifyResult = await db.query(
              'SELECT enterprise_full_name, enterprise_abbreviation, entity_type, fund, sub_fund FROM news_detail WHERE id = ?',
              [id]
            );
            if (verifyResult.length > 0) {
              console.log(`✓ 更新成功！数据库中的企业全称: "${verifyResult[0].enterprise_full_name}", 简称: "${verifyResult[0].enterprise_abbreviation || 'NULL'}", entity_type: "${verifyResult[0].entity_type || 'NULL'}", fund: "${verifyResult[0].fund || 'NULL'}", sub_fund: "${verifyResult[0].sub_fund || 'NULL'}"`);
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
            'UPDATE news_detail SET enterprise_full_name = NULL, entity_type = NULL WHERE id = ?',
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
    
    // 查询选中的新闻，包括公众号信息和APItype（接口类型）
    const placeholders = newsIds.map(() => '?').join(',');
    const newsToAnalyze = await db.query(
      `SELECT id, title, content, source_url, enterprise_full_name, wechat_account, account_name, APItype
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
                  `SELECT enterprise_full_name, project_abbreviation, exit_status, delete_mark
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
                  // 不再使用formatEnterpriseName，直接使用enterprise_full_name（全称）
                  // 简称存储在enterprise_abbreviation字段中
                  news.enterprise_full_name = enterpriseResult[0].enterprise_full_name;
                  news.enterprise_abbreviation = enterpriseResult[0].project_abbreviation || null;
                  console.log(`✓ 匹配成功！企业全称: ${news.enterprise_full_name}, 简称: ${news.enterprise_abbreviation || 'NULL'}`);
                  
                  // 获取entity_type、fund和sub_fund
                  let entityType = null;
                  let fund = null;
                  let sub_fund = null;
                  try {
                    const enterpriseInfo = await db.query(
                      `SELECT entity_type, fund, sub_fund, project_abbreviation FROM invested_enterprises 
                       WHERE enterprise_full_name = ? AND delete_mark = 0 LIMIT 1`,
                      [enterpriseResult[0].enterprise_full_name]
                    );
                    if (enterpriseInfo.length > 0) {
                      entityType = enterpriseInfo[0].entity_type;
                      fund = enterpriseInfo[0].fund;
                      sub_fund = enterpriseInfo[0].sub_fund;
                      // 如果查询到的project_abbreviation不为空，使用查询到的值（更准确）
                      if (enterpriseInfo[0].project_abbreviation) {
                        news.enterprise_abbreviation = enterpriseInfo[0].project_abbreviation;
                      }
                      console.log(`✓ 获取entity_type: ${entityType}, fund: ${fund || 'NULL'}, sub_fund: ${sub_fund || 'NULL'}, project_abbreviation: ${news.enterprise_abbreviation || 'NULL'}`);
                    }
                  } catch (err) {
                    console.warn(`获取entity_type、fund和sub_fund时出错: ${err.message}`);
                  }
                  
                  // 更新数据库中的企业全称、企业简称、entity_type、fund和sub_fund
                  console.log(`\n--- 步骤3: 更新数据库中的企业全称、企业简称、entity_type、fund和sub_fund ---`);
                  console.log(`执行SQL: UPDATE news_detail SET enterprise_full_name = '${news.enterprise_full_name}', enterprise_abbreviation = '${news.enterprise_abbreviation || 'NULL'}', entity_type = '${entityType || 'NULL'}', fund = '${fund || 'NULL'}', sub_fund = '${sub_fund || 'NULL'}' WHERE id = '${news.id}'`);
                  await db.execute(
                    'UPDATE news_detail SET enterprise_full_name = ?, enterprise_abbreviation = ?, entity_type = ?, fund = ?, sub_fund = ? WHERE id = ?',
                    [news.enterprise_full_name, news.enterprise_abbreviation, entityType, fund, sub_fund, news.id]
                  );
                  
                  // 验证更新是否成功
                  const verifyResult = await db.query(
                    'SELECT enterprise_full_name, enterprise_abbreviation, entity_type, fund, sub_fund FROM news_detail WHERE id = ?',
                    [news.id]
                  );
                  if (verifyResult.length > 0) {
                    console.log(`✓ 更新成功！数据库中的企业全称: "${verifyResult[0].enterprise_full_name}", 简称: "${verifyResult[0].enterprise_abbreviation || 'NULL'}", entity_type: "${verifyResult[0].entity_type || 'NULL'}", fund: "${verifyResult[0].fund || 'NULL'}", sub_fund: "${verifyResult[0].sub_fund || 'NULL'}"`);
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
                  `SELECT enterprise_full_name, project_abbreviation, exit_status, delete_mark
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
                  // 不再使用formatEnterpriseName，直接使用enterprise_full_name（全称）
                  // 简称存储在enterprise_abbreviation字段中
                  news.enterprise_full_name = enterpriseResultByName[0].enterprise_full_name;
                  news.enterprise_abbreviation = enterpriseResultByName[0].project_abbreviation || null;
                  console.log(`✓ 匹配成功！企业全称: ${news.enterprise_full_name}, 简称: ${news.enterprise_abbreviation || 'NULL'}`);
                  
                  // 获取entity_type、fund和sub_fund
                  let entityType = null;
                  let fund = null;
                  let sub_fund = null;
                  try {
                    const enterpriseInfo = await db.query(
                      `SELECT entity_type, fund, sub_fund, project_abbreviation FROM invested_enterprises 
                       WHERE enterprise_full_name = ? AND delete_mark = 0 LIMIT 1`,
                      [enterpriseResultByName[0].enterprise_full_name]
                    );
                    if (enterpriseInfo.length > 0) {
                      entityType = enterpriseInfo[0].entity_type;
                      fund = enterpriseInfo[0].fund;
                      sub_fund = enterpriseInfo[0].sub_fund;
                      // 如果查询到的project_abbreviation不为空，使用查询到的值（更准确）
                      if (enterpriseInfo[0].project_abbreviation) {
                        news.enterprise_abbreviation = enterpriseInfo[0].project_abbreviation;
                      }
                      console.log(`✓ 获取entity_type: ${entityType}, fund: ${fund || 'NULL'}, sub_fund: ${sub_fund || 'NULL'}, project_abbreviation: ${news.enterprise_abbreviation || 'NULL'}`);
                    }
                  } catch (err) {
                    console.warn(`获取entity_type、fund和sub_fund时出错: ${err.message}`);
                  }
                  
                  // 更新数据库中的企业全称、企业简称、entity_type、fund和sub_fund
                  console.log(`\n--- 步骤3: 更新数据库中的企业全称、企业简称、entity_type、fund和sub_fund ---`);
                  console.log(`执行SQL: UPDATE news_detail SET enterprise_full_name = '${news.enterprise_full_name}', enterprise_abbreviation = '${news.enterprise_abbreviation || 'NULL'}', entity_type = '${entityType || 'NULL'}', fund = '${fund || 'NULL'}', sub_fund = '${sub_fund || 'NULL'}' WHERE id = '${news.id}'`);
                  await db.execute(
                    'UPDATE news_detail SET enterprise_full_name = ?, enterprise_abbreviation = ?, entity_type = ?, fund = ?, sub_fund = ? WHERE id = ?',
                    [news.enterprise_full_name, news.enterprise_abbreviation, entityType, fund, sub_fund, news.id]
                  );
                  
                  // 验证更新是否成功
                  const verifyResult = await db.query(
                    'SELECT enterprise_full_name, entity_type, fund, sub_fund FROM news_detail WHERE id = ?',
                    [news.id]
                  );
                  if (verifyResult.length > 0) {
                    console.log(`✓ 更新成功！数据库中的企业全称: "${verifyResult[0].enterprise_full_name}", entity_type: "${verifyResult[0].entity_type || 'NULL'}", fund: "${verifyResult[0].fund || 'NULL'}", sub_fund: "${verifyResult[0].sub_fund || 'NULL'}"`);
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

          // 正确区分AI分析成功/失败
          // 如果result包含_aiAnalysisFailed标记，说明AI分析失败（即使数据库更新成功）
          if (result && result._aiAnalysisFailed) {
            // AI分析失败，但使用了兜底逻辑
            errorCount++;
            results.push({
              id: news.id,
              title: news.title,
              status: 'error',
              error: result._errorMessage || 'AI分析失败',
              _aiAnalysisFailed: true
            });
            console.warn(`[批量分析] 新闻 ${news.id} AI分析失败，使用兜底逻辑: ${result._errorMessage || '未知错误'}`);
          } else if (result) {
            // AI分析成功
            successCount++;
            results.push({
              id: news.id,
              title: news.title,
              status: 'success'
            });
          } else {
            // 完全失败（result为null）
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
        // 企业不存在，清理关联（设置所有相关字段为NULL）
        await db.execute(
          `UPDATE news_detail 
           SET enterprise_full_name = NULL,
               entity_type = NULL,
               fund = NULL,
               sub_fund = NULL
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

// 批量清理选中的新闻的无效企业关联
router.post('/clean-invalid-associations-selected', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const shareToken = req.headers['share-token'];
    
    // 支持管理员或通过share-token访问
    let isAuthorized = false;
    if (userId && userRole === 'admin') {
      isAuthorized = true;
    } else if (shareToken) {
      // 验证share-token
      const links = await db.query(
        `SELECT user_id, status, has_expiry, expiry_time
         FROM news_share_links
         WHERE share_token = ? AND status = 'active'`,
        [shareToken]
      );
      if (links.length > 0) {
        const link = links[0];
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
        // 检查用户是否为管理员
        const users = await db.query(
          'SELECT role FROM users WHERE id = ?',
          [link.user_id]
        );
        if (users.length > 0 && users[0].role === 'admin') {
          isAuthorized = true;
          userId = link.user_id;
        }
      }
    }
    
    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以执行清理操作'
      });
    }

    const { newsIds } = req.body;
    
    if (!newsIds || !Array.isArray(newsIds) || newsIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请提供要清理的新闻ID列表'
      });
    }

    console.log(`管理员 ${userId} 开始批量清理选中新闻的企业关联信息，选中 ${newsIds.length} 条新闻`);

    // 验证选中的新闻ID是否存在
    const placeholders = newsIds.map(() => '?').join(',');
    const selectedNews = await db.query(`
      SELECT id, enterprise_full_name, title
      FROM news_detail 
      WHERE id IN (${placeholders})
        AND delete_mark = 0
    `, newsIds);
    
    console.log(`找到 ${selectedNews.length} 条选中的新闻`);

    if (selectedNews.length === 0) {
      return res.status(400).json({
        success: false,
        message: '未找到选中的新闻，请确认新闻ID是否正确'
      });
    }

    // 直接清理选中新闻的企业关联信息（不检查企业是否存在）
    const updatePlaceholders = newsIds.map(() => '?').join(',');
    const updateResult = await db.execute(
      `UPDATE news_detail 
       SET enterprise_full_name = NULL,
           entity_type = NULL,
           fund = NULL,
           sub_fund = NULL
       WHERE id IN (${updatePlaceholders})
         AND delete_mark = 0`,
      newsIds
    );

    const cleanedCount = updateResult.affectedRows || selectedNews.length;
    
    // 记录清理的新闻信息（用于返回给前端）
    const cleanedNews = selectedNews.map(news => ({
      newsId: news.id,
      title: news.title ? news.title.substring(0, 50) + '...' : '',
      enterprise: news.enterprise_full_name || '(无)'
    }));

    console.log(`清理完成：清理了 ${cleanedCount} 条新闻的企业关联信息`);

    res.json({
      success: true,
      data: {
        totalChecked: selectedNews.length,
        cleanedCount: cleanedCount,
        cleanedNews: cleanedNews.slice(0, 20), // 最多返回20条示例
        message: `清理完成：已清理 ${cleanedCount} 条新闻的企业关联信息（被投企业全称、企业类型、关联基金、关联子基金）`
      }
    });

  } catch (error) {
    console.error('批量清理无效企业关联失败:', error);
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
// 检查并重新分析新榜接口新闻中摘要或关键词为空的情况
router.post('/reanalyze-xinbang-missing', checkAdminPermission, async (req, res) => {
  try {
    const { startDate, endDate, limit = 100 } = req.body;

    console.log(`\n========== 开始检查并重新分析新榜接口新闻（摘要或关键词为空） ==========`);
    console.log(`时间范围: ${startDate || '全部'} 至 ${endDate || '全部'}`);
    console.log(`限制数量: ${limit}`);

    // 构建查询条件：新榜接口，有正文但缺少摘要或关键词，且内容不是乱码
    let condition = `WHERE APItype = '新榜'
                     AND (news_abstract IS NULL OR news_abstract = '' OR keywords IS NULL OR keywords = '' OR keywords = '[]')
                     AND content IS NOT NULL
                     AND content != ''
                     AND LENGTH(content) > 20
                     AND delete_mark = 0`;
    const params = [];

    if (startDate) {
      condition += ' AND created_at >= ?';
      params.push(startDate);
    }

    if (endDate) {
      condition += ' AND created_at <= ?';
      params.push(endDate);
    }

    // 查询需要分析的新闻
    const newsToAnalyze = await db.query(
      `SELECT id, title, content, source_url, enterprise_full_name,
              wechat_account, account_name, APItype, news_abstract, keywords
       FROM news_detail
       ${condition}
       ORDER BY created_at DESC
       LIMIT ?`,
      [...params, limit]
    );

    console.log(`找到 ${newsToAnalyze.length} 条需要重新分析的新榜新闻`);

    if (newsToAnalyze.length === 0) {
      return res.json({
        success: true,
        message: '没有需要重新分析的新榜新闻',
        data: {
          total: 0,
          processed: 0,
          successCount: 0,
          errorCount: 0
        }
      });
    }

    // 过滤掉乱码内容
    const validNews = [];
    for (const news of newsToAnalyze) {
      // 检查内容是否是乱码（使用 newsAnalysis 实例的方法）
      try {
        // newsAnalysis 是一个实例，直接调用方法
        if (news.content && typeof newsAnalysis.isContentContaminated === 'function' && newsAnalysis.isContentContaminated(news.content)) {
          console.log(`跳过乱码内容: ${news.id} - ${news.title.substring(0, 50)}`);
          continue;
        }
      } catch (error) {
        console.warn(`检查乱码内容时出错: ${error.message}，继续处理该新闻`);
      }
      validNews.push(news);
    }

    console.log(`过滤后有效新闻数量: ${validNews.length} 条`);

    if (validNews.length === 0) {
      return res.json({
        success: true,
        message: '所有新闻都是乱码内容，无需分析',
        data: {
          total: newsToAnalyze.length,
          processed: 0,
          successCount: 0,
          errorCount: 0
        }
      });
    }

    // 生成任务ID
    const taskId = `xinbang-missing-${Date.now()}`;

    // 立即返回响应
    res.json({
      success: true,
      message: '开始重新分析',
      taskId: taskId,
      data: {
        total: validNews.length,
        processed: 0,
        successCount: 0,
        errorCount: 0
      }
    });

    // 初始化进度状态
    global.analysisProgress = global.analysisProgress || {};
    global.analysisProgress[taskId] = {
      total: validNews.length,
      processed: 0,
      successCount: 0,
      errorCount: 0,
      status: 'processing',
      startTime: new Date(),
      currentItem: null,
      results: []
    };

    // 异步处理分析任务
    setImmediate(async () => {
      let successCount = 0;
      let errorCount = 0;
      const results = [];

      console.log(`开始异步处理 ${validNews.length} 条新榜新闻的AI分析...`);

      for (let i = 0; i < validNews.length; i++) {
        const news = validNews[i];

        try {
          console.log(`\n========== 开始重新分析新榜新闻 (${i + 1}/${validNews.length}) ==========`);
          console.log(`新闻ID: ${news.id}`);
          console.log(`新闻标题: ${news.title}`);
          console.log(`当前摘要: "${news.news_abstract || '(空)'}"`);
          console.log(`当前关键词: "${news.keywords || '(空)'}"`);
          console.log(`内容长度: ${(news.content || '').length}字符`);

          // 更新进度状态
          global.analysisProgress[taskId] = {
            ...global.analysisProgress[taskId],
            processed: i,
            currentItem: {
              id: news.id,
              title: news.title
            }
          };

          // 确保内容不为空
          if (!news.content || news.content.trim().length === 0) {
            console.log(`⚠️ 新闻内容为空，跳过`);
            errorCount++;
            results.push({
              id: news.id,
              title: news.title,
              status: 'skipped',
              message: '内容为空'
            });
            continue;
          }

          // 根据是否有企业关联选择处理方法
          let result;
          if (news.enterprise_full_name) {
            console.log(`使用processNewsWithEnterprise处理（有企业关联）`);
            result = await newsAnalysis.processNewsWithEnterprise(news);
          } else {
            console.log(`使用processNewsWithoutEnterprise处理（无企业关联）`);
            result = await newsAnalysis.processNewsWithoutEnterprise(news);
          }

          if (result) {
            // 验证最终结果
            const finalNews = await db.query(
              'SELECT id, title, news_abstract, keywords FROM news_detail WHERE id = ?',
              [news.id]
            );
            
            if (finalNews.length > 0) {
              const hasAbstract = finalNews[0].news_abstract && finalNews[0].news_abstract.trim().length > 0;
              const hasKeywords = finalNews[0].keywords && finalNews[0].keywords !== '[]' && finalNews[0].keywords.trim().length > 0;
              
              if (hasAbstract && hasKeywords) {
                successCount++;
                results.push({
                  id: news.id,
                  title: news.title,
                  status: 'success',
                  message: '摘要和关键词已生成'
                });
                console.log(`✓ 分析成功: ${news.id}，摘要和关键词已生成`);
              } else {
                errorCount++;
                results.push({
                  id: news.id,
                  title: news.title,
                  status: 'partial',
                  message: `摘要: ${hasAbstract ? '有' : '无'}, 关键词: ${hasKeywords ? '有' : '无'}`
                });
                console.log(`⚠️ 分析部分成功: ${news.id}，摘要: ${hasAbstract ? '有' : '无'}, 关键词: ${hasKeywords ? '有' : '无'}`);
              }
            } else {
              errorCount++;
              results.push({
                id: news.id,
                title: news.title,
                status: 'error',
                message: '无法验证结果'
              });
              console.log(`✗ 分析失败: ${news.id}，无法验证结果`);
            }
          } else {
            errorCount++;
            results.push({
              id: news.id,
              title: news.title,
              status: 'error',
              message: '分析失败'
            });
            console.log(`✗ 分析失败: ${news.id}`);
          }
        } catch (error) {
          errorCount++;
          console.error(`分析新闻 ${news.id} 时出错:`, error);
          results.push({
            id: news.id,
            title: news.title,
            status: 'error',
            message: error.message
          });
        }

        // 更新进度
        global.analysisProgress[taskId] = {
          ...global.analysisProgress[taskId],
          processed: i + 1,
          successCount,
          errorCount,
          results: results.slice(-20) // 只保留最后20条结果
        };

        // 添加延迟避免API频率限制
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // 完成
      global.analysisProgress[taskId] = {
        ...global.analysisProgress[taskId],
        status: 'completed',
        processed: validNews.length,
        successCount,
        errorCount
      };

      console.log(`\n========== 批量重新分析完成 ==========`);
      console.log(`总计: ${validNews.length} 条`);
      console.log(`成功: ${successCount} 条`);
      console.log(`失败: ${errorCount} 条`);
    });

  } catch (error) {
    console.error('批量重新分析失败:', error);
    res.status(500).json({
      success: false,
      message: '分析失败: ' + error.message
    });
  }
});

// 诊断工具：测试特定URL的正文提取
router.post('/diagnose-extraction', checkAdminPermission, async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: '请提供URL参数'
      });
    }
    
    console.log(`[诊断工具] 开始测试URL: ${url}`);
    
    const newsAnalysis = require('../utils/newsAnalysis');
    const axios = require('axios');
    
    // 1. 获取原始HTML
    let html = null;
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      if (response.status === 200 && response.data) {
        html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        console.log(`[诊断工具] ✓ 成功获取HTML，长度: ${html.length}字符`);
      } else {
        return res.status(500).json({
          success: false,
          message: `HTTP状态码: ${response.status}`,
          data: { step: 'fetch_html', status: response.status }
        });
      }
    } catch (error) {
      console.error(`[诊断工具] 获取HTML失败:`, error.message);
      return res.status(500).json({
        success: false,
        message: `获取HTML失败: ${error.message}`,
        data: { step: 'fetch_html', error: error.message }
      });
    }
    
    // 2. 检查HTML结构
    const hasArticleTag = /<article[^>]*>/i.test(html);
    const hasMainNews = /main-news/i.test(html);
    const hasArticleWithHtml = /article-with-html/i.test(html);
    
    // 查找所有article标签
    const articleTags = [];
    const articleTagRegex = /<article[^>]*>/gi;
    let articleMatch;
    while ((articleMatch = articleTagRegex.exec(html)) !== null) {
      const tag = articleMatch[0];
      const classMatch = tag.match(/class\s*=\s*["']([^"']*)["']/i);
      articleTags.push({
        tag: tag.substring(0, 200),
        class: classMatch ? classMatch[1] : null
      });
    }
    
    // 3. 提取正文内容
    let extractedContent = null;
    let extractionLogs = [];
    
    // 捕获console.log输出
    const originalLog = console.log;
    const logs = [];
    console.log = (...args) => {
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
      if (message.includes('extractArticleContent') || message.includes('fetchContentFromUrl') || message.includes('findArticleContent')) {
        logs.push(message);
      }
      originalLog.apply(console, args);
    };
    
    try {
      extractedContent = await newsAnalysis.fetchContentFromUrl(url);
      extractionLogs = logs;
    } catch (error) {
      console.error(`[诊断工具] 提取正文失败:`, error.message);
      extractionLogs = logs;
      extractionLogs.push(`错误: ${error.message}`);
    } finally {
      console.log = originalLog;
    }
    
    // 4. 如果提取失败，尝试直接调用extractArticleContent
    let directExtraction = null;
    if (!extractedContent || extractedContent.length < 50) {
      try {
        directExtraction = newsAnalysis.extractArticleContent(html);
        if (directExtraction) {
          const textOnly = directExtraction.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          directExtraction = {
            html: directExtraction.substring(0, 5000), // 增加到5000字符以便查看完整内容
            text: textOnly.substring(0, 5000),
            textLength: textOnly.length
          };
        }
      } catch (error) {
        console.error(`[诊断工具] 直接提取失败:`, error.message);
      }
    }
    
    // 5. 查找包含main-news的article标签的完整内容（用于调试）
    let mainNewsArticleSample = null;
    if (hasMainNews) {
      const mainNewsMatch = html.match(/<article[^>]*class\s*=\s*["'][^"']*\bmain-news\b[^"']*["'][^>]*>([\s\S]{0,2000})/i);
      if (mainNewsMatch) {
        mainNewsArticleSample = {
          tag: mainNewsMatch[0].substring(0, 500),
          contentPreview: mainNewsMatch[1] ? mainNewsMatch[1].substring(0, 500) : null
        };
      }
    }
    
    // 6. 生成建议
    const recommendations = [];
    if (!hasArticleTag) {
      recommendations.push('HTML中未找到article标签，可能需要使用其他选择器');
    }
    if (hasMainNews && (!extractedContent || extractedContent.length < 50)) {
      recommendations.push('HTML中包含main-news但未提取成功，可能需要调整正则表达式');
    }
    if (extractedContent && extractedContent.length < 50) {
      recommendations.push('提取的内容太短，可能匹配到了错误的标签或内容被截断');
    }
    if (articleTags.length > 1) {
      recommendations.push(`找到${articleTags.length}个article标签，需要确保匹配到正确的标签`);
    }
    if (!hasMainNews && !hasArticleWithHtml) {
      recommendations.push('HTML中未找到main-news或article-with-html类，可能需要检查HTML结构是否变化');
    }
    
    // 7. 返回诊断结果
    res.json({
      success: true,
      message: '诊断完成',
      data: {
        url,
        htmlInfo: {
          length: html.length,
          hasArticleTag,
          hasMainNews,
          hasArticleWithHtml,
          articleTagsCount: articleTags.length,
          articleTags: articleTags.slice(0, 10) // 只返回前10个
        },
        extraction: {
          success: !!(extractedContent && extractedContent.length >= 50),
          contentLength: extractedContent ? extractedContent.length : 0,
          contentPreview: extractedContent ? extractedContent.substring(0, 2000) : null, // 增加到2000字符
          contentFull: extractedContent ? extractedContent : null, // 添加完整内容
          logs: extractionLogs
        },
        directExtraction: directExtraction,
        mainNewsArticleSample: mainNewsArticleSample,
        recommendations: recommendations
      }
    });
    
  } catch (error) {
    console.error('[诊断工具] 诊断失败:', error);
    res.status(500).json({
      success: false,
      message: '诊断失败: ' + error.message,
      error: error.stack
    });
  }
});

// 确保导出的是路由对象
if (!router || typeof router.use !== 'function') {
  console.error('错误：router对象无效');
  throw new Error('router对象无效，无法导出');
}

module.exports = router;

