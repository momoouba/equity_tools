const db = require('../../db');
const { sendMailWithConfig } = require('../sendMailWithConfig');
const { createShanghaiDate, formatDateOnly, addDaysCalendar } = require('./listingBeijingDate');
const {
  getListingMembershipLevelName,
  normalizeListingMailTypesByLevel,
  isAdminAccount,
  LISTING_LEVEL,
} = require('./listingAuth');

async function isWorkdayForListingEmail(date) {
  const dateStr = formatDateOnly(date);
  try {
    const rows = await db.query(
      'SELECT is_workday FROM holiday_calendar WHERE holiday_date = ? AND delete_mark = 0 LIMIT 1',
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

function formatPercentNumberForEmail(val) {
  if (val === null || val === undefined || val === '') return '-';
  const n = Number(val);
  if (!Number.isFinite(n)) return '-';
  return `${n.toFixed(2)}%`;
}

const LISTING_CONTENT_TYPES = {
  LISTING_PROJECT_PROGRESS: 'listing_project_progress',
  LISTING_PROGRESS: 'listing_progress',
  LISTING_GUIDANCE: 'listing_guidance',
  OVERSEAS_FILING: 'overseas_filing',
  NEW_SHARE: 'new_share',
};

function parseListingMailTypes(raw) {
  if (!raw) return [LISTING_CONTENT_TYPES.LISTING_PROJECT_PROGRESS, LISTING_CONTENT_TYPES.LISTING_PROGRESS];
  let arr = raw;
  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = [arr];
    }
  }
  if (!Array.isArray(arr)) arr = [arr];
  const set = new Set(
    arr
      .map((v) => String(v || '').trim())
      .filter((v) =>
        [
          LISTING_CONTENT_TYPES.LISTING_PROJECT_PROGRESS,
          LISTING_CONTENT_TYPES.LISTING_PROGRESS,
          LISTING_CONTENT_TYPES.LISTING_GUIDANCE,
          LISTING_CONTENT_TYPES.OVERSEAS_FILING,
          LISTING_CONTENT_TYPES.NEW_SHARE,
        ].includes(v)
      )
  );
  if (!set.size) {
    set.add(LISTING_CONTENT_TYPES.LISTING_PROJECT_PROGRESS);
    set.add(LISTING_CONTENT_TYPES.LISTING_PROGRESS);
  }
  return Array.from(set);
}

function weekdayZh(dateObj) {
  const names = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return names[dateObj.getDay()] || '';
}

function weekRangeMonFri(today) {
  const dow = today.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const mon = addDaysCalendar(today, mondayOffset);
  const fri = addDaysCalendar(mon, 4);
  return { mon: formatDateOnly(mon), fri: formatDateOnly(fri) };
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
  const today = createShanghaiDate();
  const todayYmd = formatDateOnly(today);
  const forceAdminByOperator =
    options.currentUser &&
    (isAdminAccount(options.currentUser.account) ||
      String(options.currentUser.role || '').trim().toLowerCase() === 'admin');
  const isRecipientAdmin =
    isAdminAccount(recipient.user_account) ||
    String(recipient.user_role || '').trim().toLowerCase() === 'admin';
  const listingLevelName =
    forceAdminByOperator || isRecipientAdmin
      ? LISTING_LEVEL.VIP
      : await getListingMembershipLevelName(recipient.user_id);
  const selectedTypes = normalizeListingMailTypesByLevel(
    parseListingMailTypes(recipient.listing_mail_types),
    listingLevelName
  );
  const includeListingProjectProgress = selectedTypes.includes(LISTING_CONTENT_TYPES.LISTING_PROJECT_PROGRESS);
  const includeListingProgress = selectedTypes.includes(LISTING_CONTENT_TYPES.LISTING_PROGRESS);
  const includeListingGuidance = selectedTypes.includes(LISTING_CONTENT_TYPES.LISTING_GUIDANCE);
  const includeOverseasFiling = selectedTypes.includes(LISTING_CONTENT_TYPES.OVERSEAS_FILING);
  const includeNewShare = selectedTypes.includes(LISTING_CONTENT_TYPES.NEW_SHARE);

  let ipp = [];
  let ipoExchangeYesterday = [];
  let ipoGuidanceYesterday = [];
  let ipoOverseasMonday = [];
  if (includeListingProjectProgress) {
    ipp = await db.query(
      `SELECT fund, sub, project_name, company, status, exchange, board, f_update_time,
              inv_amount, residual_amount, ratio, ct_amount, ct_residual
       FROM ipo_project_progress
       WHERE F_CreatorUserId = ?
         AND DATE(f_update_time) = ?`,
      [recipient.user_id, reportDay]
    );
  }
  if (includeListingProgress) {
    ipoExchangeYesterday = await db.query(
      `SELECT company, status, exchange, board, f_update_time, project_name
       FROM ipo_progress
       WHERE F_DeleteMark = 0
         AND DATE(f_update_time) = ?
         AND exchange IN ('北交所','深交所','上交所','香港联交所','港交所')
       ORDER BY f_update_time DESC
       LIMIT 300`,
      [reportDay]
    );
  }
  if (includeListingGuidance) {
    ipoGuidanceYesterday = await db.query(
      `SELECT company, status, register_address, f_update_time
       FROM ipo_progress
       WHERE F_DeleteMark = 0
         AND DATE(f_update_time) = ?
         AND exchange = '证监会辅导备案'
       ORDER BY f_update_time DESC
       LIMIT 200`,
      [reportDay]
    );
  }
  if (includeOverseasFiling) {
    const isMonday = today.getDay() === 1;
    if (isMonday) {
      ipoOverseasMonday = await db.query(
        `SELECT company, status, exchange, DATE_FORMAT(receive_date, '%Y-%m-%d') AS receive_date
         FROM ipo_progress
         WHERE F_DeleteMark = 0
           AND DATE(f_create_date) = ?
           AND (exchange = '境外发行备案' OR board = '境外发行备案')
         ORDER BY receive_date DESC, f_update_time DESC
         LIMIT 200`,
        [todayYmd]
      );
    }
  }

  let nsApplyRows = [];
  let nsUpcomingListRows = [];
  let nsFirstDayRows = [];
  if (includeNewShare) {
    const dow = today.getDay();
    let applyFrom = null;
    let applyTo = null;
    if (dow === 1) {
      const { mon, fri } = weekRangeMonFri(today);
      applyFrom = mon;
      applyTo = fri;
    } else if (dow >= 2 && dow <= 4) {
      applyFrom = todayYmd;
      applyTo = todayYmd;
    }
    if (applyFrom && applyTo) {
      nsApplyRows = await db.query(
        `SELECT stock_code, stock_name, DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date, issue_weekday, exchange,
                issue_price, limit_shares
         FROM ipo_new_share
         WHERE issue_date IS NOT NULL
           AND DATE(issue_date) BETWEEN ? AND ?
         ORDER BY issue_date ASC, stock_code ASC
         LIMIT 300`,
        [applyFrom, applyTo]
      );
    }
    nsUpcomingListRows = await db.query(
      `SELECT stock_code, stock_name, DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
              DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date, exchange, issue_price
       FROM ipo_new_share
       WHERE public_date IS NOT NULL
         AND DATE(public_date) >= ?
         AND DATE(public_date) < DATE_ADD(?, INTERVAL 5 DAY)
       ORDER BY public_date ASC, stock_code ASC
       LIMIT 500`,
      [todayYmd, todayYmd]
    );
    nsFirstDayRows = await db.query(
      `SELECT stock_code, stock_name, DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date,
              exchange, issue_price, first_day_close, first_day_chg_pct
       FROM ipo_new_share
       WHERE public_date IS NOT NULL
         AND DATE(public_date) = DATE_SUB(?, INTERVAL 1 DAY)
       ORDER BY stock_code ASC
       LIMIT 300`,
      [todayYmd]
    );
  }

  const tableBaseStyle =
    'width:100%;border-collapse:collapse;font-size:13px;table-layout:auto;border:1px solid #e5e6eb;background:#fff;';
  const thStyle =
    'background:#f2f3f5;color:#1d2129;text-align:left;padding:10px 8px;border:1px solid #e5e6eb;font-weight:600;';
  const tdStyle = 'padding:9px 8px;border:1px solid #e5e6eb;color:#1d2129;';
  const tdNumStyle = 'padding:9px 8px;border:1px solid #e5e6eb;color:#1d2129;text-align:right;';

  const part1Project =
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

  const part2Exchange =
    ipoExchangeYesterday.length === 0
      ? '<p style="margin:0 0 12px;color:#4e5969;">（前一日无交易所上市进展更新记录）</p>'
      : `<table cellpadding="0" cellspacing="0" style="${tableBaseStyle}">
          <tr>
            <th style="${thStyle}">公司全称</th><th style="${thStyle}">项目简称</th><th style="${thStyle}">审核状态</th><th style="${thStyle}">交易所</th><th style="${thStyle}">板块</th>
          </tr>
          ${ipoExchangeYesterday
            .map(
              (r, i) =>
                `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};"><td style="${tdStyle}">${escapeHtml(r.company)}</td><td style="${tdStyle}">${escapeHtml(r.project_name)}</td><td style="${tdStyle}">${escapeHtml(r.status)}</td><td style="${tdStyle}">${escapeHtml(r.exchange)}</td><td style="${tdStyle}">${escapeHtml(r.board)}</td></tr>`
            )
            .join('')}
        </table>`;

  const part2Guidance =
    ipoGuidanceYesterday.length === 0
      ? '<p style="margin:0 0 12px;color:#4e5969;">（前一日无证监会辅导备案更新记录）</p>'
      : `<table cellpadding="0" cellspacing="0" style="${tableBaseStyle}">
          <tr>
            <th style="${thStyle}">公司全称</th><th style="${thStyle}">审核状态</th>
          </tr>
          ${ipoGuidanceYesterday
            .map(
              (r, i) =>
                `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};"><td style="${tdStyle}">${escapeHtml(r.company)}</td><td style="${tdStyle}">${escapeHtml(r.status)}</td></tr>`
            )
            .join('')}
        </table>`;

  const part2OverseasMonday =
    ipoOverseasMonday.length === 0
      ? '<p style="margin:0 0 12px;color:#4e5969;">（本周一无新增境外发行备案记录）</p>'
      : `<table cellpadding="0" cellspacing="0" style="${tableBaseStyle}">
          <tr>
            <th style="${thStyle}">公司全称</th><th style="${thStyle}">接收日期</th><th style="${thStyle}">审核状态</th><th style="${thStyle}">申请交易所</th>
          </tr>
          ${ipoOverseasMonday
            .map(
              (r, i) =>
                `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};"><td style="${tdStyle}">${escapeHtml(r.company)}</td><td style="${tdStyle}">${escapeHtml(formatDateYmdForEmail(r.receive_date))}</td><td style="${tdStyle}">${escapeHtml(r.status)}</td><td style="${tdStyle}">${escapeHtml(r.exchange)}</td></tr>`
            )
            .join('')}
        </table>`;

  const newSharePart1 =
    nsApplyRows.length === 0
      ? '<p style="margin:0 0 12px;color:#4e5969;">（当前规则下无可发送的申购日历数据）</p>'
      : `<table cellpadding="0" cellspacing="0" style="${tableBaseStyle}">
          <tr>
            <th style="${thStyle}">股票代码</th><th style="${thStyle}">股票简称</th><th style="${thStyle}">申购日期</th><th style="${thStyle}">星期</th><th style="${thStyle}">交易所</th><th style="${thStyle}">发行价</th><th style="${thStyle}">申购上限</th>
          </tr>
          ${nsApplyRows
            .map(
              (r, i) =>
                `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};"><td style="${tdStyle}">${escapeHtml(r.stock_code)}</td><td style="${tdStyle}">${escapeHtml(r.stock_name)}</td><td style="${tdStyle}">${escapeHtml(formatDateYmdForEmail(r.issue_date))}</td><td style="${tdStyle}">${escapeHtml(r.issue_weekday || weekdayZh(new Date(`${formatDateYmdForEmail(r.issue_date)}T00:00:00+08:00`)) || '-')}</td><td style="${tdStyle}">${escapeHtml(r.exchange)}</td><td style="${tdNumStyle}">${escapeHtml(formatAmountForEmail(r.issue_price))}</td><td style="${tdNumStyle}">${escapeHtml(formatAmountForEmail(r.limit_shares))}</td></tr>`
            )
            .join('')}
        </table>`;

  const newSharePart2 =
    nsUpcomingListRows.length === 0
      ? '<p style="margin:0 0 12px;color:#4e5969;">（无上市日期大于等于今日的数据）</p>'
      : `<table cellpadding="0" cellspacing="0" style="${tableBaseStyle}">
          <tr>
            <th style="${thStyle}">股票代码</th><th style="${thStyle}">股票简称</th><th style="${thStyle}">申购日期</th><th style="${thStyle}">上市日期</th><th style="${thStyle}">交易所</th><th style="${thStyle}">发行价</th>
          </tr>
          ${nsUpcomingListRows
            .map(
              (r, i) =>
                `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};"><td style="${tdStyle}">${escapeHtml(r.stock_code)}</td><td style="${tdStyle}">${escapeHtml(r.stock_name)}</td><td style="${tdStyle}">${escapeHtml(formatDateYmdForEmail(r.issue_date))}</td><td style="${tdStyle}">${escapeHtml(formatDateYmdForEmail(r.public_date))}</td><td style="${tdStyle}">${escapeHtml(r.exchange)}</td><td style="${tdNumStyle}">${escapeHtml(formatAmountForEmail(r.issue_price))}</td></tr>`
            )
            .join('')}
        </table>`;

  const newSharePart3 =
    nsFirstDayRows.length === 0
      ? '<p style="margin:0 0 12px;color:#4e5969;">（昨日无上市首日表现数据）</p>'
      : `<table cellpadding="0" cellspacing="0" style="${tableBaseStyle}">
          <tr>
            <th style="${thStyle}">股票代码</th><th style="${thStyle}">股票简称</th><th style="${thStyle}">上市日期</th><th style="${thStyle}">交易所</th><th style="${thStyle}">发行价</th><th style="${thStyle}">上市首日收盘价</th><th style="${thStyle}">首日涨幅</th>
          </tr>
          ${nsFirstDayRows
            .map(
              (r, i) =>
                `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafafa'};"><td style="${tdStyle}">${escapeHtml(r.stock_code)}</td><td style="${tdStyle}">${escapeHtml(r.stock_name)}</td><td style="${tdStyle}">${escapeHtml(formatDateYmdForEmail(r.public_date))}</td><td style="${tdStyle}">${escapeHtml(r.exchange)}</td><td style="${tdNumStyle}">${escapeHtml(formatAmountForEmail(r.issue_price))}</td><td style="${tdNumStyle}">${escapeHtml(formatAmountForEmail(r.first_day_close))}</td><td style="${tdNumStyle}">${escapeHtml(formatPercentNumberForEmail(r.first_day_chg_pct))}</td></tr>`
            )
            .join('')}
        </table>`;

  const sectionNo = ['一', '二', '三', '四', '五', '六', '七'];
  let sectionIndex = 0;
  const renderSectionTitle = (title, color = '#00b42a') =>
    `<h3 style="margin:16px 0 10px;padding-left:10px;border-left:4px solid ${color};color:${color};">${sectionNo[sectionIndex++]}、${title}</h3>`;
  let listingSectionHtml = '';
  if (includeListingProjectProgress) {
    listingSectionHtml += `${renderSectionTitle('底层项目上市进展（昨日）', '#1677ff')}${part1Project}`;
  }
  if (includeNewShare) {
    // 二、昨日上市：展示与「打新日历 -> 上市首日表现（上市日期=昨日）」相同数据
    listingSectionHtml += `${renderSectionTitle('IPO上市（昨日）', '#f53f3f')}${newSharePart3}`;
  }
  if (includeListingProgress) {
    listingSectionHtml += `${renderSectionTitle('IPO审核（昨日）', '#00b42a')}${part2Exchange}`;
  }
  if (includeListingGuidance) {
    listingSectionHtml += `${renderSectionTitle('证监会辅导备案（昨日）', '#ff7d00')}${part2Guidance}`;
  }
  if (includeOverseasFiling && today.getDay() === 1) {
    listingSectionHtml += `${renderSectionTitle('境内企业境外上市备案（上周）', '#f7ba1e')}${part2OverseasMonday}`;
  }

  const newShareSectionHtml = includeNewShare
    ? `
      ${renderSectionTitle('其他-打新日历', '#003a8c')}
      <h4 style="margin:10px 0 8px;color:#1d2129;">打新申购（本周）</h4>
      ${newSharePart1}
      <h4 style="margin:10px 0 8px;color:#1d2129;">上市日历（未来5天上市股票）</h4>
      ${newSharePart2}
    `
    : '';

  const html = `
    <div style="font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.6;color:#1d2129;background:#fff;">
      <h2 style="margin:0 0 12px 0;padding-bottom:10px;border-bottom:2px solid #4CAF50;">IPO 进展日报 - ${reportDay}</h2>
      ${listingSectionHtml}
      ${newShareSectionHtml}
    </div>
  `;

  const subject = (recipient.email_subject && String(recipient.email_subject).trim()) || `上市进展日报 ${reportDay}`;

  const mailLogMeta = {
    recipientId: recipient.id,
    userId: recipient.user_id,
    toEmail: recipient.recipient_email,
    subject,
    reportDay,
    selectedTypes,
    stats: {
      listingProjectProgressCount: ipp.length,
      listingProgressCount: ipoExchangeYesterday.length,
      listingGuidanceCount: ipoGuidanceYesterday.length,
      overseasFilingCount: ipoOverseasMonday.length,
      newShareApplyCount: nsApplyRows.length,
      newShareUpcomingCount: nsUpcomingListRows.length,
      newShareFirstDayCount: nsFirstDayRows.length,
    },
  };
  console.log('[上市进展邮件] 开始发送日报:', mailLogMeta);
  try {
    await sendMailWithConfig({
      emailConfigId,
      toEmail: recipient.recipient_email,
      subject,
      html,
      userId: recipient.user_id,
    });
    console.log('[上市进展邮件] 日报发送成功:', {
      recipientId: recipient.id,
      toEmail: recipient.recipient_email,
      subject,
      reportDay,
    });
  } catch (error) {
    console.error('[上市进展邮件] 日报发送失败:', {
      ...mailLogMeta,
      error: error.message,
    });
    throw error;
  }
}

module.exports = { executeListingEmailDigest };
