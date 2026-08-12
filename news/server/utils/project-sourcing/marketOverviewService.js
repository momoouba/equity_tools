/**
 * 融资与市场概览：对 sourcing_financing_event 实时聚合。
 */
const db = require('../../db');
const {
  ROUND_BUCKET_VERSION,
  ROUND_BUCKETS,
  EARLY_STAGE_BUCKETS,
  mapRoundToBucket,
} = require('./financingRoundBuckets');
const { aggregateInvestors } = require('./financingInvestorAggregate');
const { FOCUS_TRACK_PRIMARIES } = require('./financingFocusTracks');

const MAX_YEAR_SPAN = 10;

function shanghaiTodayParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const year = parseInt(get('year'), 10);
  const month = parseInt(get('month'), 10);
  const day = parseInt(get('day'), 10);
  return { year, month, day, dateStr: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

function parseYearRange(yearFromRaw, yearToRaw) {
  const today = shanghaiTodayParts();
  let yearFrom = parseInt(yearFromRaw, 10);
  let yearTo = parseInt(yearToRaw, 10);
  if (!Number.isFinite(yearFrom) || !Number.isFinite(yearTo)) {
    const err = new Error('缺少或无效参数：year_from、year_to');
    err.status = 400;
    throw err;
  }
  if (yearFrom > yearTo) {
    const err = new Error('year_from 不能大于 year_to');
    err.status = 400;
    throw err;
  }
  if (yearTo - yearFrom + 1 > MAX_YEAR_SPAN) {
    const err = new Error(`年份跨度最多 ${MAX_YEAR_SPAN} 年`);
    err.status = 400;
    throw err;
  }
  const minYear = 1990;
  const maxYear = today.year + 1;
  if (yearFrom < minYear || yearTo > maxYear) {
    const err = new Error(`年份须在 ${minYear}–${maxYear} 之间`);
    err.status = 400;
    throw err;
  }
  return { yearFrom, yearTo, today };
}

function windowBounds(yearFrom, yearTo, today) {
  const dateFrom = `${yearFrom}-01-01`;
  const dateTo =
    yearTo === today.year
      ? today.dateStr
      : `${yearTo}-12-31`;
  return { dateFrom, dateTo };
}

function yoyBounds(today) {
  const ytdFrom = `${today.year}-01-01`;
  const ytdTo = today.dateStr;
  const baseFrom = `${today.year - 1}-01-01`;
  const baseTo = `${today.year - 1}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
  return { ytdFrom, ytdTo, baseFrom, baseTo };
}

function emptyBuckets() {
  const o = {};
  for (let i = 0; i < ROUND_BUCKETS.length; i++) {
    o[ROUND_BUCKETS[i]] = 0;
  }
  return o;
}

function calcYoyPct(current, base) {
  const c = Number(current || 0);
  const b = Number(base || 0);
  if (b <= 0) return null;
  return Number((((c - b) / b) * 100).toFixed(2));
}

async function countEvents(dateFrom, dateTo) {
  const rows = await db.query(
    `SELECT COUNT(*) AS c FROM sourcing_financing_event
     WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?`,
    [dateFrom, dateTo]
  );
  return Number(rows[0]?.c || 0);
}

/**
 * @param {{ yearFrom: number, yearTo: number }} opts
 */
async function buildMarketOverview(opts) {
  const { yearFrom, yearTo, today } = parseYearRange(opts.yearFrom, opts.yearTo);
  const { dateFrom, dateTo } = windowBounds(yearFrom, yearTo, today);
  const { ytdFrom, ytdTo, baseFrom, baseTo } = yoyBounds(today);
  const years = [];
  for (let y = yearFrom; y <= yearTo; y++) years.push(y);

  const [
    maxDateRows,
    windowCount,
    ytdCount,
    baseCount,
    yearlyRows,
    trackRows,
    untrackedRows,
    roundRows,
    investorRows,
    ytdTrackRows,
    ytdRoundRows,
    ytdInvestorRows,
    ytdUntrackedRows,
  ] = await Promise.all([
    db.query(
      `SELECT MAX(event_date) AS d FROM sourcing_financing_event WHERE F_DeleteMark = 0`
    ),
    countEvents(dateFrom, dateTo),
    countEvents(ytdFrom, ytdTo),
    countEvents(baseFrom, baseTo),
    db.query(
      `SELECT YEAR(event_date) AS y,
              COUNT(*) AS event_count,
              SUM(CASE WHEN amount_cny IS NOT NULL THEN 1 ELSE 0 END) AS amount_n,
              SUM(amount_cny) AS amount_cny_sum
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?
       GROUP BY YEAR(event_date)`,
      [dateFrom, dateTo]
    ),
    db.query(
      `SELECT track_primary AS name, COUNT(*) AS c
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?
         AND track_primary IN (?, ?, ?)
       GROUP BY track_primary
       ORDER BY c DESC, track_primary ASC`,
      [dateFrom, dateTo, ...FOCUS_TRACK_PRIMARIES]
    ),
    db.query(
      `SELECT COUNT(*) AS c FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?
         AND (track_primary IS NULL OR TRIM(track_primary) = '')`,
      [dateFrom, dateTo]
    ),
    db.query(
      `SELECT YEAR(event_date) AS y, round
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?`,
      [dateFrom, dateTo]
    ),
    db.query(
      `SELECT e.F_Id AS id, e.event_date, e.investor_names, e.amount_cny, w.inv_info_json
       FROM sourcing_financing_event e
       LEFT JOIN sourcing_financing_event_w_infer w ON w.F_Id = e.source_record_id
       WHERE e.F_DeleteMark = 0 AND e.event_date >= ? AND e.event_date <= ?`,
      [dateFrom, dateTo]
    ),
    db.query(
      `SELECT track_primary AS name, COUNT(*) AS c
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?
         AND track_primary IN (?, ?, ?)
       GROUP BY track_primary
       ORDER BY c DESC, track_primary ASC`,
      [ytdFrom, ytdTo, ...FOCUS_TRACK_PRIMARIES]
    ),
    db.query(
      `SELECT round FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?`,
      [ytdFrom, ytdTo]
    ),
    db.query(
      `SELECT e.F_Id AS id, e.event_date, e.investor_names, e.amount_cny, w.inv_info_json
       FROM sourcing_financing_event e
       LEFT JOIN sourcing_financing_event_w_infer w ON w.F_Id = e.source_record_id
       WHERE e.F_DeleteMark = 0 AND e.event_date >= ? AND e.event_date <= ?`,
      [ytdFrom, ytdTo]
    ),
    db.query(
      `SELECT COUNT(*) AS c FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?
         AND (track_primary IS NULL OR TRIM(track_primary) = '')`,
      [ytdFrom, ytdTo]
    ),
  ]);

  const dataMax =
    maxDateRows[0]?.d != null
      ? String(maxDateRows[0].d).slice(0, 10)
      : null;

  const yearlyMap = new Map();
  for (let i = 0; i < yearlyRows.length; i++) {
    const r = yearlyRows[i];
    const y = Number(r.y);
    const ec = Number(r.event_count || 0);
    const an = Number(r.amount_n || 0);
    yearlyMap.set(y, {
      year: y,
      event_count: ec,
      amount_cny_sum: r.amount_cny_sum != null ? Number(Number(r.amount_cny_sum).toFixed(2)) : null,
      amount_coverage: ec > 0 ? Number((an / ec).toFixed(4)) : 0,
      is_ytd: y === today.year,
    });
  }
  const yearly_trend = years.map((y) => {
    if (yearlyMap.has(y)) return yearlyMap.get(y);
    return {
      year: y,
      event_count: 0,
      amount_cny_sum: null,
      amount_coverage: 0,
      is_ytd: y === today.year,
    };
  });

  const trackCountMap = new Map();
  for (let i = 0; i < (trackRows || []).length; i++) {
    const r = trackRows[i];
    trackCountMap.set(String(r.name), Number(r.c || 0));
  }
  // 三大赛道全量回填（无事件则为 0），再按件数降序，供左侧默认选中第一项
  const tracksTop = FOCUS_TRACK_PRIMARIES.map((name) => ({
    name,
    count: trackCountMap.get(name) || 0,
  })).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  const untracked_count = Number(untrackedRows[0]?.c || 0);
  const untracked_ratio = windowCount > 0 ? Number((untracked_count / windowCount).toFixed(4)) : 0;

  const byYearBuckets = new Map();
  for (let i = 0; i < years.length; i++) {
    byYearBuckets.set(years[i], emptyBuckets());
  }
  const windowBucketCounts = emptyBuckets();
  for (let i = 0; i < roundRows.length; i++) {
    const r = roundRows[i];
    const y = Number(r.y);
    const bucket = mapRoundToBucket(r.round);
    windowBucketCounts[bucket] = (windowBucketCounts[bucket] || 0) + 1;
    if (byYearBuckets.has(y)) {
      const b = byYearBuckets.get(y);
      b[bucket] = (b[bucket] || 0) + 1;
    }
  }
  const rounds_by_year = years.map((y) => ({
    year: y,
    buckets: byYearBuckets.get(y) || emptyBuckets(),
  }));
  const window_share = ROUND_BUCKETS.map((bucket) => {
    const count = windowBucketCounts[bucket] || 0;
    return {
      bucket,
      count,
      pct: windowCount > 0 ? Number(((count / windowCount) * 100).toFixed(2)) : 0,
    };
  });

  const invAgg = aggregateInvestors(investorRows || [], {
    years,
    windowEventCount: windowCount,
    topN: 20,
    yearlyTopN: 10,
  });

  const ytdInv = aggregateInvestors(ytdInvestorRows || [], {
    years: [today.year],
    windowEventCount: ytdCount,
    topN: 3,
    yearlyTopN: 3,
  });

  const ytdBucketCounts = emptyBuckets();
  for (let i = 0; i < ytdRoundRows.length; i++) {
    const bucket = mapRoundToBucket(ytdRoundRows[i].round);
    ytdBucketCounts[bucket] = (ytdBucketCounts[bucket] || 0) + 1;
  }
  let topRoundBucket = { name: '', pct: 0 };
  let topRoundCount = -1;
  let earlyCount = 0;
  for (let i = 0; i < ROUND_BUCKETS.length; i++) {
    const b = ROUND_BUCKETS[i];
    const c = ytdBucketCounts[b] || 0;
    if (EARLY_STAGE_BUCKETS.includes(b)) earlyCount += c;
    if (c > topRoundCount) {
      topRoundCount = c;
      topRoundBucket = {
        name: b,
        pct: ytdCount > 0 ? Number(((c / ytdCount) * 100).toFixed(2)) : 0,
      };
    }
  }

  const ytdUntracked = Number(ytdUntrackedRows[0]?.c || 0);
  const ytdUntrackedPct = ytdCount > 0 ? Number(((ytdUntracked / ytdCount) * 100).toFixed(2)) : 0;

  const yoyPct = calcYoyPct(ytdCount, baseCount);
  const topTrackHit = tracksTop.find((t) => t.count > 0);
  const topTrack = topTrackHit
    ? { name: topTrackHit.name, count: topTrackHit.count }
    : { name: '', count: 0 };

  return {
    meta: {
      year_from: yearFrom,
      year_to: yearTo,
      as_of_date: today.dateStr,
      data_max_event_date: dataMax,
      round_bucket_version: ROUND_BUCKET_VERSION,
      window_date_from: dateFrom,
      window_date_to: dateTo,
      focus_tracks: FOCUS_TRACK_PRIMARIES.slice(),
    },
    kpi: {
      window_event_count: windowCount,
      ytd_event_count: ytdCount,
      ytd_yoy_pct: yoyPct,
      ytd_base_count: baseCount,
      top_track: topTrack,
      top_investor: invAgg.top1,
      untracked_ratio,
    },
    ytd_summary_facts: {
      event_count: ytdCount,
      yoy_pct: yoyPct,
      base_count: baseCount,
      top_tracks: (() => {
        const m = new Map();
        for (let i = 0; i < (ytdTrackRows || []).length; i++) {
          m.set(String(ytdTrackRows[i].name), Number(ytdTrackRows[i].c || 0));
        }
        return FOCUS_TRACK_PRIMARIES.map((name) => ({
          name,
          count: m.get(name) || 0,
        }))
          .filter((t) => t.count > 0)
          .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.name.localeCompare(b.name, 'zh-CN');
          })
          .slice(0, 3);
      })(),
      top_investors: (ytdInv.top20 || []).slice(0, 3).map((x) => ({
        name: x.name,
        count: x.deal_count,
      })),
      top_round_bucket: topRoundBucket.name
        ? topRoundBucket
        : { name: '', pct: 0 },
      early_stage_pct:
        ytdCount > 0 ? Number(((earlyCount / ytdCount) * 100).toFixed(2)) : 0,
      untracked_pct: ytdUntrackedPct,
      as_of_month: today.month,
      as_of_day: today.day,
      year_outside_window: today.year < yearFrom || today.year > yearTo,
    },
    yearly_trend,
    tracks: {
      top: tracksTop,
      untracked_count,
      focus_tracks: FOCUS_TRACK_PRIMARIES.slice(),
      scope_note: '目前仅针对人工智能、半导体、生物医药赛道进行分析',
    },
    investors: {
      top20: invAgg.top20,
      top10_yearly: invAgg.top10_yearly,
    },
    rounds: {
      by_year: rounds_by_year,
      window_share,
    },
  };
}

/**
 * 某主赛道下子赛道 Top + 逐年
 */
async function buildTrackSecondary(opts) {
  const { yearFrom, yearTo, today } = parseYearRange(opts.yearFrom, opts.yearTo);
  const trackPrimary = String(opts.trackPrimary || '').trim();
  if (!trackPrimary) {
    const err = new Error('缺少 track_primary');
    err.status = 400;
    throw err;
  }
  if (!FOCUS_TRACK_PRIMARIES.includes(trackPrimary)) {
    const err = new Error('当前仅支持人工智能、半导体、生物医药赛道');
    err.status = 400;
    throw err;
  }
  const { dateFrom, dateTo } = windowBounds(yearFrom, yearTo, today);
  const years = [];
  for (let y = yearFrom; y <= yearTo; y++) years.push(y);

  const [secRows, yearlyRows] = await Promise.all([
    db.query(
      `SELECT track_secondary AS name, COUNT(*) AS c
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?
         AND track_primary = ?
         AND track_secondary IS NOT NULL AND TRIM(track_secondary) <> ''
       GROUP BY track_secondary
       ORDER BY c DESC, track_secondary ASC
       LIMIT 5`,
      [dateFrom, dateTo, trackPrimary]
    ),
    db.query(
      `SELECT YEAR(event_date) AS y, COUNT(*) AS c
       FROM sourcing_financing_event
       WHERE F_DeleteMark = 0 AND event_date >= ? AND event_date <= ?
         AND track_primary = ?
       GROUP BY YEAR(event_date)`,
      [dateFrom, dateTo, trackPrimary]
    ),
  ]);

  const yMap = new Map();
  for (let i = 0; i < yearlyRows.length; i++) {
    yMap.set(Number(yearlyRows[i].y), Number(yearlyRows[i].c || 0));
  }

  return {
    track_primary: trackPrimary,
    secondary_top: (secRows || []).map((r) => ({
      name: r.name,
      count: Number(r.c || 0),
    })),
    by_year: years.map((y) => ({
      year: y,
      event_count: yMap.get(y) || 0,
      is_ytd: y === today.year,
    })),
  };
}

module.exports = {
  MAX_YEAR_SPAN,
  shanghaiTodayParts,
  buildMarketOverview,
  buildTrackSecondary,
  windowBounds,
  yoyBounds,
};
