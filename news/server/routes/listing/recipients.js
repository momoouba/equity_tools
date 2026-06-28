const db = require('../../db');
const { generateId } = require('../../utils/idGenerator');
const {
  getUserFromHeader,
  isAdminAccount,
  canAccessListing,
  hasListingFeature,
  LISTING_FEATURE,
  LISTING_LEVEL,
  getListingMembershipLevelName,
  normalizeListingMailTypesByLevel,
} = require('../../utils/listing/listingAuth');
const { executeListingEmailDigest } = require('../../utils/listing/listingEmailDigest');
const { updateScheduledTasks } = require('../../utils/scheduledEmailTasks');

/** Column list with aliases for recipient_management queries returned to the frontend */
const RM_SELECT_COLS = `rm.F_Id AS id, rm.user_id, rm.app_id, rm.recipient_email, rm.email_subject,
  rm.cron_expression, rm.send_frequency, rm.send_time, rm.is_active,
  rm.qichacha_category_codes, rm.entity_type, rm.listing_mail_types,
  rm.F_CreatorTime AS created_at, rm.F_LastModifyTime AS updated_at,
  rm.F_DeleteMark AS delete_mark, rm.F_DeleteTime AS delete_time, rm.F_DeleteUserId AS delete_user_id`;

const RM_SELECT_COLS_NO_ALIAS = `F_Id AS id, user_id, app_id, recipient_email, email_subject,
  cron_expression, send_frequency, send_time, is_active,
  qichacha_category_codes, entity_type, listing_mail_types,
  F_CreatorTime AS created_at, F_LastModifyTime AS updated_at,
  F_DeleteMark AS delete_mark, F_DeleteTime AS delete_time, F_DeleteUserId AS delete_user_id`;

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无权限' });
}

async function getListingAppId() {
  const rows = await db.query(
    `SELECT F_Id AS id FROM applications WHERE BINARY app_name = BINARY ? LIMIT 1`,
    ['上市进展']
  );
  return rows.length ? rows[0].id : null;
}

async function getListingEmailConfigRow() {
  const rows = await db.query(
    `SELECT ec.F_Id AS id FROM email_config ec
     INNER JOIN applications a ON ec.app_id = a.F_Id
     WHERE BINARY a.app_name = BINARY ?
     LIMIT 1`,
    ['上市进展']
  );
  return rows.length ? rows[0] : null;
}

