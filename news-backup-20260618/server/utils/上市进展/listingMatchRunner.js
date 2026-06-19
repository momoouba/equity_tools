const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { canonicalCompanyForMatchCross, fuzzySimilarity } = require('./listingCompanyNormalize');
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

/**
 * 打新「昨日上市」入库：仅企业全称与中/英披露全称在 canonical 后完全一致（与 ipo_progress 匹配同一套规范化），
 * 不再使用项目简称↔股票简称或模糊相似度阈值。
 */
function isNewShareMatch(projectRow, newShareRow) {
  const ex = String(newShareRow.exchange || '').trim();
  const proj = canonicalCompanyForMatchCross(projectRow.company, ex);
  if (!proj) {
    return {
      hit: false,
      score: 0,
      projectNameScore: 0,
      companyCnScore: 0,
      companyEnScore: 0,
    };
  }
  const cn = canonicalCompanyForMatchCross(newShareRow.enterprise_full_name_cn, ex);
  const en = canonicalCompanyForMatchCross(newShareRow.enterprise_full_name_en, ex);
  const companyCnScore = proj && cn && proj === cn ? 1 : (proj && cn ? fuzzySimilarity(proj, cn) : 0);
  const companyEnScore = proj && en && proj === en ? 1 : (proj && en ? fuzzySimilarity(proj, en) : 0);

  // #6: project_name matching (ipo_project.project_name ↔ ipo_new_share.stock_name)
  const projName = canonicalCompanyForMatchCross(projectRow.project_name, ex);
  const stockName = canonicalCompanyForMatchCross(newShareRow.stock_name, ex);
  let projectNameScore = 0;
  if (projName && stockName) {
    projectNameScore = projName === stockName ? 1 : fuzzySimilarity(projName, stockName);
  }

  const COMPANY_THRESHOLD = 0.85;
  const PROJECT_NAME_THRESHOLD = 0.80;
  const companyHit = companyCnScore >= COMPANY_THRESHOLD || companyEnScore >= COMPANY_THRESHOLD;
  const projectHit = projectNameScore >= PROJECT_NAME_THRESHOLD;
  const hit = companyHit || projectHit;

  // score: weighted combination (company match weighs more)
  const score = hit
    ? Math.max(companyCnScore, companyEnScore, projectNameScore * 0.9)
    : 0;

  return {
    hit,
    score: Math.round(score * 10000) / 10000,
    projectNameScore: Math.round(projectNameScore * 10000) / 10000,
    companyCnScore: Math.round(companyCnScore * 10000) / 10000,
    companyEnScore: Math.round(companyEnScore * 10000) / 10000,
  };
}

