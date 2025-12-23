const db = require('../db');
const NewsAnalysis = require('./newsAnalysis');

/**
 * 新闻数据去重和清理工具
 */
class NewsDeduplication {
  constructor() {
    this.newsAnalysis = new NewsAnalysis();
  }

  /**
   * 检查内容是否包含乱码
   * @param {string} content - 内容
   * @returns {boolean} - 是否包含乱码
   */
  isContentContaminated(content) {
    if (!content || typeof content !== 'string') {
      return false;
    }
    return this.newsAnalysis.isContentContaminated(content);
  }

  /**
   * 通过source_url去重和清理
   * @returns {Promise<number>} - 清理的记录数
   */
  async deduplicateBySourceUrl() {
    try {
      console.log('[数据去重] 开始通过source_url进行去重和清理...');
      
      // 查找所有有重复source_url的记录（排除已删除的）
      const duplicates = await db.query(
        `SELECT source_url, COUNT(*) as count, GROUP_CONCAT(id ORDER BY created_at) as ids
         FROM news_detail
         WHERE source_url IS NOT NULL AND source_url != '' AND delete_mark = 0
         GROUP BY source_url
         HAVING count > 1`
      );

      if (duplicates.length === 0) {
        console.log('[数据去重] 未发现通过source_url重复的记录');
        return 0;
      }

      console.log(`[数据去重] 发现 ${duplicates.length} 组通过source_url重复的记录`);

      let cleanedCount = 0;

      for (const duplicate of duplicates) {
        const ids = duplicate.ids.split(',');
        const sourceUrl = duplicate.source_url;

        // 获取所有重复记录的详细信息
        const records = await db.query(
          `SELECT id, content, APItype, created_at, delete_mark
           FROM news_detail
           WHERE id IN (${ids.map(() => '?').join(',')}) AND delete_mark = 0
           ORDER BY created_at ASC`,
          ids
        );

        if (records.length <= 1) {
          continue;
        }

        console.log(`[数据去重] 处理source_url重复: ${sourceUrl}, 共 ${records.length} 条记录`);

        // 检查每条记录的内容是否包含乱码
        const recordsWithContamination = records.map(record => ({
          ...record,
          isContaminated: this.isContentContaminated(record.content || '')
        }));

        // 找出有乱码的记录
        const contaminatedRecords = recordsWithContamination.filter(r => r.isContaminated);
        // 找出没有乱码的记录
        const cleanRecords = recordsWithContaminated.filter(r => !r.isContaminated);

        // 如果有乱码的记录，优先删除乱码的记录
        if (contaminatedRecords.length > 0) {
          for (const record of contaminatedRecords) {
            await db.execute(
              'UPDATE news_detail SET delete_mark = 1 WHERE id = ?',
              [record.id]
            );
            cleanedCount++;
            console.log(`[数据去重] ✓ 删除乱码记录: ID=${record.id}, APItype=${record.APItype}, source_url=${sourceUrl}`);
          }
        } else {
          // 如果都没有乱码，优先删除企查查接口的数据
          const qichachaRecords = cleanRecords.filter(r => r.APItype === '企查查');
          if (qichachaRecords.length > 0) {
            for (const record of qichachaRecords) {
              await db.execute(
                'UPDATE news_detail SET delete_mark = 1 WHERE id = ?',
                [record.id]
              );
              cleanedCount++;
              console.log(`[数据去重] ✓ 删除企查查接口记录（无乱码，优先删除）: ID=${record.id}, source_url=${sourceUrl}`);
            }
          } else {
            // 如果没有企查查的记录，删除最早的一条（保留最新的）
            const recordsToDelete = cleanRecords.slice(0, cleanRecords.length - 1);
            for (const record of recordsToDelete) {
              await db.execute(
                'UPDATE news_detail SET delete_mark = 1 WHERE id = ?',
                [record.id]
              );
              cleanedCount++;
              console.log(`[数据去重] ✓ 删除重复记录（保留最新）: ID=${record.id}, APItype=${record.APItype}, source_url=${sourceUrl}`);
            }
          }
        }
      }

      console.log(`[数据去重] 通过source_url去重完成，共清理 ${cleanedCount} 条记录`);
      return cleanedCount;
    } catch (error) {
      console.error('[数据去重] 通过source_url去重失败:', error);
      throw error;
    }
  }

