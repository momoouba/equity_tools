<template>
  <a-modal
    v-model:visible="visible"
    :title="`底层企业明细【${type === 'cumulative' ? '累计' : '当前'}】`"
    :width="1125"
    :footer="false"
    :body-style="{ maxHeight: 'calc(75vh - 56px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingBottom: 0 }"
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
    <a-spin :loading="loading" style="width: 100%; flex: 1; min-height: 0; display: flex; flex-direction: column">
      <div class="underlying-scroll">
        <table class="underlying-table">
          <colgroup>
            <col style="width: 48px" />
            <col style="width: 200px" />
            <col style="width: 100px" /><col style="width: 100px" /><col style="width: 110px" /><col style="width: 110px" />
            <col style="width: 100px" /><col style="width: 110px" />
          </colgroup>
          <thead>
            <tr>
              <th class="col-index" rowspan="2">序号</th>
              <th class="col-fund" rowspan="2">所属基金名称</th>
              <th colspan="4" class="col-group">底层项目</th>
              <th colspan="2" class="col-group">上市企业</th>
            </tr>
            <tr>
              <th class="col-amount">项目数量</th>
              <th class="col-amount">企业数量</th>
              <th class="col-amount">投资金额</th>
              <th class="col-amount">穿透金额</th>
              <th class="col-amount">数量</th>
              <th class="col-amount">穿透金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in tableData" :key="idx">
              <td class="col-index">{{ idx + 1 }}</td>
              <td class="col-fund">{{ row.fund }}</td>
              <td class="col-amount">{{ row.project_num }}</td>
              <td class="col-amount">{{ row.company_num }}</td>
              <td class="col-amount">{{ formatAmount(row.total_amount) }}</td>
              <td class="col-amount">{{ formatAmount(row.project_amount) }}</td>
              <td class="col-amount">{{ row.ipo_num }}</td>
              <td class="col-amount">{{ formatAmount(row.ipo_amount) }}</td>
            </tr>
            <tr v-if="tableData.length > 0" class="row-summary">
              <td class="col-index" colspan="2">合计</td>
              <td class="col-amount">{{ sumTotal.project_num }}</td>
              <td class="col-amount">{{ sumTotal.company_num }}</td>
              <td class="col-amount">{{ formatAmount(sumTotal.total_amount) }}</td>
              <td class="col-amount">{{ formatAmount(sumTotal.project_amount) }}</td>
              <td class="col-amount">{{ sumTotal.ipo_num }}</td>
              <td class="col-amount">{{ formatAmount(sumTotal.ipo_amount) }}</td>
            </tr>
            <tr v-if="tableData.length > 0 && sumDedup" class="row-summary">
              <td class="col-index" colspan="2">合计(去重)</td>
              <td class="col-amount">{{ sumDedup.project_num }}</td>
              <td class="col-amount">{{ sumDedup.company_num }}</td>
              <td class="col-amount">{{ formatAmount(sumDedup.total_amount) }}</td>
              <td class="col-amount">{{ formatAmount(sumDedup.project_amount) }}</td>
              <td class="col-amount">{{ sumDedup.ipo_num }}</td>
              <td class="col-amount">{{ formatAmount(sumDedup.ipo_amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </a-spin>
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
const redirectUrl = ref('');
const sumDedup = ref(null);

const sumTotal = computed(() => {
  const list = tableData.value;
  if (!list.length) return null;
  return list.reduce((acc, r) => ({
    project_num: (acc.project_num || 0) + (Number(r.project_num) || 0),
    company_num: (acc.company_num || 0) + (Number(r.company_num) || 0),
    total_amount: (acc.total_amount || 0) + (Number(r.total_amount) || 0),
    project_amount: (acc.project_amount || 0) + (Number(r.project_amount) || 0),
    ipo_num: (acc.ipo_num || 0) + (Number(r.ipo_num) || 0),
    ipo_amount: (acc.ipo_amount || 0) + (Number(r.ipo_amount) || 0),
  }), {});
});

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
  if (!props.version) return;
  loading.value = true;
  try {
    const [res, configRes] = await Promise.all([
      dashboardApi.getUnderlyingCompanies(props.version, props.type),
      configApi.getIndicators()
    ]);
    if (res.success) {
      tableData.value = res.data.list || [];
      sumDedup.value = res.data.summary?.totalDedup || null;
    }
    if (configRes.success && configRes.data) {
      redirectUrl.value = configRes.data.redirectUrl || '';
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

const handleClose = () => { visible.value = false; };

watch(() => props.visible, (val) => { if (val) loadData(); });
</script>

<style scoped>
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
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

.underlying-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.underlying-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.underlying-table th,
.underlying-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #e5e6eb;
}
.underlying-table th {
  background: #f7f8fa;
  font-weight: 500;
  color: #4e5969;
  white-space: nowrap;
}
.underlying-table .col-index {
  text-align: center;
  width: 48px;
}
.underlying-table .col-group {
  text-align: center;
}
.underlying-table .col-amount {
  text-align: right;
}
.underlying-table tbody tr:hover {
  background: #f2f3f5;
}
.underlying-table .row-summary {
  background: #e8f3ff;
  font-weight: 500;
}
.underlying-table .row-summary td {
  border-bottom: 1px solid #b3d8ff;
}

</style>
