const db = require('../../db');

const LOG_TAG = '[project-sourcing/track-match]';

/** 控制进度日志条数约 25 次以内，避免大表刷屏 */
function progressLogStep(total) {
  if (total <= 0) return 1;
  return Math.max(1, Math.ceil(total / 25));
}

function norm(s) {
  if (s == null) return '';
  return String(s).trim();
}

/** 用于关键词 / 三级名称在「行业文案 + 项目简介」中的非严格匹配：去空白、常见标点，英文小写 */
function looseNormalizeForMatch(s) {
  if (s == null) return '';
  let t = String(s).trim();
  t = t.replace(/\s+/g, '').replace(/\u3000/g, '');
  t = t.replace(/[·•．。,，;；:：、\\\-_（）()【】\[\]「」'"']/g, '');
  t = t.replace(/\//g, '');
  t = t.replace(/`/g, '');
  return t.toLowerCase();
}

function industryTextBlob(row) {
  return `${norm(row.industry_source_lv1)} ${norm(row.industry_source_lv2)} ${norm(row.industry_std_lv1)} ${norm(row.industry_std_lv2)}`;
}

/** 关键词仅在行业（来源/标准 L1、L2 文案）与项目简介中匹配，不含企业名、项目名 */
function loosePieceHitsRow(row, pieces) {
  const indLoose = looseNormalizeForMatch(industryTextBlob(row));
  const descLoose = looseNormalizeForMatch(row.project_desc);
  return pieces.some((piece) => {
    const k = looseNormalizeForMatch(piece);
    return k.length > 0 && (indLoose.includes(k) || descLoose.includes(k));
  });
}

async function loadActiveRules() {
  const rows = await db.query(`
    SELECT
      lv3.id AS lv3_id,
      lv3.name AS leaf_name,
      lv3.match_industry_lv1,
      lv3.match_industry_lv2,
      lv3.match_keywords,
      lv3.match_priority,
      lv2.name AS lv2_name,
      lv1.name AS lv1_name,
      t.name AS track_name
    FROM sourcing_track_lv3 lv3
    INNER JOIN sourcing_track_lv2 lv2 ON lv2.F_Id = lv3.lv2_id AND lv2.F_DeleteMark = 0
    INNER JOIN sourcing_track_lv1 lv1 ON lv1.F_Id = lv2.lv1_id AND lv1.F_DeleteMark = 0
    INNER JOIN sourcing_track t ON t.F_Id = lv1.track_id AND t.F_DeleteMark = 0
    WHERE lv3.F_DeleteMark = 0
    ORDER BY lv3.match_priority DESC, lv3.F_Id ASC
  `);
  return rows || [];
}

function industryMatch(rule, row) {
  const r1 = norm(rule.match_industry_lv1);
  const r2 = norm(rule.match_industry_lv2);
  const src1 = norm(row.industry_source_lv1);
  const src2 = norm(row.industry_source_lv2);
  const std1 = norm(row.industry_std_lv1);
  const std2 = norm(row.industry_std_lv2);

  if (r1 && r2) {
    const l1ok = r1 === src1 || r1 === std1;
    const l2ok = r2 === src2 || r2 === std2;
    return l1ok && l2ok;
  }
  if (r1 && !r2) {
    return r1 === src1 || r1 === std1;
  }
  if (!r1 && r2) {
    return r2 === src2 || r2 === std2;
  }
  return false;
}

function keywordMatch(rule, row) {
  const raw = norm(rule.match_keywords);
  if (!raw) return false;
  const parts = raw.split(/[,，;；、]/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return false;
  return loosePieceHitsRow(row, parts);
}

function ruleMatches(rule, row) {
  const hasInd = !!(norm(rule.match_industry_lv1) || norm(rule.match_industry_lv2));
  const hasKw = !!norm(rule.match_keywords);

  if (!hasInd && !hasKw) {
    const n = norm(rule.leaf_name);
    if (!n.length) return false;
    return loosePieceHitsRow(row, [n]);
  }

  const indOk = !hasInd || industryMatch(rule, row);
  const kwOk = !hasKw || keywordMatch(rule, row);
  if (hasInd && hasKw) return indOk && kwOk;
  return indOk && kwOk;
}

function pickRule(row, rules) {
  for (let i = 0; i < rules.length; i++) {
    if (ruleMatches(rules[i], row)) return rules[i];
  }
  return null;
}

/**
 * 按赛道配置写回 sourcing_financing_event 的 track_* 字段。
 * @param {object} opts
 * @param {number} [opts.limit]
 * @param {number} [opts.offset]
 * @param {'fill_empty'|'all'} [opts.mode] fill_empty 仅填充空赛道；all 对已扫描行按规则重算覆盖
 * @param {number[]} [opts.eventIds] 指定 ID 时忽略 limit/offset，常用于单条入库后增量匹配
 */
async function applyTrackMatchForEvents({ limit = 5000, offset = 0, mode = 'fill_empty', eventIds = null } = {}) {
  const rules = await loadActiveRules();
  if (!rules.length) {
    console.log(`${LOG_TAG} skip mode=${mode} reason=no_active_rules`);
    return { matched: 0, scanned: 0, message: '暂无赛道规则（请在二级分类下添加三级节点并配置匹配条件）' };
  }

  let sql = `
    SELECT F_Id AS id, company_name, project_name, project_desc,
           industry_source_lv1, industry_source_lv2, industry_std_lv1, industry_std_lv2,
           track_primary, track_secondary
    FROM sourcing_financing_event
    WHERE F_DeleteMark = 0
  `;
  const params = [];

  if (eventIds && eventIds.length) {
    sql += ` AND F_Id IN (${eventIds.map(() => '?').join(',')})`;
    params.push(...eventIds);
  } else {
    if (mode === 'fill_empty') {
      sql += ` AND (
        track_primary IS NULL OR track_primary = ''
        OR track_secondary IS NULL OR track_secondary = ''
      )`;
    }
    sql += ' ORDER BY F_Id ASC LIMIT ? OFFSET ?';
    params.push(Math.min(Math.max(parseInt(limit, 10) || 5000, 1), 20000), Math.max(parseInt(offset, 10) || 0, 0));
  }

  const rows = await db.query(sql, params);
  const total = rows.length;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 5000, 1), 20000);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  if (eventIds && eventIds.length) {
    console.log(
      `${LOG_TAG} start mode=${mode} rules=${rules.length} event_ids=${eventIds.length} batch_rows=${total}`
    );
  } else {
    console.log(
      `${LOG_TAG} start mode=${mode} rules=${rules.length} limit=${lim} offset=${off} batch_rows=${total}`
    );
  }

  let matched = 0;
  const step = progressLogStep(total);

  function logProgress(processed) {
    if (processed !== total && processed % step !== 0) return;
    const pct = total ? Math.round((processed / total) * 100) : 100;
    console.log(`${LOG_TAG} progress mode=${mode} ${processed}/${total} (${pct}%) matched=${matched}`);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!(mode === 'fill_empty' && norm(row.track_primary) && norm(row.track_secondary))) {
      const rule = pickRule(row, rules);
      if (rule) {
        const secondary = `${rule.lv1_name} / ${rule.lv2_name} / ${rule.leaf_name}`;
        let kw = norm(rule.match_keywords) || rule.leaf_name || '';
        if (kw.length > 500) kw = kw.slice(0, 500);

        await db.execute(
          `UPDATE sourcing_financing_event
           SET track_primary = ?, track_secondary = ?, track_keywords = ?, F_LastModifyTime = CURRENT_TIMESTAMP
           WHERE F_Id = ?`,
          [rule.track_name, secondary, kw || null, row.id]
        );
        matched++;
      }
    }
    logProgress(i + 1);
  }

  console.log(`${LOG_TAG} done mode=${mode} scanned=${total} matched=${matched}`);
  return { matched, scanned: total };
}

module.exports = {
  loadActiveRules,
  applyTrackMatchForEvents,
};
