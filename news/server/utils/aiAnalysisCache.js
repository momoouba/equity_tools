/**
 * AI分析缓存工具
 * 用于避免在短时间内对相同的新闻ID重复进行AI分析
 */

// 缓存：存储最近分析的新闻ID和时间戳
// 格式：Map<newsId, timestamp>
const analysisCache = new Map();

// 缓存有效期：20分钟（毫秒）
const CACHE_TTL = 20 * 60 * 1000;

/**
 * 清理过期的缓存条目
 */
function cleanExpiredCache() {
  const now = Date.now();
  for (const [newsId, timestamp] of analysisCache.entries()) {
    if (now - timestamp > CACHE_TTL) {
      analysisCache.delete(newsId);
    }
  }
}

/**
 * 检查新闻ID是否在缓存中（20分钟内已分析过）
 * @param {string} newsId - 新闻ID
 * @returns {boolean} - 如果20分钟内已分析过，返回true；否则返回false
 */
function isRecentlyAnalyzed(newsId) {
  cleanExpiredCache();
  
  if (!analysisCache.has(newsId)) {
    return false;
  }
  
  const timestamp = analysisCache.get(newsId);
  const now = Date.now();
  const timeDiff = now - timestamp;
  
  if (timeDiff > CACHE_TTL) {
    // 已过期，删除缓存
    analysisCache.delete(newsId);
    return false;
  }
  
  return true;
}

/**
 * 记录新闻ID的分析时间戳
 * @param {string} newsId - 新闻ID
 */
function recordAnalysis(newsId) {
  analysisCache.set(newsId, Date.now());
}

/**
 * 获取缓存统计信息（用于调试）
 * @returns {Object} - 缓存统计信息
 */
function getCacheStats() {
  cleanExpiredCache();
  return {
    size: analysisCache.size,
    entries: Array.from(analysisCache.entries()).map(([id, timestamp]) => ({
      newsId: id,
      timestamp: new Date(timestamp).toISOString(),
      ageMinutes: Math.round((Date.now() - timestamp) / 60000)
    }))
  };
}

module.exports = {
  isRecentlyAnalyzed,
  recordAnalysis,
  getCacheStats,
  cleanExpiredCache
};
