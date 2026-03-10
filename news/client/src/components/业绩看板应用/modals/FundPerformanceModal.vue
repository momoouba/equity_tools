<template>
  <a-modal
    v-model:visible="visible"
    :title="`${fund} - 基金业绩指标及现金流底表`"
    :width="1125"
    :footer="false"
    :body-style="modalBodyStyle"
    class="fundperf-modal"
    @cancel="handleClose"
  >
    <div class="fundperf-wrap">
      <div class="modal-header modal-header-with-action">
        <span>单位：人民币元</span>
        <span>数据截至日期：{{ versionDate }}</span>
        <span>版本号：{{ version }}</span>
        <a-button type="primary" class="modal-header-btn" @click="handleExport">
          <template #icon><icon-download /></template>
          导出底稿
        </a-button>
      </div>
      <div v-if="loading" class="fundperf-loading"><a-spin /></div>
      <div v-else class="fundperf-scroll">
        <div class="fundperf-sticky">
          <div class="section-title">基金业绩指标</div>
          <table class="fundperf-table">
            <thead>
              <tr>
                <th class="col-index">序号</th>
              <th>基金名称</th>
              <th>投资人认缴</th>
              <th>投资人实缴</th>
              <th>投资人分配</th>
              <th>TVPI</th>
              <th>DPI</th>
              <th>RVPI</th>
              <th>NIRR</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in indicatorList" :key="'ind-' + i">
              <td class="col-index">{{ i + 1 }}</td>
              <td>{{ row.fund }}</td>
              <td class="td-num">{{ formatAmountYuan(row.lp_sub) }}</td>
              <td class="td-num">{{ formatAmountYuan(row.paidin) }}</td>
              <td class="td-num">{{ formatAmountYuan(row.distribution) }}</td>
              <td class="td-num">{{ formatRatio(row.tvpi) }}</td>
              <td class="td-num">{{ formatRatio(row.dpi) }}</td>
              <td class="td-num">{{ formatRatio(row.rvpi) }}</td>
              <td class="td-num">{{ formatPercent(row.nirr) }}</td>
            </tr>
          </tbody>
        </table>
        </div>
        <div class="section-title">数据明细表</div>
        <table class="fundperf-table fundperf-table-cashflow">
          <thead>
            <tr>
              <th class="col-index">序号</th>
              <th>基金名称</th>
              <th class="th-lp">投资人名称</th>
              <th class="td-center">交易类型</th>
              <th>交易时间</th>
              <th>交易金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in cashflowList" :key="'cash-' + i">
              <td class="col-index">{{ i + 1 }}</td>
              <td>{{ row.fund }}</td>
              <td class="td-lp" :title="row.lp">{{ row.lp }}</td>
              <td class="td-center">{{ row.transaction_type }}</td>
              <td>{{ formatDate(row.transaction_date) }}</td>
              <td class="td-num">{{ formatAmountYuan(row.transaction_amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { Message } from '@arco-design/web-vue';
import { IconDownload } from '@arco-design/web-vue/es/icon';
import { dashboardApi, exportApi } from '../../../api/业绩看板应用';

const props = defineProps({
  visible: Boolean,
  version: String,
  fund: String
});

const emit = defineEmits(['update:visible']);

const loading = ref(false);
const indicatorList = ref([]);
const cashflowList = ref([]);

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

const modalBodyStyle = {
  maxHeight: 'calc(75vh - 56px)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  paddingBottom: 0
};

const versionDate = computed(() => {
  if (!props.version) return '';
  const dateStr = props.version.substring(0, 8);
  return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
});

const formatAmountYuan = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return Number(val).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatRatio = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return Number(val).toFixed(2) + 'x';
};

const formatPercent = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return (Number(val) * 100).toFixed(2) + '%';
};

const formatDate = (v) => {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return s;
};

const loadData = async () => {
  if (!props.version || !props.fund) return;
  indicatorList.value = [];
  cashflowList.value = [];
  loading.value = true;
  try {
    const res = await dashboardApi.getFundPerformance(props.version, props.fund);
    indicatorList.value = res?.data?.indicator ?? [];
    cashflowList.value = res?.data?.cashflow ?? [];
  } catch (error) {
    console.error('加载基金业绩指标失败:', error);
    Message.error('加载数据失败');
  } finally {
    loading.value = false;
  }
};

const handleExport = async () => {
  try {
    const blob = await exportApi.exportFundPerformance(props.version, props.fund);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    link.download = `${props.version}-${props.fund}-基金业绩指标及现金流底表-${date}.xlsx`;
    link.click();
    window.URL.revokeObjectURL(url);
    Message.success('导出成功');
  } catch (error) {
    console.error('导出失败:', error);
    Message.error('导出失败');
  }
};

const handleClose = () => {
  visible.value = false;
};

watch(
  () => [props.visible, props.version, props.fund],
  ([val]) => {
    if (val) loadData();
  }
);
</script>

<style scoped>
.fundperf-modal :deep(.arco-modal-body) {
  padding-bottom: 0;
}

.fundperf-wrap {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.modal-header {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: #f7f8fa;
  border-radius: 4px;
  color: #4e5969;
  font-size: 14px;
  flex-shrink: 0;
}

.modal-header-with-action {
  align-items: center;
  flex-wrap: wrap;
}

.modal-header-btn {
  margin-left: auto;
}

.fundperf-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}

.fundperf-scroll {
  flex: 0 0 auto;
  min-height: 0;
  max-height: 500px;
  overflow-x: auto;
  overflow-y: auto;
  margin: 0 -16px;
  padding: 0 16px;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 4px;
}

.section-title {
  font-size: 15px;
  font-weight: 500;
  color: #1d2129;
  margin: 16px 0 8px 0;
}

.section-title:first-of-type {
  margin-top: 0;
}

.fundperf-scroll .fundperf-sticky {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #fff;
  padding-bottom: 8px;
  margin-bottom: 4px;
}

.fundperf-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.fundperf-table th,
.fundperf-table td {
  padding: 10px 12px;
  border: 1px solid #e5e6eb;
  text-align: left;
}

.fundperf-table th {
  background: #f7f8fa;
  font-weight: 500;
  color: #4e5969;
  text-align: center;
}

/* 数据明细表：表头在滚动时固定在业绩指标表下方 */
.fundperf-table-cashflow thead th {
  position: sticky;
  top: 200px;
  z-index: 1;
  background: #f7f8fa;
  box-shadow: 0 1px 0 0 #e5e6eb;
}

.fundperf-table .col-index {
  width: 48px;
  min-width: 48px;
  max-width: 48px;
  box-sizing: border-box;
  white-space: nowrap;
}

.fundperf-table th.td-center,
.fundperf-table td.td-center {
  text-align: center;
}

.fundperf-table .td-num {
  text-align: right;
}

.fundperf-table .th-lp,
.fundperf-table .td-lp {
  width: 20em;
  min-width: 20em;
  max-width: 20em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-sizing: border-box;
}
</style>
