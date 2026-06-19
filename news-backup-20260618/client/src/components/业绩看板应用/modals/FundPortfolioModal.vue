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
      <div class="fund-portfolio-scroll">
        <table class="fund-portfolio-table">
          <colgroup>
            <col style="width: 48px" />
            <col style="width: 90px" />
            <col style="width: 160px" />
            <col style="width: 90px" />
            <col style="width: 120px" /><col style="width: 120px" />
            <col style="width: 120px" /><col style="width: 120px" />
            <col style="width: 120px" /><col style="width: 120px" />
            <col style="width: 120px" /><col style="width: 120px" />
            <col style="width: 120px" /><col style="width: 120px" />
            <col style="width: 120px" />
            <col style="width: 60px" /><col style="width: 60px" />
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
            <tr v-for="(row, idx) in tableData" :key="idx">
              <td class="col-index">{{ idx + 1 }}</td>
              <td class="col-type">{{ row.transaction_type || '-' }}</td>
              <td class="col-project">{{ row.project || '-' }}</td>
              <td class="col-date">{{ row.first_date || '-' }}</td>
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

const versionDate = computed(() => {
  if (!props.version) return '';
  const dateStr = props.version.substring(0, 8);
  return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
});

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

const formatAmount = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  const billion = val / 100000000;
  return billion.toFixed(2);
};

const formatRatio = (val) => {
  if (val === null || val === undefined) return '-';
  return Number(val).toFixed(2) + 'x';
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

.fund-portfolio-scroll {
  overflow-x: auto;
  max-height: 60vh;
  overflow-y: auto;
}

.fund-portfolio-table {
  width: 1918px;
  min-width: 1918px;
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
}

.fund-portfolio-table .td-num {
  text-align: right;
}

.fund-portfolio-table .col-index {
  min-width: 48px;
  width: 48px;
  max-width: 48px;
  text-align: center;
}

.fund-portfolio-table .col-type {
  min-width: 90px;
  width: 90px;
  max-width: 90px;
}

.fund-portfolio-table .col-project {
  min-width: 160px;
  width: 160px;
  max-width: 160px;
}

.fund-portfolio-table .col-date {
  min-width: 90px;
  width: 90px;
  max-width: 90px;
}

.fund-portfolio-table .col-amount,
.fund-portfolio-table .col-total-value {
  min-width: 120px;
  width: 120px;
  max-width: 120px;
}

.fund-portfolio-table .col-ratio {
  min-width: 60px;
  width: 60px;
  max-width: 60px;
}
</style>
