const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const xlsx = require('xlsx');
const crypto = require('crypto');
const db = require('../db');
const { logEnterpriseChange } = require('../utils/logger');
const { generateId } = require('../utils/idGenerator');
const { checkNewsPermission, checkProjectSourcingPermission } = require('../utils/permissionChecker');
const { checkCompetitorAnalysisPermission } = require('../utils/竞品分析/competitorAnalysisPermission');
const {
  DATA_APP_NEWS_SENTIMENT,
  DATA_APP_PROJECT_SOURCING,
  DATA_APP_COMPETITOR_ANALYSIS,
  normalizeDataAppName,
} = require('../utils/enterpriseDataApp');
const { getApplicationIdByAppName } = require('../utils/applicationIdResolve');
const { queryExternal, getExternalPool, createExternalPool } = require('../utils/externalDb');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const TEMPLATE_HEADERS = ['项目简称', '被投企业全称', '统一信用代码', '企业公众号id', '企业官网', '企业类型（被投企业/基金/子基金/子基金管理人/子基金GP）', '退出状态（未退出/部分退出/完全退出/继续观察/不再观察/已上市）'];

async function assertEnterpriseDataAppPermission(userId, userRole, dataAppName) {
  if (userRole === 'admin') return;
  if (!userId) {
    const err = new Error('FORBIDDEN');
    err.statusCode = 403;
    throw err;
  }
  if (dataAppName === DATA_APP_NEWS_SENTIMENT) {
    const ok = await checkNewsPermission(userId);
    if (!ok) {
      const err = new Error('FORBIDDEN');
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  if (dataAppName === DATA_APP_PROJECT_SOURCING) {
    const ok = await checkProjectSourcingPermission(userId);
    if (!ok) {
      const err = new Error('FORBIDDEN');
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  if (dataAppName === DATA_APP_COMPETITOR_ANALYSIS) {
    const ok = await checkCompetitorAnalysisPermission(userId);
    if (!ok) {
      const err = new Error('FORBIDDEN');
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  const err = new Error('BAD_APP');
  err.statusCode = 400;
  throw err;
}

function parseDataAppNameFromQuery(req) {
  return normalizeDataAppName(req.query.data_app_name);
}

/** 列表/导出：按 applications.id（invested_enterprises.data_app_id）筛选 */
async function resolveListDataAppId(dataAppName) {
  const id = await getApplicationIdByAppName(String(dataAppName || '').trim());
  return id ? String(id) : null;
}

/** 按库加载定时任务时的应用回退顺序（竞品分析从项目挖掘迁出后，历史 SQL 多在项目挖掘下） */
function syncTaskAppFallbackOrder(dataAppName) {
  const name = String(dataAppName || '');
  if (name === DATA_APP_COMPETITOR_ANALYSIS) {
    return [DATA_APP_COMPETITOR_ANALYSIS, DATA_APP_PROJECT_SOURCING];
  }
  return [name];
}

async function findEnterpriseSyncTaskByDb(dbConfigId, dataAppName, userId, isAdmin) {
  for (const app of syncTaskAppFallbackOrder(dataAppName)) {
    const tasks = await db.query(
      `SELECT id, db_config_id, data_app_name, sql_query, cron_expression, description, is_active,
              last_execution_time, last_execution_status, last_execution_message, execution_count,
              created_at, updated_at
       FROM enterprise_sync_task
       WHERE db_config_id = ? AND data_app_name = ? AND is_active = 1 AND delete_mark = 0
         ${isAdmin ? '' : 'AND created_by = ?'}
       ORDER BY created_at DESC
       LIMIT 1`,
      isAdmin ? [dbConfigId, app] : [dbConfigId, app, userId]
    );
    if (tasks.length > 0) {
      const task = tasks[0];
      if (app !== dataAppName) {
        task.loaded_from_app = app;
      }
      return task;
    }
  }
  return null;
}

/**
 * 合并微信公众号ID
 * 规则：
 * 1. 如果原来的是"abc",后来的是"abc,abcd",用多的覆盖少的,更新为"abc,abcd"
 * 2. 如果原来的是"abc",后来的是"abcd",合并为"abc,abcd"
 * 3. 去重处理，按逗号分割，合并后去重，再按逗号连接
 * @param {string|null|undefined} oldIds - 原有的微信公众号ID（可能为空）
 * @param {string|null|undefined} newIds - 新的微信公众号ID（可能为空）
 * @returns {string|null} - 合并后的微信公众号ID
 */
function mergeWechatOfficialAccountIds(oldIds, newIds) {
  // 处理空值
  const oldStr = (oldIds || '').trim();
  const newStr = (newIds || '').trim();
  
  // 如果两个都为空，返回null
  if (!oldStr && !newStr) {
    return null;
  }
  
  // 如果只有新的，返回新的
  if (!oldStr && newStr) {
    return newStr;
  }
  
  // 如果只有旧的，返回旧的
  if (oldStr && !newStr) {
    return oldStr;
  }
  
  // 两个都有，进行合并
  // 按逗号分割并去空
  const oldList = oldStr.split(',').map(id => id.trim()).filter(id => id);
  const newList = newStr.split(',').map(id => id.trim()).filter(id => id);
  
  // 合并去重
  const mergedSet = new Set([...oldList, ...newList]);
  const mergedArray = Array.from(mergedSet);
  
  // 如果合并后为空，返回null
  if (mergedArray.length === 0) {
    return null;
  }
  
  // 返回合并后的字符串
  return mergedArray.join(',');
}

/** 企业标签展示串（顿号/逗号分隔）→ JSON 数组，与竞品匹配解析一致 */
function industryTagsDisplayToJson(display) {
  const s = display != null ? String(display).trim() : '';
  if (!s) return null;
  const parts = s
    .split(/[,，、]/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? JSON.stringify(parts) : null;
}

function parseOptionalDecimal(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

const COST_ROW_FIELDS = ['investment_cost', 'exited_cost', 'remaining_cost', 'residual_value'];

const INVESTED_ENTERPRISE_AI_SNAPSHOT_APPS = new Set([
  DATA_APP_PROJECT_SOURCING,
  DATA_APP_COMPETITOR_ANALYSIS,
]);

function supportsInvestedEnterpriseAiSnapshot(dataAppName) {
  return INVESTED_ENTERPRISE_AI_SNAPSHOT_APPS.has(String(dataAppName || ''));
}

/** 列表/硬删/快照：以 data_app_id 为准，data_app_name 仅兜底 NULL id 的历史行 */
function investedEnterpriseAppMatchClause(alias, dataAppId, dataAppName) {
  const p = alias ? `${alias}.` : '';
  if (dataAppId) {
    return {
      sql: `(${p}data_app_id <=> ? OR (${p}data_app_id IS NULL AND ${p}data_app_name = ?))`,
      params: [dataAppId, dataAppName],
    };
  }
  return {
    sql: `${p}data_app_name = ?`,
    params: [dataAppName],
  };
}

/**
 * 同步前硬删除：指定用户 + 应用下 invested_enterprises 全量物理删除（含变更日志），再全量重写入。
 * 与「先清空再导入」一致，避免旧行残留、UPDATE 未覆盖字段导致空值。
 */
async function hardDeleteInvestedEnterprisesByUserAndApp(creatorUserId, dataAppName) {
  if (!creatorUserId) return 0;
  const dataAppId = await getApplicationIdByAppName(dataAppName);
  const { sql: appMatch, params: appParams } = investedEnterpriseAppMatchClause('', dataAppId, dataAppName);
  const rows = await db.query(
    `SELECT id FROM invested_enterprises WHERE creator_user_id = ? AND ${appMatch}`,
    [creatorUserId, ...appParams]
  );
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const chunkSize = 200;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const ph = chunk.map(() => '?').join(',');
    await db.execute(
      `DELETE FROM data_change_log WHERE table_name = 'invested_enterprises' AND record_id IN (${ph})`,
      chunk
    );
  }
  const del = await db.execute(
    `DELETE FROM invested_enterprises WHERE creator_user_id = ? AND ${appMatch}`,
    [creatorUserId, ...appParams]
  );
  return del.affectedRows || 0;
}

/** MySQL：与快照表 unified_credit_code 存值一致（trim、去空格、大写） */
function sqlNormInvestedEnterpriseUnifiedCredit(alias) {
  const p = alias ? `${alias}.` : '';
  return `UPPER(REPLACE(TRIM(IFNULL(${p}unified_credit_code,'')),' ',''))`;
}

/**
 * 硬删前写入 AI 快照（仅项目挖掘应用、且信用代码非空；同一信用多行取 id 最大一条）。
 * @returns {Promise<string|null>} batch_id 或 null
 */
async function insertInvestedEnterpriseAiSnapshotBeforeHardDelete(creatorUserId, dataAppName) {
  if (!creatorUserId || !supportsInvestedEnterpriseAiSnapshot(dataAppName)) {
    return null;
  }
  const dataAppId = await getApplicationIdByAppName(dataAppName);
  const { sql: appMatchBare, params: appParamsBare } = investedEnterpriseAppMatchClause('', dataAppId, dataAppName);
  const batchId = crypto.randomUUID();
  const normE = sqlNormInvestedEnterpriseUnifiedCredit('e');
  const normBare = sqlNormInvestedEnterpriseUnifiedCredit('');
  const enrichPickOrder = `(CASE WHEN NULLIF(TRIM(ai_product_intro),'') IS NOT NULL THEN 4 ELSE 0 END
    + CASE WHEN NULLIF(TRIM(qcc_company_intro),'') IS NOT NULL THEN 2 ELSE 0 END
    + CASE WHEN NULLIF(TRIM(ai_industry_tags_display),'') IS NOT NULL THEN 1 ELSE 0 END) DESC, id DESC`;
  const ins = await db.execute(
    `INSERT INTO invested_enterprise_ai_sync_snapshot
     (batch_id, creator_user_id, data_app_name, unified_credit_code,
      ai_product_intro, ai_industry_tags_display, ai_industry_tags_json,
      ai_enrich_status, ai_enrich_at, ai_enrich_model, ai_enrich_version,
      qcc_company_intro)
     SELECT ?, e.creator_user_id, ?, ${normE},
            e.ai_product_intro, e.ai_industry_tags_display, e.ai_industry_tags_json,
            e.ai_enrich_status, e.ai_enrich_at, e.ai_enrich_model, e.ai_enrich_version,
            e.qcc_company_intro
     FROM invested_enterprises e
     INNER JOIN (
       SELECT creator_user_id, ${normBare} AS ucc,
         CAST(SUBSTRING_INDEX(GROUP_CONCAT(id ORDER BY ${enrichPickOrder} SEPARATOR ','), ',', 1) AS UNSIGNED) AS mid
       FROM invested_enterprises
       WHERE creator_user_id = ? AND ${appMatchBare}
         AND delete_mark = 0
         AND unified_credit_code IS NOT NULL AND TRIM(unified_credit_code) != ''
       GROUP BY creator_user_id, ${normBare}
     ) t ON e.id = t.mid`,
    [batchId, dataAppName, creatorUserId, ...appParamsBare]
  );
  const n = ins.affectedRows != null ? ins.affectedRows : 0;
  console.log(
    `[企业同步任务] ${dataAppName} AI 快照已写入 batch_id=${batchId} rows=${n}（按统一社会信用代码，供硬删后回填）`
  );
  return batchId;
}

/**
 * 全量插入完成后，按统一社会信用代码将快照中的 AI 列写回新行。
 */
async function applyInvestedEnterpriseAiSnapshotAfterInsert(batchId, creatorUserId, dataAppName) {
  if (!batchId || !creatorUserId || !supportsInvestedEnterpriseAiSnapshot(dataAppName)) {
    return 0;
  }
  const normT = sqlNormInvestedEnterpriseUnifiedCredit('t');
  const res = await db.execute(
    `UPDATE invested_enterprises t
     INNER JOIN invested_enterprise_ai_sync_snapshot s
       ON s.batch_id = ?
       AND s.creator_user_id = t.creator_user_id
       AND s.data_app_name = t.data_app_name
       AND s.unified_credit_code = ${normT}
       AND t.delete_mark = 0
     SET t.ai_product_intro = s.ai_product_intro,
         t.ai_industry_tags_display = s.ai_industry_tags_display,
         t.ai_industry_tags_json = s.ai_industry_tags_json,
         t.ai_enrich_status = s.ai_enrich_status,
         t.ai_enrich_at = s.ai_enrich_at,
         t.ai_enrich_model = s.ai_enrich_model,
         t.ai_enrich_version = s.ai_enrich_version,
         t.ai_enrich_error = NULL,
         t.qcc_company_intro = s.qcc_company_intro,
         t.updated_at = CURRENT_TIMESTAMP
     WHERE t.creator_user_id = ? AND t.data_app_name = ?`,
    [batchId, creatorUserId, dataAppName]
  );
  const affected = res.affectedRows != null ? res.affectedRows : 0;
  console.log(`[企业同步任务] ${dataAppName} AI 快照回填完成 batch_id=${batchId} affected_rows=${affected}`);
  return affected;
}

/** 清理过久快照，避免表无限增长（保留最近 180 天） */
async function pruneOldInvestedEnterpriseAiSnapshots() {
  try {
    const r = await db.execute(
      `DELETE FROM invested_enterprise_ai_sync_snapshot WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY)`
    );
    const n = r.affectedRows != null ? r.affectedRows : 0;
    if (n > 0) {
      console.log(`[企业同步任务] 已清理 invested_enterprise_ai_sync_snapshot 过期行 ${n} 条（>180 天）`);
    }
  } catch (e) {
    console.warn('[企业同步任务] 清理 AI 快照表失败', e.message);
  }
  try {
    const { pruneOldCompetitorSyncSnapshots } = require('../utils/竞品分析/competitorSyncSnapshot');
    await pruneOldCompetitorSyncSnapshots();
  } catch (e) {
    console.warn('[企业同步任务] 清理竞品快照表失败', e.message);
  }
}

/** 将查询行转为可序列化对象，并把 DECIMAL 规范为 number（避免 RowDataPacket/字符串千分位等导致前端取不到或解析失败） */
function serializeEnterpriseRows(rows) {
  if (!rows || rows.length === 0) return rows;
  return rows.map((row) => {
    const plain = { ...row };
    for (const key of COST_ROW_FIELDS) {
      const v = plain[key];
      if (v == null || v === '') continue;
      const n = Number(String(v).replace(/,/g, '').trim());
      if (Number.isFinite(n)) plain[key] = n;
    }
    return plain;
  });
}

async function generateProjectNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const prefix = `P${year}${month}${day}`;

  const rows = await db.query(
    `SELECT project_number 
     FROM invested_enterprises 
     WHERE project_number LIKE ? 
     ORDER BY project_number DESC 
     LIMIT 1`,
    [`${prefix}%`]
  );

  let sequence = 1;
  if (rows.length) {
    const suffix = rows[0].project_number.slice(prefix.length);
    sequence = parseInt(suffix, 10) + 1;
  }
  return `${prefix}${String(sequence).padStart(5, '0')}`;
}

/**
 * 检查数据是否完全重复（用于批量导入去重）
 * @param {object} data - 要检查的数据
 * @returns {object|null} - 如果找到完全重复的数据，返回该记录，否则返回null
 */
async function checkDuplicateData({
  project_abbreviation,
  enterprise_full_name,
  unified_credit_code,
  wechat_official_account_id,
  official_website,
  exit_status,
  data_app_name = DATA_APP_NEWS_SENTIMENT,
}) {
  // 如果没有统一社会信用代码，无法进行去重校验
  if (!unified_credit_code || unified_credit_code.trim() === '') {
    return null;
  }

  // 查询是否存在相同的统一社会信用代码
  const existing = await db.query(
    `SELECT * FROM invested_enterprises 
     WHERE unified_credit_code = ? AND delete_mark = 0 AND data_app_name = ?`,
    [unified_credit_code, data_app_name]
  );

  if (existing.length === 0) {
    return null;
  }

  // 检查是否有完全相同的记录（所有字段都一致）
  for (const record of existing) {
    const isIdentical = 
      (record.project_abbreviation || '') === (project_abbreviation || '') &&
      record.enterprise_full_name === enterprise_full_name &&
      (record.wechat_official_account_id || '') === (wechat_official_account_id || '') &&
      (record.official_website || '') === (official_website || '') &&
      (record.exit_status || '未退出') === (exit_status || '未退出');

    if (isIdentical) {
      return record;
    }
  }

  return null; // 有统一社会信用代码但字段不一致，允许导入
}

async function insertEnterpriseRow({
  project_abbreviation,
  enterprise_full_name,
  unified_credit_code,
  wechat_official_account_id,
  official_website,
  entity_type = null,
  exit_status = '未退出',
  userId = null,
  data_app_name = DATA_APP_NEWS_SENTIMENT,
  investment_cost = null,
  exited_cost = null,
  remaining_cost = null,
  residual_value = null,
}) {
  const project_number = await generateProjectNumber();
  const enterpriseId = await generateId('invested_enterprises');
  const dataAppId = await getApplicationIdByAppName(data_app_name);

  // 插入到 invested_enterprises 表
  await db.execute(
    `INSERT INTO invested_enterprises 
     (id, project_number, project_abbreviation, enterprise_full_name, unified_credit_code, 
      wechat_official_account_id, official_website, entity_type, exit_status, data_app_name, data_app_id,
      investment_cost, exited_cost, remaining_cost, residual_value, creator_user_id) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      enterpriseId,
      project_number,
      project_abbreviation || '',
      enterprise_full_name,
      unified_credit_code || '',
      wechat_official_account_id || '',
      official_website || '',
      entity_type || null,
      exit_status || '未退出',
      data_app_name,
      dataAppId || null,
      investment_cost,
      exited_cost,
      remaining_cost,
      residual_value,
      userId
    ]
  );

  // 同步到 company 表（根据统一社会信用代码判断是否存在并更新）
  if (project_abbreviation && enterprise_full_name) {
    try {
      let existingCompany = null;
      
      // 如果有统一社会信用代码，检查是否已存在
      if (unified_credit_code && unified_credit_code.trim() !== '') {
        const companies = await db.query(
          'SELECT * FROM company WHERE unified_credit_code = ?',
          [unified_credit_code]
        );
        if (companies.length > 0) {
          existingCompany = companies[0];
        }
      }

      if (existingCompany) {
        // 如果已存在，检查是否需要更新
        let needUpdate = false;
        let finalWechatId = existingCompany.wechat_official_account_id;
        let finalWebsite = existingCompany.official_website;

        // 合并微信公众号ID（使用合并函数）
        const mergedWechatId = mergeWechatOfficialAccountIds(
          existingCompany.wechat_official_account_id,
          wechat_official_account_id
        );
        
        // 如果合并后的结果与原有不同，需要更新
        if (mergedWechatId !== (existingCompany.wechat_official_account_id || null)) {
          finalWechatId = mergedWechatId;
          needUpdate = true;
        }

        // 检查公司官网是否有变化
        // 如果新的官网不为空且与原有的不同，则更新
        if (official_website && official_website.trim() !== '') {
          if (official_website !== (existingCompany.official_website || '')) {
            finalWebsite = official_website;
            needUpdate = true;
          }
        }

        // 检查其他字段是否有变化
        if (project_abbreviation !== existingCompany.enterprise_abbreviation ||
            enterprise_full_name !== existingCompany.enterprise_full_name) {
          needUpdate = true;
        }

        // 如果需要更新，则更新 company 表
        if (needUpdate) {
          await db.execute(
            `UPDATE company 
             SET enterprise_abbreviation = ?, 
                 enterprise_full_name = ?,
                 official_website = ?,
                 wechat_official_account_id = ?,
                 updater_user_id = ?
             WHERE id = ?`,
            [
              project_abbreviation,
              enterprise_full_name,
              finalWebsite,
              finalWechatId,
              userId,
              existingCompany.id
            ]
          );
        }
      } else {
        // 如果不存在（统一社会信用代码为空或不存在于表中），则插入到 company 表
        const companyId = await generateId('company');
        await db.execute(
          `INSERT INTO company 
           (id, enterprise_abbreviation, enterprise_full_name, unified_credit_code, 
            official_website, wechat_official_account_id, creator_user_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            companyId,
            project_abbreviation,
            enterprise_full_name,
            unified_credit_code || null,
            official_website || null,
            wechat_official_account_id || null,
            userId
          ]
        );
      }
    } catch (err) {
      // 如果同步失败，不影响主流程，只记录错误
      console.warn('同步到 company 表失败:', err.message);
    }
  }

  return {
    id: enterpriseId,
    project_number
  };
}

router.get('/', async (req, res) => {
  try {
    // 获取当前用户信息
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';

    const dataAppName = parseDataAppNameFromQuery(req);
    if (!dataAppName) {
      return res.status(400).json({ success: false, message: '无效的 data_app_name 参数' });
    }

    try {
      await assertEnterpriseDataAppPermission(userId, userRole, dataAppName);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 403) {
        return res.status(403).json({
          success: false,
          message: '您没有访问该应用下被投企业数据的权限',
        });
      }
      if (code === 400) {
        return res.status(400).json({ success: false, message: '无效的 data_app_name 参数' });
      }
      throw e;
    }

    const dataAppId = await resolveListDataAppId(dataAppName);
    if (!dataAppId) {
      return res.status(400).json({
        success: false,
        message: 'applications 中未配置该应用，无法按应用加载被投企业列表',
      });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const pageSize = parseInt(req.query.pageSize, 10) || 10;
    const search = req.query.search || '';
    const filterUserId = req.query.filter_user_id || ''; // 用户筛选（仅admin使用）
    const entityType = req.query.entity_type || ''; // 企业类型筛选
    const hasCompetitorAnalysis =
      req.query.has_competitor_analysis === '1' ||
      req.query.has_competitor_analysis === 'true' ||
      req.query.has_competitor_analysis === true;
    const offset = (page - 1) * pageSize;

    let condition = 'FROM invested_enterprises WHERE delete_mark = 0 AND data_app_id <=> ?';
    const params = [dataAppId];

    // 如果不是admin，只显示当前用户创建的数据
    if (userRole !== 'admin') {
      if (userId) {
        condition += ' AND creator_user_id = ?';
        params.push(userId);
      } else {
        // 如果没有用户ID，返回空数据
        return res.json({
          success: true,
          data: [],
          total: 0,
          page,
          pageSize
        });
      }
    } else {
      // admin用户：如果指定了筛选用户ID，则只显示该用户的数据
      if (filterUserId && filterUserId.trim() !== '') {
        condition += ' AND creator_user_id = ?';
        params.push(filterUserId);
      }
    }

    // 企业类型筛选
    if (entityType) {
      if (entityType === 'manager') {
        // 子基金管理人及GP：包含子基金管理人或子基金GP
        condition += ' AND (entity_type = ? OR entity_type = ?)';
        params.push('子基金管理人', '子基金GP');
      } else if (dataAppName === DATA_APP_PROJECT_SOURCING && entityType === '被投企业') {
        // 项目挖掘被投企业页固定筛「被投企业」；同步 SQL 常不写 entity_type（为 NULL），须与列表一致
        condition +=
          ' AND (TRIM(COALESCE(entity_type, \'\')) = ? OR TRIM(COALESCE(entity_type, \'\')) = \'\')';
        params.push(entityType);
      } else {
        // 其他类型：直接匹配
        condition += ' AND entity_type = ?';
        params.push(entityType);
      }
    }

    if (search) {
      const searchTerm = `%${search}%`;
      if (dataAppName === DATA_APP_PROJECT_SOURCING) {
        condition += ` AND (
        project_number LIKE ? OR 
        project_abbreviation LIKE ? OR 
        enterprise_full_name LIKE ? OR 
        unified_credit_code LIKE ? OR 
        wechat_official_account_id LIKE ? OR 
        official_website LIKE ? OR 
        exit_status LIKE ? OR
        COALESCE(ai_product_intro,'') LIKE ? OR
        COALESCE(ai_industry_tags_display,'') LIKE ? OR
        COALESCE(qcc_company_intro,'') LIKE ?
      )`;
        params.push(
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm
        );
      } else {
        condition += ` AND (
        project_number LIKE ? OR 
        project_abbreviation LIKE ? OR 
        enterprise_full_name LIKE ? OR 
        unified_credit_code LIKE ? OR 
        wechat_official_account_id LIKE ? OR 
        official_website LIKE ? OR 
        exit_status LIKE ?
      )`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      }
    }

    if (dataAppName === DATA_APP_COMPETITOR_ANALYSIS && hasCompetitorAnalysis) {
      condition += ` AND (
        EXISTS (
          SELECT 1 FROM sourcing_competitor_run scr
          WHERE scr.invested_enterprise_id = invested_enterprises.id AND scr.delete_mark = 0
        )
        OR EXISTS (
          SELECT 1 FROM sourcing_competitor_relation rel
          WHERE rel.invested_enterprise_id = invested_enterprises.id AND rel.delete_mark = 0
            AND (rel.subject_type = 'invested_enterprise' OR rel.subject_type IS NULL)
        )
      )`;
    }

    const rawRows = await db.query(
      `SELECT * ${condition} ORDER BY project_number DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );
    const data = serializeEnterpriseRows(rawRows);
    const totalRows = await db.query(`SELECT COUNT(*) as total ${condition}`, params);

    res.json({
      success: true,
      data,
      total: totalRows[0].total,
      page,
      pageSize
    });
  } catch (error) {
    console.error('查询被投企业失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 导出被投企业数据为Excel
router.get('/export', async (req, res) => {
  try {
    // 获取当前用户信息
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';

    const dataAppName = parseDataAppNameFromQuery(req);
    if (!dataAppName) {
      return res.status(400).json({ success: false, message: '无效的 data_app_name 参数' });
    }

    try {
      await assertEnterpriseDataAppPermission(userId, userRole, dataAppName);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 403) {
        return res.status(403).json({
          success: false,
          message: '您没有访问该应用下被投企业数据的权限',
        });
      }
      if (code === 400) {
        return res.status(400).json({ success: false, message: '无效的 data_app_name 参数' });
      }
      throw e;
    }

    const dataAppId = await resolveListDataAppId(dataAppName);
    if (!dataAppId) {
      return res.status(400).json({
        success: false,
        message: 'applications 中未配置该应用，无法按应用导出被投企业',
      });
    }

    const search = req.query.search || '';
    const filterUserId = req.query.filter_user_id || ''; // 用户筛选（仅admin使用）

    let condition = 'FROM invested_enterprises WHERE delete_mark = 0 AND data_app_id <=> ?';
    const params = [dataAppId];

    // 如果不是admin，只显示当前用户创建的数据
    if (userRole !== 'admin') {
      if (userId) {
        condition += ' AND creator_user_id = ?';
        params.push(userId);
      } else {
        // 如果没有用户ID，返回空数据
        return res.status(400).json({
          success: false,
          message: '无法导出：未登录或没有权限'
        });
      }
    } else {
      // admin用户：如果指定了筛选用户ID，则只显示该用户的数据
      if (filterUserId && filterUserId.trim() !== '') {
        condition += ' AND creator_user_id = ?';
        params.push(filterUserId);
      }
    }

    if (search) {
      const searchTerm = `%${search}%`;
      if (dataAppName === DATA_APP_PROJECT_SOURCING) {
        condition += ` AND (
        project_number LIKE ? OR 
        project_abbreviation LIKE ? OR 
        enterprise_full_name LIKE ? OR 
        unified_credit_code LIKE ? OR 
        wechat_official_account_id LIKE ? OR 
        official_website LIKE ? OR 
        exit_status LIKE ? OR
        COALESCE(ai_product_intro,'') LIKE ? OR
        COALESCE(ai_industry_tags_display,'') LIKE ? OR
        COALESCE(qcc_company_intro,'') LIKE ?
      )`;
        params.push(
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm,
          searchTerm
        );
      } else {
        condition += ` AND (
        project_number LIKE ? OR 
        project_abbreviation LIKE ? OR 
        enterprise_full_name LIKE ? OR 
        unified_credit_code LIKE ? OR 
        wechat_official_account_id LIKE ? OR 
        official_website LIKE ? OR 
        exit_status LIKE ?
      )`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
      }
    }

    // 查询所有符合条件的数据（不分页）
    const rawExportRows = await db.query(
      `SELECT * ${condition} ORDER BY project_number DESC, id DESC`,
      params
    );
    const data = serializeEnterpriseRows(rawExportRows);

    if (data.length === 0) {
      return res.status(400).json({
        success: false,
        message: '没有可导出的数据'
      });
    }

    const isProjectSourcing = dataAppName === DATA_APP_PROJECT_SOURCING;

    function formatExportMoney(v) {
      if (v == null || v === '') return '';
      const n = Number(v);
      return Number.isFinite(n) ? n : '';
    }

    // 格式化数据为Excel格式（项目挖掘与新闻舆情列集合与列表策略一致）
    const excelData = data.map((item, index) => {
      const seq = index + 1;
      if (isProjectSourcing) {
        return {
          序号: seq,
          项目编号: item.project_number || '',
          企业类型: item.entity_type || '',
          项目简称: item.project_abbreviation || '',
          关联基金: item.fund || '',
          被投企业全称: item.enterprise_full_name || '',
          投资成本: formatExportMoney(item.investment_cost),
          已退出成本: formatExportMoney(item.exited_cost),
          剩余成本: formatExportMoney(item.remaining_cost),
          剩余价值: formatExportMoney(item.residual_value),
          退出状态: item.exit_status || '未退出',
          '产品简介(AI)': item.ai_product_intro || '',
          '企业标签(AI)': item.ai_industry_tags_display || '',
          AI状态: item.ai_enrich_status || '',
          '企业介绍（企查查）': item.qcc_company_intro || '',
          创建时间: item.created_at ? new Date(item.created_at) : null,
          更新时间: item.updated_at ? new Date(item.updated_at) : null,
        };
      }
      return {
        序号: seq,
        项目编号: item.project_number || '',
        项目简称: item.project_abbreviation || '',
        被投企业全称: item.enterprise_full_name || '',
        统一信用代码: item.unified_credit_code || '',
        企业公众号id: item.wechat_official_account_id || '',
        企业官网: item.official_website || '',
        退出状态: item.exit_status || '未退出',
        创建时间: item.created_at ? new Date(item.created_at) : null,
        更新时间: item.updated_at ? new Date(item.updated_at) : null,
      };
    });

    const headerOrder = Object.keys(excelData[0] || {});
    const defaultWch = {
      序号: 8,
      项目编号: 18,
      企业类型: 14,
      项目简称: 15,
      关联基金: 22,
      被投企业全称: 30,
      投资成本: 14,
      已退出成本: 14,
      剩余成本: 14,
      剩余价值: 14,
      '产品简介(AI)': 36,
      '企业标签(AI)': 28,
      AI状态: 12,
      '企业介绍（企查查）': 36,
      统一信用代码: 20,
      企业公众号id: 25,
      企业官网: 40,
      退出状态: 12,
      创建时间: 20,
      更新时间: 20,
    };

    // 创建工作簿
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(excelData);

    ws['!cols'] = headerOrder.map((h) => ({ wch: defaultWch[h] || 14 }));

    // 设置单元格格式
    const range = xlsx.utils.decode_range(ws['!ref']);

    // 设置表头样式
    for (let colNum = 0; colNum <= range.e.c; colNum++) {
      const headerCell = xlsx.utils.encode_cell({ r: 0, c: colNum });
      if (ws[headerCell]) {
        ws[headerCell].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "4472C4" } },
          alignment: { horizontal: "center", vertical: "center" },
          border: {
            top: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } }
          }
        };
      }
    }

    // 遍历所有数据行，设置格式
    for (let rowNum = 1; rowNum <= range.e.r; rowNum++) {
      // 为所有数据单元格添加边框
      for (let colNum = 0; colNum <= range.e.c; colNum++) {
        const cellRef = xlsx.utils.encode_cell({ r: rowNum, c: colNum });
        if (ws[cellRef]) {
          if (!ws[cellRef].s) ws[cellRef].s = {};
          ws[cellRef].s.border = {
            top: { style: "thin", color: { rgb: "CCCCCC" } },
            bottom: { style: "thin", color: { rgb: "CCCCCC" } },
            left: { style: "thin", color: { rgb: "CCCCCC" } },
            right: { style: "thin", color: { rgb: "CCCCCC" } }
          };

          // 设置文本对齐
          ws[cellRef].s.alignment = {
            horizontal: "left",
            vertical: "top",
            wrapText: true
          };
        }
      }

      const cCreated = headerOrder.indexOf('创建时间');
      if (cCreated >= 0) {
        const createTimeCell = xlsx.utils.encode_cell({ r: rowNum, c: cCreated });
        if (ws[createTimeCell] && ws[createTimeCell].v) {
          ws[createTimeCell].t = 'd';
          ws[createTimeCell].z = 'yyyy-mm-dd hh:mm:ss';
          ws[createTimeCell].s.alignment = { horizontal: 'center', vertical: 'center' };
        }
      }

      const cUpdated = headerOrder.indexOf('更新时间');
      if (cUpdated >= 0) {
        const updateTimeCell = xlsx.utils.encode_cell({ r: rowNum, c: cUpdated });
        if (ws[updateTimeCell] && ws[updateTimeCell].v) {
          ws[updateTimeCell].t = 'd';
          ws[updateTimeCell].z = 'yyyy-mm-dd hh:mm:ss';
          ws[updateTimeCell].s.alignment = { horizontal: 'center', vertical: 'center' };
        }
      }

      const cWebsite = headerOrder.indexOf('企业官网');
      if (cWebsite >= 0) {
        const websiteCell = xlsx.utils.encode_cell({ r: rowNum, c: cWebsite });
        if (ws[websiteCell] && ws[websiteCell].v && typeof ws[websiteCell].v === 'string' && ws[websiteCell].v.startsWith('http')) {
          ws[websiteCell].l = { Target: ws[websiteCell].v, Tooltip: '点击打开链接' };
          if (!ws[websiteCell].s) ws[websiteCell].s = {};
          ws[websiteCell].s.font = { color: { rgb: '0000FF' }, underline: true };
          ws[websiteCell].s.alignment = { horizontal: 'left', vertical: 'center' };
        }
      }
    }

    // 设置冻结窗格（冻结表头）
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };

    // 设置自动筛选
    ws['!autofilter'] = { ref: ws['!ref'] };

    xlsx.utils.book_append_sheet(wb, ws, '被投企业');

    // 生成Excel文件
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 生成文件名（包含日期）
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const fileName = `被投企业数据_${dateStr}.xlsx`;

    // 设置响应头
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);

    res.send(buffer);

  } catch (error) {
    console.error('导出被投企业数据失败：', error);
    res.status(500).json({ success: false, message: '导出失败：' + error.message });
  }
});

// 批量导入相关路由（必须在 /:id 路由之前）
router.get('/batch-import/template', (req, res) => {
  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([TEMPLATE_HEADERS]);
    xlsx.utils.book_append_sheet(workbook, worksheet, '模板');
    const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });

    // 使用 URL 编码处理中文文件名
    const filename = encodeURIComponent('被投企业批量导入模板.xlsx');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('生成模板失败：', error);
    res.status(500).json({ success: false, message: '模板生成失败' });
  }
});

router.post('/', [
  body('project_abbreviation').optional(),
  body('enterprise_full_name').notEmpty().withMessage('企业全称不能为空'),
  body('unified_credit_code').optional(),
  body('wechat_official_account_id').optional(),
  body('official_website').optional(),
  body('entity_type').optional(),
  body('exit_status').optional(),
  body('data_app_name').optional(),
  body('investment_cost').optional(),
  body('exited_cost').optional(),
  body('remaining_cost').optional(),
  body('residual_value').optional(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const {
      project_abbreviation,
      enterprise_full_name,
      unified_credit_code,
      wechat_official_account_id,
      official_website,
      entity_type,
      exit_status = '未退出',
      investment_cost,
      exited_cost,
      remaining_cost,
      residual_value,
    } = req.body;

    // 从请求头或请求体中获取用户ID
    const userId = req.headers['x-user-id'] || req.body.userId || null;
    const userRole = req.headers['x-user-role'] || 'user';
    const dataAppName = normalizeDataAppName(req.body.data_app_name);
    if (!dataAppName) {
      return res.status(400).json({ success: false, message: '无效的 data_app_name' });
    }

    try {
      await assertEnterpriseDataAppPermission(userId, userRole, dataAppName);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 403) {
        return res.status(403).json({
          success: false,
          message: '您没有在该应用下创建被投企业数据的权限',
        });
      }
      if (code === 400) {
        return res.status(400).json({ success: false, message: '无效的 data_app_name' });
      }
      throw e;
    }

    const result = await insertEnterpriseRow({
      project_abbreviation,
      enterprise_full_name,
      unified_credit_code,
      wechat_official_account_id,
      official_website,
      entity_type: entity_type || null,
      exit_status,
      userId: userId,
      data_app_name: dataAppName,
      investment_cost: parseOptionalDecimal(investment_cost),
      exited_cost: parseOptionalDecimal(exited_cost),
      remaining_cost: parseOptionalDecimal(remaining_cost),
      residual_value: parseOptionalDecimal(residual_value),
    });

    res.json({
      success: true,
      message: '创建成功',
      data: {
        id: result.id,
        project_number: result.project_number,
        project_abbreviation,
        enterprise_full_name,
        unified_credit_code,
        wechat_official_account_id,
        official_website,
        exit_status
      }
    });
  } catch (error) {
    console.error('创建被投企业失败：', error);
    console.error('错误详情：', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({ 
      success: false, 
      message: '创建失败：' + (error.message || '未知错误'),
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.put('/:id', [
  body('project_abbreviation').optional(),
  body('enterprise_full_name').notEmpty().withMessage('企业全称不能为空'),
  body('unified_credit_code').optional(),
  body('wechat_official_account_id').optional(),
  body('official_website').optional(),
  body('entity_type').optional(),
  body('exit_status').optional(),
  body('investment_cost').optional(),
  body('exited_cost').optional(),
  body('remaining_cost').optional(),
  body('residual_value').optional(),
  body('ai_product_intro').optional(),
  body('ai_industry_tags_display').optional(),
  body('qcc_company_intro').optional(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const {
      project_abbreviation,
      enterprise_full_name,
      unified_credit_code,
      wechat_official_account_id,
      official_website,
      entity_type,
      exit_status,
      investment_cost,
      exited_cost,
      remaining_cost,
      residual_value,
    } = req.body;

    // 从请求头或请求体中获取用户ID
    const userId = req.headers['x-user-id'] || req.body.userId || null;

    // 获取旧数据用于日志记录
    const oldDataRows = await db.query(
      'SELECT * FROM invested_enterprises WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (oldDataRows.length === 0) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    const oldData = oldDataRows[0];
    const userRole = req.headers['x-user-role'] || 'user';
    const rowApp = normalizeDataAppName(oldData.data_app_name) || DATA_APP_NEWS_SENTIMENT;
    try {
      await assertEnterpriseDataAppPermission(userId, userRole, rowApp);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 403) {
        return res.status(403).json({ success: false, message: '您没有修改该企业数据的权限' });
      }
      if (code === 400) {
        return res.status(400).json({ success: false, message: '无效的应用标识' });
      }
      throw e;
    }
    if (userRole !== 'admin' && oldData.creator_user_id && oldData.creator_user_id !== userId) {
      return res.status(403).json({ success: false, message: '无权修改该企业数据' });
    }

    const newData = {
      project_abbreviation: project_abbreviation || '',
      enterprise_full_name,
      unified_credit_code: unified_credit_code || '',
      wechat_official_account_id: wechat_official_account_id || '',
      official_website: official_website || '',
      entity_type: entity_type || null,
      exit_status: exit_status || '未退出',
    };
    const costKeys = ['investment_cost', 'exited_cost', 'remaining_cost', 'residual_value'];
    for (const k of costKeys) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        newData[k] = parseOptionalDecimal(req.body[k]);
      } else {
        newData[k] = oldData[k];
      }
    }

    const enrichKeys = ['ai_product_intro', 'ai_industry_tags_display', 'qcc_company_intro'];
    let enrichSql = '';
    const enrichParams = [];
    for (const k of enrichKeys) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        const v = req.body[k] != null ? String(req.body[k]).trim() : '';
        newData[k] = v || null;
        enrichSql += `, ${k} = ?`;
        enrichParams.push(newData[k]);
        if (k === 'ai_industry_tags_display') {
          newData.ai_industry_tags_json = industryTagsDisplayToJson(v);
          enrichSql += ', ai_industry_tags_json = ?';
          enrichParams.push(newData.ai_industry_tags_json);
        }
      } else {
        newData[k] = oldData[k];
        if (k === 'ai_industry_tags_display') {
          newData.ai_industry_tags_json = oldData.ai_industry_tags_json;
        }
      }
    }

    const result = await db.execute(
      `UPDATE invested_enterprises 
       SET project_abbreviation = ?, enterprise_full_name = ?, unified_credit_code = ?,
           wechat_official_account_id = ?, official_website = ?, entity_type = ?, exit_status = ?,
           investment_cost = ?, exited_cost = ?, remaining_cost = ?, residual_value = ?
           ${enrichSql},
           modifier_user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND delete_mark = 0`,
      [
        newData.project_abbreviation,
        newData.enterprise_full_name,
        newData.unified_credit_code,
        newData.wechat_official_account_id,
        newData.official_website,
        newData.entity_type,
        newData.exit_status,
        newData.investment_cost,
        newData.exited_cost,
        newData.remaining_cost,
        newData.residual_value,
        ...enrichParams,
        userId,
        id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    // 记录变更日志
    await logEnterpriseChange(id, oldData, newData, userId);

    // 同步更新到 company 表
    if (newData.unified_credit_code && newData.unified_credit_code.trim() !== '' && 
        newData.project_abbreviation && newData.enterprise_full_name) {
      try {
        const existingCompany = await db.query(
          'SELECT * FROM company WHERE unified_credit_code = ?',
          [newData.unified_credit_code]
        );
        
        if (existingCompany.length > 0) {
          // 如果已存在，合并微信公众号ID并更新
          const company = existingCompany[0];
          const mergedWechatId = mergeWechatOfficialAccountIds(
            company.wechat_official_account_id,
            newData.wechat_official_account_id
          );
          
          let needUpdate = false;
          let finalWebsite = company.official_website;
          
          // 检查微信公众号ID是否有变化
          if (mergedWechatId !== (company.wechat_official_account_id || null)) {
            needUpdate = true;
          }
          
          // 检查公司官网是否有变化
          if (newData.official_website && newData.official_website.trim() !== '') {
            if (newData.official_website !== (company.official_website || '')) {
              finalWebsite = newData.official_website;
              needUpdate = true;
            }
          }
          
          // 检查其他字段是否有变化
          if (newData.project_abbreviation !== company.enterprise_abbreviation ||
              newData.enterprise_full_name !== company.enterprise_full_name) {
            needUpdate = true;
          }
          
          if (needUpdate) {
            await db.execute(
              `UPDATE company 
               SET enterprise_abbreviation = ?, 
                   enterprise_full_name = ?,
                   official_website = ?,
                   wechat_official_account_id = ?,
                   updater_user_id = ?
               WHERE id = ?`,
              [
                newData.project_abbreviation,
                newData.enterprise_full_name,
                finalWebsite,
                mergedWechatId,
                userId,
                company.id
              ]
            );
          }
        } else {
          // 如果不存在，创建新记录
          const companyId = await generateId('company');
          await db.execute(
            `INSERT INTO company 
             (id, enterprise_abbreviation, enterprise_full_name, unified_credit_code, 
              official_website, wechat_official_account_id, creator_user_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              companyId,
              newData.project_abbreviation,
              newData.enterprise_full_name,
              newData.unified_credit_code,
              newData.official_website || null,
              newData.wechat_official_account_id || null,
              userId
            ]
          );
        }
      } catch (err) {
        // 如果同步失败，不影响主流程，只记录错误
        console.warn('同步到 company 表失败:', err.message);
      }
    }

    res.json({ success: true, message: '更新成功' });
  } catch (error) {
    console.error('更新被投企业失败：', error);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

// 删除被投企业（软删除）
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // 从请求头或请求体中获取用户ID
    const userId = req.headers['x-user-id'] || req.body.userId || null;
    const userRole = req.headers['x-user-role'] || 'user';

    const rows = await db.query(
      'SELECT * FROM invested_enterprises WHERE id = ? AND delete_mark = 0',
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '企业不存在或已被删除' });
    }
    const row = rows[0];
    const rowApp = normalizeDataAppName(row.data_app_name) || DATA_APP_NEWS_SENTIMENT;
    try {
      await assertEnterpriseDataAppPermission(userId, userRole, rowApp);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 403) {
        return res.status(403).json({ success: false, message: '您没有删除该企业数据的权限' });
      }
      if (code === 400) {
        return res.status(400).json({ success: false, message: '无效的应用标识' });
      }
      throw e;
    }
    if (userRole !== 'admin' && row.creator_user_id && row.creator_user_id !== userId) {
      return res.status(403).json({ success: false, message: '无权删除该企业数据' });
    }

    const result = await db.execute(
      `UPDATE invested_enterprises 
       SET delete_mark = 1, delete_time = NOW(), delete_user_id = ?
       WHERE id = ? AND delete_mark = 0`,
      [userId, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: '企业不存在或已被删除' });
    }

    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('删除被投企业失败：', error);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

