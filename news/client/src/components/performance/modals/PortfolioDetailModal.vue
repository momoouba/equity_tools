<template>
  <a-modal
    v-model:visible="visible"
    title="整体基金投资组合明细"
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
      <div class="portfolio-detail-scroll">
        <table class="portfolio-detail-table">
          <colgroup>
            <col style="width: 48px" />
            <col style="width: 90px" />
            <col style="width: 160px" />
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
            <!-- 子基金明细 -->
            <tr v-for="(row, idx) in subFundRows" :key="'sub-' + idx">
              <td class="col-index">{{ idx + 1 }}</td>
              <td class="col-type">{{ row.transaction_type || '-' }}</td>
              <td class="col-project">{{ row.project || '-' }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.acc_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.change_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.acc_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.change_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.acc_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.change_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.acc_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.change_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.unrealized) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.change_unrealized) }}</td>
              <td class="td-num col-total-value">{{ formatAmount(row.total_value) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(row.moc) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(row.dpi) }}</td>
              <td class="td-num col-ratio">{{ formatPercentRatio(row.irr) }}</td>
            </tr>
            <tr v-if="subFundRows.length > 0" class="row-summary">
              <td class="col-index" colspan="2">小计（子基金）</td>
              <td>子基金个数：{{ subFundRows.length }} 个</td>
              <td class="td-num col-amount">{{ formatAmount(subFundSum.acc_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmount(subFundSum.change_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmount(subFundSum.acc_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmount(subFundSum.change_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmount(subFundSum.acc_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmount(subFundSum.change_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmount(subFundSum.acc_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmount(subFundSum.change_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmount(subFundSum.unrealized) }}</td>
              <td class="td-num col-amount">{{ formatAmount(subFundSum.change_unrealized) }}</td>
              <td class="td-num col-total-value">{{ formatAmount(subFundSum.total_value) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(subFundSum.moc) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(subFundSum.dpi) }}</td>
              <td class="td-num col-ratio">-</td>
            </tr>
            <!-- 直投项目明细 -->
            <tr v-for="(row, idx) in directRows" :key="'dir-' + idx">
              <td class="col-index">{{ subFundRows.length + idx + 1 }}</td>
              <td class="col-type">{{ row.transaction_type || '-' }}</td>
              <td class="col-project">{{ row.project || '-' }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.acc_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.change_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.acc_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.change_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.acc_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.change_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.acc_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.change_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.unrealized) }}</td>
              <td class="td-num col-amount">{{ formatAmount(row.change_unrealized) }}</td>
              <td class="td-num col-total-value">{{ formatAmount(row.total_value) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(row.moc) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(row.dpi) }}</td>
              <td class="td-num col-ratio">{{ formatPercentRatio(row.irr) }}</td>
            </tr>
            <tr v-if="directRows.length > 0" class="row-summary">
              <td class="col-index" colspan="2">小计（直投项目）</td>
              <td>直投项目个数：{{ directRows.length }} 个</td>
              <td class="td-num col-amount">{{ formatAmount(directSum.acc_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmount(directSum.change_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmount(directSum.acc_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmount(directSum.change_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmount(directSum.acc_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmount(directSum.change_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmount(directSum.acc_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmount(directSum.change_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmount(directSum.unrealized) }}</td>
              <td class="td-num col-amount">{{ formatAmount(directSum.change_unrealized) }}</td>
              <td class="td-num col-total-value">{{ formatAmount(directSum.total_value) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(directSum.moc) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(directSum.dpi) }}</td>
              <td class="td-num col-ratio">-</td>
            </tr>
          </tbody>
          <!-- 合计（吸底） -->
          <tfoot v-if="tableData.length > 0">
            <tr class="row-summary row-total">
              <td class="col-index" colspan="2">合计</td>
              <td>总项目个数：{{ tableData.length }} 个</td>
              <td class="td-num col-amount">{{ formatAmount(allSum.acc_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmount(allSum.change_sub) }}</td>
              <td class="td-num col-amount">{{ formatAmount(allSum.acc_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmount(allSum.change_paidin) }}</td>
              <td class="td-num col-amount">{{ formatAmount(allSum.acc_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmount(allSum.change_exit) }}</td>
              <td class="td-num col-amount">{{ formatAmount(allSum.acc_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmount(allSum.change_receive) }}</td>
              <td class="td-num col-amount">{{ formatAmount(allSum.unrealized) }}</td>
              <td class="td-num col-amount">{{ formatAmount(allSum.change_unrealized) }}</td>
              <td class="td-num col-total-value">{{ formatAmount(allSum.total_value) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(allSum.moc) }}</td>
              <td class="td-num col-ratio">{{ formatRatio(allSum.dpi) }}</td>
              <td class="td-num col-ratio">-</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </a-spin>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { dashboardApi } from '../../../api/performance';

const props = defineProps({ visible: Boolean, version: String });
const emit = defineEmits(['update:visible']);

const loading = ref(false);
const tableData = ref([]);

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

const versionDate = computed(() => {
  if (!props.version) return '';
  const d = props.version.substring(0, 8);
  return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
});

const subFundRows = computed(() =>
  (tableData.value || []).filter(r => r.transaction_type === '子基金')
);
const directRows = computed(() =>
  (tableData.value || []).filter(r => r.transaction_type === '直投项目')
);

function toNum(v) {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumGroup(rows) {
  const sum = {
    acc_sub: 0,
    change_sub: 0,
    acc_paidin: 0,
    change_paidin: 0,
    acc_exit: 0,
    change_exit: 0,
    acc_receive: 0,
    change_receive: 0,
    unrealized: 0,
    change_unrealized: 0,
    total_value: 0
  };
  rows.forEach((r) => {
    sum.acc_sub += toNum(r.acc_sub);
    sum.change_sub += toNum(r.change_sub);
    sum.acc_paidin += toNum(r.acc_paidin);
    sum.change_paidin += toNum(r.change_paidin);
    sum.acc_exit += toNum(r.acc_exit);
    sum.change_exit += toNum(r.change_exit);
    sum.acc_receive += toNum(r.acc_receive);
    sum.change_receive += toNum(r.change_receive);
    sum.unrealized += toNum(r.unrealized);
    sum.change_unrealized += toNum(r.change_unrealized);
    sum.total_value += toNum(r.total_value);
  });
  const moc = sum.acc_paidin ? sum.total_value / sum.acc_paidin : null;
  const dpi = sum.acc_paidin ? sum.acc_receive / sum.acc_paidin : null;
  return { ...sum, moc, dpi };
}

const subFundSum = computed(() => sumGroup(subFundRows.value));
const directSum = computed(() => sumGroup(directRows.value));
const allSum = computed(() => {
  const s = sumGroup(tableData.value || []);
  s.moc = s.acc_paidin ? s.total_value / s.acc_paidin : null;
  s.dpi = s.acc_paidin ? s.acc_receive / s.acc_paidin : null;
  return s;
});

const loadData = async () => {
  if (!props.version) return;
  loading.value = true;
  try {
    const res = await dashboardApi.getPortfolioDetail(props.version);
    if (res.success) {
      tableData.value = res.data.list || [];
    }
  } catch (error) {
    console.error('加载失败:', error);
    tableData.value = [];
  } finally {
    loading.value = false;
  }
};

const formatAmount = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return (val / 100000000).toFixed(2);
};

const formatRatio = (val) => {
  if (val === null || val === undefined) return '-';
  return Number(val).toFixed(2) + 'x';
};

const formatPercentRatio = (val) => {
  if (val === null || val === undefined) return '/';
  const n = Number(val);
  if (n === 0) return '-';
  return (n * 100).toFixed(2) + '%';
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
.portfolio-detail-scroll {
  overflow-x: auto;
  max-height: 60vh;
  overflow-y: auto;
}

.portfolio-detail-table {
  width: 1768px;
  min-width: 1768px;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
}

.portfolio-detail-table th,
.portfolio-detail-table td {
  white-space: nowrap;
  padding: 6px 12px;
  line-height: 1.35;
  border: 1px solid #e5e6eb;
  text-align: left;
}

.portfolio-detail-table thead th {
  background: #f5f7fa;
  font-weight: 500;
}

.portfolio-detail-table .td-num {
  text-align: right;
}

.portfolio-detail-table .col-index {
  min-width: 48px;
  width: 48px;
  max-width: 48px;
  text-align: center;
}

.portfolio-detail-table .col-type {
  min-width: 90px;
  width: 90px;
}

.portfolio-detail-table .col-project {
  min-width: 160px;
  width: 160px;
}

.portfolio-detail-table .col-amount,
.portfolio-detail-table .col-total-value {
  min-width: 120px;
  width: 120px;
  max-width: 120px;
}

.portfolio-detail-table .col-ratio {
  min-width: 75px;
  width: 75px;
  max-width: 75px;
}

.portfolio-detail-table .row-summary td {
  background: #f7f8fa;
  font-weight: 500;
}

/* 合计行（tfoot）蓝色背景 */
.portfolio-detail-table tfoot .row-summary td {
  background: #1AA8E9;
  color: #fff;
}

/* sticky thead */
.portfolio-detail-scroll .portfolio-detail-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f5f7fa;
}
.portfolio-detail-scroll .portfolio-detail-table thead tr:first-child th {
  top: 0;
}
.portfolio-detail-scroll .portfolio-detail-table thead tr:nth-child(2) th {
  top: 38px;
}

/* 前3列横向滚动时固定 */
.portfolio-detail-scroll .portfolio-detail-table th.col-index,
.portfolio-detail-scroll .portfolio-detail-table td.col-index {
  position: sticky; left: 0; z-index: 1; background: #fff;
}
.portfolio-detail-scroll .portfolio-detail-table th.col-type,
.portfolio-detail-scroll .portfolio-detail-table td.col-type {
  position: sticky; left: 48px; z-index: 1; background: #fff;
}
.portfolio-detail-scroll .portfolio-detail-table th.col-project,
.portfolio-detail-scroll .portfolio-detail-table td.col-project {
  position: sticky; left: 138px; z-index: 1; background: #fff;
}

/* thead 冻结列 z-index 更高 */
.portfolio-detail-scroll .portfolio-detail-table thead th.col-index,
.portfolio-detail-scroll .portfolio-detail-table thead th.col-type,
.portfolio-detail-scroll .portfolio-detail-table thead th.col-project {
  z-index: 3; background: #f5f7fa;
}

/* 小计行（tbody）冻结列背景 */
.portfolio-detail-scroll .portfolio-detail-table tbody .row-summary td.col-index,
.portfolio-detail-scroll .portfolio-detail-table tbody .row-summary td.col-project {
  background: #f7f8fa;
}

/* 冻结列右侧阴影 */
.portfolio-detail-scroll .portfolio-detail-table td.col-project::after,
.portfolio-detail-scroll .portfolio-detail-table th.col-project::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0; right: -6px;
  width: 6px;
  background: linear-gradient(to right, rgba(0, 0, 0, 0.06), transparent);
}

/* 合计行（tfoot）吸底 */
.portfolio-detail-scroll .portfolio-detail-table tfoot td {
  position: sticky;
  bottom: 0;
  z-index: 2;
  background: #1AA8E9;
  color: #fff;
  font-weight: 500;
}
/* tfoot 冻结列：同时吸底+吸左 */
.portfolio-detail-scroll .portfolio-detail-table tfoot td.col-index {
  left: 0;
  z-index: 4;
}
.portfolio-detail-scroll .portfolio-detail-table tfoot td.col-type {
  left: 48px;
  z-index: 4;
}
.portfolio-detail-scroll .portfolio-detail-table tfoot td.col-project {
  left: 138px;
  z-index: 4;
}
</style>
