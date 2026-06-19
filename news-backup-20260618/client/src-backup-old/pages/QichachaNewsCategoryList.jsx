import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import Pagination from '../components/Pagination'
import './EmailConfig.css'

function QichachaNewsCategoryList() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 50
  const [showForm, setShowForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [formData, setFormData] = useState({
    category_code: '',
    category_name: ''
  })
  const [searchKeyword, setSearchKeyword] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)

  useEffect(() => {
    fetchCategories()
  }, [currentPage, searchKeyword])

  const fetchCategories = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/system/qichacha-news-categories', {
        params: {
          page: currentPage,
          pageSize: pageSize,
          search: searchKeyword || undefined
        }
      })
      if (response.data.success) {
        setCategories(response.data.data)
        setTotal(response.data.total || 0)
      }
    } catch (error) {
      console.error('获取企查查新闻类别列表失败:', error)
      alert('获取类别列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingCategory(null)
    setFormData({
      category_code: '',
      category_name: ''
    })
    setShowForm(true)
  }

  const handleEdit = (category) => {
    setEditingCategory(category)
    setFormData({
      category_code: category.category_code,
      category_name: category.category_name
    })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这个类别吗？')) {
      return
    }

    try {
      const response = await axios.delete(`/api/system/qichacha-news-category/${id}`)
      if (response.data.success) {
        alert('删除成功')
        fetchCategories()
      }
    } catch (error) {
      console.error('删除失败:', error)
      alert('删除失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({
      ...formData,
      [name]: value
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.category_code || !formData.category_name) {
      alert('请填写所有必填字段')
      return
    }

    try {
      let response
      if (editingCategory) {
        response = await axios.put(`/api/system/qichacha-news-category/${editingCategory.id}`, formData)
      } else {
        response = await axios.post('/api/system/qichacha-news-category', formData)
      }

      if (response.data.success) {
        alert(editingCategory ? '更新成功' : '创建成功')
        setShowForm(false)
        setEditingCategory(null)
        fetchCategories()
      }
    } catch (error) {
      console.error('保存失败:', error)
      alert('保存失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleImport = () => {
    setImportFile(null)
    setImportResult(null)
    setShowImportModal(true)
  }

  const handleDownloadTemplate = () => {
    window.open('/api/system/qichacha-news-categories/template', '_blank')
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      // 验证文件类型
      const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      ]
      if (!validTypes.includes(file.type) && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
        alert('请上传Excel文件（.xlsx或.xls格式）')
        e.target.value = ''
        return
      }
      setImportFile(file)
    }
  }

  const handleImportSubmit = async () => {
    if (!importFile) {
      alert('请选择要导入的Excel文件')
      return
    }

    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', importFile)

      const response = await axios.post('/api/system/qichacha-news-categories/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      if (response.data.success) {
        setImportResult(response.data.data)
        // 不关闭弹窗，显示结果
        fetchCategories()
      } else {
        alert('导入失败：' + (response.data.message || '未知错误'))
      }
    } catch (error) {
      console.error('导入失败:', error)
      alert('导入失败：' + (error.response?.data?.message || error.message || '未知错误'))
    } finally {
      setImporting(false)
    }
  }

  const handleCloseImportModal = () => {
    setShowImportModal(false)
    setImportFile(null)
    setImportResult(null)
  }

  const formatDate = (dateString) => {
    if (!dateString) return '-'
    try {
      const date = new Date(dateString)
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch (e) {
      return dateString
    }
  }

  return (
    <div className="email-config">
      <div className="config-header">
        <h3>企查查新闻类别列表</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="搜索类别编码或描述"
            value={searchKeyword}
            onChange={(e) => {
              setSearchKeyword(e.target.value)
              setCurrentPage(1)
            }}
            style={{
              padding: '6px 12px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '14px',
              width: '200px'
            }}
          />
          <button className="btn-primary" onClick={fetchCategories} title="刷新列表">
            刷新
          </button>
          <button className="btn-primary" onClick={handleDownloadTemplate}>
            下载模板
          </button>
          <button className="btn-primary" onClick={handleImport}>
            导入
          </button>
          <button className="btn-primary" onClick={handleAdd}>
            新增类别
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : categories.length === 0 ? (
        <div className="empty-data">暂无企查查新闻类别</div>
      ) : (
        <table className="config-table">
          <thead>
            <tr>
              <th>类别编码</th>
              <th>类别描述</th>
              <th>创建时间</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <td>{category.category_code}</td>
                <td>{category.category_name}</td>
                <td>{formatDate(category.created_at)}</td>
                <td>{formatDate(category.updated_at)}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="btn-edit"
                      onClick={() => handleEdit(category)}
                    >
                      编辑
                    </button>
                    <button
                      className="btn-delete"
                      onClick={() => handleDelete(category.id)}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 分页 */}
      {total > 0 && (() => {
        const totalPages = Math.ceil(total / pageSize)
        return totalPages > 1 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )
      })()}

      {/* 新增/编辑表单 */}
      {showForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>{editingCategory ? '编辑企查查新闻类别' : '新增企查查新闻类别'}</h3>
              <button className="close-btn" onClick={() => {
                setShowForm(false)
                setEditingCategory(null)
              }}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>类别编码 *</label>
                  <input
                    type="text"
                    name="category_code"
                    value={formData.category_code}
                    onChange={handleChange}
                    placeholder="请输入类别编码，如：10000"
                    required
                    disabled={!!editingCategory}
                  />
                  <p className="form-hint">{editingCategory ? '编辑时不能修改类别编码' : '类别编码必须唯一'}</p>
                </div>

                <div className="form-group">
                  <label>类别描述 *</label>
                  <input
                    type="text"
                    name="category_name"
                    value={formData.category_name}
                    onChange={handleChange}
                    placeholder="请输入类别描述，如：信用预警"
                    required
                  />
                </div>

                <div className="form-actions">
                  <button type="button" onClick={() => {
                    setShowForm(false)
                    setEditingCategory(null)
                  }}>
                    取消
                  </button>
                  <button type="submit">
                    {editingCategory ? '更新' : '创建'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 导入弹窗 */}
      {showImportModal && (
        <div className="modal-overlay" style={{ zIndex: 1001 }}>
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>导入企查查新闻类别</h3>
              <button className="close-btn" onClick={handleCloseImportModal}>×</button>
            </div>
            <div className="modal-body">
              {!importResult ? (
                <>
                  <div className="form-group">
                    <label>选择Excel文件 *</label>
                    <input
                      type="file"
                      accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      onChange={handleFileChange}
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '14px'
                      }}
                    />
                    <p className="form-hint">
                      请上传Excel文件，格式：第一行为表头（类别编号、类别描述），从第二行开始为数据
                    </p>
                    {importFile && (
                      <p style={{ marginTop: '8px', color: '#28a745', fontSize: '14px' }}>
                        已选择文件：{importFile.name}
                      </p>
                    )}
                  </div>
                  <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                    <p style={{ margin: '0 0 8px 0', fontWeight: 'bold' }}>使用说明：</p>
                    <ol style={{ margin: '0', paddingLeft: '20px' }}>
                      <li>点击"下载模板"按钮下载Excel模板</li>
                      <li>按照模板格式填写类别数据</li>
                      <li>上传填写好的Excel文件</li>
                      <li>系统会自动检测重复的类别编号，重复的将不会导入</li>
                    </ol>
                  </div>
                  <div className="form-actions">
                    <button type="button" onClick={handleCloseImportModal}>
                      取消
                    </button>
                    <button 
                      type="button" 
                      onClick={handleImportSubmit} 
                      disabled={!importFile || importing}
                      style={{ backgroundColor: '#007bff' }}
                    >
                      {importing ? '导入中...' : '导入'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ marginBottom: '16px' }}>
                    <h4 style={{ color: '#28a745', marginBottom: '12px' }}>
                      导入完成！
                    </h4>
                    <div style={{ marginBottom: '12px' }}>
                      <p style={{ fontSize: '16px', fontWeight: 'bold', color: '#28a745' }}>
                        成功导入：{importResult.success} 条
                      </p>
                    </div>
                    {importResult.duplicate && importResult.duplicate.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <p style={{ fontSize: '14px', fontWeight: 'bold', color: '#ffc107', marginBottom: '8px' }}>
                          重复的类别（未导入）：{importResult.duplicate.length} 条
                        </p>
                        <div style={{ 
                          maxHeight: '200px', 
                          overflowY: 'auto', 
                          border: '1px solid #ddd', 
                          borderRadius: '4px', 
                          padding: '8px',
                          backgroundColor: '#fff3cd'
                        }}>
                          <table style={{ width: '100%', fontSize: '12px' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #ddd' }}>
                                <th style={{ padding: '4px', textAlign: 'left' }}>行号</th>
                                <th style={{ padding: '4px', textAlign: 'left' }}>类别编号</th>
                                <th style={{ padding: '4px', textAlign: 'left' }}>类别描述</th>
                              </tr>
                            </thead>
                            <tbody>
                              {importResult.duplicate.map((item, index) => (
                                <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                                  <td style={{ padding: '4px' }}>{item.row}</td>
                                  <td style={{ padding: '4px' }}>{item.category_code}</td>
                                  <td style={{ padding: '4px' }}>{item.category_name}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {importResult.errors && importResult.errors.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <p style={{ fontSize: '14px', fontWeight: 'bold', color: '#dc3545', marginBottom: '8px' }}>
                          导入失败：{importResult.errors.length} 条
                        </p>
                        <div style={{ 
                          maxHeight: '150px', 
                          overflowY: 'auto', 
                          border: '1px solid #ddd', 
                          borderRadius: '4px', 
                          padding: '8px',
                          backgroundColor: '#f8d7da'
                        }}>
                          {importResult.errors.map((error, index) => (
                            <p key={index} style={{ margin: '4px 0', fontSize: '12px' }}>
                              第{error.row}行：{error.category_code} - {error.message}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="form-actions">
                    <button 
                      type="button" 
                      onClick={handleCloseImportModal}
                      style={{ backgroundColor: '#007bff' }}
                    >
                      确定
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default QichachaNewsCategoryList

