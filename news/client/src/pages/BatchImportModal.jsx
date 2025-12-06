import React, { useState } from 'react'
import axios from '../utils/axios'
import './BatchImportModal.css'

function BatchImportModal({ onClose, onSuccess }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState([])

  const handleDownloadTemplate = async () => {
    try {
      const response = await axios.get('/api/enterprises/batch-import/template', {
        responseType: 'blob'
      })
      
      // 检查响应类型
      if (response.data instanceof Blob) {
        const url = window.URL.createObjectURL(response.data)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', '被投企业批量导入模板.xlsx')
        document.body.appendChild(link)
        link.click()
        link.parentNode.removeChild(link)
        window.URL.revokeObjectURL(url)
      } else {
        // 如果返回的是错误信息（JSON格式）
        const text = await response.data.text()
        try {
          const errorData = JSON.parse(text)
          alert(errorData.message || '模板下载失败，请稍后再试')
        } catch {
          alert('模板下载失败，请稍后再试')
        }
      }
    } catch (error) {
      console.error('模板下载错误:', error)
      if (error.response?.data) {
        // 如果是 blob 类型的错误响应，需要先读取
        if (error.response.data instanceof Blob) {
          try {
            const text = await error.response.data.text()
            const errorData = JSON.parse(text)
            alert(errorData.message || '模板下载失败，请稍后再试')
          } catch {
            alert('模板下载失败，请稍后再试')
          }
        } else {
          alert(error.response.data.message || '模板下载失败，请稍后再试')
        }
      } else {
        alert('模板下载失败，请稍后再试')
      }
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0]
    setSelectedFile(file || null)
    setMessage('')
    setErrors([])
  }

  const handleUpload = async () => {
    if (!selectedFile) {
      setMessage('请选择要上传的文件')
      return
    }

    const formData = new FormData()
    formData.append('file', selectedFile)

    setUploading(true)
    setMessage('')
    setErrors([])

    try {
      const response = await axios.post('/api/enterprises/batch-import/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      setMessage(response.data.message)
      setErrors(response.data.errors || [])

      if (response.data.success) {
        onSuccess()
      }
    } catch (error) {
      setMessage(error.response?.data?.message || '上传失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content batch-import-modal">
        <div className="modal-header">
          <h3>批量导入被投企业</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="batch-modal-body">
          <section className="template-section">
            <h4>1. 下载模板</h4>
            <p>请先下载模板，按照模板要求填写企业信息，表头不可修改。</p>
            <button className="btn-primary" onClick={handleDownloadTemplate}>
              下载模板
            </button>
            <p className="template-tip">模板包含以下字段：项目简称、被投企业全称、统一信用代码、企业公众号id、企业官网、退出状态（未退出/部分退出/完全退出/继续观察）。</p>
          </section>

          <section className="upload-section">
            <h4>2. 上传文件</h4>
            <p>选择填写好的 Excel 文件进行导入，仅支持 .xlsx/.xls 格式。</p>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
            />
            {selectedFile && (
              <p className="selected-file">已选择：{selectedFile.name}</p>
            )}
            <button
              className="btn-primary"
              onClick={handleUpload}
              disabled={uploading}
            >
              {uploading ? '上传中...' : '上传导入'}
            </button>
          </section>

          {message && (
            <div className="batch-message">
              {message}
            </div>
          )}

          {errors.length > 0 && (
            <div className="batch-errors">
              <p>以下数据导入失败：</p>
              <ul>
                {errors.map((err) => (
                  <li key={err.row}>
                    第 {err.row} 行：{err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="form-actions">
          <button className="btn-cancel" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

export default BatchImportModal

