/**
 * 业绩看板应用 - API接口封装
 */
import axios from 'axios';
import { getCurrentUserId } from '../../utils/auth';

// 创建axios实例
const api = axios.create({
  baseURL: '/api/performance',
  headers: {
    'Content-Type': 'application/json'
  }
});

// 请求拦截器 - 添加用户ID
api.interceptors.request.use((config) => {
  const userId = getCurrentUserId();
  if (userId) {
    config.headers['X-User-Id'] = userId;
  }
  return config;
});

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error('API请求失败:', error);
    return Promise.reject(error);
  }
);

// 版本管理API
export const versionApi = {
  // 获取日期列表
  getDates: () => api.get('/versions/dates'),
  
  // 获取版本列表
  getVersions: (date) => api.get('/versions', { params: { date } }),
  
  // 获取版本历史
  getVersionHistory: (date) => api.get('/versions/history', { params: { date } }),
  
  // 创建版本
  createVersion: (data) => api.post('/versions', data),
  
  // 锁定/解锁版本
  lockVersion: (version, locked) => api.patch(`/versions/${version}/lock`, { locked }),
  
  // 删除版本
  deleteVersion: (version) => api.delete(`/versions/${version}`)
};

// 数据查询API
export const dashboardApi = {
  // 获取管理人指标
  getManagerIndicator: (version) => api.get('/dashboard/manager', { params: { version } }),
  
  // 获取在管产品清单
  getManagerFunds: (version) => api.get('/dashboard/manager-funds', { params: { version } }),
  
  // 获取基金产品指标
  getFunds: (version) => api.get('/dashboard/funds', { params: { version } }),
  
  // 获取投资人名录
  getInvestors: (version, fund) => api.get('/dashboard/investors', { params: { version, fund } }),
  
  // 获取基金业绩指标
  getFundPerformance: (version, fund) => api.get('/dashboard/fund-performance', { params: { version, fund } }),
  
  // 获取基金投资组合明细
  getFundPortfolio: (version, fund) => api.get('/dashboard/fund-portfolio', { params: { version, fund } }),
  
  // 获取项目现金流
  getProjectCashflow: (version, fund) => api.get('/dashboard/project-cashflow', { params: { version, fund } }),
  
  // 获取投资组合
  getPortfolio: (version) => api.get('/dashboard/portfolio', { params: { version } }),
  
  // 获取整体投资组合明细
  getPortfolioDetail: (version) => api.get('/dashboard/portfolio-detail', { params: { version } }),
  
  // 获取底层资产
  getUnderlying: (version) => api.get('/dashboard/underlying', { params: { version } }),
  
  // 获取底层企业明细
  getUnderlyingCompanies: (version, type) => api.get('/dashboard/underlying-companies', { params: { version, type } }),
  
  // 获取上市企业明细
  getIpoCompanies: (version, type) => api.get('/dashboard/ipo-companies', { params: { version, type } }),
  
  // 获取区域企业明细
  getRegionCompanies: (version, type) => api.get('/dashboard/region-companies', { params: { version, type } })
};

// 配置API
export const configApi = {
  // 获取指标说明配置
  getIndicators: () => api.get('/config/indicators'),
  
  // 更新指标说明配置
  updateIndicators: (data) => api.put('/config/indicators', data),
  
  // 获取SQL配置列表
  getSqlConfigs: () => api.get('/config/sql'),
  
  // 获取SQL配置详情
  getSqlConfig: (id) => api.get(`/config/sql/${id}`),
  
  // 创建SQL配置
  createSqlConfig: (data) => api.post('/config/sql', data),
  
  // 更新SQL配置
  updateSqlConfig: (id, data) => api.put(`/config/sql/${id}`, data),
  
  // 删除SQL配置
  deleteSqlConfig: (id) => api.delete(`/config/sql/${id}`),
  
  // 测试SQL配置
  testSqlConfig: (id, date) => api.post(`/config/sql/${id}/test`, { date }),
  
  // 获取数据库配置列表
  getDatabases: () => api.get('/config/databases')
};

// 导出API
export const exportApi = {
  // 导出在管产品清单
  exportManagerFunds: (version) => api.post('/exports/manager-funds', { version }, { responseType: 'blob' }),
  
  // 导出投资人名录
  exportInvestors: (version, fund) => api.post('/exports/investors', { version, fund }, { responseType: 'blob' }),
  
  // 导出基金业绩指标
  exportFundPerformance: (version, fund) => api.post('/exports/fund-performance', { version, fund }, { responseType: 'blob' }),
  
  // 导出基金投资组合明细
  exportFundPortfolio: (version, fund) => api.post('/exports/fund-portfolio', { version, fund }, { responseType: 'blob' }),
  
  // 导出项目现金流
  exportProjectCashflow: (version, fund) => api.post('/exports/project-cashflow', { version, fund }, { responseType: 'blob' }),
  
  // 导出整体投资组合明细
  exportPortfolioDetail: (version) => api.post('/exports/portfolio-detail', { version }, { responseType: 'blob' }),
  
  // 导出上市企业明细
  exportIpoCompanies: (version, type) => api.post('/exports/ipo-companies', { version, type }, { responseType: 'blob' })
};

// 分享API
export const shareApi = {
  // 创建分享链接
  createShare: (data) => api.post('/share/create', data),
  
  // 验证分享Token
  verifyShare: (token, password) => api.get('/share/verify', { params: { token, password } }),
  
  // 获取分享数据
  getShareData: (token) => api.get('/share/data', { params: { token } }),
  
  // 关闭分享链接
  closeShare: (shareToken) => api.post('/share/close', { shareToken })
};

export default {
  version: versionApi,
  dashboard: dashboardApi,
  config: configApi,
  export: exportApi,
  share: shareApi
};
