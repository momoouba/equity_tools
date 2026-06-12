/**
 * 清理港股繁简体重复数据脚本
 *
 * 业务逻辑（ipo_progress + ipo_new_share）：
 * 1. 繁体记录一律不保留：若已有对应简体记录则删除繁体；若无简体则将繁体原地转为简体。
 * 2. 同书写重复（多条简体归一化键相同）时只保留最早一条。
 * 3. 删除 ipo_progress 繁体记录时，同步清理关联的 ipo_project_progress。
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

// #17: IN 子句占位符上限，防止参数过多导致 SQL 异常
const MAX_IN_CLAUSE_SIZE = 500;

/**
 * #17: 分块执行带 IN 子句的 SQL，避免占位符数量超限
 * @param {string} sqlTemplate SQL 模板，包含 __IN__ 占位符
 * @param {Array} ids ID 数组
 * @param {Array} prefixParams IN 子句前的绑定参数
 */
async function chunkedInExecute(sqlTemplate, ids, prefixParams = []) {
  let totalAffected = 0;
  for (let i = 0; i < ids.length; i += MAX_IN_CLAUSE_SIZE) {
    const chunk = ids.slice(i, i + MAX_IN_CLAUSE_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const sql = sqlTemplate.replace('__IN__', placeholders);
    const [res] = await db.execute(sql, [...prefixParams, ...chunk]);
    totalAffected += res.affectedRows || 0;
  }
  return totalAffected;
}

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
 * 清理 ipo_progress 表中的港交所繁体数据
 *
 * 策略：
 * - 繁体 + 简体同键：删除繁体（保留简体），同步清理 ipo_project_progress
 * - 仅有繁体：原地 UPDATE 为简体名称（若更新后与已有简体冲突则删除）
 * - 多条简体同键：保留最早一条
 *
 * @param {boolean} dryRun 是否仅模拟运行
 * @returns {Promise<{cleaned: number, converted: number, keptSimplified: number, samples: Array}>}
 */
async function cleanupIpoProgress(dryRun = DRY_RUN) {
  console.log('\n[ipo_progress] 开始检测港交所繁体数据...');
  console.log('[ipo_progress] 策略：繁体一律转简体或删除，不保留繁体记录');

  // 查询港交所所有未删除的记录
  const rows = await db.query(`
    SELECT f_id, company, project_name, status, board, exchange, f_update_time, receive_date
    FROM ipo_progress
    WHERE F_DeleteMark = 0 AND exchange = '港交所'
    ORDER BY f_id ASC
  `);

  console.log(`[ipo_progress] 港交所记录总数: ${rows.length}`);

  // 按简化后的公司名 + 状态 + 板块 + 日期 分组
  const groups = new Map();
  for (const row of rows) {
    const originalCompany = String(row.company || '').trim();
    if (!originalCompany) continue;

    const simplifiedCompany = normalizeCompanyName(originalCompany);
    const dateStr = String(row.f_update_time || '').slice(0, 10);
    const status = String(row.status || '').trim();
    const board = String(row.board || '').trim();

    const key = `${simplifiedCompany}|${status}|${board}|${dateStr}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push({
      f_id: row.f_id,
      company: originalCompany,
      project_name: row.project_name,
      simplifiedCompany,
      status,
      board,
      dateStr,
      receive_date: row.receive_date,
      isTraditional: hasTraditionalChars(originalCompany),
    });
  }

  let cleaned = 0;
  let converted = 0;
  let keptSimplified = 0;
  const samples = [];

  for (const [key, records] of groups) {
    const traditionalRecords = records.filter(r => r.isTraditional);
    const simplifiedRecords = records.filter(r => !r.isTraditional);

    // 情况1：同时存在繁体和简体 → 删除繁体（及关联 ipo_project_progress），保留简体
    if (simplifiedRecords.length > 0 && traditionalRecords.length > 0) {
      console.log(`[ipo_progress] 组 "${key}" 有简体也有繁体，删除繁体保留简体`);
      samples.push({
        key,
        action: 'delete_traditional_keep_simplified',
        kept: simplifiedRecords.map(r => r.company).join('; '),
        deleted: traditionalRecords.map(r => r.company),
      });

      if (!dryRun) {
        const tradIds = traditionalRecords.map(r => r.f_id);
        // 先删除关联的 ipo_project_progress（#17: 分块执行避免 IN 子句超限）
        if (tradIds.length > 0) {
          await chunkedInExecute(
            `DELETE FROM ipo_project_progress WHERE ipo_progress_row_id IN (__IN__)`,
            tradIds
          );
        }
        // 软删除繁体记录
        for (const id of tradIds) {
          await db.execute(
            `UPDATE ipo_progress SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = 'system'
             WHERE f_id = ? AND F_DeleteMark = 0`,
            [id]
          );
          cleaned += 1;
        }
      } else {
        cleaned += traditionalRecords.length;
      }
      keptSimplified += simplifiedRecords.length;

      // 多条简体时也去重
      if (simplifiedRecords.length >= 2) {
        const sorted = simplifiedRecords.sort((a, b) => a.f_id - b.f_id);
        const deleteRecords = sorted.slice(1);
        if (!dryRun) {
          for (const del of deleteRecords) {
            const delIds = [del.f_id];
            const ph = delIds.map(() => '?').join(',');
            await db.execute(
              `DELETE FROM ipo_project_progress WHERE ipo_progress_row_id IN (${ph})`,
              delIds
            );
            await db.execute(
              `UPDATE ipo_progress SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = 'system'
               WHERE f_id = ? AND F_DeleteMark = 0`,
              [del.f_id]
            );
            cleaned += 1;
          }
        } else {
          cleaned += deleteRecords.length;
        }
        keptSimplified -= deleteRecords.length;
      }
    }
    // 情况2：只有繁体记录（无简体） → 原地转为简体
    else if (simplifiedRecords.length === 0 && traditionalRecords.length >= 1) {
      const sorted = traditionalRecords.sort((a, b) => a.f_id - b.f_id);
      // 第一条转为简体
      const convertRecord = sorted[0];
      const deleteRecords = sorted.slice(1);

      console.log(`[ipo_progress] 组 "${key}" 仅有繁体，将第1条转为简体，删除其余`);
      samples.push({
        key,
        action: 'convert_to_simplified',
        converted: `${convertRecord.company} → ${convertRecord.simplifiedCompany}`,
        deleted: deleteRecords.map(r => r.company),
      });

      if (!dryRun) {
        // 将第一条繁体记录原地更新为简体
        await db.execute(
          `UPDATE ipo_progress SET company = ?, project_name = ? WHERE f_id = ? AND F_DeleteMark = 0`,
          [convertRecord.simplifiedCompany, normalizeCompanyName(convertRecord.project_name || convertRecord.simplifiedCompany), convertRecord.f_id]
        );
        // 删除关联的 ipo_project_progress（让 listingMatchRunner 重新匹配）
        await db.execute(
          `DELETE FROM ipo_project_progress WHERE ipo_progress_row_id = ?`,
          [convertRecord.f_id]
        );
        converted += 1;

        // 多余的繁体记录直接删除
        for (const del of deleteRecords) {
          await db.execute(
            `DELETE FROM ipo_project_progress WHERE ipo_progress_row_id = ?`,
            [del.f_id]
          );
          await db.execute(
            `UPDATE ipo_progress SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = 'system'
             WHERE f_id = ? AND F_DeleteMark = 0`,
            [del.f_id]
          );
          cleaned += 1;
        }
      } else {
        converted += 1;
        cleaned += deleteRecords.length;
      }
    }
    // 情况3：只有简体记录且有多条 → 保留最早一条
    else if (simplifiedRecords.length >= 2 && traditionalRecords.length === 0) {
      const sorted = simplifiedRecords.sort((a, b) => a.f_id - b.f_id);
      const deleteRecords = sorted.slice(1);

      console.log(`[ipo_progress] 组 "${key}" 多条简体，保留最早一条`);
      samples.push({
        key,
        action: 'keep_one_simplified',
        kept: sorted[0].company,
        deleted: deleteRecords.map(r => r.company),
      });

      if (!dryRun) {
        for (const del of deleteRecords) {
          const delIds = [del.f_id];
          const ph = delIds.map(() => '?').join(',');
          await db.execute(
            `DELETE FROM ipo_project_progress WHERE ipo_progress_row_id IN (${ph})`,
            delIds
          );
          await db.execute(
            `UPDATE ipo_progress SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = 'system'
             WHERE f_id = ? AND F_DeleteMark = 0`,
            [del.f_id]
          );
          cleaned += 1;
        }
      } else {
        cleaned += deleteRecords.length;
      }
      keptSimplified += 1;
    }
    // 情况4：单条简体记录 → 无需处理
    else {
      keptSimplified += simplifiedRecords.length;
    }
  }

  console.log(`[ipo_progress] 清理完成: 繁体转简体=${converted}, 删除繁体/重复=${cleaned}, 保留简体=${keptSimplified}`);
  return { cleaned, converted, keptSimplified, samples };
}

/**
 * 清理 ipo_new_share 表中的港交所繁体数据
 *
 * 策略：
 * - 繁体 + 简体同 code：删除繁体，保留简体
 * - 仅有繁体：原地 UPDATE 为简体名称
 * - 多条简体同 code：保留最早一条
 *
 * @param {boolean} dryRun 是否仅模拟运行
 * @returns {Promise<{cleaned: number, converted: number, keptSimplified: number, samples: Array}>}
 */
async function cleanupIpoNewShare(dryRun = DRY_RUN) {
  console.log('\n[ipo_new_share] 开始检测港交所繁体数据...');
  console.log('[ipo_new_share] 策略：繁体一律转简体或删除，不保留繁体记录');

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

  let cleaned = 0;
  let converted = 0;
  let keptSimplified = 0;
  const samples = [];

  for (const [code, records] of codeGroups) {
    const traditionalRecords = records.filter(r => r.isTraditional);
    const simplifiedRecords = records.filter(r => !r.isTraditional);

    // 情况1：同时存在繁体和简体 → 删除繁体，保留简体
    if (simplifiedRecords.length > 0 && traditionalRecords.length > 0) {
      console.log(`[ipo_new_share] 股票代码 "${code}" 有简体也有繁体，删除繁体保留简体`);
      samples.push({
        code,
        action: 'delete_traditional_keep_simplified',
        kept: simplifiedRecords.map(r => r.stock_name).join('; '),
        deleted: traditionalRecords.map(r => r.stock_name),
      });

      if (!dryRun) {
        for (const del of traditionalRecords) {
          await db.execute(`DELETE FROM ipo_new_share WHERE id = ?`, [del.id]);
          cleaned += 1;
        }
      } else {
        cleaned += traditionalRecords.length;
      }
      keptSimplified += simplifiedRecords.length;

      // 多条简体时也去重
      if (simplifiedRecords.length >= 2) {
        const sorted = simplifiedRecords.sort((a, b) => a.id - b.id);
        const deleteRecords = sorted.slice(1);
        if (!dryRun) {
          for (const del of deleteRecords) {
            await db.execute(`DELETE FROM ipo_new_share WHERE id = ?`, [del.id]);
            cleaned += 1;
          }
        } else {
          cleaned += deleteRecords.length;
        }
        keptSimplified -= deleteRecords.length;
      }
    }
    // 情况2：只有繁体记录（无简体） → 原地转为简体
    else if (simplifiedRecords.length === 0 && traditionalRecords.length >= 1) {
      const sorted = traditionalRecords.sort((a, b) => a.id - b.id);
      const convertRecord = sorted[0];
      const deleteRecords = sorted.slice(1);

      console.log(`[ipo_new_share] 股票代码 "${code}" 仅有繁体，将第1条转为简体，删除其余`);
      samples.push({
        code,
        action: 'convert_to_simplified',
        converted: `${convertRecord.stock_name} → ${convertRecord.simplifiedName}`,
        deleted: deleteRecords.map(r => r.stock_name),
      });

      if (!dryRun) {
        // 将第一条繁体记录原地更新为简体
        await db.execute(
          `UPDATE ipo_new_share SET stock_name = ? WHERE id = ?`,
          [convertRecord.simplifiedName, convertRecord.id]
        );
        converted += 1;

        // 删除多余的繁体记录
        for (const del of deleteRecords) {
          await db.execute(`DELETE FROM ipo_new_share WHERE id = ?`, [del.id]);
          cleaned += 1;
        }
      } else {
        converted += 1;
        cleaned += deleteRecords.length;
      }
    }
    // 情况3：只有简体记录且有多条 → 保留最早一条
    else if (simplifiedRecords.length >= 2 && traditionalRecords.length === 0) {
      const sorted = simplifiedRecords.sort((a, b) => a.id - b.id);
      const deleteRecords = sorted.slice(1);

      console.log(`[ipo_new_share] 股票代码 "${code}" 多条简体，保留最早一条`);
      samples.push({
        code,
        action: 'keep_one_simplified',
        kept: sorted[0].stock_name,
        deleted: deleteRecords.map(r => r.stock_name),
      });

      if (!dryRun) {
        for (const del of deleteRecords) {
          await db.execute(`DELETE FROM ipo_new_share WHERE id = ?`, [del.id]);
          cleaned += 1;
        }
      } else {
        cleaned += deleteRecords.length;
      }
      keptSimplified += 1;
    }
    // 情况4：单条简体记录 → 无需处理
    else {
      keptSimplified += simplifiedRecords.length;
    }
  }

  console.log(`[ipo_new_share] 清理完成: 繁体转简体=${converted}, 删除繁体/重复=${cleaned}, 保留简体=${keptSimplified}`);
  return { cleaned, converted, keptSimplified, samples };
}

/**
 * 清理 ipo_project_progress 中的孤立记录
 * 即 ipo_progress_row_id 指向的 ipo_progress 记录已不存在的行
 *
 * @param {boolean} dryRun 是否仅模拟运行
 * @returns {Promise<number>} 清理的孤立记录数
 */
async function cleanupOrphanedProgressLinks(dryRun = DRY_RUN) {
  console.log('\n[orphan-cleanup] 开始清理 ipo_project_progress 中的孤立记录...');

  // 查找所有 match_source='ipo_progress' 且 ipo_progress_row_id 在 ipo_progress 表中不存在的记录
  const orphans = await db.query(
    `SELECT ipp.f_id, ipp.ipo_project_f_id, ipp.ipo_progress_row_id, ipp.company, ipp.status, ipp.f_update_time
     FROM ipo_project_progress ipp
     LEFT JOIN ipo_progress ip ON ipp.ipo_progress_row_id = ip.f_id
     WHERE ip.f_id IS NULL
       AND ipp.delete_mark = 0
       AND ipp.match_source = 'ipo_progress'
     ORDER BY ipp.f_id ASC`
  );

  console.log(`[orphan-cleanup] 发现 ${orphans.length} 条孤立记录`);

  if (orphans.length === 0) return 0;

  if (!dryRun) {
    const orphanIds = orphans.map(r => r.f_id);
    // #17: 分块执行避免 IN 子句占位符超限
    await chunkedInExecute(
      `UPDATE ipo_project_progress SET delete_mark = 1, delete_time = NOW(), delete_user_id = 'system_orphan_cleanup'
       WHERE f_id IN (__IN__)`,
      orphanIds
    );
    console.log(`[orphan-cleanup] 已软删除 ${orphanIds.length} 条孤立记录`);
  } else {
    for (const r of orphans.slice(0, 10)) {
      const dt = r.f_update_time ? new Date(r.f_update_time).toISOString().slice(0, 10) : '';
      console.log(`  [dry-run] f_id=${r.f_id} | proj=${r.ipo_project_f_id} | row_id=${r.ipo_progress_row_id} | company=${r.company} | status=${r.status} | date=${dt}`);
    }
    if (orphans.length > 10) {
      console.log(`  ... 及其他 ${orphans.length - 10} 条`);
    }
  }

  return orphans.length;
}

/**
 * 主函数
 */
async function main() {
  console.log('========================================');
  console.log('港股繁简体重复数据清理脚本');
  console.log('业务逻辑：');
  console.log('  - 繁体 + 简体同键：删除繁体，保留简体');
  console.log('  - 仅有繁体：原地转为简体，多余删除');
  console.log('  - 多条简体同键：保留最早一条');
  console.log(`运行模式: ${DRY_RUN ? '模拟运行 (--dry-run)' : '正式执行'}`);
  console.log('========================================');

  try {
    const progressResult = await cleanupIpoProgress(DRY_RUN);
    const newShareResult = await cleanupIpoNewShare(DRY_RUN);
    const orphanCount = await cleanupOrphanedProgressLinks(DRY_RUN);

    console.log('\n========================================');
    console.log('清理汇总');
    console.log('========================================');
    console.log(`ipo_progress:`);
    console.log(`  - 繁体转简体: ${progressResult.converted}`);
    console.log(`  - 删除繁体/重复: ${progressResult.cleaned}`);
    console.log(`  - 保留简体: ${progressResult.keptSimplified}`);
    console.log(`ipo_new_share:`);
    console.log(`  - 繁体转简体: ${newShareResult.converted}`);
    console.log(`  - 删除繁体/重复: ${newShareResult.cleaned}`);
    console.log(`  - 保留简体: ${newShareResult.keptSimplified}`);
    console.log(`孤立记录清理: ${orphanCount}`);
    console.log(`总转换: ${progressResult.converted + newShareResult.converted}`);
    console.log(`总删除: ${progressResult.cleaned + newShareResult.cleaned + orphanCount}`);

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
        if (sample.converted) console.log(`转换: ${sample.converted}`);
        if (sample.kept) console.log(`保留: ${sample.kept}`);
        if (sample.deleted) console.log(`删除: ${sample.deleted}`);
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
  cleanupOrphanedProgressLinks,
};

// 直接运行时执行主函数
if (require.main === module) {
  main();
}