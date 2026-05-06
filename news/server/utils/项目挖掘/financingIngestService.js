const axios = require('axios');
const crypto = require('crypto');
const db = require('../../db');
const C = require('./constants');
const newsRoutes = require('../../routes/news');
const { parseFundingAmountFields } = require('./financingAmountParse');
const { mapIndustryToStd } = require('./financingIndustryMap');

const RULE_ENRICH_VERSION = 'rule_enrich_v1';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function timestampCn() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function financingExecutionDetails(startDate, endDate, progressLines, extra = {}) {
  return {
    financing_sync: true,
    interface_type: C.INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING,
    date_range: { start: startDate, end: endDate },
    progress_lines: [...progressLines],
    ...extra,
  };
}

function normalizeFundingDatetime(dt) {
  if (!dt) return null;
  const s = String(dt).trim().replace('T', ' ');
  return s.length >= 19 ? s.slice(0, 19) : s;
}

function fundingDateOnlyFromDeal(deal) {
  const s = normalizeFundingDatetime(deal.funding_dt);
  if (!s) return null;
  return s.slice(0, 10);
}

function normalizeSourceDatetime(dt) {
  if (!dt) return null;
  const s = String(dt).trim().replace('T', ' ');
  return s.length >= 19 ? s.slice(0, 19) : s;
}

