/**
 * Stage 0-5：ipo_new_share 字段填充率基线（申万等 Stage 1 字段当前未建则记 0%）
 *
 * 用法（news 目录）：
 *   node server/scripts/reportIpoNewShareBaseline.js
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

const DEFAULT_OUT = path.resolve(__dirname, '../../../需求文档/竞品分析/ipo_new_share字段基线报告.md');

function parseArgs() {
  const out = { outFile: DEFAULT_OUT };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--out=')) out.outFile = path.resolve(a.slice(6));
  }
  return out;
}

function pct(n, d) {
  if (!d) return '0.00%';
  return `${((n / d) * 100).toFixed(2)}%`;
}

function hasText(v) {
  return v != null && String(v).trim() !== '';
}

async function columnExists(table, column) {
  const rows = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function main() {
  const opts = parseArgs();
  const stage1Cols = [
    'unified_credit_code',
    'sw_industry_l1',
    'sw_industry_l2',
    'industry_category_4',
    'product_intro',
  ];
  const colFlags = {};
  for (const c of stage1Cols) {
    colFlags[c] = await columnExists('ipo_new_share', c);
  }

  const totalRows = await db.query(`SELECT COUNT(*) AS c FROM ipo_new_share`);
  const total = Number(totalRows[0]?.c || 0);

  const base = await db.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN TRIM(COALESCE(enterprise_full_name_cn, '')) <> '' THEN 1 ELSE 0 END) AS cn_full,
      SUM(CASE WHEN TRIM(COALESCE(enterprise_full_name_display, '')) <> '' THEN 1 ELSE 0 END) AS display_full,
      SUM(CASE WHEN TRIM(COALESCE(enterprise_full_name_cn, '')) <> ''
                OR TRIM(COALESCE(enterprise_full_name_display, '')) <> '' THEN 1 ELSE 0 END) AS any_full
    FROM ipo_new_share
  `);
  const b = base[0] || {};

  const byExchange = await db.query(`
    SELECT exchange,
      COUNT(*) AS total,
      SUM(CASE WHEN TRIM(COALESCE(enterprise_full_name_cn, '')) <> ''
                OR TRIM(COALESCE(enterprise_full_name_display, '')) <> '' THEN 1 ELSE 0 END) AS any_full
    FROM ipo_new_share
    GROUP BY exchange
    ORDER BY total DESC
  `);

  const lines = [];
  lines.push('# ipo_new_share 字段填充率基线（Stage 0-5）');
  lines.push('');
  lines.push(`生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  lines.push('');
  lines.push('## 1. 总量');
  lines.push('');
  lines.push(`- 记录总数：**${total.toLocaleString()}**`);
  lines.push('');
  lines.push('## 2. 现有字段（库内已存在）');
  lines.push('');
  lines.push('| 字段 | 非空条数 | 填充率 |');
  lines.push('| --- | --- | --- |');
  lines.push(`| enterprise_full_name_cn | ${Number(b.cn_full || 0).toLocaleString()} | ${pct(Number(b.cn_full || 0), total)} |`);
  lines.push(`| enterprise_full_name_display | ${Number(b.display_full || 0).toLocaleString()} | ${pct(Number(b.display_full || 0), total)} |`);
  lines.push(`| 全称任一（cn 或 display） | ${Number(b.any_full || 0).toLocaleString()} | ${pct(Number(b.any_full || 0), total)} |`);
  lines.push('');
  lines.push('### 2.1 分交易所（全称任一）');
  lines.push('');
  lines.push('| 交易所 | 总数 | 全称有值 | 填充率 |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of byExchange) {
    const t = Number(r.total || 0);
    const f = Number(r.any_full || 0);
    lines.push(`| ${r.exchange || '—'} | ${t.toLocaleString()} | ${f.toLocaleString()} | ${pct(f, t)} |`);
  }
  lines.push('');
  lines.push('## 3. Stage 1 计划字段（当前库内 DDL 状态）');
  lines.push('');
  lines.push('| 字段 | 表内已建列 | 非空条数 | 填充率 | 说明 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const c of stage1Cols) {
    const exists = colFlags[c];
    let filled = 0;
    let rate = exists ? '0.00%' : '0.00%';
    if (exists) {
      const q = await db.query(
        `SELECT SUM(CASE WHEN TRIM(COALESCE(${c}, '')) <> '' THEN 1 ELSE 0 END) AS filled
         FROM ipo_new_share
         WHERE exchange IN ('上交所', '深交所', '北交所')`
      );
      filled = Number(q[0]?.filled || 0);
      const domestic = await db.query(
        `SELECT COUNT(*) AS c FROM ipo_new_share WHERE exchange IN ('上交所', '深交所', '北交所')`
      );
      const dTotal = Number(domestic[0]?.c || 0);
      rate = pct(filled, dTotal);
    }
    lines.push(
      `| ${c} | ${exists ? '是' : '**否**'} | ${exists ? filled.toLocaleString() : '0'} | ${rate} | Stage 1 扩展后回填 |`
    );
  }
  lines.push('');
  if (colFlags.sw_industry_l1) {
    const sw = await db.query(`
      SELECT
        SUM(CASE WHEN TRIM(COALESCE(sw_industry_l1, '')) <> '' THEN 1 ELSE 0 END) AS l1,
        COUNT(*) AS total
      FROM ipo_new_share
      WHERE exchange IN ('上交所', '深交所', '北交所')
    `);
    const dTotal = Number(sw[0]?.total || 0);
    const l1 = Number(sw[0]?.l1 || 0);
    lines.push(`> **申万行业（沪深北）**：一级非空 **${l1.toLocaleString()}** / ${dTotal.toLocaleString()}（**${pct(l1, dTotal)}**）`);
  } else {
    lines.push('> **申万行业基线**：`sw_industry_l1/l2` 列尚未创建，当前填充率按 **0%** 计；Stage 1a 完成后与本报告对比。');
  }
  lines.push('');

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
  fs.writeFileSync(opts.outFile, lines.join('\n'), 'utf8');
  console.log('[reportIpoNewShareBaseline] 报告:', opts.outFile);
  console.log('[reportIpoNewShareBaseline] 总数:', total, '全称任一:', pct(Number(b.any_full || 0), total));

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[reportIpoNewShareBaseline] 失败:', e);
  try {
    await db.closePool();
  } catch (_) {}
  process.exit(1);
});
