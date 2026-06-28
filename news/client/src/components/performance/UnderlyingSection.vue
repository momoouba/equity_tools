<template>
  <div class="underlying-section">
    <div class="section-title">底层资产</div>
    
    <!-- 累计组合 -->
    <div class="underlying-subsection">
      <div class="subsection-title">累计组合</div>
      <div class="underlying-grid">
        <div class="underlying-item clickable" @click="$emit('companies-click', 'cumulative')">
          <div class="underlying-label">
            <span class="indicator-label-wrap">底层资产/数量<a-tooltip v-if="config.projectNumADesc" :content="config.projectNumADesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="underlying-value">{{ formatNumber(cumulative?.project_num_a) }}</div>
        </div>
        <div class="underlying-item clickable" @click="$emit('companies-click', 'cumulative')">
          <div class="underlying-label">
            <span class="indicator-label-wrap">底层资产/金额<a-tooltip v-if="config.totalAmountADesc" :content="config.totalAmountADesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="underlying-value">{{ formatAmount(cumulative?.total_amount_a) }}</div>
        </div>
        <div class="underlying-item clickable" @click="$emit('ipo-click', 'cumulative')">
          <div class="underlying-label">
            <span class="indicator-label-wrap">上市企业<a-tooltip v-if="config.ipoNumADesc" :content="config.ipoNumADesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="underlying-value">{{ formatNumber(cumulative?.ipo_num_a) }}</div>
        </div>
        <div class="underlying-item clickable" @click="$emit('region-click', 'cumulative')">
          <div class="underlying-label">
            <span class="indicator-label-wrap">上海地区企业<a-tooltip v-if="config.shNumADesc" :content="config.shNumADesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="underlying-value">{{ formatNumber(cumulative?.sh_num_a) }}</div>
        </div>
      </div>
    </div>

    <!-- 当前组合 -->
    <div class="underlying-subsection">
      <div class="subsection-title">当前组合</div>
      <div class="underlying-grid">
        <div class="underlying-item clickable" @click="$emit('companies-click', 'current')">
          <div class="underlying-label">
            <span class="indicator-label-wrap">底层资产/数量<a-tooltip v-if="config.projectNumDesc" :content="config.projectNumDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="underlying-value">{{ formatNumber(current?.project_num) }}</div>
        </div>
        <div class="underlying-item clickable" @click="$emit('companies-click', 'current')">
          <div class="underlying-label">
            <span class="indicator-label-wrap">底层资产/金额<a-tooltip v-if="config.totalAmountDesc" :content="config.totalAmountDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="underlying-value">{{ formatAmount(current?.total_amount) }}</div>
        </div>
        <div class="underlying-item clickable" @click="$emit('ipo-click', 'current')">
          <div class="underlying-label">
            <span class="indicator-label-wrap">上市企业<a-tooltip v-if="config.ipoNumDesc" :content="config.ipoNumDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="underlying-value">{{ formatNumber(current?.ipo_num) }}</div>
        </div>
        <div class="underlying-item clickable" @click="$emit('region-click', 'current')">
          <div class="underlying-label">
            <span class="indicator-label-wrap">上海地区企业<a-tooltip v-if="config.shNumDesc" :content="config.shNumDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
          </div>
          <div class="underlying-value">{{ formatNumber(current?.sh_num) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { IconInfoCircle } from '@arco-design/web-vue/es/icon';

defineProps({
  cumulative: {
    type: Object,
    default: () => null
  },
  current: {
    type: Object,
    default: () => null
  },
  config: {
    type: Object,
    default: () => ({})
  }
});

defineEmits(['companies-click', 'ipo-click', 'region-click']);

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
</script>

<style scoped>
.underlying-section {
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

.underlying-subsection {
  margin-bottom: 24px;
}

.underlying-subsection:last-child {
  margin-bottom: 0;
}

.subsection-title {
  font-size: 16px;
  font-weight: 500;
  color: #4e5969;
  margin-bottom: 12px;
}

.underlying-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.underlying-item {
  background: #f7f8fa;
  border-radius: 6px;
  padding: 20px;
  text-align: center;
}

.underlying-item.clickable {
  cursor: pointer;
  transition: background 0.3s;
}

.underlying-item.clickable:hover {
  background: #e5e6eb;
}

.underlying-label {
  font-size: 14px;
  color: #86909c;
  margin-bottom: 12px;
}

.underlying-value {
  font-size: 28px;
  font-weight: 600;
  color: #1d2129;
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
