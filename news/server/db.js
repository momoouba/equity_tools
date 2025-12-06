// 加载 .env 文件，但不覆盖已存在的环境变量（Docker 环境变量优先级更高）
require('dotenv').config({ override: false });
const mysql = require('mysql2/promise');

const {
  DB_HOST = 'localhost',
  DB_PORT = 3306,
  DB_USER = 'root',
  DB_PASSWORD = '',
  DB_NAME = 'investment_tools'
} = process.env;

let pool;

async function createDatabaseIfNeeded() {
  try {
    const connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD
    });
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.end();
    // 不再单独输出日志，合并到初始化流程中
  } catch (err) {
    console.error('✗ 数据库连接失败:', err.message);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('提示：用户名或密码错误，请检查 .env 文件中的 DB_USER 和 DB_PASSWORD');
      console.error('当前配置 - 用户:', DB_USER, '密码:', DB_PASSWORD ? '***已设置***' : '***未设置***');
    }
    throw err;
  }
}

/**
 * 检查并迁移表结构：将id字段从INT改为VARCHAR(19)
 * 需要先删除外键约束，然后修改表结构
 */
async function migrateTableIdField(dbPool, tableName) {
  try {
    // 检查表是否存在
    const [tables] = await dbPool.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = ?
    `, [tableName]);

    if (tables.length === 0) {
      // 表不存在，不需要迁移
      return false;
    }

    // 检查id字段类型
    const [columns] = await dbPool.query(`
      SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = ? 
      AND COLUMN_NAME = 'id'
    `, [tableName]);

    if (columns.length > 0 && columns[0].DATA_TYPE === 'int') {
      console.log(`正在迁移表 ${tableName} 的id字段...`);
      
      // 检查是否有数据
      const [rows] = await dbPool.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
      const hasData = rows[0].count > 0;

      if (hasData) {
        console.warn(`警告：表 ${tableName} 中已有数据，需要手动迁移。请先备份数据！`);
        console.warn(`建议：清空表 ${tableName} 的数据后重新启动服务器，或手动修改表结构`);
        
        // 由于新ID格式（VARCHAR）与旧格式（INT）不兼容，自动执行强制迁移
        console.warn(`⚠️  自动迁移模式：将清空表 ${tableName} 的所有数据并重建表结构！`);
        try {
            // 先删除所有外键约束
            const [foreignKeys] = await dbPool.query(`
              SELECT CONSTRAINT_NAME 
              FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
              WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = ? 
              AND REFERENCED_TABLE_NAME IS NOT NULL
            `, [tableName]);

            for (const fk of foreignKeys) {
              try {
                await dbPool.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
              } catch (err) {
                if (!err.message.includes("doesn't exist")) {
                  console.warn(`删除外键约束失败: ${err.message}`);
                }
              }
            }

            // 删除引用此表的外键约束
            const [referencingTables] = await dbPool.query(`
              SELECT TABLE_NAME, CONSTRAINT_NAME 
              FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
              WHERE TABLE_SCHEMA = DATABASE() 
              AND REFERENCED_TABLE_NAME = ?
            `, [tableName]);

            for (const ref of referencingTables) {
              try {
                await dbPool.query(`ALTER TABLE \`${ref.TABLE_NAME}\` DROP FOREIGN KEY \`${ref.CONSTRAINT_NAME}\``);
              } catch (err) {
                if (!err.message.includes("doesn't exist")) {
                  console.warn(`删除引用外键约束失败: ${err.message}`);
                }
              }
            }

            // 清空表数据
            await dbPool.query(`TRUNCATE TABLE \`${tableName}\``);
            console.log(`✓ 已清空表 ${tableName} 的数据`);
            
            // 删除表并重新创建
            await dbPool.query(`DROP TABLE IF EXISTS \`${tableName}\``);
            // 表已删除并将在后续步骤中重新创建
            return true;
        } catch (err) {
          console.error(`迁移表 ${tableName} 失败:`, err.message);
          return false;
        }
      } else {
        // 先删除所有外键约束
        try {
          const [foreignKeys] = await dbPool.query(`
            SELECT CONSTRAINT_NAME 
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = ? 
            AND REFERENCED_TABLE_NAME IS NOT NULL
          `, [tableName]);

          for (const fk of foreignKeys) {
            try {
              await dbPool.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
              // 已删除外键约束
            } catch (err) {
              // 忽略外键不存在的错误
              if (!err.message.includes("doesn't exist")) {
                console.warn(`删除外键约束失败: ${err.message}`);
              }
            }
          }

          // 删除引用此表的外键约束（其他表引用此表）
          const [referencingTables] = await dbPool.query(`
            SELECT TABLE_NAME, CONSTRAINT_NAME 
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND REFERENCED_TABLE_NAME = ?
          `, [tableName]);

          for (const ref of referencingTables) {
            try {
              await dbPool.query(`ALTER TABLE \`${ref.TABLE_NAME}\` DROP FOREIGN KEY \`${ref.CONSTRAINT_NAME}\``);
              // 已删除引用外键约束
            } catch (err) {
              if (!err.message.includes("doesn't exist")) {
                console.warn(`删除引用外键约束失败: ${err.message}`);
              }
            }
          }
        } catch (err) {
          console.warn(`删除外键约束时出现警告: ${err.message}`);
        }

        // 删除表并重新创建（仅当表为空时）
        await dbPool.query(`DROP TABLE IF EXISTS \`${tableName}\``);
        console.log(`表 ${tableName} 已删除并将在后续步骤中重新创建`);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error(`迁移表 ${tableName} 时出错：`, error.message);
    return false;
  }
}

