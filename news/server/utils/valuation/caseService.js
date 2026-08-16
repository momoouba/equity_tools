const db = require('../../db');
const { generateId } = require('../idGenerator');
const C = require('./constants');
const { defaultMethodConfig, defaultAssumptions, defaultScenarioSet } = require('./defaults');
const { isAdminUser } = require('./routeAuth');
const { APP_NAME_PROJECT_VALUATION, PROJECT_VALUATION_APP_ID } = require('./constants');
const {
  saveTargetFinancials,
  hydrateDraftPayload,
  DRAFT_VERSION_ID,
} = require('./targetFinancials');
const {
  saveWorkspace,
  loadWorkspace,
  loadMethod,
  saveMethod,
  loadComparison,
} = require('./workspaceStore');
const { recordPayloadChanges, recordChangeEvent, listChangeLog } = require('./changeLog');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');

function parseJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function assertOwner(req, row) {
  if (!row) {
    const err = new Error('记录不存在');
    err.code = 404;
    throw err;
  }
  if (isAdminUser(req.valUser)) return;
  const uid = req.valUser?.id ? String(req.valUser.id) : '';
  if (String(row.F_CreatorUserId || row.creator_user_id || '') !== uid) {
    const err = new Error('仅可访问本人创建的估值数据');
    err.code = 403;
    throw err;
  }
}

async function livePreProjectName(pre) {
  if (!pre) {
    return {
      display_name: '',
      live_name: null,
      snapshot_name: pre?.snapshot_name || null,
      source_deleted: false,
      competitor_project_no: null,
    };
  }
  if (!pre.competitor_pre_project_id) {
    return {
      display_name: pre.enterprise_full_name || pre.project_abbreviation || '',
      live_name: pre.enterprise_full_name,
      snapshot_name: pre.snapshot_name,
      source_deleted: false,
      competitor_project_no: null,
    };
  }
  const rows = await db.query(
    `SELECT enterprise_full_name, project_abbreviation, project_no, F_DeleteMark
     FROM pre_investment_project WHERE F_Id = ? LIMIT 1`,
    [pre.competitor_pre_project_id]
  );
  if (!rows.length || Number(rows[0].F_DeleteMark) === 1) {
    return {
      display_name: pre.snapshot_name || pre.enterprise_full_name || '',
      live_name: null,
      snapshot_name: pre.snapshot_name,
      source_deleted: true,
      competitor_project_no: null,
    };
  }
  const live = rows[0].enterprise_full_name || rows[0].project_abbreviation;
  return {
    display_name: live,
    live_name: live,
    snapshot_name: pre.snapshot_name,
    source_deleted: false,
    competitor_project_no: rows[0].project_no || null,
  };
}

