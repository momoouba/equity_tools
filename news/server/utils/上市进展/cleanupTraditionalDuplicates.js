/**
 * 清理港股繁简体重复数据脚本
 *
 * 业务逻辑（ipo_progress）：
 * 1. 港股繁体公司名会**故意**写入繁体 + 简体两行；「有繁体+简体」时**不再删繁体**。
 * 2. 仍清理：同书写重复（多条全繁体或多条全简体，归一化键相同）时只保留最早一条。
 *
 * 使用方法：
 * - 容器内（推荐）：与应用进程同一网络，且 MySQL 账号通常为 Docker 网段授权，避免 host 不匹配：
 *   cd /opt/newsapp/news && docker compose exec app node server/utils/上市进展/cleanupTraditionalDuplicates.js [--dry-run]
 *   （服务名以 compose 为准，可能是 app / newsapp 等）
 *
 * - 宿主机 + 127.0.0.1：MySQL 会把客户端记为 user@localhost，若库里仅有 news_app@'%'（不含 localhost）
 *   易出现 ER_ACCESS_DENIED 1045，需在库里补 GRANT 或改用容器内执行。
 *
 * --dry-run: 仅输出检测结果，不执行删除操作
 */

// 加载环境变量（从项目根目录的 .env 文件）
const path = require('path');
const fs = require('fs');

function parseDbHostOverride(argv) {
  const fromEnv = String(process.env.CLEANUP_DB_HOST || '').trim();
  if (fromEnv) return fromEnv;
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith('--db-host=')) {
      return arg.slice('--db-host='.length).trim();
    }
  }
  return '';
}

// 尝试多个可能的 .env 文件位置
const possibleEnvPaths = [
  path.resolve(__dirname, '../../../.env'), // news/server/utils/上市进展 -> news/.env
  path.resolve(__dirname, '../../../../.env'), // 项目根目录 .env
  path.resolve(process.cwd(), '.env'),
  '/opt/newsapp/news/.env',
  '/opt/newsapp/.env',
];

for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath, override: false });
    console.log(`[环境变量] 已加载: ${envPath}`);
    break;
  }
}

const dbHostOverride = parseDbHostOverride(process.argv);
if (dbHostOverride) {
  process.env.DB_HOST = dbHostOverride;
  console.log(`[数据库] 已通过 CLEANUP_DB_HOST / --db-host 覆盖 DB_HOST=${dbHostOverride}`);
  const h = dbHostOverride.toLowerCase();
  if (h === '127.0.0.1' || h === 'localhost' || h === '::1') {
    console.warn(
      '[数据库] 从宿主机连本机 MySQL 时，易出现「仅有 news_app@\'%\'、无 news_app@\'localhost\'」导致 1045。\n' +
        '优先建议：在项目目录执行 docker compose exec <app服务名> node server/utils/上市进展/cleanupTraditionalDuplicates.js [--dry-run]'
    );
  }
} else if (String(process.env.DB_HOST || '').trim() === 'mysql') {
  console.warn(
    '[数据库] 当前 DB_HOST=mysql（常见于 Docker Compose）。若在宿主机执行 node，将无法解析主机名 mysql。\n' +
      '请在容器内执行脚本（推荐），见文件头注释中的 docker compose exec 示例。'
  );
}

const db = require('../../db');
const { normalizeCompanyName, containsTraditional, toSimplified } = require('./zhconvUtils');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * 检测文本是否包含繁体字
 * @param {string} text 输入文本
 * @returns {boolean} 是否包含繁体字
 */
function hasTraditionalChars(text) {
  return containsTraditional(text);
}

/**
 * 检测文本是否为纯简体（不含繁体字）
 * @param {string} text 输入文本
 * @returns {boolean} 是否为纯简体
 */
function isPureSimplified(text) {
  return !hasTraditionalChars(text);
}

/**
 * 清理 ipo_progress 表中的繁简体重复数据
 *
 * 业务逻辑：
 * - 按业务键分组（exchange + 简化后的company + status + board + 日期）
 * - 有繁体+简体：两行均保留
 * - 多条同书写（仅繁或仅简）：保留最早一条
 *
 * @param {boolean} dryRun 是否仅模拟运行
 * @returns {Promise<{cleaned: number, keptTraditional: number, keptSimplified: number, samples: Array}>}
 */
