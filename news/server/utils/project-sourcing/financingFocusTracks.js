/**
 * 融资概览「热门赛道」分析范围：目前仅三大赛道。
 */
const FOCUS_TRACK_PRIMARIES = ['人工智能', '生物医药', '半导体'];

function isFocusTrackPrimary(name) {
  return FOCUS_TRACK_PRIMARIES.includes(String(name || '').trim());
}

module.exports = {
  FOCUS_TRACK_PRIMARIES,
  isFocusTrackPrimary,
};
