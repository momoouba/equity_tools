import React, { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Form,
  Input,
  InputNumber,
  Message,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Tag
} from '@arco-design/web-react'
import axios from '../utils/axios'
import AdminListTable, { AdminOps } from '../components/AdminListTable'

const FormItem = Form.Item

function BaseDictionaryConfig() {
  const [loading, setLoading] = useState(false)
  const [dictList, setDictList] = useState([])
  const [activeDictId, setActiveDictId] = useState(null)
  const [itemLoading, setItemLoading] = useState(false)
  const [itemList, setItemList] = useState([])

  const [dictModalVisible, setDictModalVisible] = useState(false)
  const [editingDict, setEditingDict] = useState(null)
  const [dictFormKey, setDictFormKey] = useState(0)
  const [itemModalVisible, setItemModalVisible] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [itemFormKey, setItemFormKey] = useState(0)

  const activeDict = useMemo(
    () => dictList.find((d) => d.F_Id === activeDictId) || null,
    [dictList, activeDictId]
  )

  const fetchDictList = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/system/base-dictionaries')
      if (res.data?.success) {
        const rows = res.data.data || []
        setDictList(rows)
        if (rows.length === 0) {
          setActiveDictId(null)
          setItemList([])
        } else if (!activeDictId || !rows.some((r) => r.F_Id === activeDictId)) {
          setActiveDictId(rows[0].F_Id)
        }
      } else {
        Message.error(res.data?.message || '获取数据字典失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || '获取数据字典失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchItems = async (dictId) => {
    if (!dictId) {
      setItemList([])
      return
    }
    setItemLoading(true)
    try {
      const res = await axios.get(`/api/system/base-dictionaries/${dictId}/items`)
      if (res.data?.success) {
        setItemList(res.data.data || [])
      } else {
        Message.error(res.data?.message || '获取字典选项失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || '获取字典选项失败')
    } finally {
      setItemLoading(false)
    }
  }

  useEffect(() => {
    fetchDictList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchItems(activeDictId)
  }, [activeDictId])

  const submitDict = async (values) => {
    try {
      if (editingDict) {
        await axios.put(`/api/system/base-dictionaries/${editingDict.F_Id}`, values)
        Message.success('更新字典类型成功')
      } else {
        await axios.post('/api/system/base-dictionaries', values)
        Message.success('新增字典类型成功')
      }
      setDictModalVisible(false)
      setEditingDict(null)
      await fetchDictList()
    } catch (e) {
      Message.error(e.response?.data?.message || '保存失败')
    }
  }

  const submitItem = async (values) => {
    if (!activeDictId) {
      Message.warning('请先选择字典类型')
      return
    }
    try {
      if (editingItem) {
        await axios.put(`/api/system/base-dictionary-items/${editingItem.F_Id}`, values)
        Message.success('更新字典选项成功')
      } else {
        await axios.post(`/api/system/base-dictionaries/${activeDictId}/items`, values)
        Message.success('新增字典选项成功')
      }
      setItemModalVisible(false)
      setEditingItem(null)
      fetchItems(activeDictId)
      fetchDictList()
    } catch (e) {
      Message.error(e.response?.data?.message || '保存失败')
    }
  }

  const toggleDictStatus = async (row, checked) => {
    try {
      await axios.put(`/api/system/base-dictionaries/${row.F_Id}/status`, {
        is_enabled: checked ? 1 : 0
      })
      Message.success(checked ? '已启用' : '已停用')
      fetchDictList()
      if (activeDictId === row.F_Id) fetchItems(row.F_Id)
    } catch (e) {
      Message.error(e.response?.data?.message || '更新状态失败')
    }
  }

  const toggleItemStatus = async (row, checked) => {
    try {
      await axios.put(`/api/system/base-dictionary-items/${row.F_Id}/status`, {
        is_enabled: checked ? 1 : 0
      })
      Message.success(checked ? '已启用' : '已停用')
      fetchItems(activeDictId)
    } catch (e) {
      Message.error(e.response?.data?.message || '更新状态失败')
    }
  }

  const removeDict = async (row) => {
    try {
      await axios.delete(`/api/system/base-dictionaries/${row.F_Id}`)
      Message.success('删除成功')
      fetchDictList()
    } catch (e) {
      Message.error(e.response?.data?.message || '删除失败')
    }
  }

  const removeItem = async (row) => {
    try {
      await axios.delete(`/api/system/base-dictionary-items/${row.F_Id}`)
      Message.success('删除成功')
      fetchItems(activeDictId)
      fetchDictList()
    } catch (e) {
      Message.error(e.response?.data?.message || '删除失败')
    }
  }

  const dictColumns = [
    {
      title: '字典编码',
      dataIndex: 'dict_code',
      width: 120
    },
    {
      title: '字典名称',
      dataIndex: 'dict_name',
      width: 180
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 52
    },
    {
      title: '选项数',
      dataIndex: 'item_count',
      width: 56
    },
    {
      title: '状态',
      dataIndex: 'is_enabled',
      width: 56,
      render: (v) => (
        <Tag color={Number(v) === 1 ? 'green' : 'gray'}>{Number(v) === 1 ? '启用' : '停用'}</Tag>
      )
    },
    {
      title: '操作',
      width: 132,
      className: 'admin-ops-col',
      render: (_, row) => (
        <AdminOps>
          <Switch
            size="small"
            checked={Number(row.is_enabled) === 1}
            onChange={(v) => toggleDictStatus(row, v)}
          />
          <Button
            type="outline"
            size="small"
            onClick={() => {
              setEditingDict(row)
              setDictModalVisible(true)
            }}
          >
            修改
          </Button>
          <Popconfirm
            title="确认删除该字典类型及其全部选项？"
            onOk={() => removeDict(row)}
          >
            <Button type="outline" size="small" status="danger">删除</Button>
          </Popconfirm>
        </AdminOps>
      )
    }
  ]

  const itemColumns = [
    {
      title: '选项编码',
      dataIndex: 'item_code',
      width: 120
    },
    {
      title: '选项名称',
      dataIndex: 'item_name',
      width: 180
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      width: 52
    },
    {
      title: '状态',
      dataIndex: 'is_enabled',
      width: 56,
      render: (v) => (
        <Tag color={Number(v) === 1 ? 'green' : 'gray'}>{Number(v) === 1 ? '启用' : '停用'}</Tag>
      )
    },
    {
      title: '操作',
      width: 132,
      className: 'admin-ops-col',
      render: (_, row) => (
        <AdminOps>
          <Switch
            size="small"
            checked={Number(row.is_enabled) === 1}
            onChange={(v) => toggleItemStatus(row, v)}
          />
          <Button
            type="outline"
            size="small"
            onClick={() => {
              setEditingItem(row)
              setItemModalVisible(true)
            }}
          >
            修改
          </Button>
          <Popconfirm title="确认删除该选项？" onOk={() => removeItem(row)}>
            <Button type="outline" size="small" status="danger">删除</Button>
          </Popconfirm>
        </AdminOps>
      )
    }
  ]

  const openCreateItemModal = () => {
    if (!activeDictId) {
      Message.warning('请先在左侧选择一个数据字典类型')
      return
    }
    setEditingItem(null)
    setItemFormKey((k) => k + 1)
    setItemModalVisible(true)
  }

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start'
        }}
      >
        <div style={{ minWidth: 0, width: '100%' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 12,
              flexWrap: 'nowrap'
            }}
          >
            <div style={{ fontWeight: 600, flex: '1 1 auto', minWidth: 0 }}>数据字典类型</div>
            <Button
              type="primary"
              size="small"
              style={{ flexShrink: 0 }}
              onClick={() => {
                setEditingDict(null)
                setDictFormKey((k) => k + 1)
                setDictModalVisible(true)
              }}
            >
              新增字典类型
            </Button>
          </div>
          <AdminListTable
            rowKey="F_Id"
            loading={loading}
            columns={dictColumns}
            data={dictList}
            pagination={false}
            onRow={(record) => ({
              onClick: () => setActiveDictId(record.F_Id)
            })}
            rowSelection={{
              type: 'radio',
              selectedRowKeys: activeDictId ? [activeDictId] : []
            }}
            scroll={{ y: 460 }}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ minWidth: 0, width: '100%' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 12,
              flexWrap: 'nowrap'
            }}
          >
            <div style={{ fontWeight: 600, flex: '1 1 auto', minWidth: 0 }}>
              字典选项{activeDict ? `（${activeDict.dict_name}）` : ''}
            </div>
            <Button type="primary" size="small" style={{ flexShrink: 0 }} onClick={openCreateItemModal}>
              新增字典选项
            </Button>
          </div>
          <AdminListTable
            rowKey="F_Id"
            loading={itemLoading}
            columns={itemColumns}
            data={itemList}
            pagination={false}
            scroll={{ y: 460 }}
            style={{ width: '100%' }}
            noDataElement={
              <div style={{ padding: '24px 0', color: '#86909c' }}>
                {activeDict ? '暂无数据，请点击右上角「新增字典选项」' : '请先在左侧选择一个数据字典类型'}
              </div>
            }
          />
        </div>
      </div>

      <Modal
        visible={dictModalVisible}
        title={editingDict ? '修改字典类型' : '新增字典类型'}
        onCancel={() => {
          setDictModalVisible(false)
          setEditingDict(null)
        }}
        footer={null}
      >
        <Form
          key={editingDict ? `dict-${editingDict.F_Id}` : `dict-new-${dictFormKey}`}
          layout="vertical"
          initialValues={
            editingDict || { dict_code: '', dict_name: '', sort_order: 0, is_enabled: 1 }
          }
          onSubmit={submitDict}
        >
          <FormItem
            label="字典编码"
            field="dict_code"
            rules={[{ required: true, message: '请输入字典编码' }]}
          >
            <Input placeholder="例如：news_source_type" />
          </FormItem>
          <FormItem
            label="字典名称"
            field="dict_name"
            rules={[{ required: true, message: '请输入字典名称' }]}
          >
            <Input placeholder="例如：新闻来源类型" />
          </FormItem>
          <FormItem label="排序" field="sort_order">
            <InputNumber min={0} style={{ width: '100%' }} />
          </FormItem>
          <FormItem label="启用" field="is_enabled" triggerPropName="checked">
            <Switch checkedText="启用" uncheckedText="停用" />
          </FormItem>
          <Space>
            <Button htmlType="submit" type="primary">保存</Button>
            <Button
              onClick={() => {
                setDictModalVisible(false)
                setEditingDict(null)
              }}
            >
              取消
            </Button>
          </Space>
        </Form>
      </Modal>

      <Modal
        visible={itemModalVisible}
        title={editingItem ? '修改字典选项' : '新增字典选项'}
        onCancel={() => {
          setItemModalVisible(false)
          setEditingItem(null)
        }}
        footer={null}
      >
        <Form
          key={editingItem ? `item-${editingItem.F_Id}` : `item-new-${itemFormKey}`}
          layout="vertical"
          initialValues={
            editingItem || { item_code: '', item_name: '', sort_order: 0, is_enabled: 1 }
          }
          onSubmit={submitItem}
        >
          <FormItem
            label="选项编码"
            field="item_code"
            rules={[{ required: true, message: '请输入选项编码' }]}
          >
            <Input placeholder="例如：third_party" />
          </FormItem>
          <FormItem
            label="选项名称"
            field="item_name"
            rules={[{ required: true, message: '请输入选项名称' }]}
          >
            <Input placeholder="例如：第三方公众号" />
          </FormItem>
          <FormItem label="排序" field="sort_order">
            <InputNumber min={0} style={{ width: '100%' }} />
          </FormItem>
          <FormItem label="启用" field="is_enabled" triggerPropName="checked">
            <Switch checkedText="启用" uncheckedText="停用" />
          </FormItem>
          <Space>
            <Button htmlType="submit" type="primary">保存</Button>
            <Button
              onClick={() => {
                setItemModalVisible(false)
                setEditingItem(null)
              }}
            >
              取消
            </Button>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}

export default BaseDictionaryConfig

