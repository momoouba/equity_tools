import React, { useState, useEffect } from 'react';
import axios from '../utils/axios';
import './PromptConfig.css';

function PromptConfig() {
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [currentPrompt, setCurrentPrompt] = useState(null);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [aiModelConfigs, setAiModelConfigs] = useState([]);
  
  const [formData, setFormData] = useState({
    prompt_name: '',
    interface_type: '新榜',
    prompt_type: 'sentiment_analysis',
    prompt_content: '',
    ai_model_config_id: '',
    is_active: 1
  });

  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0
  });

  const interfaceTypes = [
    { value: '新榜', label: '新榜接口' },
    { value: '企查查', label: '企查查接口' }
  ];

  const promptTypes = [
    { value: 'sentiment_analysis', label: '情绪分析' },
    { value: 'enterprise_relevance', label: '企业关联分析' },
    { value: 'validation', label: '关联验证' }
  ];

  useEffect(() => {
    fetchPrompts();
    fetchAiModelConfigs();
  }, [pagination.page, pagination.pageSize]);

  const fetchAiModelConfigs = async () => {
    try {
      const response = await axios.get('/api/ai-config/active');
      if (response.data.success) {
        setAiModelConfigs(response.data.data || []);
        console.log('✓ 成功获取AI模型配置列表，共', response.data.data?.length || 0, '个配置');
      } else {
        console.error('获取AI模型配置列表失败:', response.data.message);
        setError(response.data.message || '获取AI模型配置列表失败');
      }
    } catch (err) {
      console.error('获取AI模型配置列表失败:', err);
      const errorMessage = err.response?.data?.message || err.message || '获取AI模型配置列表失败';
      console.error('错误详情:', {
        status: err.response?.status,
        message: errorMessage,
        data: err.response?.data
      });
      // 不设置全局错误，避免覆盖提示词列表的错误
      // 只在控制台显示，让用户知道大模型配置加载失败
    }
  };

  const fetchPrompts = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/ai-prompt-config', {
        params: {
          page: pagination.page,
          pageSize: pagination.pageSize
        }
      });
      
      if (response.data.success) {
        setPrompts(response.data.data || []);
        setPagination(prev => ({
          ...prev,
          total: response.data.total || 0
        }));
        console.log('✓ 成功获取提示词列表，共', response.data.data?.length || 0, '条');
      } else {
        const errorMsg = response.data.message || '获取提示词列表失败';
        console.error('获取提示词列表失败:', errorMsg);
        setError(errorMsg);
      }
    } catch (err) {
      console.error('获取提示词列表失败:', err);
      const errorMessage = err.response?.data?.message || err.message || '获取提示词列表失败';
      console.error('错误详情:', {
        status: err.response?.status,
        statusText: err.response?.statusText,
        message: errorMessage,
        data: err.response?.data,
        url: err.config?.url
      });
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setCurrentPrompt(null);
    setFormData({
      prompt_name: '',
      interface_type: '新榜',
      prompt_type: 'sentiment_analysis',
      prompt_content: '',
      ai_model_config_id: '',
      is_active: 1
    });
    setShowModal(true);
  };

  const handleEdit = async (prompt) => {
    try {
      const response = await axios.get(`/api/ai-prompt-config/${prompt.id}`);
      if (response.data.success) {
        setCurrentPrompt(prompt);
        setFormData(response.data.data);
        setShowModal(true);
      }
    } catch (err) {
      setError(err.response?.data?.message || '获取提示词详情失败');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这个提示词配置吗？')) {
      return;
    }

    try {
      const response = await axios.delete(`/api/ai-prompt-config/${id}`);
      if (response.data.success) {
        fetchPrompts();
      }
    } catch (err) {
      setError(err.response?.data?.message || '删除失败');
    }
  };

  const handleToggleActive = async (id, currentActive) => {
    try {
      const response = await axios.patch(`/api/ai-prompt-config/${id}/toggle-active`);
      if (response.data.success) {
        fetchPrompts();
      }
    } catch (err) {
      setError(err.response?.data?.message || '操作失败');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      let response;
      if (currentPrompt) {
        response = await axios.put(`/api/ai-prompt-config/${currentPrompt.id}`, formData);
      } else {
        response = await axios.post('/api/ai-prompt-config', formData);
      }

      if (response.data.success) {
        setShowModal(false);
        fetchPrompts();
        setError('');
      }
    } catch (err) {
      setError(err.response?.data?.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const handleViewLogs = async (id) => {
    try {
      const response = await axios.get(`/api/ai-prompt-config/${id}/logs`);
      if (response.data.success) {
        setLogs(response.data.data);
        setShowLogModal(true);
      }
    } catch (err) {
      setError(err.response?.data?.message || '获取修改历史失败');
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) : value
    }));
  };

  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const getPromptTypeLabel = (type) => {
    return promptTypes.find(t => t.value === type)?.label || type;
  };

  const getInterfaceTypeLabel = (type) => {
    return interfaceTypes.find(t => t.value === type)?.label || type;
  };

  return (
    <div className="prompt-config-container">
      <div className="prompt-config-header">
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-primary" onClick={fetchPrompts} title="刷新列表">
            刷新
          </button>
          <button className="add-button" onClick={handleAdd}>
            新增提示词
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
              <th>提示词名称</th>
              <th>接口类型</th>
              <th>提示词类型</th>
              <th>大模型配置</th>
              <th>提示词内容预览</th>
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
            ) : prompts.length === 0 ? (
              <tr>
                <td colSpan="8" className="no-data">暂无提示词配置</td>
              </tr>
            ) : (
              prompts.map(prompt => (
                <tr key={prompt.id}>
                  <td>{prompt.prompt_name}</td>
                  <td>{getInterfaceTypeLabel(prompt.interface_type)}</td>
                  <td>{getPromptTypeLabel(prompt.prompt_type)}</td>
                  <td>
                    {prompt.ai_model_config_name ? (
                      <span title={`${prompt.provider} - ${prompt.model_name}`}>
                        {prompt.ai_model_config_name}
                      </span>
                    ) : (
                      <span style={{ color: '#999' }}>未配置</span>
                    )}
                  </td>
                  <td>
                    <div className="prompt-preview">
                      {prompt.prompt_content_preview || prompt.prompt_content || ''}
                      {(prompt.prompt_content_preview || prompt.prompt_content || '').length > 100 ? '...' : ''}
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${prompt.is_active ? 'active' : 'inactive'}`}>
                      {prompt.is_active ? '启用' : '禁用'}
                    </span>
                  </td>
                  <td>{new Date(prompt.created_at).toLocaleString()}</td>
                  <td>
                    <div className="action-buttons">
                      <button 
                        className="btn-edit" 
                        onClick={() => handleEdit(prompt)}
                        title="编辑"
                      >
                        编辑
                      </button>
                      <button 
                        className={prompt.is_active ? 'btn-deactivate' : 'btn-activate'}
                        onClick={() => handleToggleActive(prompt.id, prompt.is_active)}
                        title={prompt.is_active ? '禁用' : '启用'}
                      >
                        {prompt.is_active ? '禁用' : '启用'}
                      </button>
                      <button 
                        className="btn-log" 
                        onClick={() => handleViewLogs(prompt.id)}
                        title="查看修改历史"
                      >
                        日志
                      </button>
                      <button 
                        className="btn-delete" 
                        onClick={() => handleDelete(prompt.id)}
                        title="删除"
                      >
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

      {showModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h3>{currentPrompt ? '编辑提示词' : '新增提示词'}</h3>
              <button className="close-btn" onClick={() => setShowModal(false)}>×</button>
            </div>

            <form onSubmit={handleSubmit} className="config-form">
              <div className="form-row">
                <div className="form-group">
                  <label>提示词名称 *</label>
                  <input
                    type="text"
                    name="prompt_name"
                    value={formData.prompt_name}
                    onChange={handleInputChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>接口类型 *</label>
                  <select
                    name="interface_type"
                    value={formData.interface_type}
                    onChange={handleInputChange}
                    required
                  >
                    {interfaceTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>提示词类型 *</label>
                  <select
                    name="prompt_type"
                    value={formData.prompt_type}
                    onChange={handleInputChange}
                    required
                  >
                    {promptTypes.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>大模型配置 *</label>
                  <select
                    name="ai_model_config_id"
                    value={formData.ai_model_config_id}
                    onChange={handleInputChange}
                    required
                    disabled={aiModelConfigs.length === 0}
                  >
                    <option value="">
                      {aiModelConfigs.length === 0 ? '暂无启用的AI模型配置，请先在AI模型配置管理中创建并启用' : '请选择大模型配置'}
                    </option>
                    {aiModelConfigs.map(config => (
                      <option key={config.id} value={config.id}>
                        {config.config_name} ({config.provider} - {config.model_name})
                      </option>
                    ))}
                  </select>
                  {aiModelConfigs.length === 0 && (
                    <div style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '4px' }}>
                      提示：请先在"AI模型配置管理"中创建并启用至少一个AI模型配置
                    </div>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label>提示词内容 *</label>
                <textarea
                  name="prompt_content"
                  value={formData.prompt_content}
                  onChange={handleInputChange}
                  required
                  rows={15}
                  style={{ width: '100%', padding: '8px 12px', fontFamily: 'monospace', fontSize: '13px' }}
                  placeholder="请输入提示词内容，可以使用变量如：{'${title}'}、{'${content}'}等"
                />
                <div className="form-hint">
                  提示：可以使用变量占位符，如 {'${title}'}、{'${content}'}、{'${sourceUrl}'}、{'${enterpriseList}'} 等
                </div>
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    name="is_active"
                    checked={formData.is_active === 1}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      is_active: e.target.checked ? 1 : 0
                    }))}
                  />
                  启用配置
                </label>
              </div>

              <div className="form-actions">
                <button type="button" onClick={() => setShowModal(false)}>
                  取消
                </button>
                <button type="submit" disabled={loading}>
                  {loading ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showLogModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '900px' }}>
            <div className="modal-header">
              <h3>提示词修改历史</h3>
              <button className="close-btn" onClick={() => setShowLogModal(false)}>×</button>
            </div>

            <div className="log-content">
              {logs.length === 0 ? (
                <div className="no-data">暂无修改历史</div>
              ) : (
                <table className="log-table">
                  <thead>
                    <tr>
                      <th>变更时间</th>
                      <th>变更类型</th>
                      <th>变更人</th>
                      <th>变更原因</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(log => (
                      <tr key={log.id}>
                        <td>{new Date(log.change_time).toLocaleString()}</td>
                        <td>
                          <span className={`log-type log-type-${log.change_type}`}>
                            {log.change_type === 'create' ? '创建' :
                             log.change_type === 'update' ? '更新' :
                             log.change_type === 'delete' ? '删除' :
                             log.change_type === 'activate' ? '启用' :
                             log.change_type === 'deactivate' ? '禁用' : log.change_type}
                          </span>
                        </td>
                        <td>{log.change_user_name || '系统'}</td>
                        <td>{log.change_reason || '-'}</td>
                        <td>
                          <button 
                            className="btn-view-detail"
                            onClick={() => {
                              const detail = {
                                oldValue: log.old_value ? JSON.parse(log.old_value) : null,
                                newValue: log.new_value ? JSON.parse(log.new_value) : null
                              };
                              alert(`旧值：\n${JSON.stringify(detail.oldValue, null, 2)}\n\n新值：\n${JSON.stringify(detail.newValue, null, 2)}`);
                            }}
                          >
                            查看详情
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PromptConfig;

