<template>
  <a-modal
    v-model:visible="visible"
    title="在管产品清单"
    :width="1450"
    :footer="false"
    @cancel="handleClose"
  >
    <div class="modal-header modal-header-with-action">
      <span>单位：人民币元</span>
      <span>数据截至日期：{{ versionDate }}</span>
      <span>版本号：{{ version }}</span>
      <a-button type="primary" class="modal-header-btn" @click="handleExport">
        <template #icon><icon-download /></template>
        导出底稿
      </a-button>
    </div>
    <a-table
      :data="displayData"
      :loading="loading"
      :pagination="false"
      :scroll="{ y: 400 }"
      :row-class="(record) => record._summary ? 'summary-row' : (record._groupSummary ? 'group-summary-row' : '')"
      class="manager-funds-table"
    >
      <template #columns>
        <a-table-column title="序号" :width="64" align="center">
          <template #cell="{ record }">
            {{ record._summary ? '合计' : (record._groupSummary ? record._groupLabel : record._index) }}
          </template>
        </a-table-column>
        <a-table-column title="基金名称" data-index="fund" :width="180">
          <template #cell="{ record }">{{ record._summary || record._groupSummary ? '-' : record.fund }}</template>
        </a-table-column>
        <a-table-column title="基金类型" data-index="fund_type" :width="120">
          <template #cell="{ record }">{{ record._summary ? '-' : (record._groupSummary ? '' : record.fund_type) }}</template>
        </a-table-column>
        <a-table-column title="投资期开始日" data-index="inv_start" :width="120">
          <template #cell="{ record }">{{ record._summary || record._groupSummary ? '-' : formatDate(record.inv_start) }}</template>
        </a-table-column>
        <a-table-column title="备案时间" data-index="ba_date" :width="120">
          <template #cell="{ record }">{{ record._summary || record._groupSummary ? '-' : formatDate(record.ba_date) }}</template>
        </a-table-column>
        <a-table-column title="备案编号" data-index="ba_num" :width="140">
          <template #cell="{ record }">{{ record._summary || record._groupSummary ? '-' : (record.ba_num || '-') }}</template>
        </a-table-column>
        <a-table-column title="认缴规模" data-index="sub_amount" align="right" :width="130">
          <template #cell="{ record }">{{ record._summary ? formatAmountYuan(record._sub_amount) : (record._groupSummary ? formatAmountYuan(record._sub_amount) : formatAmountYuan(record.sub_amount)) }}</template>
        </a-table-column>
        <a-table-column title="本年新增认缴" data-index="sub_add" align="right" :width="130">
          <template #cell="{ record }">{{ record._summary ? formatAmountYuan(record._sub_add) : (record._groupSummary ? formatAmountYuan(record._sub_add) : formatAmountYuan(record.sub_add)) }}</template>
        </a-table-column>
        <a-table-column title="实缴规模" data-index="paid_in_amount" align="right" :width="130">
          <template #cell="{ record }">{{ record._summary ? formatAmountYuan(record._paid_in_amount) : (record._groupSummary ? formatAmountYuan(record._paid_in_amount) : formatAmountYuan(record.paid_in_amount)) }}</template>
        </a-table-column>
        <a-table-column title="本年新增实缴" data-index="paid_in_add" align="right" :width="130">
          <template #cell="{ record }">{{ record._summary ? formatAmountYuan(record._paid_in_add) : (record._groupSummary ? formatAmountYuan(record._paid_in_add) : formatAmountYuan(record.paid_in_add)) }}</template>
        </a-table-column>
        <a-table-column title="累计分配金额" data-index="dis_amount" align="right" :width="140">
          <template #cell="{ record }">{{ record._summary ? formatAmountYuan(record._dis_amount) : (record._groupSummary ? formatAmountYuan(record._dis_amount) : formatAmountYuan(record.dis_amount)) }}</template>
        </a-table-column>
        <a-table-column title="本年新增分配" data-index="dis_add" align="right" :width="130">
          <template #cell="{ record }">{{ record._summary ? formatAmountYuan(record._dis_add) : (record._groupSummary ? formatAmountYuan(record._dis_add) : formatAmountYuan(record.dis_add)) }}</template>
        </a-table-column>
      </template>
    </a-table>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
const toNum = (v) => (v === null || v === undefined ? null : Number(v));
import { Message } from '@arco-design/web-vue';
import { IconDownload } from '@arco-design/web-vue/es/icon';
import { dashboardApi, exportApi } from '../../../api/performance';

