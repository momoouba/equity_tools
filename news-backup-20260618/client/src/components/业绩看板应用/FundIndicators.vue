<template>
  <div class="fund-indicators">
    <div class="section-title">基金产品</div>
    <div class="fund-table-container">
      <table class="fund-table">
        <thead>
          <tr>
            <th class="fixed-column">指标</th>
            <th v-for="fund in funds" :key="fund">{{ fund }}</th>
          </tr>
        </thead>
        <tbody>
          <tr @click="handleInvestorClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">投资人认缴<a-tooltip v-if="config?.lpSubDesc" :content="config.lpSubDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatAmount(getIndicator(fund, 'lp_sub')) }}
            </td>
          </tr>
          <tr @click="handleInvestorClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">投资人实缴<a-tooltip v-if="config?.paidinDesc" :content="config.paidinDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatAmount(getIndicator(fund, 'paidin')) }}
            </td>
          </tr>
          <tr @click="handleInvestorClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">投资人分配<a-tooltip v-if="config?.distributionDesc" :content="config.distributionDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatAmount(getIndicator(fund, 'distribution')) }}
            </td>
          </tr>
          <tr @click="handlePerformanceClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">TVPI<a-tooltip v-if="config?.tvpiDesc" :content="config.tvpiDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatRatio(getIndicator(fund, 'tvpi')) }}
            </td>
          </tr>
          <tr @click="handlePerformanceClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">DPI<a-tooltip v-if="config?.dpiDesc" :content="config.dpiDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatRatio(getIndicator(fund, 'dpi')) }}
            </td>
          </tr>
          <tr @click="handlePerformanceClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">RVPI<a-tooltip v-if="config?.rvpiDesc" :content="config.rvpiDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatRatio(getIndicator(fund, 'rvpi')) }}
            </td>
          </tr>
          <tr @click="handlePerformanceClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">NIRR<a-tooltip v-if="config?.nirrDesc" :content="config.nirrDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatPercent(getIndicator(fund, 'nirr')) }}
            </td>
          </tr>
          <tr @click="handlePortfolioClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">投资金额/认缴<a-tooltip v-if="config?.subAmountInvDesc" :content="config.subAmountInvDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatAmount(getIndicator(fund, 'sub_amount')) }}
            </td>
          </tr>
          <tr @click="handlePortfolioClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">投资金额/实缴<a-tooltip v-if="config?.invAmountDesc" :content="config.invAmountDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatAmount(getIndicator(fund, 'inv_amount')) }}
            </td>
          </tr>
          <tr @click="handlePortfolioClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">退出金额<a-tooltip v-if="config?.exitAmountDesc" :content="config.exitAmountDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatAmount(getIndicator(fund, 'exit_amount')) }}
            </td>
          </tr>
          <tr @click="handleCashflowClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">GIRR<a-tooltip v-if="config?.girrDesc" :content="config.girrDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatPercent(getIndicator(fund, 'girr')) }}
            </td>
          </tr>
          <tr @click="handleCashflowClick">
            <td class="fixed-column">
              <span class="indicator-label-wrap">MOC<a-tooltip v-if="config?.mocDesc" :content="config.mocDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
            </td>
            <td v-for="fund in funds" :key="fund" class="clickable">
              {{ formatRatio(getIndicator(fund, 'moc')) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { IconInfoCircle } from '@arco-design/web-vue/es/icon';

const props = defineProps({
  funds: {
    type: Array,
    default: () => []
  },
  indicators: {
    type: Object,
    default: () => ({})
  },
  config: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits([
  'investor-click',
  'performance-click',
  'portfolio-click',
  'cashflow-click'
]);

// 获取指标值
const getIndicator = (fund, key) => {
  const indicator = props.indicators[fund];
  return indicator ? indicator[key] : null;
};

// 格式化金额
const formatAmount = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  const billion = val / 100000000;
  return billion.toFixed(2);
};

// 格式化比例（TVPI/DPI/RVPI/MOC后加x）
const formatRatio = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return val.toFixed(2) + 'x';
};

// 格式化百分比（NIRR/GIRR保留2位小数）
const formatPercent = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return (val * 100).toFixed(2) + '%';
};

// 处理点击事件
const handleInvestorClick = (event) => {
  const cell = event.target.closest('td');
  if (cell && cell.cellIndex > 0) {
    const fund = props.funds[cell.cellIndex - 1];
    emit('investor-click', fund);
  }
};

const handlePerformanceClick = (event) => {
  const cell = event.target.closest('td');
  if (cell && cell.cellIndex > 0) {
    const fund = props.funds[cell.cellIndex - 1];
    emit('performance-click', fund);
  }
};

const handlePortfolioClick = (event) => {
  const cell = event.target.closest('td');
  if (cell && cell.cellIndex > 0) {
    const fund = props.funds[cell.cellIndex - 1];
    emit('portfolio-click', fund);
  }
};

const handleCashflowClick = (event) => {
  const cell = event.target.closest('td');
  if (cell && cell.cellIndex > 0) {
    const fund = props.funds[cell.cellIndex - 1];
    emit('cashflow-click', fund);
  }
};
</script>

<style scoped>
.fund-indicators {
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

.fund-table-container {
  overflow-x: auto;
}

.fund-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 800px;
}

.fund-table th,
.fund-table td {
  padding: 12px 16px;
  text-align: center;
  border-bottom: 1px solid #e5e6eb;
  white-space: nowrap;
}

.fund-table th {
  background: #f7f8fa;
  font-weight: 500;
  color: #4e5969;
  position: sticky;
  top: 0;
}

.fund-table th:first-child,
.fund-table td:first-child {
  position: sticky;
  left: 0;
  background: #fff;
  z-index: 1;
}

.fund-table th:first-child {
  background: #f7f8fa;
  z-index: 2;
}

.fixed-column {
  font-weight: 500;
  color: #4e5969;
  background: #fff;
}

.clickable {
  cursor: pointer;
  color: #165dff;
}

.clickable:hover {
  background: #f2f3f5;
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