async function initializeTables(dbPool) {
  try {
    // 注释掉表迁移逻辑（系统已稳定运行，所有表结构已正确）
    // 如果需要重新启用迁移，取消下面的注释
    /*
    console.log('  开始迁移表结构...');
    // 先禁用外键检查，以便删除和重建表
    await dbPool.query('SET FOREIGN_KEY_CHECKS = 0');
    console.log('  外键检查已禁用');
    
    // 迁移现有表的id字段（仅当表为空时）
    // 注意：如果表中有数据，需要手动迁移
    // 按照依赖关系顺序迁移：先迁移被引用的表，再迁移引用其他表的表
    try {
    // 第一层：基础表（无外键依赖）
    await migrateTableIdField(dbPool, 'applications');
    await migrateTableIdField(dbPool, 'system_config');
    
    // 第二层：依赖基础表
    await migrateTableIdField(dbPool, 'membership_levels');
    
    // 第三层：依赖第二层
    await migrateTableIdField(dbPool, 'users');
    
    // 第四层：依赖第三层
    await migrateTableIdField(dbPool, 'company');
    await migrateTableIdField(dbPool, 'invested_enterprises');
    await migrateTableIdField(dbPool, 'news_interface_config');
    await migrateTableIdField(dbPool, 'news_detail');
    
    // 第五层：依赖第四层和其他表
    await migrateTableIdField(dbPool, 'data_change_log');
    } catch (error) {
      console.warn('表迁移过程中出现警告（如果表为空，将自动重新创建）：', error.message);
    }
    console.log('  表迁移完成，开始创建表结构...');
    */

    await dbPool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      app_name VARCHAR(255) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS membership_levels (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      level_name VARCHAR(100) NOT NULL,
      validity_days INT NOT NULL,
      activation_date DATETIME NULL,
      app_id VARCHAR(19),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      account VARCHAR(100) NOT NULL UNIQUE,
      phone VARCHAR(20) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      company_name VARCHAR(255),
      account_status VARCHAR(20) DEFAULT 'active',
      membership_level_id VARCHAR(19),
      app_permissions TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (membership_level_id) REFERENCES membership_levels(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 为已存在的表添加 email 字段（如果不存在）
  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'users' 
      AND COLUMN_NAME = 'email'
    `);
    
    if (columns.length === 0) {
      await dbPool.query(`
        ALTER TABLE users 
        ADD COLUMN email VARCHAR(255) UNIQUE AFTER phone
      `);
      // 已为 users 表添加 email 字段
    }
  } catch (err) {
    console.warn('检查/添加 email 字段时出现警告:', err.message);
  }

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS invested_enterprises (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      project_number VARCHAR(32) NOT NULL UNIQUE,
      project_abbreviation VARCHAR(255),
      enterprise_full_name VARCHAR(255) NOT NULL,
      unified_credit_code VARCHAR(64),
      wechat_official_account_id VARCHAR(100),
      official_website VARCHAR(255),
      exit_status VARCHAR(50) DEFAULT '未退出',
      creator_user_id VARCHAR(19) COMMENT '创建用户ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      modifier_user_id VARCHAR(19) COMMENT '修改用户ID',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
      delete_mark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      delete_time DATETIME NULL COMMENT '删除时间',
      delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID',
      FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (modifier_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (delete_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 为已存在的 invested_enterprises 表添加新字段
  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'invested_enterprises'
    `);
    const columnNames = columns.map(col => col.COLUMN_NAME);

    if (!columnNames.includes('creator_user_id')) {
      await dbPool.query(`
        ALTER TABLE invested_enterprises 
        ADD COLUMN creator_user_id INT COMMENT '创建用户ID' AFTER exit_status,
        ADD COLUMN modifier_user_id INT COMMENT '修改用户ID' AFTER created_at,
        ADD COLUMN delete_mark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER updated_at,
        ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间' AFTER delete_mark,
        ADD COLUMN delete_user_id INT NULL COMMENT '删除用户ID' AFTER delete_time
      `);
      await dbPool.query(`
        ALTER TABLE invested_enterprises 
        ADD FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL,
        ADD FOREIGN KEY (modifier_user_id) REFERENCES users(id) ON DELETE SET NULL,
        ADD FOREIGN KEY (delete_user_id) REFERENCES users(id) ON DELETE SET NULL
      `);
      // 已为 invested_enterprises 表添加用户和删除相关字段
    }
  } catch (err) {
    console.warn('检查/添加 invested_enterprises 表字段时出现警告:', err.message);
  }

  // company 表：存储去重的被投企业信息
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS company (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      enterprise_abbreviation VARCHAR(255) NOT NULL COMMENT '被投企业简称',
      enterprise_full_name VARCHAR(255) NOT NULL COMMENT '被投企业全称',
      unified_credit_code VARCHAR(64) COMMENT '统一社会信用代码',
      official_website VARCHAR(255) COMMENT '公司官网',
      wechat_official_account_id VARCHAR(100) COMMENT '微信公众号id',
      creator_user_id VARCHAR(19) COMMENT '创建用户ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updater_user_id VARCHAR(19) COMMENT '更新用户ID',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_credit_code (unified_credit_code),
      FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updater_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 为已存在的 company 表添加新字段
  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'company'
    `);
    const columnNames = columns.map(col => col.COLUMN_NAME);

    if (!columnNames.includes('creator_user_id')) {
      await dbPool.query(`
        ALTER TABLE company 
        ADD COLUMN creator_user_id INT COMMENT '创建用户ID' AFTER wechat_official_account_id,
        ADD COLUMN updater_user_id INT COMMENT '更新用户ID' AFTER created_at
      `);
      await dbPool.query(`
        ALTER TABLE company 
        ADD FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL,
        ADD FOREIGN KEY (updater_user_id) REFERENCES users(id) ON DELETE SET NULL
      `);
      // 已为 company 表添加用户相关字段
    }
  } catch (err) {
    console.warn('检查/添加 company 表字段时出现警告:', err.message);
  }

  // qichacha_config 表：企查查接口配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS qichacha_config (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      app_id VARCHAR(19) NOT NULL COMMENT '应用ID',
      qichacha_app_key VARCHAR(255) COMMENT '企查查应用凭证',
      qichacha_secret_key VARCHAR(255) COMMENT '企查查凭证秘钥',
      qichacha_daily_limit INT DEFAULT 100 COMMENT '每日查询限制次数',
      interface_type VARCHAR(50) DEFAULT '企业信息' COMMENT '接口类型：企业信息/新闻舆情',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_app_interface (app_id, interface_type),
      FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  
  // 迁移qichacha_config表，添加app_id字段
  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'qichacha_config' 
      AND COLUMN_NAME = 'app_id'
    `);
    if (columns.length === 0) {
      await dbPool.query('ALTER TABLE qichacha_config ADD COLUMN app_id VARCHAR(19) NULL');
      // 如果有数据，设置默认app_id为'新闻舆情'
      const [newsApp] = await dbPool.query("SELECT id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1", ['新闻舆情']);
      if (newsApp.length > 0) {
        await dbPool.query('UPDATE qichacha_config SET app_id = ? WHERE app_id IS NULL', [newsApp[0].id]);
      }
      await dbPool.query('ALTER TABLE qichacha_config MODIFY COLUMN app_id VARCHAR(19) NOT NULL');
      
      // 检查并删除旧的唯一键
      try {
        const [indexes] = await dbPool.query(`
          SELECT CONSTRAINT_NAME 
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'qichacha_config' 
          AND CONSTRAINT_TYPE = 'UNIQUE'
          AND CONSTRAINT_NAME = 'uk_app_id'
        `);
        if (indexes.length > 0) {
          await dbPool.query('ALTER TABLE qichacha_config DROP INDEX uk_app_id');
        }
      } catch (err) {
        console.warn('删除旧唯一键时出现警告:', err.message);
      }
      
      // 添加新的联合唯一键（如果interface_type字段已存在）
      try {
        const [interfaceTypeCol] = await dbPool.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'qichacha_config' 
          AND COLUMN_NAME = 'interface_type'
        `);
        if (interfaceTypeCol.length > 0) {
          // 检查新唯一键是否已存在
          const [newIndexes] = await dbPool.query(`
            SELECT CONSTRAINT_NAME 
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'qichacha_config' 
            AND CONSTRAINT_TYPE = 'UNIQUE'
            AND CONSTRAINT_NAME = 'uk_app_interface'
          `);
          if (newIndexes.length === 0) {
            await dbPool.query('ALTER TABLE qichacha_config ADD UNIQUE KEY uk_app_interface (app_id, interface_type)');
          }
        }
      } catch (err) {
        console.warn('添加新唯一键时出现警告:', err.message);
      }
      
      await dbPool.query('ALTER TABLE qichacha_config ADD FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE');
    }
    // 添加is_active字段
    const [isActiveCol] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'qichacha_config' 
      AND COLUMN_NAME = 'is_active'
    `);
    if (isActiveCol.length === 0) {
      await dbPool.query('ALTER TABLE qichacha_config ADD COLUMN is_active TINYINT(1) DEFAULT 1 COMMENT \'是否启用：1-启用，0-禁用\'');
    }
    // 添加interface_type字段
    const [interfaceTypeCol] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'qichacha_config' 
      AND COLUMN_NAME = 'interface_type'
    `);
    if (interfaceTypeCol.length === 0) {
      await dbPool.query('ALTER TABLE qichacha_config ADD COLUMN interface_type VARCHAR(50) DEFAULT \'企业信息\' COMMENT \'接口类型：企业信息/新闻舆情\'');
      // 将现有数据的接口类型设置为"企业信息"
      await dbPool.query('UPDATE qichacha_config SET interface_type = \'企业信息\' WHERE interface_type IS NULL');
    }
    
    // 无论interface_type字段是否存在，都要检查并更新唯一键约束
    try {
      // 检查interface_type字段是否存在
      const [checkInterfaceType] = await dbPool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'qichacha_config' 
        AND COLUMN_NAME = 'interface_type'
      `);
      
      if (checkInterfaceType.length > 0) {
        // interface_type字段存在，检查并更新唯一键
        const [newIndexes] = await dbPool.query(`
          SELECT CONSTRAINT_NAME 
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'qichacha_config' 
          AND CONSTRAINT_TYPE = 'UNIQUE'
          AND CONSTRAINT_NAME = 'uk_app_interface'
        `);
        
        if (newIndexes.length === 0) {
          // 先删除旧的唯一键（如果存在）
          try {
            const [oldIndexes] = await dbPool.query(`
              SELECT CONSTRAINT_NAME 
              FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
              WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = 'qichacha_config' 
              AND CONSTRAINT_TYPE = 'UNIQUE'
              AND CONSTRAINT_NAME = 'uk_app_id'
            `);
            if (oldIndexes.length > 0) {
              // 正在删除旧的唯一键 uk_app_id
              await dbPool.query('ALTER TABLE qichacha_config DROP INDEX uk_app_id');
              // 已删除旧的唯一键 uk_app_id
            }
          } catch (err) {
            console.warn('删除旧唯一键时出现警告:', err.message);
          }
          
          // 添加新的联合唯一键
          // 正在添加新的联合唯一键 uk_app_interface
          await dbPool.query('ALTER TABLE qichacha_config ADD UNIQUE KEY uk_app_interface (app_id, interface_type)');
          console.log('✓ 已添加新的联合唯一键 uk_app_interface');
        }
      }
    } catch (err) {
      console.warn('更新唯一键约束时出现警告:', err.message);
    }
  } catch (err) {
    console.warn('迁移qichacha_config表时出现警告:', err.message);
  }

  // system_config 表：系统配置（保留用于其他配置）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      config_key VARCHAR(100) NOT NULL UNIQUE COMMENT '配置键',
      config_value TEXT COMMENT '配置值',
      config_desc VARCHAR(255) COMMENT '配置描述',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS system_file_storage (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      config_key VARCHAR(100) NOT NULL UNIQUE COMMENT '关联的配置键',
      filename VARCHAR(255) NOT NULL COMMENT '文件名称',
      mime_type VARCHAR(100) DEFAULT 'image/jpeg' COMMENT '文件类型',
      file_size INT COMMENT '文件大小（字节）',
      file_data LONGBLOB NOT NULL COMMENT '文件内容',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // data_change_log 表：统一的数据变更日志表
  // 先创建表（不包含外键约束，稍后添加）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS data_change_log (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      table_name VARCHAR(100) NOT NULL COMMENT '表名',
      record_id VARCHAR(19) NOT NULL COMMENT '表数据的ID值',
      changed_field VARCHAR(100) NOT NULL COMMENT '变更字段名',
      old_value TEXT COMMENT '旧值',
      new_value TEXT COMMENT '新值',
      change_user_id VARCHAR(19) COMMENT '变更人ID',
      change_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间',
      INDEX idx_table_record (table_name, record_id),
      INDEX idx_change_time (change_time),
      INDEX idx_table_name (table_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 重新启用外键检查
  await dbPool.query('SET FOREIGN_KEY_CHECKS = 1');

  // 检查并添加外键约束（如果users表已存在且id字段类型匹配）
  try {
    const [usersColumns] = await dbPool.query(`
      SELECT DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'users' 
      AND COLUMN_NAME = 'id'
    `);
    
    if (usersColumns.length > 0 && usersColumns[0].DATA_TYPE === 'varchar') {
      // 检查外键是否已存在
      const [existingFK] = await dbPool.query(`
        SELECT CONSTRAINT_NAME 
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'data_change_log' 
        AND CONSTRAINT_NAME = 'data_change_log_ibfk_1'
      `);
      
      if (existingFK.length === 0) {
        await dbPool.query(`
          ALTER TABLE data_change_log 
          ADD CONSTRAINT data_change_log_ibfk_1 
          FOREIGN KEY (change_user_id) REFERENCES users(id) ON DELETE SET NULL
        `);
        // 已为 data_change_log 表添加外键约束
      }
    }
  } catch (err) {
    console.warn('添加 data_change_log 外键约束时出现警告:', err.message);
  }

  // news_interface_config 表：新闻接口配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS news_interface_config (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      app_id VARCHAR(19) NOT NULL COMMENT '应用ID',
      interface_type VARCHAR(50) DEFAULT '新榜' COMMENT '新闻接口类型：新榜',
      request_url VARCHAR(500) NOT NULL COMMENT '请求地址',
      content_type VARCHAR(100) DEFAULT 'application/x-www-form-urlencoded;charset=utf-8' COMMENT 'Content-Type',
      api_key VARCHAR(255) NOT NULL COMMENT 'Key',
      frequency_type VARCHAR(20) NOT NULL COMMENT '频次类型：day-天，week-周，month-月',
      frequency_value INT NOT NULL COMMENT '频次值（X天或X月）',
      send_frequency VARCHAR(20) COMMENT '定时任务发送频率：daily-每天，weekly-每周，monthly-每月',
      send_time TIME COMMENT '定时任务发送时间（格式：HH:mm:ss）',
      weekday VARCHAR(20) COMMENT '每周同步的星期：monday到sunday',
      month_day VARCHAR(20) COMMENT '每月同步的日期：first-第一天，last-最后一天，15-15日',
      last_sync_time DATETIME NULL COMMENT '最后同步时间',
      last_sync_date DATE NULL COMMENT '最后同步日期',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      is_deleted TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      deleted_at DATETIME NULL COMMENT '删除时间',
      deleted_by VARCHAR(19) NULL COMMENT '删除人ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  
  // 迁移news_interface_config表，添加app_id字段并修复唯一键约束
  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'app_id'
    `);
    if (columns.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN app_id VARCHAR(19) NULL');
      // 如果有数据，设置默认app_id为'新闻舆情'
      const [newsApp] = await dbPool.query("SELECT id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1", ['新闻舆情']);
      if (newsApp.length > 0) {
        await dbPool.query('UPDATE news_interface_config SET app_id = ? WHERE app_id IS NULL', [newsApp[0].id]);
      }
      await dbPool.query('ALTER TABLE news_interface_config MODIFY COLUMN app_id VARCHAR(19) NOT NULL');
      // 检查是否已存在interface_type字段，如果不存在则添加
      const [interfaceTypeCheck] = await dbPool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'news_interface_config' 
        AND COLUMN_NAME = 'interface_type'
      `);
      if (interfaceTypeCheck.length === 0) {
        await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN interface_type VARCHAR(50) DEFAULT \'新榜\' COMMENT \'新闻接口类型：新榜/企查查\'');
        await dbPool.query('UPDATE news_interface_config SET interface_type = \'新榜\' WHERE interface_type IS NULL');
      }
      // 检查并删除旧的唯一键，添加新的联合唯一键
      const [oldUkCheck] = await dbPool.query(`
        SELECT CONSTRAINT_NAME 
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'news_interface_config' 
        AND CONSTRAINT_TYPE = 'UNIQUE' 
        AND CONSTRAINT_NAME = 'uk_app_id'
      `);
      if (oldUkCheck.length > 0) {
        await dbPool.query('ALTER TABLE news_interface_config DROP INDEX uk_app_id');
      }
      // 不再添加唯一约束，允许同一应用和接口类型有多个不同配置
      // 检查新的联合唯一键是否存在，如果存在则移除
      const [newUkCheck] = await dbPool.query(`
        SELECT CONSTRAINT_NAME 
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'news_interface_config' 
        AND CONSTRAINT_TYPE = 'UNIQUE' 
        AND CONSTRAINT_NAME = 'uk_app_interface'
      `);
      if (newUkCheck.length > 0) {
        await dbPool.query('ALTER TABLE news_interface_config DROP INDEX uk_app_interface');
        // 已移除 news_interface_config 表的唯一约束 uk_app_interface
      }
      // 检查外键是否存在，如果不存在则添加
      const [fkCheck] = await dbPool.query(`
        SELECT CONSTRAINT_NAME 
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'news_interface_config' 
        AND CONSTRAINT_NAME LIKE '%app_id%'
        AND REFERENCED_TABLE_NAME = 'applications'
      `);
      if (fkCheck.length === 0) {
        await dbPool.query('ALTER TABLE news_interface_config ADD FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE');
      }
    }
  } catch (err) {
    console.warn('迁移news_interface_config表时出现警告:', err.message);
  }

  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'news_interface_config'
      AND COLUMN_NAME = 'is_deleted'
    `);
    if (columns.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_interface_config
        ADD COLUMN is_deleted TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除'
      `);
      await dbPool.query(`
        ALTER TABLE news_interface_config
        ADD COLUMN deleted_at DATETIME NULL COMMENT '删除时间'
      `);
      await dbPool.query(`
        ALTER TABLE news_interface_config
        ADD COLUMN deleted_by VARCHAR(19) NULL COMMENT '删除人ID'
      `);
    }
  } catch (err) {
    console.warn('为 news_interface_config 添加删除字段时出现警告:', err.message);
  }

  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'news_interface_config'
      AND COLUMN_NAME = 'last_sync_date'
    `);
    if (columns.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_interface_config
        ADD COLUMN last_sync_date DATE NULL COMMENT '最后同步日期'
      `);
    }
  } catch (err) {
    console.warn('为 news_interface_config 添加 last_sync_date 字段时出现警告:', err.message);
  }

  // 迁移news_interface_config表，添加interface_type字段
  try {
    const [interfaceTypeCol] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'interface_type'
    `);
    if (interfaceTypeCol.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN interface_type VARCHAR(50) DEFAULT \'新榜\' COMMENT \'新闻接口类型：新榜\'');
      await dbPool.query('UPDATE news_interface_config SET interface_type = \'新榜\' WHERE interface_type IS NULL');
      // 已为 news_interface_config 表添加 interface_type 字段
    }
  } catch (err) {
    console.warn('迁移news_interface_config表interface_type字段时出现警告:', err.message);
  }

  // 迁移news_interface_config表，添加定时任务相关字段
  try {
    const [sendFreqCol] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'send_frequency'
    `);
    if (sendFreqCol.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN send_frequency VARCHAR(20) COMMENT \'定时任务发送频率：daily-每天，weekly-每周，monthly-每月\'');
      // 已为 news_interface_config 表添加 send_frequency 字段
    }
  } catch (err) {
    console.warn('迁移news_interface_config表send_frequency字段时出现警告:', err.message);
  }

  try {
    const [sendTimeCol] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'send_time'
    `);
    if (sendTimeCol.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN send_time TIME COMMENT \'定时任务发送时间（格式：HH:mm:ss）\'');
      // 已为 news_interface_config 表添加 send_time 字段
    }
  } catch (err) {
    console.warn('迁移news_interface_config表send_time字段时出现警告:', err.message);
  }

  // 迁移news_interface_config表，添加weekday和month_day字段
  try {
    const [weekdayCol] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'weekday'
    `);
    if (weekdayCol.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN weekday VARCHAR(20) COMMENT \'每周同步的星期：monday到sunday\'');
      // 已为 news_interface_config 表添加 weekday 字段
    }
  } catch (err) {
    console.warn('迁移news_interface_config表weekday字段时出现警告:', err.message);
  }

  try {
    const [monthDayCol] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'month_day'
    `);
    if (monthDayCol.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN month_day VARCHAR(20) COMMENT \'每月同步的日期：first-第一天，last-最后一天，15-15日\'');
      // 已为 news_interface_config 表添加 month_day 字段
    }
  } catch (err) {
    console.warn('迁移news_interface_config表month_day字段时出现警告:', err.message);
  }

  // 移除news_interface_config表的唯一约束，允许同一应用和接口类型有多个不同配置
  // 注意：需要先删除使用该索引的外键约束，然后才能删除唯一索引
  // 已禁用：此迁移逻辑每次启动都会执行，导致外键约束警告。外键约束已手动修复，不再需要每次启动都执行。
  /*
  try {
    // 首先查找所有外键约束（包括可能使用唯一索引的）
    const [foreignKeys] = await dbPool.query(`
      SELECT CONSTRAINT_NAME 
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
    
    // 删除所有相关的外键约束
    for (const fk of foreignKeys) {
      try {
        await dbPool.query(`ALTER TABLE news_interface_config DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
        // 已删除外键约束
      } catch (err) {
        // 如果外键不存在，忽略错误
        if (!err.message.includes("doesn't exist")) {
          console.warn(`删除外键约束 ${fk.CONSTRAINT_NAME} 时出现警告:`, err.message);
        }
      }
    }
    
    // 然后删除唯一约束
    const [ukCheck] = await dbPool.query(`
      SELECT CONSTRAINT_NAME 
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND CONSTRAINT_TYPE = 'UNIQUE' 
      AND CONSTRAINT_NAME = 'uk_app_interface'
    `);
    if (ukCheck.length > 0) {
      try {
        // 先尝试 DROP INDEX
        await dbPool.query('ALTER TABLE news_interface_config DROP INDEX uk_app_interface');
      } catch (err) {
        // 如果删除失败，尝试使用 DROP KEY
        try {
          await dbPool.query('ALTER TABLE news_interface_config DROP KEY uk_app_interface');
        } catch (err2) {
          // 静默处理错误，只在真正需要时输出
        }
      }
    }
    
    // 重新添加外键约束（不依赖唯一索引）
    const [fkExists] = await dbPool.query(`
      SELECT CONSTRAINT_NAME 
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND REFERENCED_TABLE_NAME = 'applications'
      AND COLUMN_NAME = 'app_id'
    `);
    if (fkExists.length === 0) {
      try {
        await dbPool.query('ALTER TABLE news_interface_config ADD CONSTRAINT fk_news_interface_config_app_id FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE');
        // 已重新添加外键约束（不依赖唯一索引）
      } catch (err) {
        console.warn('重新添加外键约束时出现警告:', err.message);
      }
    }
  } catch (err) {
    console.warn('移除news_interface_config表唯一约束时出现警告:', err.message);
  }
  */

  // recipient_management 表：收件管理
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS recipient_management (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      user_id VARCHAR(19) NOT NULL COMMENT '用户ID',
      recipient_email TEXT NOT NULL COMMENT '收件人邮箱（多个邮箱用逗号或换行分隔）',
      email_subject VARCHAR(500) COMMENT '邮件主题',
      send_frequency VARCHAR(20) NOT NULL COMMENT '发送频率：daily-每天，weekly-每周，monthly-每月',
      send_time TIME COMMENT '发送时间（格式：HH:mm:ss）',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // email_config 表：邮件发送配置（必须在 email_logs 之前创建，因为 email_logs 有外键引用它）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS email_config (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      app_id VARCHAR(19) NOT NULL COMMENT '应用ID',
      smtp_host VARCHAR(255) NOT NULL COMMENT 'SMTP服务器地址',
      smtp_port INT NOT NULL COMMENT 'SMTP端口',
      smtp_secure TINYINT(1) DEFAULT 0 COMMENT '是否使用SSL/TLS：1-是，0-否',
      smtp_user VARCHAR(255) NOT NULL COMMENT 'SMTP用户名（邮箱地址）',
      smtp_password VARCHAR(255) NOT NULL COMMENT 'SMTP密码或授权码',
      from_email VARCHAR(255) NOT NULL COMMENT '发件人邮箱',
      from_name VARCHAR(255) COMMENT '发件人名称',
      pop_host VARCHAR(255) COMMENT 'POP服务器地址',
      pop_port INT COMMENT 'POP端口',
      pop_secure TINYINT(1) DEFAULT 0 COMMENT 'POP是否使用SSL/TLS：1-是，0-否',
      pop_user VARCHAR(255) COMMENT 'POP用户名（邮箱地址）',
      pop_password VARCHAR(255) COMMENT 'POP密码或授权码',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_app_id (app_id),
      FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 迁移 email_config 表：如果表已存在但没有 app_id 字段，则添加
  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'email_config' 
      AND COLUMN_NAME = 'app_id'
    `);
    
    if (columns.length === 0) {
      // 检测到 email_config 表缺少 app_id 字段，开始迁移
      
      // 检查是否有 app_name 字段（旧结构）
      const [appNameColumns] = await dbPool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'email_config' 
        AND COLUMN_NAME = 'app_name'
      `);
      
      // 如果存在旧数据，需要先处理
      const [existingData] = await dbPool.query('SELECT COUNT(*) as count FROM email_config');
      const hasData = existingData[0].count > 0;
      
      if (hasData && appNameColumns.length > 0) {
        // 如果有旧数据且存在 app_name 字段，需要迁移数据
        // 发现旧数据，需要迁移 app_name 到 app_id
        
        // 获取"新闻舆情"应用的ID（作为默认值）
        const [newsApp] = await dbPool.query(
          "SELECT id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1",
          ['新闻舆情']
        );
        
        if (newsApp.length > 0) {
          const defaultAppId = newsApp[0].id;
          // 先添加 app_id 字段（允许NULL，以便迁移数据）
          await dbPool.query(`
            ALTER TABLE email_config 
            ADD COLUMN app_id VARCHAR(19) NULL COMMENT '应用ID' AFTER id
          `);
          
          // 将所有记录的 app_id 设置为默认值
          await dbPool.query(
            'UPDATE email_config SET app_id = ? WHERE app_id IS NULL',
            [defaultAppId]
          );
          
          // 将 app_id 设置为 NOT NULL
          await dbPool.query(`
            ALTER TABLE email_config 
            MODIFY COLUMN app_id VARCHAR(19) NOT NULL COMMENT '应用ID'
          `);
          
          // 删除旧的 app_name 字段（如果存在）
          try {
            await dbPool.query('ALTER TABLE email_config DROP COLUMN app_name');
            // 已删除旧的 app_name 字段
          } catch (e) {
            console.warn('  删除 app_name 字段时出现警告:', e.message);
          }
        } else {
          console.warn('  警告：未找到"新闻舆情"应用，无法自动迁移数据');
          // 仍然添加字段，但允许NULL（需要手动处理数据）
          await dbPool.query(`
            ALTER TABLE email_config 
            ADD COLUMN app_id VARCHAR(19) NULL COMMENT '应用ID' AFTER id
          `);
        }
      } else {
        // 没有旧数据，需要先获取默认应用ID
        const [newsApp] = await dbPool.query(
          "SELECT id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1",
          ['新闻舆情']
        );
        
        if (newsApp.length > 0) {
          const defaultAppId = newsApp[0].id;
          // 先添加允许NULL的字段
          await dbPool.query(`
            ALTER TABLE email_config 
            ADD COLUMN app_id VARCHAR(19) NULL COMMENT '应用ID' AFTER id
          `);
          
          // 设置默认值（虽然表是空的，但为了保持一致性）
          // 然后改为NOT NULL
          await dbPool.query(`
            ALTER TABLE email_config 
            MODIFY COLUMN app_id VARCHAR(19) NOT NULL COMMENT '应用ID'
          `);
        } else {
          // 如果没有找到默认应用，添加允许NULL的字段（需要手动处理）
          console.warn('  警告：未找到"新闻舆情"应用，app_id 字段将允许NULL');
          await dbPool.query(`
            ALTER TABLE email_config 
            ADD COLUMN app_id VARCHAR(19) NULL COMMENT '应用ID' AFTER id
          `);
        }
      }
      
      // 确保删除旧的 app_name 字段（如果存在）
      try {
        const [appNameCols] = await dbPool.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'email_config' 
          AND COLUMN_NAME = 'app_name'
        `);
        if (appNameCols.length > 0) {
          await dbPool.query('ALTER TABLE email_config DROP COLUMN app_name');
          console.log('  已删除旧的 app_name 字段');
        }
      } catch (e) {
        console.warn('  删除 app_name 字段时出现警告:', e.message);
      }
      
      // 添加唯一索引
      try {
        await dbPool.query(`
          ALTER TABLE email_config 
          ADD UNIQUE KEY uk_app_id (app_id)
        `);
      } catch (e) {
        console.warn('  添加唯一索引时出现警告（可能已存在）:', e.message);
      }
      
      // 添加外键约束
      try {
        await dbPool.query(`
          ALTER TABLE email_config 
          ADD CONSTRAINT fk_email_config_app 
          FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
        `);
      } catch (e) {
        console.warn('  添加外键约束时出现警告（可能已存在）:', e.message);
      }
      
      // email_config 表迁移完成
    } else {
      // 即使 app_id 字段已存在，也检查并删除 app_name 字段（如果存在）
      try {
        const [appNameCols] = await dbPool.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'email_config' 
          AND COLUMN_NAME = 'app_name'
        `);
        if (appNameCols.length > 0) {
          await dbPool.query('ALTER TABLE email_config DROP COLUMN app_name');
          console.log('  已删除旧的 app_name 字段');
        }
      } catch (e) {
        console.warn('  删除 app_name 字段时出现警告:', e.message);
      }
    }

    // 检查并添加POP配置字段（如果不存在）
    const popFields = ['pop_host', 'pop_port', 'pop_secure', 'pop_user', 'pop_password'];
    for (const field of popFields) {
      try {
        const [cols] = await dbPool.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'email_config' 
          AND COLUMN_NAME = ?
        `, [field]);
        
        if (cols.length === 0) {
          let alterSql = '';
          if (field === 'pop_host') {
            alterSql = 'ALTER TABLE email_config ADD COLUMN pop_host VARCHAR(255) COMMENT \'POP服务器地址\' AFTER from_name';
          } else if (field === 'pop_port') {
            alterSql = 'ALTER TABLE email_config ADD COLUMN pop_port INT COMMENT \'POP端口\' AFTER pop_host';
          } else if (field === 'pop_secure') {
            alterSql = 'ALTER TABLE email_config ADD COLUMN pop_secure TINYINT(1) DEFAULT 0 COMMENT \'POP是否使用SSL/TLS：1-是，0-否\' AFTER pop_port';
          } else if (field === 'pop_user') {
            alterSql = 'ALTER TABLE email_config ADD COLUMN pop_user VARCHAR(255) COMMENT \'POP用户名（邮箱地址）\' AFTER pop_secure';
          } else if (field === 'pop_password') {
            alterSql = 'ALTER TABLE email_config ADD COLUMN pop_password VARCHAR(255) COMMENT \'POP密码或授权码\' AFTER pop_user';
          }
          
          if (alterSql) {
            await dbPool.query(alterSql);
            // 已添加字段
          }
        }
      } catch (e) {
        console.warn(`  添加 ${field} 字段时出现警告:`, e.message);
      }
    }
  } catch (err) {
    console.warn('  检查/迁移 email_config 表时出现警告:', err.message);
  }

  // email_logs 表：邮件收发日志
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS email_logs (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      email_config_id VARCHAR(19) NOT NULL COMMENT '邮件配置ID',
      operation_type ENUM('send', 'receive') NOT NULL COMMENT '操作类型：send-发送，receive-接收',
      from_email VARCHAR(255) COMMENT '发件人邮箱',
      to_email TEXT COMMENT '收件人邮箱（多个邮箱用逗号分隔）',
      cc_email TEXT COMMENT '抄送邮箱（多个邮箱用逗号分隔）',
      bcc_email TEXT COMMENT '密送邮箱（多个邮箱用逗号分隔）',
      subject VARCHAR(500) COMMENT '邮件主题',
      content TEXT COMMENT '邮件内容',
      status ENUM('success', 'failed') NOT NULL COMMENT '状态：success-成功，failed-失败',
      error_message TEXT COMMENT '错误信息（失败时记录）',
      created_by VARCHAR(19) COMMENT '操作人ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      INDEX idx_email_config_id (email_config_id),
      INDEX idx_operation_type (operation_type),
      INDEX idx_status (status),
      INDEX idx_created_at (created_at),
      FOREIGN KEY (email_config_id) REFERENCES email_config(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  
  // 迁移 recipient_management 表，将 recipient_email 字段从 VARCHAR 改为 TEXT
  try {
    const [columns] = await dbPool.query(`
      SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'recipient_management' 
      AND COLUMN_NAME = 'recipient_email'
    `);
    if (columns.length > 0 && columns[0].DATA_TYPE === 'varchar') {
      await dbPool.query(`
        ALTER TABLE recipient_management 
        MODIFY COLUMN recipient_email TEXT NOT NULL COMMENT '收件人邮箱（多个邮箱用逗号或换行分隔）'
      `);
      console.log('✓ 已更新 recipient_management 表的 recipient_email 字段为 TEXT 类型');
    }
  } catch (err) {
    console.warn('迁移 recipient_management 表时出现警告:', err.message);
  }

  // 迁移 recipient_management 表，添加删除相关字段
  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'recipient_management' 
      AND COLUMN_NAME IN ('deleted_at', 'deleted_by', 'is_deleted')
    `);
    const existingColumns = columns.map(col => col.COLUMN_NAME);
    
    if (!existingColumns.includes('deleted_at')) {
      await dbPool.query(`
        ALTER TABLE recipient_management 
        ADD COLUMN deleted_at TIMESTAMP NULL COMMENT '删除时间'
      `);
      // 已添加 recipient_management 表的 deleted_at 字段
    }
    
    if (!existingColumns.includes('deleted_by')) {
      await dbPool.query(`
        ALTER TABLE recipient_management 
        ADD COLUMN deleted_by VARCHAR(19) NULL COMMENT '删除人ID',
        ADD FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
      `);
      // 已添加 recipient_management 表的 deleted_by 字段
    }
    
    if (!existingColumns.includes('is_deleted')) {
      await dbPool.query(`
        ALTER TABLE recipient_management 
        ADD COLUMN is_deleted TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除'
      `);
      // 已添加 recipient_management 表的 is_deleted 字段
    }
  } catch (err) {
    console.warn('迁移 recipient_management 表删除字段时出现警告:', err.message);
  }

  // news_sync_execution_log 表：新闻同步执行日志
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS news_sync_execution_log (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      config_id VARCHAR(19) NOT NULL COMMENT '新闻接口配置ID',
      execution_type ENUM('manual', 'scheduled') NOT NULL COMMENT '执行类型：manual-手动触发，scheduled-定时任务',
      start_time TIMESTAMP NOT NULL COMMENT '开始执行时间',
      end_time TIMESTAMP NULL COMMENT '结束执行时间',
      duration_seconds INT COMMENT '执行耗时（秒）',
      status ENUM('success', 'failed', 'running') NOT NULL DEFAULT 'running' COMMENT '状态：success-成功，failed-失败，running-执行中',
      synced_count INT DEFAULT 0 COMMENT '同步的新闻数量',
      total_enterprises INT DEFAULT 0 COMMENT '处理的企业总数（企查查）或公众号总数（新榜）',
      processed_enterprises INT DEFAULT 0 COMMENT '实际处理的企业数量（企查查）或公众号数量（新榜）',
      error_count INT DEFAULT 0 COMMENT '错误数量',
      error_message TEXT COMMENT '错误信息（失败时记录）',
      execution_details JSON COMMENT '执行详情（时间范围、配置信息等）',
      created_by VARCHAR(19) COMMENT '操作人ID（手动触发时记录）',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      INDEX idx_config_id (config_id),
      INDEX idx_execution_type (execution_type),
      INDEX idx_status (status),
      INDEX idx_start_time (start_time),
      INDEX idx_created_at (created_at),
      FOREIGN KEY (config_id) REFERENCES news_interface_config(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // news_detail 表：公众号文章详情
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS news_detail (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      account_name VARCHAR(255) NOT NULL COMMENT '公众号名称',
      wechat_account VARCHAR(255) NOT NULL COMMENT '微信号',
      enterprise_full_name VARCHAR(255) COMMENT '被投企业全称',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（接口返回数据入库时间）',
      source_url VARCHAR(500) COMMENT '原文链接',
      title VARCHAR(500) COMMENT '图文标题',
      summary TEXT COMMENT '图文摘要',
      public_time DATETIME COMMENT '发布时间',
      content LONGTEXT COMMENT '正文',
      keywords JSON COMMENT '关键词（基于正文提取的关键词）',
      INDEX idx_wechat_account (wechat_account),
      INDEX idx_public_time (public_time),
      INDEX idx_created_at (created_at),
      INDEX idx_enterprise_full_name (enterprise_full_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);


  // additional_wechat_accounts 表：额外公众号数据源
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS additional_wechat_accounts (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      account_name VARCHAR(255) NOT NULL COMMENT '公众号名称',
      wechat_account_id VARCHAR(255) NOT NULL UNIQUE COMMENT '微信账号ID',
      status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态：active-生效，inactive-失效',
      creator_user_id VARCHAR(19) COMMENT '创建用户ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updater_user_id VARCHAR(19) COMMENT '更新用户ID',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      delete_mark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      delete_time DATETIME NULL COMMENT '删除时间',
      delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID',
      INDEX idx_wechat_account_id (wechat_account_id),
      INDEX idx_status (status),
      INDEX idx_delete_mark (delete_mark),
      FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updater_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (delete_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ai_model_config 表：AI模型配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ai_model_config (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      config_name VARCHAR(255) NOT NULL COMMENT '配置名称',
      provider VARCHAR(100) NOT NULL COMMENT '提供商：alibaba,openai,baidu,tencent等',
      model_name VARCHAR(255) NOT NULL COMMENT '模型名称',
      api_type VARCHAR(50) NOT NULL COMMENT 'API类型：chat,completion等',
      api_key TEXT NOT NULL COMMENT 'API密钥',
      api_endpoint VARCHAR(500) NOT NULL COMMENT 'API端点',
      temperature DECIMAL(3,2) DEFAULT 0.7 COMMENT '温度参数：0.0-2.0',
      max_tokens INT DEFAULT 2000 COMMENT '最大Token数',
      top_p DECIMAL(3,2) DEFAULT 1.0 COMMENT 'Top P参数：0.0-1.0',
      is_active TINYINT DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      application_type ENUM('news_analysis', 'general') DEFAULT 'news_analysis' COMMENT '应用类型',
      creator_user_id VARCHAR(19) COMMENT '创建用户ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updater_user_id VARCHAR(19) COMMENT '更新用户ID',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      delete_mark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      delete_time DATETIME NULL COMMENT '删除时间',
      delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID',
      INDEX idx_provider (provider),
      INDEX idx_application_type (application_type),
      INDEX idx_is_active (is_active),
      INDEX idx_delete_mark (delete_mark),
      FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updater_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (delete_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS holiday_calendar (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      holiday_date DATE NOT NULL COMMENT '日期',
      is_workday TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否工作日：1-是，0-否',
      workday_type VARCHAR(30) NOT NULL COMMENT '工作日类型：周末/调休/法定节假日/工作日',
      holiday_name VARCHAR(100) DEFAULT '' COMMENT '节日名称',
      created_by VARCHAR(19) COMMENT '创建人ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_by VARCHAR(19) COMMENT '修改人ID',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
      deleted_by VARCHAR(19) COMMENT '删除人ID',
      deleted_at DATETIME NULL COMMENT '删除时间',
      is_deleted TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      UNIQUE KEY uk_holiday_date (holiday_date),
      INDEX idx_is_workday (is_workday),
      INDEX idx_workday_type (workday_type),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // external_db_config 表：外部数据库配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS external_db_config (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      name VARCHAR(255) NOT NULL UNIQUE COMMENT '配置名称',
      db_type VARCHAR(20) NOT NULL DEFAULT 'mysql' COMMENT '数据库类型：mysql/postgresql',
      host VARCHAR(255) NOT NULL COMMENT '数据库主机',
      port INT NOT NULL DEFAULT 3306 COMMENT '数据库端口',
      \`user\` VARCHAR(255) NOT NULL COMMENT '数据库用户名',
      password VARCHAR(255) NOT NULL COMMENT '数据库密码',
      \`database\` VARCHAR(255) NOT NULL COMMENT '数据库名称',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      is_deleted TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      created_by VARCHAR(19) COMMENT '创建人ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_by VARCHAR(19) COMMENT '修改人ID',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
      deleted_by VARCHAR(19) COMMENT '删除人ID',
      deleted_at DATETIME NULL COMMENT '删除时间',
      INDEX idx_is_active (is_active),
      INDEX idx_is_deleted (is_deleted),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 为已存在的 external_db_config 表添加 db_type 字段（如果不存在）
  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'external_db_config' 
      AND COLUMN_NAME = 'db_type'
    `);
    
    if (columns.length === 0) {
      await dbPool.query(`
        ALTER TABLE external_db_config 
        ADD COLUMN db_type VARCHAR(20) NOT NULL DEFAULT 'mysql' COMMENT '数据库类型：mysql/postgresql' AFTER name
      `);
      // 将现有数据的 db_type 设置为 'mysql'
      await dbPool.query(`UPDATE external_db_config SET db_type = 'mysql' WHERE db_type IS NULL OR db_type = ''`);
      console.log('✓ 已为 external_db_config 表添加 db_type 字段');
    }
  } catch (err) {
    console.warn('检查/添加 db_type 字段时出现警告:', err.message);
  }

  // enterprise_sync_task 表：被投企业数据同步定时任务
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS enterprise_sync_task (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      db_config_id VARCHAR(19) NOT NULL COMMENT '外部数据库配置ID',
      sql_query TEXT NOT NULL COMMENT 'SQL查询语句',
      cron_expression VARCHAR(100) NOT NULL COMMENT 'Cron表达式，如：0 0 * * *',
      description VARCHAR(500) COMMENT '任务描述',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      last_execution_time DATETIME NULL COMMENT '最后执行时间',
      last_execution_status VARCHAR(20) DEFAULT 'pending' COMMENT '最后执行状态：success/failed/pending',
      last_execution_message TEXT COMMENT '最后执行结果消息',
      execution_count INT DEFAULT 0 COMMENT '执行次数',
      created_by VARCHAR(19) COMMENT '创建人ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_by VARCHAR(19) COMMENT '修改人ID',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
      INDEX idx_db_config_id (db_config_id),
      INDEX idx_is_active (is_active),
      INDEX idx_last_execution_time (last_execution_time),
      FOREIGN KEY (db_config_id) REFERENCES external_db_config(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 为已存在的 news_detail 表添加 enterprise_full_name 字段（如果不存在）
  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_detail' 
      AND COLUMN_NAME = 'enterprise_full_name'
    `);
    
    if (columns.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_detail 
        ADD COLUMN enterprise_full_name VARCHAR(255) COMMENT '被投企业全称' AFTER wechat_account
      `);
      // 已为 news_detail 表添加 enterprise_full_name 字段
    }
  } catch (err) {
    console.warn('检查/添加 enterprise_full_name 字段时出现警告:', err.message);
  }

  // 检查并添加 news_abstract 字段
  try {
    const [abstractColumns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_detail' 
      AND COLUMN_NAME = 'news_abstract'
    `);
    
    if (abstractColumns.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_detail 
        ADD COLUMN news_abstract TEXT COMMENT '新闻摘要（AI提取的关键信息）' AFTER content
      `);
      // 已为 news_detail 表添加 news_abstract 字段
    }
  } catch (err) {
    console.warn('检查/添加 news_abstract 字段时出现警告:', err.message);
  }

  // 检查并添加 news_sentiment 字段
  try {
    const [sentimentColumns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_detail' 
      AND COLUMN_NAME = 'news_sentiment'
    `);
    
    if (sentimentColumns.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_detail 
        ADD COLUMN news_sentiment ENUM('positive', 'neutral', 'negative') DEFAULT 'neutral' COMMENT '新闻情绪：positive-正面，neutral-中性，negative-负面' AFTER news_abstract
      `);
      // 已为 news_detail 表添加 news_sentiment 字段
    }
  } catch (err) {
    console.warn('检查/添加 news_sentiment 字段时出现警告:', err.message);
  }

  // 检查并添加删除相关字段
  try {
    const [deleteMarkColumns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_detail' 
      AND COLUMN_NAME = 'delete_mark'
    `);
    
    if (deleteMarkColumns.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_detail 
        ADD COLUMN delete_mark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER news_sentiment,
        ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除人ID' AFTER delete_mark,
        ADD COLUMN delete_time TIMESTAMP NULL COMMENT '删除时间' AFTER delete_user_id
      `);
      // 已为 news_detail 表添加删除相关字段
    }
  } catch (err) {
    console.warn('检查/添加删除相关字段时出现警告:', err.message);
  }

  // 检查并添加 APItype 字段
  try {
    const [apiTypeColumns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_detail' 
      AND COLUMN_NAME = 'APItype'
    `);
    
    if (apiTypeColumns.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_detail 
        ADD COLUMN APItype VARCHAR(50) NULL COMMENT '接口类型：新榜/企查查' AFTER delete_time
      `);
      // 已为 news_detail 表添加 APItype 字段
    }
  } catch (err) {
    console.warn('检查/添加 APItype 字段时出现警告:', err.message);
  }

  // 检查并添加 news_category 字段（企查查新闻类别中文）
  try {
    const [categoryColumns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_detail' 
      AND COLUMN_NAME = 'news_category'
    `);
    
    if (categoryColumns.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_detail 
        ADD COLUMN news_category VARCHAR(255) NULL COMMENT '新闻类别（中文，企查查接口返回的Category编码转换）' AFTER APItype
      `);
      console.log('  ✓ 已为 news_detail 表添加 news_category 字段');
    }
  } catch (err) {
    console.warn('检查/添加 news_category 字段时出现警告:', err.message);
  }

  // 为 users 表添加 role 字段（如果不存在）
  try {
    const [roleColumns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'users' 
      AND COLUMN_NAME = 'role'
    `);
    
    if (roleColumns.length === 0) {
      await dbPool.query(`
        ALTER TABLE users 
        ADD COLUMN role VARCHAR(20) DEFAULT 'user' COMMENT '用户角色：admin-管理员，user-普通用户' AFTER account_status
      `);
      // 已为 users 表添加 role 字段
    }
  } catch (err) {
    console.warn('检查/添加 role 字段时出现警告:', err.message);
  }

  console.log('  开始初始化基础数据...');
  try {
    const [apps] = await dbPool.query('SELECT COUNT(*) as count FROM applications');
    if (apps[0].count === 0) {
      console.log('  创建应用和会员等级数据...');
      
      // 直接生成ID，不查询表（因为表刚创建，肯定是空的）
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const prefix = `${year}${month}${day}${hours}${minutes}${seconds}`;
      
      // 生成应用ID（序列号从00001开始）
      const appId = `${prefix}00001`;
      console.log(`  生成应用ID: ${appId}`);
      await dbPool.execute('INSERT INTO applications (id, app_name) VALUES (?, ?)', [appId, '股权投资小工具锦集']);
      console.log('  应用数据插入成功');
      
      // 生成会员等级ID（序列号递增）
      const level1Id = `${prefix}00002`;
      const level2Id = `${prefix}00003`;
      const level3Id = `${prefix}00004`;
      console.log(`  生成会员等级ID: ${level1Id}, ${level2Id}, ${level3Id}`);
      
      await dbPool.execute('INSERT INTO membership_levels (id, level_name, validity_days, app_id) VALUES (?, ?, ?, ?)',
        [level1Id, '普通会员', 30, appId]);
      await dbPool.execute('INSERT INTO membership_levels (id, level_name, validity_days, app_id) VALUES (?, ?, ?, ?)',
        [level2Id, '高级会员', 90, appId]);
      await dbPool.execute('INSERT INTO membership_levels (id, level_name, validity_days, app_id) VALUES (?, ?, ?, ?)',
        [level3Id, 'VIP会员', 365, appId]);
      console.log('  ✓ 应用和会员等级数据创建完成');
    } else {
      console.log('  应用数据已存在，跳过创建');
    }
  } catch (err) {
    console.error('  初始化基础数据时出错:', err.message);
    console.error('  错误堆栈:', err.stack);
    throw err;
  }

  // 创建默认 admin 账号（如果不存在）
  try {
    // 检查并创建默认 admin 账号
    const bcrypt = require('bcrypt');
    const { generateId } = require('./utils/idGenerator');
    const [adminUsers] = await dbPool.query('SELECT id FROM users WHERE account = ?', ['admin']);
    if (adminUsers.length === 0) {
      const hashedPassword = await bcrypt.hash('wenchao', 10);
      const adminId = await generateId('users');
      console.log(`  生成admin用户ID: ${adminId}`);
      await dbPool.execute(
        'INSERT INTO users (id, account, phone, email, password, role, account_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [adminId, 'admin', '13800000000', 'admin@example.com', hashedPassword, 'admin', 'active']
      );
      // 已创建默认 admin 账号
    } else {
      console.log('  admin 账号已存在，跳过创建');
    }
  } catch (err) {
    console.warn('创建 admin 账号时出现警告:', err.message);
  }

  // 初始化企查查配置（如果不存在）
  // 检查并初始化企查查配置
  const [qichachaConfigs] = await dbPool.query('SELECT COUNT(*) as count FROM qichacha_config');
  if (qichachaConfigs[0].count === 0) {
    // 获取"新闻舆情"应用的ID（作为默认值）
    const [newsApp] = await dbPool.query(
      "SELECT id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1",
      ['新闻舆情']
    );
    
    if (newsApp.length > 0) {
      const defaultAppId = newsApp[0].id;
      // 直接生成ID，不查询表（因为表刚创建，肯定是空的）
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const prefix = `${year}${month}${day}${hours}${minutes}${seconds}`;
      const configId = `${prefix}00001`;
      
      await dbPool.execute(
        'INSERT INTO qichacha_config (id, app_id, qichacha_app_key, qichacha_secret_key, qichacha_daily_limit, interface_type) VALUES (?, ?, ?, ?, ?, ?)',
        [configId, defaultAppId, '', '', 100, '企业信息']
      );
      console.log('✓ 已初始化企查查配置');
    } else {
      console.warn('  警告：未找到"新闻舆情"应用，无法初始化企查查配置（这不是致命错误，可以稍后手动配置）');
    }
  } else {
    console.log('  企查查配置已存在，跳过初始化');
  }
  
  // 迁移qichacha_config表的唯一键约束（仅在需要时检查）
  try {
    // 快速检查：如果新的唯一键已存在且旧的唯一键不存在，则跳过检查
    const [quickCheck] = await dbPool.query(`
      SELECT CONSTRAINT_NAME 
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'qichacha_config' 
      AND CONSTRAINT_TYPE = 'UNIQUE'
      AND CONSTRAINT_NAME IN ('uk_app_id', 'uk_app_interface')
    `);
    
    const hasOldUk = quickCheck.some(c => c.CONSTRAINT_NAME === 'uk_app_id');
    const hasNewUk = quickCheck.some(c => c.CONSTRAINT_NAME === 'uk_app_interface');
    
    // 如果新的唯一键已存在且旧的唯一键不存在，说明已经正确配置，跳过检查
    if (hasNewUk && !hasOldUk) {
      // 已正确配置，无需检查
    } else {
      // 需要检查或迁移
      // 检查并更新qichacha_config表的唯一键约束
      // 检查interface_type字段是否存在
      const [checkInterfaceType] = await dbPool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'qichacha_config' 
        AND COLUMN_NAME = 'interface_type'
      `);
      
      if (checkInterfaceType.length > 0) {
        // interface_type字段存在，检查并更新唯一键
        // 检查旧的唯一键是否存在
        const [oldIndexes] = await dbPool.query(`
          SELECT CONSTRAINT_NAME 
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'qichacha_config' 
          AND CONSTRAINT_TYPE = 'UNIQUE'
          AND CONSTRAINT_NAME = 'uk_app_id'
        `);
        
        // 检查新的联合唯一键是否存在
        const [newIndexes] = await dbPool.query(`
          SELECT CONSTRAINT_NAME 
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'qichacha_config' 
          AND CONSTRAINT_TYPE = 'UNIQUE'
          AND CONSTRAINT_NAME = 'uk_app_interface'
        `);
        
        if (oldIndexes.length > 0 && newIndexes.length === 0) {
          // 旧唯一键存在，新唯一键不存在，需要迁移
          // 检测到旧的唯一键 uk_app_id，开始迁移
          try {
            await dbPool.query('ALTER TABLE qichacha_config DROP INDEX uk_app_id');
            console.log('  ✓ 已删除旧的唯一键 uk_app_id');
          } catch (err) {
            console.warn('  删除旧唯一键时出现警告:', err.message);
          }
          
          try {
            await dbPool.query('ALTER TABLE qichacha_config ADD UNIQUE KEY uk_app_interface (app_id, interface_type)');
            // 已添加新的联合唯一键 uk_app_interface
          } catch (err) {
            console.warn('  添加新唯一键时出现警告:', err.message);
          }
        } else if (oldIndexes.length > 0 && newIndexes.length > 0) {
          // 两个唯一键都存在，删除旧的
          // 检测到新旧唯一键同时存在，删除旧的唯一键
          try {
            await dbPool.query('ALTER TABLE qichacha_config DROP INDEX uk_app_id');
            console.log('  ✓ 已删除旧的唯一键 uk_app_id');
          } catch (err) {
            console.warn('  删除旧唯一键时出现警告:', err.message);
          }
        } else if (oldIndexes.length === 0 && newIndexes.length === 0) {
          // 两个唯一键都不存在，创建新的
          // 未检测到唯一键，创建新的联合唯一键
          try {
            await dbPool.query('ALTER TABLE qichacha_config ADD UNIQUE KEY uk_app_interface (app_id, interface_type)');
            // 已添加新的联合唯一键 uk_app_interface
          } catch (err) {
            console.warn('  添加新唯一键时出现警告:', err.message);
          }
        } else {
          console.log('  ✓ 唯一键约束已正确配置');
        }
      }
    }
  } catch (err) {
    console.warn('迁移qichacha_config唯一键约束时出现警告:', err.message);
  }

  // 迁移news_interface_config表的唯一键约束（仅在需要时检查）
  // 已禁用：此迁移逻辑每次启动都会执行，导致外键约束警告。外键约束已手动修复，不再需要每次启动都执行。
  /*
  try {
    // 快速检查：如果新的唯一键已存在且旧的唯一键不存在，则跳过检查
    const [quickCheck] = await dbPool.query(`
      SELECT CONSTRAINT_NAME 
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND CONSTRAINT_TYPE = 'UNIQUE'
      AND CONSTRAINT_NAME IN ('uk_app_id', 'uk_app_interface')
    `);
    
    const hasOldUk = quickCheck.some(c => c.CONSTRAINT_NAME === 'uk_app_id');
    const hasNewUk = quickCheck.some(c => c.CONSTRAINT_NAME === 'uk_app_interface');
    
    // 如果新的唯一键已存在且旧的唯一键不存在，说明已经正确配置，跳过检查
    if (hasNewUk && !hasOldUk) {
      // 已正确配置，无需检查
    } else {
      // 需要检查或迁移（静默处理，不输出详细日志）
      // 检查interface_type字段是否存在
      const [checkInterfaceType] = await dbPool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'news_interface_config' 
        AND COLUMN_NAME = 'interface_type'
      `);
      
      if (checkInterfaceType.length > 0) {
        // interface_type字段存在，检查并更新唯一键
        // 检查旧的唯一键是否存在
        const [oldIndexes] = await dbPool.query(`
          SELECT CONSTRAINT_NAME 
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'news_interface_config'
          AND CONSTRAINT_TYPE = 'UNIQUE'
          AND CONSTRAINT_NAME = 'uk_app_id'
        `);
        
        // 检查新的联合唯一键是否存在
        const [newIndexes] = await dbPool.query(`
          SELECT CONSTRAINT_NAME 
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'news_interface_config'
          AND CONSTRAINT_TYPE = 'UNIQUE'
          AND CONSTRAINT_NAME = 'uk_app_interface'
        `);
        
        // 移除所有唯一键约束，允许同一应用和接口类型有多个不同配置
        if (oldIndexes.length > 0) {
          // 删除旧的唯一键
          try {
            await dbPool.query('ALTER TABLE news_interface_config DROP INDEX uk_app_id');
          } catch (err) {
            // 静默处理错误
          }
        }
        
        if (newIndexes.length > 0) {
          // 删除新的联合唯一键（如果存在）
          try {
            // 先检查是否有外键依赖
            const [fkCheck] = await dbPool.query(`
              SELECT CONSTRAINT_NAME 
              FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
              WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME = 'news_interface_config' 
              AND REFERENCED_TABLE_NAME = 'applications'
              AND COLUMN_NAME = 'app_id'
            `);
            
            if (fkCheck.length > 0) {
              // 如果有外键，先删除外键
              const fkName = fkCheck[0].CONSTRAINT_NAME;
              await dbPool.query(`ALTER TABLE news_interface_config DROP FOREIGN KEY ${fkName}`);
            }
            
            await dbPool.query('ALTER TABLE news_interface_config DROP INDEX uk_app_interface');
            
            // 重新添加外键（不依赖唯一索引）
            if (fkCheck.length > 0) {
              await dbPool.query('ALTER TABLE news_interface_config ADD CONSTRAINT fk_news_interface_config_app_id FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE');
            }
          } catch (err) {
            // 静默处理错误
          }
        }
      }
    }
  } catch (err) {
    console.warn('迁移news_interface_config唯一键约束时出现警告:', err.message);
  }
  */
  
  console.log('✓ 所有数据库表结构初始化完成');
  } catch (error) {
    console.error('✗ 初始化数据库表结构时出错:', error.message);
    console.error('错误堆栈:', error.stack);
    throw error;
  }
}

