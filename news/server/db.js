// 加载 .env 文件，但不覆盖已存在的环境变量（Docker 环境变量优先级更高）
require('dotenv').config({ override: false });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const {
  DB_HOST = 'localhost',
  DB_PORT = 3306,
  DB_USER = 'root',
  DB_PASSWORD = '',
  DB_NAME = 'investment_tools'
} = process.env;

let pool;

// 从 performance.sql 中解析各 b_* 表的列注释，缓存到内存中
let performanceCommentsCache = null;

function loadPerformanceComments() {
  if (performanceCommentsCache) return performanceCommentsCache;
  performanceCommentsCache = {};
  try {
    const sqlPath = path.join(__dirname, '../业绩看板应用/performance.sql');
    const content = fs.readFileSync(sqlPath, 'utf8');
    const tableRegex = /CREATE TABLE\s+`(b_[^`]+)`\s*\(([\s\S]*?)\)\s*ENGINE/gi;
    let tMatch;
    // 遍历所有 b_* 表的建表语句
    while ((tMatch = tableRegex.exec(content)) != null) {
      const table = tMatch[1];
      const body = tMatch[2];
      // 更稳健的列匹配：允许类型/默认值中包含逗号，只要在本列定义内遇到 COMMENT 即可
      const colRegex = /`([^`]+)`\s+([\s\S]*?)COMMENT\s+'([^']*)'/g;
      let cMatch;
      while ((cMatch = colRegex.exec(body)) != null) {
        const col = cMatch[1];
        const comment = cMatch[3] || '';
        if (!performanceCommentsCache[table]) performanceCommentsCache[table] = {};
        performanceCommentsCache[table][col] = comment;
      }
    }
  } catch (e) {
    // 读取或解析失败时，不影响主流程，只是不做注释同步
    performanceCommentsCache = {};
  }
  return performanceCommentsCache;
}

