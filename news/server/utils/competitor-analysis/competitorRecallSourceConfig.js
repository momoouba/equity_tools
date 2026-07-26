const db = require('../../db');
const { COMPETITOR_ANALYSIS_APP_ID } = require('./constants');

const DEFAULTS = {
  enable_ipo_project: true,
  enable_financing_event: true,
  enable_ai_web: true,
  /** Stage 4：0=1.0 ipo_project 主召回，1=ipo_new_share 主召回（默认关，可回滚） */
  use_new_share_listed_recall: false,
  /** Stage 4：并行跑新旧召回对比写入 step_log，不双写 relation */
  enable_recall_ab_compare: false,
  /** 可选灰度赛道，如 "ai" 或 "ai,bio"；空=全量 */
  new_share_gray_categories: '',
};

/**
 * @returns {Promise<object>}
 */
async function getCompetitorRecallSourceFlags() {
  let rows;
  try {
    rows = await db.query(
      `SELECT F_Id, enable_ipo_project, enable_financing_event, enable_ai_web,
              use_new_share_listed_recall, enable_recall_ab_compare, new_share_gray_categories
       FROM competitor_recall_source_config
       WHERE app_id = ? AND F_DeleteMark = 0
       LIMIT 1`,
      [COMPETITOR_ANALYSIS_APP_ID]
    );
  } catch (err) {
    // 迁移未跑完或表不存在时回退旧列，避免拖垮 Runner
    const msg = String(err.message || '');
    if (/Unknown column/i.test(msg) || /ER_NO_SUCH_TABLE/i.test(msg)) {
      try {
        rows = await db.query(
          `SELECT F_Id, enable_ipo_project, enable_financing_event
           FROM competitor_recall_source_config
           WHERE app_id = ? AND F_DeleteMark = 0
           LIMIT 1`,
          [COMPETITOR_ANALYSIS_APP_ID]
        );
      } catch (innerErr) {
        // 表完全不存在时返回默认值
        if (/ER_NO_SUCH_TABLE/i.test(String(innerErr.message || ''))) {
          return { id: null, ...DEFAULTS };
        }
        throw innerErr;
      }
    } else {
      throw err;
    }
  }
  if (!rows.length) return { id: null, ...DEFAULTS };
  const r = rows[0];
  return {
    id: r.F_Id,
    enable_ipo_project: !!Number(r.enable_ipo_project),
    enable_financing_event: !!Number(r.enable_financing_event),
    enable_ai_web: !!Number(r.enable_ai_web),
    use_new_share_listed_recall: !!Number(r.use_new_share_listed_recall || 0),
    enable_recall_ab_compare: !!Number(r.enable_recall_ab_compare || 0),
    new_share_gray_categories: String(r.new_share_gray_categories || '').trim(),
  };
}

/**
 * @param {object} flags
 */
async function saveCompetitorRecallSourceFlags(flags) {
  const current = await getCompetitorRecallSourceFlags();
  const payload = {
    enable_ipo_project:
      flags.enable_ipo_project !== undefined ? !!flags.enable_ipo_project : current.enable_ipo_project,
    enable_financing_event:
      flags.enable_financing_event !== undefined
        ? !!flags.enable_financing_event
        : current.enable_financing_event,
    enable_ai_web: flags.enable_ai_web !== undefined ? !!flags.enable_ai_web : current.enable_ai_web,
    use_new_share_listed_recall:
      flags.use_new_share_listed_recall !== undefined
        ? !!flags.use_new_share_listed_recall
        : current.use_new_share_listed_recall,
    enable_recall_ab_compare:
      flags.enable_recall_ab_compare !== undefined
        ? !!flags.enable_recall_ab_compare
        : current.enable_recall_ab_compare,
    new_share_gray_categories:
      flags.new_share_gray_categories !== undefined
        ? String(flags.new_share_gray_categories || '').trim()
        : current.new_share_gray_categories,
  };
  try {
    if (current.id) {
      await db.execute(
        `UPDATE competitor_recall_source_config
         SET enable_ipo_project = ?, enable_financing_event = ?, enable_ai_web = ?,
             use_new_share_listed_recall = ?, enable_recall_ab_compare = ?,
             new_share_gray_categories = ?, F_LastModifyTime = NOW()
         WHERE F_Id = ? AND F_DeleteMark = 0`,
        [
          payload.enable_ipo_project ? 1 : 0,
          payload.enable_financing_event ? 1 : 0,
          payload.enable_ai_web ? 1 : 0,
          payload.use_new_share_listed_recall ? 1 : 0,
          payload.enable_recall_ab_compare ? 1 : 0,
          payload.new_share_gray_categories || null,
          current.id,
        ]
      );
      return payload;
    }
    const { generateId } = require('../idGenerator');
    const rid = await generateId('competitor_recall_source_config');
    await db.execute(
      `INSERT INTO competitor_recall_source_config (
        F_Id, app_id, enable_ipo_project, enable_financing_event, enable_ai_web,
        use_new_share_listed_recall, enable_recall_ab_compare, new_share_gray_categories
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rid,
        COMPETITOR_ANALYSIS_APP_ID,
        payload.enable_ipo_project ? 1 : 0,
        payload.enable_financing_event ? 1 : 0,
        payload.enable_ai_web ? 1 : 0,
        payload.use_new_share_listed_recall ? 1 : 0,
        payload.enable_recall_ab_compare ? 1 : 0,
        payload.new_share_gray_categories || null,
      ]
    );
    return payload;
  } catch (err) {
    console.error('[competitorRecallSourceConfig] save failed:', err.message);
    throw new Error('保存召回源配置失败，请检查数据库表结构是否已迁移: ' + err.message);
  }
}

module.exports = {
  getCompetitorRecallSourceFlags,
  saveCompetitorRecallSourceFlags,
  DEFAULTS,
};
