'use strict';

/**
 * ai_model_config：LLM 调用协议与联网模式（gateway / 多模型中转）。
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

const COLUMNS = [
  {
    name: 'wire_protocol',
    ddl: `ADD COLUMN wire_protocol VARCHAR(32) NULL DEFAULT NULL
      COMMENT 'HTTP协议：chat_completions/responses/alibaba_native'
      AFTER enable_thinking`,
  },
  {
    name: 'web_search_mode',
    ddl: `ADD COLUMN web_search_mode VARCHAR(40) NULL DEFAULT NULL
      COMMENT '联网：off/dashscope_enable_search/openai_web_search_tool/openai_web_search_options'
      AFTER wire_protocol`,
  },
  {
    name: 'reasoning_effort',
    ddl: `ADD COLUMN reasoning_effort VARCHAR(16) NULL DEFAULT NULL
      COMMENT 'Responses API reasoning.effort：low/medium/high/xhigh'
      AFTER web_search_mode`,
  },
];

async function ensureAiModelConfigLlmFields(pool) {
  if (!pool) return 0;
  let added = 0;
  for (const col of COLUMNS) {
    if (await columnExists(pool, col.name)) continue;
    await pool.query(`ALTER TABLE ai_model_config ${col.ddl}`);
    added += 1;
  }
  return added;
}

module.exports = { ensureAiModelConfigLlmFields };
