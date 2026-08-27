'use strict';

/**
 * P0：亦立生物 0824 反馈表 → competitor_gold_standard_pair
 *
 * 用法（news 目录）：node server/scripts/importYiliFeedbackGoldPairs.js
 *
 * 数据说明：
 * - 6 家人工补漏召的核药同行 → final_is_competitor=1（进金标种子召回）
 * - 同赛道不同模态误报 → final_is_competitor=0（标注负样本，供回归）
 * - 竞品对但量级/阶段不可比（Curium 等）→ final_is_competitor=1 + notes 标注 stage 不可比
 */

const db = require('../db');

const BATCH_ID = 'feedback_yili_20260825';
const TARGET = {
  target_source: 'financing',
  target_ref_id: 3890,
  target_display_name: '亦立医药',
  target_credit_code: '91330108MAD8RWW9X3',
};

// 人工补的 6 家真同行（漏召）；能匹配到融资事件的带 ref，匹配不到仅留名称（召回侧会用轻量候选兜底）
const MISSED_COMPETITORS = [
  { name: '烟台蓝纳成生物技术股份有限公司', credit: '91310000MA1H3FYU34', source: 'sourcing_financing_event', refId: 8572, note: '反馈表人工补漏召；RDC/核素偶联' },
  { name: '嘉兴法伯新天医药科技有限公司', credit: '91110105MA003D2L3D', source: 'sourcing_financing_event', refId: 30323, note: '反馈表人工补漏召；放射性药物' },
  { name: '艾博兹医药（上海）有限公司', credit: '91310115MA1HBM186B', source: 'sourcing_financing_event', refId: 148089, note: '反馈表人工补漏召；核药' },
  { name: '北京核欣迅明医药科技有限公司', credit: '91320585MA2251K0X6', source: 'sourcing_financing_event', refId: 12819, note: '反馈表「核欣医药」，按名称匹配为核欣迅明，待业务复核' },
  { name: '速康药业', credit: null, source: null, refId: null, note: '反馈表人工补漏召；本地库未匹配到实体（安速康医疗疑似但存疑），仅按名称召回' },
  { name: '砹尔法纽克莱（宁波）医疗科技有限公司', credit: '91330201MA2J39FQ7N', source: 'sourcing_financing_event', refId: 4181, note: '反馈表「砹尔法」；α核素/核药' },
];

// 同赛道但不同模态：业务标 D=否
const MODALITY_FALSE_POSITIVES = [
  { name: '璃道生物', note: '小分子，模态不同' },
  { name: 'Brano', note: 'CNS 小分子，模态不同' },
  { name: '脑环路', note: '细胞治疗，模态不同' },
  { name: '星曜坤泽', note: 'CAR-T，模态不同' },
  { name: '礼新医药', note: 'ADC，模态不同' },
  { name: '凯思凯迪', note: 'PROTAC，模态不同' },
  { name: '峰肽生物', note: '多肽，模态不同' },
  { name: '科辉智药', note: 'AI 小分子，模态不同' },
  { name: '维申医药', note: '抗病毒，模态不同' },
  { name: '奥赛康', note: '抗体，模态不同' },
];

// 竞品对但量级/阶段不可比：D=是 但 U=否
const STAGE_MISMATCH = [
  { name: 'Curium', note: '年营收 10 亿欧元级核药龙头，目标为初创，量级不可比' },
  { name: '原子高科', note: '成熟龙头/产业链合作为主，量级不可比' },
  { name: '先通医药', note: '阶段/量级不可比' },
  { name: '纽瑞特', note: '阶段/量级不可比' },
  { name: 'ITM', note: '阶段/量级不可比' },
];

async function main() {
  let inserted = 0;

  const insertPair = async ({ candName, candCredit, candSource, candRefId, isCompetitor, finalType, notes }) => {
    await db.execute(
      `INSERT INTO competitor_gold_standard_pair (
        category_4, target_source, target_ref_id, target_display_name, target_credit_code,
        candidate_source, candidate_ref_id, candidate_display_name, candidate_credit_code,
        final_is_competitor, final_type, status, notes, batch_id, F_DeleteMark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', ?, ?, 0)`,
      [
        'bio',
        TARGET.target_source,
        TARGET.target_ref_id,
        TARGET.target_display_name,
        TARGET.target_credit_code,
        candSource,
        candRefId,
        candName,
        candCredit,
        isCompetitor,
        finalType,
        notes,
        BATCH_ID,
      ]
    );
    inserted += 1;
  };

  for (const c of MISSED_COMPETITORS) {
    await insertPair({
      candName: c.name,
      candCredit: c.credit,
      candSource: c.source,
      candRefId: c.refId,
      isCompetitor: 1,
      finalType: 'direct',
      notes: c.note,
    });
  }

  for (const c of MODALITY_FALSE_POSITIVES) {
    await insertPair({
      candName: c.name,
      candCredit: null,
      candSource: null,
      candRefId: null,
      isCompetitor: 0,
      finalType: 'same_track',
      notes: `业务反馈：同赛道不同模态，不可比。${c.note}`,
    });
  }

  for (const c of STAGE_MISMATCH) {
    await insertPair({
      candName: c.name,
      candCredit: null,
      candSource: null,
      candRefId: null,
      isCompetitor: 1,
      finalType: 'indirect',
      notes: `业务反馈：竞品对但量级/阶段不可比，不应放入可比公司。${c.note}`,
    });
  }

  console.log(`[importYiliFeedbackGoldPairs] 写入 ${inserted} 条，batch=${BATCH_ID}`);
  console.log(`  漏召补竞品: ${MISSED_COMPETITORS.length}，模态负样本: ${MODALITY_FALSE_POSITIVES.length}，量级不可比: ${STAGE_MISMATCH.length}`);

  const verify = await db.query(
    `SELECT candidate_display_name, final_is_competitor, final_type FROM competitor_gold_standard_pair
     WHERE batch_id = ? AND F_DeleteMark = 0 ORDER BY F_Id`,
    [BATCH_ID]
  );
  console.log('verify:', JSON.stringify(verify, null, 2));

  await db.closePool();
}

main().catch(async (e) => {
  console.error('[importYiliFeedbackGoldPairs] 失败:', e);
  try { await db.closePool(); } catch (_) {}
  process.exit(1);
});
