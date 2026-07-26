'use strict';

const {
  applyInternalCap,
  blobOf,
  looksLikeDigitalPlatform,
  looksLikeEquipmentConsumables,
  defaultDiscoveryPolicy,
} = require('./baseStrategy');

/**
 * 数字智能通用策略：按「产品形态 / 服务对象 / 场景 / 技术层」同层对标。
 * Prompt 与规则只使用抽象维度，禁止细分赛道定向词表加/压分。
 */
const AiStrategy = {
  id: 'ai',
  label: '数字智能',
  category_4: 'ai',

  buildPromptAppendix() {
    return `# 赛道策略附录（数字智能 / ai）— 通用同层对标
判断时从目标画像 / structured 抽出维度，再与候选比对；**禁止**为个别项目或细分赛道硬编码专有词。

1. **产品形态（最高权重）**
   - 对齐：硬件整机 / 核心部件 / SaaS·应用 / 平台·中台 / API·模型层 / 算力·基础设施 / 数据服务 等。
   - 形态同层且可替代 → 才可 direct / indirect；形态跨层 → 最高 same_track 或 upstream_downstream，validated_score≤45。
   - **通用服务硬件 vs 单任务专用电器**：若目标为可操作/通用家庭服务整机（臂、夹爪、管家、长程家务等），候选仅为扫地/扫拖/擦窗等专用清洁电器且无操作扩展 → 形态跨层，不得 direct，validated_score≤45。

2. **服务对象**
   - 对齐：C 端 / B 端 / 开发者 / 运营商·渠道 等（以 target_customer 与画像描述为准）。
   - 服务对象明显错位且无共同采购预算 → 不得 direct。

3. **使用场景**
   - 以目标自身 product_intro / core_product_lines 中的场景为准；场景可替代才构成竞争。
   - 禁止：仅因同属宽泛行业大标签判 direct。

4. **交付与技术栈层**
   - delivery / tech_stack 须同层或可直接替换；跨层（如整机 vs 纯算法层、应用 vs 算力）多为 indirect / same_track。

5. **境内上市配额（不可取消）**
   - 联网发现须满足境内上市公司硬性至少 3 家；补足时优先「产品形态 + 服务对象」与目标最接近者，禁止为凑数将跨层公司标为 direct。

6. **未上市同形态（与上市配额并存）**
   - 在满足上市≥3 的同时，须检索与目标「产品形态 + 服务对象」同层的未上市企业；禁止只返回名声大、阶段差很多的跨层知名公司而遗漏同层对手。
   - 候选优先可核验工商全称；信息不足时下调 ai_relevance_score。

structured（若有）：primary_product、delivery、target_customer、tech_stack、scale_signals。`;
  },

  getDiscoveryPolicy() {
    return defaultDiscoveryPolicy();
  },

  adjustRuleScore({ target, cand, scores }) {
    let next = { ...scores };
    // 仅保留交付层抽象冲突上限（structured delivery / 软硬件分层）
    if (looksLikeEquipmentConsumables(target) && looksLikeDigitalPlatform(cand)) {
      next = applyInternalCap(next, 38, 'ai_delivery_layer_mismatch');
    }
    if (looksLikeDigitalPlatform(target) && looksLikeEquipmentConsumables(cand)) {
      next = applyInternalCap(next, 38, 'ai_delivery_layer_mismatch');
    }
    if (looksLikeSoftwareDelivery(target) && looksLikeHardwareDelivery(cand)) {
      next = applyInternalCap(next, 36, 'ai_delivery_layer_mismatch');
    }
    if (looksLikeHardwareDelivery(target) && looksLikeSoftwareDelivery(cand)) {
      next = applyInternalCap(next, 36, 'ai_delivery_layer_mismatch');
    }
    return next;
  },
};

function resolveDeliveryHint(profile) {
  const structured = profile?.structured_profile;
  const fromStruct = String(structured?.delivery || profile?.delivery || '').trim().toLowerCase();
  if (fromStruct) return fromStruct;
  return '';
}

function looksLikeSoftwareDelivery(profile) {
  const d = resolveDeliveryHint(profile);
  if (/saas|api|软件|订阅|平台/.test(d)) return true;
  if (looksLikeDigitalPlatform(profile)) return true;
  const blob = blobOf(profile);
  return /纯软件|SaaS|API服务|软件平台/.test(blob) && !/硬件整机|终端硬件/.test(blob);
}

function looksLikeHardwareDelivery(profile) {
  const d = resolveDeliveryHint(profile);
  if (/硬件|整机|设备|终端/.test(d)) return true;
  const blob = blobOf(profile);
  return /硬件整机|终端设备|硬件产品/.test(blob);
}

module.exports = { AiStrategy };
