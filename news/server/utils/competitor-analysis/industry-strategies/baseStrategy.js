'use strict';

/**
 * Stage 4 L3 策略公共契约
 * - buildPromptAppendix：拼入 PAIR_SIMILARITY / VALIDATE system
 * - adjustRuleScore：在通用规则分后按赛道微调 / 硬上限
 */

const { strTrim } = require('../competitorMatchUtils');

function blobOf(profile) {
  return [
    profile?.display_name,
    profile?.product_intro,
    profile?.qcc_intro_effective || profile?.qcc_intro,
    ...(profile?.tags || []),
    ...(profile?.core_product_lines || []),
  ]
    .filter(Boolean)
    .join('\n');
}

function looksLikeEquipmentConsumables(profile) {
  const blob = blobOf(profile);
  return /耗材|滤芯|膜包|填料|层析|反应器|色谱|纯化|检测试剂盒|一次性|装备|设备|仪器|器件|模组|掩模|光罩|晶圆|刻蚀|薄膜|夹具|工装/i.test(
    blob
  );
}

function looksLikeDrugPipeline(profile) {
  const blob = blobOf(profile);
  return /创新药|靶向药|ADC|抗体药|细胞治疗|基因治疗|管线|临床[I一二三]|IND|NDA|获批上市.*适应症/i.test(
    blob
  );
}

function looksLikeDigitalPlatform(profile) {
  const blob = blobOf(profile);
  return /医院信息化|HIS|电子病历|数字孪生|SaaS|企业服务平台|云计算平台|大数据平台/i.test(blob);
}

function looksLikeSemiDesign(profile) {
  const blob = blobOf(profile);
  return /芯片设计|Fabless|IP核|IP 核|EDA|架构设计|模拟芯片设计|数字芯片设计/i.test(blob);
}

function looksLikeSemiEquipment(profile) {
  const blob = blobOf(profile);
  return /光刻|刻蚀|CVD|PVD|CMP|扩散|离子注入|封装设备|测试设备|检测设备|前道|后道设备|半导体设备/i.test(
    blob
  );
}

function looksLikeAdvancedMfg(profile) {
  const blob = blobOf(profile);
  return /新能源|动力电池|智能硬件|汽车|机器人|产线|工艺装备|先进制造/i.test(blob);
}

/** 家庭 / 消费级具身整机（未来不远类） */
function looksLikeHomeEmbodiedRobot(profile) {
  const blob = blobOf(profile);
  const home =
    /家庭|家用|家务|消费级|C端|照看老幼|养老陪伴|看护|家庭管家|家庭通用/i.test(blob);
  const robot =
    /机器人|具身智能|具身|轮式.*双臂|双臂.*轮式|轮式底盘|服务机器人|通用机器人/i.test(blob);
  return home && robot;
}

/** 工业 / 工程 / B 端产线人形 */
function looksLikeIndustrialRobot(profile) {
  const blob = blobOf(profile);
  return /工业级|工业机器人|工厂|仓储|物流分拣|线束装配|工程巡检|轨道交通|水利水电|汽车工厂|精密作业|B端.*人形|人形.*工业/i.test(
    blob
  );
}

/** 纯大脑 / 世界模型 / 不造整机 */
function looksLikeEmbodiedBrainOnly(profile) {
  const blob = blobOf(profile);
  const brain =
    /具身大脑|世界模型|全身控制|whole-body|控制算法|具身大模型|物理AI|Physical Token|不造硬件|不造.*本体|通用智能控制/i.test(
      blob
    );
  const noBody = /不造硬件|不造.*本体|仅.*算法|聚焦.*大脑|为各类机器人提供/i.test(blob);
  return brain || (noBody && /机器人|具身/i.test(blob));
}

/** 融资偏晚 / 大体量信号（文本启发式，用于规则上限） */
function looksLikeLateStageOrUnicorn(profile) {
  const blob = blobOf(profile);
  return /[B-Z]轮\+|C轮|D轮|IPO|独角兽|估值.*百亿|百亿估值|累计融资.*[十百]亿|港股IPO|冲刺.*上市/i.test(
    blob
  );
}

/**
 * @param {object} baseScores ruleScoreCandidate 原始结果
 * @param {number} cap
 */
function applyInternalCap(baseScores, cap, reason) {
  const next = { ...baseScores };
  if ((next.internalScore || 0) > cap) {
    next.internalScore = cap;
    next.strategy_cap = cap;
    next.strategy_cap_reason = reason;
  }
  return next;
}

/** 默认联网发现策略：维持境内上市硬配额 */
function defaultDiscoveryPolicy() {
  return {
    relax_listed_mandate: false,
    min_domestic_listed: null,
    keyword_anchors: [],
    drop_listed_keyword_boost: false,
  };
}

module.exports = {
  strTrim,
  blobOf,
  looksLikeEquipmentConsumables,
  looksLikeDrugPipeline,
  looksLikeDigitalPlatform,
  looksLikeSemiDesign,
  looksLikeSemiEquipment,
  looksLikeAdvancedMfg,
  looksLikeHomeEmbodiedRobot,
  looksLikeIndustrialRobot,
  looksLikeEmbodiedBrainOnly,
  looksLikeLateStageOrUnicorn,
  applyInternalCap,
  defaultDiscoveryPolicy,
};