async function init() {
  try {
    console.log('正在初始化数据库...');
    // 确保数据库存在
    await createDatabaseIfNeeded();
    // 创建数据库连接池
    pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4'
    });
    // 初始化数据库表结构
    await initializeTables(pool);
    // 创建新增字段的索引
    try {
      // 检查索引是否已存在
      const [indexes] = await pool.query(`
        SHOW INDEX FROM news_detail WHERE Key_name = 'idx_news_sentiment'
      `);
      
      if (indexes.length === 0) {
        await pool.query(`
          CREATE INDEX idx_news_sentiment ON news_detail(news_sentiment)
        `);
        // 已为 news_sentiment 字段创建索引
      } else {
        console.log('✓ news_sentiment 索引已存在');
      }
    } catch (err) {
      console.warn('创建 news_sentiment 索引时出现警告:', err.message);
    }

    console.log('✓ 数据库初始化完成');
  } catch (error) {
    console.error('数据库初始化过程中出错:', error.message);
    console.error('错误堆栈:', error.stack);
    throw error;
  }
}

const ready = init().catch((err) => {
  console.error('数据库初始化失败:', err.message);
  console.error('错误堆栈:', err.stack);
  if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('\n❌ MySQL 连接被拒绝！');
    console.error('请检查以下配置：');
    console.error('1. 确保 MySQL 服务已启动');
    console.error('2. 在项目根目录创建 .env 文件');
    console.error('3. 配置正确的数据库连接信息：');
    console.error('   DB_HOST=localhost');
    console.error('   DB_PORT=3306');
    console.error('   DB_USER=root');
    console.error('   DB_PASSWORD=你的MySQL密码');
    console.error('   DB_NAME=investment_tools');
    console.error('\n参考 README.md 中的数据库配置说明\n');
  }
  // 不立即退出，让服务器启动逻辑处理错误
  throw err;
});

async function query(sql, params) {
  await ready;
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function execute(sql, params) {
  await ready;
  const [result] = await pool.execute(sql, params);
  return result;
}

async function getConnection() {
  await ready;
  return pool.getConnection();
}

async function closePool() {
  if (!pool) return;
  await pool.end();
}

module.exports = {
  query,
  execute,
  getConnection,
  closePool
};
