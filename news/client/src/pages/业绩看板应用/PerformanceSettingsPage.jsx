/**
 * 业绩看板应用 - 设置管理页面（React版本）
 * 业绩看板应用扩展
 * Tab1: 数据接口配置（b_sql表 CRUD + SQL测试）
 * Tab2: 定时任务配置（复用现有定时任务）
 */
import React, { useState, useEffect, useRef } from 'react'
import {
  Tabs, Table, Button, Space, Modal, Form, Input, Select,
  InputNumber, Message, Popconfirm, Tag, Spin, Tooltip, Card, Typography
} from '@arco-design/web-react'
import {
  IconPlus, IconEdit, IconDelete, IconPlayArrow, IconRefresh, IconSearch, IconHistory, IconSave
} from '@arco-design/web-react/icon'
import axios from '../../utils/axios'
import CronGenerator from '../../components/CronGenerator'
import './PerformanceSettingsPage.css'

const { TabPane } = Tabs
const { Item: FormItem } = Form
const { TextArea } = Input
const { Text } = Typography

// SQL 语法高亮：飞书风格（行号 + 关键字/标识符/字符串/注释着色）
function highlightSqlLine(line) {
  const parts = []
  let lastIndex = 0
  // 按顺序匹配：单行注释、单引号字符串、双引号字符串、反引号标识符、关键字
  const re = /(--.*$)|('[^']*')|("[^"]*")|(`[^`]*`)|(\b(?:SELECT|FROM|WHERE|AND|OR|ORDER|BY|GROUP|LIMIT|ROW_NUMBER|OVER|AS|DESC|ASC|INSERT|INTO|WITH|VALUES|ON|JOIN|LEFT|RIGHT|INNER|OUTER|HAVING|CASE|WHEN|THEN|ELSE|END|DISTINCT|IN|NOT|NULL|CREATE|TABLE|INDEX|UNION|ALL)\b)/gi
  let m
  while ((m = re.exec(line)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', val: line.slice(lastIndex, m.index) })
    }
    if (m[1]) parts.push({ type: 'comment', val: m[1] })
    else if (m[2]) parts.push({ type: 'string', val: m[2] })
    else if (m[3]) parts.push({ type: 'string', val: m[3] })
    else if (m[4]) parts.push({ type: 'ident', val: m[4] })
    else if (m[5]) parts.push({ type: 'keyword', val: m[5] })
    lastIndex = re.lastIndex
  }
  if (lastIndex < line.length) {
    parts.push({ type: 'text', val: line.slice(lastIndex) })
  }
  return parts.map((p, i) => {
    if (p.type === 'comment') return <span key={i} className="sql-hl-comment">{p.val}</span>
    if (p.type === 'string') return <span key={i} className="sql-hl-string">{p.val}</span>
    if (p.type === 'ident') return <span key={i} className="sql-hl-ident">{p.val}</span>
    if (p.type === 'keyword') return <span key={i} className="sql-hl-keyword">{p.val}</span>
    return <span key={i}>{p.val}</span>
  })
}

