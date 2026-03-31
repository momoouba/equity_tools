/**
 * 清理 applications 表，只保留指定的三个应用
 * 保留：
 * - 2026031616180010001 业绩看板
 * - 2025112019132600001 新闻舆情
 * - 2026033000000000001 上市进展
 */

const db = require('../db');

async function cleanupApplications() {
  const keepIds = [
    '2026031616180010001', // 业绩看板
    '2025112019132600001', // 新闻舆情
    '2026033000000000001', // 上市进展
  ];
  const perfId = '2026031616180010001';

  try {
    console.log('开始清理 applications 表...');

    // 1. 先查询将要删除的应用ID
    const appsToDelete = await db.query(
      `SELECT id, app_name FROM applications WHERE id NOT IN (?)`,
      [keepIds]
    );

    if (appsToDelete.length === 0) {
      console.log('✓ 没有需要删除的应用');
      return;
    }

    console.log(`发现 ${appsToDelete.length} 个需要删除的应用:`);
    appsToDelete.forEach(app => {
      console.log(`  - ${app.id}: ${app.app_name}`);
    });

    // 2. 处理外键关联表 - 将关联设置为 NULL 或删除
    // 由于外键约束是 ON DELETE CASCADE，我们需要先处理或确认相关数据

    // 2.1 检查 membership_levels 表
    const membershipLevels = await db.query(
      `SELECT ml.id, ml.level_name, ml.app_id, a.app_name 
       FROM membership_levels ml 
       LEFT JOIN applications a ON ml.app_id = a.id 
       WHERE ml.app_id NOT IN (?)`,
      [keepIds]
    );
    if (membershipLevels.length > 0) {
      console.log(`  发现 ${membershipLevels.length} 条 membership_levels 记录关联到将被删除的应用`);
      await db.execute(`UPDATE membership_levels SET app_id = ? WHERE app_id NOT IN (?)`, [perfId, keepIds]);
      console.log('  ✓ 已将 membership_levels 关联迁移到业绩看板');
    }

    // 2.2 检查 email_config 表
    const emailConfigs = await db.query(
      `SELECT ec.id, ec.app_id, a.app_name 
       FROM email_config ec 
       LEFT JOIN applications a ON ec.app_id = a.id 
       WHERE ec.app_id NOT IN (?)`,
      [keepIds]
    );
    if (emailConfigs.length > 0) {
      console.log(`  发现 ${emailConfigs.length} 条 email_config 记录关联到将被删除的应用`);
      const existsPerfEmail = await db.query(`SELECT id FROM email_config WHERE app_id = ? LIMIT 1`, [perfId]);
      if (existsPerfEmail.length > 0) {
        await db.execute(`DELETE FROM email_config WHERE app_id NOT IN (?)`, [keepIds]);
        console.log('  ✓ 业绩看板 email_config 已存在，已删除其他应用的 email_config');
      } else {
        const legacyEmail = await db.query(`SELECT id FROM email_config WHERE app_id NOT IN (?) LIMIT 1`, [keepIds]);
        if (legacyEmail.length > 0) {
          await db.execute(`UPDATE email_config SET app_id = ? WHERE id = ?`, [perfId, legacyEmail[0].id]);
        }
        await db.execute(`DELETE FROM email_config WHERE app_id NOT IN (?)`, [keepIds]);
        console.log('  ✓ 已迁移并清理 email_config');
      }
    }

    // 2.3 检查 qichacha_config 表
    const qichachaConfigs = await db.query(
      `SELECT qc.id, qc.app_id, a.app_name 
       FROM qichacha_config qc 
       LEFT JOIN applications a ON qc.app_id = a.id 
       WHERE qc.app_id NOT IN (?)`,
      [keepIds]
    );
    if (qichachaConfigs.length > 0) {
      console.log(`  发现 ${qichachaConfigs.length} 条 qichacha_config 记录关联到将被删除的应用`);
      await db.execute(`DELETE FROM qichacha_config WHERE app_id NOT IN (?)`, [keepIds]);
      console.log('  ✓ 已清理无效 qichacha_config 记录');
    }

    // 2.4 检查 news_interface_config 表
    const newsInterfaceConfigs = await db.query(
      `SELECT nic.id, nic.app_id, a.app_name 
       FROM news_interface_config nic 
       LEFT JOIN applications a ON nic.app_id = a.id 
       WHERE nic.app_id NOT IN (?)`,
      [keepIds]
    );
    if (newsInterfaceConfigs.length > 0) {
      console.log(`  发现 ${newsInterfaceConfigs.length} 条 news_interface_config 记录关联到将被删除的应用`);
      await db.execute(`DELETE FROM news_interface_config WHERE app_id NOT IN (?)`, [keepIds]);
      console.log('  ✓ 已清理无效 news_interface_config 记录');
    }

    // 2.5 检查 recipient_management 表
    const recipients = await db.query(
      `SELECT rm.id, rm.app_id, a.app_name 
       FROM recipient_management rm 
       LEFT JOIN applications a ON rm.app_id = a.id 
       WHERE rm.app_id NOT IN (?)`,
      [keepIds]
    );
    if (recipients.length > 0) {
      console.log(`  发现 ${recipients.length} 条 recipient_management 记录关联到将被删除的应用`);
      await db.execute(`UPDATE recipient_management SET app_id = ? WHERE app_id NOT IN (?)`, [perfId, keepIds]);
      console.log('  ✓ 已将 recipient_management 关联迁移到业绩看板');
    }

    // 3. 删除 applications 表中不需要的记录
    const deleteResult = await db.execute(
      `DELETE FROM applications WHERE id NOT IN (?)`,
      [keepIds]
    );
    console.log(`✓ 已删除 ${deleteResult.affectedRows || 0} 条 applications 记录`);

    // 4. 验证保留的应用
    const remainingApps = await db.query(
      `SELECT id, app_name FROM applications ORDER BY id`
    );
    console.log('\n保留的应用:');
    remainingApps.forEach(app => {
      console.log(`  - ${app.id}: ${app.app_name}`);
    });

    console.log('\n✓ applications 表清理完成');
  } catch (error) {
    console.error('清理 applications 表时出错:', error.message);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  (async () => {
    try {
      await cleanupApplications();
      process.exit(0);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  })();
}

module.exports = { cleanupApplications };
