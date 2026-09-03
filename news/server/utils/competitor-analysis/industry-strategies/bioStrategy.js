'use strict';

const {
  applyInternalCap,
  looksLikeDrugPipeline,
  looksLikeDigitalPlatform,
  looksLikeEquipmentConsumables,
  looksLikeSemiEquipment,
  looksLikeRadiopharma,
  looksLikeNonRadiopharmaModality,
  looksLikeNuclearSupplyOrService,
  looksLikeLateStageOrUnicorn,
  defaultDiscoveryPolicy,
} = require('./baseStrategy');

/**
 * 生物医药策略：装备耗材硬约束仅在本赛道生效（§7.4 / §8.2）
 * 核药模态门：目标为放射性药物/核素偶联时，非同位素模态候选不得判竞品（0824 亦立反馈）
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
5. structured 对标字段（若有）：value_chain、modality、process_stage、core_skus、customer_type。

# 核药模态门（目标为放射性药物/核素偶联时强制执行）
6. **模态对齐**：目标主营为核药/放射性药物/核素偶联（RDC）/诊疗一体化时，候选模态为小分子、抗体/ADC、CAR-T/细胞基因治疗、多肽、PROTAC、AI 制药、疫苗、抗病毒等非核素路线 → competitor_type 最高 same_track，validated_score≤45，不得判 direct/indirect/substitute。
7. **同为核药不得因适应症否决模态**：双方均为核药/RDC/放射性药物/PET显像剂时 modality_match=true；肿瘤 vs 神经退行/阿尔茨海默等适应症或靶点差异只写入 key_differences，不得判模态不一致，不得因此丢掉同赛道核药同行。
8. **产业链位置**：候选主业为同位素/核素生产供应、放射源、核医学影像服务、核药房、纯代加工（无自研核药管线）→ upstream_downstream，is_competitor=false，不放入可比公司。
9. **量级/阶段**：候选为成熟商业化龙头（年营收数亿欧元级/上市多年/商业化产品矩阵）而目标为早期初创 → 即使同为核药赛道，stage_comparable=false，不放入可比公司（可判 indirect）。`;
  },

  getDiscoveryPolicy({ target } = {}) {
    const base = defaultDiscoveryPolicy();
    // 目标为核药时注入模态锚点，联网检索强制带核素路线关键词，补漏召
    if (looksLikeRadiopharma(target)) {
      return {
        ...base,
        keyword_anchors: [
          '放射性药物',
          '核药',
          '核素偶联药物',
          'RDC 放射性配体',
          '诊疗一体化核药',
          'α核素',
          'PET显像剂',
          '未上市核药',
          '镥-177',
          '同位素药物初创',
        ],
        drop_listed_keyword_boost: true,
      };
    }
    return base;
  },

  adjustRuleScore({ target, cand, scores }) {
    let next = { ...scores };
    const targetEquip = looksLikeEquipmentConsumables(target);

    if (targetEquip) {
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
    }

    // 核药模态门：目标核药 × 候选非同位素模态 → 规则分封顶
    if (looksLikeRadiopharma(target)) {
      if (looksLikeNonRadiopharmaModality(cand)) {
        next = applyInternalCap(next, 30, 'bio_radiopharma_vs_other_modality');
      } else if (looksLikeNuclearSupplyOrService(cand)) {
        next = applyInternalCap(next, 35, 'bio_radiopharma_vs_supply_chain');
      }
      // 核药目标 × 成熟核药龙头：保留赛道相关性但压低规则分，交由校验判阶段不可比
      if (looksLikeLateStageOrUnicorn(cand) && !looksLikeRadiopharma(cand)) {
        next = applyInternalCap(next, 40, 'bio_radiopharma_vs_mature_other');
      }
    }
    return next;
  },
};

module.exports = { BioPharmaStrategy };
