import { isDefaultComparableVisible } from './competitorRelationColumns'

/** 与后端 DIALYSIS_PRIMARY_RE 对齐：血液透析/净化为主业 */
const DIALYSIS_PRIMARY_RE =
  /血液透析|透析器|腹膜透析|CRRT|血液净化|肾病治疗|肾科|透析耗材|透析设备|空心纤维透析/i

const BIO_FILTER_RE =
  /生物制药.*过滤|制药.*过滤|过滤膜|除菌过滤|深层过滤|切向流|TFF|超滤膜|生物工艺.*膜|除病毒过滤|过滤耗材|膜过滤/i

/**
 * 主体是否以透析/血液净化为主（含兼有生物制药膜副线的双赛道主体）。
 */
export function isDialysisPrimarySubject({ aiProductIntro, industryTags } = {}) {
  const blob = [industryTags, aiProductIntro].filter(Boolean).join('\n')
  return DIALYSIS_PRIMARY_RE.test(blob)
}

export function isBioFilterMembraneSubject({ aiProductIntro, industryTags } = {}) {
  const blob = [industryTags, aiProductIntro].filter(Boolean).join('\n')
  return BIO_FILTER_RE.test(blob) && !DIALYSIS_PRIMARY_RE.test(blob)
}

/** 默认列表中被隐藏的同赛道条数 */
export function countHiddenSameTrack(relationData = []) {
  return relationData.filter((row) => {
    const type = String(row?.competitor_type || '').trim().toLowerCase()
    return type === 'same_track' && !isDefaultComparableVisible(row)
  }).length
}

/**
 * 透析主赛道主体且存在同赛道落库时，默认展开同赛道列表。
 */
export function shouldAutoShowSameTrack({ aiProductIntro, industryTags, relationData } = {}) {
  if (!isDialysisPrimarySubject({ aiProductIntro, industryTags })) return false
  return countHiddenSameTrack(relationData) > 0
}

export function isReviewPending(row) {
  if (Number(row?.needs_review) === 1) return true
  return String(row?.review_status || '').trim() === 'pending'
}

export function isReviewDismissed(row) {
  return String(row?.review_status || '').trim() === 'dismissed'
}

export function countPendingReview(relationData = []) {
  return relationData.filter(isReviewPending).length
}

/** 列表可见性：默认隐藏已驳回 */
export function filterRelationsForDisplay(list, { reviewFilter = 'all', showDismissed = false } = {}) {
  return (list || []).filter((row) => {
    if (isReviewDismissed(row) && !showDismissed) return false
    if (reviewFilter === 'pending') return isReviewPending(row)
    if (reviewFilter === 'confirmed') {
      const s = String(row?.review_status || '').trim()
      return s === 'confirmed' || s === 'corrected'
    }
    if (reviewFilter === 'dismissed') return isReviewDismissed(row)
    return true
  })
}
