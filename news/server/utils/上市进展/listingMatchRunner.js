const db = require('../../db');
const {
  normalizeCompanyNameForMatch,
  fuzzySimilarity,
  canonicalCompanyForMatchCross,
} = require('./listingCompanyNormalize');
const { containsTraditional } = require('./zhconvUtils');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('./listingBeijingDate');

/** 同一底层项目 + 同一港股事件繁简双行时，优先保留与底层项目中英文全称书写一致的那条 IPO 进展行 */
function pickPreferredIpoProgressForProject(projectRow, ipRows) {
  if (!ipRows.length) return null;
  const projTrad = containsTraditional(String(projectRow.company || ''));
  if (projTrad) {
    const tradIps = ipRows.filter((ip) => containsTraditional(String(ip.company || '')));
    return tradIps[0] || ipRows[0];
  }
  const simpIps = ipRows.filter((ip) => !containsTraditional(String(ip.company || '')));
  return simpIps[0] || ipRows[0];
}

function deriveBoardFromNewShare(row) {
  const code = String(row.stock_code || '').trim();
  const exchange = String(row.exchange || '').trim();
  if (exchange === '\u5317\u4ea4\u6240') return '\u5317\u4ea4\u6240';
  if (exchange === '\u6e2f\u4ea4\u6240' || exchange === '\u9999\u6e2f\u8054\u4ea4\u6240') return '\u6e2f\u4ea4\u6240';
  if (exchange === '\u4e0a\u4ea4\u6240') {
    if (/^688/.test(code)) return '\u79d1\u521b\u677f';
    return '\u4e3b\u677f';
  }
  if (exchange === '\u6df1\u4ea4\u6240') {
    if (/^300/.test(code)) return '\u521b\u4e1a\u677f';
    return '\u4e3b\u677f';
  }
  return exchange || '\u5176\u4ed6';
}

function isNewShareMatch(projectRow, newShareRow, threshold = 0.8) {
  const projectNameScore = fuzzySimilarity(projectRow.project_name, newShareRow.stock_name);
  const companyCnScore = fuzzySimilarity(projectRow.company, newShareRow.enterprise_full_name_cn);
  const companyEnScore = fuzzySimilarity(projectRow.company, newShareRow.enterprise_full_name_en);
  const hit = projectNameScore >= threshold || companyCnScore >= threshold || companyEnScore >= threshold;
  return {
    hit,
    score: Math.max(projectNameScore, companyCnScore, companyEnScore),
    projectNameScore,
    companyCnScore,
    companyEnScore,
  };
}

