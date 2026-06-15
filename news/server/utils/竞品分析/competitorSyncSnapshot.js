'use strict';

const crypto = require('crypto');
const db = require('../../db');
const { generateId } = require('../idGenerator');
const CA_C = require('./constants');
const { normalizeCreditCode, strTrim } = require('./competitorMatchUtils');

const SNAPSHOT_RETENTION_DAYS = 180;

function supportsCompetitorSyncSnapshot(dataAppName) {
  return String(dataAppName || '') === CA_C.APP_NAME_COMPETITOR_ANALYSIS;
}

/** @returns {{ type: 'ucc'|'name'|'abbr', key: string }|null} */
function buildSubjectMatchKey(row) {
  const keys = collectSubjectMatchKeys(row);
  return keys.length ? keys[0] : null;
}

/** 同步匹配用：信用代码、企业全称、项目简称均可作为重挂键（全称优先用于查找）。 */
function collectSubjectMatchKeys(row) {
  const keys = [];
  const ucc = normalizeCreditCode(row.unified_credit_code);
  if (ucc.length >= 15) keys.push({ type: 'ucc', key: ucc });
  const name = strTrim(row.enterprise_full_name).toLowerCase();
  if (name) keys.push({ type: 'name', key: name });
  const abbr = strTrim(row.project_abbreviation).toLowerCase();
  if (abbr) keys.push({ type: 'abbr', key: abbr });
  return keys;
}

const MATCH_LOOKUP_ORDER = ['name', 'ucc', 'abbr'];

function lookupPayloadByEnterprise(ie, payloadByMatch) {
  const keys = collectSubjectMatchKeys(ie);
  const ordered = [
    ...keys.filter((k) => k.type === 'name'),
    ...keys.filter((k) => k.type === 'ucc'),
    ...keys.filter((k) => k.type === 'abbr'),
  ];
  for (const mk of ordered) {
    const payload = payloadByMatch.get(matchKeyString(mk.type, mk.key));
    if (payload) return payload;
  }
  return null;
}

function mergeHintMatch(hints, oldId, creatorUserId, match) {
  const oid = String(oldId || '').trim();
  if (!oid || !match?.key) return;
  let hint = hints.get(oid);
  if (!hint) {
    hint = { creatorUserId: creatorUserId ? String(creatorUserId) : null, matches: [] };
    hints.set(oid, hint);
  } else if (creatorUserId && !hint.creatorUserId) {
    hint.creatorUserId = String(creatorUserId);
  }
  const dup = hint.matches.some((m) => m.type === match.type && m.key === match.key);
  if (!dup) hint.matches.push({ type: match.type, key: match.key });
}

function matchKeyString(type, key) {
  return `${type}:${key}`;
}

function serializeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'bigint') out[k] = String(v);
    else out[k] = v;
  }
  return out;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function queryInChunks(sqlPrefix, sqlSuffix, ids, params = []) {
  if (!ids.length) return [];
  const all = [];
  for (const chunk of chunkArray(ids, 200)) {
    const ph = chunk.map(() => '?').join(',');
    const rows = await db.query(`${sqlPrefix} (${ph}) ${sqlSuffix}`, [...params, ...chunk]);
    all.push(...rows);
  }
  return all;
}

/**
 * 硬删被投前：按统一社会信用代码/企业全称/项目简称备份竞品运行、关系、步骤日志、可比偏好、补录。
 * @returns {Promise<string|null>} batch_id
 */
