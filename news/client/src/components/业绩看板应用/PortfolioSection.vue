<template>
  <div class="portfolio-section">
    <div class="section-title">投资组合</div>
    
    <!-- 各基金子基金与直投项目 -->
    <div class="portfolio-subsection">
      <div class="subsection-title">各基金子基金与直投项目</div>
      <div class="fund-table-container">
        <table class="portfolio-table">
          <thead>
            <tr>
              <th class="fixed-column">指标</th>
              <th v-for="fund in fundList" :key="fund">{{ fund }}</th>
            </tr>
          </thead>
          <tbody>
            <tr @click="handleFundClick('fundInvExit')">
              <td class="fixed-column">
                <span class="indicator-label-wrap">子基金 投/退数量<a-tooltip v-if="config.fundInvExitDesc" :content="config.fundInvExitDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
              </td>
              <td v-for="fund in fundList" :key="fund" class="clickable">
                {{ formatNumberPair(getFundData(fund, 'fund_inv'), getFundData(fund, 'fund_exit')) }}
              </td>
            </tr>
            <tr @click="handleFundClick('fundSubExit')">
              <td class="fixed-column">
                <span class="indicator-label-wrap">子基金 认缴/退出<a-tooltip v-if="config.fundSubExitDesc" :content="config.fundSubExitDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
              </td>
              <td v-for="fund in fundList" :key="fund" class="clickable">
                {{ formatAmountPair(getFundData(fund, 'fund_sub'), getFundData(fund, 'fund_exit_amount')) }}
              </td>
            </tr>
            <tr @click="handleFundClick('fundPaidinReceive')">
              <td class="fixed-column">
                <span class="indicator-label-wrap">子基金 实缴/回款<a-tooltip v-if="config.fundPaidinReceiveDesc" :content="config.fundPaidinReceiveDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
              </td>
              <td v-for="fund in fundList" :key="fund" class="clickable">
                {{ formatAmountPair(getFundData(fund, 'fund_paidin'), getFundData(fund, 'fund_receive')) }}
              </td>
            </tr>
            <tr @click="handleFundClick('projectInvExit')">
              <td class="fixed-column">
                <span v-if="config.projectInvExitDesc">
                  <a-tooltip :content="config.projectInvExitDesc">直投项目 投/退数量</a-tooltip>
                </span>
                <span v-else>直投项目 投/退数量</span>
              </td>
              <td v-for="fund in fundList" :key="fund" class="clickable">
                {{ formatNumberPair(getFundData(fund, 'project_inv'), getFundData(fund, 'project_exit')) }}
              </td>
            </tr>
            <tr @click="handleFundClick('projectPaidinReceive')">
              <td class="fixed-column">
                <span class="indicator-label-wrap">直投项目 实缴/回款<a-tooltip v-if="config.projectPaidinReceiveDesc" :content="config.projectPaidinReceiveDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
              </td>
              <td v-for="fund in fundList" :key="fund" class="clickable">
                {{ formatAmountPair(getFundData(fund, 'project_paidin'), getFundData(fund, 'project_receive')) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 整体组合 -->
    <div class="portfolio-subsection">
      <div class="subsection-title">整体组合</div>
      <div class="overall-grid" @click="$emit('overall-click')">
          <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">子基金累计投资数量<a-tooltip v-if="config.fundInvAccDesc" :content="config.fundInvAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatNumber(overall?.fund_inv) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.fund_inv_change)">
            {{ formatChange(overall?.fund_inv_change) }}
          </div>
        </div>
        <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">子基金累计认缴金额<a-tooltip v-if="config.fundSubAccDesc" :content="config.fundSubAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatAmount(overall?.fund_sub) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.fund_sub_change)">
            {{ formatChange(overall?.fund_sub_change) }}
          </div>
        </div>
        <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">子基金累计实缴金额<a-tooltip v-if="config.fundPaidinAccDesc" :content="config.fundPaidinAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatAmount(overall?.fund_paidin) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.fund_paidin_change)">
            {{ formatChange(overall?.fund_paidin_change) }}
          </div>
        </div>
        <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">子基金累计退出数量<a-tooltip v-if="config.fundExitAccDesc" :content="config.fundExitAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatNumber(overall?.fund_exit) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.fund_exit_change)">
            {{ formatChange(overall?.fund_exit_change) }}
          </div>
        </div>
        <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">子基金累计退出金额<a-tooltip v-if="config.fundExitAmountAccDesc" :content="config.fundExitAmountAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatAmount(overall?.fund_exit_amount) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.fund_exit_amount_change)">
            {{ formatChange(overall?.fund_exit_amount_change) }}
          </div>
        </div>
        <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">子基金累计回款金额<a-tooltip v-if="config.fundReceiveAccDesc" :content="config.fundReceiveAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatAmount(overall?.fund_receive) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.fund_receive_change)">
            {{ formatChange(overall?.fund_receive_change) }}
          </div>
        </div>
        <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">累计直投项目数量<a-tooltip v-if="config.projectInvAccDesc" :content="config.projectInvAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatNumber(overall?.project_inv) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.project_inv_change)">
            {{ formatChange(overall?.project_inv_change) }}
          </div>
        </div>
        <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">直投项目累计投资金额<a-tooltip v-if="config.projectPaidinAccDesc" :content="config.projectPaidinAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatAmount(overall?.project_paidin) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.project_paidin_change)">
            {{ formatChange(overall?.project_paidin_change) }}
          </div>
        </div>
        <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">直投项目累计退出数量<a-tooltip v-if="config.projectExitAccDesc" :content="config.projectExitAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatNumber(overall?.project_exit) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.project_exit_change)">
            {{ formatChange(overall?.project_exit_change) }}
          </div>
        </div>
        <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">直投项目累计退出金额<a-tooltip v-if="config.projectExitAmountAccDesc" :content="config.projectExitAmountAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatAmount(overall?.project_exit_amount) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.project_exit_amount_change)">
            {{ formatChange(overall?.project_exit_amount_change) }}
          </div>
        </div>
        <div class="overall-item clickable">
          <div class="overall-label">
            <span class="indicator-label-wrap">直投项目累计回款金额<a-tooltip v-if="config.projectReceiveAccDesc" :content="config.projectReceiveAccDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="overall-value">{{ formatAmount(overall?.project_receive) }}</div>
          <div class="overall-change" :class="getChangeClass(overall?.project_receive_change)">
            {{ formatChange(overall?.project_receive_change) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { IconInfoCircle } from '@arco-design/web-vue/es/icon';

const props = defineProps({
  funds: {
    type: Array,
    default: () => []
  },
  overall: {
    type: Object,
    default: () => null
  },
  config: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['fund-click', 'overall-click']);

// 基金列表
const fundList = computed(() => {
  return props.funds.map(f => f.fund);
});

// 获取基金数据
const getFundData = (fundName, key) => {
  const fund = props.funds.find(f => f.fund === fundName);
  return fund ? fund[key] : null;
};

// 格式化数字
const formatNumber = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return Math.round(val).toLocaleString();
};

// 格式化金额
const formatAmount = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  const billion = val / 100000000;
  return billion.toFixed(2);
};

// 格式化数字对
const formatNumberPair = (val1, val2) => {
  return `${formatNumber(val1)} / ${formatNumber(val2)}`;
};

// 格式化金额对
const formatAmountPair = (val1, val2) => {
  return `${formatAmount(val1)} / ${formatAmount(val2)}`;
};

// 格式化变动
const formatChange = (val) => {
  if (val === null || val === undefined) return '';
  if (val === 0) return '较上月末 -';
  const prefix = val > 0 ? '+' : '';
  return `较上月末 ${prefix}${formatAmount(val)}`;
};

// 获取变动样式
const getChangeClass = (val) => {
  if (val === null || val === undefined || val === 0) return '';
  return val > 0 ? 'positive' : 'negative';
};

// 处理基金点击
const handleFundClick = (type) => {
  emit('fund-click', type);
};
</script>

<style scoped>
.portfolio-section {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: #1d2129;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e6eb;
}

.portfolio-subsection {
  margin-bottom: 24px;
}

.subsection-title {
  font-size: 16px;
  font-weight: 500;
  color: #4e5969;
  margin-bottom: 12px;
}

.fund-table-container {
  overflow-x: auto;
}

.portfolio-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 800px;
}