async function createPreProject(req, body) {
  const uid = String(req.valUser.id);
  const fromCa = String(body.competitor_pre_project_id || '').trim();
  let fullName = String(body.enterprise_full_name || '').trim();
  let abbr = String(body.project_abbreviation || '').trim() || null;
  let credit = String(body.unified_credit_code || '').replace(/\s+/g, '').trim() || null;
  let snapshot = String(body.snapshot_name || '').trim() || null;
  if (fromCa) {
    const src = await db.query(
      `SELECT F_Id, enterprise_full_name, project_abbreviation, unified_credit_code
       FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [fromCa]
    );
    if (!src.length) {
      const err = new Error('竞品分析投前项目不存在或已删除');
      err.code = 404;
      throw err;
    }
    fullName = src[0].enterprise_full_name;
    abbr = src[0].project_abbreviation || abbr;
    credit = src[0].unified_credit_code || credit;
    snapshot = snapshot || fullName;
  }
  if (!fullName) {
    const err = new Error('请填写企业全称，或从竞品分析选择投前项目');
    err.code = 400;
    throw err;
  }
  const id = await generateId('valuation_pre_project');
  await db.execute(
    `INSERT INTO valuation_pre_project (
       F_Id, enterprise_full_name, project_abbreviation, unified_credit_code,
       competitor_pre_project_id, snapshot_name, F_CreatorUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,?,?,?,NOW(),NOW(),0)`,
    [id, fullName, abbr, credit, fromCa || null, snapshot, uid]
  );
  return getPreProject(req, id);
}

async function getPreProject(req, id) {
  const rows = await db.query(
    `SELECT F_Id AS id, enterprise_full_name, project_abbreviation, unified_credit_code,
            competitor_pre_project_id, snapshot_name, F_CreatorUserId AS creator_user_id,
            F_CreatorTime AS created_at, F_LastModifyTime AS updated_at
     FROM valuation_pre_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  assertOwner(req, rows[0]);
  const names = await livePreProjectName({
    competitor_pre_project_id: rows[0].competitor_pre_project_id,
    enterprise_full_name: rows[0].enterprise_full_name,
    project_abbreviation: rows[0].project_abbreviation,
    snapshot_name: rows[0].snapshot_name,
  });
  return { ...rows[0], ...names };
}

async function listPreProjects(req, { page, pageSize, keyword }) {
  const admin = isAdminUser(req.valUser);
  const uid = String(req.valUser.id);
  const kw = String(keyword || '').trim();
  const like = kw ? `%${kw}%` : null;
  const ownerSql = admin ? '1=1' : 'p.F_CreatorUserId = ?';
  const kwSql = like
    ? 'AND (p.enterprise_full_name LIKE ? OR p.project_abbreviation LIKE ? OR p.snapshot_name LIKE ? OR p.unified_credit_code LIKE ?)'
    : '';
  const params = [];
  if (!admin) params.push(uid);
  if (like) params.push(like, like, like, like);
  const count = await db.query(
    `SELECT COUNT(*) AS c FROM valuation_pre_project p WHERE p.F_DeleteMark = 0 AND ${ownerSql} ${kwSql}`,
    params
  );
  const offset = (page - 1) * pageSize;
  const list = await db.query(
    `SELECT p.F_Id AS id, p.enterprise_full_name, p.project_abbreviation, p.unified_credit_code,
            p.competitor_pre_project_id, p.snapshot_name, p.F_CreatorUserId AS creator_user_id,
            p.F_CreatorTime AS created_at,
            c.F_Id AS case_id, c.round_deal_value_yi,
            (SELECT COUNT(*) FROM valuation_version v WHERE v.case_id = c.F_Id AND v.F_DeleteMark = 0) AS version_count,
            (SELECT v.F_Id FROM valuation_version v WHERE v.case_id = c.F_Id AND v.F_DeleteMark = 0 ORDER BY v.version_no DESC LIMIT 1) AS latest_version_id,
            (SELECT v.F_CreatorTime FROM valuation_version v WHERE v.case_id = c.F_Id AND v.F_DeleteMark = 0 ORDER BY v.version_no DESC LIMIT 1) AS latest_valued_at
     FROM valuation_pre_project p
     LEFT JOIN valuation_case c ON c.pre_project_id = p.F_Id AND c.F_DeleteMark = 0 AND c.case_type = 'pre_investment'
     WHERE p.F_DeleteMark = 0 AND ${ownerSql} ${kwSql}
     ORDER BY p.F_CreatorTime DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const out = [];
  for (const row of list) {
    const names = await livePreProjectName(row);
    out.push({
      ...row,
      ...names,
      latest_conclusion: row.latest_version_id
        ? await loadComparison(row.case_id, row.latest_version_id)
        : null,
    });
  }
  return { list: out, total: Number(count[0]?.c || 0), page, pageSize };
}

async function listCompetitorPreProjects(req, { page, pageSize, keyword }) {
  const admin = isAdminUser(req.valUser);
  const uid = String(req.valUser.id);
  const caId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  const kw = String(keyword || '').trim();
  const like = kw ? `%${kw}%` : null;
  const ownerSql = admin ? '1=1' : 'F_CreatorUserId = ?';
  const appSql = caId
    ? '(data_app_id <=> ? OR (data_app_id IS NULL AND data_app_name = ?))'
    : 'data_app_name = ?';
  const kwSql = like ? 'AND (enterprise_full_name LIKE ? OR project_abbreviation LIKE ? OR project_no LIKE ?)' : '';
  const params = [];
  if (caId) params.push(caId, DATA_APP_COMPETITOR_ANALYSIS);
  else params.push(DATA_APP_COMPETITOR_ANALYSIS);
  if (!admin) params.push(uid);
  if (like) params.push(like, like, like);
  const count = await db.query(
    `SELECT COUNT(*) AS c FROM pre_investment_project
     WHERE F_DeleteMark = 0 AND ${appSql} AND ${ownerSql} ${kwSql}`,
    params
  );
  const offset = (page - 1) * pageSize;
  const list = await db.query(
    `SELECT F_Id AS id, project_no, enterprise_full_name, project_abbreviation, unified_credit_code,
            F_CreatorTime AS created_at
     FROM pre_investment_project
     WHERE F_DeleteMark = 0 AND ${appSql} AND ${ownerSql} ${kwSql}
     ORDER BY F_LastModifyTime DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  return { list, total: Number(count[0]?.c || 0), page, pageSize };
}

async function getInvestedEnterpriseForValuation(req, id) {
  const appId = await getApplicationIdByAppName(APP_NAME_PROJECT_VALUATION) || PROJECT_VALUATION_APP_ID;
  const rows = await db.query(
    `SELECT F_Id AS id, enterprise_full_name, project_abbreviation, unified_credit_code,
            F_CreatorUserId AS creator_user_id, data_app_id, data_app_name
     FROM invested_enterprises
     WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  const ok = String(row.data_app_id || '') === String(appId)
    || String(row.data_app_name || '') === APP_NAME_PROJECT_VALUATION;
  if (!ok) return null;
  assertOwner(req, row);
  return row;
}

async function openOrCreateCase(req, { caseType, preProjectId, investedEnterpriseId }) {
  const uid = String(req.valUser.id);
  if (caseType === C.CASE_TYPE_PRE) {
    const pre = await getPreProject(req, preProjectId);
    if (!pre) {
      const err = new Error('投前项目不存在');
      err.code = 404;
      throw err;
    }
    const exist = await db.query(
      `SELECT F_Id AS id FROM valuation_case
       WHERE case_type = ? AND pre_project_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [C.CASE_TYPE_PRE, pre.id]
    );
    if (exist.length) return getCase(req, exist[0].id);
    const id = await generateId('valuation_case');
    await db.execute(
      `INSERT INTO valuation_case (
         F_Id, case_type, pre_project_id, subject_display_name, status,
         F_CreatorUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
       ) VALUES (?,?,?,?,?,?,NOW(),NOW(),0)`,
      [id, C.CASE_TYPE_PRE, pre.id, pre.display_name, 'draft', uid]
    );
    await saveMethod(id, DRAFT_VERSION_ID, defaultMethodConfig());
    await ensureDraft(id, uid);
    return getCase(req, id);
  }

  const ie = await getInvestedEnterpriseForValuation(req, investedEnterpriseId);
  if (!ie) {
    const err = new Error('被投企业不存在或不属于项目估值');
    err.code = 404;
    throw err;
  }
  const exist = await db.query(
    `SELECT F_Id AS id FROM valuation_case
     WHERE case_type = ? AND invested_enterprise_id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [C.CASE_TYPE_POST, ie.id]
  );
  if (exist.length) return getCase(req, exist[0].id);
  const id = await generateId('valuation_case');
  const name = ie.enterprise_full_name || ie.project_abbreviation;
  await db.execute(
    `INSERT INTO valuation_case (
       F_Id, case_type, invested_enterprise_id, subject_display_name, status,
       F_CreatorUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,?,?,NOW(),NOW(),0)`,
    [id, C.CASE_TYPE_POST, ie.id, name, 'draft', uid]
  );
  await saveMethod(id, DRAFT_VERSION_ID, defaultMethodConfig());
  await ensureDraft(id, uid);
  return getCase(req, id);
}

function emptyDraftPayload() {
  return {
    methodConfig: defaultMethodConfig(),
    assumptions: defaultAssumptions(),
    scenarios: defaultScenarioSet(),
    targetPl: { years: [], revenue: [], cogs: [], selling: [], admin: [], rd: [], operating_profit: [], net_income: [] },
    targetBs: {},
    targetCf: {},
    overrides: {},
    sw_industry_l3: '',
    warnings: [],
    sheets: null,
    comparison: null,
  };
}

async function ensureDraft(caseId, userId) {
  const rows = await db.query('SELECT F_Id FROM valuation_draft WHERE case_id = ? LIMIT 1', [caseId]);
  if (rows.length) return rows[0].F_Id;
  const id = await generateId('valuation_draft');
  await db.execute(
    `INSERT INTO valuation_draft (F_Id, case_id, F_CreatorUserId, F_CreatorTime, F_LastModifyTime)
     VALUES (?,?,?,NOW(),NOW())`,
    [id, caseId, userId || null]
  );
  await saveWorkspace(caseId, DRAFT_VERSION_ID, emptyDraftPayload());
  return id;
}

async function attachSheetFinancials(payload) {
  if (!payload.sheets) return payload;
  payload.sheets.target_bs = {
    title: '资产负债表',
    payload: payload.targetBs || {},
    formula: '净负债=短期借款+长期借款−货币资金',
  };
  payload.sheets.target_cf = {
    title: '现金流量表',
    payload: payload.targetCf || {},
    formula: '折旧摊销供 DCF 加回；资本性支出与营运资金变动供扣减',
  };
  return payload;
}

async function getDraft(caseId) {
  await ensureDraft(caseId);
  const rows = await db.query(
    'SELECT F_Id AS id, F_LastModifyTime AS updated_at FROM valuation_draft WHERE case_id = ? LIMIT 1',
    [caseId]
  );
  const ws = await loadWorkspace(caseId, DRAFT_VERSION_ID);
  const payload = await attachSheetFinancials(
    await hydrateDraftPayload(caseId, { ...emptyDraftPayload(), ...ws })
  );
  return {
    id: rows[0].id,
    payload,
    updated_at: rows[0].updated_at,
  };
}

async function saveDraft(caseId, payload, userId, opts = {}) {
  await ensureDraft(caseId, userId);
  const full = payload || emptyDraftPayload();
  const before = await loadWorkspace(caseId, DRAFT_VERSION_ID);
  await saveTargetFinancials(caseId, DRAFT_VERSION_ID, full);
  await saveWorkspace(caseId, DRAFT_VERSION_ID, full);
  await recordPayloadChanges(caseId, before, full, userId, opts.source || 'draft');
  await db.execute(
    'UPDATE valuation_draft SET F_LastModifyTime = NOW() WHERE case_id = ?',
    [caseId]
  );
  return getDraft(caseId);
}

async function getCase(req, id) {
  const rows = await db.query(
    `SELECT F_Id AS id, case_type, pre_project_id, invested_enterprise_id, subject_display_name,
            round_deal_value_yi, status, F_CreatorUserId AS creator_user_id,
            F_CreatorTime AS created_at, F_LastModifyTime AS updated_at
     FROM valuation_case WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  assertOwner(req, rows[0]);
  const row = rows[0];
  let subject = { display_name: row.subject_display_name };
  if (row.case_type === C.CASE_TYPE_PRE && row.pre_project_id) {
    const pre = await getPreProject(req, row.pre_project_id);
    if (pre) subject = pre;
  } else if (row.invested_enterprise_id) {
    const ie = await getInvestedEnterpriseForValuation(req, row.invested_enterprise_id);
    if (ie) {
      subject = {
        ...ie,
        display_name: ie.enterprise_full_name || ie.project_abbreviation,
      };
    }
  }
  const versions = await db.query(
    `SELECT F_Id AS id, version_no, round_deal_value_yi, remark,
            F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at
     FROM valuation_version WHERE case_id = ? AND F_DeleteMark = 0 ORDER BY version_no DESC`,
    [id]
  );
  const versionOut = [];
  for (const v of versions) {
    versionOut.push({ ...v, conclusion: await loadComparison(id, v.id) });
  }
  return {
    ...row,
    method_config: await loadMethod(id, DRAFT_VERSION_ID),
    subject,
    versions: versionOut,
  };
}

async function listPostCases(req, { page, pageSize, keyword }) {
  const admin = isAdminUser(req.valUser);
  const uid = String(req.valUser.id);
  const kw = String(keyword || '').trim();
  const like = kw ? `%${kw}%` : null;
  const ownerSql = admin ? '1=1' : 'c.F_CreatorUserId = ?';
  const kwSql = like ? 'AND (c.subject_display_name LIKE ? OR ie.enterprise_full_name LIKE ? OR ie.project_abbreviation LIKE ?)' : '';
  const params = [];
  if (!admin) params.push(uid);
  if (like) params.push(like, like, like);
  const count = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM valuation_case c
     LEFT JOIN invested_enterprises ie ON ie.F_Id = c.invested_enterprise_id
     WHERE c.F_DeleteMark = 0 AND c.case_type = 'post_investment' AND ${ownerSql} ${kwSql}`,
    params
  );
  const offset = (page - 1) * pageSize;
  const list = await db.query(
    `SELECT c.F_Id AS id, c.invested_enterprise_id, c.subject_display_name, c.round_deal_value_yi,
            c.status, c.F_CreatorUserId AS creator_user_id, c.F_CreatorTime AS created_at,
            ie.enterprise_full_name, ie.project_abbreviation, ie.unified_credit_code,
            (SELECT COUNT(*) FROM valuation_version v WHERE v.case_id = c.F_Id AND v.F_DeleteMark = 0) AS version_count,
            (SELECT v.F_Id FROM valuation_version v WHERE v.case_id = c.F_Id AND v.F_DeleteMark = 0 ORDER BY v.version_no DESC LIMIT 1) AS latest_version_id,
            (SELECT v.F_CreatorTime FROM valuation_version v WHERE v.case_id = c.F_Id AND v.F_DeleteMark = 0 ORDER BY v.version_no DESC LIMIT 1) AS latest_valued_at
     FROM valuation_case c
     LEFT JOIN invested_enterprises ie ON ie.F_Id = c.invested_enterprise_id
     WHERE c.F_DeleteMark = 0 AND c.case_type = 'post_investment' AND ${ownerSql} ${kwSql}
     ORDER BY c.F_LastModifyTime DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const out = [];
  for (const r of list) {
    out.push({
      ...r,
      latest_conclusion: r.latest_version_id ? await loadComparison(r.id, r.latest_version_id) : null,
    });
  }
  return {
    list: out,
    total: Number(count[0]?.cnt || 0),
    page,
    pageSize,
  };
}

async function saveVersion(req, caseId, { remark } = {}) {
  const cse = await getCase(req, caseId);
  if (!cse) {
    const err = new Error('案件不存在');
    err.code = 404;
    throw err;
  }
  const draft = await getDraft(caseId);
  const payload = draft.payload || {};
  const nos = await db.query(
    'SELECT MAX(version_no) AS m FROM valuation_version WHERE case_id = ? AND F_DeleteMark = 0',
    [caseId]
  );
  const versionNo = Number(nos[0]?.m || 0) + 1;
  const id = await generateId('valuation_version');
  await db.execute(
    `INSERT INTO valuation_version (
       F_Id, case_id, version_no, round_deal_value_yi, remark, F_CreatorUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,?,?,NOW(),NOW(),0)`,
    [
      id,
      caseId,
      versionNo,
      cse.round_deal_value_yi,
      remark || null,
      String(req.valUser.id),
    ]
  );
  await saveWorkspace(caseId, id, payload);
  await saveTargetFinancials(caseId, id, payload);
  await recordChangeEvent(caseId, String(req.valUser.id), {
    field_key: 'save_version',
    field_label: '保存版本',
    old_value: '草稿',
    new_value: `v${versionNo}`,
    source: 'version',
  });
  return getVersionDetail(req, id);
}

async function getVersionDetail(req, versionId) {
  const rows = await db.query(
    `SELECT v.F_Id AS id, v.case_id, v.version_no, v.round_deal_value_yi, v.remark,
            v.F_CreatorUserId AS creator_user_id, v.F_CreatorTime AS created_at, c.F_CreatorUserId AS case_creator
     FROM valuation_version v
     INNER JOIN valuation_case c ON c.F_Id = v.case_id
     WHERE v.F_Id = ? AND v.F_DeleteMark = 0 LIMIT 1`,
    [versionId]
  );
  if (!rows.length) return null;
  assertOwner(req, { F_CreatorUserId: rows[0].case_creator });
  const ws = await loadWorkspace(rows[0].case_id, versionId);
  const payload = await attachSheetFinancials(
    await hydrateDraftPayload(rows[0].case_id, { ...emptyDraftPayload(), ...ws }, versionId)
  );
  return {
    ...rows[0],
    method_config: payload.methodConfig,
    assumptions: payload.assumptions,
    conclusion: payload.comparison,
    sheets: payload.sheets || {},
    payload,
  };
}

async function startDraftFromVersion(req, caseId, fromVersionId) {
  const cse = await getCase(req, caseId);
  if (!cse) {
    const err = new Error('案件不存在');
    err.code = 404;
    throw err;
  }
  let vid = String(fromVersionId || '').trim();
  if (!vid) vid = cse.versions?.[0]?.id || '';
  if (!vid) {
    const err = new Error('没有已存档版本，请先保存版本');
    err.code = 400;
    throw err;
  }
  const ver = await getVersionDetail(req, vid);
  if (!ver || ver.case_id !== cse.id) {
    const err = new Error('版本不存在');
    err.code = 404;
    throw err;
  }
  const fromNo = ver.version_no;
  await recordChangeEvent(caseId, String(req.valUser.id), {
    field_key: 'restore_version',
    field_label: '发起新版本',
    old_value: '当前草稿',
    new_value: `v${fromNo}`,
    source: 'restore',
  });
  await saveDraft(caseId, ver.payload, String(req.valUser.id), { source: 'restore' });
  return getDraft(caseId);
}

async function updateCaseMeta(req, caseId, body) {
  const cse = await getCase(req, caseId);
  if (!cse) {
    const err = new Error('案件不存在');
    err.code = 404;
    throw err;
  }
  const round = body.round_deal_value_yi;
  const method = body.method_config;
  const sets = [];
  const params = [];
  const userId = String(req.valUser.id);
  if (round !== undefined) {
    sets.push('round_deal_value_yi = ?');
    params.push(round === null || round === '' ? null : Number(round));
    await recordChangeEvent(caseId, userId, {
      field_key: 'round_deal_value_yi',
      field_label: '本轮交易估值',
      old_value: cse.round_deal_value_yi == null || cse.round_deal_value_yi === '' ? '（空）' : `${cse.round_deal_value_yi} 亿元`,
      new_value: round === null || round === '' ? '（空）' : `${round} 亿元`,
      source: 'case',
    });
  }
  if (method) {
    const before = { methodConfig: await loadMethod(caseId, DRAFT_VERSION_ID) };
    await saveMethod(caseId, DRAFT_VERSION_ID, method);
    await recordPayloadChanges(caseId, before, { methodConfig: method }, userId, 'method');
  }
  if (!sets.length && !method) return cse;
  if (sets.length) {
    params.push(caseId);
    await db.execute(
      `UPDATE valuation_case SET ${sets.join(', ')}, F_LastModifyTime = NOW() WHERE F_Id = ?`,
      params
    );
  }
  return getCase(req, caseId);
}

module.exports = {
  parseJson,
  assertOwner,
  createPreProject,
  getPreProject,
  listPreProjects,
  listCompetitorPreProjects,
  openOrCreateCase,
  getCase,
  listPostCases,
  getDraft,
  saveDraft,
  saveVersion,
  getVersionDetail,
  startDraftFromVersion,
  updateCaseMeta,
  emptyDraftPayload,
  getInvestedEnterpriseForValuation,
  listChangeLog,
};