async function backupCompetitorDataBeforeHardDelete(creatorUserId, dataAppName) {
  if (!creatorUserId || !supportsCompetitorSyncSnapshot(dataAppName)) return null;

  const caId = CA_C.COMPETITOR_ANALYSIS_APP_ID;
  const ieRows = await db.query(
    `SELECT F_Id, F_CreatorUserId, unified_credit_code, enterprise_full_name, project_abbreviation
     FROM invested_enterprises
     WHERE F_DeleteMark = 0 AND F_CreatorUserId = ? AND data_app_id <=> ?`,
    [String(creatorUserId), caId]
  );
  if (!ieRows.length) return null;

  const ieIds = ieRows.map((r) => String(r.F_Id));
  const runs = await queryInChunks(
    'SELECT * FROM sourcing_competitor_run WHERE F_DeleteMark = 0 AND invested_enterprise_id IN',
    '',
    ieIds
  );
  const relations = await queryInChunks(
    `SELECT * FROM sourcing_competitor_relation WHERE F_DeleteMark = 0
       AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
       AND invested_enterprise_id IN`,
    '',
    ieIds
  );
  const runIds = [...new Set(runs.map((r) => String(r.F_Id)).filter(Boolean))];
  const stepLogs = runIds.length
    ? await queryInChunks('SELECT * FROM sourcing_competitor_run_step_log WHERE run_id IN', '', runIds)
    : [];
  const prefs = await queryInChunks(
    `SELECT * FROM sourcing_competitor_comparable_pref
     WHERE subject_type = 'invested_enterprise' AND invested_enterprise_id IN`,
    '',
    ieIds
  );

  const supplements = [];
  for (const chunk of chunkArray(ieIds, 200)) {
    const ph = chunk.map(() => '?').join(',');
    const rows = await db.query(
      `SELECT s.* FROM competitor_match_supplement s
       INNER JOIN (
         SELECT invested_enterprise_id, MAX(F_CreatorTime) AS mx
         FROM competitor_match_supplement
         WHERE F_DeleteMark = 0 AND invested_enterprise_id IN (${ph})
         GROUP BY invested_enterprise_id
       ) t ON s.invested_enterprise_id = t.invested_enterprise_id AND s.F_CreatorTime = t.mx
       WHERE s.F_DeleteMark = 0 AND s.invested_enterprise_id IN (${ph})`,
      [...chunk, ...chunk]
    );
    supplements.push(...rows);
  }

  const hasAny =
    runs.length || relations.length || stepLogs.length || prefs.length || supplements.length;
  if (!hasAny) return null;

  const batchId = crypto.randomUUID();
  const byIe = new Map();
  for (const ie of ieRows) {
    byIe.set(String(ie.F_Id), {
      ie,
      runs: [],
      relations: [],
      stepLogs: [],
      prefs: [],
      supplement: null,
    });
  }
  for (const r of runs) {
    const b = byIe.get(String(r.invested_enterprise_id));
    if (b) b.runs.push(serializeRow(r));
  }
  for (const r of relations) {
    const b = byIe.get(String(r.invested_enterprise_id));
    if (b) b.relations.push(serializeRow(r));
  }
  for (const s of stepLogs) {
    const run = runs.find((r) => String(r.F_Id) === String(s.run_id));
    if (!run) continue;
    const b = byIe.get(String(run.invested_enterprise_id));
    if (b) b.stepLogs.push(serializeRow(s));
  }
  for (const p of prefs) {
    const b = byIe.get(String(p.invested_enterprise_id));
    if (b) b.prefs.push(serializeRow(p));
  }
  for (const sup of supplements) {
    const b = byIe.get(String(sup.invested_enterprise_id));
    if (b) b.supplement = serializeRow(sup);
  }

  let written = 0;
  for (const b of byIe.values()) {
    const { runs: rs, relations: rels, stepLogs: logs, prefs: pf, supplement } = b;
    if (!rs.length && !rels.length && !logs.length && !pf.length && !supplement) continue;
    const matchKeys = collectSubjectMatchKeys(b.ie);
    if (!matchKeys.length) continue;
    const payload = { runs: rs, relations: rels, step_logs: logs, comparable_prefs: pf, supplement };
    for (const mk of matchKeys) {
      await db.execute(
        `INSERT INTO competitor_analysis_sync_snapshot (
           batch_id, F_CreatorUserId, data_app_name, match_type, match_key,
           old_invested_enterprise_id, payload_json, F_CreatorTime
         ) VALUES (?,?,?,?,?,?,?,NOW())`,
        [
          batchId,
          String(creatorUserId),
          dataAppName,
          mk.type,
          mk.key,
          String(b.ie.F_Id),
          JSON.stringify(payload),
        ]
      );
    }
    written += 1;
  }

  if (!written) return null;
  console.log(
    `[竞品同步快照] 已备份 batch_id=${batchId} subjects=${written} runs=${runs.length} relations=${relations.length}`
  );
  return batchId;
}

