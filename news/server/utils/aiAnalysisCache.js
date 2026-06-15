/**
 * AI分析缓存工具
 * 用于避免在短时间内对相同的新闻ID重复进行AI分析（数据库持久化）
 */
const db = require('../db');

// 缓存有效期：2小时（毫秒）
const CACHE_TTL = 2 * 60 * 60 * 1000;

/**
 * 清理过期的缓存条目
 */
async function cleanExpiredCache() {
  try {
    await db.execute(
      `DELETE FROM ai_news_analysis_cache
       WHERE analyzed_at < (NOW() - INTERVAL 2 HOUR)`
    );
  } catch (error) {
    console.warn('[AI分析缓存] 清理过期记录失败:', error.message);
  }
}

/**
 * 检查新闻ID是否在缓存中（2小时内已分析过）
 * @param {string} newsId - 新闻ID
 * @returns {boolean} - 如果2小时内已分析过，返回true；否则返回false
 */
async function isRecentlyAnalyzed(newsId) {
  await cleanExpiredCache();
  const rows = await db.query(
    `SELECT news_id
     FROM ai_news_analysis_cache
     WHERE news_id = ?
       AND analyzed_at >= (NOW() - INTERVAL 2 HOUR)
     LIMIT 1`,
    [String(newsId)]
  );
  return rows.length > 0;
}

/**
 * 记录新闻ID的分析时间戳
 * @param {string} newsId - 新闻ID
 */
async function recordAnalysis(newsId) {
  await db.execute(
    `INSERT INTO ai_news_analysis_cache (news_id, analyzed_at, F_LastModifyTime)
     VALUES (?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       analyzed_at = VALUES(analyzed_at),
       F_LastModifyTime = VALUES(F_LastModifyTime)`,
    [String(newsId)]
  );
}

/**
 * 获取缓存统计信息（用于调试）
 * @returns {Object} - 缓存统计信息
 */
async function getCacheStats() {
  await cleanExpiredCache();
  const rows = await db.query(
    `SELECT news_id, analyzed_at
     FROM ai_news_analysis_cache
     ORDER BY analyzed_at DESC
     LIMIT 1000`
  );
  const now = Date.now();
  return {
    size: rows.length,
    entries: rows.map((r) => {
      const ts = new Date(r.analyzed_at).getTime();
      return {
        newsId: r.news_id,
        timestamp: new Date(r.analyzed_at).toISOString(),
        ageMinutes: Math.round((now - ts) / 60000)
      };
    })
  };
}

module.exports = {
  isRecentlyAnalyzed,
  recordAnalysis,
  getCacheStats,
  cleanExpiredCache
};