function normYmd(v) {
  const s = String(v || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

async function runNewShareMatchBatch({
  restrictProjectUserId = null,
  newShareStartDate = '',
  newShareEndDate = '',
  newShareLookbackDays = 0,
} = {}) {
  const today = createShanghaiDate();
  const todayYmd = formatDateOnly(today);
  const yesterdayYmd = formatDateOnly(addDaysCalendar(today, -1));
  let startYmd = normYmd(newShareStartDate);
  let endYmd = normYmd(newShareEndDate);
  if (!startYmd || !endYmd) {
    const lookback = Number(newShareLookbackDays || 0);
    if (Number.isFinite(lookback) && lookback > 1) {
      endYmd = yesterdayYmd;
      startYmd = formatDateOnly(addDaysCalendar(new Date(`${yesterdayYmd}T12:00:00+08:00`), -(Math.floor(lookback) - 1)));
    } else {
      startYmd = yesterdayYmd;
      endYmd = yesterdayYmd;
    }
  }
  if (startYmd > endYmd) {
    const tmp = startYmd;
    startYmd = endYmd;
    endYmd = tmp;
  }

  const newShareRows = await db.query(
    `SELECT id, stock_code, stock_name, enterprise_full_name_cn, enterprise_full_name_en, exchange
     FROM ipo_new_share
     WHERE public_date IS NOT NULL
       AND DATE(public_date) >= ?
       AND DATE(public_date) <= ?`,
    [startYmd, endYmd]
  );

  let projectSql = `SELECT * FROM ipo_project WHERE F_DeleteMark = 0`;
  const projectParams = [];
  if (restrictProjectUserId) {
    projectSql += ` AND F_CreatorUserId = ?`;
    projectParams.push(restrictProjectUserId);
  }
  projectSql += ` ORDER BY f_id`;
  const projectRows = await db.query(projectSql, projectParams);
  console.log(
    `[listing-match][new-share] public_date=${startYmd}~${endYmd} new_share=${newShareRows.length} projects=${projectRows.length}` +
      (restrictProjectUserId ? ` user=${restrictProjectUserId}` : '')
  );

  const now = new Date();
  const updateAt = new Date(`${todayYmd}T00:00:00+08:00`);
  let inserted = 0;
  let matchedPairs = 0;
  let skipped = 0;
  for (const ns of newShareRows) {
    const board = deriveBoardFromNewShare(ns);
    for (const p of projectRows) {
      const hitInfo = isNewShareMatch(p, ns, 0.8);
      if (!hitInfo.hit) continue;
      matchedPairs += 1;
      const existing = await db.query(
        `SELECT f_id
         FROM ipo_project_progress
         WHERE match_source = 'new_share'
           AND ipo_project_f_id = ?
           AND new_share_row_id = ?
           AND DATE(f_update_time) = ?
         LIMIT 1`,
        [p.f_id, ns.id, todayYmd]
      );
      if (existing.length) {
        skipped += 1;
        continue;
      }
      await db.execute(
        `INSERT INTO ipo_project_progress (
          f_create_date, F_CreatorUserId, ipo_project_f_id, ipo_progress_row_id,
          new_share_row_id, match_source, match_score,
          fund, sub, project_name, company,
          inv_amount, residual_amount, ratio, ct_amount, ct_residual,
          status, board, exchange, f_update_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          now,
          p.F_CreatorUserId,
          p.f_id,
          null,
          ns.id,
          'new_share',
          Number(hitInfo.score.toFixed(4)),
          p.fund,
          p.sub,
          p.project_name,
          p.company,
          p.inv_amount,
          p.residual_amount,
          p.ratio,
          p.ct_amount,
          p.ct_residual,
          '\u6628\u65e5\u4e0a\u5e02',
          board,
          ns.exchange || '',
          updateAt,
        ]
      );
      inserted += 1;
    }
  }

  return {
    newShareCount: newShareRows.length,
    projectCount: projectRows.length,
    matchedPairs,
    inserted,
    skipped,
    publicDate: startYmd === endYmd ? startYmd : `${startYmd}~${endYmd}`,
    updateDate: todayYmd,
  };
}

async function backfillYesterdayListedStatus({ restrictProjectUserId = null }) {
  const params = [];
  let whereUser = '';
  if (restrictProjectUserId) {
    whereUser = ' AND F_CreatorUserId = ?';
    params.push(restrictProjectUserId);
  }
  const result = await db.execute(
    `UPDATE ipo_project_progress
     SET status = '\u6628\u65e5\u4e0a\u5e02'
     WHERE status != '\u6628\u65e5\u4e0a\u5e02'
       AND (
         match_source = 'new_share'
         OR new_share_row_id IS NOT NULL
         OR (ipo_progress_row_id IS NULL)
       )
       ${whereUser}`,
    params
  );

  const sourceFixResult = await db.execute(
    `UPDATE ipo_project_progress
     SET match_source = 'new_share'
     WHERE match_source != 'new_share'
       AND (
         new_share_row_id IS NOT NULL
         OR (ipo_progress_row_id IS NULL AND status = '\u6628\u65e5\u4e0a\u5e02')
       )
       ${whereUser}`,
    params
  );

  return {
    statusBackfilled: Number(result?.affectedRows || 0),
    sourceBackfilled: Number(sourceFixResult?.affectedRows || 0),
  };
}

function isListingMatchSkipNewShareEnvOn() {
  const v = String(process.env.LISTING_MATCH_SKIP_NEW_SHARE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Match ipo_progress with ipo_project and write ipo_project_progress.
 * Also appends "new-share listed yesterday" fuzzy-matching records.
 * @param {object} opts
 * @param {string} opts.startDate YYYY-MM-DD
 * @param {string} opts.endDate YYYY-MM-DD
 * @param {string|null} [opts.restrictProjectUserId] Restrict project owner for non-admin
 */
async function runListingMatchBatch({
  startDate,
  endDate,
  restrictProjectUserId = null,
  newShareStartDate = '',
  newShareEndDate = '',
  newShareLookbackDays = 0,
  matchTypes = [],
}) {
  const skipNewShareByEnv = isListingMatchSkipNewShareEnvOn();
  const backfillResult = skipNewShareByEnv
    ? { statusBackfilled: 0, sourceBackfilled: 0 }
    : await backfillYesterdayListedStatus({ restrictProjectUserId });

  const selectedTypes = Array.isArray(matchTypes)
    ? Array.from(new Set(matchTypes.map((x) => String(x || '').trim()).filter(Boolean)))
    : [];
  // 与 POST /api/listing/match 一致：未指定 matchTypes 时默认四类全跑（定时任务此前未传参会导致不写 exchange_ipo 匹配）
  const effectiveTypes =
    selectedTypes.length > 0
      ? selectedTypes
      : ['exchange_ipo', 'guidance_progress', 'overseas_filing', 'new_share'];
  const effectiveWithoutNewShare = skipNewShareByEnv
    ? effectiveTypes.filter((t) => t !== 'new_share')
    : effectiveTypes;

  if (skipNewShareByEnv && effectiveTypes.includes('new_share')) {
    console.log(
      '[listing-match] 已设置 LISTING_MATCH_SKIP_NEW_SHARE，跳过打新日历「昨日上市」模糊匹配及相关状态回填（IPO 进展匹配仍执行）'
    );
  }

  const selectedIpoTypes = effectiveWithoutNewShare.filter((x) =>
    ['exchange_ipo', 'guidance_progress', 'overseas_filing'].includes(x)
  );
  const includeIpoProgress = selectedIpoTypes.length > 0;
  const includeNewShare = !skipNewShareByEnv && effectiveWithoutNewShare.includes('new_share');

  const ipoWhere = [];
  if (selectedIpoTypes.includes('exchange_ipo')) {
    ipoWhere.push(`(COALESCE(exchange, '') <> '证监会辅导备案' AND COALESCE(exchange, '') <> '境外发行备案' AND COALESCE(board, '') <> '境外发行备案')`);
  }
  if (selectedIpoTypes.includes('guidance_progress')) {
    ipoWhere.push(`(exchange = '证监会辅导备案')`);
  }
  if (selectedIpoTypes.includes('overseas_filing')) {
    ipoWhere.push(`(exchange = '境外发行备案' OR board = '境外发行备案')`);
  }

  let progressRows = [];
  if (includeIpoProgress && startDate && endDate) {
    const sql = `SELECT * FROM ipo_progress
      WHERE F_DeleteMark = 0
        AND DATE(f_update_time) >= ?
        AND DATE(f_update_time) <= ?
        AND (${ipoWhere.join(' OR ')})
      ORDER BY f_id`;
    progressRows = await db.query(sql, [startDate, endDate]);
  }

  let projectSql = `SELECT * FROM ipo_project WHERE F_DeleteMark = 0`;
  const projectParams = [];
  if (restrictProjectUserId) {
    projectSql += ` AND F_CreatorUserId = ?`;
    projectParams.push(restrictProjectUserId);
  }
  projectSql += ` ORDER BY f_id`;
  const projectRows = await db.query(projectSql, projectParams);

  const progressIds = progressRows.map((r) => r.f_id);
  if (progressIds.length) {
    const ph = progressIds.map(() => '?').join(',');
    await db.query(`DELETE FROM ipo_project_progress WHERE ipo_progress_row_id IN (${ph})`, progressIds);
  }

  const now = new Date();
  let inserted = 0;

  /** @type {Map<string, { ip: object, p: object }[]>} */
  const matchBuckets = new Map();
  for (const ip of progressRows) {
    const nip = canonicalCompanyForMatchCross(ip.company, ip.exchange);
    if (!nip) continue;
    for (const p of projectRows) {
      const np = canonicalCompanyForMatchCross(p.company, ip.exchange);
      if (!np || nip !== np) continue;
      const dateStr = String(ip.f_update_time || '').slice(0, 10);
      const bucketKey = [
        p.f_id,
        dateStr,
        String(ip.status || '').trim(),
        String(ip.board || '').trim(),
        String(ip.exchange || '').trim(),
        nip,
      ].join('|');
      if (!matchBuckets.has(bucketKey)) matchBuckets.set(bucketKey, []);
      matchBuckets.get(bucketKey).push({ ip, p });
    }
  }

  for (const [, pairs] of matchBuckets) {
    if (!pairs.length) continue;
    const p = pairs[0].p;
    const ips = pairs.map((x) => x.ip);
    const ip = pickPreferredIpoProgressForProject(p, ips);
    if (!ip) continue;

    await db.execute(
      `INSERT INTO ipo_project_progress (
        f_create_date, F_CreatorUserId, ipo_project_f_id, ipo_progress_row_id,
        new_share_row_id, match_source, match_score,
        fund, sub, project_name, company,
        inv_amount, residual_amount, ratio, ct_amount, ct_residual,
        status, board, exchange, f_update_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        now,
        p.F_CreatorUserId,
        p.f_id,
        ip.f_id,
        null,
        'ipo_progress',
        null,
        p.fund,
        p.sub,
        p.project_name,
        p.company,
        p.inv_amount,
        p.residual_amount,
        p.ratio,
        p.ct_amount,
        p.ct_residual,
        ip.status,
        ip.board,
        ip.exchange,
        ip.f_update_time,
      ]
    );
    inserted += 1;
  }

  const newShareResult = includeNewShare
    ? await runNewShareMatchBatch({
        restrictProjectUserId,
        newShareStartDate,
        newShareEndDate,
        newShareLookbackDays,
      })
    : {
        newShareCount: 0,
        projectCount: projectRows.length,
        matchedPairs: 0,
        inserted: 0,
        skipped: 0,
        publicDate: null,
      };

  return {
    progressCount: progressRows.length,
    projectCount: projectRows.length,
    insertedFromIpoProgress: inserted,
    insertedFromNewShare: Number(newShareResult.inserted || 0),
    inserted: inserted + Number(newShareResult.inserted || 0),
    newSharePublicDate: newShareResult.publicDate,
    newShareMatchCount: Number(newShareResult.matchedPairs || 0),
    newShareCount: Number(newShareResult.newShareCount || 0),
    newShareSkipped: Number(newShareResult.skipped || 0),
    yesterdayStatusBackfilled: Number(backfillResult.statusBackfilled || 0),
    yesterdaySourceBackfilled: Number(backfillResult.sourceBackfilled || 0),
  };
}

module.exports = { runListingMatchBatch };