function mergePayloads(target, source) {
  if (!source) return target;
  target.runs = target.runs || [];
  target.relations = target.relations || [];
  target.step_logs = target.step_logs || [];
  target.comparable_prefs = target.comparable_prefs || [];
  const runIds = new Set(target.runs.map((r) => String(r.F_Id)));
  for (const r of source.runs || []) {
    if (!runIds.has(String(r.F_Id))) {
      target.runs.push(r);
      runIds.add(String(r.F_Id));
    }
  }
  const relIds = new Set(target.relations.map((r) => String(r.F_Id)));
  for (const r of source.relations || []) {
    if (!relIds.has(String(r.F_Id))) {
      target.relations.push(r);
      relIds.add(String(r.F_Id));
    }
  }
  const logIds = new Set(target.step_logs.map((r) => String(r.F_Id)));
  for (const r of source.step_logs || []) {
    if (!logIds.has(String(r.F_Id))) {
      target.step_logs.push(r);
      logIds.add(String(r.F_Id));
    }
  }
  const prefKeys = new Set(
    target.comparable_prefs.map((p) => `${p.competitor_key}:${p.include_in_comparable}`)
  );
  for (const p of source.comparable_prefs || []) {
    const k = `${p.competitor_key}:${p.include_in_comparable}`;
    if (!prefKeys.has(k)) {
      target.comparable_prefs.push(p);
      prefKeys.add(k);
    }
  }
  if (source.supplement && !target.supplement) target.supplement = source.supplement;
  return target;
}