// 为已有的 b_* 表（除 b_sql、b_sql_change_log、b_indicator_describe 外）补齐列注释
async function ensureBTableComments(dbPool) {
  const commentDefs = loadPerformanceComments();
  if (!commentDefs || Object.keys(commentDefs).length === 0) return;

  const excludeTables = new Set(['b_sql', 'b_sql_change_log', 'b_indicator_describe']);

  try {
    const [cols] = await dbPool.query(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME LIKE 'b_%'
    `);

    for (const colInfo of cols || []) {
      const table = colInfo.TABLE_NAME;
      const col = colInfo.COLUMN_NAME;
      if (excludeTables.has(table)) continue;
      if (!commentDefs[table] || !commentDefs[table][col]) continue;
      const desiredComment = commentDefs[table][col];
      const currentComment = colInfo.COLUMN_COMMENT || '';
      if (currentComment && currentComment.trim().length > 0) continue; // 已有注释则跳过

      const type = colInfo.COLUMN_TYPE;
      const notNull = colInfo.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL';
      const def = colInfo.COLUMN_DEFAULT;
      const defaultSql = def !== null ? ` DEFAULT ${dbPool.escape(def)}` : '';
      const alterSql = `
        ALTER TABLE \`${table}\`
        MODIFY COLUMN \`${col}\` ${type} ${notNull}${defaultSql} COMMENT ${dbPool.escape(desiredComment)}
      `;
      try {
        await dbPool.query(alterSql);
      } catch (e) {
        // 单列失败不影响整体，同步时忽略
      }
    }
  } catch (e) {
    // 同步过程中整体失败时忽略，不阻塞启动
  }
}

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

  // shanghai_international_group_config 表：上海国际集团接口配置（类似qichacha_config）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS shanghai_international_group_config (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      app_id VARCHAR(19) NOT NULL COMMENT '应用ID',
      x_app_id VARCHAR(255) COMMENT 'X-App-Id：Ipass平台授权的消费方标识',
      api_key VARCHAR(255) COMMENT 'APIkey：消费方认证',
      daily_limit INT DEFAULT 100 COMMENT '每日查询限制次数',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_app_id (app_id),
      FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 迁移 news_sync_detail_log 表：添加上海国际集团到 interface_type ENUM
  try {
    await dbPool.query(`
      ALTER TABLE news_sync_detail_log 
      MODIFY COLUMN interface_type ENUM('新榜', '企查查', '上海国际集团') NOT NULL COMMENT '接口类型'
    `);
    console.log('✓ 已为 news_sync_detail_log 添加 上海国际集团 接口类型');
  } catch (err) {
    if (!err.message.includes('Duplicate column name') && !err.message.includes('check that it exists')) {
      console.warn('迁移 news_sync_detail_log interface_type 时出现警告:', err.message);
    }
  }

  // qichacha_news_categories 表：企查查新闻类别列表
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS qichacha_news_categories (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      category_code VARCHAR(50) NOT NULL UNIQUE COMMENT '类别编码',
      category_name VARCHAR(255) NOT NULL COMMENT '类别描述',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      INDEX idx_category_code (category_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 检查并初始化默认类别数据（如果表为空）
  try {
    const [existingCategories] = await dbPool.query('SELECT COUNT(*) as count FROM qichacha_news_categories');
    if (existingCategories[0].count === 0) {
      // 从qichachaCategoryMapper.js导入默认类别
      const defaultCategories = [
        { code: '00000', name: '其他' },
        { code: '1000', name: '高管信息' },
        { code: '10000', name: '信用预警' },
        { code: '10001', name: '承诺失信' },
        { code: '10002', name: '兑付/偿付不确定' },
        { code: '10003', name: '债券/债务违约' },
        { code: '10004', name: '中债隐含评级' },
        { code: '10005', name: '信用评级下调' },
        { code: '10006', name: '评级展望负面' },
        { code: '10007', name: '列入评级观察' },
        { code: '10008', name: '推迟评级' },
        { code: '10009', name: '责令改正' },
        { code: '10010', name: '信披问题' },
        { code: '1100', name: '高管违法' },
        { code: '11000', name: '管理相关' },
        { code: '11001', name: '高管变动' },
        { code: '11002', name: '股权激励' },
        { code: '11003', name: '员工持股计划' },
        { code: '1200', name: '高管变动' },
        { code: '12000', name: '经营相关' },
        { code: '12001', name: '经营业绩' },
        { code: '12002', name: '战略合作' },
        { code: '12003', name: '兼并收购' },
        { code: '12004', name: '股权质押' },
        { code: '12005', name: '增资募资' },
        { code: '12006', name: '投融资' },
        { code: '12007', name: '招投标' },
        { code: '12008', name: '资产重组' },
        { code: '12009', name: '对外投资' },
        { code: '12010', name: '利润分配' },
        { code: '12011', name: '接管托管' },
        { code: '12012', name: '生产产能' },
        { code: '12013', name: '关联交易' },
        { code: '12014', name: '产品信息' },
        { code: '12015', name: '项目签约' },
        { code: '12016', name: '税务注销登记' },
        { code: '12017', name: '新增分支机构/全资子公司' },
        { code: '12018', name: '参与公益' },
        { code: '12019', name: '纳税百强' },
        { code: '13000', name: '市场相关' },
        { code: '13001', name: '增持减持' },
        { code: '13002', name: '股份回购' },
        { code: '13003', name: '股权转让' },
        { code: '13004', name: '新股发行' },
        { code: '13005', name: '股价下跌' },
        { code: '13006', name: '大宗交易' },
        { code: '13007', name: '上市退市' },
        { code: '13008', name: '借壳保壳' },
        { code: '13009', name: '停复牌' },
        { code: '13010', name: '限售股解禁' },
        { code: '13011', name: '订单交易' },
        { code: '13012', name: '上市' },
        { code: '13013', name: '退市' },
        { code: '13014', name: '债券发行失败' },
        { code: '14000', name: '其他相关' },
        { code: '14001', name: '信贷业务' },
        { code: '14002', name: '股东大会' },
        { code: '14003', name: '评级信息' },
        { code: '14004', name: '荣誉奖项' },
        { code: '14005', name: '政策影响' },
        { code: '14006', name: '考察调研' },
        { code: '14007', name: '牌照' },
        { code: '14008', name: '专利' },
        { code: '14009', name: '公示公告' },
        { code: '14010', name: '会议相关' },
        { code: '14011', name: '比赛竞赛' },
        { code: '14012', name: '区块链' },
        { code: '14013', name: '竣工投用' },
        { code: '14014', name: '组织成立' },
        { code: '14015', name: '5G' },
        { code: '14016', name: '自动驾驶' },
        { code: '14017', name: '私募失联' },
        { code: '2000', name: '违法违纪' },
        { code: '20000', name: '财务预警' },
        { code: '20001', name: '财务造假' },
        { code: '20002', name: '审计意见' },
        { code: '20003', name: '担保预警' },
        { code: '20004', name: '资金风险' },
        { code: '20005', name: '计提坏账准备' },
        { code: '20006', name: '财报延期披露' },
        { code: '2100', name: '造假欺诈' },
        { code: '2200', name: '贪污受贿' },
        { code: '2300', name: '违纪违规' },
        { code: '2400', name: '垄断信息' },
        { code: '2500', name: '环保处罚' },
        { code: '2600', name: '安全事故' },
        { code: '2700', name: '司法纠纷' },
        { code: '2800', name: '侵权抄袭' },
        { code: '2900', name: '偷税漏税' },
        { code: '3000', name: '财务经营' },
        { code: '30000', name: '管理预警' },
        { code: '30001', name: '高层被查' },
        { code: '30002', name: '高管违法' },
        { code: '30003', name: '高管失联/无法履职' },
        { code: '30004', name: '贪污受贿' },
        { code: '30005', name: '裁员相关' },
        { code: '30006', name: '拖欠薪资' },
        { code: '30007', name: '员工罢工' },
        { code: '30008', name: '自杀猝死' },
        { code: '30009', name: '欠缴社保' },
        { code: '30010', name: '商业机密被泄露' },
        { code: '30011', name: '实控人变更' },
        { code: '3100', name: '上市退市' },
        { code: '3200', name: '亏损盈利' },
        { code: '3300', name: '投资融资' },
        { code: '3400', name: '收购重组' },
        { code: '3500', name: '停业破产' },
        { code: '3600', name: '股权变动' },
        { code: '3700', name: '增持减持' },
        { code: '3800', name: '债务抵押' },
        { code: '4000', name: '成果信誉' },
        { code: '40000', name: '经营预警' },
        { code: '40001', name: '停工停产' },
        { code: '40002', name: '生产事故' },
        { code: '40003', name: '拖欠货款' },
        { code: '40004', name: '偷税漏税' },
        { code: '40005', name: '资产出售' },
        { code: '40006', name: '诉讼纠纷' },
        { code: '40007', name: '股权冻结' },
        { code: '40008', name: '破产清算' },
        { code: '40009', name: '合作终止' },
        { code: '40010', name: '业绩下降' },
        { code: '40011', name: '垄断信息' },
        { code: '40012', name: '侵权抄袭' },
        { code: '40013', name: '环保问题' },
        { code: '40014', name: '资金挪用/占用' },
        { code: '40015', name: '经营失联(异常)' },
        { code: '40016', name: '减资/分立/合并' },
        { code: '40017', name: '资产查封/扣押/冻结' },
        { code: '40018', name: '合同纠纷' },
        { code: '40019', name: '客户投诉' },
        { code: '40020', name: '维权' },
        { code: '40021', name: '业绩亏损' },
        { code: '40022', name: '丧失经销商资质' },
        { code: '40023', name: '非法集资' },
        { code: '40024', name: '股东利益斗争' },
        { code: '40025', name: '体制改革' },
        { code: '40026', name: '竞争力份额下降' },
        { code: '40027', name: '环保信用行为排名' },
        { code: '40028', name: '关联方不利变化' },
        { code: '40029', name: '关联方人事变动' },
        { code: '40030', name: '重大经济损失' },
        { code: '5000', name: '产品相关' },
        { code: '50000', name: '监管预警' },
        { code: '50001', name: '监管关注' },
        { code: '50002', name: '监管谈话' },
        { code: '50003', name: '警示' },
        { code: '50004', name: '公开谴责' },
        { code: '50005', name: '通报批评' },
        { code: '50006', name: '市场禁入' },
        { code: '60000', name: '产品预警' },
        { code: '60001', name: '产品召回' },
        { code: '60002', name: '产品问题' },
        { code: '60003', name: '虚假宣传' },
        { code: '70000', name: '项目预警' },
        { code: '70001', name: '项目通报' },
        { code: '70002', name: '终止项目' },
        { code: '70003', name: '无证施工' },
        { code: '70004', name: '坍塌事故' },
        { code: '80000', name: '其他预警' },
        { code: '80001', name: '违法违规' },
        { code: '80002', name: '立案调查' },
        { code: '80003', name: '市/估值下降' },
        { code: '80004', name: '推迟/取消发行' },
        { code: '80005', name: '爆仓' },
        { code: '80006', name: '暴雷事件' },
        { code: '80007', name: '中毒事故' },
        { code: '80008', name: '其他' }
      ];

      const generateId = require('./utils/idGenerator').generateId;
      for (const category of defaultCategories) {
        const categoryId = await generateId('qichacha_news_categories');
        await dbPool.execute(
          'INSERT INTO qichacha_news_categories (id, category_code, category_name) VALUES (?, ?, ?)',
          [categoryId, category.code, category.name]
        );
      }
      console.log('✓ 已初始化企查查新闻类别默认数据');
    }
  } catch (err) {
    console.warn('初始化企查查新闻类别数据时出现警告:', err.message);
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

  // 迁移news_interface_config表，添加retry_count和retry_interval字段
  try {
    const [retryCountCheck] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'retry_count'
    `);
    if (retryCountCheck.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN retry_count INT DEFAULT 0 COMMENT \'未获取数据时的重新抓取次数，0表示不重试\'');
      // 已为 news_interface_config 表添加 retry_count 字段
    }
  } catch (err) {
    console.warn('迁移news_interface_config表retry_count字段时出现警告:', err.message);
  }

  try {
    const [retryIntervalCheck] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'retry_interval'
    `);
    if (retryIntervalCheck.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN retry_interval INT DEFAULT 0 COMMENT \'重新抓取间隔（单位：分钟）\'');
      // 已为 news_interface_config 表添加 retry_interval 字段
    }
  } catch (err) {
    console.warn('迁移news_interface_config表retry_interval字段时出现警告:', err.message);
  }

  // 迁移news_interface_config表，添加entity_type字段（JSON格式存储企业类型数组）
  try {
    const [entityTypeCheck] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'entity_type'
    `);
    if (entityTypeCheck.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN entity_type JSON COMMENT \'企业类型数组（JSON格式）：["被投企业","基金","子基金","子基金管理人","子基金GP"]，用于过滤需要抓取的企业信息\'');
      console.log('已为 news_interface_config 表添加 entity_type 字段');
    }
  } catch (err) {
    console.warn('迁移news_interface_config表entity_type字段时出现警告:', err.message);
  }

  // 迁移news_interface_config表，添加news_type字段（新闻类型）
  try {
    const [newsTypeCheck] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'news_type'
    `);
    if (newsTypeCheck.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN news_type VARCHAR(50) DEFAULT \'新闻舆情\' COMMENT \'新闻类型：新闻舆情、行政处罚、被执行人、失信被执行人、限制高消费、终本案件、破产重组、裁判文书、法院公告、开庭公告、送达公告、立案信息\'');
      await dbPool.query('UPDATE news_interface_config SET news_type = \'新闻舆情\' WHERE news_type IS NULL');
      console.log('已为 news_interface_config 表添加 news_type 字段');
    }
  } catch (err) {
    console.warn('迁移news_interface_config表news_type字段时出现警告:', err.message);
  }

  // interface_news_type_enabled 表：接口类型与新闻类型的启用关系（后续开发新类型时更新is_enabled）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS interface_news_type_enabled (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID',
      interface_type VARCHAR(50) NOT NULL COMMENT '接口类型：新榜/企查查/上海国际集团',
      news_type VARCHAR(50) NOT NULL COMMENT '新闻类型',
      is_enabled TINYINT(1) DEFAULT 0 COMMENT '是否已开发可选用：1-是，0-否',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_interface_news (interface_type, news_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  try {
    const [countResult] = await dbPool.query('SELECT COUNT(*) as cnt FROM interface_news_type_enabled');
    if (countResult[0].cnt === 0) {
      const allNewsTypes = ['新闻舆情', '行政处罚', '被执行人', '失信被执行人', '限制高消费', '终本案件', '破产重组', '裁判文书', '法院公告', '开庭公告', '送达公告', '立案信息'];
      let seq = 0;
      for (const interfaceType of ['新榜', '企查查', '上海国际集团']) {
        for (const newsType of allNewsTypes) {
          let isEnabled = newsType === '新闻舆情';
          if (interfaceType === '上海国际集团') {
            isEnabled = ['新闻舆情', '被执行人', '裁判文书'].includes(newsType);
          }
          const id = `${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}${String(++seq).padStart(5, '0')}`;
          await dbPool.query(
            'INSERT INTO interface_news_type_enabled (id, interface_type, news_type, is_enabled) VALUES (?, ?, ?, ?)',
            [id, interfaceType, newsType, isEnabled ? 1 : 0]
          );
        }
      }
      console.log('已初始化 interface_news_type_enabled 表数据');
    }
    // 迁移：为上海国际集团启用「被执行人」新闻类型（兼容已有库）
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 1 WHERE interface_type = '上海国际集团' AND news_type = '被执行人'`
    );
    // 迁移：上海国际集团下「行政处罚」已开发，设为可选
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 1 WHERE interface_type = '上海国际集团' AND news_type = '行政处罚'`
    );
    // 迁移：为上海国际集团启用「裁判文书」新闻类型
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 1 WHERE interface_type = '上海国际集团' AND news_type = '裁判文书'`
    );
    // 迁移：为上海国际集团启用「法院公告」新闻类型
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 1 WHERE interface_type = '上海国际集团' AND news_type = '法院公告'`
    );
    // 迁移：为上海国际集团启用「送达公告」新闻类型
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 1 WHERE interface_type = '上海国际集团' AND news_type = '送达公告'`
    );
    // 迁移：为上海国际集团启用「开庭公告」新闻类型
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 1 WHERE interface_type = '上海国际集团' AND news_type = '开庭公告'`
    );
    // 迁移：为上海国际集团启用「立案信息」新闻类型
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 1 WHERE interface_type = '上海国际集团' AND news_type = '立案信息'`
    );
    // 迁移：为上海国际集团新增并启用「破产重整」新闻类型
    const [hasBankrpt] = await dbPool.query(
      `SELECT 1 FROM interface_news_type_enabled WHERE interface_type = '上海国际集团' AND news_type = '破产重整' LIMIT 1`
    );
    if (hasBankrpt.length === 0) {
      const bankrptId = `${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}00001`;
      await dbPool.query(
        `INSERT INTO interface_news_type_enabled (id, interface_type, news_type, is_enabled) VALUES (?, '上海国际集团', '破产重整', 1)`,
        [bankrptId]
      );
      console.log('已为上海国际集团启用「破产重整」新闻类型');
    }
    // 迁移：上海国际集团、企查查接口中删除「破产重组」新闻类型选项（置为不可选）
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 0 WHERE interface_type IN ('上海国际集团', '企查查') AND news_type = '破产重组'`
    );
    console.log('已禁用上海国际集团、企查查接口下的「破产重组」新闻类型选项');
    // 迁移：为上海国际集团启用「失信被执行人」新闻类型
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 1 WHERE interface_type = '上海国际集团' AND news_type = '失信被执行人'`
    );
    console.log('已为上海国际集团启用「失信被执行人」新闻类型');
    // 迁移：为上海国际集团启用「限制高消费」新闻类型
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 1 WHERE interface_type = '上海国际集团' AND news_type = '限制高消费'`
    );
    console.log('已为上海国际集团启用「限制高消费」新闻类型');
    // 迁移：为上海国际集团启用「终本案件」新闻类型
    await dbPool.query(
      `UPDATE interface_news_type_enabled SET is_enabled = 1 WHERE interface_type = '上海国际集团' AND news_type = '终本案件'`
    );
    console.log('已为上海国际集团启用「终本案件」新闻类型');
    // 迁移：为上海国际集团新增并启用「同花顺订阅」新闻类型（仅上海国际集团可选，企业类型不参与接口参数）
    const [hasThs] = await dbPool.query(
      `SELECT 1 FROM interface_news_type_enabled WHERE interface_type = '上海国际集团' AND news_type = '同花顺订阅' LIMIT 1`
    );
    if (hasThs.length === 0) {
      const thsId = `${new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14)}00002`;
      await dbPool.query(
        `INSERT INTO interface_news_type_enabled (id, interface_type, news_type, is_enabled) VALUES (?, '上海国际集团', '同花顺订阅', 1)`,
        [thsId]
      );
      console.log('已为上海国际集团启用「同花顺订阅」新闻类型');
    }
  } catch (err) {
    console.warn('初始化 interface_news_type_enabled 表时出现警告:', err.message);
  }

  // 迁移news_interface_config表，添加cron_expression字段（Cron表达式）
  try {
    const [cronExprCheck] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'cron_expression'
    `);
    if (cronExprCheck.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN cron_expression VARCHAR(100) COMMENT \'Cron表达式（7位）：秒 分 时 日 月 周 年，用于定时任务调度\'');
      console.log('已为 news_interface_config 表添加 cron_expression 字段');
    }
  } catch (err) {
    console.warn('迁移news_interface_config表cron_expression字段时出现警告:', err.message);
  }

  // 迁移news_interface_config表，将frequency_type和frequency_value改为允许NULL（因为现在使用cron_expression）
  try {
    const [freqTypeCol] = await dbPool.query(`
      SELECT COLUMN_NAME, IS_NULLABLE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'frequency_type'
    `);
    if (freqTypeCol.length > 0 && freqTypeCol[0].IS_NULLABLE === 'NO') {
      await dbPool.query('ALTER TABLE news_interface_config MODIFY COLUMN frequency_type VARCHAR(20) NULL COMMENT \'频次类型：day-天，week-周，month-月（已废弃，使用cron_expression替代）\'');
      console.log('已修改 news_interface_config 表的 frequency_type 字段为允许 NULL');
    }
  } catch (err) {
    console.warn('修改news_interface_config表frequency_type字段时出现警告:', err.message);
  }

  try {
    const [freqValueCol] = await dbPool.query(`
      SELECT COLUMN_NAME, IS_NULLABLE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'frequency_value'
    `);
    if (freqValueCol.length > 0 && freqValueCol[0].IS_NULLABLE === 'NO') {
      await dbPool.query('ALTER TABLE news_interface_config MODIFY COLUMN frequency_value INT NULL COMMENT \'频次值（X天或X月）（已废弃，使用cron_expression替代）\'');
      console.log('已修改 news_interface_config 表的 frequency_value 字段为允许 NULL');
    }
  } catch (err) {
    console.warn('修改news_interface_config表frequency_value字段时出现警告:', err.message);
  }

  // 迁移 news_interface_config 表，添加 skip_holiday 字段（跳过节假日）
  try {
    const [skipHolidayCol] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_interface_config' 
      AND COLUMN_NAME = 'skip_holiday'
    `);
    if (skipHolidayCol.length === 0) {
      await dbPool.query('ALTER TABLE news_interface_config ADD COLUMN skip_holiday TINYINT(1) DEFAULT 0 COMMENT \'是否跳过节假日：1-跳过，0-不跳过\'');
      console.log('✓ 已添加 news_interface_config 表的 skip_holiday 字段');
    }
  } catch (err) {
    console.warn('迁移 news_interface_config 表 skip_holiday 字段时出现警告:', err.message);
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
      qichacha_category_codes JSON COMMENT '企查查新闻类别编码列表（JSON数组），为空时使用默认类别',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  
  // 检查并添加 qichacha_category_codes 字段（如果不存在）
  try {
    const [columns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'recipient_management' 
      AND COLUMN_NAME = 'qichacha_category_codes'
    `);
    
    if (columns.length === 0) {
      await dbPool.query(`
        ALTER TABLE recipient_management 
        ADD COLUMN qichacha_category_codes JSON COMMENT '企查查新闻类别编码列表（JSON数组），为空时使用默认类别'
      `);
      console.log('✓ 已添加 recipient_management 表的 qichacha_category_codes 字段');
      
      // 初始化现有数据：将默认类别同步到数据库（可选，如果需要的话）
      // 注意：这里不初始化，让现有记录使用默认类别（null值）
      // 如果需要初始化，可以取消下面的注释
      /*
      const defaultCategoryCodes = [
        '80000', '80001', '80002', '80003', '80004', '80005', '80006', '80007', '80008',
        '40000', '40001', '40002', '40003', '40004', '40005', '40006', '40007', '40008',
        '40009', '40010', '40011', '40012', '40013', '40014', '40015', '40016', '40017',
        '40018', '40019', '40020', '40021', '40022', '40023', '40024', '40025', '40026',
        '40027', '40028', '40029', '40030',
        '14004'
      ];
      const defaultCategoryCodesJson = JSON.stringify(defaultCategoryCodes);
      await dbPool.query(`
        UPDATE recipient_management 
        SET qichacha_category_codes = ?
        WHERE qichacha_category_codes IS NULL
      `, [defaultCategoryCodesJson]);
      console.log('✓ 已初始化现有收件管理记录的企查查类别编码为默认值');
      */
    }
  } catch (err) {
    console.warn('添加 qichacha_category_codes 字段时出现警告:', err.message);
  }

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

  // 迁移 email_logs 表：将 content 从 TEXT(64KB) 改为 MEDIUMTEXT(16MB)，避免邮件正文过长写入失败
  try {
    const [cols] = await dbPool.query(`
      SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_logs' AND COLUMN_NAME = 'content'
    `);
    if (cols.length > 0 && cols[0].DATA_TYPE === 'text' && cols[0].CHARACTER_MAXIMUM_LENGTH === 65535) {
      await dbPool.query(`
        ALTER TABLE email_logs 
        MODIFY COLUMN content MEDIUMTEXT COMMENT '邮件内容'
      `);
      console.log('✓ 已更新 email_logs 表的 content 字段为 MEDIUMTEXT 类型');
    }
  } catch (err) {
    console.warn('迁移 email_logs.content 时出现警告:', err.message);
  }
  
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

  // 检查并添加 entity_type 字段（如果不存在）
  try {
    const [entityTypeColumns] = await dbPool.query(`
      SELECT COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'recipient_management' 
      AND COLUMN_NAME = 'entity_type'
    `);
    
    if (entityTypeColumns.length === 0) {
      await dbPool.query(`
        ALTER TABLE recipient_management 
        ADD COLUMN entity_type JSON NULL COMMENT '企业类型：被投企业、子基金、子基金管理人、子基金GP（JSON数组，支持多选）'
      `);
      console.log('✓ 已添加 recipient_management 表的 entity_type 字段');
    } else if (entityTypeColumns[0].DATA_TYPE === 'varchar' || entityTypeColumns[0].DATA_TYPE === 'VARCHAR') {
      // 如果字段存在但是VARCHAR类型，需要迁移为JSON类型
      try {
        // 先将现有数据迁移：将单个值转换为JSON数组
        await dbPool.query(`
          UPDATE recipient_management 
          SET entity_type = CASE 
            WHEN entity_type IS NOT NULL AND entity_type != '' 
            THEN JSON_ARRAY(entity_type)
            ELSE NULL
          END
          WHERE entity_type IS NOT NULL
        `);
        
        // 修改字段类型为JSON
        await dbPool.query(`
          ALTER TABLE recipient_management 
          MODIFY COLUMN entity_type JSON NULL COMMENT '企业类型：被投企业、子基金、子基金管理人、子基金GP（JSON数组，支持多选）'
        `);
        console.log('✓ 已迁移 recipient_management 表的 entity_type 字段为JSON类型');
      } catch (migrateErr) {
        console.warn('迁移 entity_type 字段类型时出现警告:', migrateErr.message);
      }
    }
  } catch (err) {
    console.warn('迁移 recipient_management 表 entity_type 字段时出现警告:', err.message);
  }

  // 迁移 recipient_management 表，添加 cron_expression 字段（Cron表达式）
  try {
    const [cronExprCheck] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'recipient_management' 
      AND COLUMN_NAME = 'cron_expression'
    `);
    if (cronExprCheck.length === 0) {
      await dbPool.query('ALTER TABLE recipient_management ADD COLUMN cron_expression VARCHAR(100) COMMENT \'Cron表达式（7位）：秒 分 时 日 月 周 年，用于定时任务调度\'');
      console.log('✓ 已添加 recipient_management 表的 cron_expression 字段');
    }
  } catch (err) {
    console.warn('迁移 recipient_management 表 cron_expression 字段时出现警告:', err.message);
  }

  // 迁移 recipient_management 表，将 send_frequency 改为允许 NULL（因为现在使用 cron_expression）
  try {
    const [sendFreqCol] = await dbPool.query(`
      SELECT COLUMN_NAME, IS_NULLABLE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'recipient_management' 
      AND COLUMN_NAME = 'send_frequency'
    `);
    if (sendFreqCol.length > 0 && sendFreqCol[0].IS_NULLABLE === 'NO') {
      await dbPool.query('ALTER TABLE recipient_management MODIFY COLUMN send_frequency VARCHAR(20) NULL COMMENT \'发送频率：daily-每天，weekly-每周，monthly-每月（已废弃，使用cron_expression替代）\'');
      console.log('✓ 已修改 recipient_management 表的 send_frequency 字段为允许 NULL');
    }
  } catch (err) {
    console.warn('修改 recipient_management 表 send_frequency 字段时出现警告:', err.message);
  }

  // 迁移 recipient_management 表，添加 skip_holiday 字段（跳过节假日）
  try {
    const [skipHolidayCol] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'recipient_management' 
      AND COLUMN_NAME = 'skip_holiday'
    `);
    if (skipHolidayCol.length === 0) {
      await dbPool.query('ALTER TABLE recipient_management ADD COLUMN skip_holiday TINYINT(1) DEFAULT 0 COMMENT \'是否跳过节假日：1-跳过，0-不跳过\'');
      console.log('✓ 已添加 recipient_management 表的 skip_holiday 字段');
    }
  } catch (err) {
    console.warn('迁移 recipient_management 表 skip_holiday 字段时出现警告:', err.message);
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

  // news_sync_detail_log 表：新闻同步详细记录（每个公众号/企业的同步详情）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS news_sync_detail_log (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      sync_log_id VARCHAR(19) NOT NULL COMMENT '关联的同步执行日志ID',
      interface_type ENUM('新榜', '企查查') NOT NULL COMMENT '接口类型',
      account_id VARCHAR(255) NOT NULL COMMENT '公众号ID（新榜）或统一信用代码（企查查）',
      has_data TINYINT(1) DEFAULT 0 COMMENT '是否有数据返回：0-否，1-是',
      data_count INT DEFAULT 0 COMMENT '返回内容的条数',
      insert_success TINYINT(1) DEFAULT 0 COMMENT '是否成功入库：0-否，1-是',
      insert_count INT DEFAULT 0 COMMENT '成功入库的条数',
      error_message TEXT COMMENT '错误信息',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
      INDEX idx_sync_log_id (sync_log_id),
      INDEX idx_interface_type (interface_type),
      INDEX idx_account_id (account_id),
      INDEX idx_created_at (created_at),
      FOREIGN KEY (sync_log_id) REFERENCES news_sync_execution_log(id) ON DELETE CASCADE
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
      usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别',
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

  // ai_prompt_config 表：AI提示词配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ai_prompt_config (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      prompt_name VARCHAR(255) NOT NULL COMMENT '提示词名称',
      interface_type VARCHAR(50) NOT NULL COMMENT '新闻接口类型：新榜/企查查',
      prompt_type VARCHAR(50) NOT NULL COMMENT '提示词类型：sentiment_analysis-情绪分析, enterprise_relevance-企业关联分析, validation-关联验证',
      prompt_content LONGTEXT NOT NULL COMMENT '提示词内容',
      ai_model_config_id VARCHAR(19) NULL COMMENT '关联的AI模型配置ID',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      creator_user_id VARCHAR(19) COMMENT '创建用户ID',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updater_user_id VARCHAR(19) COMMENT '更新用户ID',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      delete_mark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      delete_time DATETIME NULL COMMENT '删除时间',
      delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID',
      INDEX idx_interface_type (interface_type),
      INDEX idx_prompt_type (prompt_type),
      INDEX idx_is_active (is_active),
      INDEX idx_delete_mark (delete_mark),
      INDEX idx_ai_model_config_id (ai_model_config_id),
      FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (updater_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (delete_user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  
  // 如果表已存在但没有 ai_model_config_id 字段，则添加外键约束（如果 ai_model_config 表存在）
  try {
    const [aiModelTables] = await dbPool.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'ai_model_config'
    `);
    
    if (aiModelTables.length > 0) {
      // 检查外键约束是否已存在
      const [fkCheck] = await dbPool.query(`
        SELECT CONSTRAINT_NAME 
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'ai_prompt_config' 
        AND REFERENCED_TABLE_NAME = 'ai_model_config'
        AND COLUMN_NAME = 'ai_model_config_id'
      `);
      
      if (fkCheck.length === 0) {
        // 检查字段是否存在
        const [columns] = await dbPool.query(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'ai_prompt_config' 
          AND COLUMN_NAME = 'ai_model_config_id'
        `);
        
        if (columns.length > 0) {
          // 字段存在但外键不存在，添加外键
          try {
            await dbPool.query(`
              ALTER TABLE ai_prompt_config 
              ADD CONSTRAINT fk_ai_prompt_config_model 
              FOREIGN KEY (ai_model_config_id) REFERENCES ai_model_config(id) ON DELETE SET NULL
            `);
            console.log('✓ 已为 ai_prompt_config 表添加 ai_model_config_id 外键约束');
          } catch (fkErr) {
            if (!fkErr.message.includes('Duplicate foreign key')) {
              console.warn('  添加外键约束时出现警告:', fkErr.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('检查 ai_prompt_config 外键约束时出现警告:', err.message);
  }

  // 迁移ai_prompt_config表，添加ai_model_config_id字段
  try {
    // 检查表是否存在
    const [tables] = await dbPool.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'ai_prompt_config'
    `);
    
    if (tables.length === 0) {
      console.log('  ai_prompt_config 表不存在，将在创建表时包含 ai_model_config_id 字段');
    } else {
      // 表存在，检查字段是否存在
      const [columns] = await dbPool.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'ai_prompt_config' 
        AND COLUMN_NAME = 'ai_model_config_id'
      `);
      
      if (columns.length === 0) {
        // 先添加字段和索引
        await dbPool.query(`
          ALTER TABLE ai_prompt_config 
          ADD COLUMN ai_model_config_id VARCHAR(19) NULL COMMENT '关联的AI模型配置ID'
        `);
        
        // 添加索引
        try {
          await dbPool.query(`
            ALTER TABLE ai_prompt_config 
            ADD INDEX idx_ai_model_config_id (ai_model_config_id)
          `);
        } catch (idxErr) {
          if (!idxErr.message.includes('Duplicate key name')) {
            console.warn('  添加索引时出现警告:', idxErr.message);
          }
        }
        
        // 检查 ai_model_config 表是否存在，如果存在则添加外键
        const [aiModelTables] = await dbPool.query(`
          SELECT TABLE_NAME 
          FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'ai_model_config'
        `);
        
        if (aiModelTables.length > 0) {
          try {
            await dbPool.query(`
              ALTER TABLE ai_prompt_config 
              ADD CONSTRAINT fk_ai_prompt_config_model 
              FOREIGN KEY (ai_model_config_id) REFERENCES ai_model_config(id) ON DELETE SET NULL
            `);
          } catch (fkErr) {
            if (!fkErr.message.includes('Duplicate foreign key')) {
              console.warn('  添加外键约束时出现警告:', fkErr.message);
            }
          }
        } else {
          console.warn('  ai_model_config 表不存在，跳过外键约束添加');
        }
        
        console.log('✓ 已为 ai_prompt_config 表添加 ai_model_config_id 字段');
      }
    }
  } catch (err) {
    console.warn('迁移 ai_prompt_config 表时出现警告:', err.message);
    if (err.stack) {
      console.warn('错误堆栈:', err.stack);
    }
  }

  // ai_prompt_change_log 表：AI提示词修改历史日志
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ai_prompt_change_log (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      prompt_config_id VARCHAR(19) NOT NULL COMMENT '提示词配置ID',
      change_type ENUM('create', 'update', 'delete', 'activate', 'deactivate') NOT NULL COMMENT '变更类型',
      old_value LONGTEXT COMMENT '旧值（JSON格式，包含所有字段）',
      new_value LONGTEXT COMMENT '新值（JSON格式，包含所有字段）',
      change_user_id VARCHAR(19) COMMENT '变更用户ID',
      change_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间',
      change_reason VARCHAR(500) COMMENT '变更原因',
      INDEX idx_prompt_config_id (prompt_config_id),
      INDEX idx_change_type (change_type),
      INDEX idx_change_time (change_time),
      FOREIGN KEY (prompt_config_id) REFERENCES ai_prompt_config(id) ON DELETE CASCADE,
      FOREIGN KEY (change_user_id) REFERENCES users(id) ON DELETE SET NULL
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

  // ========== 业绩看板应用（performance.sql）表结构，字段注释与 performance.sql 一致 ==========
  // b_all_indicator - 定开看板-管理人整体指标
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_all_indicator (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号',
      fund_inv INT NULL DEFAULT NULL COMMENT '子基金累计投资数量',
      lm_fund_inv INT NULL DEFAULT NULL COMMENT '上月累计子基金投资数量',
      fund_inv_change INT NULL DEFAULT NULL COMMENT '子基金累计投资数量变动',
      fund_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金累计认缴金额',
      lm_fund_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上月子基金累计认缴金额',
      fund_sub_change DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金累计认缴金额变动',
      fund_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金累计实缴金额',
      lm_fund_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上月子基金累计实缴金额',
      fund_paidin_change DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金累计实缴金额变动',
      fund_exit INT NULL DEFAULT NULL COMMENT '子基金累计退出数量',
      lm_fund_exit INT NULL DEFAULT NULL COMMENT '上月子基金累计退出数量',
      fund_exit_change INT NULL DEFAULT NULL COMMENT '子基金累计退出数量变动',
      fund_exit_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金累计退出金额',
      lm_fund_exit_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上月子基金累计退出金额',
      fund_exit_amount_change DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金累计退出金额变动',
      fund_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金累计回款金额',
      lm_fund_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上月子基金累计回款金额',
      fund_receive_change DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金累计回款金额变动',
      project_inv INT NULL DEFAULT NULL COMMENT '累计直投项目数量',
      lm_project_inv INT NULL DEFAULT NULL COMMENT '上月累计直投项目数量',
      project_inv_change INT NULL DEFAULT NULL COMMENT '累计直投项目数量变动',
      project_paidin DECIMAL(30,10) NULL DEFAULT 0 COMMENT '直投项目累计投资金额',
      lm_project_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上月直投项目累计投资金额',
      project_exit INT NULL DEFAULT NULL COMMENT '直投项目累计退出数量',
      lm_project_exit INT NULL DEFAULT NULL COMMENT '上月直投项目累计退出数量',
      project_exit_change INT NULL DEFAULT NULL COMMENT '直投项目累计退出数量变动',
      project_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投项目累计回款金额',
      lm_project_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上月直投项目累计回款金额',
      project_receive_change DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投项目累计回款金额变动',
      project_paidin_change DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投项目累计投资金额变动',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-管理人整体指标';
  `);
  // b_investment - 定开看板-基金投资组合明细
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_investment (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称-4',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-2',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-1',
      transaction_type VARCHAR(300) NULL DEFAULT NULL COMMENT '投资类别-6',
      acc_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴金额累计-9',
      change_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴金额本月变动-10',
      acc_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '实缴金额累计-11',
      change_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '实缴金额本月变动-12',
      acc_exit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '退出金额累计-13',
      change_exit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '退出金额本月变动-14',
      acc_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '回款金额累计-15',
      change_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '回款金额本月变动-16',
      project VARCHAR(300) NULL DEFAULT NULL COMMENT '项目名称-7',
      first_date DATETIME NULL DEFAULT NULL COMMENT '首次投资时间-8',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型-3',
      set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间-5',
      unrealized DECIMAL(30,10) NULL DEFAULT 0 COMMENT '未实现价值-17',
      change_unrealized DECIMAL(30,10) NULL DEFAULT 0 COMMENT '未实现价值变动-18',
      total_value DECIMAL(30,10) NULL DEFAULT NULL COMMENT '总价值-19',
      moc DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'MOC-20',
      dpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'DPI-21',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      acc_exit_profit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '累计退出收益-23',
      acc_exit_capital DECIMAL(30,10) NULL DEFAULT NULL COMMENT '累计退出成本-22',
      acc_dividend DECIMAL(30,10) NULL DEFAULT NULL COMMENT '其中:累计分红-24',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-基金投资组合明细';
  `);
  // b_investment_indicator
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_investment_indicator (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称',
      fund_inv INT NULL DEFAULT NULL COMMENT '子基金投资数量',
      fund_exit INT NULL DEFAULT NULL COMMENT '子基金退出数量',
      fund_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金认缴金额',
      fund_exit_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金退出金额',
      fund_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金实缴金额',
      fund_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金回款金额',
      project_inv INT NULL DEFAULT NULL COMMENT '直投项目投资数量',
      project_exit INT NULL DEFAULT NULL COMMENT '直投项目退出数量',
      project_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投项目实缴金额',
      project_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投项目回款金额',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型',
      set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-基金投资组合指标';
  `);
  // b_investment_sum
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_investment_sum (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-2',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-1',
      transaction_type VARCHAR(300) NULL DEFAULT NULL COMMENT '投资类别-3',
      acc_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴金额累计-5',
      change_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴金额本月变动-6',
      acc_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '实缴金额累计-7',
      change_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '实缴金额本月变动-8',
      acc_exit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '退出金额累计-9',
      change_exit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '退出金额本月变动-10',
      acc_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '回款金额累计-11',
      change_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '回款金额本月变动-12',
      project VARCHAR(300) NULL DEFAULT NULL COMMENT '项目名称-4',
      unrealized DECIMAL(30,10) NULL DEFAULT NULL COMMENT '未实现价值-13',
      change_unrealized DECIMAL(30,10) NULL DEFAULT 0 COMMENT '未实现价值变动-14',
      total_value DECIMAL(30,10) NULL DEFAULT NULL COMMENT '总价值-15',
      moc DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'MOC-16',
      dpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'DPI-17',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-基金投资组合明细汇总';
  `);
  // b_investor_list
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_investor_list (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-2',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-1',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称-3',
      lp VARCHAR(300) NULL DEFAULT NULL COMMENT '投资人名称-5',
      subscription_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴金额-6',
      subscription_ratio DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴比例-7',
      distribution DECIMAL(30,10) NULL DEFAULT NULL COMMENT '累计分配金额-9',
      paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '累计实缴金额-8',
      first_date DATETIME NULL DEFAULT NULL COMMENT '第N次分配时间-10',
      first_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '第N次分配金额-11',
      second_date DATETIME NULL DEFAULT NULL COMMENT '第N-1次分配时间-12',
      second_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '第N-1次分配金额-13',
      third_date DATETIME NULL DEFAULT NULL COMMENT '第N-2次分配时间-14',
      third_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '第N-2次分配金额-15',
      lp_type VARCHAR(300) NULL DEFAULT NULL COMMENT '投资人类型-4',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-投资人名录';
  `);
  // b_ipo
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_ipo (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-1',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-2',
      project VARCHAR(300) NULL DEFAULT NULL COMMENT '项目简称-5',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '所属基金-3',
      amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资金额-9',
      ipo_date DATETIME NULL DEFAULT NULL COMMENT '上市日期-08',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型-4',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      stock_name VARCHAR(300) NULL DEFAULT NULL COMMENT '股票简称-6',
      stock_num VARCHAR(300) NULL DEFAULT NULL COMMENT '股票代码-7',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-上市企业明细';
  `);
  // b_ipo_a
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_ipo_a (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-1',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-2',
      project VARCHAR(300) NULL DEFAULT NULL COMMENT '项目简称-5',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '所属基金-3',
      amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资金额-9',
      ipo_date DATETIME NULL DEFAULT NULL COMMENT '上市日期-8',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型-4',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      stock_num VARCHAR(300) NULL DEFAULT NULL COMMENT '股票代码-7',
      stock_name VARCHAR(300) NULL DEFAULT NULL COMMENT '股票简称-6',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-上市企业明细-累计';
  `);
  // b_manage
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_manage (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称-04',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型-03',
      sub_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴规模-06',
      paid_in_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '实缴规模-08',
      dis_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '累计分配金额-10',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-02',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-01',
      set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间-05',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      sub_add DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本年新增认缴-07',
      paid_in_add DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本年新增实缴-09',
      dis_add DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本年新增分配-11',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-管理规模';
  `);
  // b_manage_indicator
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_manage_indicator (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件',
      fof_num INT NULL DEFAULT NULL COMMENT '母基金数量',
      direct_num INT NULL DEFAULT NULL COMMENT '直投基金数量',
      sub_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '认缴管理规模',
      paid_in_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '实缴管理规模',
      dis_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '累计分配金额',
      sub_add DECIMAL(30,10) NULL DEFAULT 0 COMMENT '认缴规模较上年变动',
      paid_in_add DECIMAL(30,10) NULL DEFAULT 0 COMMENT '实缴规模较上年度变动',
      dis_add DECIMAL(30,10) NULL DEFAULT 0 COMMENT '累计分配总额较上年度变动',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-管理人指标显示';
  `);

  // b_project - 定开看板-底层资产明细
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_project (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称',
      company_num INT NULL DEFAULT NULL COMMENT '被投企业数量',
      ipo_num INT NULL DEFAULT NULL COMMENT '上市企业数量',
      csj_num INT NULL DEFAULT NULL COMMENT '长三角企业数量',
      total_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '总投资金额',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型',
      set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间',
      sh_num INT NULL DEFAULT NULL COMMENT '上海项目数量',
      ipo_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上市企业投资金额',
      project_num INT NULL DEFAULT NULL COMMENT '投资项目数量',
      sh_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上海项目投资金额',
      project_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '穿透投资金额',
      csj_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角地区投资金额',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-底层资产明细';
  `);
  // b_project_a
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_project_a (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称',
      company_num INT NULL DEFAULT NULL COMMENT '被投企业数量',
      total_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '总投资金额',
      ipo_num INT NULL DEFAULT NULL COMMENT '上市企业数量',
      ipo_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上市企业投资金额',
      project_num INT NULL DEFAULT NULL COMMENT '投资项目数量',
      project_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '穿透金额',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号',
      set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-底层资产明细-累计';
  `);
  // b_project_all - 定开看板-底层资产指标
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_project_all (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      company_num INT NULL DEFAULT NULL COMMENT '被投企业数量',
      lm_company_num INT NULL DEFAULT NULL COMMENT '上月被投企业数量',
      company_num_change INT NULL DEFAULT NULL COMMENT '被投企业数量变动',
      ipo_num INT NULL DEFAULT NULL COMMENT '上市企业数量',
      lm_ipo_num INT NULL DEFAULT NULL COMMENT '上月上市企业数量',
      ipo_num_change INT NULL DEFAULT NULL COMMENT '上市企业数量变动',
      csj_num INT NULL DEFAULT NULL COMMENT '长三角企业数量',
      lm_csj_num INT NULL DEFAULT NULL COMMENT '上月长三角企业数量',
      csj_num_change INT NULL DEFAULT NULL COMMENT '长三角企业数量变动',
      total_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '总投资金额',
      lm_total_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上月总投资金额',
      total_amount_change DECIMAL(30,10) NULL DEFAULT NULL COMMENT '总投资金额变动',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号',
      sh_num INT NULL DEFAULT NULL COMMENT '上海企业数量',
      lm_sh_num INT NULL DEFAULT NULL COMMENT '上月上海企业数量',
      sh_num_change INT NULL DEFAULT NULL COMMENT '上海企业数量变动',
      sh_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上海企业投资金额',
      csj_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角地区投资金额',
      ipo_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上市项目投资金额',
      company_num_a INT NULL DEFAULT NULL COMMENT '被投企业数量-累计',
      project_num INT NULL DEFAULT NULL COMMENT '项目数量',
      project_num_a INT NULL DEFAULT NULL COMMENT '项目数量-累计',
      total_amount_a DECIMAL(30,10) NULL DEFAULT 0 COMMENT '总投资金额-累计',
      ct_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '穿透金额',
      ct_amount_a DECIMAL(30,10) NULL DEFAULT 0 COMMENT '穿透金额-累计',
      ipo_num_a INT NULL DEFAULT NULL COMMENT '上市企业数量-累计',
      ipo_amount_a DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上市项目投资金额-累计',
      sh_num_a INT NULL DEFAULT NULL COMMENT '上海企业数量-累计',
      sh_amount_a DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上海企业投资金额-累计',
      csj_amount_a DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角地区投资金额-累计',
      csj_num_a INT NULL DEFAULT NULL COMMENT '长三角企业数量-累计',
      pd_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '浦东地区企业投资金额',
      pd_amount_a DECIMAL(30,10) NULL DEFAULT 0 COMMENT '浦东地区企业投资金额-累计',
      pd_num INT NULL DEFAULT NULL COMMENT '浦东地区投资数量',
      pd_num_a INT NULL DEFAULT NULL COMMENT '浦东地区投资数量-累计',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-底层资产指标';
  `);
  // b_region - 定开看板-区域企业明细
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_region (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型',
      set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间',
      csj_num INT NULL DEFAULT NULL COMMENT '长三角地区企业数量',
      csj_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角地区企业投资金额',
      sh_num INT NULL DEFAULT NULL COMMENT '上海地区企业数量',
      sh_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上海地区投资金额',
      pd_num INT NULL DEFAULT NULL COMMENT '浦东地区企业数量',
      pd_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '浦东地区投资金额',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      t_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '总投资金额',
      sh_num_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上海数量占比',
      sh_amount_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上海金额占比',
      csj_num_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角数量占比',
      csj_amount_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角金额占比',
      pd_num_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '浦东数量占比',
      pd_amount_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '浦东金额占比',
      t_num INT NULL DEFAULT NULL COMMENT '总项目数量',
      csj_amount_ct DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角地区金额_穿透',
      sh_amount_ct DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上海地区金额_穿透',
      pd_amount_ct DECIMAL(30,10) NULL DEFAULT 0 COMMENT '浦东地区金额_穿透',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-区域企业明细';
  `);
  // b_region_a
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_region_a (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型',
      set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间',
      csj_num INT NULL DEFAULT NULL COMMENT '长三角地区企业数量',
      csj_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角地区企业投资金额',
      sh_num INT NULL DEFAULT NULL COMMENT '上海地区企业数量',
      sh_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上海地区投资金额',
      pd_num INT NULL DEFAULT NULL COMMENT '浦东地区企业数量',
      pd_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '浦东地区投资金额',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      t_amount DECIMAL(30,10) NULL DEFAULT 0 COMMENT '总投资金额',
      sh_num_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上海数量占比',
      sh_amount_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '上海金额占比',
      csj_num_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角数量占比',
      csj_amount_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角金额占比',
      pd_num_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '浦东数量占比',
      pd_amount_ratio DECIMAL(30,10) NULL DEFAULT 0 COMMENT '浦东金额占比',
      t_num INT NULL DEFAULT NULL COMMENT '总项目数量',
      csj_amount_ct DECIMAL(30,10) NULL DEFAULT 0 COMMENT '长三角地区金额_穿透',
      sh_amount_ct DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上海地区金额_穿透',
      pd_amount_ct DECIMAL(30,10) NULL DEFAULT 0 COMMENT '浦东地区金额_穿透',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-区域企业明细-累计';
  `);
  // b_transaction - 定开看板-交易明细底表
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_transaction (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称-3',
      spv VARCHAR(300) NULL DEFAULT NULL COMMENT 'spv名称-5',
      sub_fund VARCHAR(300) NULL DEFAULT NULL COMMENT '子基金名称-6',
      company VARCHAR(300) NULL DEFAULT NULL COMMENT '被投企业名称-7',
      transaction_type VARCHAR(300) NULL DEFAULT NULL COMMENT '交易类型-8',
      transaction_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '交易金额-10',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-2',
      lp VARCHAR(300) NULL DEFAULT NULL COMMENT '投资人名称-4',
      transaction_date DATETIME NULL DEFAULT NULL COMMENT '交易时间-9',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-1',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      company_name VARCHAR(300) NULL DEFAULT NULL COMMENT '被投企业全称-16',
      sub_fund_name VARCHAR(300) NULL DEFAULT NULL COMMENT '子基金全称-17',
      capital DECIMAL(30,10) NULL DEFAULT NULL COMMENT '分配成本-11',
      profit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '分配收益-12',
      dividend DECIMAL(30,10) NULL DEFAULT NULL COMMENT '其中:分红-13',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-交易明细底表';
  `);
  // b_transaction_indicator - 定开看板-基金产品指标
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_transaction_indicator (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NOT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-2',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-1',
      inv_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资金额/实缴-14',
      moc DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'MOC-16',
      girr DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'GIRR-17',
      nirr DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'NIRR-12',
      paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资人实缴-7',
      distribution DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资人分配-8',
      dpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'DPI-10',
      rvpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'RVPI-11',
      tvpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'TVPI-9',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称-3',
      sub_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资金额/认缴-13',
      lp_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资人认缴-6',
      exit_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '退出金额-15',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型-4',
      set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间-5',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      d_moc DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投整体MOC-18',
      d_dpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投DPI-19',
      d_paid DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投实缴-20',
      d_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投回款-21',
      sf_moc DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金整体MOC-24',
      sf_dpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金DPI-25',
      sf_paid DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金实缴-26',
      sf_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金回款-27',
      d_unrealized DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投未实现价值-22',
      dt_value DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投总价值-23',
      sf_unrealized DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金未实现价值-28',
      sft_value DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金总价值-29',
      net_asset DECIMAL(30,10) NULL DEFAULT NULL COMMENT '资本账户-30',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-基金产品指标';
  `);
  // b_transaction_indicator 表若已存在则更新列注释（与 performance.sql 一致）
  try {
    const [rows] = await dbPool.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_transaction_indicator'
    `);
    if (rows.length > 0) {
      const alters = [
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN F_Id VARCHAR(50) NOT NULL COMMENT '主键'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN F_DeleteMark INT NOT NULL DEFAULT 0 COMMENT '删除状态'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-2'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-1'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN inv_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资金额/实缴-14'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN moc DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'MOC-16'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN girr DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'GIRR-17'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN nirr DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'NIRR-12'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资人实缴-7'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN distribution DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资人分配-8'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN dpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'DPI-10'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN rvpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'RVPI-11'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN tvpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'TVPI-9'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称-3'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN sub_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资金额/认缴-13'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN lp_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '投资人认缴-6'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN exit_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '退出金额-15'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型-4'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间-5'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN d_moc DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投整体MOC-18'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN d_dpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投DPI-19'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN d_paid DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投实缴-20'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN d_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投回款-21'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN sf_moc DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金整体MOC-24'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN sf_dpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金DPI-25'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN sf_paid DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金实缴-26'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN sf_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金回款-27'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN d_unrealized DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投未实现价值-22'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN dt_value DECIMAL(30,10) NULL DEFAULT NULL COMMENT '直投总价值-23'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN sf_unrealized DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金未实现价值-28'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN sft_value DECIMAL(30,10) NULL DEFAULT NULL COMMENT '子基金总价值-29'",
        "ALTER TABLE b_transaction_indicator MODIFY COLUMN net_asset DECIMAL(30,10) NULL DEFAULT NULL COMMENT '资本账户-30'"
      ];
      for (const sql of alters) {
        await dbPool.query(sql);
      }
    }
  } catch (e) { /* ignore */ }

  // b_version - 管理人看板版本管理
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_version (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理人看板版本管理';
  `);
  // b_indicator_describe - 管理人看板说明
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_indicator_describe (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_LastModifyUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '修改用户',
      F_LastModifyTime DATETIME NULL DEFAULT NULL COMMENT '修改时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      system_name TEXT NULL COMMENT '系统名称',
      manual_url TEXT NULL COMMENT '操作手册地址',
      redirect_url TEXT NULL COMMENT '页面跳转地址',
      fof_num_desc TEXT NULL COMMENT '母基金数量',
      direct_num_desc TEXT NULL COMMENT '直投基金数量',
      sub_amount_desc TEXT NULL COMMENT '认缴管理规模',
      paid_in_amount_desc TEXT NULL COMMENT '实缴管理规模',
      dis_amount_desc TEXT NULL COMMENT '累计分配总额',
      lp_sub_desc TEXT NULL COMMENT '投资人认缴',
      paidin_desc TEXT NULL COMMENT '投资人实缴',
      distribution_desc TEXT NULL COMMENT '投资人分配',
      tvpi_desc TEXT NULL COMMENT 'TVPI',
      dpi_desc TEXT NULL COMMENT 'DPI',
      rvpi_desc TEXT NULL COMMENT 'RVPI',
      nirr_desc TEXT NULL COMMENT 'NIRR',
      sub_amount_inv_desc TEXT NULL COMMENT '投资金额_认缴',
      inv_amount_desc TEXT NULL COMMENT '投资金额_实缴',
      exit_amount_desc TEXT NULL COMMENT '退出金额',
      girr_desc TEXT NULL COMMENT 'GIRR',
      moc_desc TEXT NULL COMMENT 'MOC',
      fund_inv_exit_desc TEXT NULL COMMENT '子基金_投_退数量',
      fund_sub_exit_desc TEXT NULL COMMENT '子基金_认缴_退出',
      fund_paidin_receive_desc TEXT NULL COMMENT '子基金_实缴_回款',
      project_inv_exit_desc TEXT NULL COMMENT '直投项目_投_退数量',
      project_paidin_receive_desc TEXT NULL COMMENT '直投项目_实缴_回款',
      fund_inv_acc_desc TEXT NULL COMMENT '子基金_累计投资数量',
      fund_sub_acc_desc TEXT NULL COMMENT '子基金_累计认缴金额',
      fund_paidin_acc_desc TEXT NULL COMMENT '子基金_累计实缴金额',
      fund_exit_acc_desc TEXT NULL COMMENT '子基金_累计退出数量',
      fund_exit_amount_acc_desc TEXT NULL COMMENT '子基金_累计退出金额',
      fund_receive_acc_desc TEXT NULL COMMENT '子基金_累计回款金额',
      project_inv_acc_desc TEXT NULL COMMENT '直投项目_累计投资数量',
      project_paidin_acc_desc TEXT NULL COMMENT '直投项目_累计投资金额',
      project_exit_acc_desc TEXT NULL COMMENT '直投项目_累计退出数量',
      project_exit_amount_acc_desc TEXT NULL COMMENT '直投项目_累计退出金额',
      project_receive_acc_desc TEXT NULL COMMENT '直投项目_累计回款金额',
      project_num_a_desc TEXT NULL COMMENT '累计组合_底层资产_数量',
      total_amount_a_desc TEXT NULL COMMENT '累计组合_底层资产_金额',
      ipo_num_a_desc TEXT NULL COMMENT '累计组合_上市企业',
      sh_num_a_desc TEXT NULL COMMENT '累计组合_上海地区企业',
      project_num_desc TEXT NULL COMMENT '当前组合_底层资产_数量',
      total_amount_desc TEXT NULL COMMENT '当前组合_底层资产_金额',
      ipo_num_desc TEXT NULL COMMENT '当前组合_上市企业',
      sh_num_desc TEXT NULL COMMENT '当前组合_上海地区企业',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='管理人看板说明';
  `);
  // b_indicator_describe 表若已存在则补充 F_LastModifyUserId、F_LastModifyTime 列（若缺失）
  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_indicator_describe' AND COLUMN_NAME = 'F_LastModifyUserId'
    `);
    if (cols.length === 0) {
      await dbPool.query(`ALTER TABLE b_indicator_describe ADD COLUMN F_LastModifyUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '修改用户' AFTER F_CreatorTime`);
      await dbPool.query(`ALTER TABLE b_indicator_describe ADD COLUMN F_LastModifyTime DATETIME NULL DEFAULT NULL COMMENT '修改时间' AFTER F_LastModifyUserId`);
    }
  } catch (e) { /* ignore */ }

  // b_indicator_describe 表若已存在则更新列注释（与 performance.sql 一致）
  try {
    const [rows] = await dbPool.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_indicator_describe'
    `);
    if (rows.length > 0) {
      const alters = [
        "ALTER TABLE b_indicator_describe MODIFY COLUMN F_Id VARCHAR(50) NOT NULL COMMENT '主键'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN F_LastModifyUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '修改用户'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN F_LastModifyTime DATETIME NULL DEFAULT NULL COMMENT '修改时间'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN system_name TEXT NULL COMMENT '系统名称'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN manual_url TEXT NULL COMMENT '操作手册地址'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN redirect_url TEXT NULL COMMENT '页面跳转地址'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN fof_num_desc TEXT NULL COMMENT '母基金数量'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN direct_num_desc TEXT NULL COMMENT '直投基金数量'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN sub_amount_desc TEXT NULL COMMENT '认缴管理规模'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN paid_in_amount_desc TEXT NULL COMMENT '实缴管理规模'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN dis_amount_desc TEXT NULL COMMENT '累计分配总额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN lp_sub_desc TEXT NULL COMMENT '投资人认缴'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN paidin_desc TEXT NULL COMMENT '投资人实缴'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN distribution_desc TEXT NULL COMMENT '投资人分配'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN tvpi_desc TEXT NULL COMMENT 'TVPI'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN dpi_desc TEXT NULL COMMENT 'DPI'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN rvpi_desc TEXT NULL COMMENT 'RVPI'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN nirr_desc TEXT NULL COMMENT 'NIRR'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN sub_amount_inv_desc TEXT NULL COMMENT '投资金额_认缴'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN inv_amount_desc TEXT NULL COMMENT '投资金额_实缴'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN exit_amount_desc TEXT NULL COMMENT '退出金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN girr_desc TEXT NULL COMMENT 'GIRR'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN moc_desc TEXT NULL COMMENT 'MOC'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN fund_inv_exit_desc TEXT NULL COMMENT '子基金_投_退数量'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN fund_sub_exit_desc TEXT NULL COMMENT '子基金_认缴_退出'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN fund_paidin_receive_desc TEXT NULL COMMENT '子基金_实缴_回款'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN project_inv_exit_desc TEXT NULL COMMENT '直投项目_投_退数量'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN project_paidin_receive_desc TEXT NULL COMMENT '直投项目_实缴_回款'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN fund_inv_acc_desc TEXT NULL COMMENT '子基金_累计投资数量'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN fund_sub_acc_desc TEXT NULL COMMENT '子基金_累计认缴金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN fund_paidin_acc_desc TEXT NULL COMMENT '子基金_累计实缴金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN fund_exit_acc_desc TEXT NULL COMMENT '子基金_累计退出数量'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN fund_exit_amount_acc_desc TEXT NULL COMMENT '子基金_累计退出金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN fund_receive_acc_desc TEXT NULL COMMENT '子基金_累计回款金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN project_inv_acc_desc TEXT NULL COMMENT '直投项目_累计投资数量'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN project_paidin_acc_desc TEXT NULL COMMENT '直投项目_累计投资金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN project_exit_acc_desc TEXT NULL COMMENT '直投项目_累计退出数量'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN project_exit_amount_acc_desc TEXT NULL COMMENT '直投项目_累计退出金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN project_receive_acc_desc TEXT NULL COMMENT '直投项目_累计回款金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN project_num_a_desc TEXT NULL COMMENT '累计组合_底层资产_数量'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN total_amount_a_desc TEXT NULL COMMENT '累计组合_底层资产_金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN ipo_num_a_desc TEXT NULL COMMENT '累计组合_上市企业'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN sh_num_a_desc TEXT NULL COMMENT '累计组合_上海地区企业'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN project_num_desc TEXT NULL COMMENT '当前组合_底层资产_数量'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN total_amount_desc TEXT NULL COMMENT '当前组合_底层资产_金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN ipo_num_desc TEXT NULL COMMENT '当前组合_上市企业'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN sh_num_desc TEXT NULL COMMENT '当前组合_上海地区企业'"
      ];
      for (const sql of alters) {
        await dbPool.query(sql);
      }
    }
  } catch (e) { /* ignore */ }

  // b_sql - 数据接口 SQL 配置（保留 F_LastModifyUserId/F_LastModifyTime 记录修改人与修改时间）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_sql (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_LastModifyUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '修改用户',
      F_LastModifyTime DATETIME NULL DEFAULT NULL COMMENT '修改时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      database_name VARCHAR(500) NULL DEFAULT NULL COMMENT '数据库选择',
      interface_name VARCHAR(500) NULL DEFAULT NULL COMMENT '接口名称',
      sql_content LONGTEXT NULL COMMENT '查询sql',
      exec_order INT NULL DEFAULT 0 COMMENT '执行顺序',
      external_db_config_id VARCHAR(50) NULL DEFAULT NULL COMMENT '外部数据库配置ID',
      target_table VARCHAR(300) NULL DEFAULT NULL COMMENT '目标表',
      remark VARCHAR(500) NULL DEFAULT NULL COMMENT '备注',
      PRIMARY KEY (F_Id), INDEX idx_exec_order (exec_order), INDEX idx_delete_mark (F_DeleteMark)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='业绩看板-数据接口SQL配置';
  `);
  // b_sql 表若已存在则补充 F_LastModifyUserId、F_LastModifyTime 列（若缺失）
  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_sql' AND COLUMN_NAME = 'F_LastModifyUserId'
    `);
    if (cols.length === 0) {
      await dbPool.query(`ALTER TABLE b_sql ADD COLUMN F_LastModifyUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '修改用户' AFTER F_CreatorTime`);
      await dbPool.query(`ALTER TABLE b_sql ADD COLUMN F_LastModifyTime DATETIME NULL DEFAULT NULL COMMENT '修改时间' AFTER F_LastModifyUserId`);
    }
  } catch (e) { /* ignore */ }

  // b_sql_change_log - 数据接口配置修改日志（记录每次修改的字段级变更）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_sql_change_log (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      b_sql_id VARCHAR(50) NOT NULL COMMENT 'b_sql配置ID',
      modify_time DATETIME NOT NULL COMMENT '修改时间',
      modify_user_id VARCHAR(50) NULL DEFAULT NULL COMMENT '修改用户id',
      changes_json TEXT NULL COMMENT '变更明细JSON：[{field,fieldLabel,oldVal,newVal}]',
      PRIMARY KEY (F_Id), INDEX idx_b_sql_id (b_sql_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='业绩看板-数据接口配置修改日志';
  `);

  // 业绩看板 b_* 表（除 b_sql、b_sql_change_log 外）：初始化时删除 F_LastModifyUserId、F_LastModifyTime 列（若存在）
  const [bTableRows] = await dbPool.query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'b_%'
  `);
  const excludeTables = ['b_sql', 'b_sql_change_log', 'b_indicator_describe'];
  for (const row of bTableRows || []) {
    const table = row.TABLE_NAME;
    if (excludeTables.includes(table)) continue;
    try {
      const [cols] = await dbPool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'F_LastModifyUserId'
      `, [table]);
      if (cols.length > 0) {
        await dbPool.query(`ALTER TABLE \`${table}\` DROP COLUMN F_LastModifyUserId`);
        await dbPool.query(`ALTER TABLE \`${table}\` DROP COLUMN F_LastModifyTime`);
      }
    } catch (e) {
      // 表不存在或列已不存在时忽略
    }
  }

  // 为已有的 b_* 表补齐列注释（除 b_sql、b_sql_change_log、b_indicator_describe 外）
  await ensureBTableComments(dbPool);

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

  // performance_scheduled 表：业绩看板定时任务配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS performance_scheduled (
      id VARCHAR(19) NOT NULL COMMENT '任务ID：年月日时分秒+5位自增序列',
      task_name VARCHAR(200) NULL DEFAULT NULL COMMENT '任务名称',
      app_name VARCHAR(200) NULL DEFAULT NULL COMMENT '应用名称，如：业绩看板应用',
      interface_type VARCHAR(50) NULL DEFAULT NULL COMMENT '接口类型：数据生成/数据清理/HTTP',
      request_url VARCHAR(500) NULL DEFAULT NULL COMMENT '请求URL',
      cron_expression VARCHAR(200) NULL DEFAULT NULL COMMENT 'Cron表达式（7字段Quartz格式）',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-停用',
      retry_count INT DEFAULT 0 COMMENT '重试次数',
      retry_interval INT DEFAULT 0 COMMENT '重试间隔（秒）',
      last_run_at DATETIME NULL DEFAULT NULL COMMENT '最后执行时间',
      last_run_status VARCHAR(20) NULL DEFAULT NULL COMMENT '最后执行状态：success/failed',
      remark VARCHAR(500) NULL DEFAULT NULL COMMENT '备注',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='业绩看板-定时任务配置';
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

  // 检查并添加 entity_type 字段（企业类型）
  try {
    const [entityTypeColumns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_detail' 
      AND COLUMN_NAME = 'entity_type'
    `);
    
    if (entityTypeColumns.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_detail 
        ADD COLUMN entity_type VARCHAR(50) NULL COMMENT '企业类型：被投企业、基金、子基金、子基金管理人、子基金GP' AFTER enterprise_full_name
      `);
      console.log('  ✓ 已为 news_detail 表添加 entity_type 字段');
    }
  } catch (err) {
    console.warn('检查/添加 entity_type 字段时出现警告:', err.message);
  }

  // 检查并添加 enterprise_abbreviation 字段（企业简称）
  try {
    const [abbreviationColumns] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'news_detail' 
      AND COLUMN_NAME = 'enterprise_abbreviation'
    `);
    
    if (abbreviationColumns.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_detail 
        ADD COLUMN enterprise_abbreviation VARCHAR(255) NULL COMMENT '企业简称（从invested_enterprises.project_abbreviation获取）' AFTER enterprise_full_name
      `);
      console.log('  ✓ 已为 news_detail 表添加 enterprise_abbreviation 字段');
    }
  } catch (err) {
    console.warn('检查/添加 enterprise_abbreviation 字段时出现警告:', err.message);
  }

  // 检查并添加 news_detail 表 fund、sub_fund 字段（对外接口与内部查询使用）
  for (const col of ['fund', 'sub_fund']) {
    try {
      const [cols] = await dbPool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'news_detail' AND COLUMN_NAME = ?
      `, [col]);
      if (cols.length === 0) {
        await dbPool.query(`
          ALTER TABLE news_detail ADD COLUMN ${col} VARCHAR(255) NULL COMMENT '${col === 'fund' ? '基金' : '子基金'}' AFTER entity_type
        `);
        console.log(`  ✓ 已为 news_detail 表添加 ${col} 字段`);
      }
    } catch (err) {
      console.warn(`检查/添加 news_detail.${col} 时出现警告:`, err.message);
    }
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

  // 为 users 表添加 api_token 字段（对外接口鉴权，每个用户一个长期有效 token）
  try {
    const [tokenColumns] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'api_token'
    `);
    if (tokenColumns.length === 0) {
      await dbPool.query(`
        ALTER TABLE users
        ADD COLUMN api_token VARCHAR(64) NULL UNIQUE COMMENT '对外API鉴权Token，用于 /api/news-detail 等接口' AFTER role,
        ADD COLUMN api_token_updated_at TIMESTAMP NULL COMMENT 'api_token 最近更新时间' AFTER api_token
      `);
      console.log('  ✓ 已为 users 表添加 api_token、api_token_updated_at 字段');
    }
  } catch (err) {
    console.warn('检查/添加 api_token 字段时出现警告:', err.message);
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
  
  // 迁移ai_model_config表，添加usage_type字段
  try {
    const [usageTypeCols] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'ai_model_config' 
      AND COLUMN_NAME = 'usage_type'
    `);
    
    if (usageTypeCols.length === 0) {
      await dbPool.query(`
        ALTER TABLE ai_model_config 
        ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition') DEFAULT 'content_analysis' COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别'
        AFTER application_type
      `);
      console.log('✓ 已为 ai_model_config 表添加 usage_type 字段');
    }
  } catch (err) {
    console.warn('迁移ai_model_config表usage_type字段时出现警告:', err.message);
  }
  
  // 创建舆情信息分享链接表
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS news_share_links (
      id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      user_id VARCHAR(19) NOT NULL COMMENT '创建用户ID',
      share_token VARCHAR(64) NOT NULL UNIQUE COMMENT '分享链接token',
      status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态：active-启用，inactive-禁用',
      has_expiry TINYINT(1) DEFAULT 0 COMMENT '是否有有效期：1-是，0-否',
      expiry_time DATETIME NULL COMMENT '有效期至',
      has_password TINYINT(1) DEFAULT 0 COMMENT '是否有密码：1-是，0-否',
      password_hash VARCHAR(255) NULL COMMENT '密码哈希值',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      INDEX idx_user_id (user_id),
      INDEX idx_share_token (share_token),
      INDEX idx_status (status),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 业绩看板分享：为 news_share_links 表添加 link_type、performance_version、can_export 字段（若不存在）
  try {
    const [linkTypeCol] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'news_share_links' AND COLUMN_NAME = 'link_type'
    `);
    if (linkTypeCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_share_links
        ADD COLUMN link_type VARCHAR(50) NULL DEFAULT 'news' COMMENT '链接类型：news-舆情分享，performance-业绩看板分享'
      `);
      console.log('✓ news_share_links 表已添加 link_type 字段');
    }
    const [perfVersionCol] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'news_share_links' AND COLUMN_NAME = 'performance_version'
    `);
    if (perfVersionCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_share_links
        ADD COLUMN performance_version VARCHAR(50) NULL COMMENT '业绩看板版本号'
      `);
      console.log('✓ news_share_links 表已添加 performance_version 字段');
    }
    const [canExportCol] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'news_share_links' AND COLUMN_NAME = 'can_export'
    `);
    if (canExportCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_share_links
        ADD COLUMN can_export TINYINT(1) DEFAULT 0 COMMENT '是否允许导出：1-是，0-否'
      `);
      console.log('✓ news_share_links 表已添加 can_export 字段');
    }
  } catch (err) {
    console.warn('迁移 news_share_links 表业绩看板字段时出现警告:', err.message);
  }

  console.log('✓ 所有数据库表结构初始化完成');
  
  // 初始化提示词配置（异步执行，不阻塞服务器启动）
  setImmediate(async () => {
    try {
      const { initPrompts } = require('./utils/initPrompts');
      await initPrompts();
    } catch (error) {
      console.warn('初始化提示词配置时出现警告:', error.message);
      if (error.stack) {
        console.warn('错误堆栈:', error.stack);
      }
    }
  });
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
