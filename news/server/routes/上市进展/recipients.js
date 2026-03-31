const db = require('../../db');
const { generateId } = require('../../utils/idGenerator');
const { getUserFromHeader, isAdminAccount, canAccessListing } = require('../../utils/上市进展/listingAuth');
const { executeListingEmailDigest } = require('../../utils/上市进展/listingEmailDigest');

function unauthorized(res) {
  return res.status(401).json({ success: false, message: '未登录' });
}

function forbidden(res) {
  return res.status(403).json({ success: false, message: '无权限' });
}

async function getListingAppId() {
  const rows = await db.query(
    `SELECT id FROM applications WHERE BINARY app_name = BINARY ? LIMIT 1`,
    ['上市进展']
  );
  return rows.length ? rows[0].id : null;
}

async function getListingEmailConfigRow() {
  const rows = await db.query(
    `SELECT ec.id FROM email_config ec
     INNER JOIN applications a ON ec.app_id = a.id
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
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const listingAppId = await getListingAppId();
    const ec = await getListingEmailConfigRow();
    return res.json({
      success: true,
      data: {
        listingAppId,
        emailConfigId: ec ? ec.id : null,
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
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const listingAppId = await getListingAppId();
    if (!listingAppId) {
      return res.status(500).json({ success: false, message: '未找到上市进展应用' });
    }

    let sql = `
      SELECT rm.*, u.account AS user_account
      FROM recipient_management rm
      INNER JOIN users u ON rm.user_id = u.id
      WHERE rm.app_id = ? AND (rm.is_deleted IS NULL OR rm.is_deleted = 0)
    `;
    const params = [listingAppId];

    if (!isAdminAccount(user.account)) {
      sql += ` AND rm.user_id = ?`;
      params.push(user.id);
    }

    sql += ` ORDER BY rm.created_at DESC`;

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
    } = req.body || {};

    if (!recipient_email || String(recipient_email).trim() === '') {
      return res.status(400).json({ success: false, message: '收件人邮箱不能为空' });
    }

    const finalCron = cron_expression || '0 0 9 * * ? *';
    const recipientId = await generateId('recipient_management');

    await db.execute(
      `INSERT INTO recipient_management (
        id, user_id, app_id, recipient_email, email_subject, cron_expression,
        send_frequency, send_time, is_active, qichacha_category_codes, entity_type
      ) VALUES (?, ?, ?, ?, ?, ?, 'daily', NULL, ?, NULL, NULL)`,
      [
        recipientId,
        user.id,
        listingAppId,
        String(recipient_email).trim(),
        email_subject || '上市进展通知',
        finalCron,
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
      ]
    );

    const row = await db.query(`SELECT * FROM recipient_management WHERE id = ?`, [recipientId]);
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
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const listingAppId = await getListingAppId();
    const id = req.params.id;

    const existing = await db.query(
      `SELECT * FROM recipient_management WHERE id = ? AND app_id = ? AND (is_deleted IS NULL OR is_deleted = 0)`,
      [id, listingAppId]
    );
    if (!existing.length) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    if (!isAdminAccount(user.account) && existing[0].user_id !== user.id) {
      return forbidden(res);
    }

    const body = req.body || {};
    await db.execute(
      `UPDATE recipient_management SET
        recipient_email = ?, email_subject = ?, cron_expression = ?, is_active = ?
       WHERE id = ?`,
      [
        body.recipient_email ?? existing[0].recipient_email,
        body.email_subject ?? existing[0].email_subject,
        body.cron_expression ?? existing[0].cron_expression,
        body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing[0].is_active,
        id,
      ]
    );

    const row = await db.query(`SELECT * FROM recipient_management WHERE id = ?`, [id]);
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
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const listingAppId = await getListingAppId();
    const id = req.params.id;

    const existing = await db.query(
      `SELECT * FROM recipient_management WHERE id = ? AND app_id = ? AND (is_deleted IS NULL OR is_deleted = 0)`,
      [id, listingAppId]
    );
    if (!existing.length) {
      return res.status(404).json({ success: false, message: '记录不存在' });
    }
    if (!isAdminAccount(user.account) && existing[0].user_id !== user.id) {
      return forbidden(res);
    }

    await db.execute(
      `UPDATE recipient_management SET is_deleted = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ?`,
      [user.id, id]
    );
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
    if (!(await canAccessListing(user.id, user.account))) return forbidden(res);

    const listingAppId = await getListingAppId();
    const ec = await getListingEmailConfigRow();
    if (!ec) {
      return res.status(400).json({ success: false, message: '请先在系统配置「邮件配置」中配置上市进展应用的 SMTP' });
    }

    const id = req.params.id;
    const existing = await db.query(
      `SELECT * FROM recipient_management WHERE id = ? AND app_id = ? AND (is_deleted IS NULL OR is_deleted = 0)`,
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
    // 与定时任务保持一致：发送“前一日底层项目上市进展 + 前一日上市进展”两层内容，主题使用收件配置
    await executeListingEmailDigest(existing[0], { skipHolidayCheck: false });
    return res.json({ success: true, message: '邮件已发送（前一日上市进展双层摘要）' });
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
