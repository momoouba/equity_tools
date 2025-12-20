import React, { useState, useEffect } from 'react';
import axios from '../utils/axios';
import PromptConfig from './PromptConfig';
import './AIConfig.css';

function AIConfig() {
  const [activeSubTab, setActiveSubTab] = useState('model');
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [currentConfig, setCurrentConfig] = useState(null);
  const [availableModels, setAvailableModels] = useState({});
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    config_name: '',
    provider: 'alibaba',
    model_name: '',
    api_type: 'chat',
    api_key: '',
    api_endpoint: '',
    temperature: 0.7,
    max_tokens: 2000,
    top_p: 1.0,
    application_type: 'news_analysis',
    usage_type: 'content_analysis',
    is_active: 1
  });

  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0
  });

  const providers = [
    { value: 'alibaba', label: '阿里云（千问）' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'baidu', label: '百度（文心一言）' },
    { value: 'tencent', label: '腾讯（混元）' }
  ];

  const apiTypes = [
    { value: 'chat', label: 'Chat API' },
    { value: 'completion', label: 'Completion API' },
    { value: 'chat_completion', label: 'Chat Completion API' }
  ];

  const applicationTypes = [
    { value: 'news_analysis', label: '新闻分析' },
    { value: 'general', label: '通用' }
  ];

  const usageTypes = [
    { value: 'content_analysis', label: '情绪分析' },
    { value: 'image_recognition', label: '图片识别' }
  ];

  useEffect(() => {
    fetchConfigs();
    fetchAvailableModels();
  }, [pagination.page, pagination.pageSize]);

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/ai-config', {
        params: {
          page: pagination.page,
          pageSize: pagination.pageSize
        }
      });
      
      if (response.data.success) {
        setConfigs(response.data.data);
        setPagination(prev => ({
          ...prev,
          total: response.data.total
        }));
      }
    } catch (err) {
      setError(err.response?.data?.message || '获取配置列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableModels = async () => {
    try {
      const response = await axios.get('/api/ai-config/models/available');
      if (response.data.success) {
        setAvailableModels(response.data.data);
      }
    } catch (err) {
      console.error('获取可用模型列表失败:', err);
    }
  };

  const handleAdd = () => {
    setCurrentConfig(null);
    setFormData({
      config_name: '',
      provider: 'alibaba',
      model_name: '',
      api_type: 'chat',
      api_key: '',
      api_endpoint: '',
      temperature: 0.7,
      max_tokens: 2000,
      top_p: 1.0,
      application_type: 'news_analysis',
      usage_type: 'content_analysis',
      is_active: 1
    });
    setTestResult(null);
    setShowModal(true);
  };

  const handleEdit = async (config) => {
    try {
      const response = await axios.get(`/api/ai-config/${config.id}`);
      if (response.data.success) {
        setCurrentConfig(config);
        setFormData(response.data.data);
        setTestResult(null);
        setShowModal(true);
      }
    } catch (err) {
      setError(err.response?.data?.message || '获取配置详情失败');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这个配置吗？')) {
      return;
    }

    try {
      const response = await axios.delete(`/api/ai-config/${id}`);
      if (response.data.success) {
        fetchConfigs();
      }
    } catch (err) {
      setError(err.response?.data?.message || '删除失败');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      let response;
      if (currentConfig) {
        response = await axios.put(`/api/ai-config/${currentConfig.id}`, formData);
      } else {
        response = await axios.post('/api/ai-config', formData);
      }

      if (response.data.success) {
        setShowModal(false);
        fetchConfigs();
        setError('');
      }
    } catch (err) {
      setError(err.response?.data?.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!currentConfig && !formData.id) {
      setError('请先保存配置后再测试');
      return;
    }

    setTestLoading(true);
    setTestResult(null);

    try {
      const configId = currentConfig?.id || formData.id;
      const response = await axios.post(`/api/ai-config/${configId}/test`);
      
      if (response.data.success) {
        setTestResult({
          success: true,
          message: '测试成功',
          data: response.data.data
        });
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err.response?.data?.message || '测试失败'
      });
    } finally {
      setTestLoading(false);
    }
  };

  const handleTestConfig = async (configId) => {
    setTestLoading(true);
    setTestResult(null);
    setError('');

    try {
      // 调试：检查用户信息
      const userStr = localStorage.getItem('user');
      console.log('用户信息:', userStr);
      
      const response = await axios.post(`/api/ai-config/${configId}/test`);
      
      if (response.data.success) {
        setTestResult({
          success: true,
          message: '测试成功',
          data: response.data.data
        });
      }
    } catch (err) {
      console.error('测试请求失败:', err);
      console.error('错误详情:', err.response);
      setError(err.response?.data?.message || err.message || '测试失败');
    } finally {
      setTestLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) : value
    }));
  };

  const handleProviderChange = (e) => {
    const provider = e.target.value;
    setFormData(prev => ({
      ...prev,
      provider,
      model_name: '', // 重置模型名称
      api_endpoint: getDefaultEndpoint(provider, prev.usage_type)
    }));
  };

  const handleModelNameChange = (e) => {
    const modelName = e.target.value;
    setFormData(prev => ({
      ...prev,
      model_name: modelName,
      // 如果是视觉模型，自动设置正确的端点
      api_endpoint: getDefaultEndpoint(prev.provider, prev.usage_type, modelName)
    }));
  };

  const handleUsageTypeChange = (e) => {
    const usageType = e.target.value;
    setFormData(prev => ({
      ...prev,
      usage_type: usageType,
      // 如果是图片识别，自动设置正确的端点
      api_endpoint: getDefaultEndpoint(prev.provider, usageType, prev.model_name)
    }));
  };

  const getDefaultEndpoint = (provider, usageType = 'content_analysis', modelName = '') => {
    // 检查是否是视觉模型
    const isVisionModel = usageType === 'image_recognition' || 
                         (modelName && (modelName.toLowerCase().includes('vl') || modelName.toLowerCase().includes('vision')));
    
    const endpoints = {
      alibaba: isVisionModel 
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
        : 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      openai: 'https://api.openai.com/v1/chat/completions',
      baidu: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions',
      tencent: 'https://hunyuan.tencentcloudapi.com/'
    };
    return endpoints[provider] || '';
  };

  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  return (
    <div className="ai-config-container">
      <div className="ai-config-header">
        <h2>AI模型配置管理</h2>
      </div>

      <div className="config-tabs">
        <button
          className={`tab-button ${activeSubTab === 'model' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('model')}
        >
          AI模型配置管理
        </button>
        <button
          className={`tab-button ${activeSubTab === 'prompt' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('prompt')}
        >
          模型提示词设置
        </button>
      </div>

      {activeSubTab === 'model' && (
        <div>
          <div className="ai-config-header">
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-primary" onClick={fetchConfigs} title="刷新列表">
            刷新
          </button>
          <button className="add-button" onClick={handleAdd}>
            新增配置
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      <div className="config-table-container">
        <table className="config-table">
          <thead>
            <tr>
              <th>配置名称</th>
              <th>提供商</th>
              <th>模型名称</th>
              <th>应用类型</th>
              <th>用途类型</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8" className="loading">加载中...</td>
              </tr>
            ) : configs.length === 0 ? (
              <tr>
                <td colSpan="8" className="no-data">暂无配置</td>
              </tr>
            ) : (
              configs.map(config => (
                <tr key={config.id}>
                  <td>{config.config_name}</td>
                  <td>{providers.find(p => p.value === config.provider)?.label || config.provider}</td>
                  <td>{config.model_name}</td>
                  <td>{applicationTypes.find(t => t.value === config.application_type)?.label || config.application_type}</td>
                  <td>{usageTypes.find(t => t.value === config.usage_type)?.label || config.usage_type || '内容分析'}</td>
                  <td>
                    <span className={`status-badge ${config.is_active ? 'active' : 'inactive'}`}>
                      {config.is_active ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td>{new Date(config.created_at).toLocaleString()}</td>
                  <td>
                    <div className="action-buttons">
                      <button className="btn-test" onClick={() => handleTestConfig(config.id)}>
                        测试
                      </button>
                      <button className="btn-edit" onClick={() => handleEdit(config)}>
                        编辑
                      </button>
                      <button className="btn-delete" onClick={() => handleDelete(config.id)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {pagination.total > 0 && (
          <div className="pagination">
            <button 
              disabled={pagination.page === 1}
              onClick={() => handlePageChange(pagination.page - 1)}
            >
              上一页
            </button>
            <span>
              第 {pagination.page} 页，共 {Math.ceil(pagination.total / pagination.pageSize)} 页
            </span>
            <button 
              disabled={pagination.page >= Math.ceil(pagination.total / pagination.pageSize)}
              onClick={() => handlePageChange(pagination.page + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </div>

      {testResult && (
        <div className={`test-result-global ${testResult.success ? 'success' : 'error'}`}>
          <h4>API测试结果</h4>
          <p>{testResult.message}</p>
          {testResult.data && (
            <div className="test-details">
              <p><strong>模型响应:</strong> {testResult.data.model_response}</p>
              <p><strong>响应时间:</strong> {testResult.data.response_time}</p>
              {testResult.data.token_usage && (
                <p><strong>Token使用:</strong> {JSON.stringify(testResult.data.token_usage)}</p>
              )}
            </div>
          )}
          <button className="close-test-result" onClick={() => setTestResult(null)}>
            关闭
          </button>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{currentConfig ? '编辑配置' : '新增配置'}</h3>
              <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
            </div>

            <form onSubmit={handleSubmit} className="config-form">
              <div className="form-row">
                <div className="form-group">
                  <label>配置名称 *</label>
                  <input
                    type="text"
                    name="config_name"
                    value={formData.config_name}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>提供商 *</label>
                  <select
                    name="provider"
                    value={formData.provider}
                    onChange={handleProviderChange}
                    required
                  >
                    {providers.map(provider => (
                      <option key={provider.value} value={provider.value}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>模型名称 *</label>
                  <select
                    name="model_name"
                    value={formData.model_name}
                    onChange={handleModelNameChange}
                    required
                  >
                    <option value="">请选择模型</option>
                    {availableModels[formData.provider]?.map(model => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>API类型 *</label>
                  <select
                    name="api_type"
                    value={formData.api_type}
                    onChange={handleInputChange}
                    required
                  >
                    {apiTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>API密钥 *</label>
                <input
                  type="password"
                  name="api_key"
                  value={formData.api_key}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div className="form-group">
                <label>API端点 *</label>
                <input
                  type="url"
                  name="api_endpoint"
                  value={formData.api_endpoint}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>温度 (0.0-2.0)</label>
                  <input
                    type="number"
                    name="temperature"
                    value={formData.temperature}
                    onChange={handleInputChange}
                    min="0"
                    max="2"
                    step="0.1"
                  />
                </div>
                <div className="form-group">
                  <label>最大Token数</label>
                  <input
                    type="number"
                    name="max_tokens"
                    value={formData.max_tokens}
                    onChange={handleInputChange}
                    min="1"
                    max="32000"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Top P (0.0-1.0)</label>
                  <input
                    type="number"
                    name="top_p"
                    value={formData.top_p}
                    onChange={handleInputChange}
                    min="0"
                    max="1"
                    step="0.1"
                  />
                </div>
                <div className="form-group">
                  <label>应用类型</label>
                  <select
                    name="application_type"
                    value={formData.application_type}
                    onChange={handleInputChange}
                  >
                    {applicationTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>用途类型 *</label>
                  <select
                    name="usage_type"
                    value={formData.usage_type}
                    onChange={handleUsageTypeChange}
                    required
                  >
                    <option value="">请选择用途类型</option>
                    {usageTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
              <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', marginTop: '25px' }}>
                  <input
                    type="checkbox"
                    name="is_active"
                    checked={formData.is_active === 1}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      is_active: e.target.checked ? 1 : 0
                    }))}
                      style={{ marginRight: '8px' }}
                  />
                  启用配置
                </label>
                </div>
              </div>

              {testResult && (
                <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                  <h4>测试结果</h4>
                  <p>{testResult.message}</p>
                  {testResult.data && (
                    <div className="test-details">
                      <p><strong>模型响应:</strong> {testResult.data.model_response}</p>
                      <p><strong>响应时间:</strong> {testResult.data.response_time}</p>
                      {testResult.data.token_usage && (
                        <p><strong>Token使用:</strong> {JSON.stringify(testResult.data.token_usage)}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="form-actions">
                <button type="button" onClick={() => setShowModal(false)}>
                  取消
                </button>
                <button 
                  type="button" 
                  onClick={handleTest}
                  disabled={testLoading}
                  className="test-btn"
                >
                  {testLoading ? '测试中...' : '测试连接'}
                </button>
                <button type="submit" disabled={loading}>
                  {loading ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
        </div>
      )}

      {activeSubTab === 'prompt' && (
        <PromptConfig />
      )}
    </div>
  );
}

export default AIConfig;
