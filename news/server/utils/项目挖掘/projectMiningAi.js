const db = require('../../db');
const newsAnalysis = require('../newsAnalysis');

const APP_TYPE = 'project_sourcing_analysis';
const USAGE_TYPE = 'project_mining';

/**
 * 当前启用的「项目挖掘」大模型配置（应用类型=项目挖掘分析，使用类型=项目挖掘）。
 */
async function getActiveProjectMiningModelConfig() {
  const rows = await db.query(
    `SELECT * FROM ai_model_config
     WHERE delete_mark = 0 AND is_active = 1
       AND application_type = ? AND usage_type = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    [APP_TYPE, USAGE_TYPE]
  );
  return rows && rows.length ? rows[0] : null;
}

/**
 * 使用项目挖掘专用模型配置发起一次对话（供后续字段抽取、归类等复用）。
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function invokeProjectMiningChat(prompt) {
  const config = await getActiveProjectMiningModelConfig();
  if (!config) {
    throw new Error(
      '未找到启用的项目挖掘大模型配置：请在「系统设置 → AI模型配置」中新增一条应用类型为「项目挖掘分析」、使用类型为「项目挖掘」且启用的配置'
    );
  }
  return newsAnalysis.callAIModel(prompt, config);
}

module.exports = {
  APP_TYPE,
  USAGE_TYPE,
  getActiveProjectMiningModelConfig,
  invokeProjectMiningChat,
};
