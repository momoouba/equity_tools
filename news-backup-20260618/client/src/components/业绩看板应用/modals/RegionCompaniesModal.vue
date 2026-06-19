<template>
  <a-modal
    v-model:visible="visible"
    :title="`区域企业明细【${type === 'cumulative' ? '累计' : '当前'}】`"
    :width="1125"
    :footer="false"
    :body-style="{ height: 'calc(75vh - 56px)', maxHeight: 'calc(75vh - 56px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingBottom: 0, minHeight: 0 }"
    @cancel="handleClose"
  >
    <div class="modal-header">
      <div class="modal-header-left">
        <span>单位：人民币亿元</span>
        <span>数据截至日期：{{ versionDate }}</span>
        <span>版本号：{{ version }}</span>
      </div>
      <a v-if="redirectUrl" :href="redirectUrl" target="_blank" rel="noopener noreferrer" class="detail-report-link">详细报表</a>
    </div>
    <div class="region-scroll">
      <table class="region-table">
        <colgroup>
          <col style="width: 48px" />
          <col style="width: 200px" />
          <col style="width: 80px" /><col style="width: 100px" />
          <col style="width: 80px" /><col style="width: 100px" />
          <col style="width: 80px" /><col style="width: 100px" />
        </colgroup>
        <thead>
          <tr>
            <th class="col-index" rowspan="2">序号</th>
            <th class="col-fund" rowspan="2">所属基金名称</th>
            <th colspan="2" class="col-group">长三角地区企业</th>
            <th colspan="2" class="col-group">上海地区企业</th>
            <th colspan="2" class="col-group">浦东地区企业</th>
          </tr>
          <tr>
            <th class="col-amount">数量</th>
            <th class="col-amount">金额</th>
            <th class="col-amount">数量</th>
            <th class="col-amount">金额</th>
            <th class="col-amount">数量</th>
            <th class="col-amount">金额</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in tableData" :key="i">
            <td class="col-index">{{ i + 1 }}</td>
            <td class="col-fund">{{ row.fund }}</td>
            <td class="col-amount td-num">{{ row.csj_num }}</td>
            <td class="col-amount td-num">{{ formatAmount(row.csj_amount) }}</td>
            <td class="col-amount td-num">{{ row.sh_num }}</td>
            <td class="col-amount td-num">{{ formatAmount(row.sh_amount) }}</td>
            <td class="col-amount td-num">{{ row.pd_num }}</td>
            <td class="col-amount td-num">{{ formatAmount(row.pd_amount) }}</td>
          </tr>
          <tr v-if="sumTotal" class="summary-row">
            <td class="col-index" colspan="2">合计</td>
            <td class="col-amount td-num">{{ sumTotal.csj_num }}</td>
            <td class="col-amount td-num">{{ formatAmount(sumTotal.csj_amount) }}</td>
            <td class="col-amount td-num">{{ sumTotal.sh_num }}</td>
            <td class="col-amount td-num">{{ formatAmount(sumTotal.sh_amount) }}</td>
            <td class="col-amount td-num">{{ sumTotal.pd_num }}</td>
            <td class="col-amount td-num">{{ formatAmount(sumTotal.pd_amount) }}</td>
          </tr>
          <tr v-if="totalDedup" class="summary-row">
            <td class="col-index" colspan="2">合计(去重)</td>
            <td class="col-amount td-num">{{ totalDedup.csj_num }}</td>
            <td class="col-amount td-num">{{ formatAmount(totalDedup.csj_amount) }}</td>
            <td class="col-amount td-num">{{ totalDedup.sh_num }}</td>
            <td class="col-amount td-num">{{ formatAmount(totalDedup.sh_amount) }}</td>
            <td class="col-amount td-num">{{ totalDedup.pd_num }}</td>
            <td class="col-amount td-num">{{ formatAmount(totalDedup.pd_amount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { dashboardApi, configApi } from '../../../api/业绩看板应用';

const props = defineProps({
  visible: Boolean,
  version: String,
  type: { type: String, default: 'cumulative' }
});
const emit = defineEmits(['update:visible']);

const loading = ref(false);
const tableData = ref([]);
const totalDedup = ref(null);
const redirectUrl = ref('');

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

const sumTotal = computed(() => {
  const list = tableData.value;
  if (!list.length) return null;
  return list.reduce((acc, row) => ({
    csj_num: (acc.csj_num || 0) + (Number(row.csj_num) || 0),
    csj_amount: (acc.csj_amount || 0) + (Number(row.csj_amount) || 0),
    sh_num: (acc.sh_num || 0) + (Number(row.sh_num) || 0),
    sh_amount: (acc.sh_amount || 0) + (Number(row.sh_amount) || 0),
    pd_num: (acc.pd_num || 0) + (Number(row.pd_num) || 0),
    pd_amount: (acc.pd_amount || 0) + (Number(row.pd_amount) || 0)
  }), {});
});

const versionDate = computed(() => {
  if (!props.version) return '';
  const d = props.version.substring(0, 8);
  return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
});

const loadData = async () => {
  if (!props.version) return;
  loading.value = true;
  try {
    const [res, configRes] = await Promise.all([
      dashboardApi.getRegionCompanies(props.version, props.type),
      configApi.getIndicators()
    ]);
    if (res.success && res.data) {
      tableData.value = res.data.list || [];
      totalDedup.value = res.data.summary?.totalDedup || null;
    }
    if (configRes.success && configRes.data) redirectUrl.value = configRes.data.redirectUrl || '';
  } catch (error) {
    console.error('加载失败:', error);
    tableData.value = [];
    totalDedup.value = null;
  } finally {
    loading.value = false;
  }
};

const formatAmount = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return (val / 100000000).toFixed(2);
};

const handleClose = () => { visible.value = false; };

watch(() => props.visible, (val) => { if (val) loadData(); });
</script>

<style scoped>
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  flex-shrink: 0;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: #f7f8fa;
  border-radius: 4px;
  color: #4e5969;
  font-size: 14px;
}
.modal-header-left {
  display: flex;
  gap: 24px;
}
.detail-report-link {
  color: #165dff;
  font-size: 14px;
  flex-shrink: 0;
}
.detail-report-link:hover {
  color: #4080ff;
}

.region-scroll {
  flex: 0 0 auto;
  min-height: 0;
  max-height: 500px;
  overflow-x: auto;
  overflow-y: auto;
  border: 1px solid #e5e6eb;
  border-radius: 4px;
}

.region-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.region-table th,
.region-table td {
  padding: 6px 10px;
  border: 1px solid #e5e6eb;
  box-sizing: border-box;
}
.region-table th {
  background: #f7f8fa;
  font-weight: 500;
  color: #4e5969;
}
.region-table .col-index {
  width: 48px;
  text-align: center;
}
.region-table .col-group {
  text-align: center;
}
.region-table .col-amount,
.region-table .td-num {
  text-align: right;
}

.summary-row td {
  background: #165dff;
  color: #fff;
  font-weight: 500;
  border: 1px solid rgba(255, 255, 255, 0.5);
}

</style>
