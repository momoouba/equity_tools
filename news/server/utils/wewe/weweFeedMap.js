/**
 * P2：专队账号 feed 映射（历史 source_url 回填 / 粘贴分享链接）
 */
const db = require('../../db');
const {
  getMpInfoByArticleUrl,
  ensureWeweFeedSubscribed
} = require('./weweClient');
const { notifyPendingSubscribe } = require('./wewePendingSubscribeMail');

function isWeixinShareUrl(url) {
  return /^https:\/\/mp\.weixin\.qq\.com\/s\//i.test(String(url || '').trim());
}

async function findHistoryShareUrls(wechatAccountId, limit = 5) {
  const gh = String(wechatAccountId || '').trim();
  if (!gh) return [];
  const rows = await db.query(
    `SELECT source_url
     FROM news_detail
     WHERE wechat_account = ?
       AND F_DeleteMark = 0
       AND source_url IS NOT NULL
       AND source_url LIKE 'https://mp.weixin.qq.com/s/%'
     ORDER BY F_CreatorTime DESC
     LIMIT ?`,
    [gh, limit]
  );
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const u = String(r.source_url || '').trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

async function markMapped(accountRowId, { feedId, sampleUrl, note }) {
  await db.execute(
    `UPDATE wewe_private_accounts
     SET feed_id = ?,
         sample_article_url = COALESCE(?, sample_article_url),
         map_status = 'mapped',
         team_status = 'active',
         note = COALESCE(?, note),
         F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ?`,
    [feedId, sampleUrl || null, note || null, accountRowId]
  );
}

async function markPendingSubscribe(accountRowId, note) {
  await db.execute(
    `UPDATE wewe_private_accounts
     SET map_status = 'pending_subscribe',
         team_status = 'pending_subscribe',
         note = ?,
         F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ?`,
    [String(note || '待订阅：缺分享链接').slice(0, 500), accountRowId]
  );
}

async function markMapFailed(accountRowId, note) {
  await db.execute(
    `UPDATE wewe_private_accounts
     SET map_status = 'failed',
         team_status = 'pending_subscribe',
         note = ?,
         F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ?`,
    [String(note || '映射失败').slice(0, 500), accountRowId]
  );
}

/**
 * 用一篇分享链接完成：getMpInfo → ensure 订阅 → 写专队映射
 */
async function mapAccountWithSampleUrl(wechatAccountId, sampleArticleUrl) {
  const gh = String(wechatAccountId || '').trim();
  const url = String(sampleArticleUrl || '').trim();
  if (!gh) throw new Error('wechat_account_id required');
  if (!isWeixinShareUrl(url)) {
    throw new Error('sample_article_url 须为 https://mp.weixin.qq.com/s/ 开头');
  }

  const rows = await db.query(
    `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
    [gh]
  );
  if (rows.length === 0) {
    throw new Error(`专队中无此账号: ${gh}（请先入队）`);
  }

  const mp = await getMpInfoByArticleUrl(url);
  const sub = await ensureWeweFeedSubscribed(mp);
  await markMapped(rows[0].F_Id, {
    feedId: mp.id,
    sampleUrl: url,
    note: sub.created ? '已订阅 wewe 并映射' : 'wewe 已有该 feed，完成映射'
  });

  console.log(
    `[wewe映射] 成功 account=${gh} feedId=${mp.id} created=${sub.created} name=${mp.name}`
  );
  return {
    action: 'mapped',
    wechatAccountId: gh,
    feedId: mp.id,
    mpName: mp.name,
    weweFeedCreated: sub.created,
    sampleArticleUrl: url
  };
}

/**
 * 入队后自动：查历史 source_url 尝试映射；失败则待订阅。
 * 默认不立刻发邮件（避免新榜批量入队时一号一邮）；由催办调度合并为一封 digest。
 * 若需立刻单发可传 notify: true。
 */
async function tryAutoMapAfterEnqueue(wechatAccountId, options = {}) {
  const gh = String(wechatAccountId || '').trim();
  const notify = options.notify === true;
  try {
    const rows = await db.query(
      `SELECT * FROM wewe_private_accounts WHERE wechat_account_id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [gh]
    );
    if (rows.length === 0) return { action: 'skip_no_row' };
    const row = rows[0];
    if (row.map_status === 'mapped' && row.feed_id) {
      return { action: 'already_mapped', feedId: row.feed_id };
    }

    const urls = await findHistoryShareUrls(gh, 5);
    if (urls.length === 0) {
      await markPendingSubscribe(row.F_Id, '待订阅：历史 news_detail 无 mp.weixin 分享链接');
      if (notify) {
        await notifyPendingSubscribe({
          wechatAccountId: gh,
          reason: '无历史分享链接，请粘贴一篇公众号文章分享链接完成订阅'
        });
      }
      console.log(`[wewe映射] 待订阅 account=${gh}（无历史 URL；催办走 digest）`);
      return { action: 'pending_subscribe', reason: 'no_history_url' };
    }

    let lastErr = null;
    for (const u of urls) {
      try {
        const mapped = await mapAccountWithSampleUrl(gh, u);
        return { ...mapped, action: 'auto_mapped', triedUrl: u };
      } catch (e) {
        lastErr = e;
        console.warn(`[wewe映射] 历史 URL 失败 account=${gh} url=${u.slice(0, 60)}: ${e.message}`);
      }
    }

    await markMapFailed(
      row.F_Id,
      `自动映射失败: ${(lastErr && lastErr.message) || 'unknown'}`.slice(0, 500)
    );
    if (notify) {
      await notifyPendingSubscribe({
        wechatAccountId: gh,
        reason: `自动映射失败，请人工粘贴分享链接。${lastErr ? lastErr.message : ''}`
      });
    }
    return { action: 'pending_subscribe', reason: 'auto_map_failed', error: lastErr?.message };
  } catch (e) {
    console.warn(`[wewe映射] tryAutoMapAfterEnqueue 异常 account=${gh}: ${e.message}`);
    return { action: 'error', error: e.message };
  }
}

module.exports = {
  isWeixinShareUrl,
  findHistoryShareUrls,
  mapAccountWithSampleUrl,
  tryAutoMapAfterEnqueue
};
