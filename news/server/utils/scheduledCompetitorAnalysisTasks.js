/**
 * 投后竞品分析定时任务：按项目状态动态取企业 − 排除名单，
 * 用各企业最近确认对标焦点串行跑分析，完成后发邮件（ZIP 附件）。
 */
const cron = require('node-cron');
const db = require('../db');
const { generateId } = require('./idGenerator');
const { convertQuartzCronToNodeCron } = require('./cronQuartzToNode');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('./enterpriseDataApp');
const { getApplicationIdByAppName, isInvestedEnterpriseCompetitorAnalysisApp } = require('./applicationIdResolve');
const { loadSavedCompetitionLens } = require('./competitor-analysis/competitionLensService');
const { executeCompetitorAnalysisRun } = require('./competitor-analysis/competitorAnalysisRunner');
const { buildCompetitorExportFileList } = require('./competitor-analysis/competitorMatchExport');
const { createZipBuffer } = require('./zipBuffer');
const { sendMailWithConfig } = require('./sendMailWithConfig');

const DEFAULT_EMAIL_BODY = '本次竞品分析的结果详见附件。';
const EXIT_STATUS_OPTIONS = ['未退出', '部分退出', '完全退出', '继续观察', '不再观察', '已上市'];

/** @type {Map<string, import('node-cron').ScheduledTask>} */
const scheduledJobs = new Map();
/** 正在执行的 taskId，防重入 */
const runningTaskIds = new Set();

function parseExcludedIds(raw) {
  if (raw == null || raw === '') return [];
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => String(x).trim()).filter(Boolean);
}

function parseEmailList(raw) {
  return String(raw || '')
    .split(/[,;，；\n\r]+/)
    .map((e) => e.trim())
    .filter((e) => e && e.includes('@'));
}

function validateEmails(raw) {
  const list = parseEmailList(raw);
  if (!list.length) return { ok: false, message: '请填写至少一个有效收件人邮箱' };
  const bad = list.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad.length) return { ok: false, message: `邮箱格式不正确：${bad.join('、')}` };
  return { ok: true, emails: list };
}

function humanizeFailureReason(codeOrMsg) {
  const s = String(codeOrMsg || '').trim();
  if (!s) return '竞品分析未能完成，请稍后在系统中查看或重试';
  if (s === 'no_lens' || /对标焦点|competition.?lens/i.test(s)) {
    return '尚未确认对标焦点，请先在被投企业中手动完成一次竞品分析';
  }
  if (/信息不足|needSupplement|就绪|readiness/i.test(s)) {
    return '企业业务信息不完整，请先补充产品介绍或企业标签后再分析';
  }
  if (/不存在|未找到/.test(s)) return '企业记录不存在或已删除';
  if (/超时|timeout/i.test(s)) return '分析超时，请稍后重试';
  if (/ECONN|ENOTFOUND|网络|SMTP|邮件配置/i.test(s)) {
    return '邮件或网络服务异常，请检查系统邮件配置后重试';
  }
  // 去掉堆栈与路径，只保留可读短句
  const firstLine = s.split(/[\n\r]/)[0].replace(/at\s+\S+.*/g, '').trim();
  if (firstLine.length > 120) return `${firstLine.slice(0, 120)}…`;
  if (/Error:|TypeError|ReferenceError|\/|\\/.test(firstLine) && firstLine.length > 40) {
    return '竞品分析执行失败，请稍后重试或联系管理员';
  }
  return firstLine || '竞品分析未能完成，请稍后重试';
}

async function listScheduleTasks() {
  const rows = await db.query(
    `SELECT F_Id AS id, recipient_emails, email_subject, email_body, cron_expression,
            project_status, excluded_enterprise_ids, is_active,
            last_run_at, last_run_status, last_run_summary,
            F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at, F_LastModifyTime AS updated_at
     FROM sourcing_competitor_schedule_task
     WHERE F_DeleteMark = 0
     ORDER BY F_CreatorTime DESC`
  );
  return rows.map((r) => ({
    ...r,
    is_active: Number(r.is_active) === 1,
    excluded_enterprise_ids: parseExcludedIds(r.excluded_enterprise_ids),
    excluded_count: parseExcludedIds(r.excluded_enterprise_ids).length,
  }));
}

