'use strict';

/**
 * ai_model_config.enable_thinking：仅「联网 AI 补齐」（融资/被投/投前/IPO）读取；NULL 时走环境变量。
 */
async function columnExists(pool, columnName) {
  const [rows] = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'ai_model_config'
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [columnName]
  );
  return rows.length > 0;
}

async function ensureAiModelConfigEnrichFlags(pool) {
  if (!pool) return 0;
  if (await columnExists(pool, 'enable_thinking')) return 0;
  await pool.query(`
    ALTER TABLE ai_model_config
    ADD COLUMN enable_thinking TINYINT NULL DEFAULT NULL
    COMMENT '联网AI补齐：1开启深度思考，0关闭；NULL走FINANCING_AI_ENABLE_THINKING'
    AFTER top_p
  `);
  return 1;
}

module.exports = { ensureAiModelConfigEnrichFlags };
