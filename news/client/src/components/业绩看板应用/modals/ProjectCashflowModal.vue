<template>
  <a-modal
    v-model:visible="visible"
    :title="`${fund} - 项目现金流及业绩指标`"
    :width="1000"
    :footer="false"
    @cancel="handleClose"
  >
    <div class="modal-header">
      <span>单位：人民币</span>
      <span>数据截至日期：{{ versionDate }}</span>
      <span>版本号：{{ version }}</span>
    </div>
    
    <div class="section-title">业绩指标</div>
    <a-table :data="indicatorList" :loading="loading" :pagination="false">
      <template #columns>
        <a-table-column title="基金名称" data-index="fund" />
        <a-table-column title="投资金额/认缴" data-index="sub_amount">
          <template #cell="{ record }">{{ formatAmount(record.sub_amount) }}</template>
        </a-table-column>
        <a-table-column title="投资金额/实缴" data-index="inv_amount">
          <template #cell="{ record }">{{ formatAmount(record.inv_amount) }}</template>
        </a-table-column>
        <a-table-column title="项目分配" data-index="exit_amount">
          <template #cell="{ record }">{{ formatAmount(record.exit_amount) }}</template>
        </a-table-column>
        <a-table-column title="GIRR" data-index="girr">
          <template #cell="{ record }">{{ formatPercent(record.girr) }}</template>
        </a-table-column>
        <a-table-column title="MOC" data-index="moc">
          <template #cell="{ record }">{{ formatRatio(record.moc) }}</template>
        </a-table-column>
      </template>
    </a-table>
    
    <div class="section-title" style="margin-top: 24px;">现金流明细</div>
    <a-table :data="cashflowList" :loading="loading" :pagination="{ pageSize: 10 }">
      <template #columns>
        <a-table-column title="基金名称" data-index="fund" />
        <a-table-column title="SPV" data-index="spv" />
        <a-table-column title="子基金名称" data-index="sub_fund" />
        <a-table-column title="被投企业" data-index="company" />
        <a-table-column title="交易类型" data-index="transaction_type" />
        <a-table-column title="交易时间" data-index="transaction_date" />
        <a-table-column title="交易金额" data-index="transaction_amount">
          <template #cell="{ record }">{{ formatAmount(record.transaction_amount) }}</template>
        </a-table-column>
      </template>
    </a-table>
    
    <div class="modal-footer">
      <a-button type="primary" @click="handleExport">
        <template #icon><icon-download /></template>
        导出底稿
      </a-button>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { Message } from '@arco-design/web-vue';
import { IconDownload } from '@arco-design/web-vue/es/icon';
import { dashboardApi, exportApi } from '../../../api/业绩看板应用';

const props = defineProps({ visible: Boolean, version: String, fund: String });
const emit = defineEmits(['update:visible']);

const loading = ref(false);
const indicatorList = ref([]);
const cashflowList = ref([]);

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

const versionDate = computed(() => {
  if (!props.version) return '';
  const d = props.version.substring(0, 8);
  return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
});

const loadData = async () => {
  if (!props.version || !props.fund) return;
  loading.value = true;
  try {
    const res = await dashboardApi.getProjectCashflow(props.version, props.fund);
    if (res.success) {
      indicatorList.value = res.data.indicator ? [res.data.indicator] : [];
      cashflowList.value = res.data.cashflow || [];
    }
  } catch (error) {
    console.error('加载失败:', error);
  } finally {
    loading.value = false;
  }
};

const formatAmount = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return (val / 100000000).toFixed(2);
};
const formatPercent = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return (val * 100).toFixed(2) + '%';
};
const formatRatio = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return val.toFixed(2) + 'x';
};

const handleExport = async () => {
  try {
    const blob = await exportApi.exportProjectCashflow(props.version, props.fund);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    link.download = `${props.version}-${props.fund}-项目现金流及业绩指标-${date}.xlsx`;
    link.click();
    window.URL.revokeObjectURL(url);
    Message.success('导出成功');
  } catch (error) {
    Message.error('导出失败');
  }
};

const handleClose = () => { visible.value = false; };

watch(() => props.visible, (val) => { if (val) loadData(); });
</script>

<style scoped>
.modal-header {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: #f7f8fa;
  border-radius: 4px;
  color: #4e5969;
  font-size: 14px;
}
.section-title {
  font-size: 16px;
  font-weight: 500;
  color: #1d2129;
  margin-bottom: 12px;
}
.modal-footer {
  margin-top: 16px;
  text-align: right;
}
</style>
