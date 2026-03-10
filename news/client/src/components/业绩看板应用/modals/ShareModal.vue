<template>
  <a-modal
    v-model:visible="visible"
    title="分享业绩看板"
    :width="500"
    @ok="handleCreate"
    @cancel="handleClose"
  >
    <a-form :model="formData" layout="vertical">
      <a-form-item label="分享版本">
        <a-input :model-value="version" disabled />
      </a-form-item>
      
      <a-form-item label="有效期">
        <a-radio-group v-model="formData.hasExpiry">
          <a-radio :value="false">永久有效</a-radio>
          <a-radio :value="true">设置有效期</a-radio>
        </a-radio-group>
      </a-form-item>
      
      <a-form-item v-if="formData.hasExpiry">
        <a-date-picker
          v-model="formData.expiryTime"
          show-time
          format="YYYY-MM-DD HH:mm:ss"
          placeholder="选择过期时间"
          style="width: 100%"
        />
      </a-form-item>
      
      <a-form-item label="访问密码">
        <a-radio-group v-model="formData.hasPassword">
          <a-radio :value="false">无需密码</a-radio>
          <a-radio :value="true">设置密码</a-radio>
        </a-radio-group>
      </a-form-item>
      
      <a-form-item v-if="formData.hasPassword">
        <a-input-password
          v-model="formData.password"
          placeholder="请输入访问密码"
        />
      </a-form-item>
      
      <a-form-item label="允许导出">
        <a-switch v-model="formData.canExport" />
      </a-form-item>
    </a-form>
    
    <div v-if="shareUrl" class="share-result">
      <div class="share-label">分享链接：</div>
      <a-input :model-value="shareUrl" readonly>
        <template #append>
          <a-button @click="copyUrl">复制</a-button>
        </template>
      </a-input>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed } from 'vue';
import { Message } from '@arco-design/web-vue';
import { shareApi } from '../../../api/业绩看板应用';

const props = defineProps({
  visible: Boolean,
  version: String
});

const emit = defineEmits(['update:visible']);

const loading = ref(false);
const shareUrl = ref('');

const formData = ref({
  hasExpiry: false,
  expiryTime: null,
  hasPassword: false,
  password: '',
  canExport: false
});

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

// 创建分享
const handleCreate = async () => {
  if (formData.value.hasPassword && !formData.value.password) {
    Message.warning('请输入访问密码');
    return;
  }
  
  if (formData.value.hasExpiry && !formData.value.expiryTime) {
    Message.warning('请选择过期时间');
    return;
  }
  
  loading.value = true;
  try {
    const res = await shareApi.createShare({
      version: props.version,
      hasExpiry: formData.value.hasExpiry,
      expiryTime: formData.value.expiryTime,
      hasPassword: formData.value.hasPassword,
      password: formData.value.password,
      canExport: formData.value.canExport
    });
    
    if (res.success) {
      shareUrl.value = window.location.origin + res.data.shareUrl;
      Message.success('分享链接已创建');
    } else {
      Message.error(res.message || '创建分享链接失败');
    }
  } catch (error) {
    console.error('创建分享链接失败:', error);
    Message.error('创建分享链接失败');
  } finally {
    loading.value = false;
  }
};

// 复制链接
const copyUrl = () => {
  navigator.clipboard.writeText(shareUrl.value).then(() => {
    Message.success('链接已复制');
  });
};

const handleClose = () => {
  visible.value = false;
  shareUrl.value = '';
  formData.value = {
    hasExpiry: false,
    expiryTime: null,
    hasPassword: false,
    password: '',
    canExport: false
  };
};
</script>

<style scoped>
.share-result {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e5e6eb;
}

.share-label {
  font-weight: 500;
  color: #1d2129;
  margin-bottom: 8px;
}
</style>