async function getScheduleTask(id) {
  const rows = await db.query(
    `SELECT F_Id AS id, recipient_emails, email_subject, email_body, cron_expression,
            project_status, excluded_enterprise_ids, is_active,
            last_run_at, last_run_status, last_run_summary,
            F_CreatorUserId AS creator_user_id, F_CreatorTime AS created_at, F_LastModifyTime AS updated_at
     FROM sourcing_competitor_schedule_task
     WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [id]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    ...r,
    is_active: Number(r.is_active) === 1,
    excluded_enterprise_ids: parseExcludedIds(r.excluded_enterprise_ids),
  };
}

async function createScheduleTask(body, userId) {
  const emailCheck = validateEmails(body.recipient_emails);
  if (!emailCheck.ok) throw Object.assign(new Error(emailCheck.message), { statusCode: 400 });
  const subject = String(body.email_subject || '').trim();
  if (!subject) throw Object.assign(new Error('请填写邮件主题'), { statusCode: 400 });
  const cronExpr = String(body.cron_expression || '').trim();
  if (!cronExpr) throw Object.assign(new Error('请配置定时规则'), { statusCode: 400 });
  const nodeCron = convertQuartzCronToNodeCron(cronExpr);
  if (!nodeCron || !cron.validate(nodeCron)) {
    throw Object.assign(new Error('Cron 表达式无效'), { statusCode: 400 });
  }
  const projectStatus = String(body.project_status || '').trim();
  if (!EXIT_STATUS_OPTIONS.includes(projectStatus)) {
    throw Object.assign(new Error('请选择有效的项目状态'), { statusCode: 400 });
  }
  const excluded = Array.isArray(body.excluded_enterprise_ids)
    ? body.excluded_enterprise_ids.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const emailBody = String(body.email_body != null ? body.email_body : DEFAULT_EMAIL_BODY);
  const isActive = body.is_active === false || body.is_active === 0 ? 0 : 1;
  const id = await generateId('sourcing_competitor_schedule_task');
  await db.execute(
    `INSERT INTO sourcing_competitor_schedule_task (
       F_Id, recipient_emails, email_subject, email_body, cron_expression, project_status,
       excluded_enterprise_ids, is_active, F_CreatorUserId, F_LastModifyUserId, F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
    [
      id,
      emailCheck.emails.join(','),
      subject,
      emailBody,
      cronExpr,
      projectStatus,
      JSON.stringify(excluded),
      isActive,
      userId || null,
      userId || null,
    ]
  );
  await refreshTaskSchedule(id);
  return getScheduleTask(id);
}

async function updateScheduleTask(id, body, userId) {
  const existing = await getScheduleTask(id);
  if (!existing) throw Object.assign(new Error('任务不存在'), { statusCode: 404 });

  const emailRaw = body.recipient_emails != null ? body.recipient_emails : existing.recipient_emails;
  const emailCheck = validateEmails(emailRaw);
  if (!emailCheck.ok) throw Object.assign(new Error(emailCheck.message), { statusCode: 400 });

  const subject = String(body.email_subject != null ? body.email_subject : existing.email_subject).trim();
  if (!subject) throw Object.assign(new Error('请填写邮件主题'), { statusCode: 400 });

  const cronExpr = String(
    body.cron_expression != null ? body.cron_expression : existing.cron_expression
  ).trim();
  const nodeCron = convertQuartzCronToNodeCron(cronExpr);
  if (!nodeCron || !cron.validate(nodeCron)) {
    throw Object.assign(new Error('Cron 表达式无效'), { statusCode: 400 });
  }

  let projectStatus = String(
    body.project_status != null ? body.project_status : existing.project_status
  ).trim();
  if (!EXIT_STATUS_OPTIONS.includes(projectStatus)) {
    throw Object.assign(new Error('请选择有效的项目状态'), { statusCode: 400 });
  }

  let excluded;
  if (body.project_status != null && String(body.project_status).trim() !== existing.project_status) {
    // 改状态清空排除
    excluded = Array.isArray(body.excluded_enterprise_ids)
      ? body.excluded_enterprise_ids.map((x) => String(x).trim()).filter(Boolean)
      : [];
  } else if (body.excluded_enterprise_ids !== undefined) {
    excluded = Array.isArray(body.excluded_enterprise_ids)
      ? body.excluded_enterprise_ids.map((x) => String(x).trim()).filter(Boolean)
      : [];
  } else {
    excluded = existing.excluded_enterprise_ids;
  }

  const emailBody =
    body.email_body != null ? String(body.email_body) : existing.email_body || DEFAULT_EMAIL_BODY;
  const isActive =
    body.is_active !== undefined
      ? body.is_active === false || body.is_active === 0
        ? 0
        : 1
      : existing.is_active
        ? 1
        : 0;

  await db.execute(
    `UPDATE sourcing_competitor_schedule_task SET
       recipient_emails = ?, email_subject = ?, email_body = ?, cron_expression = ?,
       project_status = ?, excluded_enterprise_ids = ?, is_active = ?,
       F_LastModifyUserId = ?, F_LastModifyTime = NOW()
     WHERE F_Id = ? AND F_DeleteMark = 0`,
    [
      emailCheck.emails.join(','),
      subject,
      emailBody,
      cronExpr,
      projectStatus,
      JSON.stringify(excluded),
      isActive,
      userId || null,
      id,
    ]
  );
  await refreshTaskSchedule(id);
  return getScheduleTask(id);
}

async function deleteScheduleTask(id) {
  stopTaskSchedule(id);
  const result = await db.execute(
    `UPDATE sourcing_competitor_schedule_task SET F_DeleteMark = 1, F_LastModifyTime = NOW()
     WHERE F_Id = ? AND F_DeleteMark = 0`,
    [id]
  );
  return result.affectedRows > 0;
}

/**
 * 竞品分析-被投企业：指定退出状态下的企业列表（用于项目勾选弹窗）
 */
async function listEnterprisesByProjectStatus(projectStatus, search = '') {
  const status = String(projectStatus || '').trim();
  const rows = await db.query(
    `SELECT F_Id AS id, project_abbreviation, enterprise_full_name, exit_status,
            project_number, data_app_id, data_app_name
     FROM invested_enterprises
     WHERE F_DeleteMark = 0 AND exit_status = ?
     ORDER BY project_abbreviation ASC, enterprise_full_name ASC`,
    [status]
  );
  const out = [];
  const q = String(search || '').trim().toLowerCase();
  for (const row of rows) {
    if (!(await isInvestedEnterpriseCompetitorAnalysisApp(row))) continue;
    if (q) {
      const ab = String(row.project_abbreviation || '').toLowerCase();
      const full = String(row.enterprise_full_name || '').toLowerCase();
      if (!ab.includes(q) && !full.includes(q)) continue;
    }
    out.push({
      id: row.id,
      project_abbreviation: row.project_abbreviation || '',
      enterprise_full_name: row.enterprise_full_name || '',
      exit_status: row.exit_status || '',
      project_number: row.project_number || '',
    });
  }
  return out;
}

async function resolveEligibleEnterprises(task) {
  const excluded = new Set(parseExcludedIds(task.excluded_enterprise_ids));
  const all = await listEnterprisesByProjectStatus(task.project_status);
  return all.filter((e) => !excluded.has(String(e.id)));
}

async function getLastIncludedEnterpriseIds(taskId) {
  const rows = await db.query(
    `SELECT included_enterprise_ids FROM sourcing_competitor_schedule_run
     WHERE task_id = ? AND F_DeleteMark = 0
       AND status IN ('success', 'partial', 'failed')
       AND included_enterprise_ids IS NOT NULL
     ORDER BY F_CreatorTime DESC LIMIT 1`,
    [taskId]
  );
  if (!rows.length) return [];
  return parseExcludedIds(rows[0].included_enterprise_ids);
}

async function getCompetitorAnalysisEmailConfig() {
  const appId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  if (!appId) throw new Error('未找到「竞品分析」应用，请先在系统中配置');
  const rows = await db.query(
    `SELECT * FROM email_config WHERE app_id = ? AND F_DeleteMark = 0 AND is_active = 1 LIMIT 1`,
    [appId]
  );
  if (!rows.length) {
    throw new Error('未配置「竞品分析」应用的发件邮箱，请在系统配置 → 邮件配置中添加');
  }
  return rows[0];
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildEmailBodies({ userBody, summaryLine, failures, statusMismatches, emptyNotice }) {
  const parts = [];
  if (emptyNotice) {
    parts.push(emptyNotice);
  } else {
    parts.push(userBody || DEFAULT_EMAIL_BODY);
  }
  if (summaryLine) parts.push(summaryLine);
  if (failures && failures.length) {
    parts.push('失败项目清单：');
    failures.forEach((f, i) => {
      parts.push(`${i + 1}. ${f.label}：${f.reason}`);
    });
  }
  if (statusMismatches && statusMismatches.length) {
    parts.push('本次因状态不符未纳入：');
    statusMismatches.forEach((f, i) => {
      parts.push(
        `${i + 1}. ${f.label}（${f.from_status || '-'} → ${f.to_status || '-'}）`
      );
    });
  }
  const text = parts.join('\n\n');
  const html = parts
    .map((p) => {
      if (p.includes('\n')) {
        return `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`;
      }
      return `<p>${escapeHtml(p)}</p>`;
    })
    .join('');
  return { text, html };
}

async function runAnalysisForEnterprise(enterprise, userId) {
  const id = String(enterprise.id);
  const label =
    enterprise.project_abbreviation || enterprise.enterprise_full_name || id;

  const savedLens = await loadSavedCompetitionLens('invested_enterprise', id);
  const hasConfirmed =
    savedLens &&
    (savedLens.confirmed ||
      (Array.isArray(savedLens.selected_factor_ids) && savedLens.selected_factor_ids.length > 0) ||
      (Array.isArray(savedLens.must_align) && savedLens.must_align.length > 0));
  if (!hasConfirmed) {
    return {
      ok: false,
      enterpriseId: id,
      label,
      reason: humanizeFailureReason('no_lens'),
    };
  }

  const runId = await generateId('sourcing_competitor_run');
  await db.execute(
    `INSERT INTO sourcing_competitor_run (
       F_Id, invested_enterprise_id, status, message, triggered_by_user_id, started_at,
       F_CreatorTime, F_LastModifyTime, F_DeleteMark
     ) VALUES (?,?,?,?,?,NOW(),NOW(),NOW(),0)`,
    [runId, id, 'queued', '定时任务触发的竞品分析', userId || null]
  );

  const competitionLens = {
    ...savedLens,
    confirmed: true,
    source: savedLens.source || 'user',
  };

  try {
    const result = await executeCompetitorAnalysisRun({
      subjectType: 'invested_enterprise',
      runId,
      investedEnterpriseId: id,
      userId: userId || null,
      enableAutoExpand: true,
      competitionLens,
    });
    if (result && result.ok === false) {
      return {
        ok: false,
        enterpriseId: id,
        label,
        reason: humanizeFailureReason(result.message || '分析失败'),
        runId,
      };
    }
    return { ok: true, enterpriseId: id, label, runId };
  } catch (e) {
    return {
      ok: false,
      enterpriseId: id,
      label,
      reason: humanizeFailureReason(e.message || e),
      runId,
    };
  }
}

/**
 * 执行一条定时任务（cron 或手动）
 */
async function runScheduleTask(taskId, { triggerType = 'cron', userId = null } = {}) {
  const tid = String(taskId);
  if (runningTaskIds.has(tid)) {
    console.log(`[竞品定时] 任务 ${tid} 仍在执行，跳过本次`);
    return { skipped: true, message: '上一轮尚未完成，已跳过' };
  }

  const task = await getScheduleTask(tid);
  if (!task) return { skipped: true, message: '任务不存在' };
  if (triggerType === 'cron' && !task.is_active) {
    return { skipped: true, message: '任务未启用' };
  }

  runningTaskIds.add(tid);
  const runLogId = await generateId('sourcing_competitor_schedule_run');
  await db.execute(
    `INSERT INTO sourcing_competitor_schedule_run (
       F_Id, task_id, status, trigger_type, started_at, F_CreatorUserId, F_CreatorTime, F_DeleteMark
     ) VALUES (?,?,?,?,NOW(),?,NOW(),0)`,
    [runLogId, tid, 'running', triggerType, userId || null]
  );

  const failures = [];
  const successes = [];
  let statusMismatches = [];
  let includedIds = [];

  try {
    const eligible = await resolveEligibleEnterprises(task);
    includedIds = eligible.map((e) => String(e.id));

    const prevIds = await getLastIncludedEnterpriseIds(tid);
    if (prevIds.length) {
      const eligibleSet = new Set(includedIds);
      const excludedSet = new Set(parseExcludedIds(task.excluded_enterprise_ids));
      for (const prevId of prevIds) {
        if (eligibleSet.has(prevId) || excludedSet.has(prevId)) continue;
        const rows = await db.query(
          `SELECT F_Id AS id, project_abbreviation, enterprise_full_name, exit_status
           FROM invested_enterprises WHERE F_Id = ? LIMIT 1`,
          [prevId]
        );
        if (!rows.length) continue;
        const row = rows[0];
        const curStatus = String(row.exit_status || '').trim();
        if (curStatus === task.project_status) continue;
        statusMismatches.push({
          enterpriseId: prevId,
          label: row.project_abbreviation || row.enterprise_full_name || prevId,
          from_status: task.project_status,
          to_status: curStatus || '-',
        });
      }
    }

    if (!eligible.length) {
      const { text, html } = buildEmailBodies({
        userBody: task.email_body,
        emptyNotice: '本次无待分析企业',
        statusMismatches,
      });
      try {
        const emailConfig = await getCompetitorAnalysisEmailConfig();
        await sendMailWithConfig({
          emailConfig,
          toEmail: parseEmailList(task.recipient_emails).join(','),
          subject: task.email_subject,
          html,
          text,
          userId,
        });
      } catch (mailErr) {
        console.error('[竞品定时] 无企业通知邮件失败:', mailErr.message);
      }

      const summary = '本次无待分析企业';
      await finishRunLog(runLogId, tid, {
        status: 'success',
        message: summary,
        includedIds,
        successCount: 0,
        failCount: 0,
        result: { failures: [], successes: [], statusMismatches, empty: true },
      });
      return { ok: true, empty: true, message: summary };
    }

    for (const ent of eligible) {
      const r = await runAnalysisForEnterprise(ent, userId);
      if (r.ok) successes.push(r);
      else failures.push(r);
    }

    const summaryLine = `成功 ${successes.length} / 失败 ${failures.length}`;
    let attachments = [];
    let mailSubject = task.email_subject;

    if (successes.length) {
      try {
        const { files } = await buildCompetitorExportFileList({
          subjectType: 'invested_enterprise',
          investedEnterpriseIds: successes.map((s) => s.enterpriseId),
          exportAll: false,
          exportBatchMode: 'latest',
          years: [],
          psUser: null,
          isAdmin: true,
        });
        if (files.length === 1) {
          attachments = [
            {
              filename: files[0].name,
              content: files[0].data,
              contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          ];
        } else if (files.length > 1) {
          attachments = [
            {
              filename: `竞品分析导出_${files.length}项.zip`,
              content: createZipBuffer(files.map((f) => ({ name: f.name, data: f.data }))),
              contentType: 'application/zip',
            },
          ];
        }
      } catch (expErr) {
        console.error('[竞品定时] 导出附件失败:', expErr.message);
        failures.push({
          enterpriseId: '',
          label: '附件导出',
          reason: humanizeFailureReason('导出结果附件失败'),
        });
      }
    }

    const { text, html } = buildEmailBodies({
      userBody: task.email_body,
      summaryLine,
      failures,
      statusMismatches,
    });

    try {
      const emailConfig = await getCompetitorAnalysisEmailConfig();
      await sendMailWithConfig({
        emailConfig,
        toEmail: parseEmailList(task.recipient_emails).join(','),
        subject: mailSubject,
        html,
        text,
        attachments: attachments.length ? attachments : undefined,
        userId,
      });
    } catch (mailErr) {
      console.error('[竞品定时] 发送结果邮件失败:', mailErr.message);
      await finishRunLog(runLogId, tid, {
        status: successes.length ? 'partial' : 'failed',
        message: `${summaryLine}；邮件发送失败：${humanizeFailureReason(mailErr.message)}`,
        includedIds,
        successCount: successes.length,
        failCount: failures.length,
        result: { failures, successes, statusMismatches, mailError: mailErr.message },
      });
      return {
        ok: false,
        message: `分析完成但邮件发送失败：${humanizeFailureReason(mailErr.message)}`,
        successes: successes.length,
        failures: failures.length,
      };
    }

    const status =
      failures.length === 0 ? 'success' : successes.length === 0 ? 'failed' : 'partial';
    await finishRunLog(runLogId, tid, {
      status,
      message: summaryLine,
      includedIds,
      successCount: successes.length,
      failCount: failures.length,
      result: { failures, successes, statusMismatches },
    });
    return {
      ok: true,
      status,
      message: summaryLine,
      successes: successes.length,
      failures: failures.length,
    };
  } catch (e) {
    console.error('[竞品定时] 执行异常:', e);
    await finishRunLog(runLogId, tid, {
      status: 'failed',
      message: humanizeFailureReason(e.message),
      includedIds,
      successCount: successes.length,
      failCount: failures.length + 1,
      result: { failures, successes, statusMismatches, error: e.message },
    });
    return { ok: false, message: humanizeFailureReason(e.message) };
  } finally {
    runningTaskIds.delete(tid);
  }
}

async function finishRunLog(runLogId, taskId, {
  status,
  message,
  includedIds,
  successCount,
  failCount,
  result,
}) {
  await db.execute(
    `UPDATE sourcing_competitor_schedule_run SET
       status = ?, finished_at = NOW(), included_enterprise_ids = ?,
       success_count = ?, fail_count = ?, skip_count = 0,
       result_json = ?, message = ?
     WHERE F_Id = ?`,
    [
      status,
      JSON.stringify(includedIds || []),
      successCount || 0,
      failCount || 0,
      JSON.stringify(result || {}),
      String(message || '').slice(0, 1000),
      runLogId,
    ]
  );
  await db.execute(
    `UPDATE sourcing_competitor_schedule_task SET
       last_run_at = NOW(), last_run_status = ?, last_run_summary = ?, F_LastModifyTime = NOW()
     WHERE F_Id = ?`,
    [status, String(message || '').slice(0, 500), taskId]
  );
}

async function listScheduleRuns(taskId, { limit = 20 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const rows = await db.query(
    `SELECT F_Id AS id, task_id, status, trigger_type, started_at, finished_at,
            success_count, fail_count, skip_count, message, result_json, F_CreatorTime AS created_at
     FROM sourcing_competitor_schedule_run
     WHERE task_id = ? AND F_DeleteMark = 0
     ORDER BY F_CreatorTime DESC
     LIMIT ${lim}`,
    [taskId]
  );
  return rows.map((r) => ({
    ...r,
    result_json:
      typeof r.result_json === 'string'
        ? (() => {
            try {
              return JSON.parse(r.result_json);
            } catch {
              return null;
            }
          })()
        : r.result_json,
  }));
}

function stopTaskSchedule(taskId) {
  const job = scheduledJobs.get(String(taskId));
  if (job) {
    try {
      job.stop();
    } catch {
      /* ignore */
    }
    scheduledJobs.delete(String(taskId));
  }
}

async function refreshTaskSchedule(taskId) {
  stopTaskSchedule(taskId);
  const task = await getScheduleTask(taskId);
  if (!task || !task.is_active) return;
  const nodeCron = convertQuartzCronToNodeCron(task.cron_expression);
  if (!nodeCron || !cron.validate(nodeCron)) {
    console.warn(`[竞品定时] 任务 ${taskId} cron 无效，跳过调度:`, task.cron_expression);
    return;
  }
  const job = cron.schedule(nodeCron, () => {
    runScheduleTask(taskId, { triggerType: 'cron' }).catch((e) => {
      console.error(`[竞品定时] 任务 ${taskId} 执行失败:`, e.message);
    });
  });
  scheduledJobs.set(String(taskId), job);
  console.log(`[竞品定时] 已调度任务 ${taskId} → ${nodeCron}`);
}

async function initializeCompetitorScheduleTasks() {
  const tasks = await listScheduleTasks();
  let n = 0;
  for (const t of tasks) {
    if (!t.is_active) continue;
    await refreshTaskSchedule(t.id);
    n += 1;
  }
  console.log(`✓ 竞品分析定时任务已初始化（启用 ${n} 条）`);
}

module.exports = {
  EXIT_STATUS_OPTIONS,
  DEFAULT_EMAIL_BODY,
  listScheduleTasks,
  getScheduleTask,
  createScheduleTask,
  updateScheduleTask,
  deleteScheduleTask,
  listEnterprisesByProjectStatus,
  listScheduleRuns,
  runScheduleTask,
  initializeCompetitorScheduleTasks,
  refreshTaskSchedule,
  validateEmails,
};
