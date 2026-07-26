'use strict';

const {
  applyInternalCap,
  looksLikeDrugPipeline,
  looksLikeDigitalPlatform,
  looksLikeEquipmentConsumables,
  looksLikeSemiEquipment,
  defaultDiscoveryPolicy,
} = require('./baseStrategy');

/**
 * 生物医药策略：装备耗材硬约束仅在本赛道生效（§7.4 / §8.2）
 */
const BioPharmaStrategy = {
  id: 'bio',
  label: '生物医药',
  category_4: 'bio',

  buildPromptAppendix() {
    return `# 赛道策略附录（生物医药 / bio）— 装备耗材硬约束
1. **装备/耗材 vs 创新药**：若目标为过滤/纯化/层析/一次性反应器等装备或耗材，候选为创新药管线/细胞基因治疗研发企业 → 不得判 direct/indirect/substitute；应为 not_competitor 或 same_track，validated_score≤40。
2. **装备/耗材 vs 数字化**：目标为生物工艺装备耗材，候选为医院信息化/数字化平台/纯 SaaS → 同上硬约束。
3. **装备 vs 上游大宗化工**：仅原料药中间体、大宗化学试剂且无工艺耗材 SKU 对齐 → 最高 same_track。
4. 允许：同类/可替代过滤膜、层析填料、一次性系统、纯化设备等 core_product_lines 对齐 → direct/indirect。
5. structured 对标字段（若有）：value_chain、modality、process_stage、core_skus、customer_type。`;
  },

  getDiscoveryPolicy() {
    return defaultDiscoveryPolicy();
  },

  adjustRuleScore({ target, cand, scores }) {
    let next = { ...scores };
    const targetEquip = looksLikeEquipmentConsumables(target);
    if (!targetEquip) return next;

    if (looksLikeDrugPipeline(cand)) {
      next = applyInternalCap(next, 32, 'bio_equip_vs_drug_pipeline');
    }
    if (looksLikeDigitalPlatform(cand)) {
      next = applyInternalCap(next, 32, 'bio_equip_vs_digital');
    }
    if (looksLikeSemiEquipment(cand)) {
      next = applyInternalCap(next, 28, 'bio_equip_vs_semi_tool');
    }
    return next;
  },
};

module.exports = { BioPharmaStrategy };
