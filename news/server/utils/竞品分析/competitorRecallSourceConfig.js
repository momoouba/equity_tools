const db = require('../../db');
const { COMPETITOR_ANALYSIS_APP_ID } = require('./constants');

const DEFAULTS = {
  enable_ipo_project: true,
  enable_financing_event: true,
  enable_ai_web: true,
};

/**
 * @returns {Promise<{ enable_ipo_project: boolean, enable_financing_event: boolean, enable_ai_web: boolean }>}
 */
async function getCompetitorRecallSourceFlags() {
  const rows = await db.query(
    `SELECT id, enable_ipo_project, enable_financing_event, enable_ai_web
     FROM competitor_recall_source_config
     WHERE app_id = ? AND delete_mark = 0
     LIMIT 1`,
    [COMPETITOR_ANALYSIS_APP_ID]
  );
  if (!rows.length) return { id: null, ...DEFAULTS };
  const r = rows[0];
  return {
    id: r.id,
    enable_ipo_project: !!Number(r.enable_ipo_project),
    enable_financing_event: !!Number(r.enable_financing_event),
    enable_ai_web: !!Number(r.enable_ai_web),
  };
}

/**
 * @param {{ enable_ipo_project?: boolean, enable_financing_event?: boolean, enable_ai_web?: boolean }} flags
 */
async function saveCompetitorRecallSourceFlags(flags) {
  const current = await getCompetitorRecallSourceFlags();
  const payload = {
    enable_ipo_project: flags.enable_ipo_project !== undefined ? !!flags.enable_ipo_project : current.enable_ipo_project,
    enable_financing_event:
      flags.enable_financing_event !== undefined ? !!flags.enable_financing_event : current.enable_financing_event,
    enable_ai_web: flags.enable_ai_web !== undefined ? !!flags.enable_ai_web : current.enable_ai_web,
  };
  if (current.id) {
    await db.execute(
      `UPDATE competitor_recall_source_config
       SET enable_ipo_project = ?, enable_financing_event = ?, enable_ai_web = ?, updated_at = NOW()
       WHERE id = ? AND delete_mark = 0`,
      [
        payload.enable_ipo_project ? 1 : 0,
        payload.enable_financing_event ? 1 : 0,
        payload.enable_ai_web ? 1 : 0,
        current.id,
      ]
    );
    return payload;
  }
  const { generateId } = require('../idGenerator');
  const rid = await generateId('competitor_recall_source_config');
  await db.execute(
    `INSERT INTO competitor_recall_source_config (
      id, app_id, enable_ipo_project, enable_financing_event, enable_ai_web
    ) VALUES (?, ?, ?, ?, ?)`,
    [
      rid,
      COMPETITOR_ANALYSIS_APP_ID,
      payload.enable_ipo_project ? 1 : 0,
      payload.enable_financing_event ? 1 : 0,
      payload.enable_ai_web ? 1 : 0,
    ]
  );
  return payload;
}

module.exports = {
  getCompetitorRecallSourceFlags,
  saveCompetitorRecallSourceFlags,
  DEFAULTS,
};
