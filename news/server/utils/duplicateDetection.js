const db = require('../db');

/**
 * 计算两个字符串的相似度（使用Jaccard相似度）
 * @param {string} str1 - 第一个字符串
 * @param {string} str2 - 第二个字符串
 * @returns {number} - 相似度（0-1之间）
 */
function calculateJaccardSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  // 将字符串转换为字符集合
  const set1 = new Set(str1.toLowerCase().replace(/\s+/g, ''));
  const set2 = new Set(str2.toLowerCase().replace(/\s+/g, ''));
  
  // 计算交集
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  
  // 计算并集
  const union = new Set([...set1, ...set2]);
  
  // 返回Jaccard相似度
  return intersection.size / union.size;
}

/**
 * 计算两个字符串的编辑距离相似度
 * @param {string} str1 - 第一个字符串
 * @param {string} str2 - 第二个字符串
 * @returns {number} - 相似度（0-1之间）
 */
function calculateLevenshteinSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;
  
  const len1 = str1.length;
  const len2 = str2.length;
  
  if (len1 === 0) return 0;
  if (len2 === 0) return 0;
  
  // 创建距离矩阵
  const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));
  
  // 初始化第一行和第一列
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;
  
  // 计算编辑距离
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // 删除
        matrix[i][j - 1] + 1,     // 插入
        matrix[i - 1][j - 1] + cost // 替换
      );
    }
  }
  
  const distance = matrix[len1][len2];
  const maxLength = Math.max(len1, len2);
  
  return 1 - (distance / maxLength);
}

/**
 * 计算两个文本的综合相似度
 * @param {string} text1 - 第一个文本
 * @param {string} text2 - 第二个文本
 * @returns {number} - 相似度（0-1之间）
 */
function calculateTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  
  // 清理文本：移除多余空格、标点符号等
  const cleanText1 = text1.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();
  const cleanText2 = text2.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();
  
  if (cleanText1 === cleanText2) return 1;
  if (cleanText1.length === 0 || cleanText2.length === 0) return 0;
  
  // 使用Jaccard相似度和编辑距离相似度的加权平均
  const jaccardSimilarity = calculateJaccardSimilarity(cleanText1, cleanText2);
  const levenshteinSimilarity = calculateLevenshteinSimilarity(cleanText1, cleanText2);
  
  // 权重：Jaccard 60%, Levenshtein 40%
  return jaccardSimilarity * 0.6 + levenshteinSimilarity * 0.4;
}

/**
 * 检查标题相似度
 * @param {string} title1 - 第一个标题
 * @param {string} title2 - 第二个标题
 * @returns {boolean} - 是否相似
 */
function isTitleSimilar(title1, title2) {
  const similarity = calculateTextSimilarity(title1, title2);
  // 标题相似度阈值设为0.7（70%）
  return similarity >= 0.7;
}

/**
 * 检查内容相似度
 * @param {string} content1 - 第一个内容
 * @param {string} content2 - 第二个内容
 * @returns {number} - 相似度（0-1之间）
 */
function calculateContentSimilarity(content1, content2) {
  return calculateTextSimilarity(content1, content2);
}

/**
 * 检查新文章是否与现有文章重复
 * @param {string} title - 新文章标题
 * @param {string} content - 新文章内容
 * @param {string} sourceUrl - 新文章链接（用于排除自己）
 * @param {string} currentCreatedAt - 当前文章的创建时间（可选，用于只检查更早的文章）
 * @returns {Promise<{isDuplicate: boolean, duplicateId?: string, similarity?: number}>}
 */
async function checkArticleDuplicate(title, content, sourceUrl, currentCreatedAt = null) {
  try {
    let query = `SELECT id, title, content, source_url, created_at
                 FROM news_detail 
                 WHERE delete_mark = 0 
                 AND source_url != ?`;
    let params = [sourceUrl];

    // 如果提供了当前文章的创建时间，只检查更早的文章
    if (currentCreatedAt) {
      query += ` AND created_at < ?`;
      params.push(currentCreatedAt);
    } else {
      // 如果没有提供时间，检查最近30天内的文章
      query += ` AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`;
    }

    query += ` ORDER BY created_at DESC LIMIT 1000`; // 限制查询数量，避免性能问题

    const existingArticles = await db.query(query, params);

    for (const article of existingArticles) {
      // 检查标题相似度
      const titleSimilar = isTitleSimilar(title, article.title);
      
      if (titleSimilar) {
        // 如果标题相似，检查内容相似度
        const contentSimilarity = calculateContentSimilarity(content, article.content);
        
        if (contentSimilarity >= 0.8) { // 内容相似度阈值80%
          return {
            isDuplicate: true,
            duplicateId: article.id,
            similarity: contentSimilarity,
            duplicateTitle: article.title,
            duplicateUrl: article.source_url
          };
        }
      }
    }

    return { isDuplicate: false };
  } catch (error) {
    console.error('检查文章重复时出错:', error);
    // 出错时不阻止文章入库，但记录错误
    return { isDuplicate: false, error: error.message };
  }
}

/**
 * 批量检查并标记重复文章
 * @param {Array} articles - 文章列表
 * @returns {Promise<{processed: number, duplicates: number, errors: number}>}
 */
async function batchCheckDuplicates(articles) {
  let processed = 0;
  let duplicates = 0;
  let errors = 0;

  for (const article of articles) {
    try {
      const result = await checkArticleDuplicate(
        article.title, 
        article.content, 
        article.source_url
      );

      if (result.isDuplicate) {
        // 标记为重复文章
        await db.execute(
          'UPDATE news_detail SET delete_mark = 1 WHERE id = ?',
          [article.id]
        );
        duplicates++;
        console.log(`标记重复文章: ${article.title} (相似度: ${(result.similarity * 100).toFixed(1)}%)`);
      }

      processed++;
    } catch (error) {
      console.error(`处理文章 ${article.id} 时出错:`, error);
      errors++;
    }
  }

  return { processed, duplicates, errors };
}

module.exports = {
  calculateTextSimilarity,
  calculateContentSimilarity,
  isTitleSimilar,
  checkArticleDuplicate,
  batchCheckDuplicates
};
