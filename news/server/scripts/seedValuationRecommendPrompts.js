'use strict';

/**
 * 将项目估值可比推荐提示词（业务理由 + 上市提名）写入 ai_prompt_config。
 * Usage: node server/scripts/seedValuationRecommendPrompts.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), override: true });
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const mysql = require('mysql2/promise');
const { buildValuationRecommendPromptSeeds } = require('../utils/valuation/listedIndustryRecommendPrompt');

function pad5(n) {
  return String(n).padStart(5, '0');
}

async function nextId(pool, tableName) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const prefix = `${y}${m}${d}${hh}${mm}${ss}`;
  const todayStart = `${y}${m}${d}00000000000`;
  const todayEnd = `${y}${m}${d}23595999999`;
  const [rows] = await pool.query(
    `SELECT F_Id AS id FROM \`${tableName}\`
     WHERE F_Id >= ? AND F_Id <= ?
     ORDER BY F_Id DESC LIMIT 1`,
    [todayStart, todayEnd]
  );
  const last = rows[0]?.id ? Number(String(rows[0].id).slice(-5)) : 0;
  const seq = Number.isFinite(last) ? last + 1 : 1;
  return `${prefix}${pad5(seq)}`;
}

async function resolveProjectValuationModelId(pool) {
  const [rows] = await pool.query(
    `SELECT F_Id AS id FROM ai_model_config
     WHERE application_type = 'project_valuation'
       AND usage_type = 'project_valuation'
       AND is_active = 1 AND F_DeleteMark = 0
     ORDER BY F_LastModifyTime DESC LIMIT 1`
  );
  if (rows.length) return rows[0].id;
  const [fallback] = await pool.query(
    `SELECT F_Id AS id FROM ai_model_config
     WHERE is_active = 1 AND F_DeleteMark = 0
     ORDER BY F_LastModifyTime DESC LIMIT 1`
  );
  return fallback[0]?.id || null;
}

async function resolveAdminUserId(pool) {
  const [rows] = await pool.query("SELECT F_Id AS id FROM users WHERE account = 'admin' LIMIT 1");
  return rows[0]?.id || null;
}

async function upsertPrompt(pool, prompt, modelId, adminUserId) {
  const [existing] = await pool.query(
    `SELECT F_Id AS id, ai_model_config_id, prompt_content FROM ai_prompt_config
     WHERE interface_type = ? AND prompt_type = ? AND F_DeleteMark = 0
     LIMIT 1`,
    [prompt.interface_type, prompt.prompt_type]
  );
  if (existing.length) {
    const row = existing[0];
    const fields = [];
    const values = [];
    if (!row.ai_model_config_id && modelId) {
      fields.push('ai_model_config_id = ?');
      values.push(modelId);
    }
    if (row.prompt_content !== prompt.prompt_content) {
      fields.push('prompt_content = ?');
      values.push(prompt.prompt_content);
    }
    if (!fields.length) return 'unchanged';
    values.push(row.id);
    await pool.execute(
      `UPDATE ai_prompt_config SET ${fields.join(', ')}, F_LastModifyTime = NOW() WHERE F_Id = ?`,
      values
    );
    return 'updated';
  }
  const id = await nextId(pool, 'ai_prompt_config');
  await pool.execute(
    `INSERT INTO ai_prompt_config
     (F_Id, prompt_name, interface_type, prompt_type, prompt_content, ai_model_config_id, is_active, F_CreatorUserId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      prompt.prompt_name,
      prompt.interface_type,
      prompt.prompt_type,
      prompt.prompt_content,
      modelId,
      1,
      adminUserId,
    ]
  );
  return 'created';
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'investment_tools',
    waitForConnections: true,
    connectionLimit: 4,
  });
  try {
    const [modelId, adminUserId] = await Promise.all([
      resolveProjectValuationModelId(pool),
      resolveAdminUserId(pool),
    ]);
    const actions = {};
    for (const prompt of buildValuationRecommendPromptSeeds()) {
      actions[prompt.prompt_type] = await upsertPrompt(pool, prompt, modelId, adminUserId);
    }
    const [rows] = await pool.query(
      `SELECT prompt_name, prompt_type, CHAR_LENGTH(prompt_content) AS content_len, is_active,
              CASE WHEN ai_model_config_id IS NULL OR ai_model_config_id = '' THEN 0 ELSE 1 END AS has_model
       FROM ai_prompt_config
       WHERE interface_type = '项目估值' AND F_DeleteMark = 0
       ORDER BY prompt_type`
    );
    console.log(JSON.stringify({ actions, rows }, null, 2));
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
