import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Input, Form, Upload } from '@arco-design/web-react'
import axios from '../utils/axios'
import './QichachaNewsCategoryList.css'

const InputSearch = Input.Search

function QichachaNewsCategoryList() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 50
  const [showForm, setShowForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [form] = Form.useForm()
  const [searchKeyword, setSearchKeyword] = useState('')
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importing, setImporting] = useState(false)

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
      Message.error('获取类别列表失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingCategory(null)
    form.resetFields()
    setShowForm(true)
  }

  const handleEdit = (category) => {
    setEditingCategory(category)
    form.setFieldsValue({
      category_code: category.category_code,
      category_name: category.category_name
    })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个类别吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/system/qichacha-news-category/${id}`)
          if (response.data.success) {
            Message.success('删除成功')
            fetchCategories()
          }
        } catch (error) {
          console.error('删除失败:', error)
          Message.error('删除失败：' + (error.response?.data?.message || '未知错误'))
        }
      }
    })
  }

  const handleSubmit = async (values) => {
    try {
      let response
      if (editingCategory) {
        response = await axios.put(`/api/system/qichacha-news-category/${editingCategory.id}`, values)
      } else {
        response = await axios.post('/api/system/qichacha-news-category', values)
      }

      if (response.data.success) {
        Message.success(editingCategory ? '更新成功' : '创建成功')
        setShowForm(false)
        setEditingCategory(null)
        form.resetFields()
        fetchCategories()
      }
    } catch (error) {
      console.error('保存失败:', error)
      Message.error('保存失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleImport = async () => {
    if (!importFile) {
      Message.warning('请选择要导入的Excel文件')
      return
    }

    setImporting(true)
    const formData = new FormData()
    formData.append('file', importFile)

    try {
      const response = await axios.post('/api/system/qichacha-news-categories/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      if (response.data.success) {
        Message.success(`导入成功：成功 ${response.data.success_count || 0} 条，失败 ${response.data.fail_count || 0} 条`)
        setShowImportModal(false)
        setImportFile(null)
        fetchCategories()
      } else {
        Message.error('导入失败：' + (response.data.message || '未知错误'))
      }
    } catch (error) {
      console.error('导入失败:', error)
      Message.error('导入失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setImporting(false)
    }
  }

  const columns = [
    {
      title: '类别代码',
      dataIndex: 'category_code',
      width: 200
    },
    {
      title: '类别名称',
      dataIndex: 'category_name',
      width: 300
    },
    {
      title: '操作',
      width: 150,
      render: (_, record) => (
        <Space size={8}>
          <Button
            type="outline"
            size="small"
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="outline"
            size="small"
            status="danger"
            onClick={() => handleDelete(record.id)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div className="qichacha-news-category-list">
      <div className="list-header">
        <h3>企查查新闻类别列表</h3>
        <Space>
          <InputSearch
            value={searchKeyword}
            onChange={(value) => setSearchKeyword(value)}
            onSearch={fetchCategories}
            placeholder="搜索类别代码或名称"
            style={{ width: 300 }}
            allowClear
          />
          <Button
            onClick={fetchCategories}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            onClick={handleAdd}
          >
            新增类别
          </Button>
          <Button
            type="outline"
            onClick={() => setShowImportModal(true)}
          >
            批量导入
          </Button>
        </Space>
      </div>

      <div className="table-container">
        {loading && categories.length === 0 ? (
          <Skeleton
            loading={true}
            animation={true}
            text={{ rows: 8, width: ['100%'] }}
          />
        ) : (
          <Table
            columns={columns}
            data={categories}
            loading={loading}
            pagination={false}
            rowKey="id"
            border={{
              wrapper: true,
              cell: true
            }}
            stripe
          />
        )}
      </div>

      {/* 分页 */}
      {total > 0 && (
        <div className="pagination-wrapper">
          <Pagination
            current={currentPage}
            total={total}
            pageSize={pageSize}
            onChange={(page) => setCurrentPage(page)}
            showTotal
            showJumper
          />
        </div>
      )}

      {/* 新增/编辑表单 */}
      <Modal
        visible={showForm}
        title={editingCategory ? '编辑类别' : '新增类别'}
        onCancel={() => {
          setShowForm(false)
          setEditingCategory(null)
          form.resetFields()
        }}
        footer={null}
        style={{ width: 500 }}
      >
        <Form
          form={form}
          onSubmit={handleSubmit}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            label="类别代码"
            field="category_code"
            rules={[{ required: true, message: '请输入类别代码' }]}
          >
            <Input placeholder="请输入类别代码" />
          </Form.Item>

          <Form.Item
            label="类别名称"
            field="category_name"
            rules={[{ required: true, message: '请输入类别名称' }]}
          >
            <Input placeholder="请输入类别名称" />
          </Form.Item>

          <div className="form-actions">
            <Button type="secondary" onClick={() => {
              setShowForm(false)
              setEditingCategory(null)
              form.resetFields()
            }}>
              取消
            </Button>
            <Button type="primary" htmlType="submit">
              {editingCategory ? '更新' : '创建'}
            </Button>
          </div>
        </Form>
      </Modal>

      {/* 批量导入弹窗 */}
      <Modal
        visible={showImportModal}
        title="批量导入类别"
        onCancel={() => {
          setShowImportModal(false)
          setImportFile(null)
        }}
        footer={null}
        style={{ width: 500 }}
      >
        <div className="import-content">
          <p>请上传Excel文件，格式要求：</p>
          <ul>
            <li>第一列：类别代码</li>
            <li>第二列：类别名称</li>
          </ul>
          <Upload
            accept=".xlsx,.xls"
            fileList={importFile ? [importFile] : []}
            onChange={(fileList) => {
              setImportFile(fileList[0]?.originFile || null)
            }}
            beforeUpload={() => false}
          >
            <Button type="outline">选择文件</Button>
          </Upload>
          <div className="form-actions">
            <Button type="secondary" onClick={() => {
              setShowImportModal(false)
              setImportFile(null)
            }}>
              取消
            </Button>
            <Button
              type="primary"
              onClick={handleImport}
              loading={importing}
              disabled={!importFile}
            >
              导入
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default QichachaNewsCategoryList

