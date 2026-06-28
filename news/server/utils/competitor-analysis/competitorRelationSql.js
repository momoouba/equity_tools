/** 竞品关系列表 SELECT 公共列（hydrate 前） */
const RELATION_LIST_SELECT_SQL = `
  F_Id AS id, subject_type, invested_enterprise_id, pre_investment_project_id, run_id,
  pre_investment_run_id, competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
  relevance_score, confidence_grade, score_breakdown_json,
  competitor_type, dimension_scores, evidence_summary, evidence_confidence, needs_review,
  evidence_breakdown_json, review_status, review_disposition, reviewed_at, review_note, human_locked,
  data_sources_json, financing_amount_text, financing_history_text,
  competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
  include_in_comparable, F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at
`.trim();

module.exports = {
  RELATION_LIST_SELECT_SQL,
};
