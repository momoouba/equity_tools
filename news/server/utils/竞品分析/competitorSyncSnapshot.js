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
  const ucc = normalizeCreditCode(row.unified_credit_code);
  if (ucc.length >= 15) return { type: 'ucc', key: ucc };
  const name = strTrim(row.enterprise_full_name).toLowerCase();
  if (name) return { type: 'name', key: name };
  const abbr = strTrim(row.project_abbreviation).toLowerCase();
  if (abbr) return { type: 'abbr', key: abbr };
  return null;
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
    `SELECT id, creator_user_id, unified_credit_code, enterprise_full_name, project_abbreviation
     FROM invested_enterprises
     WHERE delete_mark = 0 AND creator_user_id = ? AND data_app_id <=> ?`,
    [String(creatorUserId), caId]
  );
  if (!ieRows.length) return null;

  const ieIds = ieRows.map((r) => String(r.id));
  const runs = await queryInChunks(
    'SELECT * FROM sourcing_competitor_run WHERE delete_mark = 0 AND invested_enterprise_id IN',
    '',
    ieIds
  );
  const relations = await queryInChunks(
    `SELECT * FROM sourcing_competitor_relation WHERE delete_mark = 0
       AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
       AND invested_enterprise_id IN`,
    '',
    ieIds
  );
  const runIds = [...new Set(runs.map((r) => String(r.id)).filter(Boolean))];
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
         SELECT invested_enterprise_id, MAX(created_at) AS mx
         FROM competitor_match_supplement
         WHERE delete_mark = 0 AND invested_enterprise_id IN (${ph})
         GROUP BY invested_enterprise_id
       ) t ON s.invested_enterprise_id = t.invested_enterprise_id AND s.created_at = t.mx
       WHERE s.delete_mark = 0 AND s.invested_enterprise_id IN (${ph})`,
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
    byIe.set(String(ie.id), {
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
    const run = runs.find((r) => String(r.id) === String(s.run_id));
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
    const mk = buildSubjectMatchKey(b.ie);
    if (!mk) continue;
    const payload = { runs: rs, relations: rels, step_logs: logs, comparable_prefs: pf, supplement };
    await db.execute(
      `INSERT INTO competitor_analysis_sync_snapshot (
         batch_id, creator_user_id, data_app_name, match_type, match_key,
         old_invested_enterprise_id, payload_json, created_at
       ) VALUES (?,?,?,?,?,?,?,NOW())`,
      [
        batchId,
        String(creatorUserId),
        dataAppName,
        mk.type,
        mk.key,
        String(b.ie.id),
        JSON.stringify(payload),
      ]
    );
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
  const runIds = new Set(target.runs.map((r) => String(r.id)));
  for (const r of source.runs || []) {
    if (!runIds.has(String(r.id))) {
      target.runs.push(r);
      runIds.add(String(r.id));
    }
  }
  const relIds = new Set(target.relations.map((r) => String(r.id)));
  for (const r of source.relations || []) {
    if (!relIds.has(String(r.id))) {
      target.relations.push(r);
      relIds.add(String(r.id));
    }
  }
  const logIds = new Set(target.step_logs.map((r) => String(r.id)));
  for (const r of source.step_logs || []) {
    if (!logIds.has(String(r.id))) {
      target.step_logs.push(r);
      logIds.add(String(r.id));
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
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
  );
  for (const run of runs) {
    const newRunId = await generateId('sourcing_competitor_run');
    oldRunToNew.set(String(run.id), newRunId);
    await db.execute(
      `INSERT INTO sourcing_competitor_run (
         id, invested_enterprise_id, status, message, triggered_by_user_id,
         started_at, finished_at, created_at, updated_at, delete_mark, delete_time, delete_user_id
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newRunId,
        newIeId,
        run.status || 'success',
        run.message || null,
        run.triggered_by_user_id || null,
        run.started_at || null,
        run.finished_at || null,
        run.created_at || new Date(),
        run.updated_at || new Date(),
        Number(run.delete_mark) || 0,
        run.delete_time || null,
        run.delete_user_id || null,
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
         id, subject_type, invested_enterprise_id, pre_investment_project_id,
         run_id, pre_investment_run_id, subject_display_name,
         competitor_display_name, unified_credit_code, is_listed, competitor_weak_key,
         relevance_score, confidence_grade, score_breakdown_json,
         data_sources_json, financing_amount_text, financing_history_text,
         competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
         include_in_comparable, created_at, updated_at, delete_mark, delete_time, delete_user_id
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
        rel.created_at || new Date(),
        rel.updated_at || new Date(),
        Number(rel.delete_mark) || 0,
        rel.delete_time || null,
        rel.delete_user_id || null,
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
         id, run_id, subject_type, step_code, status, message, detail_json, created_at
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
        log.created_at || new Date(),
      ]
    );
    stats.step_logs += 1;
  }

  for (const pref of payload.comparable_prefs || []) {
    if (!pref.competitor_key) continue;
    const existing = await db.query(
      `SELECT id FROM sourcing_competitor_comparable_pref
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
           SET include_in_comparable = 1, updated_at = NOW()
           WHERE id = ?`,
          [existing[0].id]
        );
      }
      continue;
    }
    const prefId = await generateId('sourcing_competitor_comparable_pref');
    await db.execute(
      `INSERT INTO sourcing_competitor_comparable_pref (
         id, subject_type, invested_enterprise_id, pre_investment_project_id,
         competitor_key, include_in_comparable, created_at, updated_at
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
         id, invested_enterprise_id, user_tags_json, user_narrative_raw,
         ai_extracted_tags_json, ai_short_summary, batch_id, created_by,
         created_at, updated_at, delete_mark
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
     WHERE batch_id = ? AND creator_user_id = ? AND data_app_name = ?`,
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
    `SELECT id, unified_credit_code, enterprise_full_name, project_abbreviation
     FROM invested_enterprises
     WHERE delete_mark = 0 AND creator_user_id = ? AND data_app_id <=> ?`,
    [String(creatorUserId), caId]
  );

  const totals = { subjects: 0, runs: 0, relations: 0, step_logs: 0, prefs: 0, supplement: 0 };

  for (const ie of newRows) {
    const mk = buildSubjectMatchKey(ie);
    if (!mk) continue;
    const payload = payloadByMatch.get(matchKeyString(mk.type, mk.key));
    if (!payload) continue;

    const existingRels = await db.query(
      `SELECT 1 FROM sourcing_competitor_relation
       WHERE invested_enterprise_id = ? AND delete_mark = 0 LIMIT 1`,
      [String(ie.id)]
    );
    if (existingRels.length) continue;

    const st = await restoreSubjectPayload(String(ie.id), payload);
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
 */
async function migrateCompetitorEnterpriseIds(fromEnterpriseId, toEnterpriseId) {
  const fromId = String(fromEnterpriseId || '').trim();
  const toId = String(toEnterpriseId || '').trim();
  if (!fromId || !toId || fromId === toId) return;

  const r1 = await db.execute(
    `UPDATE sourcing_competitor_run SET invested_enterprise_id = ?, updated_at = NOW()
     WHERE invested_enterprise_id = ?`,
    [toId, fromId]
  );
  const r2 = await db.execute(
    `UPDATE sourcing_competitor_relation SET invested_enterprise_id = ?, updated_at = NOW()
     WHERE invested_enterprise_id = ? AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)`,
    [toId, fromId]
  );
  const r3 = await db.execute(
    `UPDATE sourcing_competitor_comparable_pref SET invested_enterprise_id = ?, updated_at = NOW()
     WHERE invested_enterprise_id = ? AND subject_type = 'invested_enterprise'`,
    [toId, fromId]
  );
  const r4 = await db.execute(
    `UPDATE competitor_match_supplement SET invested_enterprise_id = ?, updated_at = NOW()
     WHERE invested_enterprise_id = ? AND delete_mark = 0`,
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
      `DELETE FROM competitor_analysis_sync_snapshot WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
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

/** 当前竞品分析应用下被投：按创建人 + ucc/名称/简称 索引 */
async function buildCompetitorEnterpriseMatchIndex(creatorUserIdFilter) {
  const caId = CA_C.COMPETITOR_ANALYSIS_APP_ID;
  const params = [caId];
  let creatorClause = '';
  if (creatorUserIdFilter) {
    creatorClause = ' AND creator_user_id = ?';
    params.push(String(creatorUserIdFilter));
  }
  const rows = await db.query(
    `SELECT id, creator_user_id, unified_credit_code, enterprise_full_name, project_abbreviation
     FROM invested_enterprises
     WHERE delete_mark = 0 AND data_app_id <=> ?${creatorClause}`,
    params
  );
  const byCreator = new Map();
  const validIds = new Set();
  for (const r of rows) {
    const ieId = String(r.id);
    validIds.add(ieId);
    const cid = String(r.creator_user_id || '');
    if (!byCreator.has(cid)) {
      byCreator.set(cid, { ucc: new Map(), name: new Map(), abbr: new Map() });
    }
    const bucket = byCreator.get(cid);
    const mk = buildSubjectMatchKey(r);
    if (!mk) continue;
    if (!bucket[mk.type].has(mk.key)) bucket[mk.type].set(mk.key, ieId);
  }
  return { byCreator, validIds, rowCount: rows.length };
}

async function loadOldIdMatchHints(creatorUserIdFilter) {
  const hints = new Map();
  const add = (oldId, creatorUserId, match) => {
    const oid = String(oldId || '').trim();
    if (!oid || !match) return;
    if (!hints.has(oid)) {
      hints.set(oid, { creatorUserId: creatorUserId ? String(creatorUserId) : null, match });
    }
  };

  const snapParams = [CA_C.APP_NAME_COMPETITOR_ANALYSIS];
  let snapCreator = '';
  if (creatorUserIdFilter) {
    snapCreator = ' AND creator_user_id = ?';
    snapParams.push(String(creatorUserIdFilter));
  }
  const snapRows = await db.query(
    `SELECT old_invested_enterprise_id, creator_user_id, match_type, match_key
     FROM competitor_analysis_sync_snapshot
     WHERE data_app_name = ? AND old_invested_enterprise_id IS NOT NULL${snapCreator}
     ORDER BY created_at DESC`,
    snapParams
  );
  for (const row of snapRows) {
    add(row.old_invested_enterprise_id, row.creator_user_id, {
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
       ON ie.id = r.invested_enterprise_id AND ie.delete_mark = 0 AND ie.data_app_id <=> ?
     LEFT JOIN sourcing_competitor_run scr ON scr.id = r.run_id AND scr.delete_mark = 0
     WHERE r.delete_mark = 0
       AND (r.subject_type = 'invested_enterprise' OR r.subject_type IS NULL)
       AND r.invested_enterprise_id IS NOT NULL
       AND ie.id IS NULL${relCreator}
     GROUP BY r.invested_enterprise_id`,
    orphanRelParams
  );
  for (const row of orphanRelRows) {
    const name = strTrim(row.subject_name).toLowerCase();
    if (name) {
      add(row.invested_enterprise_id, row.triggered_by_user_id, { type: 'name', key: name });
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
       ON ie.id = scr.invested_enterprise_id AND ie.delete_mark = 0 AND ie.data_app_id <=> ?
     WHERE scr.delete_mark = 0 AND ie.id IS NULL${runCreator}
     GROUP BY scr.invested_enterprise_id`,
    orphanRunParams
  );
  for (const row of orphanRunRows) {
    if (!hints.has(String(row.invested_enterprise_id))) {
      hints.set(String(row.invested_enterprise_id), {
        creatorUserId: row.triggered_by_user_id ? String(row.triggered_by_user_id) : null,
        match: null,
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
       SELECT invested_enterprise_id AS ie_id FROM sourcing_competitor_run WHERE delete_mark = 0
       UNION
       SELECT invested_enterprise_id AS ie_id FROM sourcing_competitor_relation
         WHERE delete_mark = 0 AND invested_enterprise_id IS NOT NULL
       UNION
       SELECT invested_enterprise_id AS ie_id FROM sourcing_competitor_comparable_pref
         WHERE subject_type = 'invested_enterprise' AND invested_enterprise_id IS NOT NULL
       UNION
       SELECT invested_enterprise_id AS ie_id FROM competitor_match_supplement WHERE delete_mark = 0
     ) x
     LEFT JOIN invested_enterprises ie
       ON ie.id = x.ie_id AND ie.delete_mark = 0 AND ie.data_app_id <=> ?
     WHERE x.ie_id IS NOT NULL AND ie.id IS NULL`,
    [caId]
  );
  return rows.map((r) => String(r.old_id));
}

/**
 * 库内仍有竞品数据但 invested_enterprise_id 指向已删除/旧 id 时：
 * 按快照或主体展示名匹配统一社会信用代码/名称/简称，UPDATE 关联字段到当前被投 id。
 * @param {{ creatorUserId?: string, dryRun?: boolean }} [opts]
 */
async function relinkOrphanCompetitorDataBySubjectMatch(opts = {}) {
  const creatorUserIdFilter = opts.creatorUserId
    ? String(opts.creatorUserId).trim()
    : null;
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

  const hints = await loadOldIdMatchHints(creatorUserIdFilter);
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
    const match = hint?.match;
    if (!match) {
      stats.unresolved += 1;
      continue;
    }
    const newId = resolveNewIdFromMatchIndex(byCreator, hint?.creatorUserId, match);
    if (!newId || newId === oldId) {
      stats.unresolved += 1;
      continue;
    }
    stats.pairs.push({
      old_invested_enterprise_id: oldId,
      new_invested_enterprise_id: newId,
      match_type: match.type,
      match_key: match.key,
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
};