const props = defineProps({
  visible: Boolean,
  version: String
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

// 格式化日期
const formatDate = (val) => {
  if (!val) return '-';
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return s;
};

// 在管产品清单仅显示这三类
const ALLOWED_FUND_TYPES = ['母基金', '直投基金', '内部备案SPV'];

// 按 fund_type 分组，每组后加小计行，最后加合计行
const displayData = computed(() => {
  const list = tableData.value;
  if (!list.length) return [];

  // 按 fund_type 分组（仅显示指定类型）
  const groups = {};
  list.forEach((r) => {
    const type = r.fund_type || '其他';
    if (!ALLOWED_FUND_TYPES.includes(type)) return;
    if (!groups[type]) groups[type] = [];
    groups[type].push(r);
  });

  // 基金类型排序（与后端 ORDER BY 一致）
  const typeOrder = ['母基金', '直投基金', '内部备案SPV'];
  const sortedTypes = Object.keys(groups).sort((a, b) => {
    const ia = typeOrder.indexOf(a);
    const ib = typeOrder.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  // 全局合计
  const totalSum = { sub_amount: 0, sub_add: 0, paid_in_amount: 0, paid_in_add: 0, dis_amount: 0, dis_add: 0 };

  const result = [];
  let index = 1;

  sortedTypes.forEach((type) => {
    const rows = groups[type];
    const groupSum = { sub_amount: 0, sub_add: 0, paid_in_amount: 0, paid_in_add: 0, dis_amount: 0, dis_add: 0 };

    rows.forEach((r) => {
      result.push({ ...r, _index: index });
      index++;
      groupSum.sub_amount += toNum(r.sub_amount) || 0;
      groupSum.sub_add += toNum(r.sub_add) || 0;
      groupSum.paid_in_amount += toNum(r.paid_in_amount) || 0;
      groupSum.paid_in_add += toNum(r.paid_in_add) || 0;
      groupSum.dis_amount += toNum(r.dis_amount) || 0;
      groupSum.dis_add += toNum(r.dis_add) || 0;
    });

    // 小计行
    result.push({
      _groupSummary: true,
      _groupLabel: `小计（${type}）`,
      sub_amount: groupSum.sub_amount,
      sub_add: groupSum.sub_add,
      paid_in_amount: groupSum.paid_in_amount,
      paid_in_add: groupSum.paid_in_add,
      dis_amount: groupSum.dis_amount,
      dis_add: groupSum.dis_add
    });

    // 累加到全局合计
    totalSum.sub_amount += groupSum.sub_amount;
    totalSum.sub_add += groupSum.sub_add;
    totalSum.paid_in_amount += groupSum.paid_in_amount;
    totalSum.paid_in_add += groupSum.paid_in_add;
    totalSum.dis_amount += groupSum.dis_amount;
    totalSum.dis_add += groupSum.dis_add;
  });

  // 合计行
  result.push({
    _summary: true,
    _sub_amount: totalSum.sub_amount,
    _sub_add: totalSum.sub_add,
    _paid_in_amount: totalSum.paid_in_amount,
    _paid_in_add: totalSum.paid_in_add,
    _dis_amount: totalSum.dis_amount,
    _dis_add: totalSum.dis_add
  });

  return result;
});

// 加载数据
const loadData = async () => {
  if (!props.version) return;
  loading.value = true;
  try {
    const res = await dashboardApi.getManagerFunds(props.version);
    if (res.success) {
      tableData.value = res.data.list || [];
    }
  } catch (error) {
    console.error('加载数据失败:', error);
    Message.error('加载数据失败');
  } finally {
    loading.value = false;
  }
};

// 格式化金额（元，千分位，保留2位小数）
const formatAmountYuan = (val) => {
  if (val === null || val === undefined) return '/';
  if (val === 0) return '-';
  return Number(val).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// 导出
const handleExport = async () => {
  try {
    const blob = await exportApi.exportManagerFunds(props.version);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    link.download = `${props.version}-在管产品清单-${date}.xlsx`;
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
  if (val) {
    loadData();
  }
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

.modal-header-with-action {
  align-items: center;
  flex-wrap: wrap;
}

.modal-header-btn {
  margin-left: auto;
  background: #00024C !important;
  border-color: #00024C !important;
  color: #fff !important;
}
.modal-header-btn:hover {
  background: #00024C !important;
  border-color: #00024C !important;
  color: #fff !important;
  opacity: 0.9;
}

/* 列间竖线；表头居中 */
.manager-funds-table :deep(.arco-table-th),
.manager-funds-table :deep(.arco-table-td) {
  border-right: 1px solid #e5e6eb;
}

/* 表头整列居中（含内部内容） */
.manager-funds-table :deep(.arco-table-th) {
  text-align: center;
}

.manager-funds-table :deep(.arco-table-th .arco-table-th-item),
.manager-funds-table :deep(.arco-table-th .arco-table-th-content) {
  justify-content: center;
  text-align: center;
}

.manager-funds-table :deep(.arco-table-th:last-child),
.manager-funds-table :deep(.arco-table-td:last-child) {
  border-right: none;
}

/* 合计行：浅蓝底 #1AA8E9 白字 */
.manager-funds-table :deep(.summary-row .arco-table-td) {
  background: #1AA8E9 !important;
  color: #fff !important;
  font-weight: 500;
}

/* 分组小计行：浅蓝底 #1AA8E9 白字 */
.manager-funds-table :deep(.group-summary-row .arco-table-td) {
  background: #1AA8E9 !important;
  color: #fff !important;
  font-weight: 500;
}
</style>
