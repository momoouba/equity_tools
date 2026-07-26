/**
 * 投前→投后竞品数据自动迁移定时任务
 *
 * 每天按配置的 cron 表达式执行：
 * 1. 查找投前项目中 enterprise_full_name 与被投企业匹配的记录（同 data_app_id）
 * 2. 排除退出状态为"已上市"或"完全退出"的被投企业
 * 3. 取该企业最新一次 status='success' 的投前竞品分析 run
 * 4. 若该 run 的数据尚未同步到投后（通过 pre_investment_run_id 判重），则复制
 * 5. 复制 sourcing_competitor_relation + sourcing_competitor_comparable_pref
 */
const cron = require('node-cron');
const db = require('../db');
const { generateId } = require('./idGenerator');
const { convertQuartzCronToNodeCron } = require('./cronQuartzToNode');

const CONFIG_KEY_CRON = 'competitor_migration_cron';
const CONFIG_KEY_ACTIVE = 'competitor_migration_active';
const CONFIG_KEY_LAST_SYNC = 'competitor_migration_last_sync';
const DEFAULT_CRON = '0 30 18 * * ? *'; // 每天 18:30（Quartz 7段格式，与前端 CronGenerator 一致）

let currentTask = null;

// ─── 配置读取 ───────────────────────────────────────────────

async function getMigrationConfig() {
  const rows = await db.query(
    `SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?, ?)`,
    [CONFIG_KEY_CRON, CONFIG_KEY_ACTIVE, CONFIG_KEY_LAST_SYNC]
  );
  const map = {};
  for (const r of rows) map[r.config_key] = r.config_value;
  return {
    cron: map[CONFIG_KEY_CRON] || DEFAULT_CRON,
    active: map[CONFIG_KEY_ACTIVE] !== '0',
    lastSync: map[CONFIG_KEY_LAST_SYNC] || null,
  };
}

async function upsertConfig(key, value, desc) {
  const existing = await db.query(
    'SELECT F_Id FROM system_config WHERE config_key = ?',
    [key]
  );
  if (existing.length > 0) {
    await db.execute(
      'UPDATE system_config SET config_value = ? WHERE config_key = ?',
      [value, key]
    );
  } else {
    const id = await generateId('system_config');
    await db.execute(
      'INSERT INTO system_config (F_Id, config_key, config_value, config_desc) VALUES (?, ?, ?, ?)',
      [id, key, value, desc]
    );
  }
}

// ─── 核心迁移逻辑 ───────────────────────────────────────────

/**
 * 执行一次投前→投后竞品迁移
 * @returns {{ matched: number, synced: number, skipped: number, errors: string[] }}
 */
async function runCompetitorMigration() {
  const stats = { matched: 0, synced: 0, skipped: 0, errors: [] };
  console.log('[竞品迁移] 开始执行投前→投后竞品数据迁移...');

  try {
    // 1. 查找匹配的投前项目 ↔ 被投企业
    const matches = await db.query(`
      SELECT
        pip.F_Id AS pip_id,
        pip.enterprise_full_name,
        pip.data_app_id,
        ie.F_Id AS ie_id
      FROM pre_investment_project pip
      INNER JOIN invested_enterprises ie
        ON ie.enterprise_full_name = pip.enterprise_full_name
        AND ie.data_app_id = pip.data_app_id
      WHERE ie.exit_status NOT IN ('已上市', '完全退出')
        AND ie.F_DeleteMark = 0
        AND pip.F_DeleteMark = 0
    `);

    stats.matched = matches.length;
    console.log(`[竞品迁移] 匹配到 ${matches.length} 对投前项目↔被投企业`);

    for (const m of matches) {
      try {
        await migrateOneEnterprise(m, stats);
      } catch (err) {
        const msg = `企业 ${m.enterprise_full_name} 迁移失败: ${err.message}`;
        console.error(`[竞品迁移] ${msg}`);
        stats.errors.push(msg);
      }
    }

    // 更新最后同步时间
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await upsertConfig(CONFIG_KEY_LAST_SYNC, now, '竞品迁移最后同步时间');

    console.log(
      `[竞品迁移] 完成：匹配 ${stats.matched}，同步 ${stats.synced}，跳过 ${stats.skipped}，失败 ${stats.errors.length}`
    );
  } catch (err) {
    console.error('[竞品迁移] 执行异常:', err);
    stats.errors.push(err.message);
  }

  return stats;
}

