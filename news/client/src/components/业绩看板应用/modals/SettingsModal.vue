<template>
  <a-modal
    v-model:visible="visible"
    title="设置"
    :width="800"
    @ok="handleSave"
    @cancel="handleClose"
  >
    <a-tabs>
      <a-tab-pane key="basic" title="基础配置">
        <a-form :model="formData" layout="vertical">
          <a-form-item label="系统名称">
            <a-input v-model="formData.systemName" placeholder="请输入系统名称" />
          </a-form-item>
          <a-form-item label="操作手册地址">
            <a-input v-model="formData.manualUrl" placeholder="请输入操作手册链接" />
          </a-form-item>
          <a-form-item label="页面跳转地址">
            <a-input v-model="formData.redirectUrl" placeholder="请输入底层穿透表链接" />
          </a-form-item>
        </a-form>
      </a-tab-pane>
      <a-tab-pane key="manager" title="管理人指标说明">
        <a-form :model="formData" layout="vertical">
          <a-form-item label="母基金数量">
            <a-textarea v-model="formData.fofNumDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="直投基金数量">
            <a-textarea v-model="formData.directNumDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="认缴管理规模">
            <a-textarea v-model="formData.subAmountDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="实缴管理规模">
            <a-textarea v-model="formData.paidInAmountDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="累计分配总额">
            <a-textarea v-model="formData.disAmountDesc" placeholder="请输入指标说明" />
          </a-form-item>
        </a-form>
      </a-tab-pane>
      <a-tab-pane key="fund" title="基金产品指标说明">
        <a-form :model="formData" layout="vertical">
          <a-form-item label="投资人认缴">
            <a-textarea v-model="formData.lpSubDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="投资人实缴">
            <a-textarea v-model="formData.paidinDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="投资人分配">
            <a-textarea v-model="formData.distributionDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="TVPI">
            <a-textarea v-model="formData.tvpiDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="DPI">
            <a-textarea v-model="formData.dpiDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="RVPI">
            <a-textarea v-model="formData.rvpiDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="NIRR">
            <a-textarea v-model="formData.nirrDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="投资金额/认缴">
            <a-textarea v-model="formData.subAmountInvDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="投资金额/实缴">
            <a-textarea v-model="formData.invAmountDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="退出金额">
            <a-textarea v-model="formData.exitAmountDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="GIRR">
            <a-textarea v-model="formData.girrDesc" placeholder="请输入指标说明" />
          </a-form-item>
          <a-form-item label="MOC">
            <a-textarea v-model="formData.mocDesc" placeholder="请输入指标说明" />
          </a-form-item>
        </a-form>
      </a-tab-pane>
    </a-tabs>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { Message } from '@arco-design/web-vue';
import { configApi } from '../../../api/业绩看板应用';

const props = defineProps({
  visible: Boolean,
  config: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(['update:visible', 'save']);

const loading = ref(false);

const formData = ref({
  systemName: '',
  manualUrl: '',
  redirectUrl: '',
  fofNumDesc: '',
  directNumDesc: '',
  subAmountDesc: '',
  paidInAmountDesc: '',
  disAmountDesc: '',
  lpSubDesc: '',
  paidinDesc: '',
  distributionDesc: '',
  tvpiDesc: '',
  dpiDesc: '',
  rvpiDesc: '',
  nirrDesc: '',
  subAmountInvDesc: '',
  invAmountDesc: '',
  exitAmountDesc: '',
  girrDesc: '',
  mocDesc: ''
});

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

// 初始化表单数据
const initFormData = () => {
  formData.value = {
    systemName: props.config.systemName || '',
    manualUrl: props.config.manualUrl || '',
    redirectUrl: props.config.redirectUrl || '',
    fofNumDesc: props.config.fofNumDesc || '',
    directNumDesc: props.config.directNumDesc || '',
    subAmountDesc: props.config.subAmountDesc || '',
    paidInAmountDesc: props.config.paidInAmountDesc || '',
    disAmountDesc: props.config.disAmountDesc || '',
    lpSubDesc: props.config.lpSubDesc || '',
    paidinDesc: props.config.paidinDesc || '',
    distributionDesc: props.config.distributionDesc || '',
    tvpiDesc: props.config.tvpiDesc || '',
    dpiDesc: props.config.dpiDesc || '',
    rvpiDesc: props.config.rvpiDesc || '',
    nirrDesc: props.config.nirrDesc || '',
    subAmountInvDesc: props.config.subAmountInvDesc || '',
    invAmountDesc: props.config.invAmountDesc || '',
    exitAmountDesc: props.config.exitAmountDesc || '',
    girrDesc: props.config.girrDesc || '',
    mocDesc: props.config.mocDesc || ''
  };
};

// 保存
const handleSave = async () => {
  loading.value = true;
  try {
    const res = await configApi.updateIndicators(formData.value);
    if (res.success) {
      Message.success('保存成功');
      emit('save');
      visible.value = false;
    } else {
      Message.error(res.message || '保存失败');
    }
  } catch (error) {
    console.error('保存失败:', error);
    Message.error('保存失败');
  } finally {
    loading.value = false;
  }
};

const handleClose = () => {
  visible.value = false;
};

watch(() => props.visible, (val) => {
  if (val) {
    initFormData();
  }
});
</script>

<style scoped>
:deep(.arco-form-item) {
  margin-bottom: 16px;
}
</style>