router.post('/batch-import/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传文件' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return res.status(400).json({ success: false, message: '未检测到数据工作表' });
    }

    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (!rows.length) {
      return res.status(400).json({ success: false, message: '模板内容为空' });
    }

    const headers = rows[0].map((cell) => String(cell || '').trim());
    const isHeaderValid = TEMPLATE_HEADERS.every((header, index) => header === headers[index]);
    if (!isHeaderValid) {
      return res.status(400).json({ success: false, message: '模板表头不匹配，请使用最新模板' });
    }

    const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
    if (!dataRows.length) {
      return res.status(400).json({ success: false, message: '未检测到可导入的数据' });
    }

    const batchUserId = req.headers['x-user-id'] || req.body?.userId || null;
    const batchUserRole = req.headers['x-user-role'] || 'user';
    const dataAppName = normalizeDataAppName(req.query.data_app_name || req.body?.data_app_name);
    if (!dataAppName) {
      return res.status(400).json({ success: false, message: '缺少或无效的 data_app_name 参数' });
    }
    try {
      await assertEnterpriseDataAppPermission(batchUserId, batchUserRole, dataAppName);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 403) {
        return res.status(403).json({ success: false, message: '您没有在该应用下批量导入被投企业的权限' });
      }
      if (code === 400) {
        return res.status(400).json({ success: false, message: '无效的应用标识' });
      }
      throw e;
    }

    const errors = [];
    let successCount = 0;

    for (let index = 0; index < dataRows.length; index += 1) {
      const rowNumber = index + 2;
      const [
        project_abbreviation = '',
        enterprise_full_name = '',
        unified_credit_code = '',
        wechat_official_account_id = '',
        official_website = '',
        entity_type = '',
        exit_status = '未退出'
      ] = dataRows[index].map((cell) => String(cell || '').trim());

      if (!enterprise_full_name) {
        errors.push({ row: rowNumber, message: '被投企业全称不能为空' });
        continue;
      }

      try {
        // 从请求头或请求体中获取用户ID
        const userId = batchUserId;
        
        // 检查是否完全重复（以统一社会信用代码为准）
        const duplicateRecord = await checkDuplicateData({
          project_abbreviation,
          enterprise_full_name,
          unified_credit_code,
          wechat_official_account_id,
          official_website,
          exit_status,
          data_app_name: dataAppName,
        });

        if (duplicateRecord) {
          // 如果完全重复，不导入并提示用户
          errors.push({ 
            row: rowNumber, 
            message: `已存在相同的数据（项目编号：${duplicateRecord.project_number}），跳过导入` 
          });
          continue;
        }

        // 如果不存在完全重复的数据，则导入
        await insertEnterpriseRow({
          project_abbreviation,
          enterprise_full_name,
          unified_credit_code,
          wechat_official_account_id,
          official_website,
          entity_type: entity_type || null,
          exit_status,
          userId: userId,
          data_app_name: dataAppName,
        });
        successCount += 1;
      } catch (err) {
        errors.push({ row: rowNumber, message: err.message });
      }
    }

    res.json({
      success: errors.length === 0,
      message: `成功导入 ${successCount} 条，失败 ${errors.length} 条`,
      successCount,
      errorCount: errors.length,
      errors
    });
  } catch (error) {
    console.error('批量导入失败：', error);
    res.status(500).json({ success: false, message: '导入失败，请重试' });
  }
});

