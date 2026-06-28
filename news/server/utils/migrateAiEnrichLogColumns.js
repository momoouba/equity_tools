'use strict';

/**
 * AI 增强日志表：联网/深度思考状态列（sourcing_financing_ai_enrich_log、invested_enterprise_ai_enrich_log）。
 * 启动时幂等补列，避免仅更新业务代码未跑完 db.initializeTables 时落库失败。
 */

const COLUMN_SPECS = [
  {
    name: 'invoke_mode',
    type: 'VARCHAR(40)',
    comment: '调用方式：chat_with_search/chat_with_search_thinking/chat_no_search/batch_file等',
  },
  {
    name: 'used_enable_search',
    type: 'TINYINT(1)',
    comment: '成功请求是否带enable_search：1是0否NULL未调模型',
  },
  {
    name: 'search_degraded',
    type: 'TINYINT(1)',
    comment: '是否联网参数失败后降级：1是0否NULL未调模型',
  },
  {
    name: 'used_enable_thinking',
    type: 'TINYINT(1)',
    comment: '成功请求是否带enable_thinking：1是0否NULL未调模型',
  },
  {
    name: 'thinking_degraded',
    type: 'TINYINT(1)',
    comment: '是否深度思考参数失败后降级：1是0否NULL未调模型',
  },
];

const TABLE_CONFIGS = [
  {
    table: 'sourcing_financing_ai_enrich_log',
    afterAnchor: 'result_company_tags_display',
    fallbackAnchor: 'error_message',
  },
  {
    table: 'invested_enterprise_ai_enrich_log',
    afterAnchor: 'result_industry_tags_display',
    fallbackAnchor: 'error_message',
  },
];

async function columnExists(exec, table, colName) {
  const [rows] = await exec.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, colName]
  );
  return rows.length > 0;
}

async function addColumn(exec, table, spec, afterCol) {
  const ddl = `ADD COLUMN \`${spec.name}\` ${spec.type} NULL COMMENT '${spec.comment.replace(/'/g, "''")}'`;
  if (afterCol && (await columnExists(exec, table, afterCol))) {
    await exec.query(`ALTER TABLE \`${table}\` ${ddl} AFTER \`${afterCol}\``);
  } else {
    await exec.query(`ALTER TABLE \`${table}\` ${ddl}`);
  }
}

/**
 * @param {import('mysql2/promise').Pool | { query: Function }} executor
 */
async function ensureAiEnrichLogSearchColumns(executor) {
  if (!executor || typeof executor.query !== 'function') {
    throw new Error('ensureAiEnrichLogSearchColumns: invalid executor');
  }
  let added = 0;
  for (const cfg of TABLE_CONFIGS) {
    const [tableRows] = await executor.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [cfg.table]
    );
    if (!tableRows.length) continue;

    let prev =
      (await columnExists(executor, cfg.table, cfg.afterAnchor))
        ? cfg.afterAnchor
        : (await columnExists(executor, cfg.table, cfg.fallbackAnchor))
          ? cfg.fallbackAnchor
          : null;

    for (const spec of COLUMN_SPECS) {
      if (await columnExists(executor, cfg.table, spec.name)) {
        prev = spec.name;
        continue;
      }
      try {
        await addColumn(executor, cfg.table, spec, prev);
        console.log(`✓ ${cfg.table} 已添加列 ${spec.name}`);
        added += 1;
        prev = spec.name;
      } catch (err) {
        try {
          await addColumn(executor, cfg.table, spec, null);
          console.log(`✓ ${cfg.table} 已添加列 ${spec.name}（无 AFTER）`);
          added += 1;
          prev = spec.name;
        } catch (err2) {
          console.warn(`迁移 ${cfg.table}.${spec.name} 失败:`, err2.message);
        }
      }
    }
  }
  return added;
}

function isMissingThinkingColumnError(err) {
  return (
    err &&
    err.code === 'ER_BAD_FIELD_ERROR' &&
    /used_enable_thinking|thinking_degraded/i.test(String(err.message || err.sqlMessage || ''))
  );
}

/**
 * 执行 AI 日志 UPDATE；若缺思考列则先补列再重试一次（避免热更新代码后未重启漏迁移）。
 */
async function executeWithAiEnrichLogColumns(dbMod, sql, params) {
  try {
    return await dbMod.execute(sql, params);
  } catch (err) {
    if (!isMissingThinkingColumnError(err)) throw err;
    await ensureAiEnrichLogSearchColumns({
      query: (s, p) => dbMod.query(s, p),
    });
    return await dbMod.execute(sql, params);
  }
}

module.exports = {
  ensureAiEnrichLogSearchColumns,
  executeWithAiEnrichLogColumns,
  isMissingThinkingColumnError,
  COLUMN_SPECS,
};
