<template>
  <div class="performance-dashboard">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <a-select v-model="selectedDate" placeholder="选择日期" style="width: 150px" @change="onDateChange">
          <a-option v-for="date in dates" :key="date" :value="date">{{ date }}</a-option>
        </a-select>
        <a-select v-model="selectedVersion" placeholder="选择版本" style="width: 180px; margin-left: 12px">
          <a-option v-for="v in versions" :key="v.version" :value="v.version">{{ v.version }}</a-option>
        </a-select>
        <span class="version-info" v-if="currentVersionInfo">
          {{ currentVersionInfo.creatorName }} {{ formatTime(currentVersionInfo.createTime) }}
        </span>
      </div>
      <div class="toolbar-right">
        <a-button type="text" @click="showManual">
          <template #icon><icon-book /></template>
          看板操作手册
        </a-button>
        <a-button type="text" @click="showSettings">
          <template #icon><icon-settings /></template>
          设置
        </a-button>
        <a-button type="primary" @click="showVersionUpdate">
          <template #icon><icon-refresh /></template>
          数据版本更新
        </a-button>
        <a-button type="primary" status="danger" @click="showShare">
          <template #icon><icon-share-alt /></template>
          分享
        </a-button>
      </div>
    </div>

    <!-- 系统名称 -->
    <div class="system-header">
      <h1 class="system-name">{{ systemConfig.systemName || '业绩看板' }}</h1>
      <div class="system-info">
        截至：{{ selectedDate }} 金额单位：亿元
      </div>
    </div>

    <!-- 管理人指标卡 -->
    <ManagerIndicator 
      :data="managerData" 
      :config="systemConfig"
      @click="showManagerFunds"
    />

    <!-- 基金产品指标块 -->
    <FundIndicators 
      :funds="fundsData.funds"
      :indicators="fundsData.indicators"
      :config="systemConfig"
      @investor-click="showInvestors"
      @performance-click="showFundPerformance"
      @portfolio-click="showFundPortfolio"
      @cashflow-click="showProjectCashflow"
    />

    <!-- 投资组合 -->
    <PortfolioSection 
      :funds="portfolioData.funds"
      :overall="portfolioData.overall"
      :config="systemConfig"
      @fund-click="showFundPortfolio"
      @overall-click="showPortfolioDetail"
    />

    <!-- 底层资产 -->
    <UnderlyingSection 
      :cumulative="underlyingData.cumulative"
      :current="underlyingData.current"
      :config="systemConfig"
      @companies-click="showUnderlyingCompanies"
      @ipo-click="showIpoCompanies"
      @region-click="showRegionCompanies"
    />

    <!-- 弹窗组件 -->
    <ManagerFundsModal v-model:visible="modals.managerFunds" :version="selectedVersion" />
    <InvestorsModal v-model:visible="modals.investors" :version="selectedVersion" :fund="selectedFund" />
    <FundPerformanceModal v-model:visible="modals.fundPerformance" :version="selectedVersion" :fund="selectedFund" />
    <FundPortfolioModal v-model:visible="modals.fundPortfolio" :version="selectedVersion" :fund="selectedFund" />
    <ProjectCashflowModal v-model:visible="modals.projectCashflow" :version="selectedVersion" :fund="selectedFund" />
    <PortfolioDetailModal v-model:visible="modals.portfolioDetail" :version="selectedVersion" />
    <UnderlyingCompaniesModal v-model:visible="modals.underlyingCompanies" :version="selectedVersion" :type="modalType" />
    <IpoCompaniesModal v-model:visible="modals.ipoCompanies" :version="selectedVersion" :type="modalType" />
    <RegionCompaniesModal v-model:visible="modals.regionCompanies" :version="selectedVersion" :type="modalType" />
    
    <!-- 设置弹窗 -->
    <SettingsModal v-model:visible="modals.settings" :config="systemConfig" @save="loadSystemConfig" />
    
    <!-- 版本更新弹窗 -->
    <VersionUpdateModal v-model:visible="modals.versionUpdate" @success="loadDates" />
    
    <!-- 分享弹窗 -->
    <ShareModal v-model:visible="modals.share" :version="selectedVersion" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { Message } from '@arco-design/web-vue';
