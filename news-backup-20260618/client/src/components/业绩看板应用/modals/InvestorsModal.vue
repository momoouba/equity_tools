<template>
  <a-modal
    v-model:visible="visible"
    :title="`${fund} - 投资人名录`"
    :width="1250"
    :footer="false"
    :body-style="modalBodyStyle"
    class="investors-modal"
    @cancel="handleClose"
  >
    <div class="investors-modal-wrap">
      <div class="modal-header modal-header-with-action">
        <span>单位：人民币元</span>
        <span>数据截至日期：{{ versionDate }}</span>
        <span>版本号：{{ version }}</span>
        <a-button type="primary" class="modal-header-btn" @click="handleExport">
          <template #icon><icon-download /></template>
          导出底稿
        </a-button>
      </div>
      <div v-if="loading" class="investors-loading"><a-spin /></div>
      <div v-else class="investors-scroll">
        <table class="investors-table">
          <thead>
            <tr class="investors-thead-row1">
              <th rowspan="2" class="th-nowrap col-index">序号</th>
              <th rowspan="2" class="th-nowrap col-fund">基金名称</th>
              <th rowspan="2" class="th-nowrap col-lp-type">合伙人类型</th>
              <th rowspan="2" class="th-lp">投资人名称</th>
              <th rowspan="2" class="th-nowrap col-num">认缴金额</th>
              <th rowspan="2" class="th-nowrap col-num">认缴比例</th>
              <th rowspan="2" class="th-nowrap col-num">累计实缴金额</th>
              <th rowspan="2" class="th-nowrap col-num">累计分配金额</th>
              <th colspan="3" class="th-nowrap col-num">最近三次分配</th>
            </tr>
            <tr class="investors-thead-row2">
              <th class="th-nowrap th-date">{{ dateHeader1 || '-' }}</th>
              <th class="th-nowrap th-date">{{ dateHeader2 || '-' }}</th>
              <th class="th-nowrap th-date">{{ dateHeader3 || '-' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in tableData" :key="i">
              <td class="td-nowrap col-index">{{ i + 1 }}</td>
              <td class="td-nowrap col-fund" :title="(row.fund || fund)">{{ row.fund || fund }}</td>
              <td class="td-lp-type">{{ row.lp_type }}</td>
              <td class="td-lp" :title="row.lp">{{ row.lp }}</td>
              <td class="td-num">{{ formatAmountYuan(row.subscription_amount) }}</td>
              <td class="td-num">{{ formatPercentRatio(row.subscription_ratio) }}</td>
              <td class="td-num">{{ formatAmountYuan(row.paidin) }}</td>
              <td class="td-num">{{ formatAmountYuan(row.distribution) }}</td>
              <td class="td-num">{{ formatAmountYuan(row.first_amount) }}</td>
              <td class="td-num">{{ formatAmountYuan(row.second_amount) }}</td>
              <td class="td-num">{{ formatAmountYuan(row.third_amount) }}</td>
            </tr>
          </tbody>
          <tfoot v-if="tableData.length">
            <tr class="summary-row">
              <td class="col-index">合计</td>
              <td class="col-fund">-</td>
              <td class="td-lp-type">-</td>
              <td class="td-lp">-</td>
              <td class="td-num">{{ formatAmountYuan(totals.subscription_amount) }}</td>
              <td class="td-num">-</td>
              <td class="td-num">{{ formatAmountYuan(totals.paidin) }}</td>
              <td class="td-num">{{ formatAmountYuan(totals.distribution) }}</td>
              <td class="td-num">{{ formatAmountYuan(totals.first_amount) }}</td>
              <td class="td-num">{{ formatAmountYuan(totals.second_amount) }}</td>
              <td class="td-num">{{ formatAmountYuan(totals.third_amount) }}</td>
            </tr>
          </tfoot>
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
const tableData = ref([]);

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

const formatDateOnly = (v) => {
  if (v == null || v === '') return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return s;
};

const dateHeader1 = computed(() => formatDateOnly(tableData.value[0]?.first_date));
const dateHeader2 = computed(() => formatDateOnly(tableData.value[0]?.second_date));
const dateHeader3 = computed(() => formatDateOnly(tableData.value[0]?.third_date));

const formatAmountYuan = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return Number(val).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatPercentRatio = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return (Number(val) * 100).toFixed(2) + '%';
};

const toNum = (v) => (v === null || v === undefined ? null : Number(v));

const totals = computed(() => {
  const list = tableData.value;
  const sum = {
    subscription_amount: 0,
    paidin: 0,
    distribution: 0,
    first_amount: 0,
    second_amount: 0,
    third_amount: 0
  };
  list.forEach((r) => {
    sum.subscription_amount += toNum(r.subscription_amount) || 0;
    sum.paidin += toNum(r.paidin) || 0;
    sum.distribution += toNum(r.distribution) || 0;
    sum.first_amount += toNum(r.first_amount) || 0;
    sum.second_amount += toNum(r.second_amount) || 0;
    sum.third_amount += toNum(r.third_amount) || 0;
  });
  return sum;
});

const loadData = async () => {
  if (!props.version || !props.fund) return;
  tableData.value = [];
  loading.value = true;
  try {
    const res = await dashboardApi.getInvestors(props.version, props.fund);
    tableData.value = res?.data?.list ?? [];
  } catch (error) {
    console.error('加载投资人名录失败:', error);
    Message.error('加载数据失败');
    tableData.value = [];
  } finally {
    loading.value = false;
  }
};

const handleExport = async () => {
  try {
    const blob = await exportApi.exportInvestors(props.version, props.fund);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    link.download = `${props.version}-${props.fund}-投资人名录-${date}.xlsx`;
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
.investors-modal :deep(.arco-modal) {
  max-height: 75vh;
}
.investors-modal :deep(.arco-modal-body) {
  padding-bottom: 0;
}

.investors-modal-wrap {
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

.investors-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}

/* 列表区域固定高度：约 9 行数据 + 表头 2 行 + 合计 1 行，超出显示右侧滚动条 */
.investors-scroll {
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

.investors-table {
  width: 100%;
  min-width: 1600px;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
}

.investors-table th,
.investors-table td {
  padding: 10px 12px;
  border: 1px solid #e5e6eb;
  text-align: left;
  box-sizing: border-box;
}

.investors-table th {
  background: #f7f8fa;
  font-weight: 500;
  color: #4e5969;
  text-align: center;
}

.investors-table .th-nowrap {
  white-space: nowrap;
}
.investors-table .th-wrap {
  white-space: normal;
}
/* 基金名称：最多一行 8 个汉字，超出省略 */
.investors-table .col-fund {
  width: 8em;
  max-width: 8em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 基金名称：最多一行 8 个汉字，超出省略 */
.investors-table .col-fund {
  width: 8em;
  max-width: 8em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 合伙人类型：完整显示 5 个汉字（如“有限合伙人”），在原基础上加宽约 20% */
.investors-table .col-lp-type {
  width: 9em;
  min-width: 9em;
  white-space: nowrap;
}
/* 投资人名称及其他字段：能显示全内容，超出可横向滚动；投资人名称列最小宽度并省略 */
.investors-table .th-lp,
.investors-table .td-lp {
  min-width: 20em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  box-sizing: border-box;
}
.investors-table .td-num {
  min-width: 11em;
  text-align: right;
}
.investors-table .td-nowrap {
  white-space: nowrap;
}
.investors-table .td-wrap {
  white-space: normal;
  word-break: break-word;
}

/* 表头固定：第一行吸顶，第二行（三次分配日期）紧贴第一行下方 */
.investors-table thead th {
  position: sticky;
  z-index: 2;
  background: #f7f8fa;
  box-shadow: 0 1px 0 #e5e6eb;
  height: 33px;
  min-height: 33px;
  vertical-align: middle;
  padding: 6px 10px;
}
.investors-table thead tr:first-child th {
  top: 0;
}
.investors-table thead tr:nth-child(2) th {
  top: 33px;
}

/* 内容行行高较表头减少约 20%（35px ≈ 44px×0.8），表头保持 44px */
.investors-table tbody tr {
  height: 35px;
}
.investors-table tbody td {
  height: 35px;
  min-height: 35px;
  vertical-align: middle;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.investors-table tbody td.td-num {
  white-space: nowrap;
}
.investors-table tfoot tr td {
  height: 35px;
  min-height: 35px;
  vertical-align: middle;
}

.investors-table tfoot tr {
  position: sticky;
  bottom: 0;
  z-index: 2;
}

.investors-table tfoot td {
  background: #165dff !important;
  color: #fff !important;
  font-weight: 500;
  border-color: #165dff !important;
}

/* 合计行单行显示 */
.investors-table tfoot tr.summary-row {
  white-space: nowrap;
}

.investors-table .summary-row td.td-num {
  text-align: right;
}

/* 合计行文字列左对齐 */
.investors-table .summary-row td:first-child,
.investors-table .summary-row td:nth-child(2),
.investors-table .summary-row td:nth-child(3),
.investors-table .summary-row td:nth-child(4) {
  text-align: left;
}

/* 数据行文字列左对齐（序号、基金名称、合伙人类型、投资人名称） */
.investors-table tbody td:nth-child(1),
.investors-table tbody td:nth-child(2),
.investors-table tbody td:nth-child(3),
.investors-table tbody td:nth-child(4) {
  text-align: left;
}

.investors-table .col-index {
  width: 48px;
  min-width: 48px;
  max-width: 48px;
  box-sizing: border-box;
}
</style>