async function restoreSubjectPayload(newIeId, payload) {
  const stats = { runs: 0, relations: 0, step_logs: 0, prefs: 0, supplement: 0 };
  const oldRunToNew = new Map();

  const runs = [...(payload.runs || [])].sort(
    (a, b) => new Date(a.F_CreatorTime || 0) - new Date(b.F_CreatorTime || 0)
  );
  for (const run of runs) {
    const newRunId = await generateId('sourcing_competitor_run');
    oldRunToNew.set(String(run.F_Id), newRunId);
    await db.execute(
      `INSERT INTO sourcing_competitor_run (
         F_Id, invested_enterprise_id, status, message, triggered_by_user_id,
         started_at, finished_at, F_CreatorTime, F_LastModifyTime, F_DeleteMark, F_DeleteTime, F_DeleteUserId
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newRunId,
        newIeId,
        run.status || 'success',
        run.message || null,
        run.triggered_by_user_id || null,
        run.started_at || null,
        run.finished_at || null,
        run.F_CreatorTime || new Date(),
        run.F_LastModifyTime || new Date(),
        Number(run.F_DeleteMark) || 0,
        run.F_DeleteTime || null,
        run.F_DeleteUserId || null,
      ]
    );
    stats.runs += 1;
  }

  for (const rel of payload.relations || []) {
    const newRelId = await generateId('sourcing_competitor_relation');
    const oldRunId = rel.run_id != null ? String(rel.run_id) : '';
    const newRunId = oldRunId && oldRunToNew.has(oldRunId) ? oldRunToNew.get(oldRunId) : null;
    await db.execute(
      `INSERT INTO sourcing_competitor_relation (
         F_Id, subject_type, invested_enterprise_id, pre_investment_project_id,
         run_id, pre_investment_run_id, subject_display_name,
         competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
         relevance_score, confidence_grade, score_breakdown_json,
         data_sources_json, financing_amount_text, financing_history_text,
         competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
         include_in_comparable, F_CreatorTime, F_LastModifyTime, F_DeleteMark, F_DeleteTime, F_DeleteUserId
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newRelId,
        rel.subject_type || 'invested_enterprise',
        newIeId,
        rel.pre_investment_project_id || null,
        newRunId,
        rel.pre_investment_run_id || null,
        rel.subject_display_name || null,
        rel.competitor_display_name || null,
        rel.unified_credit_code || null,
        rel.is_listed != null ? Number(rel.is_listed) : 0,
        rel.competitor_weak_key || null,
        rel.relevance_score != null ? Number(rel.relevance_score) : null,
        rel.confidence_grade || null,
        rel.score_breakdown_json != null
          ? typeof rel.score_breakdown_json === 'string'
            ? rel.score_breakdown_json
            : JSON.stringify(rel.score_breakdown_json)
          : null,
        rel.data_sources_json != null
          ? typeof rel.data_sources_json === 'string'
            ? rel.data_sources_json
            : JSON.stringify(rel.data_sources_json)
          : null,
        rel.financing_amount_text || null,
        rel.financing_history_text || null,
        rel.competitor_product_intro || null,
        rel.competitor_tags_display || null,
        rel.competitor_tags_json != null
          ? typeof rel.competitor_tags_json === 'string'
            ? rel.competitor_tags_json
            : JSON.stringify(rel.competitor_tags_json)
          : null,
        rel.sub_fund_names || null,
        rel.include_in_comparable != null ? Number(rel.include_in_comparable) : 0,
        rel.F_CreatorTime || new Date(),
        rel.F_LastModifyTime || new Date(),
        Number(rel.F_DeleteMark) || 0,
        rel.F_DeleteTime || null,
        rel.F_DeleteUserId || null,
      ]
    );
    stats.relations += 1;
  }

  for (const log of payload.step_logs || []) {
    const oldRunId = log.run_id != null ? String(log.run_id) : '';
    const newRunId = oldRunToNew.get(oldRunId);
    if (!newRunId) continue;
    const newLogId = await generateId('sourcing_competitor_run_step_log');
    await db.execute(
      `INSERT INTO sourcing_competitor_run_step_log (
         F_Id, run_id, subject_type, step_code, status, message, detail_json, F_CreatorTime
       ) VALUES (?,?,?,?,?,?,?,?)`,
      [
        newLogId,
        newRunId,
        log.subject_type || 'invested_enterprise',
        log.step_code,
        log.status || 'ok',
        log.message || null,
        log.detail_json != null
          ? typeof log.detail_json === 'string'
            ? log.detail_json
            : JSON.stringify(log.detail_json)
          : null,
        log.F_CreatorTime || new Date(),
      ]
    );
    stats.step_logs += 1;
  }

  for (const pref of payload.comparable_prefs || []) {
    if (!pref.competitor_key) continue;
    const existing = await db.query(
      `SELECT F_Id FROM sourcing_competitor_comparable_pref
       WHERE subject_type = 'invested_enterprise'
         AND invested_enterprise_id <=> ?
         AND pre_investment_project_id <=> ?
         AND competitor_key = ?
       LIMIT 1`,
      [newIeId, pref.pre_investment_project_id || null, pref.competitor_key]
    );
    if (existing.length) {
      if (Number(pref.include_in_comparable) === 1) {
        await db.execute(
          `UPDATE sourcing_competitor_comparable_pref
           SET include_in_comparable = 1, F_LastModifyTime = NOW()
           WHERE F_Id = ?`,
          [existing[0].F_Id]
        );
      }
      continue;
    }
    const prefId = await generateId('sourcing_competitor_comparable_pref');
    await db.execute(
      `INSERT INTO sourcing_competitor_comparable_pref (
         F_Id, subject_type, invested_enterprise_id, pre_investment_project_id,
         competitor_key, include_in_comparable, F_CreatorTime, F_LastModifyTime
       ) VALUES (?,?,?,?,?,?,NOW(),NOW())`,
      [
        prefId,
        'invested_enterprise',
        newIeId,
        pref.pre_investment_project_id || null,
        pref.competitor_key,
        Number(pref.include_in_comparable) || 0,
      ]
    );
    stats.prefs += 1;
  }

  const sup = payload.supplement;
  if (sup) {
    const supId = await generateId('competitor_match_supplement');
    await db.execute(
      `INSERT INTO competitor_match_supplement (
         F_Id, invested_enterprise_id, user_tags_json, user_narrative_raw,
         ai_extracted_tags_json, ai_short_summary, batch_id, created_by,
         F_CreatorTime, F_LastModifyTime, F_DeleteMark
       ) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
      [
        supId,
        newIeId,
        sup.user_tags_json != null
          ? typeof sup.user_tags_json === 'string'
            ? sup.user_tags_json
            : JSON.stringify(sup.user_tags_json)
          : null,
        sup.user_narrative_raw || null,
        sup.ai_extracted_tags_json != null
          ? typeof sup.ai_extracted_tags_json === 'string'
            ? sup.ai_extracted_tags_json
            : JSON.stringify(sup.ai_extracted_tags_json)
          : null,
        sup.ai_short_summary || null,
        sup.batch_id || null,
        sup.created_by || null,
      ]
    );
    stats.supplement += 1;
  }

  return stats;
}

/**
 * 同步插入新被投后：按 batch 快照将竞品数据挂到新 invested_enterprise_id。
 */
async function restoreCompetitorDataAfterInsert(batchId, creatorUserId, dataAppName) {
  if (!batchId || !creatorUserId || !supportsCompetitorSyncSnapshot(dataAppName)) {
    return { subjects: 0, runs: 0, relations: 0, step_logs: 0, prefs: 0, supplement: 0 };
  }

  const snapshots = await db.query(
    `SELECT match_type, match_key, payload_json
     FROM competitor_analysis_sync_snapshot
     WHERE batch_id = ? AND F_CreatorUserId = ? AND data_app_name = ?`,
    [batchId, String(creatorUserId), dataAppName]
  );
  if (!snapshots.length) return { subjects: 0, runs: 0, relations: 0, step_logs: 0, prefs: 0, supplement: 0 };

  const payloadByMatch = new Map();
  for (const row of snapshots) {
    let payload;
    try {
      payload = typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
    } catch {
      continue;
    }
    const mk = matchKeyString(row.match_type, row.match_key);
    const prev = payloadByMatch.get(mk);
    payloadByMatch.set(mk, prev ? mergePayloads(prev, payload) : payload);
  }

  const caId = CA_C.COMPETITOR_ANALYSIS_APP_ID;
  const newRows = await db.query(
    `SELECT F_Id, unified_credit_code, enterprise_full_name, project_abbreviation
     FROM invested_enterprises
     WHERE F_DeleteMark = 0 AND F_CreatorUserId = ? AND data_app_id <=> ?`,
    [String(creatorUserId), caId]
  );

  const totals = { subjects: 0, runs: 0, relations: 0, step_logs: 0, prefs: 0, supplement: 0 };

  for (const ie of newRows) {
    const payload = lookupPayloadByEnterprise(ie, payloadByMatch);
    if (!payload) continue;

    const existingRels = await db.query(
      `SELECT 1 FROM sourcing_competitor_relation
       WHERE invested_enterprise_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [String(ie.F_Id)]
    );
    if (existingRels.length) continue;

    const st = await restoreSubjectPayload(String(ie.F_Id), payload);
    totals.subjects += 1;
    totals.runs += st.runs;
    totals.relations += st.relations;
    totals.step_logs += st.step_logs;
    totals.prefs += st.prefs;
    totals.supplement += st.supplement;
  }

  if (totals.subjects > 0) {
    console.log(
      `[竞品同步快照] 已恢复 batch_id=${batchId} subjects=${totals.subjects} relations=${totals.relations} runs=${totals.runs}`
    );
  }
  return totals;
}

