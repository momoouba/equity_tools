<template>
  <a-modal
    v-model:visible="visible"
    :title="`${fund} - 基金投资组合明细`"
    :width="1200"
    :footer="false"
    @cancel="handleClose"
  >
    <div class="modal-header">
      <span>单位：人民币元</span>
      <span>数据截至日期：{{ versionDate }}</span>
      <span>版本号：{{ version }}</span>
    </div>
    <a-spin :loading="loading" style="width: 100%">
      <!-- 单一滚动容器：横向+纵向，单表+sticky thead 确保列对齐和固定列 -->
      <div class="fp-scroll">
        <table class="fund-portfolio-table fp-table">
          <colgroup>
            <col style="width: 48px" />
            <col style="width: 90px" />
            <col style="width: 160px" />
            <col style="width: 120px" />
            <col style="width: 120px" /><col style="width: 120px" />
            <col style="width: 120px" /><col style="width: 120px" />
            <col style="width: 120px" /><col style="width: 120px" />
            <col style="width: 120px" /><col style="width: 120px" />
            <col style="width: 120px" /><col style="width: 120px" />
            <col style="width: 120px" />
            <col style="width: 75px" /><col style="width: 75px" /><col style="width: 75px" />
          </colgroup>
          <thead>
            <tr>
              <th class="col-index" rowspan="2">序号</th>
              <th class="col-type" rowspan="2">投资类别</th>
              <th class="col-project" rowspan="2">项目名称</th>
              <th class="col-date" rowspan="2">投资时间</th>
              <th colspan="2" class="col-amount">认缴金额</th>
              <th colspan="2" class="col-amount">实缴金额</th>
              <th colspan="2" class="col-amount">退出金额</th>
              <th colspan="2" class="col-amount">回款金额</th>
              <th colspan="2" class="col-amount">未实现价值</th>
              <th rowspan="2" class="col-total-value">总价值</th>
              <th rowspan="2" class="col-ratio">MOC</th>
              <th rowspan="2" class="col-ratio">DPI</th>
              <th rowspan="2" class="col-ratio">IRR</th>
            </tr>
            <tr>
              <th class="col-amount">累计值</th>
              <th class="col-amount">本月变动</th>
              <th class="col-amount">累计值</th>
              <th class="col-amount">本月变动</th>
              <th class="col-amount">累计值</th>
              <th class="col-amount">本月变动</th>
              <th class="col-amount">累计值</th>
              <th class="col-amount">本月变动</th>
              <th class="col-amount">累计值</th>
              <th class="col-amount">本月变动</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in subFundRows" :key="'sf-' + idx">
              <td class="col-index">{{ idx + 1 }}</td>
              <td class="col-type">{{ row.transaction_type || '-' }}</td>
              <td class="col-project">{{ row.project || '-' }}</td>
              <td class="col-date">{{ row.first_date ? String(row.first_date).substring(0, 10) : '' }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.acc_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.change_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.acc_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.change_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.acc_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.change_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.acc_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.change_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.unrealized) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.change_unrealized) }}</td>
              <td class="td-num col-total-value">{{ formatAmountYuan(row.total_value) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(row.moc) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(row.dpi) }}</td>
              <td class="td-num col-ratio">{{ formatPercentRatio(row.irr) }}</td>
            </tr>
            <tr v-if="subFundRows.length > 0" class="summary-row">
              <td class="col-index">小计</td>
              <td class="col-type">（子基金）</td>
              <td class="col-project">{{ `子基金个数：${subFundRows.length} 个` }}</td>
              <td class="col-date" />
              <td class="td-num col-amount">{{ formatAmountYuan(subFundSum.acc_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(subFundSum.change_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(subFundSum.acc_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(subFundSum.change_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(subFundSum.acc_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(subFundSum.change_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(subFundSum.acc_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(subFundSum.change_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(subFundSum.unrealized) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(subFundSum.change_unrealized) }}</td>
              <td class="td-num col-total-value">{{ formatAmountYuan(subFundSum.total_value) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(subFundSum.moc) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(subFundSum.dpi) }}</td>
              <td class="td-num col-ratio">-</td>
            </tr>
          </tbody>
          <tbody>
            <tr v-for="(row, idx) in directRows" :key="'dr-' + idx">
              <td class="col-index">{{ subFundRows.length + idx + 1 }}</td>
              <td class="col-type">{{ row.transaction_type || '-' }}</td>
              <td class="col-project">{{ row.project || '-' }}</td>
              <td class="col-date">{{ row.first_date ? String(row.first_date).substring(0, 10) : '' }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.acc_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.change_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.acc_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.change_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.acc_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.change_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.acc_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.change_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.unrealized) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(row.change_unrealized) }}</td>
              <td class="td-num col-total-value">{{ formatAmountYuan(row.total_value) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(row.moc) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(row.dpi) }}</td>
              <td class="td-num col-ratio">{{ formatPercentRatio(row.irr) }}</td>
            </tr>
            <tr v-if="directRows.length > 0" class="summary-row">
              <td class="col-index">小计</td>
              <td class="col-type">（直投项目）</td>
              <td class="col-project">{{ `直投项目个数：${directRows.length} 个` }}</td>
              <td class="col-date" />
              <td class="td-num col-amount">{{ formatAmountYuan(directSum.acc_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(directSum.change_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(directSum.acc_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(directSum.change_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(directSum.acc_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(directSum.change_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(directSum.acc_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(directSum.change_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(directSum.unrealized) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(directSum.change_unrealized) }}</td>
              <td class="td-num col-total-value">{{ formatAmountYuan(directSum.total_value) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(directSum.moc) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(directSum.dpi) }}</td>
              <td class="td-num col-ratio">-</td>
            </tr>
          </tbody>
          <tbody v-if="tableData.length > 0">
            <tr class="summary-row">
              <td class="col-index">合计</td>
              <td class="col-type"></td>
              <td class="col-project">{{ `总项目个数：${tableData.length} 个` }}</td>
              <td class="col-date" />
              <td class="td-num col-amount">{{ formatAmountYuan(allSum.acc_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(allSum.change_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(allSum.acc_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(allSum.change_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(allSum.acc_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(allSum.change_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(allSum.acc_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(allSum.change_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(allSum.unrealized) }}</td>
              <td class="td-num col-amount">{{ formatAmountYuan(allSum.change_unrealized) }}</td>
              <td class="td-num col-total-value">{{ formatAmountYuan(allSum.total_value) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(allSum.moc) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(allSum.dpi) }}</td>
              <td class="td-num col-ratio">-</td>
            </tr>
          </tbody>
        </table>
      </div>
    </a-spin>
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
import { dashboardApi, exportApi } from '../../../api/performance';

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

const versionDate = computed(() => {
  if (!props.version) return '';
  const dateStr = props.version.substring(0, 8);
  return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
});

const toNum = (v) => (v === null || v === undefined ? 0 : Number(v) || 0);

const subFundRows = computed(() => tableData.value.filter(r => r.transaction_type === '子基金'));
const directRows = computed(() => tableData.value.filter(r => r.transaction_type === '直投项目'));

const calcSum = (rows) => {
  const s = { acc_sub: 0, change_sub: 0, acc_paidin: 0, change_paidin: 0, acc_exit: 0, change_exit: 0, acc_receive: 0, change_receive: 0, unrealized: 0, change_unrealized: 0, total_value: 0 };
  rows.forEach(r => {
    s.acc_sub += toNum(r.acc_sub); s.change_sub += toNum(r.change_sub);
    s.acc_paidin += toNum(r.acc_paidin); s.change_paidin += toNum(r.change_paidin);
    s.acc_exit += toNum(r.acc_exit); s.change_exit += toNum(r.change_exit);
    s.acc_receive += toNum(r.acc_receive); s.change_receive += toNum(r.change_receive);
    s.unrealized += toNum(r.unrealized); s.change_unrealized += toNum(r.change_unrealized);
    s.total_value += toNum(r.total_value);
  });
  s.moc = s.acc_paidin ? s.total_value / s.acc_paidin : null;
  s.dpi = s.acc_paidin ? s.acc_receive / s.acc_paidin : null;
  return s;
};

const subFundSum = computed(() => calcSum(subFundRows.value));
const directSum = computed(() => calcSum(directRows.value));
const allSum = computed(() => calcSum(tableData.value));

const loadData = async () => {
  if (!props.version || !props.fund) return;
  loading.value = true;
  try {
    const res = await dashboardApi.getFundPortfolio(props.version, props.fund);
    if (res.success) {
      tableData.value = res.data.list || [];
    }
  } catch (error) {
    console.error('加载数据失败:', error);
  } finally {
    loading.value = false;
  }
};

const formatAmountYuan = (val) => {
  if (val === null || val === undefined) return '/';
  const n = Number(val);
  if (n === 0) return '-';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatRatio = (val) => {
  if (val === null || val === undefined) return '-';
  return Number(val).toFixed(4) + 'x';
};

const formatPercentRatio = (val) => {
  if (val === null || val === undefined) return '/';
  const n = Number(val);
  if (n === 0) return '-';
  return (n * 100).toFixed(2) + '%';
};

const handleExport = async () => {
  try {
    const blob = await exportApi.exportFundPortfolio(props.version, props.fund);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    link.download = `${props.version}-${props.fund}-基金投资组合明细-${date}.xlsx`;
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

watch(() => props.visible, (val) => {
  if (val) loadData();
});
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

.modal-footer {
  margin-top: 16px;
  text-align: right;
}

/* 单一滚动容器：横向+纵向 */
.fp-scroll {
  max-height: 70vh;
  overflow: auto;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 4px;
}

/* 单表宽度由 colgroup 决定，不被父容器压缩 */
.fp-table {
  width: max-content !important;
  min-width: 100%;
}

.fund-portfolio-table {
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
}

.fund-portfolio-table th,
.fund-portfolio-table td {
  white-space: nowrap;
  padding: 6px 12px;
  line-height: 1.35;
  border: 1px solid #e5e6eb;
  text-align: left;
}

.fund-portfolio-table thead th {
  background: #f5f7fa;
  font-weight: 500;
  text-align: center;
}

.fund-portfolio-table .td-num {
  text-align: right;
}

.fund-portfolio-table .summary-row td {
  background: #1AA8E9;
  color: #fff;
  font-weight: 500;
}

/* sticky thead：固定在滚动区域顶部 */
.fp-scroll .fp-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f5f7fa;
}
.fp-scroll .fp-table thead tr:first-child th {
  top: 0;
}
.fp-scroll .fp-table thead tr:nth-child(2) th {
  top: 38px;
}

/* 列宽 */
.fund-portfolio-table .col-index {
  min-width: 48px; width: 48px; max-width: 48px; text-align: center;
}
.fund-portfolio-table .col-type {
  min-width: 90px; width: 90px; max-width: 90px;
}
.fund-portfolio-table .col-project {
  min-width: 160px; width: 160px; max-width: 160px;
}
.fund-portfolio-table .col-date {
  min-width: 120px; width: 120px; max-width: 120px;
}
.fund-portfolio-table .col-amount,
.fund-portfolio-table .col-total-value {
  min-width: 120px; width: 120px; max-width: 120px;
}
.fund-portfolio-table .col-ratio {
  min-width: 75px; width: 75px; max-width: 75px;
}

/* 前4列横向滚动时固定 */
.fp-scroll .fp-table th.col-index,
.fp-scroll .fp-table td.col-index {
  position: sticky; left: 0; z-index: 1; background: #fff;
}
.fp-scroll .fp-table th.col-type,
.fp-scroll .fp-table td.col-type {
  position: sticky; left: 48px; z-index: 1; background: #fff;
}
.fp-scroll .fp-table th.col-project,
.fp-scroll .fp-table td.col-project {
  position: sticky; left: 138px; z-index: 1; background: #fff;
}
.fp-scroll .fp-table th.col-date,
.fp-scroll .fp-table td.col-date {
  position: sticky; left: 298px; z-index: 1; background: #fff;
}

/* thead 冻结列 z-index 更高 */
.fp-scroll .fp-table thead th.col-index,
.fp-scroll .fp-table thead th.col-type,
.fp-scroll .fp-table thead th.col-project,
.fp-scroll .fp-table thead th.col-date {
  z-index: 3; background: #f5f7fa;
}

/* 合计/小计行冻结列蓝色背景 */
.fp-scroll .fp-table .summary-row td.col-index,
.fp-scroll .fp-table .summary-row td.col-type,
.fp-scroll .fp-table .summary-row td.col-project,
.fp-scroll .fp-table .summary-row td.col-date {
  background: #1AA8E9; color: #fff;
}

/* 冻结列右侧阴影 */
.fp-scroll .fp-table td.col-date::after,
.fp-scroll .fp-table th.col-date::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0; right: -6px;
  width: 6px;
  background: linear-gradient(to right, rgba(0, 0, 0, 0.06), transparent);
}
</style>