// 获取被投企业变更日志
router.get('/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await db.query(
      `SELECT l.*, u.account as change_user_account 
       FROM data_change_log l
       LEFT JOIN users u ON l.change_user_id = u.id
       WHERE l.table_name = 'invested_enterprises' AND l.record_id = ?
       ORDER BY l.change_time DESC`,
      [id]
    );

    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取被投企业日志失败：', error);
    res.status(500).json({ success: false, message: '获取日志失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'] || null;
    const userRole = req.headers['x-user-role'] || 'user';
    const rows = await db.query(
      'SELECT * FROM invested_enterprises WHERE id = ? AND delete_mark = 0',
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: '企业不存在' });
    }

    const row = serializeEnterpriseRows(rows)[0];

    const rowApp = normalizeDataAppName(row.data_app_name) || DATA_APP_NEWS_SENTIMENT;
    try {
      await assertEnterpriseDataAppPermission(userId, userRole, rowApp);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 403) {
        return res.status(403).json({ success: false, message: '您没有查看该企业数据的权限' });
      }
      if (code === 400) {
        return res.status(400).json({ success: false, message: '无效的应用标识' });
      }
      throw e;
    }
    if (userRole !== 'admin' && row.creator_user_id && row.creator_user_id !== userId) {
      return res.status(403).json({ success: false, message: '无权查看该企业数据' });
    }

    res.json({ success: true, data: row });
  } catch (error) {
    console.error('获取被投企业失败：', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// 执行SQL查询并同步数据到被投企业表
// syncOwnerUserId：任务所属用户；传入时先硬删除该用户+本应用下 invested_enterprises，再全量重写入（与新闻侧「清空再导入」一致）
async function executeSyncTask(
  dbConfigId,
  sqlQuery,
  targetDataAppName = DATA_APP_NEWS_SENTIMENT,
  syncOwnerUserId = null
) {
  const { getExternalPool, createExternalPool, closeExternalPool } = require('../utils/externalDb');
  let retryCount = 0;
  const maxRetries = 3;
  let externalData = null;
  
  while (retryCount < maxRetries) {
    try {
      // 获取或创建外部数据库连接
      let pool = getExternalPool(dbConfigId);
      if (!pool) {
        // 如果连接池不存在，从数据库获取配置并创建
        const configs = await db.query(
          'SELECT * FROM external_db_config WHERE id = ? AND delete_mark = 0 AND is_active = 1',
          [dbConfigId]
        );
        if (configs.length === 0) {
          throw new Error('数据库配置不存在或未启用');
        }
        pool = await createExternalPool(configs[0]);
        // 注意：createExternalPool 会自动将连接池保存到缓存中
      }

      // 执行SQL查询（带重试机制）
      try {
        if (pool.constructor.name === 'Pool' && pool.query && typeof pool.query === 'function' && !pool.getConnection) {
          // PostgreSQL
          const result = await pool.query(sqlQuery);
          externalData = result.rows;
        } else {
          // MySQL
          const [rows] = await pool.query(sqlQuery);
          externalData = rows;
        }
        
        // 查询成功，跳出重试循环
        break;
      } catch (queryError) {
        // 如果是连接错误，尝试重新创建连接池
        const isConnectionError = 
          queryError.code === 'ECONNRESET' || 
          queryError.code === 'PROTOCOL_CONNECTION_LOST' || 
          queryError.code === 'ETIMEDOUT' ||
          queryError.code === 'ECONNREFUSED' ||
          (queryError.message && (
            queryError.message.includes('ECONNRESET') ||
            queryError.message.includes('Connection lost') ||
            queryError.message.includes('timeout')
          ));
        
        if (isConnectionError && retryCount < maxRetries - 1) {
          console.warn(`[企业同步任务] 数据库连接错误 (${queryError.code || 'UNKNOWN'})，尝试重新连接... (重试 ${retryCount + 1}/${maxRetries})`);
          
          // 关闭旧的连接池
          try {
            await closeExternalPool(dbConfigId);
          } catch (closeError) {
            console.warn('[企业同步任务] 关闭旧连接池失败:', closeError.message);
          }
          
          // 等待一段时间后重试（递增延迟）
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
          
          retryCount++;
          continue; // 重试
        } else {
          // 其他错误或达到最大重试次数，直接抛出
          if (retryCount >= maxRetries - 1) {
            throw new Error(`数据库连接失败，已重试 ${maxRetries} 次。最后错误: ${queryError.message || queryError.code || '未知错误'}`);
          }
          throw queryError;
        }
      }
    } catch (error) {
      // 如果达到最大重试次数，抛出错误
      if (retryCount >= maxRetries - 1) {
        throw error;
      }
      retryCount++;
      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      continue;
    }
  }
  
  // 检查查询结果：无数据时若需全量替换，仍执行硬删除（清空该用户本应用监控对象）
  if (!externalData || externalData.length === 0) {
    let deleted = 0;
    let aiSnapshotBatchIdEmpty = null;
    let competitorSnapshotBatchIdEmpty = null;
    if (syncOwnerUserId) {
      try {
        aiSnapshotBatchIdEmpty = await insertInvestedEnterpriseAiSnapshotBeforeHardDelete(
          syncOwnerUserId,
          targetDataAppName
        );
      } catch (e) {
        console.error('[企业同步任务] 写入 AI 快照失败（中止清空）', e);
        throw e;
      }
      try {
        const {
          supportsCompetitorSyncSnapshot,
          backupCompetitorDataBeforeHardDelete,
        } = require('../utils/竞品分析/competitorSyncSnapshot');
        if (supportsCompetitorSyncSnapshot(targetDataAppName)) {
          competitorSnapshotBatchIdEmpty = await backupCompetitorDataBeforeHardDelete(
            syncOwnerUserId,
            targetDataAppName
          );
        }
      } catch (e) {
        console.error('[企业同步任务] 写入竞品快照失败（中止清空）', e);
        throw e;
      }
      deleted = await hardDeleteInvestedEnterprisesByUserAndApp(syncOwnerUserId, targetDataAppName);
      console.log(`[企业同步任务] 外部无数据，已硬删除本用户本应用下 ${deleted} 条`);
      await pruneOldInvestedEnterpriseAiSnapshots();
    }
    return {
      success: true,
      message:
        deleted > 0
          ? `查询成功，外部无返回行；已清空本应用下共 ${deleted} 条本地数据${
              aiSnapshotBatchIdEmpty ? `（AI 快照 batch_id=${aiSnapshotBatchIdEmpty}，可按统一社会信用代码从表 invested_enterprise_ai_sync_snapshot 恢复）` : ''
            }${
              competitorSnapshotBatchIdEmpty
                ? `；竞品快照 batch_id=${competitorSnapshotBatchIdEmpty}（待下次同步写入被投后自动恢复竞品关系）`
                : ''
            }`
          : '查询成功，但没有数据需要同步',
      synced: 0,
      updated: 0,
      inserted: 0,
      deleted,
      ai_snapshot_batch_id: aiSnapshotBatchIdEmpty || undefined,
      competitor_snapshot_batch_id: competitorSnapshotBatchIdEmpty || undefined,
    };
  }

  let deletedBeforeSync = 0;
  let aiSnapshotBatchId = null;
  let competitorSnapshotBatchId = null;
  if (syncOwnerUserId) {
    try {
      aiSnapshotBatchId = await insertInvestedEnterpriseAiSnapshotBeforeHardDelete(
        syncOwnerUserId,
        targetDataAppName
      );
    } catch (e) {
      console.error('[企业同步任务] 写入 AI 快照失败（中止硬删）', e);
      throw e;
    }
    try {
      const {
        supportsCompetitorSyncSnapshot,
        backupCompetitorDataBeforeHardDelete,
      } = require('../utils/竞品分析/competitorSyncSnapshot');
      if (supportsCompetitorSyncSnapshot(targetDataAppName)) {
        competitorSnapshotBatchId = await backupCompetitorDataBeforeHardDelete(
          syncOwnerUserId,
          targetDataAppName
        );
      }
    } catch (e) {
      console.error('[企业同步任务] 写入竞品快照失败（中止硬删）', e);
      throw e;
    }
    deletedBeforeSync = await hardDeleteInvestedEnterprisesByUserAndApp(syncOwnerUserId, targetDataAppName);
    console.log(
      `[企业同步任务] 硬删除本用户本应用旧数据 ${deletedBeforeSync} 条（creator_user_id=${syncOwnerUserId}, data_app_name=${targetDataAppName}）`
    );
  }

  // 获取invested_enterprises表的所有字段（排除系统字段）
  const systemFields = ['id', 'project_number', 'created_at', 'updated_at', 'delete_mark', 'delete_time', 'delete_user_id', 'creator_user_id', 'modifier_user_id', 'data_app_name', 'data_app_id'];
  const tableColumns = await db.query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'invested_enterprises'
    AND COLUMN_NAME NOT IN (${systemFields.map(() => '?').join(',')})
    ORDER BY ORDINAL_POSITION
  `, systemFields);
  
  const availableFields = tableColumns.map(col => col.COLUMN_NAME);
  console.log(`[企业同步任务] 可同步的字段列表: ${availableFields.join(', ')}`);

  /**
   * 将驼峰命名转换为下划线命名
   */
  function camelToSnake(str) {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase();
  }

  /**
   * 将下划线命名转换为驼峰命名
   */
  function snakeToCamel(str) {
    return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
  }

  /**
   * 从查询结果中获取字段值（支持下划线和驼峰命名）
   */
  function getFieldValue(row, fieldName) {
    // 直接匹配
    if (row[fieldName] !== undefined) {
      return row[fieldName];
    }
    // 尝试驼峰命名
    const camelName = snakeToCamel(fieldName);
    if (row[camelName] !== undefined) {
      return row[camelName];
    }
    // 尝试下划线命名（如果字段名是驼峰）
    const snakeName = camelToSnake(fieldName);
    if (snakeName !== fieldName && row[snakeName] !== undefined) {
      return row[snakeName];
    }
    return undefined;
  }

  // 同步数据到被投企业表
  let synced = 0;
  let updated = 0;
  let inserted = 0;
  const targetDataAppId = await getApplicationIdByAppName(targetDataAppName);

  for (const row of externalData) {
    // 动态映射所有字段（支持不同的字段名格式）
    const enterpriseData = {};
    
    // 为每个可用字段尝试匹配
    for (const fieldName of availableFields) {
      const value = getFieldValue(row, fieldName);
      if (value !== undefined) {
        enterpriseData[fieldName] = value;
      }
    }

    // 特殊处理：支持旧字段名的兼容性（向后兼容）
    if (enterpriseData.enterprise_full_name === undefined) {
      enterpriseData.enterprise_full_name = row.enterprise_full_name || row.enterpriseFullName || row.enterprise_name || row.enterpriseName || '';
    }
    if (enterpriseData.project_abbreviation === undefined) {
      enterpriseData.project_abbreviation = row.project_abbreviation || row.projectAbbreviation || row.project_abbr || '';
    }
    if (enterpriseData.unified_credit_code === undefined) {
      enterpriseData.unified_credit_code = row.unified_credit_code || row.unifiedCreditCode || row.credit_code || '';
    }
    if (enterpriseData.wechat_official_account_id === undefined) {
      enterpriseData.wechat_official_account_id = row.wechat_official_account_id || row.wechatOfficialAccountId || row.wechat_account_id || '';
    }
    if (enterpriseData.official_website === undefined) {
      enterpriseData.official_website = row.official_website || row.officialWebsite || row.website || '';
    }
    if (enterpriseData.exit_status === undefined) {
      enterpriseData.exit_status = row.exit_status || row.exitStatus || '未退出';
    }
    if (
      (targetDataAppName === DATA_APP_PROJECT_SOURCING ||
        targetDataAppName === DATA_APP_COMPETITOR_ANALYSIS) &&
      (enterpriseData.entity_type === undefined ||
        enterpriseData.entity_type === null ||
        String(enterpriseData.entity_type).trim() === '')
    ) {
      enterpriseData.entity_type = '被投企业';
    }

    for (const k of COST_ROW_FIELDS) {
      if (enterpriseData[k] !== undefined) {
        enterpriseData[k] = parseOptionalDecimal(enterpriseData[k]);
      }
    }

    // 必填字段检查
    if (!enterpriseData.enterprise_full_name) {
      console.warn('跳过数据：缺少被投企业全称', row);
      continue;
    }

    // 根据统一社会信用代码判断是否已存在
    let existing = null;
    if (enterpriseData.unified_credit_code && enterpriseData.unified_credit_code.trim() !== '') {
      // 如果有统一信用代码，根据统一信用代码查找（同应用、同创建人，避免误更新他人数据）
      const { sql: appMatch, params: appParams } = investedEnterpriseAppMatchClause(
        '',
        targetDataAppId,
        targetDataAppName
      );
      const matchParams = [enterpriseData.unified_credit_code, ...appParams];
      let matchSql = `SELECT id, project_number, exit_status FROM invested_enterprises 
         WHERE unified_credit_code = ? 
         AND delete_mark = 0
         AND ${appMatch}`;
      if (syncOwnerUserId) {
        matchSql += ' AND creator_user_id = ?';
        matchParams.push(syncOwnerUserId);
      }
      matchSql += ' LIMIT 1';
      const existingRecords = await db.query(matchSql, matchParams);
      if (existingRecords.length > 0) {
        existing = existingRecords[0];
      }
    }

    if (existing) {
      // 如果现有记录的退出状态为"不再观察"，则跳过更新，保护用户手动设置的状态
      if (existing.exit_status === '不再观察') {
        console.log(`跳过更新企业（退出状态为"不再观察"）：统一信用代码 ${enterpriseData.unified_credit_code}，企业全称 ${enterpriseData.enterprise_full_name}`);
        continue; // 跳过这条数据，不进行更新
      }
      
      // 统一信用代码一致，动态更新所有匹配的字段
      const updateFields = [];
      const updateValues = [];
      
      // 构建动态UPDATE语句，包含所有匹配的字段
      for (const fieldName of availableFields) {
        if (enterpriseData[fieldName] !== undefined) {
          updateFields.push(`${fieldName} = ?`);
          // 处理空值：空字符串转为null
          const value = enterpriseData[fieldName];
          updateValues.push(value === '' ? null : value);
        }
      }
      
      if (updateFields.length > 0) {
        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        updateValues.push(existing.id);
        let whereSql = 'WHERE id = ?';
        if (syncOwnerUserId) {
          whereSql += ' AND creator_user_id = ?';
          updateValues.push(syncOwnerUserId);
        }
        await db.execute(
          `UPDATE invested_enterprises 
           SET ${updateFields.join(', ')}
           ${whereSql}`,
          updateValues
        );
        updated++;
        console.log(`更新企业：统一信用代码 ${enterpriseData.unified_credit_code}，更新字段: ${updateFields.slice(0, -1).map(f => f.split('=')[0].trim()).join(', ')}`);
      } else {
        console.warn(`跳过更新：没有匹配的字段，统一信用代码 ${enterpriseData.unified_credit_code}`);
      }
      
      // 同步更新到 company 表
      if (enterpriseData.unified_credit_code && enterpriseData.unified_credit_code.trim() !== '') {
        try {
          const existingCompany = await db.query(
            'SELECT * FROM company WHERE unified_credit_code = ?',
            [enterpriseData.unified_credit_code]
          );
          
          if (existingCompany.length > 0) {
            // 如果已存在，合并微信公众号ID并更新
            const company = existingCompany[0];
            const mergedWechatId = mergeWechatOfficialAccountIds(
              company.wechat_official_account_id,
              enterpriseData.wechat_official_account_id
            );
            
            let needUpdate = false;
            let finalWebsite = company.official_website;
            
            // 检查微信公众号ID是否有变化
            if (mergedWechatId !== (company.wechat_official_account_id || null)) {
              needUpdate = true;
            }
            
            // 检查公司官网是否有变化
            if (enterpriseData.official_website && enterpriseData.official_website.trim() !== '') {
              if (enterpriseData.official_website !== (company.official_website || '')) {
                finalWebsite = enterpriseData.official_website;
                needUpdate = true;
              }
            }
            
            // 检查其他字段是否有变化
            if (enterpriseData.project_abbreviation !== company.enterprise_abbreviation ||
                enterpriseData.enterprise_full_name !== company.enterprise_full_name) {
              needUpdate = true;
            }
            
            if (needUpdate) {
              await db.execute(
                `UPDATE company 
                 SET enterprise_abbreviation = ?, 
                     enterprise_full_name = ?,
                     official_website = ?,
                     wechat_official_account_id = ?
                 WHERE id = ?`,
                [
                  enterpriseData.project_abbreviation,
                  enterpriseData.enterprise_full_name,
                  finalWebsite,
                  mergedWechatId,
                  company.id
                ]
              );
            }
          } else {
            // 如果不存在，创建新记录
            const companyId = await generateId('company');
            await db.execute(
              `INSERT INTO company 
               (id, enterprise_abbreviation, enterprise_full_name, unified_credit_code, 
                official_website, wechat_official_account_id) 
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                companyId,
                enterpriseData.project_abbreviation,
                enterpriseData.enterprise_full_name,
                enterpriseData.unified_credit_code,
                enterpriseData.official_website || null,
                enterpriseData.wechat_official_account_id || null
              ]
            );
          }
        } catch (err) {
          // 如果同步失败，不影响主流程，只记录错误
          console.warn('同步到 company 表失败:', err.message);
        }
      }
    } else {
      // 统一信用代码不一致或不存在，新增数据
      enterpriseData.data_app_name = targetDataAppName;
      // 自动生成项目编号
      const projectNumber = await generateProjectNumber();
      const enterpriseId = await generateId('invested_enterprises');
      
      // 动态构建INSERT语句，包含所有匹配的字段
      const insertFields = ['id', 'project_number'];
      const insertValues = [enterpriseId, projectNumber];
      
      // 添加所有匹配的字段
      for (const fieldName of availableFields) {
        if (enterpriseData[fieldName] !== undefined) {
          insertFields.push(fieldName);
          // 处理空值：空字符串转为null
          const value = enterpriseData[fieldName];
          insertValues.push(value === '' ? null : value);
        }
      }
      if (!insertFields.includes('data_app_name')) {
        insertFields.push('data_app_name');
        insertValues.push(targetDataAppName);
      }
      if (!insertFields.includes('data_app_id')) {
        insertFields.push('data_app_id');
        insertValues.push(targetDataAppId || null);
      }
      if (syncOwnerUserId && !insertFields.includes('creator_user_id')) {
        insertFields.push('creator_user_id');
        insertValues.push(syncOwnerUserId);
      }

      if (insertFields.length > 2) {
        const placeholders = insertFields.map(() => '?').join(', ');
        await db.execute(
          `INSERT INTO invested_enterprises 
           (${insertFields.join(', ')}) 
           VALUES (${placeholders})`,
          insertValues
        );
        inserted++;
        console.log(`新增企业：${enterpriseData.enterprise_full_name}，统一信用代码：${enterpriseData.unified_credit_code || '无'}，项目编号：${projectNumber}，插入字段: ${insertFields.slice(2).join(', ')}`);
      } else {
        console.warn(`跳过插入：没有匹配的字段，企业全称：${enterpriseData.enterprise_full_name}`);
      }
      
      // 同步创建到 company 表
      if (enterpriseData.project_abbreviation && enterpriseData.enterprise_full_name) {
        try {
          let existingCompany = null;
          
          // 如果有统一社会信用代码，检查是否已存在
          if (enterpriseData.unified_credit_code && enterpriseData.unified_credit_code.trim() !== '') {
            const companies = await db.query(
              'SELECT * FROM company WHERE unified_credit_code = ?',
              [enterpriseData.unified_credit_code]
            );
            if (companies.length > 0) {
              existingCompany = companies[0];
            }
          }
          
          if (existingCompany) {
            // 如果已存在，合并微信公众号ID并更新
            const mergedWechatId = mergeWechatOfficialAccountIds(
              existingCompany.wechat_official_account_id,
              enterpriseData.wechat_official_account_id
            );
            
            let needUpdate = false;
            let finalWebsite = existingCompany.official_website;
            
            // 检查微信公众号ID是否有变化
            if (mergedWechatId !== (existingCompany.wechat_official_account_id || null)) {
              needUpdate = true;
            }
            
            // 检查公司官网是否有变化
            if (enterpriseData.official_website && enterpriseData.official_website.trim() !== '') {
              if (enterpriseData.official_website !== (existingCompany.official_website || '')) {
                finalWebsite = enterpriseData.official_website;
                needUpdate = true;
              }
            }
            
            // 检查其他字段是否有变化
            if (enterpriseData.project_abbreviation !== existingCompany.enterprise_abbreviation ||
                enterpriseData.enterprise_full_name !== existingCompany.enterprise_full_name) {
              needUpdate = true;
            }
            
            if (needUpdate) {
              await db.execute(
                `UPDATE company 
                 SET enterprise_abbreviation = ?, 
                     enterprise_full_name = ?,
                     official_website = ?,
                     wechat_official_account_id = ?
                 WHERE id = ?`,
                [
                  enterpriseData.project_abbreviation,
                  enterpriseData.enterprise_full_name,
                  finalWebsite,
                  mergedWechatId,
                  existingCompany.id
                ]
              );
            }
          } else {
            // 如果不存在，创建新记录
            const companyId = await generateId('company');
            await db.execute(
              `INSERT INTO company 
               (id, enterprise_abbreviation, enterprise_full_name, unified_credit_code, 
                official_website, wechat_official_account_id) 
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                companyId,
                enterpriseData.project_abbreviation,
                enterpriseData.enterprise_full_name,
                enterpriseData.unified_credit_code || null,
                enterpriseData.official_website || null,
                enterpriseData.wechat_official_account_id || null
              ]
            );
          }
        } catch (err) {
          // 如果同步失败，不影响主流程，只记录错误
          console.warn('同步到 company 表失败:', err.message);
        }
      }
    }
    synced++;
  }

  let aiSnapshotRestored = 0;
  if (aiSnapshotBatchId && syncOwnerUserId) {
    try {
      aiSnapshotRestored = await applyInvestedEnterpriseAiSnapshotAfterInsert(
        aiSnapshotBatchId,
        syncOwnerUserId,
        targetDataAppName
      );
    } catch (e) {
      console.error(
        '[企业同步任务] AI 快照回填失败（业务数据已写入；可按 batch_id 查表 invested_enterprise_ai_sync_snapshot 手工恢复）',
        e
      );
    }
  }

  let competitorSnapshotRestored = null;
  let competitorRelinkStats = null;
  if (competitorSnapshotBatchId && syncOwnerUserId) {
    try {
      const {
        restoreCompetitorDataAfterInsert,
        relinkOrphanCompetitorDataBySubjectMatch,
      } = require('../utils/竞品分析/competitorSyncSnapshot');
      try {
        competitorRelinkStats = await relinkOrphanCompetitorDataBySubjectMatch({
          creatorUserId: syncOwnerUserId,
          batchId: competitorSnapshotBatchId,
        });
      } catch (relinkErr) {
        console.warn('[企业同步任务] 竞品孤儿 id 重挂失败（将尝试快照恢复）', relinkErr.message);
      }
      competitorSnapshotRestored = await restoreCompetitorDataAfterInsert(
        competitorSnapshotBatchId,
        syncOwnerUserId,
        targetDataAppName
      );
    } catch (e) {
      console.error(
        '[企业同步任务] 竞品快照恢复失败（可按 batch_id 查表 competitor_analysis_sync_snapshot 手工恢复）',
        e
      );
    }
  }
  await pruneOldInvestedEnterpriseAiSnapshots();

  if (targetDataAppName === DATA_APP_COMPETITOR_ANALYSIS) {
    try {
      const { dedupeCompetitorInvestedEnterprises } = require('../utils/竞品分析/investedEnterpriseDedupe');
      const dedupedAfterSync = await dedupeCompetitorInvestedEnterprises();
      if (dedupedAfterSync > 0) {
        console.log(`[企业同步任务] 竞品分析去重：已删除重复行 ${dedupedAfterSync} 条`);
      }
    } catch (dedupeErr) {
      console.warn('[企业同步任务] 竞品分析去重失败（不影响同步结果）', dedupeErr.message);
    }
  }

  const snapshotNote =
    aiSnapshotBatchId != null
      ? `；AI 快照 batch_id=${aiSnapshotBatchId}，已回填 ${aiSnapshotRestored} 行`
      : '';
  const competitorNote =
    competitorSnapshotBatchId != null && competitorRelinkStats?.relinked
      ? `；竞品已按企业全称/信用代码重挂 ${competitorRelinkStats.relinked} 家（batch_id=${competitorSnapshotBatchId}）`
      : competitorSnapshotBatchId != null && competitorSnapshotRestored
        ? `；竞品快照 batch_id=${competitorSnapshotBatchId}，已恢复 ${competitorSnapshotRestored.subjects || 0} 家主体、${competitorSnapshotRestored.relations || 0} 条竞品关系`
        : competitorSnapshotBatchId != null
          ? `；竞品快照 batch_id=${competitorSnapshotBatchId}（无匹配新被投或未恢复）`
          : '';

  return {
    success: true,
    message:
      deletedBeforeSync > 0
        ? `同步完成：已硬删除旧数据 ${deletedBeforeSync} 条；共处理 ${synced} 条，新增 ${inserted} 条，更新 ${updated} 条${snapshotNote}${competitorNote}`
        : `同步完成：共处理 ${synced} 条数据，新增 ${inserted} 条，更新 ${updated} 条${snapshotNote}${competitorNote}`,
    synced,
    updated,
    inserted,
    deleted: deletedBeforeSync,
    ai_snapshot_batch_id: aiSnapshotBatchId || undefined,
    ai_snapshot_restored: aiSnapshotRestored,
    competitor_snapshot_batch_id: competitorSnapshotBatchId || undefined,
    competitor_snapshot_restored: competitorSnapshotRestored || undefined,
  };
}

// 根据数据库配置ID获取当前用户的定时任务（管理员可查任意，普通用户仅本人）；按 data_app_name 分应用存储
router.get('/sync-task/by-db/:db_config_id', async (req, res) => {
  try {
    const { db_config_id } = req.params;
    const userRole = req.headers['x-user-role'] || 'user';
    const userId = req.headers['x-user-id'] || null;
    const isAdmin = userRole === 'admin';
    const dataAppName = normalizeDataAppName(req.query.data_app_name);
    if (!dataAppName) {
      return res.status(400).json({ success: false, message: '缺少或无效的 data_app_name 参数' });
    }
    try {
      await assertEnterpriseDataAppPermission(userId, userRole, dataAppName);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 403) {
        return res.status(403).json({ success: false, message: '您没有访问该应用下同步配置的权限' });
      }
      if (code === 400) {
        return res.status(400).json({ success: false, message: '无效的应用标识' });
      }
      throw e;
    }

    const task = await findEnterpriseSyncTaskByDb(db_config_id, dataAppName, userId, isAdmin);

    if (task) {
      res.json({ success: true, data: task });
    } else {
      res.json({ success: true, data: null });
    }
  } catch (error) {
    console.error('获取定时任务失败：', error);
    res.status(500).json({ success: false, message: '获取任务失败：' + error.message });
  }
});

// 创建定时同步任务（同一数据库配置下，按应用 data_app_name 各存一条 SQL）
router.post('/sync-task', [
  body('db_config_id').notEmpty().withMessage('数据库配置ID不能为空'),
  body('sql_query').notEmpty().withMessage('SQL查询语句不能为空'),
  body('cron_expression').notEmpty().withMessage('Cron表达式不能为空'),
  body('description').optional(),
  body('data_app_name').optional(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { db_config_id, sql_query, cron_expression, description } = req.body;
    const dataAppName = normalizeDataAppName(req.body.data_app_name);
    if (!dataAppName) {
      return res.status(400).json({ success: false, message: '无效的 data_app_name' });
    }

    // 验证SQL语句（支持WITH语句和SELECT语句）
    const sql = sql_query.trim().toUpperCase();
    if (!sql.startsWith('SELECT') && !sql.startsWith('WITH')) {
      return res.status(400).json({ success: false, message: 'SQL语句必须以SELECT或WITH开头' });
    }

    const userRole = req.headers['x-user-role'] || 'user';
    const userId = req.headers['x-user-id'] || null;
    const isAdmin = userRole === 'admin';

    try {
      await assertEnterpriseDataAppPermission(userId, userRole, dataAppName);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 403) {
        return res.status(403).json({ success: false, message: '您没有在该应用下配置同步任务的权限' });
      }
      if (code === 400) {
        return res.status(400).json({ success: false, message: '无效的应用标识' });
      }
      throw e;
    }

    // 检查数据库配置是否存在且当前用户有权限（本人创建的或管理员）
    const dbConfigs = await db.query(
      'SELECT * FROM external_db_config WHERE id = ? AND delete_mark = 0 AND is_active = 1',
      [db_config_id]
    );
    if (dbConfigs.length === 0) {
      return res.status(400).json({ success: false, message: '数据库配置不存在或未启用' });
    }
    if (!isAdmin && dbConfigs[0].created_by !== userId) {
      return res.status(403).json({ success: false, message: '只能选择自己创建的数据库配置' });
    }

    // 同一用户、同一库、同一应用一条任务
    const existing = await db.query(
      'SELECT id FROM enterprise_sync_task WHERE db_config_id = ? AND created_by = ? AND data_app_name = ? AND delete_mark = 0',
      [db_config_id, userId, dataAppName]
    );

    const taskId = existing.length > 0 ? existing[0].id : await generateId('enterprise_sync_task');

    if (existing.length > 0) {
      // 更新现有任务
      await db.execute(
        `UPDATE enterprise_sync_task 
         SET sql_query = ?, cron_expression = ?, description = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [sql_query, cron_expression, description || '', userId, taskId]
      );
    } else {
      // 创建新任务
      await db.execute(
        `INSERT INTO enterprise_sync_task 
         (id, db_config_id, data_app_name, sql_query, cron_expression, description, created_by, updated_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [taskId, db_config_id, dataAppName, sql_query, cron_expression, description || '', userId, userId]
      );
    }

    try {
      const { reloadTasks } = require('../utils/enterpriseSyncTasks');
      await reloadTasks();
    } catch (reloadErr) {
      console.warn('重新加载企业同步定时任务失败:', reloadErr.message);
    }

    res.json({ 
      success: true, 
      message: existing.length > 0 ? '任务更新成功' : '任务创建成功',
      data: { id: taskId }
    });
  } catch (error) {
    console.error('创建/更新同步任务失败：', error);
    res.status(500).json({ success: false, message: '操作失败：' + error.message });
  }
});

// 手动执行同步任务
router.post('/sync-task/execute', [
  body('db_config_id').notEmpty().withMessage('数据库配置ID不能为空'),
  body('sql_query').optional(), // SQL查询语句改为可选，如果未提供则从数据库读取
  body('data_app_name').optional(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { db_config_id, sql_query } = req.body;
    const dataAppName = normalizeDataAppName(req.body.data_app_name);
    if (!dataAppName) {
      return res.status(400).json({ success: false, message: '无效的 data_app_name' });
    }
    const userRole = req.headers['x-user-role'] || 'user';
    const userId = req.headers['x-user-id'] || null;
    const isAdmin = userRole === 'admin';

    try {
      await assertEnterpriseDataAppPermission(userId, userRole, dataAppName);
    } catch (e) {
      const code = e.statusCode || 500;
      if (code === 403) {
        return res.status(403).json({ success: false, message: '您没有在该应用下执行同步的权限' });
      }
      if (code === 400) {
        return res.status(400).json({ success: false, message: '无效的应用标识' });
      }
      throw e;
    }

    // 校验是否有权使用该数据库配置
    const dbConfigs = await db.query(
      'SELECT id, created_by FROM external_db_config WHERE id = ? AND delete_mark = 0 AND is_active = 1',
      [db_config_id]
    );
    if (dbConfigs.length === 0) {
      return res.status(400).json({ success: false, message: '数据库配置不存在或未启用' });
    }
    if (!isAdmin && dbConfigs[0].created_by !== userId) {
      return res.status(403).json({ success: false, message: '只能执行自己创建的数据库配置下的任务' });
    }

    // 如果未提供SQL查询语句，从当前用户已保存的任务中读取（按应用）
    let finalSqlQuery = sql_query;
    if (!finalSqlQuery || finalSqlQuery.trim() === '') {
      const saved = await findEnterpriseSyncTaskByDb(db_config_id, dataAppName, userId, isAdmin);
      if (!saved) {
        return res.status(400).json({
          success: false,
          message: '该数据库配置下没有已保存的定时任务（当前应用），请先保存任务或提供SQL查询语句'
        });
      }
      finalSqlQuery = saved.sql_query;
      if (!finalSqlQuery || finalSqlQuery.trim() === '') {
        return res.status(400).json({ 
          success: false, 
          message: '已保存的任务中SQL查询语句为空，请提供SQL查询语句' 
        });
      }
    }

    // 验证SQL语句（支持WITH语句和SELECT语句）
    const sql = finalSqlQuery.trim().toUpperCase();
    if (!sql.startsWith('SELECT') && !sql.startsWith('WITH')) {
      return res.status(400).json({ success: false, message: 'SQL语句必须以SELECT或WITH开头' });
    }

    // 执行同步任务（写入对应应用的 invested_enterprises；按任务用户硬删除后全量重写）
    const result = await executeSyncTask(db_config_id, finalSqlQuery, dataAppName, userId);

    // 更新当前用户该库、该应用下任务的执行记录（如果存在）
    try {
      const tasks = await db.query(
        `SELECT id FROM enterprise_sync_task WHERE db_config_id = ? AND created_by = ? AND data_app_name = ? AND delete_mark = 0`,
        [db_config_id, userId, dataAppName]
      );
      if (tasks.length > 0) {
        await db.execute(
          `UPDATE enterprise_sync_task 
           SET last_execution_time = CURRENT_TIMESTAMP,
               last_execution_status = ?,
               last_execution_message = ?,
               execution_count = execution_count + 1
           WHERE id = ?`,
          ['success', result.message, tasks[0].id]
        );
      }
    } catch (updateError) {
      console.warn('更新任务执行记录失败：', updateError);
    }

    res.json(result);
  } catch (error) {
    console.error('执行同步任务失败：', error);
    const failedUserId = req.headers['x-user-id'] || null;
    const failedDataApp = normalizeDataAppName(req.body.data_app_name) || DATA_APP_NEWS_SENTIMENT;
    // 尝试更新当前用户该库、该应用下任务的执行记录为失败
    try {
      const tasks = await db.query(
        'SELECT id FROM enterprise_sync_task WHERE db_config_id = ? AND created_by = ? AND data_app_name = ? AND delete_mark = 0',
        [req.body.db_config_id, failedUserId, failedDataApp]
      );
      if (tasks.length > 0) {
        await db.execute(
          `UPDATE enterprise_sync_task 
           SET last_execution_time = CURRENT_TIMESTAMP,
               last_execution_status = ?,
               last_execution_message = ?,
               execution_count = execution_count + 1
           WHERE id = ?`,
          ['failed', error.message, tasks[0].id]
        );
      }
    } catch (updateError) {
      console.warn('更新任务执行记录失败：', updateError);
    }

    res.status(500).json({ 
      success: false, 
      message: '执行失败：' + error.message 
    });
  }
});

module.exports = router;
module.exports.executeSyncTask = executeSyncTask;

