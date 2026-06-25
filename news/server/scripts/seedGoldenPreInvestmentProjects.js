/**
 * 恢复黄金集 smoke test 投前项目（样本 2～5）
 *
 * 数据来源：scripts/competitor-embedding-poc/data/pool.json（2026-06-24 导出）
 *
 * 用法（news 目录）：
 *   node server/scripts/seedGoldenPreInvestmentProjects.js
 *   node server/scripts/seedGoldenPreInvestmentProjects.js --dry-run
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('../db');
const { getApplicationIdByAppName } = require('../utils/applicationIdResolve');

const CREATOR_USER_ID = '2025112019135100001';
const POOL_JSON = path.join(
  __dirname,
  '../../../scripts/competitor-embedding-poc/data/pool.json'
);

/** @type {Record<string, {enterprise_full_name:string, project_abbreviation:string, unified_credit_code:string|null}>} */
const META = {
  '2026062414483000001': {
    enterprise_full_name: '上海碧途生物技术有限公司',
    project_abbreviation: '碧途生物',
    unified_credit_code: '91310000MAC79HAM4N',
  },
  '2026062413465200001': {
    enterprise_full_name: '赛普（杭州）过滤科技有限公司',
    project_abbreviation: '赛普过滤',
    unified_credit_code: '91330100MA2KEMF94Q',
  },
  '2026062414014700001': {
    enterprise_full_name: '成器智造（北京）科技有限公司',
    project_abbreviation: '成器智造',
    unified_credit_code: '91110400MA7H0HK92K',
  },
  '2026062414280300001': {
    enterprise_full_name: '江苏关怀医疗科技（集团）有限公司',
    project_abbreviation: '关怀医疗',
    unified_credit_code: '91320506MA1XQXUP6K',
  },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseTargetDocument(targetDocument) {
  const parts = String(targetDocument || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) {
    return { ai_product_intro: '', qcc_company_intro: '', ai_industry_tags_display: '' };
  }
  const tagsLine = parts[parts.length - 1];
  const body = parts.slice(0, -1);
  const firstLooksLikeName =
    body.length > 1 &&
    /(有限公司|股份有限公司|集团)/.test(body[0]) &&
    body[0].length < 80;
  const ai_product_intro = firstLooksLikeName ? body[1] : body[0];
  const qccParts = firstLooksLikeName ? body.slice(2) : body.slice(1);
  const qcc_company_intro = qccParts.length ? qccParts.join('\n') : ai_product_intro;
  return {
    ai_product_intro,
    qcc_company_intro,
    ai_industry_tags_display: tagsLine,
  };
}

function loadGoldenRowsFromPool() {
  const raw = JSON.parse(fs.readFileSync(POOL_JSON, 'utf8'));
  const ids = Object.keys(META);
  const rows = [];
  for (const subjectId of ids) {
    const subject = (raw.subjects || []).find((s) => s.subject_id === subjectId);
    if (!subject?.target_document) {
      throw new Error(`pool.json 缺少 subject ${subjectId} 的 target_document`);
    }
    const parsed = parseTargetDocument(subject.target_document);
    const meta = META[subjectId];
    rows.push({
      id: subjectId,
      ...meta,
      ...parsed,
    });
  }
  return rows;
}

async function waitDbReady() {
  for (let i = 0; i < 60; i++) {
    try {
      await db.query('SELECT 1');
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('数据库未就绪');
}

async function resolveDataAppId() {
  return getApplicationIdByAppName('项目挖掘');
}

async function upsertProject(row, dataAppId, dryRun) {
  const existing = await db.query(
    `SELECT F_Id, enterprise_full_name, F_DeleteMark FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
    [row.id]
  );

  if (dryRun) {
    console.log(`[dry-run] ${existing.length ? 'UPDATE' : 'INSERT'} ${row.id} ${row.enterprise_full_name}`);
    return { action: existing.length ? 'update' : 'insert', id: row.id };
  }

  if (existing.length) {
    await db.execute(
      `UPDATE pre_investment_project SET
         enterprise_full_name = ?,
         unified_credit_code = ?,
         project_abbreviation = ?,
         qcc_company_intro = ?,
         ai_product_intro = ?,
         ai_industry_tags_display = ?,
         pipeline_status = 'ai_done',
         ai_enrich_status = 'done',
         ai_enrich_at = NOW(),
         data_app_id = COALESCE(data_app_id, ?),
         data_app_name = '项目挖掘',
         F_DeleteMark = 0,
         F_DeleteTime = NULL,
         F_DeleteUserId = NULL,
         F_LastModifyTime = NOW()
       WHERE F_Id = ?`,
      [
        row.enterprise_full_name,
        row.unified_credit_code,
        row.project_abbreviation,
        row.qcc_company_intro,
        row.ai_product_intro,
        row.ai_industry_tags_display,
        dataAppId,
        row.id,
      ]
    );
    return { action: 'update', id: row.id };
  }

  await db.execute(
    `INSERT INTO pre_investment_project (
       F_Id, enterprise_full_name, unified_credit_code, project_abbreviation,
       qcc_company_intro, ai_product_intro, ai_industry_tags_display,
       pipeline_status, ai_enrich_status, ai_enrich_at,
       data_app_id, data_app_name, F_CreatorUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,?,?,?,?,?,NOW(),?,? ,?,NOW(),NOW(),0)`,
    [
      row.id,
      row.enterprise_full_name,
      row.unified_credit_code,
      row.project_abbreviation,
      row.qcc_company_intro,
      row.ai_product_intro,
      row.ai_industry_tags_display,
      'ai_done',
      'done',
      dataAppId,
      '项目挖掘',
      CREATOR_USER_ID,
    ]
  );
  return { action: 'insert', id: row.id };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = loadGoldenRowsFromPool();
  await waitDbReady();
  const dataAppId = await resolveDataAppId();
  if (!dataAppId) console.warn('未找到「项目挖掘」应用，data_app_id 将为 NULL');

  const results = [];
  for (const row of rows) {
    results.push(await upsertProject(row, dataAppId, dryRun));
  }

  const verify = dryRun
    ? []
    : await db.query(
        `SELECT F_Id, enterprise_full_name, unified_credit_code, F_DeleteMark,
                LEFT(ai_product_intro, 80) AS intro_preview
         FROM pre_investment_project
         WHERE F_Id IN (?)
         ORDER BY F_Id`,
        [rows.map((p) => p.id)]
      );

  console.log(JSON.stringify({ dryRun, dataAppId, results, verify }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