/**
 * 迁移单个企业的投前竞品数据到投后
 */
async function migrateOneEnterprise(match, stats) {
  const { pip_id, ie_id, enterprise_full_name } = match;

  // 2. 取最新 success 的投前 run
  const runs = await db.query(`
    SELECT F_Id FROM sourcing_pre_investment_competitor_run
    WHERE pre_investment_project_id = ? AND status = 'success' AND F_DeleteMark = 0
    ORDER BY F_CreatorTime DESC
    LIMIT 1
  `, [pip_id]);

  if (!runs.length) {
    stats.skipped++;
    return;
  }

  const preRunId = runs[0].F_Id;

  // 3. 幂等检查：该 pre_investment_run_id 是否已同步到此被投企业
  const existing = await db.query(`
    SELECT F_Id FROM sourcing_competitor_relation
    WHERE invested_enterprise_id = ? AND pre_investment_run_id = ? AND F_DeleteMark = 0
    LIMIT 1
  `, [ie_id, preRunId]);

  if (existing.length > 0) {
    stats.skipped++;
    return;
  }

  // 4. 读取投前 run 的全部 relation
  const relations = await db.query(`
    SELECT * FROM sourcing_competitor_relation
    WHERE run_id = ? AND subject_type = 'pre_investment_project' AND F_DeleteMark = 0
  `, [preRunId]);

  if (!relations.length) {
    stats.skipped++;
    return;
  }

  // 5. 创建投后 run 记录
  const newRunId = await generateId('sourcing_competitor_run');
  await db.execute(`
    INSERT INTO sourcing_competitor_run (
      F_Id, invested_enterprise_id, status, message, triggered_by_user_id,
      started_at, finished_at, F_CreatorTime, F_LastModifyTime, F_DeleteMark
    ) VALUES (?, ?, 'success', ?, NULL, NOW(), NOW(), NOW(), NOW(), 0)
  `, [newRunId, ie_id, `投前竞品数据自动同步（来源run: ${preRunId}）`]);

  // 6. 逐条复制 relation
  for (const rel of relations) {
    const newRelId = await generateId('sourcing_competitor_relation');
    await db.execute(`
      INSERT INTO sourcing_competitor_relation (
        F_Id, invested_enterprise_id, run_id, subject_type,
        pre_investment_project_id, pre_investment_run_id,
        subject_display_name, competitor_display_name, unified_credit_code,
        competitor_weak_key, relevance_score, data_sources_json,
        financing_amount_text, confidence_grade, score_breakdown_json,
        competitor_product_intro, competitor_tags_display, competitor_tags_json,
        sub_fund_names, is_listed, financing_history_text, include_in_comparable,
        competitor_type, dimension_scores, evidence_summary, evidence_confidence,
        needs_review, evidence_breakdown_json, human_locked,
        F_CreatorUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
      ) VALUES (
        ?, ?, ?, 'invested_enterprise',
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        NULL, NOW(), NOW(), 0
      )
    `, [
      newRelId, ie_id, newRunId,
      pip_id, preRunId,
      rel.subject_display_name || enterprise_full_name,
      rel.competitor_display_name, rel.unified_credit_code,
      rel.competitor_weak_key, rel.relevance_score,
      rel.data_sources_json ? JSON.stringify(rel.data_sources_json) : null,
      rel.financing_amount_text, rel.confidence_grade,
      rel.score_breakdown_json ? JSON.stringify(rel.score_breakdown_json) : null,
      rel.competitor_product_intro, rel.competitor_tags_display,
      rel.competitor_tags_json ? JSON.stringify(rel.competitor_tags_json) : null,
      rel.sub_fund_names, rel.is_listed || 0, rel.financing_history_text,
      rel.include_in_comparable || 0,
      rel.competitor_type,
      rel.dimension_scores ? JSON.stringify(rel.dimension_scores) : null,
      rel.evidence_summary, rel.evidence_confidence,
      rel.needs_review || 0,
      rel.evidence_breakdown_json ? JSON.stringify(rel.evidence_breakdown_json) : null,
      rel.human_locked || 0,
    ]);
  }

  // 7. 复制 comparable_pref
  const prefs = await db.query(`
    SELECT * FROM sourcing_competitor_comparable_pref
    WHERE subject_type = 'pre_investment_project' AND pre_investment_project_id = ?
  `, [pip_id]);

  for (const pref of prefs) {
    // 使用 INSERT IGNORE 避免唯一键冲突（同一竞品可能已存在投后偏好）
    const newPrefId = await generateId('sourcing_competitor_comparable_pref');
    await db.execute(`
      INSERT IGNORE INTO sourcing_competitor_comparable_pref (
        F_Id, subject_type, invested_enterprise_id, pre_investment_project_id,
        competitor_key, include_in_comparable, F_CreatorTime, F_LastModifyTime
      ) VALUES (?, 'invested_enterprise', ?, NULL, ?, ?, NOW(), NOW())
    `, [newPrefId, ie_id, pref.competitor_key, pref.include_in_comparable]);
  }

  stats.synced++;
  console.log(
    `[竞品迁移] ✓ ${enterprise_full_name}: 同步 ${relations.length} 条竞品关系 (run ${preRunId} → ${newRunId})`
  );
}

