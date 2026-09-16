'use strict';

/**
 * 名单合并策略（纯函数，便于单测）。
 * 竞品：有效行保留不覆盖；软删不复活。
 * 推荐：有效行跳过；软删需用户勾选才复活并重置分/来源/覆盖。
 * 手工/Excel：有效行不重复；软删复活并保留勾选/档位/入池/底稿。
 */
function resolveMergeAction(source, { hasActive, hasDeleted } = {}) {
  const src = String(source || '');
  if (hasActive) {
    if (src === 'competitor_run') return 'keep_fill_empty';
    return 'skip';
  }
  if (hasDeleted) {
    if (src === 'competitor_run') return 'skip';
    if (src === 'industry_recommend') return 'revive_reset';
    if (src === 'manual' || src === 'excel') return 'revive_keep';
    return 'skip';
  }
  return 'insert';
}

module.exports = { resolveMergeAction };
