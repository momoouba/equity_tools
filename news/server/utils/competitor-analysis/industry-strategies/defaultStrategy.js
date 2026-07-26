'use strict';

const { defaultDiscoveryPolicy } = require('./baseStrategy');

const DefaultStrategy = {
  id: 'other',
  label: '其他',
  category_4: 'other',

  buildPromptAppendix() {
    return `# 赛道策略附录（other / 默认）
- 使用通用规则：以 core_product_lines / product_intro 对齐为主，禁止仅因大行业相同判 direct。
- 本赛道暂不做专项硬约束扩展。`;
  },

  getDiscoveryPolicy() {
    return defaultDiscoveryPolicy();
  },

  adjustRuleScore({ scores }) {
    return scores;
  },
};

module.exports = { DefaultStrategy };