function enumerateDatesInclusive(startYmd, endYmd) {
  const out = [];
  let d = new Date(`${startYmd}T12:00:00+08:00`);
  const end = new Date(`${endYmd}T12:00:00+08:00`);
  while (d <= end) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function computeRecordHash(deal) {
  const payload = {
    funding_id: String(deal.funding_id ?? ''),
    instn_idtfn_cd: String(deal.instn_idtfn_cd ?? ''),
    funding_dt: normalizeFundingDatetime(deal.funding_dt),
    round: String(deal.round ?? ''),
    proj_id_xn: deal.proj_id_xn != null ? Number(deal.proj_id_xn) : null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function postDealDetailInfer(apiUrl, xAppId, apiKey, bodyObj) {
  const uuid = crypto.randomUUID();
  const timestamp = String(Date.now());
  const bodyString = JSON.stringify(bodyObj);
  const response = await axios.post(apiUrl, bodyString, {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-App-Id': String(xAppId).trim(),
      'X-Sequence-No': uuid,
      'X-Timestamp': timestamp,
      APIkey: String(apiKey).trim(),
    },
    timeout: 120000,
    transformRequest: [(data) => data],
  });
  return response.data;
}

async function fetchSigForApp(appId) {
  const rows = await db.query(
    `SELECT x_app_id, api_key FROM shanghai_international_group_config WHERE app_id = ? AND is_active = 1 LIMIT 1`,
    [appId]
  );
  return rows[0] || null;
}

function normalizeInvInfoArray(invInfo) {
  if (!invInfo) return [];
  if (Array.isArray(invInfo)) return invInfo;
  if (typeof invInfo === 'string') {
    try {
      const p = JSON.parse(invInfo);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 标准表 investor_names：仅投资人名称，顿号拼接（完整 JSON 仍在 w_infer.inv_info_json） */
function investorNamesFromInvInfo(invInfo) {
  const arr = normalizeInvInfoArray(invInfo);
  if (!arr.length) return null;
  const names = arr
    .map((x) => (x && x.inv_nm != null ? String(x.inv_nm).trim() : ''))
    .filter(Boolean);
  if (!names.length) return null;
  return names.join('、');
}

function leadInvestorFromInv(invInfo) {
  const arr = normalizeInvInfoArray(invInfo);
  if (!arr.length) return null;
  const first = arr[0];
  return first && first.inv_nm ? String(first.inv_nm) : null;
}

/**
 * 单条 deal_info_w_infer 写入明细表并 upsert 标准表
 * @param {string} [fundingDtYmd] queryByDate 当日 yyyy-MM-dd，用于补齐缺失的 event_date
 */
async function ingestOneDeal(deal, requestId, queryType, fundingDtYmd) {
  const recordHash = computeRecordHash(deal);
  const invArr = normalizeInvInfoArray(deal.inv_info);
  const invJson = JSON.stringify(invArr);
  const investorNamesStr = investorNamesFromInvInfo(invArr);
  const fundingDt = normalizeFundingDatetime(deal.funding_dt);
  const eventDate = fundingDateOnlyFromDeal(deal) || fundingDtYmd || null;
  const fundingId = String(deal.funding_id ?? '');
  const credit = String(deal.instn_idtfn_cd ?? '').trim();

  if (!eventDate) {
    console.warn('[投融资入库] 跳过无融资日期的记录 funding_id=', fundingId);
    return false;
  }

  await db.execute(
    `INSERT INTO sourcing_financing_event_w_infer (
      request_id, query_type, proj_cd_xn, proj_id_xn, instn_id_xn, instn_idtfn_cd, instn_nm,
      reg_rgn, reg_prov, reg_city, reg_cnty, proj_nm, proj_desc, cp_round, xn_ic_lv1, xn_ic_lv2,
      funding_id, funding_dt, round, funding_amt, estmt_funding_amt, post_valuation, funding_sts,
      inv_info_json, create_time, update_time, ingested_at, record_hash
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?)
    ON DUPLICATE KEY UPDATE
      request_id = VALUES(request_id),
      query_type = VALUES(query_type),
      proj_cd_xn = VALUES(proj_cd_xn),
      proj_id_xn = VALUES(proj_id_xn),
      instn_id_xn = VALUES(instn_id_xn),
      instn_nm = VALUES(instn_nm),
      reg_rgn = VALUES(reg_rgn),
      reg_prov = VALUES(reg_prov),
      reg_city = VALUES(reg_city),
      reg_cnty = VALUES(reg_cnty),
      proj_nm = VALUES(proj_nm),
      proj_desc = VALUES(proj_desc),
      cp_round = VALUES(cp_round),
      xn_ic_lv1 = VALUES(xn_ic_lv1),
      xn_ic_lv2 = VALUES(xn_ic_lv2),
      funding_dt = VALUES(funding_dt),
      round = VALUES(round),
      funding_amt = VALUES(funding_amt),
      estmt_funding_amt = VALUES(estmt_funding_amt),
      post_valuation = VALUES(post_valuation),
      funding_sts = VALUES(funding_sts),
      inv_info_json = VALUES(inv_info_json),
      create_time = VALUES(create_time),
      update_time = VALUES(update_time),
      ingested_at = NOW()`,
    [
      requestId || null,
      queryType,
      deal.proj_cd_xn ?? null,
      deal.proj_id_xn != null ? Number(deal.proj_id_xn) : null,
      deal.instn_id_xn != null ? Number(deal.instn_id_xn) : null,
      credit || null,
      deal.instn_nm ?? null,
      deal.reg_rgn ?? null,
      deal.reg_prov ?? null,
      deal.reg_city ?? null,
      deal.reg_cnty ?? null,
      deal.proj_nm ?? null,
      deal.proj_desc ?? null,
      deal.cp_round ?? null,
      deal.xn_ic_lv1 ?? null,
      deal.xn_ic_lv2 ?? null,
      fundingId,
      fundingDt,
      deal.round ?? null,
      deal.funding_amt ?? null,
      deal.estmt_funding_amt ?? null,
      deal.post_valuation ?? null,
      deal.funding_sts ?? null,
      invJson,
      normalizeSourceDatetime(deal.create_time),
      normalizeSourceDatetime(deal.update_time),
      recordHash,
    ]
  );

  const idRows = await db.query(`SELECT id FROM sourcing_financing_event_w_infer WHERE record_hash = ? LIMIT 1`, [
    recordHash,
  ]);
  const wInferId = idRows[0].id;
  const leadInv = leadInvestorFromInv(invArr);

  const fundingRaw = deal.funding_amt ?? null;
  const estimatedRaw = deal.estmt_funding_amt ?? null;
  const amt = parseFundingAmountFields(fundingRaw, estimatedRaw);
  const ind = mapIndustryToStd(deal.xn_ic_lv1, deal.xn_ic_lv2);

  await db.execute(
    `INSERT INTO sourcing_financing_event (
      source_record_id, event_id, event_date, company_name, company_credit_code,
      project_name, project_desc, latest_round, round,
      funding_amt_raw, estimated_amt_raw, post_valuation_raw,
      amount, amount_currency, amount_cny, amount_parse_status, amount_parse_confidence,
      industry_source_lv1, industry_source_lv2,
      industry_std_lv1, industry_std_lv2, industry_match_confidence,
      investor_names, lead_investor,
      region_country, region_province, region_city, region_county,
      funding_status, source_create_time, source_update_time,
      classification_status, classification_source, classification_version, classification_retry_count,
      is_deleted
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
    ON DUPLICATE KEY UPDATE
      source_record_id = VALUES(source_record_id),
      company_name = VALUES(company_name),
      project_name = VALUES(project_name),
      project_desc = VALUES(project_desc),
      latest_round = VALUES(latest_round),
      round = VALUES(round),
      funding_amt_raw = VALUES(funding_amt_raw),
      estimated_amt_raw = VALUES(estimated_amt_raw),
      post_valuation_raw = VALUES(post_valuation_raw),
      amount = VALUES(amount),
      amount_currency = VALUES(amount_currency),
      amount_cny = VALUES(amount_cny),
      amount_parse_status = VALUES(amount_parse_status),
      amount_parse_confidence = VALUES(amount_parse_confidence),
      industry_source_lv1 = VALUES(industry_source_lv1),
      industry_source_lv2 = VALUES(industry_source_lv2),
      industry_std_lv1 = VALUES(industry_std_lv1),
      industry_std_lv2 = VALUES(industry_std_lv2),
      industry_match_confidence = VALUES(industry_match_confidence),
      investor_names = VALUES(investor_names),
      lead_investor = VALUES(lead_investor),
      region_country = VALUES(region_country),
      region_province = VALUES(region_province),
      region_city = VALUES(region_city),
      region_county = VALUES(region_county),
      funding_status = VALUES(funding_status),
      source_create_time = VALUES(source_create_time),
      source_update_time = VALUES(source_update_time),
      classification_status = VALUES(classification_status),
      classification_source = VALUES(classification_source),
      classification_version = VALUES(classification_version),
      classification_retry_count = VALUES(classification_retry_count),
      updated_at = CURRENT_TIMESTAMP`,
    [
      wInferId,
      fundingId,
      eventDate,
      deal.instn_nm ?? null,
      credit || '',
      deal.proj_nm ?? null,
      deal.proj_desc ?? null,
      deal.cp_round ?? null,
      deal.round ?? null,
      fundingRaw,
      estimatedRaw,
      deal.post_valuation ?? null,
      amt.amount,
      amt.amount_currency,
      amt.amount_cny,
      amt.amount_parse_status,
      amt.amount_parse_confidence,
      deal.xn_ic_lv1 ?? null,
      deal.xn_ic_lv2 ?? null,
      ind.industry_std_lv1,
      ind.industry_std_lv2,
      ind.industry_match_confidence,
      investorNamesStr,
      leadInv,
      deal.reg_rgn ?? null,
      deal.reg_prov ?? null,
      deal.reg_city ?? null,
      deal.reg_cnty ?? null,
      deal.funding_sts ?? null,
      normalizeSourceDatetime(deal.create_time),
      normalizeSourceDatetime(deal.update_time),
      'verified',
      'rule',
      RULE_ENRICH_VERSION,
      0,
    ]
  );

  try {
    const evRows = await db.query(
      `SELECT id FROM sourcing_financing_event WHERE event_id = ? AND company_credit_code = ? AND event_date = ? LIMIT 1`,
      [fundingId, credit || '', eventDate]
    );
    if (evRows.length) {
      const { applyTrackMatchForEvents } = require('./financingTrackMatch');
      await applyTrackMatchForEvents({ eventIds: [evRows[0].id], mode: 'all' });
    }
  } catch (trackErr) {
    console.warn('[financingIngest] applyTrackMatchForEvents:', trackErr.message);
  }

  return true;
}

/**
 * 按日调用 queryByDate，写入明细 + 标准表
 * @param {string} configId news_interface_config.id
 * @param {{ startDate: string, endDate: string }} range yyyy-MM-dd
 * @param {{ executionType?: 'manual'|'scheduled', userId?: string|null }} [syncOptions]
 */
async function syncFinancingDateRange(configId, range, syncOptions = {}) {
  const { startDate, endDate } = range;
  const executionType = syncOptions.executionType === 'scheduled' ? 'scheduled' : 'manual';
  const userId = syncOptions.userId || null;

  if (!startDate || !endDate || startDate > endDate) {
    throw new Error('无效的日期区间');
  }

  const progressLines = [];
  const pushProgress = (msg) => {
    const line = `[${timestampCn()}] ${msg}`;
    progressLines.push(line);
    console.log('[投融资入库]', line);
  };

  let logId = null;

  const configs = await db.query(
    `SELECT * FROM news_interface_config WHERE id = ? AND interface_type = ? AND is_active = 1 AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [configId, C.INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING]
  );
  if (configs.length === 0) {
    throw new Error('投融资接口配置不存在或未启用');
  }
  const config = configs[0];
  const sig = await fetchSigForApp(config.app_id);
  if (!sig || !sig.x_app_id || !sig.api_key) {
    throw new Error('请先在「上海国际集团接口配置」中为该应用配置凭证');
  }

  const apiUrl = String(config.request_url || '').trim();
  if (!apiUrl) {
    throw new Error('投融资接口 request_url 未配置');
  }

  const dates = enumerateDatesInclusive(startDate, endDate);
  pushProgress(`开始抓取：融资日共 ${dates.length} 天（${startDate} ~ ${endDate}），query_type=queryByDate`);

  try {
    logId = await newsRoutes.createSyncLog({
      configId,
      executionType,
      userId,
      executionDetails: financingExecutionDetails(startDate, endDate, progressLines, {
        request_url_host: (() => {
          try {
            return new URL(apiUrl).host;
          } catch {
            return '(解析失败)';
          }
        })(),
      }),
    });
  } catch (e) {
    console.warn('[投融资入库] 创建 news_sync_execution_log 失败，将继续同步但不写入库内日志:', e.message);
  }

  let dealCount = 0;
  const errors = [];
  let daysOk = 0;

  try {
    for (const fundingDt of dates) {
      let lastErr;
      let dayOk = false;
      let dayIngested = 0;
      let rawDealLen = 0;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          if (attempt > 0) {
            pushProgress(`融资日 ${fundingDt}：第 ${attempt + 1} 次重试…`);
          }
          const data = await postDealDetailInfer(apiUrl, sig.x_app_id, sig.api_key, {
            query_type: 'queryByDate',
            funding_dt: fundingDt,
          });
          if (String(data.Code) !== '200') {
            throw new Error(data.Desc || `接口返回 Code=${data.Code}`);
          }
          const requestId = data.RequestId || '';
          const deals = (data.Data && data.Data.deal_info_w_infer) || [];
          rawDealLen = deals.length;
          dayIngested = 0;
          for (const deal of deals) {
            if (!deal || deal.funding_id == null) continue;
            const ingested = await ingestOneDeal(deal, requestId, 'queryByDate', fundingDt);
            if (ingested) {
              dayIngested += 1;
              dealCount += 1;
            }
          }
          pushProgress(
            `融资日 ${fundingDt}：接口 Code=200，RequestId=${requestId || '-'}，原始 ${rawDealLen} 条，入库 ${dayIngested} 条`
          );
          dayOk = true;
          daysOk += 1;
          break;
        } catch (e) {
          lastErr = e;
          const waitMs = Math.min(30000, 1000 * 2 ** attempt);
          pushProgress(`融资日 ${fundingDt}：请求异常 ${e.message || e}，${waitMs}ms 后重试`);
          await sleep(waitMs);
        }
      }
      if (!dayOk && lastErr) {
        const em = lastErr.message || String(lastErr);
        errors.push({ date: fundingDt, message: em });
        pushProgress(`融资日 ${fundingDt}：最终失败 ${em}`);
      }

      if (logId) {
        try {
          await newsRoutes.patchRunningSyncLog(logId, {
            syncedCount: dealCount,
            executionDetails: financingExecutionDetails(startDate, endDate, progressLines, {
              request_url_host: (() => {
                try {
                  return new URL(apiUrl).host;
                } catch {
                  return '(解析失败)';
                }
              })(),
              last_funding_dt: fundingDt,
            }),
          });
        } catch (e) {
          console.warn('[投融资入库] patchRunningSyncLog 失败:', e.message);
        }
      }
    }

    await db.execute(
      `UPDATE news_interface_config SET last_sync_time = NOW(), last_sync_date = ? WHERE id = ?`,
      [endDate, configId]
    );

    const allDaysFailed = dates.length > 0 && errors.length === dates.length;
    const finalDetails = financingExecutionDetails(startDate, endDate, progressLines, {
      request_url_host: (() => {
        try {
          return new URL(apiUrl).host;
        } catch {
          return '(解析失败)';
        }
      })(),
      summary: {
        total_days: dates.length,
        days_succeeded: daysOk,
        days_failed: errors.length,
        deals_ingested: dealCount,
      },
      errors: errors.length ? errors : undefined,
    });

    if (logId) {
      await newsRoutes.updateSyncLog(logId, {
        status: allDaysFailed ? 'failed' : 'success',
        syncedCount: dealCount,
        totalEnterprises: dates.length,
        processedEnterprises: daysOk,
        errorCount: errors.length,
        errorMessage: allDaysFailed ? errors.map((x) => `${x.date}: ${x.message}`).join('; ') : null,
        executionDetails: finalDetails,
      });
    }

    return {
      success: !allDaysFailed,
      message: `同步完成：处理 ${dates.length} 个融资日，成功 ${daysOk} 天，入库事件 ${dealCount} 条`,
      data: { days: dates.length, dealCount, errors, daysOk },
    };
  } catch (e) {
    if (logId) {
      try {
        pushProgress(`同步中断：${e.message || e}`);
        await newsRoutes.updateSyncLog(logId, {
          status: 'failed',
          syncedCount: dealCount,
          totalEnterprises: dates.length,
          processedEnterprises: daysOk,
          errorCount: errors.length + 1,
          errorMessage: e.message || String(e),
          executionDetails: financingExecutionDetails(startDate, endDate, progressLines, {
            errors: errors.length ? errors : undefined,
          }),
        });
      } catch (logErr) {
        console.warn('[投融资入库] 写入失败日志时出错:', logErr.message);
      }
    }
    throw e;
  }
}

module.exports = {
  syncFinancingDateRange,
  computeRecordHash,
  enumerateDatesInclusive,
};