import {
  IconBook,
  IconSettings,
  IconRefresh,
  IconShareAlt
} from '@arco-design/web-vue/es/icon';

import { versionApi, dashboardApi, configApi } from '../../api/业绩看板应用';

// 导入子组件
import ManagerIndicator from '../../components/业绩看板应用/ManagerIndicator.vue';
import FundIndicators from '../../components/业绩看板应用/FundIndicators.vue';
import PortfolioSection from '../../components/业绩看板应用/PortfolioSection.vue';
import UnderlyingSection from '../../components/业绩看板应用/UnderlyingSection.vue';

// 导入弹窗组件
import ManagerFundsModal from '../../components/业绩看板应用/modals/ManagerFundsModal.vue';
import InvestorsModal from '../../components/业绩看板应用/modals/InvestorsModal.vue';
import FundPerformanceModal from '../../components/业绩看板应用/modals/FundPerformanceModal.vue';
import FundPortfolioModal from '../../components/业绩看板应用/modals/FundPortfolioModal.vue';
import ProjectCashflowModal from '../../components/业绩看板应用/modals/ProjectCashflowModal.vue';
import PortfolioDetailModal from '../../components/业绩看板应用/modals/PortfolioDetailModal.vue';
import UnderlyingCompaniesModal from '../../components/业绩看板应用/modals/UnderlyingCompaniesModal.vue';
import IpoCompaniesModal from '../../components/业绩看板应用/modals/IpoCompaniesModal.vue';
import RegionCompaniesModal from '../../components/业绩看板应用/modals/RegionCompaniesModal.vue';
import SettingsModal from '../../components/业绩看板应用/modals/SettingsModal.vue';
import VersionUpdateModal from '../../components/业绩看板应用/modals/VersionUpdateModal.vue';
import ShareModal from '../../components/业绩看板应用/modals/ShareModal.vue';

// 状态
const dates = ref([]);
const versions = ref([]);
const selectedDate = ref('');
const selectedVersion = ref('');
const selectedFund = ref('');
const modalType = ref('cumulative');

const managerData = ref({});
const fundsData = ref({ funds: [], indicators: {} });
const portfolioData = ref({ funds: [], overall: null });
const underlyingData = ref({ cumulative: null, current: null });
const systemConfig = ref({});

const modals = ref({
  managerFunds: false,
  investors: false,
  fundPerformance: false,
  fundPortfolio: false,
  projectCashflow: false,
  portfolioDetail: false,
  underlyingCompanies: false,
  ipoCompanies: false,
  regionCompanies: false,
  settings: false,
  versionUpdate: false,
  share: false
});

const currentVersionInfo = computed(() => {
  return versions.value.find(v => v.version === selectedVersion.value);
});

// 加载日期列表
const loadDates = async () => {
  try {
    const res = await versionApi.getDates();
    if (res.success) {
      dates.value = res.data.dates;
      if (dates.value.length > 0 && !selectedDate.value) {
        selectedDate.value = dates.value[0];
        await loadVersions(selectedDate.value);
      }
    }
  } catch (error) {
    console.error('加载日期失败:', error);
  }
};

// 加载版本列表
const loadVersions = async (date) => {
  try {
    const res = await versionApi.getVersions(date);
    if (res.success) {
      versions.value = res.data.versions;
      if (versions.value.length > 0) {
        selectedVersion.value = versions.value[0].version;
      }
    }
  } catch (error) {
    console.error('加载版本失败:', error);
  }
};

// 加载管理人指标
const loadManagerData = async () => {
  if (!selectedVersion.value) return;
  try {
    const res = await dashboardApi.getManagerIndicator(selectedVersion.value);
    if (res.success) {
      managerData.value = res.data || {};
    }
  } catch (error) {
    console.error('加载管理人数据失败:', error);
  }
};

