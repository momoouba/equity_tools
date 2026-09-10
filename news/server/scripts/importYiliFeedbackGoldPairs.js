'use strict';

/**
 * 已停用：生产金标 = 用户勾选「放入可比公司」，由竞品分析召回读取 comparable_pref / relation。
 * 不要再向 competitor_gold_standard_pair 人工导入批次。
 *
 * 用法（news 目录）：node server/scripts/importYiliFeedbackGoldPairs.js
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
  console.error(
    '[importYiliFeedbackGoldPairs] 已停用：生产金标只来自用户勾选「放入可比公司」，禁止向 competitor_gold_standard_pair 人工导入批次。'
  );
  process.exit(1);
}

main().catch(async (e) => {
  console.error('[importYiliFeedbackGoldPairs] 失败:', e);
  try { await db.closePool(); } catch (_) {}
  process.exit(1);
});
