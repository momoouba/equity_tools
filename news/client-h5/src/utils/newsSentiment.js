/**
 * 与邮件 emailSender.formatNewsSentiment / resolveEmailSentiment 对齐的中文情绪展示
 */

const JUDICIAL_ATTENTION_ACCOUNTS = ['破产重整', '破产重组', '开庭公告']

const SENTIMENT_MAP = {
  positive: { text: '正面', tone: 'pos' },
  negative: { text: '负面', tone: 'neg' },
  neutral: { text: '中性', tone: 'neu' },
  attention: { text: '关注', tone: 'attention' },
  正面: { text: '正面', tone: 'pos' },
  负面: { text: '负面', tone: 'neg' },
  中性: { text: '中性', tone: 'neu' },
  关注: { text: '关注', tone: 'attention' }
}

/** 破产重整/开庭公告：申请人/上诉人历史 negative → 关注 */
export function resolveNewsSentiment(news) {
  const raw = news && news.news_sentiment
  if (raw && raw !== 'negative' && raw !== '负面') return raw
  const accountName = news && news.account_name ? String(news.account_name).trim() : ''
  if (!JUDICIAL_ATTENTION_ACCOUNTS.includes(accountName)) return raw
  const text = `${news.news_abstract || ''}\n${news.content || ''}\n${news.summary || ''}`
  if (/主体身份为被(?:申请人|上诉人)|作为被(?:申请人|上诉人)/.test(text)) return 'negative'
  if (
    /主体身份为(?:申请人|上诉人)/.test(text) ||
    /作为[^，,]{0,20}的(?:申请人|上诉人)/.test(text) ||
    /作为(?:申请人|上诉人)涉及/.test(text)
  ) {
    return 'attention'
  }
  return raw
}

export function formatNewsSentiment(news) {
  const key = resolveNewsSentiment(news)
  const mapped = SENTIMENT_MAP[key]
  if (mapped) return mapped
  const s = String(key || '').trim()
  if (!s) return { text: '未知', tone: 'neu' }
  if (s.includes('正')) return { text: '正面', tone: 'pos' }
  if (s.includes('负')) return { text: '负面', tone: 'neg' }
  if (s.includes('关注')) return { text: '关注', tone: 'attention' }
  if (s.includes('中')) return { text: '中性', tone: 'neu' }
  return { text: s, tone: 'neu' }
}

export function isThirdPartyNews(item) {
  const t = String(item?.entity_type || '').trim()
  if (t === '第三方公众号' || t.includes('第三方')) return true
  const abbr = String(item?.enterprise_abbreviation || '').trim()
  const full = String(item?.enterprise_full_name || '').trim()
  // 无企业字段、有公众号名 → 按第三方头展示
  if (!abbr && !full && (item?.account_name || item?.wechat_account)) return true
  return false
}

/** 卡片头：企业=简称 + 右侧全称；第三方=公众号名 */
export function newsCardHeader(item) {
  if (isThirdPartyNews(item)) {
    const name =
      String(item?.account_name || '').trim() ||
      String(item?.wechat_account || '').trim() ||
      '第三方公众号'
    return { primary: name, secondary: '', thirdParty: true }
  }
  const abbr = String(item?.enterprise_abbreviation || '').trim()
  const full = String(item?.enterprise_full_name || '').trim()
  const primary = abbr || full || '未命名项目'
  const secondary = full && full !== primary ? full : ''
  return { primary, secondary, thirdParty: false }
}

/** 同一企业 / 同一第三方公众号归组键（保持列表首次出现顺序） */
export function newsGroupKey(item) {
  const header = newsCardHeader(item)
  if (header.thirdParty) {
    return `tp:${header.primary}`
  }
  const abbr = String(item?.enterprise_abbreviation || '').trim()
  const full = String(item?.enterprise_full_name || '').trim()
  return `ent:${abbr || full || header.primary}`
}

/** 将扁平新闻列表按企业/第三方归组，顺序=各组首条出现顺序 */
export function groupNewsByEntity(list) {
  const order = []
  const map = new Map()
  for (const item of list || []) {
    const key = newsGroupKey(item)
    if (!map.has(key)) {
      map.set(key, {
        key,
        header: newsCardHeader(item),
        items: []
      })
      order.push(key)
    }
    map.get(key).items.push(item)
  }
  return order.map((k) => map.get(k))
}
