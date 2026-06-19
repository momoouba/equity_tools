const {
  INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING,
  NEWS_TYPE_FINANCING_INFO,
  APP_NAME_PROJECT_SOURCING,
  PROJECT_SOURCING_APP_ID,
  PROJECT_SOURCING_CREATED_AT,
} = require('./constants');

/** interface_news_type_enabled：投融资接口类型 + 融资信息 */
async function seedInterfaceNewsTypeFinancing(dbPool) {
  const [hasFinancingIface] = await dbPool.query(
    `SELECT 1 FROM interface_news_type_enabled WHERE interface_type = ? AND news_type = ? LIMIT 1`,
    [INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING, NEWS_TYPE_FINANCING_INFO]
  );
  if (hasFinancingIface.length === 0) {
    const finIfaceId = `${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}00003`;
    await dbPool.query(
      `INSERT INTO interface_news_type_enabled (F_Id, interface_type, news_type, is_enabled) VALUES (?, ?, ?, 1)`,
      [finIfaceId, INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING, NEWS_TYPE_FINANCING_INFO]
    );
    console.log(`已为 ${INTERFACE_TYPE_SHANGHAI_INTERNATIONAL_FINANCING} 启用「${NEWS_TYPE_FINANCING_INFO}」类型`);
  }
}

/** applications 兜底 + 从新闻舆情复制 SMTP */
async function seedApplicationsAndEmailFallback(dbPool) {
  try {
    await dbPool.query(
      `INSERT IGNORE INTO applications (F_Id, app_name, F_CreatorTime) VALUES (?, ?, ?)`,
      [PROJECT_SOURCING_APP_ID, APP_NAME_PROJECT_SOURCING, PROJECT_SOURCING_CREATED_AT]
    );
    console.log('✓ applications 项目挖掘应用记录已就绪');
  } catch (err) {
    console.warn('插入 applications 项目挖掘时出现警告:', err.message);
  }

  try {
    const { generateId } = require('../idGenerator');
    const [psApps] = await dbPool.query(
      `SELECT F_Id AS id FROM applications WHERE BINARY app_name = BINARY ? LIMIT 1`,
      [APP_NAME_PROJECT_SOURCING]
    );
    if (!psApps.length) return;

    const psAppId = psApps[0].id;
    const [existPsEc] = await dbPool.query(`SELECT F_Id AS id FROM email_config WHERE app_id = ? LIMIT 1`, [psAppId]);
    if (existPsEc.length > 0) return;

    const [newsEc] = await dbPool.query(
      `SELECT ec.* FROM email_config ec
       INNER JOIN applications a ON ec.app_id = a.F_Id
       WHERE BINARY a.app_name = BINARY ? LIMIT 1`,
      ['新闻舆情']
    );
    if (newsEc.length === 0) {
      console.warn('  未找到新闻舆情 email_config，跳过项目挖掘邮件配置自动创建');
      return;
    }

    const ne = newsEc[0];
    const newEcId = await generateId('email_config', dbPool);
    await dbPool.execute(
      `INSERT INTO email_config (
        F_Id, app_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password,
        from_email, from_name, pop_host, pop_port, pop_secure, pop_user, pop_password, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newEcId,
        psAppId,
        ne.smtp_host,
        ne.smtp_port,
        ne.smtp_secure,
        ne.smtp_user,
        ne.smtp_password,
        ne.from_email,
        ne.from_name || APP_NAME_PROJECT_SOURCING,
        ne.pop_host,
        ne.pop_port,
        ne.pop_secure,
        ne.pop_user,
        ne.pop_password,
        ne.is_active !== undefined ? ne.is_active : 1,
      ]
    );
    console.log('✓ 已按新闻舆情 SMTP 复制项目挖掘 email_config');
  } catch (err) {
    console.warn('项目挖掘邮件配置初始化时出现警告:', err.message);
  }
}

module.exports = {
  seedInterfaceNewsTypeFinancing,
  seedApplicationsAndEmailFallback,
};