.portfolio-table th,
.portfolio-table td {
  padding: 12px 16px;
  text-align: center;
  border-bottom: 1px solid #e5e6eb;
  white-space: nowrap;
}

.portfolio-table th {
  background: #f7f8fa;
  font-weight: 500;
  color: #4e5969;
}

.fixed-column {
  position: sticky;
  left: 0;
  background: #fff;
  font-weight: 500;
  color: #4e5969;
}

.portfolio-table th:first-child {
  background: #f7f8fa;
}

.clickable {
  cursor: pointer;
  color: #165dff;
}

.clickable:hover {
  background: #f2f3f5;
}

.overall-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}

.overall-item {
  background: #f7f8fa;
  border-radius: 6px;
  padding: 16px;
  text-align: center;
}

.overall-item.clickable {
  cursor: pointer;
  transition: background 0.3s;
}

.overall-item.clickable:hover {
  background: #e5e6eb;
}

.overall-label {
  font-size: 13px;
  color: #86909c;
  margin-bottom: 8px;
}

.overall-value {
  font-size: 20px;
  font-weight: 600;
  color: #1d2129;
  margin-bottom: 4px;
}

.overall-change {
  font-size: 12px;
  color: #86909c;
}

.overall-change.positive {
  color: #00b42a;
}

.overall-change.negative {
  color: #f53f3f;
}

.indicator-desc-icon {
  margin-left: 4px;
  vertical-align: middle;
  color: #86909c;
  font-size: 14px;
  cursor: help;
}

.indicator-desc-icon:hover {
  color: #165dff;
}
</style>