async function cleanupIpoProgress(dryRun = DRY_RUN) {
  console.log('\n[ipo_progress] 开始检测港交所繁简体重复数据...');
  console.log('[ipo_progress] 业务逻辑：繁体+简体各保留一条；仅合并「同书写」重复记录');

  // 查询港交所所有未删除的记录
  const rows = await db.query(`
    SELECT f_id, company, project_name, status, board, exchange, f_update_time, receive_date
    FROM ipo_progress
    WHERE F_DeleteMark = 0 AND exchange = '港交所'
    ORDER BY f_id ASC
  `);

  console.log(`[ipo_progress] 港交所记录总数: ${rows.length}`);

  // 按简化后的公司名分组（用于检测繁简体重复）
  const groups = new Map();
  for (const row of rows) {
    const originalCompany = String(row.company || '').trim();
    if (!originalCompany) continue;

    const simplifiedCompany = normalizeCompanyName(originalCompany);
    const dateStr = String(row.f_update_time || '').slice(0, 10);
    const status = String(row.status || '').trim();
    const board = String(row.board || '').trim();

    // 业务键：简化后的公司名 + 状态 + 板块 + 日期
    const key = `${simplifiedCompany}|${status}|${board}|${dateStr}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push({
      f_id: row.f_id,
      company: originalCompany,
      simplifiedCompany,
      project_name: row.project_name,
      status,
      board,
      dateStr,
      receive_date: row.receive_date,
      isTraditional: hasTraditionalChars(originalCompany),
    });
  }

  // 筛出有重复的组（>=2条记录）
  const duplicateGroups = new Map();
  for (const [key, records] of groups) {
    if (records.length >= 2) {
      duplicateGroups.set(key, records);
    }
  }

  console.log(`[ipo_progress] 发现繁简体重复组数: ${duplicateGroups.size}`);

  if (duplicateGroups.size === 0) {
    console.log('[ipo_progress] 未发现繁简体重复数据');
    return { cleaned: 0, keptTraditional: 0, keptSimplified: rows.length, samples: [] };
  }

  let cleaned = 0;
  let keptTraditional = 0;
  let keptSimplified = 0;
  const samples = [];

  for (const [key, records] of duplicateGroups) {
    // 按是否为繁体分组
    const traditionalRecords = records.filter(r => r.isTraditional);
    const simplifiedRecords = records.filter(r => !r.isTraditional);

    // 情况1：只有繁体记录（没有简体）
    if (simplifiedRecords.length === 0 && traditionalRecords.length >= 2) {
      // 多条繁体记录：保留最早的一条（f_id最小），删除其余
      const sortedTraditional = traditionalRecords.sort((a, b) => a.f_id - b.f_id);
      const keepRecord = sortedTraditional[0];
      const deleteRecords = sortedTraditional.slice(1);

      console.log(`[ipo_progress] 组 "${key}" 只有繁体，保留最早的一条`);
      samples.push({
        key,
        action: 'keep_one_traditional',
        kept: keepRecord.company,
        deleted: deleteRecords.map(r => r.company),
      });

      if (!dryRun) {
        // 删除重复的繁体记录
        for (const delRecord of deleteRecords) {
          await db.execute(
            `UPDATE ipo_progress SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = 'system'
             WHERE f_id = ? AND F_DeleteMark = 0`,
            [delRecord.f_id]
          );
          cleaned += 1;
        }
      } else {
        cleaned += deleteRecords.length;
      }
      keptTraditional += 1;
    }
    // 情况2：有简体也有繁体 —— 双写策略，不删除
    else if (simplifiedRecords.length > 0 && traditionalRecords.length > 0) {
      console.log(`[ipo_progress] 组 "${key}" 同时存在繁体与简体行，均保留（不清理）`);
      samples.push({
        key,
        action: 'keep_both_traditional_and_simplified',
        kept: [...traditionalRecords, ...simplifiedRecords].map((r) => r.company).join('; '),
        deleted: [],
      });
      keptSimplified += simplifiedRecords.length;
      keptTraditional += traditionalRecords.length;
    }
    // 情况3：多条简体记录（无繁体）
    else if (simplifiedRecords.length >= 2 && traditionalRecords.length === 0) {
      // 多条简体记录：保留最早的一条，删除其余
      const sortedSimplified = simplifiedRecords.sort((a, b) => a.f_id - b.f_id);
      const keepRecord = sortedSimplified[0];
      const deleteRecords = sortedSimplified.slice(1);

      console.log(`[ipo_progress] 组 "${key}" 只有简体但有多条，保留最早的一条`);
      samples.push({
        key,
        action: 'keep_one_simplified',
        kept: keepRecord.company,
        deleted: deleteRecords.map(r => r.company),
      });

      if (!dryRun) {
        for (const delRecord of deleteRecords) {
          await db.execute(
            `UPDATE ipo_progress SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = 'system'
             WHERE f_id = ? AND F_DeleteMark = 0`,
            [delRecord.f_id]
          );
          cleaned += 1;
        }
      } else {
        cleaned += deleteRecords.length;
      }
      keptSimplified += 1;
    }
  }

  console.log(`[ipo_progress] 清理完成: 保留繁体=${keptTraditional}, 保留简体=${keptSimplified}, 删除=${cleaned}`);
  return { cleaned, keptTraditional, keptSimplified, samples };
}

/**
 * 清理 ipo_new_share 表中的繁简体重复数据
 *
 * 业务逻辑：
 * - 按股票代码分组
 * - 检查每组中繁简体情况：
 *   - 只有繁体：保留繁体（不转换）
 *   - 有繁体+简体：保留简体，删除繁体
 *
 * @param {boolean} dryRun 是否仅模拟运行
 * @returns {Promise<{cleaned: number, keptTraditional: number, keptSimplified: number, samples: Array}>}
 */
async function cleanupIpoNewShare(dryRun = DRY_RUN) {
  console.log('\n[ipo_new_share] 开始检测港交所繁简体重复数据...');
  console.log('[ipo_new_share] 业务逻辑：只有繁体保留繁体；有繁体+简体保留简体删除繁体');

  // 查询港交所所有记录
  const rows = await db.query(`
    SELECT id, stock_code, stock_name, exchange, enterprise_full_name_cn, enterprise_full_name_display
    FROM ipo_new_share
    WHERE exchange = '港交所'
    ORDER BY id ASC
  `);

  console.log(`[ipo_new_share] 港交所记录总数: ${rows.length}`);

  // 按股票代码分组
  const codeGroups = new Map();
  for (const row of rows) {
    const code = String(row.stock_code || '').trim().padStart(5, '0');
    if (!code) continue;

    const stockName = String(row.stock_name || '').trim();

    if (!codeGroups.has(code)) {
      codeGroups.set(code, []);
    }

    codeGroups.get(code).push({
      id: row.id,
      stock_code: code,
      stock_name: stockName,
      simplifiedName: normalizeCompanyName(stockName),
      enterprise_full_name_cn: row.enterprise_full_name_cn,
      enterprise_full_name_display: row.enterprise_full_name_display,
      isTraditional: hasTraditionalChars(stockName),
    });
  }

  // 筛出有重复的代码组（>=2条记录）
  const duplicateGroups = new Map();
  for (const [code, records] of codeGroups) {
    if (records.length >= 2) {
      duplicateGroups.set(code, records);
    }
  }

  console.log(`[ipo_new_share] 发现重复股票代码数: ${duplicateGroups.size}`);

  if (duplicateGroups.size === 0) {
    console.log('[ipo_new_share] 未发现繁简体重复数据');
    return { cleaned: 0, keptTraditional: 0, keptSimplified: rows.length, samples: [] };
  }

  let cleaned = 0;
  let keptTraditional = 0;
  let keptSimplified = 0;
  const samples = [];

  for (const [code, records] of duplicateGroups) {
    // 按是否为繁体分组
    const traditionalRecords = records.filter(r => r.isTraditional);
    const simplifiedRecords = records.filter(r => !r.isTraditional);

    // 情况1：只有繁体记录（没有简体）
    if (simplifiedRecords.length === 0 && traditionalRecords.length >= 2) {
      // 多条繁体记录：保留最早的一条（id最小），删除其余
      const sortedTraditional = traditionalRecords.sort((a, b) => a.id - b.id);
      const keepRecord = sortedTraditional[0];
      const deleteRecords = sortedTraditional.slice(1);

      console.log(`[ipo_new_share] 股票代码 "${code}" 只有繁体，保留最早的一条`);
      samples.push({
        code,
        action: 'keep_one_traditional',
        kept: keepRecord.stock_name,
        deleted: deleteRecords.map(r => r.stock_name),
      });

      if (!dryRun) {
        for (const delRecord of deleteRecords) {
          await db.execute(
            `DELETE FROM ipo_new_share WHERE id = ?`,
            [delRecord.id]
          );
          cleaned += 1;
        }
      } else {
        cleaned += deleteRecords.length;
      }
      keptTraditional += 1;
    }
    // 情况2：有简体也有繁体
    else if (simplifiedRecords.length > 0 && traditionalRecords.length > 0) {
      // 保留简体，删除繁体
      const keepSimplifiedRecords = simplifiedRecords;
      const deleteTraditionalRecords = traditionalRecords;

      console.log(`[ipo_new_share] 股票代码 "${code}" 有简体也有繁体，保留简体删除繁体`);
      samples.push({
        code,
        action: 'keep_simplified_delete_traditional',
        kept: keepSimplifiedRecords.map(r => r.stock_name).join('; '),
        deleted: deleteTraditionalRecords.map(r => r.stock_name).join('; '),
      });

      if (!dryRun) {
        for (const delRecord of deleteTraditionalRecords) {
          await db.execute(
            `DELETE FROM ipo_new_share WHERE id = ?`,
            [delRecord.id]
          );
          cleaned += 1;
        }
      } else {
        cleaned += deleteTraditionalRecords.length;
      }
      keptSimplified += keepSimplifiedRecords.length;
    }
    // 情况3：多条简体记录（无繁体）
    else if (simplifiedRecords.length >= 2 && traditionalRecords.length === 0) {
      // 多条简体记录：保留最早的一条，删除其余
      const sortedSimplified = simplifiedRecords.sort((a, b) => a.id - b.id);
      const keepRecord = sortedSimplified[0];
      const deleteRecords = sortedSimplified.slice(1);

      console.log(`[ipo_new_share] 股票代码 "${code}" 只有简体但有多条，保留最早的一条`);
      samples.push({
        code,
        action: 'keep_one_simplified',
        kept: keepRecord.stock_name,
        deleted: deleteRecords.map(r => r.stock_name),
      });

      if (!dryRun) {
        for (const delRecord of deleteRecords) {
          await db.execute(
            `DELETE FROM ipo_new_share WHERE id = ?`,
            [delRecord.id]
          );
          cleaned += 1;
        }
      } else {
        cleaned += deleteRecords.length;
      }
      keptSimplified += 1;
    }
  }

  console.log(`[ipo_new_share] 清理完成: 保留繁体=${keptTraditional}, 保留简体=${keptSimplified}, 删除=${cleaned}`);
  return { cleaned, keptTraditional, keptSimplified, samples };
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('港股繁简体重复数据清理脚本');
  console.log('业务逻辑：');
  console.log('  - 只有繁体的：保留繁体（不转换）');
  console.log('  - 有繁体+简体的：保留简体，删除繁体');
  console.log(`运行模式: ${DRY_RUN ? '模拟运行 (--dry-run)' : '正式执行'}`);
  console.log('========================================');

  try {
    const progressResult = await cleanupIpoProgress(DRY_RUN);
    const newShareResult = await cleanupIpoNewShare(DRY_RUN);

    console.log('\n========================================');
    console.log('清理汇总');
    console.log('========================================');
    console.log(`ipo_progress:`);
    console.log(`  - 保留繁体: ${progressResult.keptTraditional}`);
    console.log(`  - 保留简体: ${progressResult.keptSimplified}`);
    console.log(`  - 删除: ${progressResult.cleaned}`);
    console.log(`ipo_new_share:`);
    console.log(`  - 保留繁体: ${newShareResult.keptTraditional}`);
    console.log(`  - 保留简体: ${newShareResult.keptSimplified}`);
    console.log(`  - 删除: ${newShareResult.cleaned}`);
    console.log(`总删除: ${progressResult.cleaned + newShareResult.cleaned}`);

    if (DRY_RUN) {
      console.log('\n提示: 这是模拟运行，未执行实际删除。');
      console.log('如需执行删除，请去掉 --dry-run 参数重新运行。');
    }

    // 输出样例
    const allSamples = [...progressResult.samples, ...newShareResult.samples];
    if (allSamples.length > 0) {
      console.log('\n========================================');
      console.log('处理样例（最多显示10条）');
      console.log('========================================');

      const displaySamples = allSamples.slice(0, 10);

      for (const sample of displaySamples) {
        console.log(`\n键/代码: ${sample.key || sample.code}`);
        console.log(`操作: ${sample.action}`);
        console.log(`保留: ${sample.kept}`);
        console.log(`删除: ${sample.deleted}`);
      }
    }

  } catch (err) {
    console.error('\n清理失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }

  process.exit(0);
}

// 导出清理函数供其他模块调用
module.exports = {
  cleanupIpoProgress,
  cleanupIpoNewShare,
};

// 直接运行时执行主函数
if (require.main === module) {
  main();
}