/**
 * 被投去重合并：删除重复行前，将竞品相关数据迁移到保留行。
 * @param {string} fromEnterpriseId
 * @param {string} toEnterpriseId
 * @param {import('mysql2/promise').Pool|import('mysql2/promise').PoolConnection} [executor] 初始化阶段须传入 dbPool，避免 await db.ready 死锁
 */
async function migrateCompetitorEnterpriseIds(fromEnterpriseId, toEnterpriseId, executor = null) {
  const fromId = String(fromEnterpriseId || '').trim();
  const toId = String(toEnterpriseId || '').trim();
  if (!fromId || !toId || fromId === toId) return;

  const run = executor
    ? async (sql, params) => {
        const [result] = await executor.execute(sql, params);
        return result;
      }
    : (sql, params) => db.execute(sql, params);

  const r1 = await run(
    `UPDATE sourcing_competitor_run SET invested_enterprise_id = ?, F_LastModifyTime = NOW()
     WHERE invested_enterprise_id = ?`,
    [toId, fromId]
  );
  const r2 = await run(
    `UPDATE sourcing_competitor_relation SET invested_enterprise_id = ?, F_LastModifyTime = NOW()
     WHERE invested_enterprise_id = ? AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)`,
    [toId, fromId]
  );
  const r3 = await run(
    `UPDATE sourcing_competitor_comparable_pref SET invested_enterprise_id = ?, F_LastModifyTime = NOW()
     WHERE invested_enterprise_id = ? AND subject_type = 'invested_enterprise'`,
    [toId, fromId]
  );
  const r4 = await run(
    `UPDATE competitor_match_supplement SET invested_enterprise_id = ?, F_LastModifyTime = NOW()
     WHERE invested_enterprise_id = ? AND F_DeleteMark = 0`,
    [toId, fromId]
  );
  const n =
    (r1.affectedRows || 0) +
    (r2.affectedRows || 0) +
    (r3.affectedRows || 0) +
    (r4.affectedRows || 0);
  if (n > 0) {
    console.log(`[竞品数据迁移] ${fromId} -> ${toId}，更新 ${n} 行`);
  }
}

