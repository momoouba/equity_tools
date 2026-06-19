<template>
  <a-modal
    v-model:visible="visible"
    :title="`上市企业明细【${type === 'cumulative' ? '累计' : '当前'}】`"
    :width="1125"
    :footer="false"
    :body-style="{ height: 'calc(75vh - 56px)', maxHeight: 'calc(75vh - 56px)', overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingBottom: 0 }"
    @cancel="handleClose"
  >
    <a-spin :loading="loading" class="ipo-spin">
    <div class="ipo-wrap">
      <div class="modal-header modal-header-with-btn">
        <div class="modal-header-left">
          <span>单位：人民币元</span>
          <span>数据截至日期：{{ versionDate }}</span>
          <span>版本号：{{ version }}</span>
        </div>
        <div class="modal-header-right">
          <a v-if="redirectUrl" :href="redirectUrl" target="_blank" rel="noopener noreferrer" class="detail-report-link">详细报表</a>
          <a-button type="primary" @click="handleExport">
            <template #icon><icon-download /></template>
            导出
          </a-button>
        </div>
      </div>
      <!-- 单表 + 吸顶表头 + 吸底合计 + 固定高度滚动 -->
      <div class="ipo-scroll">
        <table class="ipo-table">
          <colgroup>
            <col style="width: 48px" />
            <col style="width: 220px" />
            <col style="width: 120px" />
            <col style="width: 220px" />
            <col style="width: 140px" />
          </colgroup>
          <thead>
            <tr>
              <th class="col-index">序号</th>
              <th class="col-project">项目简称</th>
              <th>上市时间</th>
              <th>所属基金</th>
              <th class="col-amount">投资金额</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in tableData" :key="i">
              <td class="col-index">{{ i + 1 }}</td>
              <td class="col-project">{{ row.project }}</td>
              <td>{{ formatDate(row.ipo_date) }}</td>
              <td>{{ row.fund }}</td>
              <td class="col-amount td-num">{{ formatAmountYuan(row.amount) }}</td>
            </tr>
          </tbody>
          <tfoot v-if="tableData.length > 0">
            <tr class="ipo-summary-row">
              <td class="col-index" colspan="2">合计</td>
              <td colspan="2" style="text-align: center">-</td>
              <td class="col-amount td-num">{{ formatAmountYuan(totalAmount) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    </a-spin>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { dashboardApi, exportApi, configApi } from '../../../api/业绩看板应用';
import { Message } from '@arco-design/web-vue';
import { IconDownload } from '@arco-design/web-vue/es/icon';

const props = defineProps({
  visible: Boolean,
  version: String,
  type: { type: String, default: 'cumulative' }
});
const emit = defineEmits(['update:visible']);

const loading = ref(false);
const tableData = ref([]);
const redirectUrl = ref('');

const totalAmount = computed(() => {
  return tableData.value.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
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
      dashboardApi.getIpoCompanies(props.version, props.type),
      configApi.getIndicators()
    ]);
    if (res.success) {
      tableData.value = res.data.list || [];
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

const formatAmountYuan = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return Number(val).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDate = (val) => {
  if (!val) return '';
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  if (/^\d{8}$/.test(s)) {
    return `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`;
  }
  return s.substring(0, 10);
};

const handleExport = async () => {
  try {
    const blob = await exportApi.exportIpoCompanies(props.version, props.type);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    link.download = `${props.version}-上市企业明细-${date}.xlsx`;
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
.ipo-spin {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ipo-spin :deep(.arco-spin) {
  flex: 1;
  min-height: 0;
}
.ipo-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

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
.modal-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.detail-report-link {
  color: #165dff;
  font-size: 14px;
}
.detail-report-link:hover {
  color: #4080ff;
}
.modal-header-with-btn .arco-btn {
  margin-left: 0;
}

/* 单表 + 吸顶表头 + 吸底合计 + 固定高度滚动 */
.ipo-scroll {
  flex: 0 0 auto;
  min-height: 0;
  max-height: 500px;
  overflow-x: auto;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e5e6eb;
  border-radius: 4px;
}

.ipo-table {
  width: 100%;
  min-width: 748px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 13px;
}
.ipo-table th,
.ipo-table td {
  padding: 6px 10px;
  text-align: left;
  border: 1px solid #e5e6eb;
  box-sizing: border-box;
}
.ipo-table th {
  background: #f7f8fa;
  font-weight: 500;
  color: #4e5969;
}
.ipo-table .col-index {
  width: 48px;
  min-width: 48px;
  text-align: center;
}
.ipo-table .col-amount,
.ipo-table .td-num {
  text-align: right;
}

/* 表头吸顶 */
.ipo-scroll .ipo-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  box-shadow: 0 1px 0 #e5e6eb;
  height: 33px;
  min-height: 33px;
  vertical-align: middle;
}
/* 合计行吸底 */
.ipo-scroll .ipo-table tfoot tr {
  position: sticky;
  bottom: 0;
  z-index: 2;
}
.ipo-scroll .ipo-table tfoot td {
  background: #165dff;
  color: #fff;
  font-weight: 500;
  border: 1px solid #165dff;
  height: 35px;
  min-height: 35px;
  vertical-align: middle;
}
.ipo-scroll .ipo-table tbody tr {
  height: 35px;
}
.ipo-scroll .ipo-table tbody td {
  height: 35px;
  min-height: 35px;
  vertical-align: middle;
}

/* 序号、项目简称列横向滚动时固定 */
.ipo-scroll .ipo-table td.col-index {
  position: sticky;
  left: 0;
  background: #fff;
  z-index: 1;
}
.ipo-scroll .ipo-table td.col-project {
  position: sticky;
  left: 48px;
  background: #fff;
  z-index: 1;
}
.ipo-scroll .ipo-table thead th.col-index {
  position: sticky;
  left: 0;
  z-index: 3;
}
.ipo-scroll .ipo-table thead th.col-project {
  position: sticky;
  left: 48px;
  z-index: 3;
}
.ipo-scroll .ipo-table tfoot td.col-index,
.ipo-scroll .ipo-table tfoot td.col-project {
  background: #165dff;
  position: sticky;
  left: 0;
  z-index: 3;
}
.ipo-scroll .ipo-table tfoot td.col-project {
  left: 48px;
}

/* 数据行 hover 时整行均有底色 */
.ipo-scroll .ipo-table tbody tr:hover td {
  background: #f2f3f5 !important;
}

.ipo-summary-row td {
  background: #165dff;
  color: #fff;
  font-weight: 500;
}
.ipo-summary-row td.td-num {
  text-align: right;
}
</style>
