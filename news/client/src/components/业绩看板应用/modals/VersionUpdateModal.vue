<template>
  <a-modal
    v-model:visible="visible"
    title="数据版本更新"
    :width="700"
    @ok="handleUpdate"
    @cancel="handleClose"
  >
    <div class="version-update-content">
      <div class="month-selector">
        <div v-for="(item, index) in selectedMonths" :key="index" class="month-row">
          <a-date-picker
            v-model="item.date"
            format="YYYY-MM"
            placeholder="选择月份"
            style="width: 200px"
          />
          <a-button
            v-if="selectedMonths.length > 1"
            type="text"
            status="danger"
            @click="removeMonth(index)"
          >
            <template #icon><icon-delete /></template>
          </a-button>
        </div>
        <a-button
          v-if="selectedMonths.length < 6"
          type="dashed"
          long
          @click="addMonth"
        >
          <template #icon><icon-plus /></template>
          添加月份
        </a-button>
      </div>
      
      <div class="version-preview" v-if="previewVersions.length > 0">
        <div class="preview-title">即将生成的版本：</div>
        <div v-for="(version, index) in previewVersions" :key="index" class="version-item">
          <span class="version-date">{{ version.date }}</span>
          <span class="version-name">{{ version.version }}</span>
          <span v-if="version.existing" class="version-existing">（已有版本，将生成新版本）</span>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { Message } from '@arco-design/web-vue';
import { IconPlus, IconDelete } from '@arco-design/web-vue/es/icon';
import { versionApi } from '../../../api/业绩看板应用';

const props = defineProps({
  visible: Boolean
});

const emit = defineEmits(['update:visible', 'success']);

const loading = ref(false);
const selectedMonths = ref([{ date: '' }]);
const existingVersions = ref({});

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

// 预览版本
const previewVersions = computed(() => {
  return selectedMonths.value
    .filter(item => item.date)
    .map(item => {
      const date = item.date.format ? item.date.format('YYYY-MM-DD') : item.date;
      const dateStr = date.replace(/-/g, '');
      const existing = existingVersions.value[date];
      let versionNum = '01';
      if (existing && existing.maxVersion) {
        const match = existing.maxVersion.match(/V(\d+)$/);
        if (match) {
          versionNum = String(parseInt(match[1]) + 1).padStart(2, '0');
        }
      }
      return {
        date,
        version: `${dateStr}V${versionNum}`,
        existing: !!existing
      };
    });
});

// 添加月份
const addMonth = () => {
  if (selectedMonths.value.length < 6) {
    selectedMonths.value.push({ date: '' });
  }
};

// 移除月份
const removeMonth = (index) => {
  selectedMonths.value.splice(index, 1);
};

// 检查已有版本
const checkExistingVersions = async () => {
  const dates = selectedMonths.value
    .filter(item => item.date)
    .map(item => item.date.format ? item.date.format('YYYY-MM-DD') : item.date);
  
  for (const date of dates) {
    try {
      const res = await versionApi.getVersions(date);
      if (res.success && res.data.versions.length > 0) {
        existingVersions.value[date] = {
          maxVersion: res.data.versions[0].version
        };
      }
    } catch (error) {
      console.error('检查版本失败:', error);
    }
  }
};

// 执行更新
const handleUpdate = async () => {
  const validMonths = selectedMonths.value
    .filter(item => item.date)
    .map(item => item.date.format ? item.date.format('YYYY-MM-DD') : item.date);
  
  if (validMonths.length === 0) {
    Message.warning('请至少选择一个月份');
    return;
  }
  
  loading.value = true;
  try {
    const res = await versionApi.createVersion({
      date: validMonths[0],
      months: validMonths
    });
    
    if (res.success) {
      Message.success('版本创建成功');
      emit('success');
      visible.value = false;
      selectedMonths.value = [{ date: '' }];
    } else {
      Message.error(res.message || '版本创建失败');
    }
  } catch (error) {
    console.error('版本创建失败:', error);
    Message.error('版本创建失败');
  } finally {
    loading.value = false;
  }
};

const handleClose = () => {
  visible.value = false;
  selectedMonths.value = [{ date: '' }];
};

watch(() => selectedMonths.value, () => {
  checkExistingVersions();
}, { deep: true });
</script>

<style scoped>
.version-update-content {
  padding: 16px 0;
}

.month-selector {
  margin-bottom: 24px;
}

.month-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.version-preview {
  background: #f7f8fa;
  border-radius: 6px;
  padding: 16px;
}

.preview-title {
  font-weight: 500;
  color: #1d2129;
  margin-bottom: 12px;
}

.version-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
  border-bottom: 1px solid #e5e6eb;
}

.version-item:last-child {
  border-bottom: none;
}

.version-date {
  color: #4e5969;
  width: 120px;
}

.version-name {
  font-weight: 500;
  color: #165dff;
}

.version-existing {
  color: #86909c;
  font-size: 13px;
}
</style>