async function pruneOldCompetitorSyncSnapshots() {
  try {
    const r = await db.execute(
      `DELETE FROM competitor_analysis_sync_snapshot WHERE F_CreatorTime < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [SNAPSHOT_RETENTION_DAYS]
    );
    const n = r.affectedRows != null ? r.affectedRows : 0;
    if (n > 0) {
      console.log(`[竞品同步快照] 已清理过期快照 ${n} 条（>${SNAPSHOT_RETENTION_DAYS} 天）`);
    }
  } catch (e) {
    console.warn('[竞品同步快照] 清理过期快照失败', e.message);
  }
}

function resolveNewIdFromMatchIndex(byCreator, creatorUserId, match) {
  if (!match || !match.key) return null;
  const tryCreator = (cid) => {
    const bucket = byCreator.get(String(cid || ''));
    if (!bucket) return null;
    const map = bucket[match.type];
    return map ? map.get(match.key) || null : null;
  };
  if (creatorUserId) {
    const hit = tryCreator(creatorUserId);
    if (hit) return hit;
  }
  for (const [, bucket] of byCreator) {
    const map = bucket[match.type];
    const hit = map ? map.get(match.key) : null;
    if (hit) return hit;
  }
  return null;
}

function resolveNewIdFromMatchIndexMulti(byCreator, creatorUserId, matches) {
  if (!matches?.length) return null;
  const sorted = [...matches].sort(
    (a, b) => MATCH_LOOKUP_ORDER.indexOf(a.type) - MATCH_LOOKUP_ORDER.indexOf(b.type)
  );
  for (const match of sorted) {
    const hit = resolveNewIdFromMatchIndex(byCreator, creatorUserId, match);
    if (hit) return hit;
  }
  return null;
}

/** 当前竞品分析应用下被投：按创建人 + ucc/名称/简称 索引 */
async function buildCompetitorEnterpriseMatchIndex(creatorUserIdFilter) {
  const caId = CA_C.COMPETITOR_ANALYSIS_APP_ID;
  const params = [caId];
  let creatorClause = '';
  if (creatorUserIdFilter) {
    creatorClause = ' AND F_CreatorUserId = ?';
    params.push(String(creatorUserIdFilter));
  }
  const rows = await db.query(
    `SELECT F_Id, F_CreatorUserId, unified_credit_code, enterprise_full_name, project_abbreviation
     FROM invested_enterprises
     WHERE F_DeleteMark = 0 AND data_app_id <=> ?${creatorClause}`,
    params
  );
  const byCreator = new Map();
  const validIds = new Set();
  for (const r of rows) {
    const ieId = String(r.F_Id);
    validIds.add(ieId);
    const cid = String(r.F_CreatorUserId || '');
    if (!byCreator.has(cid)) {
      byCreator.set(cid, { ucc: new Map(), name: new Map(), abbr: new Map() });
    }
    const bucket = byCreator.get(cid);
    for (const mk of collectSubjectMatchKeys(r)) {
      if (!bucket[mk.type].has(mk.key)) bucket[mk.type].set(mk.key, ieId);
    }
  }
  return { byCreator, validIds, rowCount: rows.length };
}

async function loadOldIdMatchHints(creatorUserIdFilter, batchIdFilter) {
  const hints = new Map();

  if (batchIdFilter) {
    const batchParams = [String(batchIdFilter), CA_C.APP_NAME_COMPETITOR_ANALYSIS];
    let batchCreator = '';
    if (creatorUserIdFilter) {
      batchCreator = ' AND F_CreatorUserId = ?';
      batchParams.push(String(creatorUserIdFilter));
    }
    const batchRows = await db.query(
      `SELECT old_invested_enterprise_id, F_CreatorUserId, match_type, match_key
       FROM competitor_analysis_sync_snapshot
       WHERE batch_id = ? AND data_app_name = ? AND old_invested_enterprise_id IS NOT NULL${batchCreator}`,
      batchParams
    );
    for (const row of batchRows) {
      mergeHintMatch(hints, row.old_invested_enterprise_id, row.F_CreatorUserId, {
        type: row.match_type,
        key: row.match_key,
      });
    }
  }

  const snapParams = [CA_C.APP_NAME_COMPETITOR_ANALYSIS];
  let snapCreator = '';
  if (creatorUserIdFilter) {
    snapCreator = ' AND F_CreatorUserId = ?';
    snapParams.push(String(creatorUserIdFilter));
  }
  let batchExclude = '';
  if (batchIdFilter) {
    batchExclude = ' AND batch_id <> ?';
    snapParams.push(String(batchIdFilter));
  }
  const snapRows = await db.query(
    `SELECT old_invested_enterprise_id, F_CreatorUserId, match_type, match_key
     FROM competitor_analysis_sync_snapshot
     WHERE data_app_name = ? AND old_invested_enterprise_id IS NOT NULL${snapCreator}${batchExclude}
     ORDER BY F_CreatorTime DESC`,
    snapParams
  );
  for (const row of snapRows) {
    mergeHintMatch(hints, row.old_invested_enterprise_id, row.F_CreatorUserId, {
      type: row.match_type,
      key: row.match_key,
    });
  }

  const caId = CA_C.COMPETITOR_ANALYSIS_APP_ID;
  const orphanRelParams = [caId];
  let relCreator = '';
  if (creatorUserIdFilter) {
    relCreator = ' AND scr.triggered_by_user_id = ?';
    orphanRelParams.push(String(creatorUserIdFilter));
  }
  const orphanRelRows = await db.query(
    `SELECT r.invested_enterprise_id, MAX(r.subject_display_name) AS subject_name,
            MAX(scr.triggered_by_user_id) AS triggered_by_user_id
     FROM sourcing_competitor_relation r
     LEFT JOIN invested_enterprises ie
       ON ie.F_Id = r.invested_enterprise_id AND ie.F_DeleteMark = 0 AND ie.data_app_id <=> ?
     LEFT JOIN sourcing_competitor_run scr ON scr.F_Id = r.run_id AND scr.F_DeleteMark = 0
     WHERE r.F_DeleteMark = 0
       AND (r.subject_type = 'invested_enterprise' OR r.subject_type IS NULL)
       AND r.invested_enterprise_id IS NOT NULL
       AND ie.F_Id IS NULL${relCreator}
     GROUP BY r.invested_enterprise_id`,
    orphanRelParams
  );
  for (const row of orphanRelRows) {
    const name = strTrim(row.subject_name).toLowerCase();
    if (name) {
      mergeHintMatch(hints, row.invested_enterprise_id, row.triggered_by_user_id, {
        type: 'name',
        key: name,
      });
    }
  }

  const orphanRunParams = [caId];
  let runCreator = '';
  if (creatorUserIdFilter) {
    runCreator = ' AND scr.triggered_by_user_id = ?';
    orphanRunParams.push(String(creatorUserIdFilter));
  }
  const orphanRunRows = await db.query(
    `SELECT scr.invested_enterprise_id, MAX(scr.triggered_by_user_id) AS triggered_by_user_id
     FROM sourcing_competitor_run scr
     LEFT JOIN invested_enterprises ie
       ON ie.F_Id = scr.invested_enterprise_id AND ie.F_DeleteMark = 0 AND ie.data_app_id <=> ?
     WHERE scr.F_DeleteMark = 0 AND ie.F_Id IS NULL${runCreator}
     GROUP BY scr.invested_enterprise_id`,
    orphanRunParams
  );
  for (const row of orphanRunRows) {
    if (!hints.has(String(row.invested_enterprise_id))) {
      hints.set(String(row.invested_enterprise_id), {
        creatorUserId: row.triggered_by_user_id ? String(row.triggered_by_user_id) : null,
        matches: [],
      });
    }
  }

  return hints;
}

async function findOrphanInvestedEnterpriseIds() {
  const caId = CA_C.COMPETITOR_ANALYSIS_APP_ID;
  const rows = await db.query(
    `SELECT DISTINCT x.ie_id AS old_id
     FROM (
       SELECT invested_enterprise_id AS ie_id FROM sourcing_competitor_run WHERE F_DeleteMark = 0
       UNION
       SELECT invested_enterprise_id AS ie_id FROM sourcing_competitor_relation
         WHERE F_DeleteMark = 0 AND invested_enterprise_id IS NOT NULL
       UNION
       SELECT invested_enterprise_id AS ie_id FROM sourcing_competitor_comparable_pref
         WHERE subject_type = 'invested_enterprise' AND invested_enterprise_id IS NOT NULL
       UNION
       SELECT invested_enterprise_id AS ie_id FROM competitor_match_supplement WHERE F_DeleteMark = 0
     ) x
     LEFT JOIN invested_enterprises ie
       ON ie.F_Id = x.ie_id AND ie.F_DeleteMark = 0 AND ie.data_app_id <=> ?
     WHERE x.ie_id IS NOT NULL AND ie.F_Id IS NULL`,
    [caId]
  );
  return rows.map((r) => String(r.old_id));
}

/**
 * 库内仍有竞品数据但 invested_enterprise_id 指向已删除/旧 id 时：
 * 按快照或主体展示名匹配统一社会信用代码/名称/简称，UPDATE 关联字段到当前被投 id。
 * @param {{ creatorUserId?: string, batchId?: string, dryRun?: boolean }} [opts]
 */
async function relinkOrphanCompetitorDataBySubjectMatch(opts = {}) {
  const creatorUserIdFilter = opts.creatorUserId
    ? String(opts.creatorUserId).trim()
    : null;
  const batchIdFilter = opts.batchId ? String(opts.batchId).trim() : null;
  const dryRun = opts.dryRun === true;

  const { byCreator, validIds, rowCount } = await buildCompetitorEnterpriseMatchIndex(
    creatorUserIdFilter
  );
  if (!rowCount) {
    return {
      dry_run: dryRun,
      current_enterprises: 0,
      orphan_old_ids: 0,
      relinked: 0,
      unresolved: 0,
      pairs: [],
    };
  }

  const hints = await loadOldIdMatchHints(creatorUserIdFilter, batchIdFilter);
  let orphanOldIds = await findOrphanInvestedEnterpriseIds();
  if (creatorUserIdFilter) {
    const cid = String(creatorUserIdFilter);
    orphanOldIds = orphanOldIds.filter((oldId) => {
      const h = hints.get(oldId);
      return !h?.creatorUserId || h.creatorUserId === cid;
    });
  }

  const stats = {
    dry_run: dryRun,
    current_enterprises: rowCount,
    orphan_old_ids: orphanOldIds.length,
    relinked: 0,
    unresolved: 0,
    pairs: [],
  };

  for (const oldId of orphanOldIds) {
    if (validIds.has(oldId)) continue;
    const hint = hints.get(oldId);
    const matches = hint?.matches || [];
    if (!matches.length) {
      stats.unresolved += 1;
      continue;
    }
    const newId = resolveNewIdFromMatchIndexMulti(byCreator, hint?.creatorUserId, matches);
    if (!newId || newId === oldId) {
      stats.unresolved += 1;
      continue;
    }
    const primaryMatch =
      [...matches].sort(
        (a, b) => MATCH_LOOKUP_ORDER.indexOf(a.type) - MATCH_LOOKUP_ORDER.indexOf(b.type)
      )[0] || matches[0];
    stats.pairs.push({
      old_invested_enterprise_id: oldId,
      new_invested_enterprise_id: newId,
      match_type: primaryMatch.type,
      match_key: primaryMatch.key,
    });
    if (!dryRun) {
      await migrateCompetitorEnterpriseIds(oldId, newId);
    }
    stats.relinked += 1;
  }

  if (stats.relinked > 0 || stats.unresolved > 0) {
    console.log(
      `[竞品关联修复] ${dryRun ? '(dry-run) ' : ''}孤儿旧 id ${stats.orphan_old_ids} 个，已匹配重挂 ${stats.relinked}，未解析 ${stats.unresolved}`
    );
  }
  return stats;
}

module.exports = {
  supportsCompetitorSyncSnapshot,
  backupCompetitorDataBeforeHardDelete,
  restoreCompetitorDataAfterInsert,
  migrateCompetitorEnterpriseIds,
  pruneOldCompetitorSyncSnapshots,
  relinkOrphanCompetitorDataBySubjectMatch,
  buildSubjectMatchKey,
  collectSubjectMatchKeys,
  lookupPayloadByEnterprise,
};
