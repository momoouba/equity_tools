const db = require('../../db');
const { sendMailWithConfig } = require('../sendMailWithConfig');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('./listingBeijingDate');

async function isWorkdayForListingEmail(date) {
  const dateStr = formatDateOnly(date);
  try {
    const rows = await db.query(
      'SELECT is_workday FROM holiday_calendar WHERE holiday_date = ? AND is_deleted = 0 LIMIT 1',
      [dateStr]
    );
    if (rows.length > 0) {
      return rows[0].is_workday === 1;
    }
  } catch (e) {
    console.warn('[上市进展邮件] 节假日查询失败:', e.message);
  }
  return true;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateYmdForEmail(val) {
  if (!val) return '';
  const s = String(val).trim();
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const mm = String(Number(m[2])).padStart(2, '0');
    const dd = String(Number(m[3])).padStart(2, '0');
    return `${m[1]}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatAmountForEmail(val) {
  if (val === null || val === undefined || val === '') return '-';
  const n = Number(val);
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercentForEmail(val) {
  if (val === null || val === undefined || val === '') return '-';
  const n = Number(val);
  if (!Number.isFinite(n)) return '-';
  return `${(n * 100).toFixed(2)}%`;
}

/**
 * 收件管理定时任务：上市进展应用日报（无详情链接，两段结构）
 */
async function executeListingEmailDigest(recipient, options = {}) {
  const skipHolidayCheck = options.skipHolidayCheck !== false;
  if (skipHolidayCheck && recipient.skip_holiday === 1) {
    const ok = await isWorkdayForListingEmail(new Date());
    if (!ok) {
      console.log(`[上市进展邮件] 跳过节假日，收件配置 ${recipient.id}`);
      return;
    }
  }

  const ec = await db.query(
    `SELECT ec.id FROM email_config ec
     INNER JOIN applications a ON ec.app_id = a.id
     WHERE BINARY a.app_name = BINARY ? LIMIT 1`,
    ['上市进展']
  );
  if (!ec.length) {
    throw new Error('未找到上市进展应用的邮件配置');
  }
  const emailConfigId = ec[0].id;

  const y = addDaysCalendar(createShanghaiDate(), -1);
  const reportDay = formatDateOnly(y);

  const ipp = await db.query(
    `SELECT fund, sub, project_name, company, status, exchange, board, f_update_time,
            inv_amount, residual_amount, ratio, ct_amount, ct_residual
     FROM ipo_project_progress
     WHERE F_CreatorUserId = ?
       AND DATE(f_update_time) = ?`,
    [recipient.user_id, reportDay]
  );

  const ipo = await db.query(
    `SELECT company, status, exchange, board, f_update_time, project_name
     FROM ipo_progress
     WHERE F_DeleteMark = 0
       AND DATE(f_update_time) = ?
     ORDER BY f_update_time DESC
     LIMIT 200`,
    [reportDay]
  );

  const tableBaseStyle =
    'width:100%;border-collapse:collapse;font-size:13px;table-layout:auto;border:1px solid #e5e6eb;background:#fff;';
  const thStyle =
    'background:#f2f3f5;color:#1d2129;text-align:left;padding:10px 8px;border:1px solid #e5e6eb;font-weight:600;';
  const tdStyle = 'padding:9px 8px;border:1px solid #e5e6eb;color:#1d2129;';

  const part1 =
    ipp.length === 0
      ? '<p style="margin:0 0 12px;color:#4e5969;">（前一日无匹配的底层项目上市进展记录）</p>'
      : `<table cellpadding="0" cellspacing="0" style="${tableBaseStyle}">
          <tr>
            <th style="${thStyle}">基金</th><th style="${thStyle}">子基金</th><th style="${thStyle}">项目简称</th><th style="${thStyle}">企业全称</th><th style="${thStyle}">审核状态</th><th style="${thStyle}">交易所</th><th style="${thStyle}">板块</th><th style="${thStyle}">投资成本</th><th style="${thStyle}">剩余成本</th><th style="${thStyle}">穿透权益占比</th><th style="${thStyle}">穿透投资成本</th><th style="${thStyle}">穿透剩余成本</th>
          </tr>
          ${ipp
            .map(
              (r, i) =>
                `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};"><td style="${tdStyle}">${escapeHtml(r.fund)}</td><td style="${tdStyle}">${escapeHtml(r.sub)}</td><td style="${tdStyle}">${escapeHtml(r.project_name)}</td><td style="${tdStyle}">${escapeHtml(r.company)}</td><td style="${tdStyle}">${escapeHtml(r.status)}</td><td style="${tdStyle}">${escapeHtml(r.exchange)}</td><td style="${tdStyle}">${escapeHtml(r.board)}</td><td style="${tdStyle}">${escapeHtml(formatAmountForEmail(r.inv_amount))}</td><td style="${tdStyle}">${escapeHtml(formatAmountForEmail(r.residual_amount))}</td><td style="${tdStyle}">${escapeHtml(formatPercentForEmail(r.ratio))}</td><td style="${tdStyle}">${escapeHtml(formatAmountForEmail(r.ct_amount))}</td><td style="${tdStyle}">${escapeHtml(formatAmountForEmail(r.ct_residual))}</td></tr>`
            )
            .join('')}
        </table>`;

  const part2 =
    ipo.length === 0
      ? '<p style="margin:0 0 12px;color:#4e5969;">（前一日无上市进展更新记录）</p>'
      : `<table cellpadding="0" cellspacing="0" style="${tableBaseStyle}">
          <tr>
            <th style="${thStyle}">公司全称</th><th style="${thStyle}">项目简称</th><th style="${thStyle}">审核状态</th><th style="${thStyle}">交易所</th><th style="${thStyle}">板块</th>
          </tr>
          ${ipo
            .map(
              (r, i) =>
                `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};"><td style="${tdStyle}">${escapeHtml(r.company)}</td><td style="${tdStyle}">${escapeHtml(r.project_name)}</td><td style="${tdStyle}">${escapeHtml(r.status)}</td><td style="${tdStyle}">${escapeHtml(r.exchange)}</td><td style="${tdStyle}">${escapeHtml(r.board)}</td></tr>`
            )
            .join('')}
        </table>`;

  const html = `
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.6;color:#1d2129;background:#fff;">
      <h2 style="margin:0 0 12px 0;padding-bottom:10px;border-bottom:2px solid #4CAF50;">IPO 进展日报 - ${reportDay}</h2>
      <h3 style="margin:14px 0 10px;padding-left:10px;border-left:4px solid #1677ff;color:#1677ff;">一、底层项目上市进展</h3>
      ${part1}
      <h3 style="margin:16px 0 10px;padding-left:10px;border-left:4px solid #00b42a;color:#00b42a;">二、上市进展</h3>
      ${part2}
    </div>
  `;

  const subject = (recipient.email_subject && String(recipient.email_subject).trim()) || `上市进展日报 ${reportDay}`;

  await sendMailWithConfig({
    emailConfigId,
    toEmail: recipient.recipient_email,
    subject,
    html,
    userId: recipient.user_id,
  });
}

module.exports = { executeListingEmailDigest };
