<template>
  <div class="manager-indicator" @click="$emit('click')">
    <div class="indicator-grid">
      <div class="indicator-item">
        <div class="indicator-label">
          <span class="indicator-label-wrap">母基金数量<a-tooltip v-if="config?.fofNumDesc" :content="config.fofNumDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
        </div>
        <div class="indicator-value">{{ formatNumber(data.fofNum) }}</div>
      </div>
      <div class="indicator-item">
        <div class="indicator-label">
          <span class="indicator-label-wrap">直投基金数量<a-tooltip v-if="config?.directNumDesc" :content="config.directNumDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
        </div>
        <div class="indicator-value">{{ formatNumber(data.directNum) }}</div>
      </div>
      <div class="indicator-item">
        <div class="indicator-label">
          <span class="indicator-label-wrap">认缴管理规模<a-tooltip v-if="config?.subAmountDesc" :content="config.subAmountDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
        </div>
        <div class="indicator-value indicator-value-red">{{ formatAmount(data.subAmount) }}</div>
      </div>
      <div class="indicator-item">
        <div class="indicator-label">较上年度增加</div>
        <div class="indicator-value" :class="{ 'positive': data.subAdd > 0, 'negative': data.subAdd < 0 }">
          {{ formatAmount(data.subAdd) }}
        </div>
      </div>
      <div class="indicator-item">
        <div class="indicator-label">
          <span class="indicator-label-wrap">实缴管理规模<a-tooltip v-if="config?.paidInAmountDesc" :content="config.paidInAmountDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
        </div>
        <div class="indicator-value indicator-value-red">{{ formatAmount(data.paidInAmount) }}</div>
      </div>
      <div class="indicator-item">
        <div class="indicator-label">较上年度增加</div>
        <div class="indicator-value" :class="{ 'positive': data.paidInAdd > 0, 'negative': data.paidInAdd < 0 }">
          {{ formatAmount(data.paidInAdd) }}
        </div>
      </div>
      <div class="indicator-item">
        <div class="indicator-label">
          <span class="indicator-label-wrap">累计分配总额<a-tooltip v-if="config?.disAmountDesc" :content="config.disAmountDesc"><icon-info-circle class="indicator-desc-icon" /></a-tooltip></span>
        </div>
        <div class="indicator-value indicator-value-red">{{ formatAmount(data.disAmount) }}</div>
      </div>
      <div class="indicator-item">
        <div class="indicator-label">较上年度增加</div>
        <div class="indicator-value" :class="{ 'positive': data.disAdd > 0, 'negative': data.disAdd < 0 }">
          {{ formatAmount(data.disAdd) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { IconInfoCircle } from '@arco-design/web-vue/es/icon';

defineProps({
  data: {
    type: Object,
    default: () => ({})
  },
  config: {
    type: Object,
    default: () => ({})
  }
});

defineEmits(['click']);

// 格式化数字（整数）
const formatNumber = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return Math.round(val).toLocaleString();
};

// 格式化金额（转换为亿，保留2位小数）
const formatAmount = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  const billion = val / 100000000;
  return billion.toFixed(2);
};
</script>

<style scoped>
.manager-indicator {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: box-shadow 0.3s;
}

.manager-indicator:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.indicator-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.indicator-item {
  text-align: center;
  padding: 16px;
  background: #f7f8fa;
  border-radius: 6px;
}

.indicator-label {
  font-size: 14px;
  color: #86909c;
  margin-bottom: 8px;
}

.indicator-value {
  font-size: 24px;
  font-weight: 600;
  color: #1d2129;
}

.indicator-value.positive {
  color: #00b42a;
}

.indicator-value.negative {
  color: #f53f3f;
}

.indicator-value-red {
  color: #f53f3f;
}

.indicator-label-wrap {
  display: inline-block;
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
