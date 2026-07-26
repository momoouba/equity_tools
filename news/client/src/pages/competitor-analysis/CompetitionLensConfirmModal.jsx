import React, { useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Checkbox,
  Input,
  Tag,
  Space,
  Typography,
  Spin,
  Message,
  Button,
} from '@arco-design/web-react'
import { IconEdit, IconLock } from '@arco-design/web-react/icon'

const { Text } = Typography
const TextArea = Input.TextArea

function groupFactors(factors) {
  const map = new Map()
  for (const f of factors || []) {
    const title = String(f.reason || f.dimension_label || '其他').trim() || '其他'
    if (!map.has(title)) map.set(title, [])
    map.get(title).push(f)
  }
  return [...map.entries()].map(([title, items]) => ({ title, items }))
}

/**
 * 确认对标焦点：分层展示；描述默认可只读，解锁后可改；重跑带回上次版本。
 */
export default function CompetitionLensConfirmModal({
  visible,
  onClose,
  subjectTitle,
  loadingProposal,
  proposal,
  confirming,
  onConfirm,
}) {
  const baseFactors = proposal?.factors || []
  const [selectedIds, setSelectedIds] = useState([])
  const [factorTexts, setFactorTexts] = useState({})
  const [editingIds, setEditingIds] = useState({})
  const [customKeywords, setCustomKeywords] = useState([])
  const [keywordDraft, setKeywordDraft] = useState('')

  useEffect(() => {
    if (!visible || !proposal) return
    const factors = proposal.factors || []
    setSelectedIds(factors.filter((f) => f.default_selected).map((f) => f.id))
    const texts = {}
    for (const f of factors) {
      texts[f.id] = f.text || f.base_text || ''
    }
    setFactorTexts(texts)
    setEditingIds({})
    setCustomKeywords(
      Array.isArray(proposal.default_custom_keywords) ? [...proposal.default_custom_keywords] : []
    )
    setKeywordDraft('')
  }, [visible, proposal])

  const factors = useMemo(
    () =>
      baseFactors.map((f) => ({
        ...f,
        text: factorTexts[f.id] != null ? factorTexts[f.id] : f.text,
      })),
    [baseFactors, factorTexts]
  )

  const groups = useMemo(() => groupFactors(factors), [factors])

  const selectedTexts = useMemo(() => {
    const fromFactors = factors
      .filter((f) => selectedIds.includes(f.id))
      .map((f) => String(f.text || '').trim())
      .filter(Boolean)
    return [...new Set([...fromFactors, ...customKeywords])]
  }, [factors, selectedIds, customKeywords])

  const sections = useMemo(() => {
    const list = [
      {
        key: 'structured',
        title: '结构化画像',
        match: (t) => String(t).startsWith('结构化画像'),
        items: [],
      },
      {
        key: 'productLine',
        title: '画像核心产品线',
        match: (t) => String(t).includes('画像核心产品线'),
        items: [],
      },
      {
        key: 'formCustomer',
        title: '形态/服务对象相关标签',
        match: (t) => String(t).includes('形态') || String(t).includes('服务对象'),
        items: [],
      },
    ]
    for (const g of groups) {
      const sec = list.find((s) => s.match(g.title)) || list[0]
      for (const f of g.items) {
        sec.items.push({ f, metaLine: sec.key === 'structured' ? g.title : f.dimension_label })
      }
    }
    return list
  }, [groups])

  const renderFactorCard = (f, metaLine) => {
    const checked = selectedIds.includes(f.id)
    const editing = !!editingIds[f.id]
    const curText = factorTexts[f.id] != null ? factorTexts[f.id] : f.text
    const isEdited = String(curText || '').trim() !== String(f.base_text || f.text || '').trim()
    return (
      <div
        key={f.id}
        style={{
          display: 'grid',
          gridTemplateColumns: '18px 1fr',
          columnGap: 12,
          alignItems: 'start',
          padding: '8px 10px',
          borderRadius: 6,
          background: checked ? 'var(--color-primary-light-1)' : 'var(--color-fill-1)',
          border: checked ? '1px solid var(--color-primary-light-3)' : '1px solid transparent',
        }}
      >
        <Checkbox
          checked={checked}
          onChange={(v) => toggleId(f.id, v)}
          style={{ marginTop: 1 }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: 4,
            }}
          >
            <div
              style={{
                fontSize: 12,
                lineHeight: '18px',
                color: 'var(--color-text-3)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {metaLine || f.dimension_label}
              {isEdited ? (
                <Tag size="small" color="orangered" style={{ marginLeft: 6 }}>
                  已编辑
                </Tag>
              ) : null}
            </div>
            <Space size={4}>
              {editing ? (
                <>
                  {isEdited || String(curText) !== String(f.base_text || '') ? (
                    <Button type="text" size="mini" onClick={(e) => resetToBase(f, e)}>
                      还原
                    </Button>
                  ) : null}
                  <Button
                    type="text"
                    size="mini"
                    icon={<IconLock />}
                    onClick={(e) => lockEdit(f.id, e)}
                  >
                    锁定
                  </Button>
                </>
              ) : (
                <Button
                  type="text"
                  size="mini"
                  icon={<IconEdit />}
                  onClick={(e) => startEdit(f.id, e)}
                >
                  编辑
                </Button>
              )}
            </Space>
          </div>
          {editing ? (
            <TextArea
              value={curText}
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={300}
              showWordLimit
              onChange={(v) => setFactorTexts((prev) => ({ ...prev, [f.id]: v }))}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              style={{
                fontSize: 14,
                lineHeight: 1.55,
                color: 'var(--color-text-1)',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap',
              }}
            >
              {curText}
            </div>
          )}
        </div>
      </div>
    )
  }

  const toggleId = (id, checked) => {
    setSelectedIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id]
      return prev.filter((x) => x !== id)
    })
  }

  const startEdit = (id, e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    setEditingIds((prev) => ({ ...prev, [id]: true }))
  }

  const lockEdit = (id, e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    const t = String(factorTexts[id] || '').trim()
    if (t.length < 2) {
      Message.warning('描述至少 2 个字')
      return
    }
    setEditingIds((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const resetToBase = (f, e) => {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    setFactorTexts((prev) => ({ ...prev, [f.id]: f.base_text || f.text }))
  }

  const addKeyword = () => {
    const parts = String(keywordDraft || '')
      .split(/[,，、;\s]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2)
    if (!parts.length) {
      Message.warning('请输入至少 2 个字的关键词')
      return
    }
    setCustomKeywords((prev) => {
      const seen = new Set(prev.map((x) => x.toLowerCase()))
      const next = [...prev]
      for (const p of parts) {
        if (seen.has(p.toLowerCase())) continue
        seen.add(p.toLowerCase())
        next.push(p.slice(0, 48))
      }
      return next.slice(0, 12)
    })
    setKeywordDraft('')
  }

  const handleOk = () => {
    if (Object.keys(editingIds).length) {
      Message.warning('请先完成描述编辑（点击锁定），再发起分析')
      return
    }
    if (!selectedTexts.length) {
      Message.warning('请至少勾选一项因素，或输入自定义关键词')
      return
    }
    onConfirm?.({
      selected_factor_ids: selectedIds,
      custom_keywords: customKeywords,
      factors: factors.map((f) => ({
        id: f.id,
        text: String(factorTexts[f.id] != null ? factorTexts[f.id] : f.text).trim(),
        base_text: f.base_text,
        edited:
          String(factorTexts[f.id] != null ? factorTexts[f.id] : f.text).trim() !==
          String(f.base_text || f.text || '').trim(),
      })),
      confirmed: true,
      source: 'user',
    })
  }

  const savedMeta = proposal?.saved_lens

  return (
    <Modal
      title={`确认对标焦点${subjectTitle ? ` — ${subjectTitle}` : ''}`}
      visible={visible}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={confirming}
      okText="按此焦点分析"
      cancelText="取消"
      style={{ width: 1440 }}
      unmountOnExit
    >
      {loadingProposal ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin tip="正在提取项目重要因素…" />
        </div>
      ) : (
        <Space direction="vertical" size="medium" style={{ width: '100%' }}>
          <Text type="secondary" style={{ lineHeight: 1.6 }}>
            {proposal?.tip || '勾选本次对标最重要的因素，并可编辑描述、补充关键词。'}
          </Text>
          {savedMeta?.version ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              已载入上次保存的对标焦点（版本 v{savedMeta.version}
              {savedMeta.saved_at
                ? `，${String(savedMeta.saved_at).replace('T', ' ').slice(0, 19)}`
                : ''}
              ），可继续修改后分析。
            </Text>
          ) : null}

          {factors.length === 0 ? (
            <Text type="warning">未能从画像提取到因素，请直接输入关键词。</Text>
          ) : (
            <div
              style={{
                maxHeight: 400,
                overflowY: 'auto',
                overflowX: 'hidden',
                border: '1px solid var(--color-border-2)',
                borderRadius: 6,
                padding: '4px 8px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 12,
                alignItems: 'start',
              }}
            >
              {sections.map(
                (sec) =>
                  sec.items.length > 0 && (
                    <div
                      key={sec.title}
                      style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--color-text-3)',
                          fontWeight: 500,
                          padding: '8px 8px 4px',
                        }}
                      >
                        {sec.title}
                      </div>
                      {sec.items.map(({ f, metaLine }) => renderFactorCard(f, metaLine))}
                    </div>
                  )
              )}
            </div>
          )}

          <div>
            <Text bold style={{ display: 'block', marginBottom: 8 }}>
              自定义关键词
            </Text>
            <Space wrap>
              <Input
                style={{ width: 320 }}
                placeholder="如：家庭服务机器人、C端、轮式双臂"
                value={keywordDraft}
                onChange={setKeywordDraft}
                onPressEnter={addKeyword}
                allowClear
              />
              <Button type="outline" onClick={addKeyword}>
                添加
              </Button>
            </Space>
            {customKeywords.length > 0 ? (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {customKeywords.map((k) => (
                  <Tag
                    key={k}
                    closable
                    onClose={() => setCustomKeywords((prev) => prev.filter((x) => x !== k))}
                  >
                    {k}
                  </Tag>
                ))}
              </div>
            ) : null}
          </div>

          {selectedTexts.length > 0 ? (
            <div
              style={{
                padding: '10px 12px',
                background: 'var(--color-fill-2)',
                borderRadius: 6,
              }}
            >
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                将锁定焦点（{selectedTexts.length}）
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selectedTexts.map((t) => (
                  <Tag key={t} color="arcoblue">
                    {t.length > 28 ? `${t.slice(0, 28)}…` : t}
                  </Tag>
                ))}
              </div>
            </div>
          ) : null}
        </Space>
      )}
    </Modal>
  )
}