  /**
   * 通过title去重和清理（只处理source_url不重复的记录）
   * @returns {Promise<number>} - 清理的记录数
   */
  async deduplicateByTitle() {
    try {
      console.log('[数据去重] 开始通过title进行去重和清理...');
      
      // 先找出所有source_url重复的记录ID（这些记录已经在第一步处理过了）
      const sourceUrlDuplicates = await db.query(
        `SELECT GROUP_CONCAT(id) as ids
         FROM news_detail
         WHERE source_url IS NOT NULL AND source_url != '' AND delete_mark = 0
         GROUP BY source_url
         HAVING COUNT(*) > 1`
      );
      
      const processedIds = new Set();
      if (sourceUrlDuplicates.length > 0) {
        sourceUrlDuplicates.forEach(row => {
          if (row.ids) {
            row.ids.split(',').forEach(id => processedIds.add(id));
          }
        });
      }
      
      // 查找所有有重复title的记录（排除已删除的，且不在source_url重复记录中的）
      let duplicates;
      if (processedIds.size > 0) {
        const processedIdsArray = Array.from(processedIds);
        const placeholders = processedIdsArray.map(() => '?').join(',');
        duplicates = await db.query(
          `SELECT title, COUNT(*) as count, GROUP_CONCAT(id ORDER BY created_at) as ids
           FROM news_detail
           WHERE title IS NOT NULL AND title != '' AND delete_mark = 0
             AND id NOT IN (${placeholders})
           GROUP BY title
           HAVING count > 1`,
          processedIdsArray
        );
      } else {
        duplicates = await db.query(
          `SELECT title, COUNT(*) as count, GROUP_CONCAT(id ORDER BY created_at) as ids
           FROM news_detail
           WHERE title IS NOT NULL AND title != '' AND delete_mark = 0
           GROUP BY title
           HAVING count > 1`
        );
      }

      if (duplicates.length === 0) {
        console.log('[数据去重] 未发现通过title重复的记录');
        return 0;
      }

      console.log(`[数据去重] 发现 ${duplicates.length} 组通过title重复的记录`);

      let cleanedCount = 0;

      for (const duplicate of duplicates) {
        const ids = duplicate.ids.split(',');
        const title = duplicate.title;

        // 获取所有重复记录的详细信息
        const records = await db.query(
          `SELECT id, content, APItype, created_at, delete_mark
           FROM news_detail
           WHERE id IN (${ids.map(() => '?').join(',')}) AND delete_mark = 0
           ORDER BY created_at ASC`,
          ids
        );

        if (records.length <= 1) {
          continue;
        }

        console.log(`[数据去重] 处理title重复: ${title.substring(0, 50)}..., 共 ${records.length} 条记录`);

        // 检查每条记录的内容是否包含乱码
        const recordsWithContamination = records.map(record => ({
          ...record,
          isContaminated: this.isContentContaminated(record.content || '')
        }));

        // 找出有乱码的记录
        const contaminatedRecords = recordsWithContamination.filter(r => r.isContaminated);
        // 找出没有乱码的记录
        const cleanRecords = recordsWithContamination.filter(r => !r.isContaminated);

        // 如果有乱码的记录，优先删除乱码的记录
        if (contaminatedRecords.length > 0) {
          for (const record of contaminatedRecords) {
            await db.execute(
              'UPDATE news_detail SET delete_mark = 1 WHERE id = ?',
              [record.id]
            );
            cleanedCount++;
            console.log(`[数据去重] ✓ 删除乱码记录: ID=${record.id}, APItype=${record.APItype}, title=${title.substring(0, 50)}...`);
          }
        } else {
          // 如果都没有乱码，优先删除企查查接口的数据
          const qichachaRecords = cleanRecords.filter(r => r.APItype === '企查查');
          if (qichachaRecords.length > 0) {
            for (const record of qichachaRecords) {
              await db.execute(
                'UPDATE news_detail SET delete_mark = 1 WHERE id = ?',
                [record.id]
              );
              cleanedCount++;
              console.log(`[数据去重] ✓ 删除企查查接口记录（无乱码，优先删除）: ID=${record.id}, title=${title.substring(0, 50)}...`);
            }
          } else {
            // 如果没有企查查的记录，删除最早的一条（保留最新的）
            const recordsToDelete = cleanRecords.slice(0, cleanRecords.length - 1);
            for (const record of recordsToDelete) {
              await db.execute(
                'UPDATE news_detail SET delete_mark = 1 WHERE id = ?',
                [record.id]
              );
              cleanedCount++;
              console.log(`[数据去重] ✓ 删除重复记录（保留最新）: ID=${record.id}, APItype=${record.APItype}, title=${title.substring(0, 50)}...`);
            }
          }
        }
      }

      console.log(`[数据去重] 通过title去重完成，共清理 ${cleanedCount} 条记录`);
      return cleanedCount;
    } catch (error) {
      console.error('[数据去重] 通过title去重失败:', error);
      throw error;
    }
  }

  /**
   * 执行完整的去重和清理流程
   * @returns {Promise<{sourceUrlCleaned: number, titleCleaned: number}>} - 清理结果
   */
  async executeDeduplication() {
    try {
      console.log('[数据去重] ========== 开始数据去重和清理 ==========');
      
      // 第一步：通过source_url去重
      const sourceUrlCleaned = await this.deduplicateBySourceUrl();
      
      // 第二步：通过title去重（只处理source_url不重复的记录）
      const titleCleaned = await this.deduplicateByTitle();
      
      const totalCleaned = sourceUrlCleaned + titleCleaned;
      
      console.log(`[数据去重] ========== 数据去重完成 ==========`);
      console.log(`[数据去重] 通过source_url清理: ${sourceUrlCleaned} 条`);
      console.log(`[数据去重] 通过title清理: ${titleCleaned} 条`);
      console.log(`[数据去重] 总计清理: ${totalCleaned} 条`);
      
      return {
        sourceUrlCleaned,
        titleCleaned,
        totalCleaned
      };
    } catch (error) {
      console.error('[数据去重] 数据去重失败:', error);
      throw error;
    }
  }
}

module.exports = new NewsDeduplication();