function SqlCodeBlock({ sql, className = '', maxHeight }) {
  const lines = (sql || '').split('\n')
  return (
    <div className={`perf-sql-code-block ${className}`} style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 13 }}>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="perf-sql-line-num" style={{ verticalAlign: 'top', paddingRight: 12, userSelect: 'none', color: '#86909c' }}>
                {i + 1}
              </td>
              <td style={{ verticalAlign: 'top', whiteSpace: 'pre', wordBreak: 'break-all', color: '#1d2129' }}>
                {highlightSqlLine(line)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 可编辑的飞书风格 SQL：仅一块区域，即编辑即高亮显示；单一滚动条由外层 wrap 控制 */
function SqlCodeEditor({ value = '', onChange, placeholder, minRows = 6 }) {
  const textareaRef = useRef(null)
  const highlightRef = useRef(null)
  const innerRef = useRef(null)
  const lines = (value || '').split('\n')
  const lineCount = Math.max(lines.length, minRows)

  // 让内层高度 = 内容高度，这样只有 code-wrap 一层滚动，避免双滚动条
  useEffect(() => {
    const ta = textareaRef.current
    const inner = innerRef.current
    if (!ta || !inner) return
    const h = Math.max(ta.scrollHeight, 200)
    inner.style.height = h + 'px'
  }, [value])

  return (
    <div className="perf-sql-code-block perf-sql-editor">
      <div className="perf-sql-editor-line-nums" aria-hidden>
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="perf-sql-line-num">{i + 1}</div>
        ))}
      </div>
      <div className="perf-sql-editor-code-wrap">
        <div ref={innerRef} className="perf-sql-editor-inner">
          <div ref={highlightRef} className="perf-sql-editor-highlight">
            {lines.map((line, i) => (
              <div key={i} className="perf-sql-editor-line">
                {highlightSqlLine(line)}
                {line === '' && i === lines.length - 1 ? <br /> : null}
              </div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="perf-sql-editor-textarea"
            value={value}
            onChange={(e) => onChange && onChange(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  )
}

// ================= SQL配置管理 Tab =================

function SqlConfigTab() {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editRecord, setEditRecord] = useState(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)

  // 测试SQL弹窗
  const [showTestModal, setShowTestModal] = useState(false)
  const [testRecord, setTestRecord] = useState(null)
  const [testForm] = Form.useForm()
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState(null)

  // 日志弹窗
  const [showLogModal, setShowLogModal] = useState(false)
  const [logRecord, setLogRecord] = useState(null)
  const [logList, setLogList] = useState([])
  const [logLoading, setLogLoading] = useState(false)

  // 外部数据库列表
  const [dbConfigs, setDbConfigs] = useState([])

  useEffect(() => {
    fetchList()
    fetchDbConfigs()
  }, [])

  const fetchList = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/performance/config/sql-list')
      if (res.data.success) {
        setList(res.data.data.list || [])
      }
    } catch (err) {
      Message.error('获取SQL配置列表失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchDbConfigs = async () => {
    try {
      // 使用业绩看板配置接口获取「系统配置-数据库连接」中的外部数据库列表（与主系统一致）
      const res = await axios.get('/api/performance/config/databases')
      if (res.data.success && res.data.data) {
        const list = res.data.data.list || res.data.data
        setDbConfigs(Array.isArray(list) ? list : [])
      }
    } catch (err) {
      // 外部DB配置获取失败不影响主流程
    }
  }

  const handleAdd = () => {
    setEditRecord(null)
    form.resetFields()
    setShowModal(true)
  }

  const handleEdit = (record) => {
    setEditRecord(record)
    form.setFieldsValue({
      interface_name: record.interface_name,
      external_db_config_id: record.external_db_config_id || '',
      exec_order: record.exec_order,
      target_table: record.target_table,
      sql_content: record.sql_content,
      remark: record.remark
    })
    setShowModal(true)
  }

  const handleDelete = async (id) => {
    try {
      const res = await axios.delete(`/api/performance/config/sql/${id}`)
      if (res.data.success) {
        Message.success('删除成功')
        fetchList()
      } else {
        Message.error(res.data.message || '删除失败')
      }
    } catch (err) {
      Message.error('删除失败')
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validate()
      // 后端接口使用 camelCase，将表单 snake_case 转为请求体
      const dbId = values.external_db_config_id || null
      const databaseName = dbId ? (dbConfigs.find(d => d.id === dbId)?.name || '') : ''
      const payload = {
        interfaceName: values.interface_name,
        sqlContent: values.sql_content,
        targetTable: values.target_table,
        execOrder: values.exec_order ?? 0,
        externalDbConfigId: dbId || undefined,
        databaseName,
        remark: values.remark || undefined
      }
      setSaving(true)
      let res
      if (editRecord) {
        res = await axios.put(`/api/performance/config/sql/${editRecord.id}`, payload)
      } else {
        res = await axios.post('/api/performance/config/sql', payload)
      }
      if (res.data.success) {
        Message.success(editRecord ? '更新成功' : '新增成功')
        setShowModal(false)
        fetchList()
      } else {
        Message.error(res.data.message || '保存失败')
      }
    } catch (err) {
      if (err?.message) Message.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleOpenLog = async (record) => {
    setLogRecord(record)
    setShowLogModal(true)
    setLogList([])
    setLogLoading(true)
    try {
      const res = await axios.get(`/api/performance/config/sql/${record.id}/log`)
      if (res.data.success && res.data.data) {
        setLogList(res.data.data.list || [])
      }
    } catch (err) {
      Message.error('获取日志失败')
    } finally {
      setLogLoading(false)
    }
  }

  const handleTest = (record) => {
    setTestRecord(record)
    setTestResult(null)
    // 默认日期：当前月最后一天 23:59:59
    const now = new Date()
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const yyyy = lastDay.getFullYear()
    const mm = String(lastDay.getMonth() + 1).padStart(2, '0')
    const dd = String(lastDay.getDate()).padStart(2, '0')
    testForm.setFieldsValue({ test_date: `${yyyy}-${mm}-${dd}` })
    setShowTestModal(true)
  }

  const handleRunTest = async () => {
    try {
      const values = await testForm.validate()
      setTestLoading(true)
      setTestResult(null)
      const res = await axios.post(`/api/performance/config/sql/${testRecord.id}/test`, {
        date: values.test_date
      })
      setTestResult(res.data)
    } catch (err) {
      setTestResult({ success: false, message: '请求失败：' + (err.message || '未知错误') })
    } finally {
      setTestLoading(false)
    }
  }

  const columns = [
    { title: '执行顺序', dataIndex: 'exec_order', width: 80, sorter: (a, b) => a.exec_order - b.exec_order },
    { title: '接口名称', dataIndex: 'interface_name', width: 160 },
    {
      title: '数据库',
      dataIndex: 'external_db_config_id',
      width: 120,
      render: (v) => {
        if (!v) return <Tag color="blue">主库</Tag>
        const db = dbConfigs.find(d => d.id === v)
        return <Tag color="orange">{db?.name || v}</Tag>
      }
    },
    { title: '目标表', dataIndex: 'target_table', width: 160 },
    {
      title: 'SQL预览',
      dataIndex: 'sql_content',
      render: (v) => (
        <Tooltip content={<pre style={{ maxWidth: 400, whiteSpace: 'pre-wrap', fontSize: 12 }}>{v}</pre>}>
          <Text ellipsis style={{ maxWidth: 200, display: 'inline-block' }}>{v}</Text>
        </Tooltip>
      )
    },
    { title: '备注', dataIndex: 'remark', width: 120 },
    {
      title: '创建时间',
      dataIndex: 'F_CreatorTime',
      width: 150,
      render: (v) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
    {
      title: '修改时间',
      dataIndex: 'F_LastModifyTime',
      width: 150,
      render: (v) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
    {
      title: '操作',
      width: 240,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button size="mini" type="text" icon={<IconPlayArrow />} onClick={() => handleTest(record)}>测试</Button>
          <Button size="mini" type="text" icon={<IconEdit />} onClick={() => handleEdit(record)}>编辑</Button>
          <Button size="mini" type="text" icon={<IconHistory />} onClick={() => handleOpenLog(record)}>日志</Button>
          <Popconfirm title="确认删除该SQL配置？" onOk={() => handleDelete(record.id)}>
            <Button size="mini" type="text" status="danger" icon={<IconDelete />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div className="perf-settings-tab">
      <div className="perf-settings-toolbar">
        <Button type="primary" icon={<IconPlus />} onClick={handleAdd}>新增SQL配置</Button>
        <Button icon={<IconRefresh />} onClick={fetchList} loading={loading}>刷新</Button>
      </div>

      <Table
        columns={columns}
        data={list}
        loading={loading}
        rowKey="id"
        scroll={{ x: 1200 }}
        pagination={{ pageSize: 20, showTotal: true }}
        defaultSortOrder={[{ field: 'exec_order', order: 'asc' }]}
      />

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editRecord ? '编辑SQL配置' : '新增SQL配置'}
        visible={showModal}
        onCancel={() => setShowModal(false)}
        onOk={handleSave}
        confirmLoading={saving}
        style={{ width: 700 }}
        unmountOnExit
      >
        <Form form={form} layout="vertical">
          <FormItem label="接口名称" field="interface_name" rules={[{ required: true, message: '请输入接口名称' }]}>
            <Input placeholder="请输入接口名称" />
          </FormItem>
          <FormItem label="执行顺序" field="exec_order" rules={[{ required: true, message: '请输入执行顺序' }]}>
            <InputNumber min={1} max={9999} placeholder="数字越小越先执行" style={{ width: '100%' }} />
          </FormItem>
          <FormItem label="数据库选择" field="external_db_config_id" help="不选则在主库执行">
            <Select placeholder="默认主库" allowClear>
              <Select.Option value="">主库（默认）</Select.Option>
              {dbConfigs.map(d => (
                <Select.Option key={d.id} value={d.id}>{d.name}</Select.Option>
              ))}
            </Select>
          </FormItem>
          <FormItem label="目标表" field="target_table" rules={[{ required: true, message: '请输入目标数据表名' }]}>
            <Input placeholder="例如: b_manage_indicator" />
          </FormItem>
          <FormItem
            label="SQL代码"
            field="sql_content"
            rules={[{ required: true, message: '请输入SQL查询语句' }]}
            help={
              <span style={{ display: 'block', marginTop: 4 }}>
                可使用 <code style={{ background: '#f2f3f5', padding: '0 4px', borderRadius: 2 }}>&#39;$&#123;date&#125;&#39;</code> 作为日期参数，执行时会被替换为传入的日期，格式如 <code style={{ background: '#f2f3f5', padding: '0 4px', borderRadius: 2 }}>&#39;2025-06-30&#39;</code>；SQL 中多处 <code style={{ background: '#f2f3f5', padding: '0 4px', borderRadius: 2 }}>&#39;$&#123;date&#125;&#39;</code> 均会替换为同一日期。
              </span>
            }
            extra={
              <pre style={{ margin: '8px 0 0', padding: 10, background: '#f7f8fa', borderRadius: 6, fontSize: 12, color: '#4e5969' }}>
                {"示例：SELECT * FROM your_table WHERE b_date = '${date}'"}
              </pre>
            }
          >
            <SqlCodeEditor
              placeholder="支持 SELECT、WITH（CTE）、INSERT...SELECT；禁止 DELETE/UPDATE/DROP/TRUNCATE/ALTER 等指令。换行与缩进会原样保存。"
              minRows={6}
            />
          </FormItem>
          <FormItem label="备注" field="remark">
            <Input placeholder="可选备注" />
          </FormItem>
        </Form>
      </Modal>

      {/* SQL测试弹窗 */}
      <Modal
        title={`SQL测试 - ${testRecord?.interface_name || ''}`}
        visible={showTestModal}
        onCancel={() => { setShowTestModal(false); setTestResult(null) }}
        footer={[
          <Button key="cancel" onClick={() => { setShowTestModal(false); setTestResult(null) }}>关闭</Button>,
          <Button key="run" type="primary" icon={<IconPlayArrow />} loading={testLoading} onClick={handleRunTest}>
            执行测试
          </Button>
        ]}
        style={{ width: 720 }}
        unmountOnExit
      >
        <Form form={testForm} layout="inline" style={{ marginBottom: 16 }}>
          <FormItem
            label="测试日期"
            field="test_date"
            rules={[{ required: true, message: '请输入日期' }, {
              validator: (v, cb) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) cb('格式应为 YYYY-MM-DD')
                else cb()
              }
            }]}
          >
            <Input placeholder="YYYY-MM-DD" style={{ width: 160 }} />
          </FormItem>
          <FormItem noStyle>
            <span style={{ color: '#86909c', fontSize: 12 }}>（执行时间默认为 23:59:59）</span>
          </FormItem>
        </Form>

        {testRecord && (
          <div style={{ marginBottom: 12 }} className="perf-sql-code-wrap">
            <div style={{ color: '#4e5969', fontSize: 12, marginBottom: 6 }}>SQL预览：</div>
            <SqlCodeBlock sql={testRecord.sql_content} maxHeight={240} />
          </div>
        )}

        {testLoading && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin tip="正在执行SQL..." />
          </div>
        )}

        {testResult && !testLoading && (
          <div className={`perf-test-result ${testResult.success ? 'success' : 'error'}`}>
            <div className="perf-test-result-title">
              {testResult.success ? '✅ 执行成功' : '❌ 执行失败'}
            </div>
            {testResult.success ? (
              <>
                <div style={{ color: '#86909c', fontSize: 12, marginBottom: 8 }}>
                  {testResult.data?.isInsert
                    ? `影响行数 ${testResult.data?.rowCount ?? 0}，耗时 ${testResult.data?.duration ?? '-'} ms`
                    : `返回 ${testResult.data?.rowCount ?? 0} 条数据，耗时 ${testResult.data?.duration ?? '-'} ms`}
                </div>
                {testResult.data?.rows?.length > 0 && (
                  <div style={{ overflow: 'auto', maxHeight: 300 }}>
                    <table className="perf-test-table">
                      <thead>
                        <tr>
                          {Object.keys(testResult.data.rows[0]).map(k => (
                            <th key={k}>{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {testResult.data.rows.slice(0, 50).map((row, i) => (
                          <tr key={i}>
                            {Object.values(row).map((v, j) => (
                              <td key={j}>{v === null ? <span style={{ color: '#bbb' }}>NULL</span> : String(v)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {testResult.data.rows.length > 50 && (
                      <div style={{ color: '#86909c', fontSize: 12, padding: '8px 0' }}>
                        仅展示前50条，共 {testResult.data.rows.length} 条
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color: '#f53f3f', whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {testResult.message}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 数据接口配置 - 修改日志弹窗 */}
      <Modal
        title={`修改日志 - ${logRecord?.interface_name || ''}`}
        visible={showLogModal}
        onCancel={() => { setShowLogModal(false); setLogRecord(null); setLogList([]) }}
        footer={null}
        style={{ width: 780 }}
        unmountOnExit
      >
        {logLoading ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Spin tip="加载中..." />
          </div>
        ) : logList.length === 0 ? (
          <div style={{ color: '#86909c', textAlign: 'center', padding: '24px 0' }}>暂无修改记录</div>
        ) : (
          <Table
            data={logList}
            rowKey="id"
            pagination={false}
            scroll={{ y: 400 }}
            columns={[
              {
                title: '修改时间',
                dataIndex: 'modifyTime',
                width: 170,
                render: (v) => v ? new Date(v).toLocaleString('zh-CN') : '-'
              },
              {
                title: '修改用户',
                dataIndex: 'modifyUserName',
                width: 120
              },
              {
                title: '修改内容',
                dataIndex: 'changes',
                render: (changes) => {
                  if (!Array.isArray(changes) || changes.length === 0) return '-'
                  return (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                      {changes.map((c, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          <strong>{c.fieldLabel}</strong>：{c.oldVal} → {c.newVal}
                        </li>
                      ))}
                    </ul>
                  )
                }
              }
            ]}
          />
        )}
      </Modal>
    </div>
  )
}

// ================= 业绩看板说明配置 Tab =================
// 指标列表：区域 | 指标名称 | 字段 key（对应 b_indicator_describe）
const INDICATOR_DESCRIBE_LIST = [
  { area: '管理人指标', name: '母基金数量', key: 'fofNumDesc' },
  { area: '管理人指标', name: '直投基金数量', key: 'directNumDesc' },
  { area: '管理人指标', name: '认缴管理规模', key: 'subAmountDesc' },
  { area: '管理人指标', name: '实缴管理规模', key: 'paidInAmountDesc' },
  { area: '管理人指标', name: '累计分配总额', key: 'disAmountDesc' },
  { area: '基金产品', name: '投资人认缴', key: 'lpSubDesc' },
  { area: '基金产品', name: '投资人实缴', key: 'paidinDesc' },
  { area: '基金产品', name: '投资人分配', key: 'distributionDesc' },
  { area: '基金产品', name: 'TVPI', key: 'tvpiDesc' },
  { area: '基金产品', name: 'DPI', key: 'dpiDesc' },
  { area: '基金产品', name: 'RVPI', key: 'rvpiDesc' },
  { area: '基金产品', name: 'NIRR', key: 'nirrDesc' },
  { area: '基金产品', name: '投资金额/认缴', key: 'subAmountInvDesc' },
  { area: '基金产品', name: '投资金额/实缴', key: 'invAmountDesc' },
  { area: '基金产品', name: '退出金额', key: 'exitAmountDesc' },
  { area: '基金产品', name: 'GIRR', key: 'girrDesc' },
  { area: '基金产品', name: 'MOC', key: 'mocDesc' },
  { area: '投资组合', name: '【子基金】投/退数量', key: 'fundInvExitDesc' },
  { area: '投资组合', name: '【子基金】认缴/退出', key: 'fundSubExitDesc' },
  { area: '投资组合', name: '【子基金】实缴/回款', key: 'fundPaidinReceiveDesc' },
  { area: '投资组合', name: '【直投项目】投/退数量', key: 'projectInvExitDesc' },
  { area: '投资组合', name: '【直投项目】实缴/回款', key: 'projectPaidinReceiveDesc' },
  { area: '投资组合', name: '子基金累计投资数量', key: 'fundInvAccDesc' },
  { area: '投资组合', name: '子基金累计认缴金额', key: 'fundSubAccDesc' },
  { area: '投资组合', name: '子基金累计实缴金额', key: 'fundPaidinAccDesc' },
  { area: '投资组合', name: '子基金累计退出数量', key: 'fundExitAccDesc' },
  { area: '投资组合', name: '子基金累计退出金额', key: 'fundExitAmountAccDesc' },
  { area: '投资组合', name: '子基金累计回款金额', key: 'fundReceiveAccDesc' },
  { area: '投资组合', name: '直投项目累计投资数量', key: 'projectInvAccDesc' },
  { area: '投资组合', name: '直投项目累计投资金额', key: 'projectPaidinAccDesc' },
  { area: '投资组合', name: '直投项目累计退出数量', key: 'projectExitAccDesc' },
  { area: '投资组合', name: '直投项目累计退出金额', key: 'projectExitAmountAccDesc' },
  { area: '投资组合', name: '直投项目累计回款金额', key: 'projectReceiveAccDesc' },
  { area: '底层资产', name: '【累计组合】底层资产/数量', key: 'projectNumADesc' },
  { area: '底层资产', name: '【累计组合】底层资产/金额', key: 'totalAmountADesc' },
  { area: '底层资产', name: '【累计组合】上市企业', key: 'ipoNumADesc' },
  { area: '底层资产', name: '【累计组合】上海地区企业', key: 'shNumADesc' },
  { area: '底层资产', name: '【当前组合】底层资产/数量', key: 'projectNumDesc' },
  { area: '底层资产', name: '【当前组合】底层资产/金额', key: 'totalAmountDesc' },
  { area: '底层资产', name: '【当前组合】上市企业', key: 'ipoNumDesc' },
  { area: '底层资产', name: '【当前组合】上海地区企业', key: 'shNumDesc' }
]

function IndicatorDescribeTab() {
  const [formData, setFormData] = useState({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/performance/config/indicators')
      if (res.data.success && res.data.data) {
        setFormData(res.data.data)
      } else {
        setFormData({})
      }
    } catch (err) {
      Message.error('获取配置失败')
      setFormData({})
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        systemName: formData.systemName ?? null,
        manualUrl: formData.manualUrl ?? null,
        redirectUrl: formData.redirectUrl ?? null
      }
      INDICATOR_DESCRIBE_LIST.forEach(({ key }) => {
        payload[key] = formData[key] ?? null
      })
      const res = await axios.put('/api/performance/config/indicators', payload)
      if (res.data.success) {
        Message.success('保存成功')
      } else {
        Message.error(res.message || '保存失败')
      }
    } catch (err) {
      Message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <Spin style={{ display: 'block', margin: '60px auto' }} />
  }

  const grouped = INDICATOR_DESCRIBE_LIST.reduce((acc, item) => {
    if (!acc[item.area]) acc[item.area] = []
    acc[item.area].push(item)
    return acc
  }, {})

  return (
    <div className="perf-settings-tab">
      <div className="perf-settings-toolbar">
        <Button type="primary" icon={<IconSave />} onClick={handleSave} loading={saving}>
          保存
        </Button>
      </div>
      {/* 系统名称、操作手册地址、页面跳转地址 */}
      <Card title="看板与弹窗配置" style={{ marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, maxWidth: 960 }}>
          <div>
            <div style={{ marginBottom: 6, fontSize: 13, color: '#4e5969', fontWeight: 500 }}>系统名称</div>
            <Input
              value={formData.systemName ?? ''}
              onChange={(v) => handleChange('systemName', v)}
              placeholder="控制业绩看板主标题显示名称，如：业绩看板"
              allowClear
            />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontSize: 13, color: '#4e5969', fontWeight: 500 }}>操作手册地址</div>
            <Input
              value={formData.manualUrl ?? ''}
              onChange={(v) => handleChange('manualUrl', v)}
              placeholder="看板顶部「操作手册」按钮跳转地址"
              allowClear
            />
          </div>
          <div>
            <div style={{ marginBottom: 6, fontSize: 13, color: '#4e5969', fontWeight: 500 }}>页面跳转地址</div>
            <Input
              value={formData.redirectUrl ?? ''}
              onChange={(v) => handleChange('redirectUrl', v)}
              placeholder="底层/上市/区域企业明细弹窗右侧「详细报表」跳转地址"
              allowClear
            />
          </div>
        </div>
      </Card>
      <div className="perf-indicator-desc-table-wrap">
        <table className="perf-indicator-desc-table">
          <thead>
            <tr>
              <th className="perf-indicator-desc-area">指标区域</th>
              <th className="perf-indicator-desc-name">指标名称</th>
              <th className="perf-indicator-desc-input">指标说明</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(grouped).flatMap(([area, items]) =>
              items.map((row, idx) => (
                <tr key={row.key}>
                  {idx === 0 ? (
                    <td rowSpan={items.length} className="perf-indicator-desc-area">
                      {area}
                    </td>
                  ) : null}
                  <td className="perf-indicator-desc-name">{row.name}</td>
                  <td className="perf-indicator-desc-input">
                    <TextArea
                      value={formData[row.key] ?? ''}
                      onChange={(v) => handleChange(row.key, v)}
                      placeholder="请输入指标说明"
                      autoSize={{ minRows: 2, maxRows: 6 }}
                      style={{ width: '100%' }}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ================= 定时任务配置 Tab =================

function ScheduledTaskTab() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editTask, setEditTask] = useState(null)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [showCronModal, setShowCronModal] = useState(false)

  useEffect(() => {
    fetchTasks()
  }, [])

  const fetchTasks = async () => {
    setLoading(true)
    try {
      // 获取业绩看板定时任务配置
      const res = await axios.get('/api/performance/scheduled-tasks')
      if (res.data.success) {
        setTasks(res.data.data || [])
      }
    } catch (err) {
      Message.error('获取定时任务失败')
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = async (task) => {
    try {
      const res = await axios.patch(`/api/scheduled-tasks/${task.id}/toggle`)
      if (res.data.success) {
        Message.success(task.is_active ? '已停用' : '已启用')
        fetchTasks()
      }
    } catch (err) {
      Message.error('操作失败')
    }
  }

  const handleAdd = () => {
    setEditTask(null)
    form.resetFields()
    form.setFieldsValue({
      app_name: '业绩看板应用',
      is_active: true,
      retry_count: 0,
      retry_interval: 0
    })
    setShowModal(true)
  }

  const handleEdit = (task) => {
    setEditTask(task)
    form.setFieldsValue({
      app_name: task.app_name,
      interface_type: task.interface_type,
      request_url: task.request_url,
      cron_expression: task.cron_expression,
      is_active: task.is_active,
      retry_count: task.retry_count || 0,
      retry_interval: task.retry_interval || 0,
      remark: task.remark
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    try {
      const values = await form.validate()
      setSaving(true)
      let res
      if (editTask) {
        res = await axios.put(`/api/performance/scheduled-tasks/${editTask.id}`, values)
      } else {
        res = await axios.post('/api/performance/scheduled-tasks', values)
      }
      if (res.data.success) {
        Message.success(editTask ? '更新成功' : '新增成功')
        setShowModal(false)
        fetchTasks()
      } else {
        Message.error(res.data.message || '保存失败')
      }
    } catch (err) {
      if (err?.message) Message.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      const res = await axios.delete(`/api/performance/scheduled-tasks/${id}`)
      if (res.data.success) {
        Message.success('删除成功')
        fetchTasks()
      }
    } catch (err) {
      Message.error('删除失败')
    }
  }

  const handleRunNow = async (task) => {
    try {
      const res = await axios.post(`/api/performance/scheduled-tasks/${task.id}/run`)
      if (res.data.success) {
        Message.success('已触发执行')
      } else {
        Message.error(res.data.message || '触发失败')
      }
    } catch (err) {
      Message.error('触发失败')
    }
  }

  const columns = [
    { title: '任务名称', dataIndex: 'app_name', width: 140 },
    { title: '接口类型', dataIndex: 'interface_type', width: 120 },
    {
      title: '请求地址',
      dataIndex: 'request_url',
      render: (v) => <Text ellipsis style={{ maxWidth: 200 }}>{v}</Text>
    },
    { title: 'Cron表达式', dataIndex: 'cron_expression', width: 180 },
    {
      title: '状态',
      dataIndex: 'is_active',
      width: 80,
      render: (v) => <Tag color={v ? 'green' : 'gray'}>{v ? '启用' : '停用'}</Tag>
    },
    {
      title: '上次执行',
      dataIndex: 'last_run_at',
      width: 160,
      render: (v) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
    { title: '备注', dataIndex: 'remark', width: 120 },
    {
      title: '操作',
      width: 240,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button size="mini" type="text" icon={<IconPlayArrow />} onClick={() => handleRunNow(record)}>立即执行</Button>
          <Button size="mini" type="text" onClick={() => handleToggle(record)}>
            {record.is_active ? '停用' : '启用'}
          </Button>
          <Button size="mini" type="text" icon={<IconEdit />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确认删除该定时任务？" onOk={() => handleDelete(record.id)}>
            <Button size="mini" type="text" status="danger" icon={<IconDelete />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div className="perf-settings-tab">
      <div className="perf-settings-toolbar">
        <Button type="primary" icon={<IconPlus />} onClick={handleAdd}>新增定时任务</Button>
        <Button icon={<IconRefresh />} onClick={fetchTasks} loading={loading}>刷新</Button>
      </div>

      <Card style={{ marginBottom: 16, background: '#e8f4fd' }}>
        <div style={{ fontSize: 13, color: '#4e5969' }}>
          <strong>业绩看板定时任务说明：</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            <li>每月1日和4日凌晨00:00:00：自动触发数据生成任务，Cron表达式：<code>0 0 0 1,4 * *</code></li>
            <li>每日执行：先清理不符合保留条件的版本数据，再生成当月最后一天的数据，Cron表达式：<code>0 5 0 * * *</code></li>
          </ul>
        </div>
      </Card>

      <Table
        columns={columns}
        data={tasks}
        loading={loading}
        rowKey="id"
        scroll={{ x: 1000 }}
        pagination={{ pageSize: 20, showTotal: true }}
      />

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editTask ? '编辑定时任务' : '新增定时任务'}
        visible={showModal}
        onCancel={() => setShowModal(false)}
        onOk={handleSave}
        confirmLoading={saving}
        style={{ width: 600 }}
        unmountOnExit
      >
        <Form form={form} layout="vertical">
          <FormItem label="应用名称" field="app_name" rules={[{ required: true }]}>
            <Input placeholder="业绩看板应用" />
          </FormItem>
          <FormItem label="接口类型" field="interface_type" rules={[{ required: true }]}>
            <Select
              onChange={(val) => {
                form.setFieldValue('interface_type', val)
                // 根据接口类型自动填充请求URL
                if (val === '数据生成') {
                  form.setFieldValue('request_url', '/api/performance/versions')
                } else if (val === '数据清理') {
                  form.setFieldValue('request_url', '/api/performance/versions/cleanup')
                }
              }}
            >
              <Select.Option value="数据生成">数据生成</Select.Option>
              <Select.Option value="数据清理">数据清理</Select.Option>
              <Select.Option value="HTTP">HTTP请求</Select.Option>
            </Select>
          </FormItem>
          <FormItem label="请求URL" field="request_url" rules={[{ required: true }]}>
            <Input placeholder="例如: /api/performance/versions/auto-generate" />
          </FormItem>
          <FormItem
            label="Cron表达式"
            field="cron_expression"
            rules={[{ required: true, message: '请输入Cron表达式' }]}
            help="格式: 秒 分 时 日 月 周 年，例如 0 0 0 1,4 * ? * 表示每月1日和4日凌晨0点"
          >
            <Input
              placeholder="点击右侧按钮可视化配置 Cron 表达式"
              readOnly
              onClick={() => setShowCronModal(true)}
              addonAfter={
                <Button type="text" size="small" onClick={() => setShowCronModal(true)}>
                  配置
                </Button>
              }
            />
          </FormItem>
          <FormItem label="重试次数" field="retry_count">
            <InputNumber min={0} max={10} style={{ width: '100%' }} />
          </FormItem>
          <FormItem label="重试间隔(秒)" field="retry_interval">
            <InputNumber min={0} max={3600} style={{ width: '100%' }} />
          </FormItem>
          <FormItem label="是否启用" field="is_active">
            <Select>
              <Select.Option value={true}>启用</Select.Option>
              <Select.Option value={false}>停用</Select.Option>
            </Select>
          </FormItem>
          <FormItem label="备注" field="remark">
            <Input placeholder="可选备注" />
          </FormItem>
        </Form>
      </Modal>

      {/* Cron 表达式可视化配置弹窗 */}
      <CronGenerator
        visible={showCronModal}
        value={form.getFieldValue('cron_expression')}
        onChange={(cron) => {
          form.setFieldValue('cron_expression', cron)
          setShowCronModal(false)
        }}
        onCancel={() => setShowCronModal(false)}
      />
    </div>
  )
}

// ================= 主页面 =================

function PerformanceSettingsPage() {
  const [activeTab, setActiveTab] = useState('sql')

  return (
    <div className="perf-settings-page">
      <div className="perf-settings-header">
        <h2 className="perf-settings-title">业绩看板设置</h2>
        <div className="perf-settings-desc">管理业绩看板的数据接口配置和定时任务</div>
      </div>

      <Tabs activeTab={activeTab} onChange={setActiveTab} className="perf-settings-tabs">
        <TabPane key="sql" title="数据接口配置">
          <SqlConfigTab />
        </TabPane>
        <TabPane key="indicators" title="业绩看板说明配置">
          <IndicatorDescribeTab />
        </TabPane>
        <TabPane key="tasks" title="定时任务配置">
          <ScheduledTaskTab />
        </TabPane>
      </Tabs>
    </div>
  )
}

export default PerformanceSettingsPage
