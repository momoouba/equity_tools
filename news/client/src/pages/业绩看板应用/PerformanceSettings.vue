<template>
  <div class="performance-settings">
    <div class="page-header">
      <h2>业绩看板设置</h2>
    </div>
    
    <a-tabs v-model:active-key="activeTab">
      <!-- Tab1: 数据接口配置 -->
      <a-tab-pane key="sql" title="数据接口配置">
        <div class="tab-content">
          <div class="toolbar">
            <a-button type="primary" @click="showAddDialog">
              <template #icon><icon-plus /></template>
              新增配置
            </a-button>
          </div>
          
          <a-table
            :data="sqlConfigs"
            :loading="loading"
            :pagination="false"
          >
            <template #columns>
              <a-table-column title="执行顺序" data-index="exec_order" width="80" />
              <a-table-column title="接口名称" data-index="interface_name" />
              <a-table-column title="目标数据表" data-index="target_table" />
              <a-table-column title="数据库" data-index="database_name" />
              <a-table-column title="创建时间" data-index="F_CreatorTime" />
              <a-table-column title="创建人" data-index="F_CreatorUserId" />
              <a-table-column title="修改时间" data-index="F_LastModifyTime" />
              <a-table-column title="操作" width="200">
                <template #cell="{ record }">
                  <a-space>
                    <a-button type="text" @click="editConfig(record)">编辑</a-button>
                    <a-button type="text" @click="testConfig(record)">测试</a-button>
                    <a-popconfirm content="确认删除？" @ok="deleteConfig(record)">
                      <a-button type="text" status="danger">删除</a-button>
                    </a-popconfirm>
                  </a-space>
                </template>
              </a-table-column>
            </template>
          </a-table>
        </div>
      </a-tab-pane>
      
      <!-- Tab2: 定时任务配置 -->
      <a-tab-pane key="cron" title="定时任务配置">
        <div class="tab-content">
          <a-card title="定期取数任务">
            <p>每月1日和4日凌晨00:00:00自动触发数据生成任务。</p>
            <p>当前状态：
              <a-tag color="green">已启用</a-tag>
            </p>
            <p>Cron表达式：<code>0 0 1,4 * *</code></p>
          </a-card>
          
          <a-card title="每日数据清理任务" style="margin-top: 16px;">
            <p>每日执行数据清理与生成操作：删除最新版本的系统生成数据（非1日4日生成），并重新触发数据生成。</p>
            <p>当前状态：
              <a-tag color="green">已启用</a-tag>
            </p>
            <p>Cron表达式：<code>0 2 * * *</code>（每日凌晨2点执行）</p>
          </a-card>
        </div>
      </a-tab-pane>
    </a-tabs>
    
    <!-- 新增/编辑SQL配置弹窗 -->
    <a-modal
      v-model:visible="showDialog"
      :title="editingId ? '编辑数据接口' : '新增数据接口'"
      :width="800"
      @ok="handleSave"
      @cancel="handleClose"
    >
      <a-form :model="form" layout="vertical">
        <a-form-item label="接口名称" required>
          <a-input v-model="form.interfaceName" placeholder="请输入接口名称" />
        </a-form-item>
        <a-form-item label="数据库">
          <a-select v-model="form.externalDbConfigId" placeholder="选择数据库（默认主库）" allow-clear>
            <a-option v-for="db in databases" :key="db.id" :value="db.id">
              {{ db.name }}
            </a-option>
          </a-select>
        </a-form-item>
        <a-form-item label="目标数据表" required>
          <a-input v-model="form.targetTable" placeholder="查询结果写入的目标表名" />
        </a-form-item>
        <a-form-item label="执行顺序">
          <a-input-number v-model="form.execOrder" placeholder="数字越小越先执行" style="width: 100%" />
        </a-form-item>
        <a-form-item label="SQL代码" required>
          <a-textarea
            v-model="form.sqlContent"
            placeholder="请输入SELECT查询语句"
            :auto-size="{ minRows: 8 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>
    
    <!-- SQL测试弹窗 -->
    <a-modal
      v-model:visible="showTestDialog"
      title="SQL测试"
      :width="600"
      @ok="executeTest"
    >
      <a-form layout="vertical">
        <a-form-item label="测试日期">
          <a-date-picker
            v-model="testDate"
            placeholder="请选择测试日期（23:59:59）"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
      
      <div v-if="testResult" class="test-result">
        <div class="result-title">执行结果：</div>
        <a-alert :type="testResult.success ? 'success' : 'error'">
          {{ testResult.message }}
        </a-alert>
        <div v-if="testResult.data" class="result-data">
          <pre>{{ JSON.stringify(testResult.data, null, 2) }}</pre>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Message } from '@arco-design/web-vue';