// ─── 定时调度 ───────────────────────────────────────────────

function stopCurrentTask() {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
}

/**
 * 初始化/重启竞品迁移定时任务
 * 读取 system_config 中的 cron 配置（Quartz 7段格式），转换为 node-cron 5段后注册
 */
async function initializeCompetitorMigrationTask() {
  stopCurrentTask();

  const config = await getMigrationConfig();
  if (!config.active) {
    console.log('[竞品迁移] 定时任务已禁用，跳过注册');
    return;
  }

  const storedCron = config.cron || DEFAULT_CRON;
  // 前端 CronGenerator 产出 Quartz 7段格式，需转换为 node-cron 5段
  const nodeCronExpr = convertQuartzCronToNodeCron(storedCron);
  if (!nodeCronExpr || !cron.validate(nodeCronExpr)) {
    console.error(`[竞品迁移] 无效的 cron 表达式: "${storedCron}" (转换后: "${nodeCronExpr}")，使用默认`);
    const fallback = convertQuartzCronToNodeCron(DEFAULT_CRON);
    currentTask = cron.schedule(fallback, async () => {
      console.log(`[竞品迁移] 定时触发 (默认 ${DEFAULT_CRON})`);
      try { await runCompetitorMigration(); } catch (err) { console.error('[竞品迁移] 定时执行异常:', err); }
    });
    console.log(`[竞品迁移] ✓ 定时任务已注册（默认），cron: ${DEFAULT_CRON} → ${fallback}`);
    return;
  }

  currentTask = cron.schedule(nodeCronExpr, async () => {
    console.log(`[竞品迁移] 定时触发 (${storedCron} → ${nodeCronExpr})`);
    try {
      await runCompetitorMigration();
    } catch (err) {
      console.error('[竞品迁移] 定时执行异常:', err);
    }
  });

  console.log(`[竞品迁移] ✓ 定时任务已注册，cron: ${storedCron} → ${nodeCronExpr}`);
}

/**
 * 更新配置并重启定时任务（供路由调用）
 * cronExpression 为 Quartz 7段格式（前端 CronGenerator 产出）
 */
async function updateMigrationCronConfig({ cronExpression, active }) {
  if (cronExpression !== undefined) {
    const nodeExpr = convertQuartzCronToNodeCron(cronExpression);
    if (!nodeExpr || !cron.validate(nodeExpr)) {
      throw new Error(`无效的 cron 表达式: "${cronExpression}"`);
    }
    await upsertConfig(CONFIG_KEY_CRON, cronExpression, '竞品迁移定时cron表达式(Quartz格式)');
  }
  if (active !== undefined) {
    await upsertConfig(CONFIG_KEY_ACTIVE, active ? '1' : '0', '竞品迁移定时任务开关');
  }
  // 重启任务
  await initializeCompetitorMigrationTask();
}

module.exports = {
  initializeCompetitorMigrationTask,
  runCompetitorMigration,
  getMigrationConfig,
  updateMigrationCronConfig,
  CONFIG_KEY_CRON,
  CONFIG_KEY_ACTIVE,
  CONFIG_KEY_LAST_SYNC,
};