function normYmd(v) {
  const s = String(v || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** 同一底层项目 + 同一 ipo_progress 行 + 同一进展更新日：已存在则跳过（增量幂等，不删历史） */
async function existsIpoProgressMatch(projectFId, progressRowId, updateTime) {
  const ymd = normYmd(updateTime);
  if (!ymd) {
    const rows = await db.query(
      `SELECT F_Id FROM ipo_project_progress
       WHERE match_source = 'ipo_progress'
         AND ipo_project_f_id = ?
         AND ipo_progress_row_id = ?
       LIMIT 1`,
      [projectFId, progressRowId]
    );
    return rows.length > 0;
  }
  const rows = await db.query(
    `SELECT F_Id FROM ipo_project_progress
     WHERE match_source = 'ipo_progress'
       AND ipo_project_f_id = ?
       AND ipo_progress_row_id = ?
       AND DATE(F_UpdateTime) = ?
     LIMIT 1`,
    [projectFId, progressRowId, ymd]
  );
  return rows.length > 0;
}

async function runNewShareMatchBatch({
  restrictProjectUserId = null,
  listingDataAppId = null,
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
    `SELECT F_Id, stock_code, stock_name, enterprise_full_name_cn, enterprise_full_name_en, exchange,
            DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date
     FROM ipo_new_share
     WHERE public_date IS NOT NULL
       AND DATE(public_date) >= ?
       AND DATE(public_date) <= ?`,
    [startYmd, endYmd]
  );

  let projectSql = `SELECT *, F_Id AS id FROM ipo_project WHERE F_DeleteMark = 0`;
  const projectParams = [];
  if (restrictProjectUserId) {
    projectSql += ` AND F_CreatorUserId = ?`;
    projectParams.push(restrictProjectUserId);
  }
  if (listingDataAppId) {
    projectSql += ` AND data_app_id <=> ?`;
    projectParams.push(listingDataAppId);
  } else {
    projectSql += ` AND 1 = 0`;
  }
  projectSql += ` ORDER BY F_Id`;
  const projectRows = await db.query(projectSql, projectParams);
  console.log(
    `[listing-match][new-share] public_date=${startYmd}~${endYmd} new_share=${newShareRows.length} projects=${projectRows.length}` +
      (restrictProjectUserId ? ` user=${restrictProjectUserId}` : '') +
      (listingDataAppId ? ` listing_app_id=${listingDataAppId}` : '')
  );

  const now = new Date();
  let inserted = 0;
  let matchedPairs = 0;
  let skipped = 0;
  for (const ns of newShareRows) {
    const board = deriveBoardFromNewShare(ns);
    const listingYmd = normYmd(ns.public_date) || todayYmd;
    const updateAt = new Date(`${listingYmd}T00:00:00+08:00`);
    for (const p of projectRows) {
      const hitInfo = isNewShareMatch(p, ns);
      if (!hitInfo.hit) continue;
      matchedPairs += 1;
      // 与上市日对齐：避免「晚一天匹配」导致 f_update_time=写入日，进而在次日日报被误当作「昨日进展」
      const existing = await db.query(
        `SELECT F_Id
         FROM ipo_project_progress
         WHERE match_source = 'new_share'
           AND ipo_project_f_id = ?
           AND new_share_row_id = ?
         LIMIT 1`,
        [p.F_Id, ns.F_Id]
      );
      if (existing.length) {
        skipped += 1;
        continue;
      }
      await db.execute(
        `INSERT INTO ipo_project_progress (
          F_CreatorTime, F_CreatorUserId, ipo_project_f_id, ipo_progress_row_id,
          new_share_row_id, match_source, match_score,
          fund, sub, project_name, company,
          inv_amount, residual_amount, ratio, ct_amount, ct_residual,
          status, board, exchange, F_UpdateTime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          now,
          p.F_CreatorUserId,
          p.F_Id,
          null,
          ns.F_Id,
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

async function backfillYesterdayListedStatus({ restrictProjectUserId = null, listingDataAppId = null }) {
  const listingId = listingDataAppId != null ? String(listingDataAppId).trim() : '';
  if (!listingId) {
    return { statusBackfilled: 0, sourceBackfilled: 0 };
  }

  const params1 = [];
  const params2 = [];
  let whereUser = '';
  if (restrictProjectUserId) {
    whereUser = ' AND ipp.F_CreatorUserId = ?';
    params1.push(restrictProjectUserId);
    params2.push(restrictProjectUserId);
  }
  const joinListing = ` INNER JOIN ipo_project p ON p.F_Id = ipp.ipo_project_f_id AND p.F_DeleteMark = 0 AND p.data_app_id <=> ? `;
  params1.unshift(listingId);
  params2.unshift(listingId);

  const result = await db.execute(
    `UPDATE ipo_project_progress ipp${joinListing}
     SET ipp.status = '\u6628\u65e5\u4e0a\u5e02'
     WHERE ipp.status != '\u6628\u65e5\u4e0a\u5e02'
       AND (
         ipp.match_source = 'new_share'
         OR ipp.new_share_row_id IS NOT NULL
         OR (ipp.ipo_progress_row_id IS NULL)
       )
       ${whereUser}`,
    params1
  );

  const sourceFixResult = await db.execute(
    `UPDATE ipo_project_progress ipp${joinListing}
     SET ipp.match_source = 'new_share'
     WHERE ipp.match_source != 'new_share'
       AND (
         ipp.new_share_row_id IS NOT NULL
         OR (ipp.ipo_progress_row_id IS NULL AND ipp.status = '\u6628\u65e5\u4e0a\u5e02')
       )
       ${whereUser}`,
    params2
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
 * Match ipo_progress / ipo_new_share with ipo_project and write ipo_project_progress.
 * 仅 `ipo_project.data_app_id` = applications 中「上市进展」应用 id 的底层项目参与匹配，避免其它应用底层项目产生多余展示。
 * Also appends "new-share listed yesterday" rows when project `company` exactly matches
 * `enterprise_full_name_cn` or `enterprise_full_name_en` after canonical normalization (aligned with ipo_progress matching).
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
      '[listing-match] 已设置 LISTING_MATCH_SKIP_NEW_SHARE，跳过打新日历「昨日上市」全称精确匹配及相关状态回填（IPO 进展匹配仍执行）'
    );
  }

  const selectedIpoTypes = effectiveWithoutNewShare.filter((x) =>
    ['exchange_ipo', 'guidance_progress', 'overseas_filing'].includes(x)
  );
  const includeIpoProgress = selectedIpoTypes.length > 0;
  const includeNewShare = !skipNewShareByEnv && effectiveWithoutNewShare.includes('new_share');

  /** 仅「上市进展」应用下的 ipo_project 与公开表 ipo_progress / ipo_new_share 做匹配 */
  const listingAppId = await getApplicationIdByAppName('上市进展');
  if (!listingAppId && (includeIpoProgress || includeNewShare)) {
    console.warn(
      '[listing-match] 未找到 applications.app_name=上市进展：无法解析应用 id，本次不参与底层项目匹配（请检查 applications 表）'
    );
  }

  const backfillResult = skipNewShareByEnv
    ? { statusBackfilled: 0, sourceBackfilled: 0 }
    : await backfillYesterdayListedStatus({
        restrictProjectUserId,
        listingDataAppId: listingAppId,
      });

  if (listingAppId && (includeIpoProgress || includeNewShare)) {
    const delParams = [listingAppId];
    let delSql = `UPDATE ipo_project_progress ipp
      INNER JOIN ipo_project p ON p.F_Id = ipp.ipo_project_f_id AND p.F_DeleteMark = 0
      SET ipp.F_DeleteMark = 1, ipp.F_DeleteTime = NOW(), ipp.F_DeleteUserId = 'system_match_cleanup'
      WHERE ipp.F_DeleteMark = 0 AND p.data_app_id IS NOT NULL AND NOT (p.data_app_id <=> ?)`;
    if (restrictProjectUserId) {
      delSql += ` AND ipp.F_CreatorUserId = ?`;
      delParams.push(restrictProjectUserId);
    }
    await db.execute(delSql, delParams);
  }

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
        AND DATE(F_UpdateTime) >= ?
        AND DATE(F_UpdateTime) <= ?
        AND (${ipoWhere.join(' OR ')})
      ORDER BY F_Id`;
    progressRows = await db.query(sql, [startDate, endDate]);
  }

  let projectSql = `SELECT *, F_Id AS id FROM ipo_project WHERE F_DeleteMark = 0`;
  const projectParams = [];
  if (restrictProjectUserId) {
    projectSql += ` AND F_CreatorUserId = ?`;
    projectParams.push(restrictProjectUserId);
  }
  if (listingAppId) {
    projectSql += ` AND data_app_id <=> ?`;
    projectParams.push(listingAppId);
  } else {
    projectSql += ` AND 1 = 0`;
  }
  projectSql += ` ORDER BY F_Id`;
  const projectRows = await db.query(projectSql, projectParams);

  const now = new Date();
  let inserted = 0;
  let skippedFromIpoProgress = 0;

  /** @type {Map<string, { ip: object, p: object }[]>} */
  const matchBuckets = new Map();
  const FUZZY_MATCH_THRESHOLD = 0.85;
  for (const ip of progressRows) {
    const nip = canonicalCompanyForMatchCross(ip.company, ip.exchange);
    if (!nip) continue;
    for (const p of projectRows) {
      const np = canonicalCompanyForMatchCross(p.company, ip.exchange);
      let matched = false;
      let matchScore = null;
      if (np && nip === np) {
        matched = true;
      } else if (np) {
        // #4: fuzzy fallback when strict canonical match fails
        const sim = fuzzySimilarity(nip, np);
        if (sim >= FUZZY_MATCH_THRESHOLD) {
          matched = true;
          matchScore = Math.round(sim * 1000) / 1000;
        }
      }
      // #6: project_name as additional matching key
      if (!matched) {
        const ipProjName = canonicalCompanyForMatchCross(ip.project_name, ip.exchange);
        const pProjName = canonicalCompanyForMatchCross(p.project_name, ip.exchange);
        if (ipProjName && pProjName && ipProjName === pProjName) {
          matched = true;
          matchScore = matchScore || 1;
        } else if (ipProjName && pProjName) {
          const projSim = fuzzySimilarity(ipProjName, pProjName);
          if (projSim >= FUZZY_MATCH_THRESHOLD) {
            matched = true;
            matchScore = Math.round(projSim * 1000) / 1000;
          }
        }
      }
      if (!matched) continue;
      const dateStr = String(ip.F_UpdateTime || '').slice(0, 10);
      const bucketKey = [
        p.F_Id,
        dateStr,
        String(ip.status || '').trim(),
        String(ip.board || '').trim(),
        String(ip.exchange || '').trim(),
        nip,
      ].join('|');
      if (!matchBuckets.has(bucketKey)) matchBuckets.set(bucketKey, []);
      matchBuckets.get(bucketKey).push({ ip, p, matchScore });
    }
  }

  for (const [, pairs] of matchBuckets) {
    if (!pairs.length) continue;
    const p = pairs[0].p;
    const bucketMatchScore = pairs[0].matchScore || null;
    const ips = pairs.map((x) => x.ip);
    const ip = pickPreferredIpoProgressForProject(p, ips);
    if (!ip) continue;

    if (await existsIpoProgressMatch(p.F_Id, ip.F_Id, ip.F_UpdateTime)) {
      skippedFromIpoProgress += 1;
      continue;
    }

    await db.execute(
      `INSERT INTO ipo_project_progress (
        F_CreatorTime, F_CreatorUserId, ipo_project_f_id, ipo_progress_row_id,
        new_share_row_id, match_source, match_score,
        fund, sub, project_name, company,
        inv_amount, residual_amount, ratio, ct_amount, ct_residual,
        status, board, exchange, F_UpdateTime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        now,
        p.F_CreatorUserId,
        p.F_Id,
        ip.F_Id,
        null,
        'ipo_progress',
        bucketMatchScore,
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
        ip.F_UpdateTime,
      ]
    );
    inserted += 1;
  }

  const newShareResult = includeNewShare
    ? await runNewShareMatchBatch({
        restrictProjectUserId,
        listingDataAppId: listingAppId,
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
    skippedFromIpoProgress,
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