import { IconPlus } from '@arco-design/web-vue/es/icon';
import { configApi } from '../../api/业绩看板应用';

const activeTab = ref('sql');
const loading = ref(false);
const sqlConfigs = ref([]);
const databases = ref([]);
const showDialog = ref(false);
const showTestDialog = ref(false);
const editingId = ref(null);
const testingId = ref(null);
const testDate = ref('');
const testResult = ref(null);

const form = ref({
  interfaceName: '',
  externalDbConfigId: null,
  targetTable: '',
  execOrder: 0,
  databaseName: '',
  sqlContent: ''
});

// 加载数据
const loadData = async () => {
  loading.value = true;
  try {
    const [sqlRes, dbRes] = await Promise.all([
      configApi.getSqlConfigs(),
      configApi.getDatabases()
    ]);
    
    if (sqlRes.success) {
      sqlConfigs.value = sqlRes.data.list;
    }
    if (dbRes.success) {
      databases.value = dbRes.data.list;
    }
  } catch (error) {
    console.error('加载数据失败:', error);
  } finally {
    loading.value = false;
  }
};

// 显示新增弹窗
const showAddDialog = () => {
  editingId.value = null;
  form.value = {
    interfaceName: '',
    externalDbConfigId: null,
    targetTable: '',
    execOrder: 0,
    databaseName: '',
    sqlContent: ''
  };
  showDialog.value = true;
};

// 编辑配置
const editConfig = async (record) => {
  editingId.value = record.F_Id;
  const res = await configApi.getSqlConfig(record.F_Id);
  if (res.success) {
    const config = res.data;
    form.value = {
      interfaceName: config.interface_name,
      externalDbConfigId: config.external_db_config_id,
      targetTable: config.target_table,
      execOrder: config.exec_order,
      databaseName: config.database_name,
      sqlContent: config.sql_content
    };
    showDialog.value = true;
  }
};

// 测试配置
const testConfig = (record) => {
  testingId.value = record.F_Id;
  testResult.value = null;
  showTestDialog.value = true;
};

// 执行测试
const executeTest = async () => {
  if (!testDate.value) {
    Message.warning('请选择测试日期');
    return;
  }
  
  try {
    const date = typeof testDate.value === 'string' 
      ? testDate.value 
      : testDate.value.format('YYYY-MM-DD');
    
    const res = await configApi.testSqlConfig(testingId.value, date);
    testResult.value = res;
  } catch (error) {
    testResult.value = { success: false, message: '测试失败: ' + error.message };
  }
};

// 删除配置
const deleteConfig = async (record) => {
  try {
    const res = await configApi.deleteSqlConfig(record.F_Id);
    if (res.success) {
      Message.success('删除成功');
      loadData();
    }
  } catch (error) {
    Message.error('删除失败');
  }
};

// 保存配置
const handleSave = async () => {
  if (!form.value.interfaceName) {
    Message.warning('请填写接口名称');
    return;
  }
  if (!form.value.sqlContent) {
    Message.warning('请填写SQL代码');
    return;
  }
  if (!form.value.targetTable) {
    Message.warning('请填写目标数据表');
    return;
  }
  
  try {
    let res;
    if (editingId.value) {
      res = await configApi.updateSqlConfig(editingId.value, form.value);
    } else {
      res = await configApi.createSqlConfig(form.value);
    }
    
    if (res.success) {
      Message.success('保存成功');
      showDialog.value = false;
      loadData();
    } else {
      Message.error(res.message || '保存失败');
    }
  } catch (error) {
    Message.error('保存失败');
  }
};

const handleClose = () => {
  showDialog.value = false;
};

onMounted(() => {
  loadData();
});
</script>

<style scoped>
.performance-settings {
  padding: 20px;
  background: #f5f7fa;
  min-height: 100vh;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h2 {
  font-size: 22px;
  font-weight: 600;
  color: #1d2129;
}

.tab-content {
  padding: 16px 0;
}

.toolbar {
  margin-bottom: 16px;
}

.test-result {
  margin-top: 16px;
}

.result-title {
  font-weight: 500;
  margin-bottom: 8px;
}

.result-data {
  margin-top: 8px;
  background: #f7f8fa;
  border-radius: 4px;
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.result-data pre {
  margin: 0;
  font-size: 12px;
}
</style>
