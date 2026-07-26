'use strict';

const {
  applyInternalCap,
  looksLikeSemiDesign,
  looksLikeSemiEquipment,
  looksLikeAdvancedMfg,
  looksLikeDrugPipeline,
  defaultDiscoveryPolicy,
} = require('./baseStrategy');

function appendixForSubTrack(subTrack) {
  if (subTrack === 'semi') {
    return `# 赛道策略附录（半导体&先进制造 / semi_mfg · sub_track=semi）
- 对标侧重：chain_position、process_node、product_class、foundry_model（设计/制造/封测/设备材料）。
- **设计 vs 设备**：芯片设计 / Fabless / IP / EDA 与前道设备、光刻刻蚀装备互为上下游或异类，不得判 direct；最高 upstream_downstream / same_track，validated_score≤45。
- 同类替代：同制程节点设备互替、同产品类别（存储/逻辑/模拟）可判 direct/indirect。`;
  }
  if (subTrack === 'advanced_mfg') {
    return `# 赛道策略附录（半导体&先进制造 / semi_mfg · sub_track=advanced_mfg）
- 对标侧重：process_route、downstream_application、capacity_scale、core_equipment。
- 新能源电池设备、智能硬件整机、汽车零部件等须落在同工艺路线或同下游应用，禁止仅因「先进制造」大类判 direct。
- 与纯芯片设计（Fabless）大多不构成直接竞品。`;
  }
  return `# 赛道策略附录（半导体&先进制造 / semi_mfg）
- 合并策略：先判断 sub_track（semi / advanced_mfg）。
- semi：严控「设计 vs 设备」误报。
- advanced_mfg：严控仅因大类相同的误报；看工艺路线与下游应用。
- structured 字段按 sub_track 分支使用。`;
}

const SemiAdvancedMfgStrategy = {
  id: 'semi_mfg',
  label: '半导体&先进制造',
  category_4: 'semi_mfg',

  buildPromptAppendix({ subTrack } = {}) {
    return appendixForSubTrack(subTrack || null);
  },

  getDiscoveryPolicy() {
    return defaultDiscoveryPolicy();
  },

  adjustRuleScore({ target, cand, scores, subTrack }) {
    let next = { ...scores };
    if (looksLikeDrugPipeline(cand)) {
      next = applyInternalCap(next, 28, 'semi_mfg_vs_drug');
    }

    const tDesign = looksLikeSemiDesign(target);
    const cDesign = looksLikeSemiDesign(cand);
    const tEquip = looksLikeSemiEquipment(target);
    const cEquip = looksLikeSemiEquipment(cand);

    // 设计 vs 设备硬上限（semi 专项，§7.2 / §9.3）
    if ((tDesign && cEquip) || (tEquip && cDesign)) {
      next = applyInternalCap(next, 36, 'semi_design_vs_equipment');
    }

    if (subTrack === 'semi' && looksLikeAdvancedMfg(cand) && !cEquip && !cDesign) {
      next = applyInternalCap(next, 42, 'semi_vs_broad_mfg');
    }
    if (subTrack === 'advanced_mfg' && tEquip === false && cEquip && looksLikeSemiDesign(cand)) {
      next = applyInternalCap(next, 40, 'advanced_mfg_vs_fabless');
    }
    return next;
  },
};

module.exports = { SemiAdvancedMfgStrategy };
