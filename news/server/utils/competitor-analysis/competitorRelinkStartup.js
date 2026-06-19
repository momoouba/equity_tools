'use strict';

const { relinkOrphanCompetitorDataBySubjectMatch } = require('./competitorSyncSnapshot');

/**
 * 服务启动后执行：将仍指向旧 invested_enterprise_id 的竞品数据按信用代码/名称挂回当前被投。
 * 环境变量 COMPETITOR_RELINK_ON_STARTUP=0 可关闭。
 */
async function runCompetitorRelinkOnStartup() {
  if (String(process.env.COMPETITOR_RELINK_ON_STARTUP || '1').trim() === '0') {
    console.log('[竞品关联修复] 已跳过启动时重挂（COMPETITOR_RELINK_ON_STARTUP=0）');
    return null;
  }
  console.log('[竞品关联修复] 启动时检查孤儿竞品数据（按统一社会信用代码/企业名称匹配）…');
  try {
    const stats = await relinkOrphanCompetitorDataBySubjectMatch();
    if (stats.relinked > 0) {
      console.log(
        `[竞品关联修复] 启动完成：重挂 ${stats.relinked} 组旧 id → 新被投（未解析 ${stats.unresolved}）`
      );
    } else if (stats.orphan_old_ids > 0) {
      console.log(
        `[竞品关联修复] 发现 ${stats.orphan_old_ids} 个孤儿旧 id，未能自动匹配（可检查快照表或补全信用代码后重试）`
      );
    }
    return stats;
  } catch (e) {
    console.error('[竞品关联修复] 启动时重挂失败（不影响服务启动）:', e.message);
    return null;
  }
}

module.exports = { runCompetitorRelinkOnStartup };