// 加载基金产品数据
const loadFundsData = async () => {
  if (!selectedVersion.value) return;
  try {
    const res = await dashboardApi.getFunds(selectedVersion.value);
    if (res.success) {
      fundsData.value = res.data || { funds: [], indicators: {} };
    }
  } catch (error) {
    console.error('加载基金数据失败:', error);
  }
};

// 加载投资组合数据
const loadPortfolioData = async () => {
  if (!selectedVersion.value) return;
  try {
    const res = await dashboardApi.getPortfolio(selectedVersion.value);
    if (res.success) {
      portfolioData.value = res.data || { funds: [], overall: null };
    }
  } catch (error) {
    console.error('加载投资组合数据失败:', error);
  }
};

// 加载底层资产数据
const loadUnderlyingData = async () => {
  if (!selectedVersion.value) return;
  try {
    const res = await dashboardApi.getUnderlying(selectedVersion.value);
    if (res.success) {
      underlyingData.value = res.data || { cumulative: null, current: null };
    }
  } catch (error) {
    console.error('加载底层资产数据失败:', error);
  }
};

// 加载系统配置
const loadSystemConfig = async () => {
  try {
    const res = await configApi.getIndicators();
    if (res.success) {
      systemConfig.value = res.data || {};
    }
  } catch (error) {
    console.error('加载系统配置失败:', error);
  }
};

// 日期变化
const onDateChange = async (date) => {
  await loadVersions(date);
};

// 监听版本变化，加载数据
watch(selectedVersion, () => {
  if (selectedVersion.value) {
    loadManagerData();
    loadFundsData();
    loadPortfolioData();
    loadUnderlyingData();
  }
});

// 显示操作手册
const showManual = () => {
  if (systemConfig.value.manualUrl) {
    window.open(systemConfig.value.manualUrl, '_blank');
  } else {
    Message.warning('未配置操作手册地址');
  }
};

// 显示设置
const showSettings = () => {
  modals.value.settings = true;
};

// 显示版本更新
const showVersionUpdate = () => {
  modals.value.versionUpdate = true;
};

// 显示分享
const showShare = () => {
  if (!selectedVersion.value) {
    Message.warning('请先选择版本');
    return;
  }
  modals.value.share = true;
};

// 显示在管产品清单
const showManagerFunds = () => {
  modals.value.managerFunds = true;
};

// 显示投资人名录
const showInvestors = (fund) => {
  selectedFund.value = fund;
  modals.value.investors = true;
};

// 显示基金业绩指标
const showFundPerformance = (fund) => {
  selectedFund.value = fund;
  modals.value.fundPerformance = true;
};

// 显示基金投资组合明细
const showFundPortfolio = (fund) => {
  selectedFund.value = fund;
  modals.value.fundPortfolio = true;
};

// 显示项目现金流
const showProjectCashflow = (fund) => {
  selectedFund.value = fund;
  modals.value.projectCashflow = true;
};

// 显示整体投资组合明细
const showPortfolioDetail = () => {
  modals.value.portfolioDetail = true;
};

// 显示底层企业明细
const showUnderlyingCompanies = (type) => {
  modalType.value = type;
  modals.value.underlyingCompanies = true;
};

// 显示上市企业明细
const showIpoCompanies = (type) => {
  modalType.value = type;
  modals.value.ipoCompanies = true;
};

// 显示区域企业明细
const showRegionCompanies = (type) => {
  modalType.value = type;
  modals.value.regionCompanies = true;
};

// 格式化时间
const formatTime = (time) => {
  if (!time) return '';
  const date = new Date(time);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

onMounted(() => {
  loadDates();
  loadSystemConfig();
});
</script>

<style scoped>
.performance-dashboard {
  padding: 20px;
  background: #f5f7fa;
  min-height: 100vh;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 16px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.toolbar-right {
  display: flex;
  gap: 8px;
}

.version-info {
  color: #86909c;
  font-size: 14px;
}

.system-header {
  text-align: center;
  margin-bottom: 24px;
  padding: 20px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.system-name {
  font-size: 28px;
  font-weight: 600;
  color: #1d2129;
  margin: 0 0 8px 0;
}

.system-info {
  color: #86909c;
  font-size: 14px;
}
</style>