/** GET /api/listing/context */
async function getContext(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.IPO_PROGRESS))) return forbidden(res);

    const listingAppId = await getListingAppId();
    const ec = await getListingEmailConfigRow();
    const listingLevelName = await getListingMembershipLevelName(user.id);
    return res.json({
      success: true,
      data: {
        listingAppId,
        emailConfigId: ec ? ec.id : null,
        listingLevelName,
      },
    });
  } catch (e) {
    console.error('listing context', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

/** GET /api/listing/recipients */
async function listRecipients(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.IPO_PROGRESS))) return forbidden(res);

    const listingAppId = await getListingAppId();
    if (!listingAppId) {
      return res.status(500).json({ success: false, message: '未找到上市进展应用' });
    }

    let sql = `
      SELECT ${RM_SELECT_COLS}, u.account AS user_account
      FROM recipient_management rm
      INNER JOIN users u ON rm.user_id = u.F_Id
      WHERE rm.app_id = ? AND rm.F_DeleteMark = 0
    `;
    const params = [listingAppId];

    if (!isAdminAccount(user.account)) {
      sql += ` AND rm.user_id = ?`;
      params.push(user.id);
    }

    sql += ` ORDER BY rm.F_CreatorTime DESC`;

    const rows = await db.query(sql, params);
    return res.json({ success: true, data: rows });
  } catch (e) {
    console.error('listRecipients', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

/** POST /api/listing/recipients */
async function createRecipient(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const listingAppId = await getListingAppId();
    if (!listingAppId) {
      return res.status(500).json({ success: false, message: '未找到上市进展应用' });
    }

    const {
      recipient_email,
      email_subject,
      cron_expression,
      is_active,
      listing_mail_types,
    } = req.body || {};

    if (!recipient_email || String(recipient_email).trim() === '') {
      return res.status(400).json({ success: false, message: '收件人邮箱不能为空' });
    }

    const finalCron = cron_expression || '0 0 9 * * ? *';
    const recipientId = await generateId('recipient_management');
    const listingLevelName = await getListingMembershipLevelName(user.id);
    const normalizedMailTypes = normalizeListingMailTypesByLevel(listing_mail_types, listingLevelName);
    if (!normalizedMailTypes.length) {
      return res.status(403).json({ success: false, message: '当前应用会员等级无可发送的数据权限' });
    }

    await db.execute(
      `INSERT INTO recipient_management (
        F_Id, user_id, app_id, recipient_email, email_subject, cron_expression,
        send_frequency, send_time, is_active, qichacha_category_codes, entity_type, listing_mail_types
      ) VALUES (?, ?, ?, ?, ?, ?, 'daily', NULL, ?, NULL, NULL, ?)`,
      [
        recipientId,
        user.id,
        listingAppId,
        String(recipient_email).trim(),
        email_subject || '上市进展通知',
        finalCron,
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        JSON.stringify(normalizedMailTypes),
      ]
    );

    const row = await db.query(`SELECT ${RM_SELECT_COLS_NO_ALIAS} FROM recipient_management WHERE F_Id = ?`, [recipientId]);
    try {
      await updateScheduledTasks();
    } catch (schedErr) {
      console.warn('[listing recipients] 刷新收件定时任务失败:', schedErr.message);
    }
    return res.json({ success: true, data: row[0] });
  } catch (e) {
    console.error('createRecipient', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

/** PUT /api/listing/recipients/:id */
async function updateRecipient(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.IPO_PROGRESS))) return forbidden(res);

    const listingAppId = await getListingAppId();
    const id = req.params.id;

    const existing = await db.query(
      `SELECT * FROM recipient_management WHERE F_Id = ? AND app_id = ? AND F_DeleteMark = 0`,
      [id, listingAppId]
    );
    if (!existing.length) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    if (!isAdminAccount(user.account) && existing[0].user_id !== user.id) {
      return forbidden(res);
    }

    const body = req.body || {};
    const targetUserId = isAdminAccount(user.account) ? existing[0].user_id : user.id;
    const listingLevelName = isAdminAccount(user.account)
      ? LISTING_LEVEL.VIP
      : await getListingMembershipLevelName(targetUserId);
    const nextMailTypes = Object.prototype.hasOwnProperty.call(body, 'listing_mail_types')
      ? normalizeListingMailTypesByLevel(body.listing_mail_types, listingLevelName)
      : normalizeListingMailTypesByLevel(existing[0].listing_mail_types, listingLevelName);
    if (!nextMailTypes.length) {
      return res.status(403).json({ success: false, message: '当前应用会员等级无可发送的数据权限' });
    }
    await db.execute(
      `UPDATE recipient_management SET
        recipient_email = ?, email_subject = ?, cron_expression = ?, is_active = ?, listing_mail_types = ?
       WHERE F_Id = ?`,
      [
        body.recipient_email ?? existing[0].recipient_email,
        body.email_subject ?? existing[0].email_subject,
        body.cron_expression ?? existing[0].cron_expression,
        body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing[0].is_active,
        JSON.stringify(nextMailTypes),
        id,
      ]
    );

    const row = await db.query(`SELECT ${RM_SELECT_COLS_NO_ALIAS} FROM recipient_management WHERE F_Id = ?`, [id]);
    try {
      await updateScheduledTasks();
    } catch (schedErr) {
      console.warn('[listing recipients] 刷新收件定时任务失败:', schedErr.message);
    }
    return res.json({ success: true, data: row[0] });
  } catch (e) {
    console.error('updateRecipient', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

/** DELETE /api/listing/recipients/:id 软删除 */
async function deleteRecipient(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.IPO_PROGRESS))) return forbidden(res);

    const listingAppId = await getListingAppId();
    const id = req.params.id;

    const existing = await db.query(
      `SELECT * FROM recipient_management WHERE F_Id = ? AND app_id = ? AND F_DeleteMark = 0`,
      [id, listingAppId]
    );
    if (!existing.length) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    if (!isAdminAccount(user.account) && existing[0].user_id !== user.id) {
      return forbidden(res);
    }

    await db.execute(
      `UPDATE recipient_management SET F_DeleteMark = 1, F_DeleteTime = NOW(), F_DeleteUserId = ? WHERE F_Id = ? AND F_DeleteMark = 0`,
      [user.id, id]
    );
    try {
      await updateScheduledTasks();
    } catch (schedErr) {
      console.warn('[listing recipients] 刷新收件定时任务失败:', schedErr.message);
    }
    return res.json({ success: true });
  } catch (e) {
    console.error('deleteRecipient', e);
    return res.status(500).json({ success: false, message: e.message || '服务器错误' });
  }
}

/** POST /api/listing/recipients/:id/send-test */
async function sendTest(req, res) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return unauthorized(res);
    if (!(await hasListingFeature(user.id, user.account, LISTING_FEATURE.IPO_PROGRESS))) return forbidden(res);

    const listingAppId = await getListingAppId();
    const ec = await getListingEmailConfigRow();
    if (!ec) {
      return res.status(400).json({ success: false, message: '请先在系统配置「邮件配置」中配置上市进展应用的 SMTP' });
    }

    const id = req.params.id;
    const existing = await db.query(
      `SELECT * FROM recipient_management WHERE F_Id = ? AND app_id = ? AND F_DeleteMark = 0`,
      [id, listingAppId]
    );
    if (!existing.length) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    if (!isAdminAccount(user.account) && existing[0].user_id !== user.id) {
      return forbidden(res);
    }

    const to = (existing[0].recipient_email || '').trim();
    if (!to || !to.includes('@')) {
      return res.status(400).json({ success: false, message: '收件人邮箱无效' });
    }
    // 与定时任务保持一致：按收件配置所选发件内容发送对应摘要分段
    await executeListingEmailDigest(existing[0], {
      skipHolidayCheck: false,
      currentUser: user,
    });
    return res.json({ success: true, message: '邮件已发送（按发件内容配置生成）' });
  } catch (e) {
    console.error('sendTest', e);
    return res.status(500).json({ success: false, message: e.message || '发送失败' });
  }
}

function registerRecipientRoutes(router) {
  router.get('/context', getContext);
  router.get('/recipients', listRecipients);
  router.post('/recipients', createRecipient);
  router.put('/recipients/:id', updateRecipient);
  router.delete('/recipients/:id', deleteRecipient);
  router.post('/recipients/:id/send-test', sendTest);
}

module.exports = { registerRecipientRoutes };
