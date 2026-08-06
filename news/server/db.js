// 全系统默认北京时间（须在 dotenv 与其它模块加载前设置）
process.env.TZ = 'Asia/Shanghai';
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

/** 端口统一为数字，避免 .env 中写成字符串导致异常连接行为 */
const DB_PORT_NUM = parseInt(String(DB_PORT), 10) || 3306;

/**
 * 数据库初始化日志过滤：默认隐藏「表已就绪 / 字段注释 / 进度」类噪音，保留功能性里程碑与真实变更。
 * 需要全量排查时设 DB_INIT_VERBOSE=1。
 */
function shouldSuppressDbInitLog(args) {
  if (String(process.env.DB_INIT_VERBOSE || '').trim() === '1') return false;
  const s = args.map((a) => (typeof a === 'string' ? a : a == null ? '' : String(a))).join(' ');
  if (!s) return false;
  // 始终保留的关键节点 / 错误
  if (
    /正在初始化数据库|所有数据库表结构初始化完成|数据库初始化完成|数据库连接已就绪|初始化数据库表结构时出错|数据库初始化过程中出错|✗|错误堆栈/.test(
      s
    )
  ) {
    return false;
  }
  // 表就绪 / 注释 / 纯进度
  if (/表已就绪/.test(s)) return true;
  if (/字段注释|注释已检查|注释已补齐|空字段注释|列注释已检查|并更新注释/.test(s)) return true;
  if (/表结构已校验|表结构终检|批量字段重命名：无需迁移/.test(s)) return true;
  if (/→ 进度：|→ 正在校验并创建数据表|步骤很多，首次或迁移/.test(s)) return true;
  if (/→ 校验标准应用|→ 竞品分析|→ 归并历史|→ 统一各应用会员等级|开始初始化基础数据/.test(s)) return true;
  if (/会员等级已按.*统一|标准应用记录已校验|提示词已就绪|所有提示词配置已存在/.test(s)) return true;
  if (/admin 账号已存在，跳过|企查查配置已存在，跳过|默认接口配置已存在|索引已存在/.test(s)) return true;
  if (/已跳过（此前已完成）|已初始化 AI 模型名称字典|已初始化 AI 模型应用类型/.test(s)) return true;
  if (/已为 news_sync_detail_log 同步|已禁用上海国际集团|已为上海国际集团启用/.test(s)) return true;
  if (/正在等待数据库表结构初始化完成/.test(s)) return true;
  return false;
}

function installDbInitLogFilter() {
  if (String(process.env.DB_INIT_VERBOSE || '').trim() === '1') {
    return () => {};
  }
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args) => {
    if (shouldSuppressDbInitLog(args)) return;
    return origLog.apply(console, args);
  };
  console.warn = (...args) => {
    if (shouldSuppressDbInitLog(args)) return;
    return origWarn.apply(console, args);
  };
  return () => {
    console.log = origLog;
    console.warn = origWarn;
  };
}

let pool;

// 从 performance.sql 中解析各 b_* 表的列注释，缓存到内存中
let performanceCommentsCache = null;

function loadPerformanceComments() {
  if (performanceCommentsCache) return performanceCommentsCache;
  performanceCommentsCache = {};
  try {
    const sqlPath = path.join(__dirname, '../performance/performance.sql');
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

// 为核心业务表中「注释为空」的字段补齐标准注释（仅补空，不覆盖已有）
async function ensureCoreSchemaComments(dbPool) {
  const commentDefs = {
    applications: {
      app_name: '应用名称',
      F_CreatorTime: '创建时间'
    },
    b_investment_sum: {
      F_LastModifyTime: '最后修改时间'
    },
    b_ipo: {
      F_LastModifyTime: '最后修改时间'
    },
    base_dictionary: {
      F_CreatorTime: '创建时间',
      F_LastModifyTime: '更新时间'
    },
    interface_news_type_enabled: {
      F_CreatorTime: '创建时间',
      F_LastModifyTime: '更新时间'
    },
    invested_enterprises: {
      project_number: '项目编号',
      project_abbreviation: '项目简称',
      enterprise_full_name: '企业全称',
      unified_credit_code: '统一社会信用代码',
      wechat_official_account_id: '微信公众号ID',
      official_website: '公司官网',
      exit_status: '退出状态'
    },
    ipo_project_sql_sync_setting: {
      F_CreatorTime: '创建时间',
      F_LastModifyTime: '更新时间'
    },
    listing_data_config: {
      request_url: '请求地址',
      F_CreatorTime: '创建时间',
      F_LastModifyTime: '更新时间'
    },
    listing_share_links: {
      share_token: '分享令牌',
      has_expiry: '是否启用过期时间',
      expiry_time: '过期时间',
      has_password: '是否启用访问密码',
      password_hash: '访问密码哈希',
      F_CreatorTime: '创建时间',
      F_LastModifyTime: '更新时间'
    },
    listing_sync_execution_log: {
      F_CreatorTime: '创建时间',
      F_LastModifyTime: '更新时间'
    },
    membership_levels: {
      level_name: '会员等级名称',
      validity_days: '有效期天数',
      activation_date: '生效日期',
      F_CreatorTime: '创建时间'
    },
    system_config: {
      F_CreatorTime: '创建时间',
      F_LastModifyTime: '更新时间'
    },
    system_file_storage: {
      F_CreatorTime: '创建时间',
      F_LastModifyTime: '更新时间'
    },
    users: {
      account: '账号',
      phone: '手机号',
      email: '邮箱',
      password: '密码（哈希）',
      company_name: '公司名称',
      account_status: '账号状态',
      membership_level_id: '会员等级ID',
      app_permissions: '应用权限列表（JSON）',
      F_CreatorTime: '创建时间',
      F_LastModifyTime: '更新时间'
    }
  };

  const tableNames = Object.keys(commentDefs);
  if (tableNames.length === 0) return;

  const placeholders = tableNames.map(() => '?').join(',');

  try {
    const [cols] = await dbPool.query(
      `
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT, EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${placeholders})
      `,
      tableNames
    );

    let fixedCount = 0;
    for (const colInfo of cols || []) {
      const table = colInfo.TABLE_NAME;
      const col = colInfo.COLUMN_NAME;
      const targetComment = commentDefs[table] && commentDefs[table][col];
      if (!targetComment) continue;

      const currentComment = (colInfo.COLUMN_COMMENT || '').trim();
      if (currentComment) continue;

      const type = colInfo.COLUMN_TYPE;
      const nullableSql = colInfo.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL';
      const extraRaw = String(colInfo.EXTRA || '').trim();
      const extraUpper = extraRaw.toUpperCase();

      let defaultSql = '';
      if (colInfo.COLUMN_DEFAULT !== null) {
        const defStr = String(colInfo.COLUMN_DEFAULT).trim();
        const defUpper = defStr.toUpperCase();
        if (defUpper === 'CURRENT_TIMESTAMP' || defUpper === 'CURRENT_TIMESTAMP()' || defUpper.startsWith('CURRENT_TIMESTAMP(')) {
          defaultSql = ` DEFAULT ${defStr}`;
        } else {
          defaultSql = ` DEFAULT ${dbPool.escape(colInfo.COLUMN_DEFAULT)}`;
        }
      }

      let extraSql = '';
      if (extraUpper.includes('AUTO_INCREMENT')) {
        extraSql += ' AUTO_INCREMENT';
      }
      if (extraUpper.includes('ON UPDATE')) {
        const onUpdateExpr = extraRaw
          .replace(/.*on update\s+/i, '')
          .trim();
        extraSql += ` ON UPDATE ${onUpdateExpr || 'CURRENT_TIMESTAMP'}`;
      }

      const alterSql = `
        ALTER TABLE \`${table}\`
        MODIFY COLUMN \`${col}\` ${type} ${nullableSql}${defaultSql}${extraSql} COMMENT ${dbPool.escape(targetComment)}
      `;

      try {
        await dbPool.query(alterSql);
        fixedCount++;
      } catch (err) {
        console.warn(`补齐注释失败 ${table}.${col}:`, err.message);
      }
    }

    if (fixedCount > 0) {
      console.log(`✓ 已补齐 ${fixedCount} 个空字段注释`);
    } else {
      console.log('✓ 字段注释检查完成（无需补齐）');
    }
  } catch (err) {
    console.warn('补齐核心表字段注释时出现警告:', err.message);
  }
}

async function createDatabaseIfNeeded() {
  try {
    const connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT_NUM,
      user: DB_USER,
      password: DB_PASSWORD,
      connectTimeout: 20000
    });
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.end();
    // 不再单独输出日志，合并到初始化流程中
  } catch (err) {
    const detail =
      [
        err.code,
        err.errno,
        err.sqlState,
        err.sqlMessage,
        err.syscall,
        err.address != null && err.port != null ? `${err.address}:${err.port}` : null,
        err.message
      ]
        .filter(Boolean)
        .join(' | ') || '(无详细消息)';
    console.error('✗ 数据库连接失败:', detail);
    console.error(
      `   尝试连接: host=${DB_HOST} port=${DB_PORT_NUM} user=${DB_USER} database(将创建): ${DB_NAME}`
    );
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('提示：用户名或密码错误，请检查 .env 文件中的 DB_USER 和 DB_PASSWORD');
      console.error('当前配置 - 用户:', DB_USER, '密码:', DB_PASSWORD ? '***已设置***' : '***未设置***');
    } else if (err.code === 'ECONNREFUSED') {
      console.error('提示：连接被拒绝。请确认本机 MySQL 已启动，且端口与 DB_PORT 一致（默认 3306）。');
      console.error('      Windows 可在「服务」中查看 MySQL 是否正在运行；或用 `mysql -h 127.0.0.1 -P 3306 -u root -p` 测试。');
    } else if (err.code === 'ENOTFOUND') {
      console.error('提示：无法解析 DB_HOST，请检查 .env 中 DB_HOST 是否拼写正确（如 localhost 或 127.0.0.1）。');
    } else if (err.code === 'ETIMEDOUT') {
      console.error('提示：连接超时，请检查 DB_HOST/DB_PORT 是否可达、防火墙是否放行。');
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

/**
 * 统一软删除字段：delete_mark / delete_time / delete_user_id；
 * 兼容旧库 is_deleted / deleted_at / deleted_by；
 * 项目挖掘赛道表与 sourcing_financing_event：is_deleted 列更名为 delete_mark。
 */
async function migrateSoftDeleteToDeleteMarkConvention(dbPool) {
  async function tableCols(table) {
    const [r] = await dbPool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    return (r || []).map((x) => x.COLUMN_NAME);
  }
  async function dropFkForColumn(table, column) {
    const [r] = await dbPool.query(
      `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
       AND REFERENCED_TABLE_NAME IS NOT NULL`,
      [table, column]
    );
    for (const row of r || []) {
      try {
        await dbPool.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``);
      } catch (e) {
        /* ignore */
      }
    }
  }
  async function addFkDeleteUser(table, colName = 'delete_user_id') {
    try {
      await dbPool.query(
        `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${table}_fk_del_user\` FOREIGN KEY (\`${colName}\`) REFERENCES users(F_Id) ON DELETE SET NULL`
      );
    } catch (e) {
      /* ignore duplicate */
    }
  }

  const tripleTables = ['holiday_calendar', 'external_db_config', 'news_interface_config', 'recipient_management'];
  for (const t of tripleTables) {
    try {
      let cols = await tableCols(t);
      if (!cols.length) continue;

      if (cols.includes('is_deleted')) {
        if (!cols.includes('delete_mark') && !cols.includes('F_DeleteMark')) {
          await dbPool.query(
            `ALTER TABLE \`${t}\` ADD COLUMN delete_mark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除'`
          );
        }
        if (!cols.includes('delete_time') && !cols.includes('F_DeleteTime')) {
          await dbPool.query(`ALTER TABLE \`${t}\` ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间'`);
        }
        if (!cols.includes('delete_user_id') && !cols.includes('F_DeleteUserId')) {
          await dbPool.query(`ALTER TABLE \`${t}\` ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID'`);
        }
        const dmCol = cols.includes('F_DeleteMark') ? 'F_DeleteMark' : 'delete_mark';
        const dtCol = cols.includes('F_DeleteTime') ? 'F_DeleteTime' : 'delete_time';
        const duCol = cols.includes('F_DeleteUserId') ? 'F_DeleteUserId' : 'delete_user_id';
        await dbPool.query(
          `UPDATE \`${t}\` SET \`${dmCol}\` = IFNULL(is_deleted,0), \`${dtCol}\` = deleted_at, \`${duCol}\` = deleted_by`
        );
        await dropFkForColumn(t, 'deleted_by');
        for (const c of ['is_deleted', 'deleted_at', 'deleted_by']) {
          if (cols.includes(c)) {
            try {
              await dbPool.query(`ALTER TABLE \`${t}\` DROP COLUMN \`${c}\``);
            } catch (e) {
              /* ignore */
            }
          }
        }
        cols = await tableCols(t);
      }

      if (!cols.includes('delete_mark') && !cols.includes('F_DeleteMark')) {
        await dbPool.query(
          `ALTER TABLE \`${t}\` ADD COLUMN delete_mark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除'`
        );
      }
      if (!cols.includes('delete_time') && !cols.includes('F_DeleteTime')) {
        await dbPool.query(`ALTER TABLE \`${t}\` ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间'`);
      }
      if (!cols.includes('delete_user_id') && !cols.includes('F_DeleteUserId')) {
        await dbPool.query(`ALTER TABLE \`${t}\` ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID'`);
      }
      addFkDeleteUser(t, cols.includes('F_DeleteUserId') ? 'F_DeleteUserId' : 'delete_user_id');
    } catch (err) {
      console.warn(`迁移 ${t} delete_mark 字段时出现警告:`, err.message);
    }
  }

  const renameTrackTables = ['sourcing_track', 'sourcing_track_lv1', 'sourcing_track_lv2', 'sourcing_track_lv3'];
  for (const t of renameTrackTables) {
    try {
      const cols = await tableCols(t);
      if (cols.includes('is_deleted') && !cols.includes('delete_mark') && !cols.includes('F_DeleteMark')) {
        await dbPool.query(
          `ALTER TABLE \`${t}\` CHANGE COLUMN is_deleted delete_mark TINYINT NOT NULL DEFAULT 0 COMMENT '删除标记：0未删除，1已删除'`
        );
      }
    } catch (err) {
      console.warn(`重命名 ${t}.is_deleted 时出现警告:`, err.message);
    }
  }

  try {
    const cols = await tableCols('sourcing_financing_event');
    if (cols.includes('is_deleted') && !cols.includes('delete_mark') && !cols.includes('F_DeleteMark')) {
      await dbPool.query(
        `ALTER TABLE sourcing_financing_event CHANGE COLUMN is_deleted delete_mark TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删除，1已删除'`
      );
    }
  } catch (err) {
    console.warn('重命名 sourcing_financing_event.is_deleted 时出现警告:', err.message);
  }
}

/**
 * 将单表旧系统字段重命名为 F_ 规范（幂等）。
 * @returns {Promise<number>} 成功重命名的列数
 */
async function applyTableColumnRenames(dbPool, table, renames) {
  let renamed = 0;
  for (const { old: oldCol, new: newCol } of renames) {
    try {
      const [cols] = await dbPool.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, oldCol]
      );
      if (cols.length === 0) continue;

      const [newExists] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, newCol]
      );
      if (newExists.length > 0) continue;

      const c = cols[0];
      let colDef = c.COLUMN_TYPE;
      if (c.EXTRA === 'auto_increment') {
        colDef += ' NOT NULL AUTO_INCREMENT';
      } else {
        colDef += c.IS_NULLABLE === 'NO' ? ' NOT NULL' : ' NULL';
        if (c.COLUMN_DEFAULT !== null) {
          if (['CURRENT_TIMESTAMP', 'current_timestamp()'].includes(c.COLUMN_DEFAULT)) {
            colDef += ' DEFAULT CURRENT_TIMESTAMP';
          } else {
            colDef += ` DEFAULT ${dbPool.escape(c.COLUMN_DEFAULT)}`;
          }
        }
        if (c.EXTRA && c.EXTRA.includes('on update')) {
          colDef += ' ON UPDATE CURRENT_TIMESTAMP';
        }
      }
      if (c.COLUMN_COMMENT) {
        colDef += ` COMMENT ${dbPool.escape(c.COLUMN_COMMENT)}`;
      }

      await dbPool.query(
        `ALTER TABLE \`${table}\` CHANGE COLUMN \`${oldCol}\` \`${newCol}\` ${colDef}`
      );
      console.log(`  ✓ ${table}: ${oldCol} → ${newCol}`);
      renamed += 1;
    } catch (err) {
      console.warn(`迁移 ${table}.${oldCol} → ${newCol} 时出现警告:`, err.message);
    }
  }
  return renamed;
}

const BASE_DICTIONARY_COLUMN_RENAMES = [
  { old: 'id', new: 'F_Id' },
  { old: 'created_at', new: 'F_CreatorTime' },
  { old: 'updated_at', new: 'F_LastModifyTime' },
  { old: 'modify_time', new: 'F_LastModifyTime' },
  { old: 'last_modify_time', new: 'F_LastModifyTime' },
  { old: 'delete_mark', new: 'F_DeleteMark' },
  { old: 'created_by', new: 'F_CreatorUserId' },
  { old: 'updated_by', new: 'F_LastModifyUserId' },
];

const BASE_DICTIONARY_REQUIRED_COLUMNS = [
  {
    name: 'F_DeleteMark',
    ddl: "F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记：0未删除，1已删除'",
    after: 'is_enabled',
  },
  {
    name: 'F_CreatorUserId',
    ddl: "F_CreatorUserId VARCHAR(19) NULL COMMENT '创建人ID'",
    after: 'F_DeleteMark',
  },
  {
    name: 'F_LastModifyUserId',
    ddl: "F_LastModifyUserId VARCHAR(19) NULL COMMENT '更新人ID'",
    after: 'F_CreatorUserId',
  },
  {
    name: 'F_DeleteUserId',
    ddl: "F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人ID'",
    after: 'F_LastModifyUserId',
  },
  {
    name: 'F_DeleteTime',
    ddl: "F_DeleteTime DATETIME NULL COMMENT '删除时间'",
    after: 'F_DeleteUserId',
  },
  {
    name: 'F_CreatorTime',
    ddl: "F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间'",
    after: 'F_DeleteTime',
  },
  {
    name: 'F_LastModifyTime',
    ddl:
      "F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'",
    after: 'F_CreatorTime',
    // 部分 MySQL 版本对第二列 TIMESTAMP 的 ON UPDATE 较严格，回退为 DATETIME
    fallbackDdl:
      "F_LastModifyTime DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'",
  },
];

/**
 * base_dictionary 须在种子数据与 API 使用前完成 F_ 字段迁移（旧库可能仅有 id/delete_mark 等）。
 */
async function ensureBaseDictionarySchema(dbPool) {
  const table = 'base_dictionary';
  const [tables] = await dbPool.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  if (!tables.length) return;

  await applyTableColumnRenames(dbPool, table, BASE_DICTIONARY_COLUMN_RENAMES);

  const getColumnSet = async () => {
    const [rows] = await dbPool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    return new Set((rows || []).map((r) => r.COLUMN_NAME));
  };

  const addColumnSafe = async ({ name, ddl, after, fallbackDdl }) => {
    const cols = await getColumnSet();
    if (cols.has(name)) return;

    const attempts = [];
    if (after && cols.has(after)) {
      attempts.push(`${ddl} AFTER ${after}`);
    }
    attempts.push(ddl);
    if (fallbackDdl && fallbackDdl !== ddl) {
      attempts.push(fallbackDdl);
    }

    for (const fragment of attempts) {
      try {
        await dbPool.query(`ALTER TABLE base_dictionary ADD COLUMN ${fragment}`);
        console.log(`  ✓ base_dictionary 已添加列 ${name}`);
        return;
      } catch (err) {
        if (fragment === attempts[attempts.length - 1]) {
          console.warn(`迁移 base_dictionary.${name} 时出现警告:`, err.message);
        }
      }
    }
  };

  for (const spec of BASE_DICTIONARY_REQUIRED_COLUMNS) {
    await addColumnSafe(spec);
  }

  const finalCols = await getColumnSet();
  const missing = BASE_DICTIONARY_REQUIRED_COLUMNS.map((c) => c.name).filter((n) => !finalCols.has(n));
  if (missing.length) {
    console.warn(`  ⚠ base_dictionary 仍缺少列: ${missing.join(', ')}`);
  }
}

/**
 * 第三优先级：批量将剩余表的 snake_case / 小写系统字段重命名为 F_ PascalCase 规范。
 * 通过 INFORMATION_SCHEMA 读取当前列定义，仅修改列名，保留原有类型/默认值/注释。
 */
async function migrateBatchFColumns(dbPool) {
  // 表 → [{ old: '旧列名', new: '新列名' }, ...]
  const tableRenames = {
    // ── 基础平台表 ──
    applications:             [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }],
    membership_levels:        [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }],
    users:                    [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    invested_enterprises:     [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'modifier_user_id', new: 'F_LastModifyUserId' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    company:                  [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updater_user_id', new: 'F_LastModifyUserId' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    qichacha_config:          [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    shanghai_international_group_config: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    qichacha_news_categories: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    system_config:            [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    system_file_storage:      [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    base_dictionary:          [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'created_by', new: 'F_CreatorUserId' }, { old: 'updated_by', new: 'F_LastModifyUserId' }],
    data_change_log:          [{ old: 'id', new: 'F_Id' }, { old: 'change_user_id', new: 'F_CreatorUserId' }, { old: 'change_time', new: 'F_CreatorTime' }],
    news_interface_config:    [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    interface_news_type_enabled: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    recipient_management:     [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    email_config:             [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    email_logs:               [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }],
    news_sync_execution_log:  [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }],
    ai_news_analysis_cache:   [{ old: 'updated_at', new: 'F_LastModifyTime' }],
    news_sync_detail_log:     [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }],
    news_detail:              [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    additional_wechat_accounts: [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updater_user_id', new: 'F_LastModifyUserId' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    ai_model_config:          [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updater_user_id', new: 'F_LastModifyUserId' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    holiday_calendar:         [{ old: 'id', new: 'F_Id' }, { old: 'created_by', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_by', new: 'F_LastModifyUserId' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    ai_prompt_config:         [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updater_user_id', new: 'F_LastModifyUserId' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    ai_prompt_change_log:     [{ old: 'id', new: 'F_Id' }, { old: 'change_user_id', new: 'F_CreatorUserId' }, { old: 'change_time', new: 'F_CreatorTime' }],
    external_db_config:       [{ old: 'id', new: 'F_Id' }, { old: 'created_by', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_by', new: 'F_LastModifyUserId' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    enterprise_sync_task:     [{ old: 'id', new: 'F_Id' }, { old: 'created_by', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_by', new: 'F_LastModifyUserId' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    performance_scheduled:    [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    // ── 新闻舆情表 ──
    listing_share_links:      [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    news_share_links:         [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    // ── 上市进展表 ──
    ipo_new_share:            [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    listing_data_config:      [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    listing_sync_execution_log: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    listing_sync_task_lock:   [{ old: 'created_at', new: 'F_CreatorTime' }],
    // ── 项目挖掘表 ──
    sourcing_financing_event_w_infer: [{ old: 'id', new: 'F_Id' }],
    sourcing_financing_event:  [{ old: 'id', new: 'F_Id' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    sourcing_financing_ai_enrich_log: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    invested_enterprise_ai_enrich_log: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    invested_enterprise_ai_sync_snapshot: [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }],
    competitor_analysis_sync_snapshot: [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }],
    ipo_project_ai_sync_snapshot: [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }],
    competitor_match_supplement: [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    competitor_recall_source_config: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }],
    pre_investment_project:   [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    sourcing_competitor_run:  [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    sourcing_competitor_relation: [{ old: 'id', new: 'F_Id' }, { old: 'creator_user_id', new: 'F_CreatorUserId' }, { old: 'created_by', new: 'F_CreatorUserId' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    sourcing_pre_investment_competitor_run: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'delete_time', new: 'F_DeleteTime' }, { old: 'delete_user_id', new: 'F_DeleteUserId' }],
    sourcing_competitor_run_step_log: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }],
    sourcing_competitor_comparable_pref: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    sourcing_track:           [{ old: 'id', new: 'F_Id' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    sourcing_track_lv1:       [{ old: 'id', new: 'F_Id' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    sourcing_track_lv2:       [{ old: 'id', new: 'F_Id' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    sourcing_track_lv3:       [{ old: 'id', new: 'F_Id' }, { old: 'delete_mark', new: 'F_DeleteMark' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
    ipo_project_sql_sync_setting: [{ old: 'id', new: 'F_Id' }, { old: 'created_at', new: 'F_CreatorTime' }, { old: 'updated_at', new: 'F_LastModifyTime' }],
  };

  let totalRenamed = 0;

  for (const [table, renames] of Object.entries(tableRenames)) {
    if (table === 'base_dictionary') continue;
    totalRenamed += await applyTableColumnRenames(dbPool, table, renames);
  }

  if (totalRenamed > 0) {
    console.log(`✓ 批量字段重命名完成，共重命名 ${totalRenamed} 个列`);
  } else {
    console.log('✓ 批量字段重命名：无需迁移（所有列已是 F_ 命名）');
  }
}

async function initializeTables(dbPool) {
  try {
    console.log('  → 正在校验并创建数据表（步骤很多，首次或迁移时可能需 1～3 分钟，请耐心等待）…');
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
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      app_name VARCHAR(255) NOT NULL UNIQUE,
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS membership_levels (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      level_name VARCHAR(100) NOT NULL,
      validity_days INT NOT NULL,
      activation_date DATETIME NULL,
      app_id VARCHAR(19),
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      account VARCHAR(100) NOT NULL UNIQUE,
      phone VARCHAR(20) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      company_name VARCHAR(255),
      account_status VARCHAR(20) DEFAULT 'active',
      membership_level_id VARCHAR(19),
      app_permissions TEXT,
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (membership_level_id) REFERENCES membership_levels(F_Id) ON DELETE SET NULL
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
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      project_number VARCHAR(32) NOT NULL UNIQUE,
      project_abbreviation VARCHAR(255),
      enterprise_full_name VARCHAR(255) NOT NULL,
      unified_credit_code VARCHAR(64),
      wechat_official_account_id VARCHAR(100),
      official_website VARCHAR(255),
      exit_status VARCHAR(50) DEFAULT '未退出',
      data_app_name VARCHAR(64) NOT NULL DEFAULT '新闻舆情' COMMENT '所属应用：新闻舆情、项目挖掘',
      investment_cost DECIMAL(20,2) NULL COMMENT '投资成本',
      exited_cost DECIMAL(20,2) NULL COMMENT '已退出成本',
      remaining_cost DECIMAL(20,2) NULL COMMENT '剩余成本',
      residual_value DECIMAL(20,2) NULL COMMENT '剩余价值',
      F_CreatorUserId VARCHAR(19) COMMENT '创建用户ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyUserId VARCHAR(19) COMMENT '修改用户ID',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
      F_DeleteMark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_LastModifyUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
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
        ADD COLUMN modifier_user_id INT COMMENT '修改用户ID' AFTER F_CreatorTime,
        ADD COLUMN delete_mark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER F_LastModifyTime,
        ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间' AFTER F_DeleteMark,
        ADD COLUMN delete_user_id INT NULL COMMENT '删除用户ID' AFTER delete_time
      `);
      await dbPool.query(`
        ALTER TABLE invested_enterprises 
        ADD FOREIGN KEY (creator_user_id) REFERENCES users(F_Id) ON DELETE SET NULL,
        ADD FOREIGN KEY (modifier_user_id) REFERENCES users(F_Id) ON DELETE SET NULL,
        ADD FOREIGN KEY (delete_user_id) REFERENCES users(F_Id) ON DELETE SET NULL
      `);
      // 已为 invested_enterprises 表添加用户和删除相关字段
    }
  } catch (err) {
    console.warn('检查/添加 invested_enterprises 表字段时出现警告:', err.message);
  }

  // company 表：存储去重的被投企业信息
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS company (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      enterprise_abbreviation VARCHAR(255) NOT NULL COMMENT '被投企业简称',
      enterprise_full_name VARCHAR(255) NOT NULL COMMENT '被投企业全称',
      unified_credit_code VARCHAR(64) COMMENT '统一社会信用代码',
      official_website VARCHAR(255) COMMENT '公司官网',
      wechat_official_account_id VARCHAR(100) COMMENT '微信公众号id',
      F_CreatorUserId VARCHAR(19) COMMENT '创建用户ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyUserId VARCHAR(19) COMMENT '更新用户ID',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      UNIQUE KEY uk_credit_code (unified_credit_code),
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_LastModifyUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      F_DeleteMark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
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
        ADD COLUMN updater_user_id INT COMMENT '更新用户ID' AFTER F_CreatorTime
      `);
      await dbPool.query(`
        ALTER TABLE company 
        ADD FOREIGN KEY (creator_user_id) REFERENCES users(F_Id) ON DELETE SET NULL,
        ADD FOREIGN KEY (updater_user_id) REFERENCES users(F_Id) ON DELETE SET NULL
      `);
      // 已为 company 表添加用户相关字段
    }
    if (!columnNames.includes('delete_mark')) {
      await dbPool.query(`
        ALTER TABLE company
        ADD COLUMN delete_mark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER updater_user_id,
        ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间' AFTER delete_mark,
        ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID' AFTER delete_time
      `);
      try {
        await dbPool.query(`
          ALTER TABLE company
          ADD CONSTRAINT company_fk_del_user FOREIGN KEY (delete_user_id) REFERENCES users(F_Id) ON DELETE SET NULL
        `);
      } catch (fkErr) {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn('检查/添加 company 表字段时出现警告:', err.message);
  }

  // qichacha_config 表：企查查接口配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS qichacha_config (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      app_id VARCHAR(19) NOT NULL COMMENT '应用ID',
      qichacha_app_key VARCHAR(255) COMMENT '企查查应用凭证',
      qichacha_secret_key VARCHAR(255) COMMENT '企查查凭证秘钥',
      qichacha_daily_limit INT DEFAULT 100 COMMENT '每日查询限制次数',
      interface_type VARCHAR(50) DEFAULT '企业信息' COMMENT '接口类型：企业信息/新闻舆情',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      F_DeleteMark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      UNIQUE KEY uk_app_interface (app_id, interface_type),
      FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    const [qcDm] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qichacha_config' AND COLUMN_NAME = 'delete_mark'
    `);
    if (qcDm.length === 0) {
      await dbPool.query(`
        ALTER TABLE qichacha_config
        ADD COLUMN delete_mark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER F_LastModifyTime,
        ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间' AFTER delete_mark,
        ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID' AFTER delete_time
      `);
      try {
        await dbPool.query(`
          ALTER TABLE qichacha_config
          ADD CONSTRAINT qichacha_config_fk_del_user FOREIGN KEY (delete_user_id) REFERENCES users(F_Id) ON DELETE SET NULL
        `);
      } catch (fkErr) {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn('迁移 qichacha_config 删除字段时出现警告:', err.message);
  }
  
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
      const [newsApp] = await dbPool.query("SELECT F_Id AS id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1", ['新闻舆情']);
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
      
      await dbPool.query('ALTER TABLE qichacha_config ADD FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE');
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
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      app_id VARCHAR(19) NOT NULL COMMENT '应用ID',
      x_app_id VARCHAR(255) COMMENT 'X-App-Id：Ipass平台授权的消费方标识',
      api_key VARCHAR(255) COMMENT 'APIkey：消费方认证',
      daily_limit INT DEFAULT 100 COMMENT '每日查询限制次数',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      F_DeleteMark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      UNIQUE KEY uk_app_id (app_id),
      FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    const [sigDm] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shanghai_international_group_config' AND COLUMN_NAME = 'delete_mark'
    `);
    if (sigDm.length === 0) {
      await dbPool.query(`
        ALTER TABLE shanghai_international_group_config
        ADD COLUMN delete_mark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER F_LastModifyTime,
        ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间' AFTER delete_mark,
        ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID' AFTER delete_time
      `);
      try {
        await dbPool.query(`
          ALTER TABLE shanghai_international_group_config
          ADD CONSTRAINT shanghai_sig_config_fk_del_user FOREIGN KEY (delete_user_id) REFERENCES users(F_Id) ON DELETE SET NULL
        `);
      } catch (fkErr) {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn('迁移 shanghai_international_group_config 删除字段时出现警告:', err.message);
  }

  // qichacha_news_categories 表：企查查新闻类别列表
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS qichacha_news_categories (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      category_code VARCHAR(50) NOT NULL UNIQUE COMMENT '类别编码',
      category_name VARCHAR(255) NOT NULL COMMENT '类别描述',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      F_DeleteMark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      INDEX idx_category_code (category_code),
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    const [qncDm] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'qichacha_news_categories' AND COLUMN_NAME = 'delete_mark'
    `);
    if (qncDm.length === 0) {
      await dbPool.query(`
        ALTER TABLE qichacha_news_categories
        ADD COLUMN delete_mark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER F_LastModifyTime,
        ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间' AFTER delete_mark,
        ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID' AFTER delete_time
      `);
      try {
        await dbPool.query(`
          ALTER TABLE qichacha_news_categories
          ADD CONSTRAINT qichacha_news_cat_fk_del_user FOREIGN KEY (delete_user_id) REFERENCES users(F_Id) ON DELETE SET NULL
        `);
      } catch (fkErr) {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn('迁移 qichacha_news_categories 删除字段时出现警告:', err.message);
  }

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
        // 必须传入 dbPool：否则 generateId 内部 db.query 会 await ready，与正在执行的 init() 死锁
        const categoryId = await generateId('qichacha_news_categories', dbPool);
        await dbPool.execute(
          'INSERT INTO qichacha_news_categories (F_Id, category_code, category_name) VALUES (?, ?, ?)',
          [categoryId, category.code, category.name]
        );
      }
      console.log('✓ 已初始化企查查新闻类别默认数据');
    }
  } catch (err) {
    console.warn('初始化企查查新闻类别数据时出现警告:', err.message);
  }

  console.log('  → 进度：系统配置、邮件与新闻同步相关表…');

  // system_config 表：系统配置（保留用于其他配置）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      config_key VARCHAR(100) NOT NULL UNIQUE COMMENT '配置键',
      config_value TEXT COMMENT '配置值',
      config_desc VARCHAR(255) COMMENT '配置描述',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS system_file_storage (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      config_key VARCHAR(100) NOT NULL UNIQUE COMMENT '关联的配置键',
      filename VARCHAR(255) NOT NULL COMMENT '文件名称',
      mime_type VARCHAR(100) DEFAULT 'image/jpeg' COMMENT '文件类型',
      file_size INT COMMENT '文件大小（字节）',
      file_data LONGBLOB NOT NULL COMMENT '文件内容',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // base_dictionary 表：数据字典（单表存储字典类型 + 字典选项）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS base_dictionary (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      parent_id VARCHAR(19) NULL COMMENT '父级字典ID，NULL=字典类型，非NULL=字典选项',
      dict_code VARCHAR(100) NOT NULL COMMENT '字典编码（类型和选项都保留，选项继承所属类型编码）',
      dict_name VARCHAR(200) NOT NULL COMMENT '字典名称（类型名称）',
      item_code VARCHAR(100) NULL COMMENT '选项编码（仅选项行有值）',
      item_name VARCHAR(200) NULL COMMENT '选项名称（仅选项行有值）',
      sort_order INT NOT NULL DEFAULT 0 COMMENT '排序值，越小越靠前',
      is_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用：1启用，0停用',
      F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记：0未删除，1已删除',
      F_CreatorUserId VARCHAR(19) NULL COMMENT '创建人ID',
      F_LastModifyUserId VARCHAR(19) NULL COMMENT '更新人ID',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人ID',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_base_dict_parent (parent_id),
      INDEX idx_base_dict_code (dict_code),
      INDEX idx_base_dict_enabled (is_enabled),
      INDEX idx_base_dict_delete (F_DeleteMark)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    await ensureBaseDictionarySchema(dbPool);
    console.log('✓ base_dictionary 表结构已校验（F_ 系统字段）');
  } catch (err) {
    console.warn('迁移 base_dictionary 表结构时出现警告:', err.message);
  }

  // 初始化 base_dictionary 默认数据：industry（行业）及其选项（幂等）
  try {
    const defaultParentId = '2026042114193800001';
    const defaultOperatorId = '2025112019135100001';
    const defaultCreatedAt = '2026-04-21 14:19:38';
    const defaultUpdatedAt = '2026-04-21 14:21:04';

    const [industryTypeRows] = await dbPool.query(
      `SELECT F_Id AS id
       FROM base_dictionary
       WHERE dict_code = 'industry' AND parent_id IS NULL AND F_DeleteMark = 0
       ORDER BY F_CreatorTime ASC
       LIMIT 1`
    );

    let industryParentId = defaultParentId;
    if (industryTypeRows && industryTypeRows.length > 0) {
      industryParentId = industryTypeRows[0].id;
    } else {
      await dbPool.execute(
        `INSERT INTO base_dictionary
         (F_Id, parent_id, dict_code, dict_name, item_code, item_name, sort_order, is_enabled, F_DeleteMark, F_CreatorUserId, F_LastModifyUserId, F_DeleteUserId, F_DeleteTime, F_CreatorTime, F_LastModifyTime)
         VALUES (?, NULL, 'industry', '行业', NULL, NULL, 0, 1, 0, ?, ?, NULL, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE
           parent_id = NULL,
           dict_code = VALUES(dict_code),
           dict_name = VALUES(dict_name),
           item_code = NULL,
           item_name = NULL,
           sort_order = VALUES(sort_order),
           is_enabled = VALUES(is_enabled),
           F_DeleteMark = 0,
           F_LastModifyUserId = VALUES(F_LastModifyUserId),
           F_DeleteUserId = NULL,
           F_DeleteTime = NULL,
           F_LastModifyTime = VALUES(F_LastModifyTime)`,
        [defaultParentId, defaultOperatorId, defaultOperatorId, defaultCreatedAt, defaultUpdatedAt]
      );
      industryParentId = defaultParentId;
    }

    const industryItems = [
      { id: '2026042114194800001', item_code: 'Biomedicine', item_name: '生物医药', sort_order: 0, created_at: '2026-04-21 14:19:48' },
      { id: '2026042114195700001', item_code: 'semiconductor', item_name: '半导体', sort_order: 1, created_at: '2026-04-21 14:19:57' },
      { id: '2026042114200400001', item_code: 'ai', item_name: '人工智能', sort_order: 2, created_at: '2026-04-21 14:20:04' },
      { id: '2026042114201800001', item_code: 'others', item_name: '其他', sort_order: 3, created_at: '2026-04-21 14:20:18' },
    ];

    for (const item of industryItems) {
      const [existingItemRows] = await dbPool.query(
        `SELECT F_Id AS id
         FROM base_dictionary
         WHERE parent_id = ? AND dict_code = 'industry' AND item_code = ? AND F_DeleteMark = 0
         LIMIT 1`,
        [industryParentId, item.item_code]
      );
      if (existingItemRows && existingItemRows.length > 0) {
        continue;
      }

      await dbPool.execute(
        `INSERT INTO base_dictionary
         (F_Id, parent_id, dict_code, dict_name, item_code, item_name, sort_order, is_enabled, F_DeleteMark, F_CreatorUserId, F_LastModifyUserId, F_DeleteUserId, F_DeleteTime, F_CreatorTime, F_LastModifyTime)
         VALUES (?, ?, 'industry', '行业', ?, ?, ?, 1, 0, ?, ?, NULL, NULL, ?, ?)`,
        [item.id, industryParentId, item.item_code, item.item_name, item.sort_order, defaultOperatorId, defaultOperatorId, item.created_at, defaultUpdatedAt]
      );
    }
  } catch (err) {
    console.warn('初始化 base_dictionary 默认行业数据时出现警告:', err.message);
  }

  // base_dictionary：各提供商可选 AI 模型（item_code 写入 ai_model_config.model_name，与接口 model 字段一致）
  try {
    const opId = '2025112019135100001';
    const nowType = '2026-05-13 12:00:00';
    const aiModelDictTypes = [
      { id: '2026051315000000001', dict_code: 'ai_model_alibaba', dict_name: 'AI模型（阿里云千问）', sort_order: 0 },
      { id: '2026051315000100001', dict_code: 'ai_model_openai', dict_name: 'AI模型（OpenAI）', sort_order: 1 },
      { id: '2026051315000200001', dict_code: 'ai_model_baidu', dict_name: 'AI模型（百度文心）', sort_order: 2 },
      { id: '2026051315000300001', dict_code: 'ai_model_tencent', dict_name: 'AI模型（腾讯混元）', sort_order: 3 },
      { id: '2026051618000000001', dict_code: 'ai_model_gateway', dict_name: 'AI模型（API网关）', sort_order: 4 },
      { id: '2026051619000000001', dict_code: 'ai_model_volcengine', dict_name: 'AI模型（火山豆包）', sort_order: 5 },
    ];
    const aiModelItemsByCode = {
      ai_model_alibaba: [
        { id: '2026051315001000001', item_code: 'qwen-turbo', item_name: 'qwen-turbo', sort_order: 0 },
        { id: '2026051315001000002', item_code: 'qwen-plus', item_name: 'qwen-plus', sort_order: 1 },
        { id: '2026051315001000003', item_code: 'qwen3-max', item_name: 'qwen3-max', sort_order: 2 },
        { id: '2026051315001000004', item_code: 'qwen-long', item_name: 'qwen-long', sort_order: 3 },
        { id: '2026051315001000005', item_code: 'qwen3-vl-plus', item_name: 'qwen3-vl-plus', sort_order: 4 },
      ],
      ai_model_openai: [
        { id: '2026051315001100001', item_code: 'gpt-3.5-turbo', item_name: 'gpt-3.5-turbo', sort_order: 0 },
        { id: '2026051315001100002', item_code: 'gpt-4', item_name: 'gpt-4', sort_order: 1 },
        { id: '2026051315001100003', item_code: 'gpt-4-turbo', item_name: 'gpt-4-turbo', sort_order: 2 },
        { id: '2026051315001100004', item_code: 'gpt-4o', item_name: 'gpt-4o', sort_order: 3 },
      ],
      ai_model_baidu: [
        { id: '2026051315001200001', item_code: 'ernie-bot', item_name: 'ernie-bot', sort_order: 0 },
        { id: '2026051315001200002', item_code: 'ernie-bot-turbo', item_name: 'ernie-bot-turbo', sort_order: 1 },
        { id: '2026051315001200003', item_code: 'ernie-bot-4', item_name: 'ernie-bot-4', sort_order: 2 },
      ],
      ai_model_tencent: [
        { id: '2026051315001300001', item_code: 'hunyuan-lite', item_name: 'hunyuan-lite', sort_order: 0 },
        { id: '2026051315001300002', item_code: 'hunyuan-standard', item_name: 'hunyuan-standard', sort_order: 1 },
        { id: '2026051315001300003', item_code: 'hunyuan-pro', item_name: 'hunyuan-pro', sort_order: 2 },
      ],
      ai_model_gateway: [
        { id: '2026061618001000001', item_code: 'claude-opus-4-7', item_name: 'claude-opus-4-7', sort_order: 0 },
        { id: '2026061618001000002', item_code: 'gpt-5.4', item_name: 'gpt-5.4', sort_order: 1 },
        { id: '2026061618001000003', item_code: 'claude-opus-4-6', item_name: 'claude-opus-4-6', sort_order: 2 },
        { id: '2026061618001000004', item_code: 'gpt-5.5', item_name: 'gpt-5.5', sort_order: 3 },
        { id: '2026061618001000005', item_code: 'gemini-3.1-pro-preview', item_name: 'gemini-3.1-pro-preview', sort_order: 4 },
        { id: '2026061618001000006', item_code: 'gemini-3-pro-image-preview', item_name: 'gemini-3-pro-image-preview', sort_order: 5 },
        { id: '2026061618001000007', item_code: 'gpt-image-2', item_name: 'gpt-image-2', sort_order: 6 },
      ],
      ai_model_volcengine: [
        { id: '2026051619001000001', item_code: 'doubao-pro-32k', item_name: 'doubao-pro-32k', sort_order: 0 },
        { id: '2026051619001000002', item_code: 'doubao-lite-32k', item_name: 'doubao-lite-32k', sort_order: 1 },
        { id: '2026051619001000003', item_code: 'doubao-1.5-pro-32k', item_name: 'doubao-1.5-pro-32k', sort_order: 2 },
      ],
    };

    for (const t of aiModelDictTypes) {
      const [typeRows] = await dbPool.query(
        `SELECT F_Id AS id FROM base_dictionary WHERE dict_code = ? AND parent_id IS NULL AND F_DeleteMark = 0 ORDER BY F_CreatorTime ASC LIMIT 1`,
        [t.dict_code]
      );
      let parentId = t.id;
      if (typeRows && typeRows.length > 0) {
        parentId = typeRows[0].id;
      } else {
        await dbPool.execute(
          `INSERT INTO base_dictionary
           (F_Id, parent_id, dict_code, dict_name, item_code, item_name, sort_order, is_enabled, F_DeleteMark, F_CreatorUserId, F_LastModifyUserId, F_DeleteUserId, F_DeleteTime, F_CreatorTime, F_LastModifyTime)
           VALUES (?, NULL, ?, ?, NULL, NULL, ?, 1, 0, ?, ?, NULL, NULL, ?, ?)`,
          [t.id, t.dict_code, t.dict_name, t.sort_order, opId, opId, nowType, nowType]
        );
        parentId = t.id;
      }

      const items = aiModelItemsByCode[t.dict_code] || [];
      for (const it of items) {
        const [exItem] = await dbPool.query(
          `SELECT F_Id AS id FROM base_dictionary WHERE parent_id = ? AND dict_code = ? AND item_code = ? AND F_DeleteMark = 0 LIMIT 1`,
          [parentId, t.dict_code, it.item_code]
        );
        if (exItem && exItem.length > 0) continue;
        await dbPool.execute(
          `INSERT INTO base_dictionary
           (F_Id, parent_id, dict_code, dict_name, item_code, item_name, sort_order, is_enabled, F_DeleteMark, F_CreatorUserId, F_LastModifyUserId, F_DeleteUserId, F_DeleteTime, F_CreatorTime, F_LastModifyTime)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, NULL, NULL, ?, ?)`,
          [
            it.id,
            parentId,
            t.dict_code,
            t.dict_name,
            it.item_code,
            it.item_name,
            it.sort_order,
            opId,
            opId,
            nowType,
            nowType,
          ]
        );
      }
    }
    console.log('✓ base_dictionary 已初始化 AI 模型名称字典（ai_model_*）');
  } catch (err) {
    console.warn('初始化 base_dictionary AI 模型名称时出现警告:', err.message);
  }

  // base_dictionary：AI 模型配置 — 应用类型 / 使用类型（item_code → ai_model_config 枚举字段）
  try {
    const opId = '2025112019135100001';
    const nowDict = '2026-05-16 12:00:00';
    const aiMetaDictTypes = [
      { id: '2026051612000000001', dict_code: 'ai_model_application_type', dict_name: 'AI模型应用类型', sort_order: 10 },
      { id: '2026051612000100001', dict_code: 'ai_model_usage_type', dict_name: 'AI模型使用类型', sort_order: 11 },
    ];
    const aiMetaItemsByCode = {
      ai_model_application_type: [
        { id: '2026051612001000001', item_code: 'news_analysis', item_name: '新闻分析', sort_order: 0 },
        { id: '2026051612001000002', item_code: 'project_sourcing_analysis', item_name: '项目挖掘分析', sort_order: 1 },
        { id: '2026051612001000003', item_code: 'competitor_analysis', item_name: '竞品分析应用', sort_order: 2 },
        { id: '2026051612001000004', item_code: 'listing_progress_analysis', item_name: '上市进展分析', sort_order: 3 },
        { id: '2026051612001000005', item_code: 'general', item_name: '通用', sort_order: 4 },
      ],
      ai_model_usage_type: [
        { id: '2026051612001100001', item_code: 'content_analysis', item_name: '情绪分析', sort_order: 0 },
        { id: '2026051612001100002', item_code: 'image_recognition', item_name: '图片识别', sort_order: 1 },
        { id: '2026051612001100003', item_code: 'project_mining', item_name: '项目挖掘', sort_order: 2 },
        { id: '2026051612001100004', item_code: 'listing_data', item_name: '上市数据', sort_order: 3 },
        { id: '2026051612001100005', item_code: 'competitor_match', item_name: '竞品匹配', sort_order: 4 },
      ],
    };

    for (const t of aiMetaDictTypes) {
      const [typeRows] = await dbPool.query(
        `SELECT F_Id AS id FROM base_dictionary WHERE dict_code = ? AND parent_id IS NULL AND F_DeleteMark = 0 ORDER BY F_CreatorTime ASC LIMIT 1`,
        [t.dict_code]
      );
      let parentId = t.id;
      if (typeRows && typeRows.length > 0) {
        parentId = typeRows[0].id;
      } else {
        await dbPool.execute(
          `INSERT INTO base_dictionary
           (F_Id, parent_id, dict_code, dict_name, item_code, item_name, sort_order, is_enabled, F_DeleteMark, F_CreatorUserId, F_LastModifyUserId, F_DeleteUserId, F_DeleteTime, F_CreatorTime, F_LastModifyTime)
           VALUES (?, NULL, ?, ?, NULL, NULL, ?, 1, 0, ?, ?, NULL, NULL, ?, ?)`,
          [t.id, t.dict_code, t.dict_name, t.sort_order, opId, opId, nowDict, nowDict]
        );
        parentId = t.id;
      }

      const items = aiMetaItemsByCode[t.dict_code] || [];
      for (const it of items) {
        // 先按主键判断，避免历史脏数据导致 Duplicate entry（同 id 已存在但 item_code 查不到）
        const [exById] = await dbPool.query(
          `SELECT F_Id AS id FROM base_dictionary WHERE F_Id = ? LIMIT 1`,
          [it.id]
        );
        if (exById && exById.length > 0) continue;
        const [exItem] = await dbPool.query(
          `SELECT F_Id AS id FROM base_dictionary WHERE parent_id = ? AND dict_code = ? AND item_code = ? AND F_DeleteMark = 0 LIMIT 1`,
          [parentId, t.dict_code, it.item_code]
        );
        if (exItem && exItem.length > 0) continue;
        try {
          await dbPool.execute(
            `INSERT INTO base_dictionary
             (F_Id, parent_id, dict_code, dict_name, item_code, item_name, sort_order, is_enabled, F_DeleteMark, F_CreatorUserId, F_LastModifyUserId, F_DeleteUserId, F_DeleteTime, F_CreatorTime, F_LastModifyTime)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, NULL, NULL, ?, ?)`,
            [
              it.id,
              parentId,
              t.dict_code,
              t.dict_name,
              it.item_code,
              it.item_name,
              it.sort_order,
              opId,
              opId,
              nowDict,
              nowDict,
            ]
          );
        } catch (insErr) {
          // 并发/历史主键冲突：跳过即可
          if (insErr && (insErr.code === 'ER_DUP_ENTRY' || /Duplicate entry/i.test(String(insErr.message || '')))) {
            continue;
          }
          throw insErr;
        }
      }
    }
    console.log('✓ base_dictionary 已初始化 AI 模型应用类型/使用类型字典');
  } catch (err) {
    console.warn('初始化 base_dictionary AI 模型应用/使用类型时出现警告:', err.message);
  }

  // data_change_log 表：统一的数据变更日志表
  // 先创建表（不包含外键约束，稍后添加）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS data_change_log (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      table_name VARCHAR(100) NOT NULL COMMENT '表名',
      record_id VARCHAR(19) NOT NULL COMMENT '表数据的ID值',
      changed_field VARCHAR(100) NOT NULL COMMENT '变更字段名',
      old_value TEXT COMMENT '旧值',
      new_value TEXT COMMENT '新值',
      F_CreatorUserId VARCHAR(19) COMMENT '变更人ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间',
      INDEX idx_table_record (table_name, record_id),
      INDEX idx_change_time (F_CreatorTime),
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
          FOREIGN KEY (change_user_id) REFERENCES users(F_Id) ON DELETE SET NULL
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
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
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
      F_DeleteMark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
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
      const [newsApp] = await dbPool.query("SELECT F_Id AS id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1", ['新闻舆情']);
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
        await dbPool.query('ALTER TABLE news_interface_config ADD FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE');
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
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID',
      interface_type VARCHAR(50) NOT NULL COMMENT '接口类型：新榜/企查查/上海国际集团',
      news_type VARCHAR(50) NOT NULL COMMENT '新闻类型',
      is_enabled TINYINT(1) DEFAULT 0 COMMENT '是否已开发可选用：1-是，0-否',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
            'INSERT INTO interface_news_type_enabled (F_Id, interface_type, news_type, is_enabled) VALUES (?, ?, ?, ?)',
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
        `INSERT INTO interface_news_type_enabled (F_Id, interface_type, news_type, is_enabled) VALUES (?, '上海国际集团', '破产重整', 1)`,
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
        `INSERT INTO interface_news_type_enabled (F_Id, interface_type, news_type, is_enabled) VALUES (?, '上海国际集团', '同花顺订阅', 1)`,
        [thsId]
      );
      console.log('已为上海国际集团启用「同花顺订阅」新闻类型');
    }
    const { seedInterfaceNewsTypeFinancing } = require('./utils/project-sourcing/dbSeedFinancing');
    await seedInterfaceNewsTypeFinancing(dbPool);
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
        await dbPool.query('ALTER TABLE news_interface_config ADD CONSTRAINT fk_news_interface_config_app_id FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE');
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
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      user_id VARCHAR(19) NOT NULL COMMENT '用户ID',
      recipient_email TEXT NOT NULL COMMENT '收件人邮箱（多个邮箱用逗号或换行分隔）',
      email_subject VARCHAR(500) COMMENT '邮件主题',
      send_frequency VARCHAR(20) NOT NULL COMMENT '发送频率：daily-每天，weekly-每周，monthly-每月',
      send_time TIME COMMENT '发送时间（格式：HH:mm:ss）',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      qichacha_category_codes JSON COMMENT '企查查新闻类别编码列表（JSON数组），为空时使用默认类别',
      listing_mail_types JSON COMMENT '上市进展收件内容类型（JSON数组）：listing_project_progress/listing_progress/listing_guidance/overseas_filing/new_share_listed_yesterday/new_share_upcoming/new_share_apply',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      FOREIGN KEY (user_id) REFERENCES users(F_Id) ON DELETE CASCADE
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
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
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
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      F_DeleteMark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      UNIQUE KEY uk_app_id (app_id),
      FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    const [ecDm] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_config' AND COLUMN_NAME = 'delete_mark'
    `);
    if (ecDm.length === 0) {
      await dbPool.query(`
        ALTER TABLE email_config
        ADD COLUMN delete_mark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER F_LastModifyTime,
        ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间' AFTER delete_mark,
        ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID' AFTER delete_time
      `);
      try {
        await dbPool.query(`
          ALTER TABLE email_config
          ADD CONSTRAINT email_config_fk_del_user FOREIGN KEY (delete_user_id) REFERENCES users(F_Id) ON DELETE SET NULL
        `);
      } catch (fkErr) {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn('迁移 email_config 删除字段时出现警告:', err.message);
  }

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
          "SELECT F_Id AS id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1",
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
          "SELECT F_Id AS id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1",
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
          FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE
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
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
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
      F_CreatorUserId VARCHAR(19) COMMENT '操作人ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      INDEX idx_email_config_id (email_config_id),
      INDEX idx_operation_type (operation_type),
      INDEX idx_status (status),
      INDEX idx_created_at (F_CreatorTime),
      FOREIGN KEY (email_config_id) REFERENCES email_config(F_Id) ON DELETE CASCADE,
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL
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

  // 迁移 email_logs 表：添加 F_CreatorUserId 列（如果不存在）
  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_logs' AND COLUMN_NAME = 'F_CreatorUserId'
    `);
    if (cols.length === 0) {
      await dbPool.query(`
        ALTER TABLE email_logs 
        ADD COLUMN F_CreatorUserId VARCHAR(19) COMMENT '操作人ID' AFTER status,
        ADD INDEX idx_email_logs_creator (F_CreatorUserId)
      `);
      console.log('✓ 已为 email_logs 表添加 F_CreatorUserId 字段');
    }
  } catch (err) {
    console.warn('迁移 email_logs.F_CreatorUserId 时出现警告:', err.message);
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

  // recipient_management 删除字段由 migrateSoftDeleteToDeleteMarkConvention 统一补齐/迁移

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

  // 迁移 recipient_management 表，添加 listing_mail_types 字段（上市进展发件内容多选）
  try {
    const [mailTypesCol] = await dbPool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'recipient_management'
      AND COLUMN_NAME = 'listing_mail_types'
    `);
    if (mailTypesCol.length === 0) {
      await dbPool.query(
        "ALTER TABLE recipient_management ADD COLUMN listing_mail_types JSON COMMENT '上市进展收件内容类型（JSON数组）：listing_project_progress/listing_progress/listing_guidance/overseas_filing/new_share_listed_yesterday/new_share_upcoming/new_share_apply'"
      );
      await dbPool.query(
        "UPDATE recipient_management SET listing_mail_types = JSON_ARRAY('listing_progress') WHERE listing_mail_types IS NULL"
      );
      console.log('✓ 已添加 recipient_management 表的 listing_mail_types 字段');
    }
  } catch (err) {
    console.warn('迁移 recipient_management 表 listing_mail_types 字段时出现警告:', err.message);
  }

  // 方案 A：历史仅勾选 new_share 的收件配置补写 new_share_listed_yesterday，保持改前邮件行为
  try {
    const [legacyNewShareRows] = await dbPool.query(`
      SELECT F_Id AS id, listing_mail_types
      FROM recipient_management
      WHERE listing_mail_types IS NOT NULL
        AND JSON_CONTAINS(listing_mail_types, '"new_share"', '$')
        AND NOT JSON_CONTAINS(listing_mail_types, '"new_share_listed_yesterday"', '$')
    `);
    for (const row of legacyNewShareRows) {
      let types = row.listing_mail_types;
      if (typeof types === 'string') {
        try {
          types = JSON.parse(types);
        } catch {
          continue;
        }
      }
      if (!Array.isArray(types)) continue;
      await dbPool.query('UPDATE recipient_management SET listing_mail_types = ? WHERE F_Id = ?', [
        JSON.stringify([...types, 'new_share_listed_yesterday']),
        row.id,
      ]);
    }
    if (legacyNewShareRows.length > 0) {
      console.log(
        `✓ 已为 ${legacyNewShareRows.length} 条收件配置补全 new_share_listed_yesterday（原仅含 new_share）`
      );
    }
  } catch (err) {
    console.warn('迁移 listing_mail_types 拆分打新选项时出现警告:', err.message);
  }

  // 拆分 new_share → new_share_upcoming + new_share_apply（上市日历 / 打新申购独立可选）
  try {
    const [legacySplitRows] = await dbPool.query(`
      SELECT F_Id AS id, listing_mail_types
      FROM recipient_management
      WHERE listing_mail_types IS NOT NULL
        AND JSON_CONTAINS(listing_mail_types, '"new_share"', '$')
    `);
    for (const row of legacySplitRows) {
      let types = row.listing_mail_types;
      if (typeof types === 'string') {
        try {
          types = JSON.parse(types);
        } catch {
          continue;
        }
      }
      if (!Array.isArray(types)) continue;
      const expanded = new Set(types.filter((t) => String(t || '').trim() !== 'new_share'));
      if (types.some((t) => String(t || '').trim() === 'new_share')) {
        expanded.add('new_share_upcoming');
        expanded.add('new_share_apply');
      }
      await dbPool.query('UPDATE recipient_management SET listing_mail_types = ? WHERE F_Id = ?', [
        JSON.stringify(Array.from(expanded)),
        row.id,
      ]);
    }
    if (legacySplitRows.length > 0) {
      console.log(
        `✓ 已将 ${legacySplitRows.length} 条收件配置的 new_share 拆分为 new_share_upcoming + new_share_apply`
      );
    }
  } catch (err) {
    console.warn('迁移 listing_mail_types 拆分 new_share 为上市日历/打新申购时出现警告:', err.message);
  }

  // 迁移 recipient_management：第三方公众号按行业标签筛选（邮件内「第三方公众号」区块）
  try {
    const [tagCol] = await dbPool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'recipient_management'
      AND COLUMN_NAME = 'additional_account_tag_codes'
    `);
    if (tagCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE recipient_management
        ADD COLUMN additional_account_tag_codes JSON NULL COMMENT '第三方公众号：industry字典item_code与__NONE__(无标签)；NULL=不按标签排除(旧数据)；[]=邮件中不包含第三方公众号新闻'
      `);
      console.log('✓ 已添加 recipient_management 表的 additional_account_tag_codes 字段');
    }
  } catch (err) {
    console.warn('迁移 recipient_management.additional_account_tag_codes 时出现警告:', err.message);
  }

  // news_sync_execution_log 表：新闻同步执行日志
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS news_sync_execution_log (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
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
      F_CreatorUserId VARCHAR(19) COMMENT '操作人ID（手动触发时记录）',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      INDEX idx_config_id (config_id),
      INDEX idx_execution_type (execution_type),
      INDEX idx_status (status),
      INDEX idx_start_time (start_time),
      INDEX idx_created_at (F_CreatorTime),
      FOREIGN KEY (config_id) REFERENCES news_interface_config(F_Id) ON DELETE CASCADE,
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 迁移 news_sync_execution_log：旧库可能仍为 creator_user_id/created_at，或缺少 F_CreatorUserId
  try {
    await applyTableColumnRenames(dbPool, 'news_sync_execution_log', [
      { old: 'id', new: 'F_Id' },
      { old: 'creator_user_id', new: 'F_CreatorUserId' },
      { old: 'created_at', new: 'F_CreatorTime' },
    ]);
    const [syncLogUserCol] = await dbPool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'news_sync_execution_log' AND COLUMN_NAME = 'F_CreatorUserId'
    `);
    if (syncLogUserCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_sync_execution_log
        ADD COLUMN F_CreatorUserId VARCHAR(19) NULL COMMENT '操作人ID（手动触发时记录）' AFTER execution_details
      `);
      console.log('✓ 已为 news_sync_execution_log 表添加 F_CreatorUserId 字段');
    }
    const [syncLogTimeCol] = await dbPool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'news_sync_execution_log' AND COLUMN_NAME = 'F_CreatorTime'
    `);
    if (syncLogTimeCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_sync_execution_log
        ADD COLUMN F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间' AFTER F_CreatorUserId
      `);
      console.log('✓ 已为 news_sync_execution_log 表添加 F_CreatorTime 字段');
    }
  } catch (err) {
    console.warn('迁移 news_sync_execution_log 系统字段时出现警告:', err.message);
  }

  // ai_news_analysis_cache 表：AI分析时间缓存（持久化，避免2小时内重复分析）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ai_news_analysis_cache (
      news_id VARCHAR(19) PRIMARY KEY COMMENT 'news_detail.id',
      analyzed_at DATETIME NOT NULL COMMENT '最近一次传入AI分析时间',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      INDEX idx_ai_news_analyzed_at (analyzed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // news_sync_detail_log 表：新闻同步详细记录（每个公众号/企业的同步详情）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS news_sync_detail_log (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      sync_log_id VARCHAR(19) NOT NULL COMMENT '关联的同步执行日志ID',
      interface_type ENUM('新榜', '企查查', '上海国际集团') NOT NULL COMMENT '接口类型',
      account_id VARCHAR(255) NOT NULL COMMENT '公众号ID（新榜）或统一信用代码（企查查）',
      has_data TINYINT(1) DEFAULT 0 COMMENT '是否有数据返回：0-否，1-是',
      data_count INT DEFAULT 0 COMMENT '返回内容的条数',
      insert_success TINYINT(1) DEFAULT 0 COMMENT '是否成功入库：0-否，1-是',
      insert_count INT DEFAULT 0 COMMENT '成功入库的条数',
      error_message TEXT COMMENT '错误信息',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
      INDEX idx_sync_log_id (sync_log_id),
      INDEX idx_interface_type (interface_type),
      INDEX idx_account_id (account_id),
      INDEX idx_created_at (F_CreatorTime),
      FOREIGN KEY (sync_log_id) REFERENCES news_sync_execution_log(F_Id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 迁移 news_sync_detail_log 表：为已存在且 ENUM 较旧的库补充「上海国际集团」（须在 CREATE TABLE 之后执行）
  try {
    await dbPool.query(`
      ALTER TABLE news_sync_detail_log 
      MODIFY COLUMN interface_type ENUM('新榜', '企查查', '上海国际集团') NOT NULL COMMENT '接口类型'
    `);
    console.log('✓ 已为 news_sync_detail_log 同步 上海国际集团 接口类型');
  } catch (err) {
    if (!err.message.includes('Duplicate column name') && !err.message.includes("doesn't exist")) {
      console.warn('迁移 news_sync_detail_log interface_type 时出现警告:', err.message);
    }
  }

  // news_detail 表：公众号文章详情
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS news_detail (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      account_name VARCHAR(255) NOT NULL COMMENT '公众号名称',
      wechat_account VARCHAR(255) NOT NULL COMMENT '微信号',
      enterprise_full_name VARCHAR(255) COMMENT '被投企业全称',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（接口返回数据入库时间）',
      source_url VARCHAR(500) COMMENT '原文链接',
      title VARCHAR(500) COMMENT '图文标题',
      summary TEXT COMMENT '图文摘要',
      public_time DATETIME COMMENT '发布时间',
      content LONGTEXT COMMENT '正文',
      keywords JSON COMMENT '关键词（基于正文提取的关键词）',
      INDEX idx_wechat_account (wechat_account),
      INDEX idx_public_time (public_time),
      INDEX idx_created_at (F_CreatorTime),
      INDEX idx_enterprise_full_name (enterprise_full_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // news_fetch_day_log：抓取日账本（新榜企业公众号 / 上海国际按账号×业务日）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS news_fetch_day_log (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID',
      interface_type VARCHAR(50) NOT NULL COMMENT '新榜 / 上海国际',
      news_type VARCHAR(50) NOT NULL DEFAULT '新闻舆情' COMMENT '新闻类型',
      account_key VARCHAR(255) NOT NULL COMMENT '新榜=公众号ID；上海国际=统一信用代码',
      biz_date DATE NOT NULL COMMENT '业务日（被抓取的日历日）',
      status ENUM('has_data', 'empty', 'failed') NOT NULL COMMENT '抓取结果',
      empty_retry_count INT NOT NULL DEFAULT 0 COMMENT 'empty 后再试次数',
      item_count INT NOT NULL DEFAULT 0 COMMENT '本次抓取条数',
      config_id VARCHAR(19) NULL COMMENT 'news_interface_config.F_Id',
      last_error VARCHAR(500) NULL COMMENT '失败原因摘要',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_fetch_day (interface_type, news_type, account_key, biz_date),
      INDEX idx_biz_date (biz_date),
      INDEX idx_account_key (account_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='新闻抓取日账本';
  `);

  // news_detail.external_news_id：上海国际舆情 news_id_ths 等外部唯一键
  try {
    const [extCols] = await dbPool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'news_detail' AND COLUMN_NAME = 'external_news_id'`
    );
    if (!extCols || extCols.length === 0) {
      await dbPool.query(
        `ALTER TABLE news_detail
         ADD COLUMN external_news_id VARCHAR(100) NULL COMMENT '外部资讯ID（如上海国际 news_id_ths）' AFTER source_url,
         ADD INDEX idx_external_news_id (external_news_id)`
      );
      console.log('✓ news_detail 已添加 external_news_id');
    }
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate')) {
      console.warn('迁移 news_detail.external_news_id 时出现警告:', err.message);
    }
  }


  // additional_wechat_accounts 表：额外公众号数据源
  // 校验规则：同一用户(creator_user_id)下 wechat_account_id 唯一，不同用户可创建相同的 wechat_account_id
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS additional_wechat_accounts (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      account_name VARCHAR(255) NOT NULL COMMENT '公众号名称',
      wechat_account_id VARCHAR(255) NOT NULL COMMENT '微信账号ID',
      status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态：active-生效，inactive-失效',
      industry_tag_code VARCHAR(100) NULL COMMENT '行业标签：数据字典 industry 的 item_code',
      F_CreatorUserId VARCHAR(19) COMMENT '创建用户ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyUserId VARCHAR(19) COMMENT '更新用户ID',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      F_DeleteMark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      UNIQUE KEY uk_creator_wechat (F_CreatorUserId, wechat_account_id) COMMENT '同一用户下公众号ID唯一',
      INDEX idx_wechat_account_id (wechat_account_id),
      INDEX idx_status (status),
      INDEX idx_delete_mark (F_DeleteMark),
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_LastModifyUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 迁移：将 wechat_account_id 从全局唯一改为 (creator_user_id, wechat_account_id) 联合唯一
  try {
    const [indexes] = await dbPool.query(`
      SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'additional_wechat_accounts'
      AND INDEX_NAME = 'wechat_account_id' AND NON_UNIQUE = 0
    `);
    if (indexes && indexes.length > 0) {
      await dbPool.query('ALTER TABLE additional_wechat_accounts DROP INDEX wechat_account_id');
    }
    const [ukExists] = await dbPool.query(`
      SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'additional_wechat_accounts'
      AND INDEX_NAME = 'uk_creator_wechat'
    `);
    if (!ukExists || ukExists.length === 0) {
      await dbPool.query('ALTER TABLE additional_wechat_accounts ADD UNIQUE KEY uk_creator_wechat (creator_user_id, wechat_account_id)');
      console.log('  additional_wechat_accounts: 已迁移为 (creator_user_id, wechat_account_id) 联合唯一');
    }
  } catch (migrateErr) {
    console.warn('  迁移 additional_wechat_accounts 唯一约束时出现警告:', migrateErr.message);
  }

  try {
    const [colIndustryTag] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'additional_wechat_accounts'
        AND COLUMN_NAME = 'industry_tag_code'
    `);
    if (!colIndustryTag || colIndustryTag.length === 0) {
      await dbPool.query(`
        ALTER TABLE additional_wechat_accounts
        ADD COLUMN industry_tag_code VARCHAR(100) NULL COMMENT '行业标签：数据字典 industry 的 item_code'
        AFTER status
      `);
      console.log('  additional_wechat_accounts: 已添加 industry_tag_code');
    }
  } catch (migrateIndustryTagErr) {
    console.warn('  迁移 additional_wechat_accounts.industry_tag_code 时出现警告:', migrateIndustryTagErr.message);
  }

  // ai_model_config 表：AI模型配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ai_model_config (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
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
      application_type ENUM('news_analysis', 'general', 'project_sourcing_analysis', 'listing_progress_analysis', 'project_sourcing_competitor') DEFAULT 'news_analysis' COMMENT '应用类型：新闻分析/通用/项目挖掘分析/上市进展分析/竞品分析',
      usage_type ENUM('content_analysis', 'image_recognition', 'project_mining', 'listing_data', 'competitor_match') DEFAULT 'content_analysis' COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别，project_mining-项目挖掘，listing_data-上市数据，competitor_match-竞品匹配',
      F_CreatorUserId VARCHAR(19) COMMENT '创建用户ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyUserId VARCHAR(19) COMMENT '更新用户ID',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      F_DeleteMark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      INDEX idx_provider (provider),
      INDEX idx_application_type (application_type),
      INDEX idx_is_active (is_active),
      INDEX idx_delete_mark (F_DeleteMark),
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_LastModifyUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS holiday_calendar (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      holiday_date DATE NOT NULL COMMENT '日期',
      is_workday TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否工作日：1-是，0-否',
      workday_type VARCHAR(30) NOT NULL COMMENT '工作日类型：周末/调休/法定节假日/工作日',
      holiday_name VARCHAR(100) DEFAULT '' COMMENT '节日名称',
      F_CreatorUserId VARCHAR(19) COMMENT '创建人ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyUserId VARCHAR(19) COMMENT '修改人ID',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
      F_DeleteMark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      UNIQUE KEY uk_holiday_date (holiday_date),
      INDEX idx_is_workday (is_workday),
      INDEX idx_workday_type (workday_type),
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_LastModifyUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ai_prompt_config 表：AI提示词配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS ai_prompt_config (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      prompt_name VARCHAR(255) NOT NULL COMMENT '提示词名称',
      interface_type VARCHAR(50) NOT NULL COMMENT '新闻接口类型：新榜/企查查',
      prompt_type VARCHAR(50) NOT NULL COMMENT '提示词类型：sentiment_analysis-情绪分析, enterprise_relevance-企业关联分析, validation-关联验证',
      prompt_content LONGTEXT NOT NULL COMMENT '提示词内容',
      ai_model_config_id VARCHAR(19) NULL COMMENT '关联的AI模型配置ID',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      F_CreatorUserId VARCHAR(19) COMMENT '创建用户ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyUserId VARCHAR(19) COMMENT '更新用户ID',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      F_DeleteMark INT DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      INDEX idx_interface_type (interface_type),
      INDEX idx_prompt_type (prompt_type),
      INDEX idx_is_active (is_active),
      INDEX idx_delete_mark (F_DeleteMark),
      INDEX idx_ai_model_config_id (ai_model_config_id),
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_LastModifyUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
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
              FOREIGN KEY (ai_model_config_id) REFERENCES ai_model_config(F_Id) ON DELETE SET NULL
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
              FOREIGN KEY (ai_model_config_id) REFERENCES ai_model_config(F_Id) ON DELETE SET NULL
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
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      prompt_config_id VARCHAR(19) NOT NULL COMMENT '提示词配置ID',
      change_type ENUM('create', 'update', 'delete', 'activate', 'deactivate') NOT NULL COMMENT '变更类型',
      old_value LONGTEXT COMMENT '旧值（JSON格式，包含所有字段）',
      new_value LONGTEXT COMMENT '新值（JSON格式，包含所有字段）',
      F_CreatorUserId VARCHAR(19) COMMENT '变更用户ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间',
      change_reason VARCHAR(500) COMMENT '变更原因',
      INDEX idx_prompt_config_id (prompt_config_id),
      INDEX idx_change_type (change_type),
      INDEX idx_change_time (F_CreatorTime),
      FOREIGN KEY (prompt_config_id) REFERENCES ai_prompt_config(F_Id) ON DELETE CASCADE,
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // external_db_config 表：外部数据库配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS external_db_config (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      name VARCHAR(255) NOT NULL UNIQUE COMMENT '配置名称',
      db_type VARCHAR(20) NOT NULL DEFAULT 'mysql' COMMENT '数据库类型：mysql/postgresql',
      host VARCHAR(255) NOT NULL COMMENT '数据库主机',
      port INT NOT NULL DEFAULT 3306 COMMENT '数据库端口',
      \`user\` VARCHAR(255) NOT NULL COMMENT '数据库用户名',
      password VARCHAR(255) NOT NULL COMMENT '数据库密码',
      \`database\` VARCHAR(255) NOT NULL COMMENT '数据库名称',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      F_DeleteMark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_CreatorUserId VARCHAR(19) COMMENT '创建人ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyUserId VARCHAR(19) COMMENT '修改人ID',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      INDEX idx_is_active (is_active),
      INDEX idx_delete_mark (F_DeleteMark),
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_LastModifyUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
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

  console.log('  → 进度：业绩看板 b_* 主表（创建与字段迁移，可能较慢）…');

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
      spv_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'SPV累计投资金额',
      lm_spv_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上月SPV累计投资金额',
      spv_paidin_change DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'SPV累计投资金额变动',
      spv_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'SPV累计回款金额',
      lm_spv_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '上月SPV累计回款金额',
      spv_receive_change DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'SPV累计回款金额变动',
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
      irr DECIMAL(20,10) NULL DEFAULT NULL COMMENT 'IRR-25',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-基金投资组合明细';
  `);
  // b_investment_spv - 定开看板-SPV投资组合明细
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS b_investment_spv (
      F_Id VARCHAR(50) NOT NULL COMMENT '主键',
      F_CreatorUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '创建用户',
      F_CreatorTime DATETIME NULL DEFAULT NULL COMMENT '创建时间',
      F_DeleteUserId VARCHAR(50) NULL DEFAULT NULL COMMENT '删除用户',
      F_DeleteMark INT NULL DEFAULT 0 COMMENT '删除状态',
      F_DeleteTime DATETIME NULL DEFAULT NULL COMMENT '删除时间',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-01',
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-2',
      fund VARCHAR(300) NULL DEFAULT NULL COMMENT '基金名称-3',
      fund_type VARCHAR(300) NULL DEFAULT NULL COMMENT '基金类型-4',
      set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间-5',
      transaction_type VARCHAR(300) NULL DEFAULT NULL COMMENT '投资类别-6',
      project VARCHAR(300) NULL DEFAULT NULL COMMENT '项目名称-7',
      first_date DATETIME NULL DEFAULT NULL COMMENT '首次投资时间-8',
      acc_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴金额累计-9',
      acc_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '实缴金额累计-10',
      acc_exit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '退出金额累计-11',
      acc_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '回款金额累计-12',
      change_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本月认缴变动-13',
      change_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本月实缴变动-14',
      change_exit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本月退出变动-15',
      change_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本月回收变动-16',
      fund_paid DECIMAL(30,10) NULL DEFAULT NULL COMMENT '基金实缴金额累计-17',
      lp_paid DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'LP实缴金额累计-18',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-SPV投资组合明细';
  `);
  // 为已存在的 b_investment_spv 表添加 change_*、fund_paid、lp_paid 字段
  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_investment_spv'
      AND COLUMN_NAME IN ('change_sub', 'change_paidin', 'change_exit', 'change_receive', 'fund_paid', 'lp_paid')
    `);
    const existing = new Set(cols.map(c => c.COLUMN_NAME));
    if (!existing.has('change_sub')) {
      await dbPool.query(`ALTER TABLE b_investment_spv ADD COLUMN change_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本月认缴变动-13' AFTER acc_receive`);
    }
    if (!existing.has('change_paidin')) {
      await dbPool.query(`ALTER TABLE b_investment_spv ADD COLUMN change_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本月实缴变动-14' AFTER change_sub`);
    }
    if (!existing.has('change_exit')) {
      await dbPool.query(`ALTER TABLE b_investment_spv ADD COLUMN change_exit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本月退出变动-15' AFTER change_paidin`);
    }
    if (!existing.has('change_receive')) {
      await dbPool.query(`ALTER TABLE b_investment_spv ADD COLUMN change_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本月回收变动-16' AFTER change_exit`);
    }
    if (!existing.has('fund_paid')) {
      await dbPool.query(`ALTER TABLE b_investment_spv ADD COLUMN fund_paid DECIMAL(30,10) NULL DEFAULT NULL COMMENT '基金实缴金额累计-17' AFTER change_receive`);
    }
    if (!existing.has('lp_paid')) {
      await dbPool.query(`ALTER TABLE b_investment_spv ADD COLUMN lp_paid DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'LP实缴金额累计-18' AFTER fund_paid`);
    }
    // 修正已有列的 COMMENT 序号
    await dbPool.query(`ALTER TABLE b_investment_spv MODIFY COLUMN fund_paid DECIMAL(30,10) NULL DEFAULT NULL COMMENT '基金实缴金额累计-17'`);
    await dbPool.query(`ALTER TABLE b_investment_spv MODIFY COLUMN lp_paid DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'LP实缴金额累计-18'`);
  } catch (err) {
    console.warn('检查/添加 b_investment_spv 字段时出现了警告:', err.message);
  }
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
      first_date DATETIME NULL DEFAULT NULL COMMENT '首次投资日期-05',
      acc_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴金额累计-06',
      change_sub DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴金额本月变动-07',
      acc_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '实缴金额累计-08',
      change_paidin DECIMAL(30,10) NULL DEFAULT NULL COMMENT '实缴金额本月变动-09',
      acc_exit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '退出金额累计-10',
      change_exit DECIMAL(30,10) NULL DEFAULT NULL COMMENT '退出金额本月变动-11',
      acc_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '回款金额累计-12',
      change_receive DECIMAL(30,10) NULL DEFAULT NULL COMMENT '回款金额本月变动-13',
      project VARCHAR(300) NULL DEFAULT NULL COMMENT '项目名称-4',
      unrealized DECIMAL(30,10) NULL DEFAULT NULL COMMENT '未实现价值-14',
      change_unrealized DECIMAL(30,10) NULL DEFAULT 0 COMMENT '未实现价值变动-15',
      total_value DECIMAL(30,10) NULL DEFAULT NULL COMMENT '总价值-16',
      moc DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'MOC-17',
      dpi DECIMAL(30,10) NULL DEFAULT NULL COMMENT 'DPI-18',
      irr DECIMAL(20,10) NULL DEFAULT NULL COMMENT 'IRR-19',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='定开看板-基金投资组合明细汇总';
  `);
  // 为已存在的 b_investment / b_investment_sum 表补充 irr 字段（若缺失），或扩容已有字段
  try {
    const [irrCols] = await dbPool.query(`
      SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('b_investment', 'b_investment_sum')
      AND COLUMN_NAME = 'irr'
    `);
    const irrExisting = new Set(irrCols.map(c => c.TABLE_NAME));
    if (!irrExisting.has('b_investment')) {
      await dbPool.query(`ALTER TABLE b_investment ADD COLUMN irr DECIMAL(20,10) NULL DEFAULT NULL COMMENT 'IRR-25' AFTER acc_dividend`);
    } else {
      const col = irrCols.find(c => c.TABLE_NAME === 'b_investment');
      if (col && col.COLUMN_TYPE !== 'decimal(20,10)') {
        await dbPool.query(`ALTER TABLE b_investment MODIFY COLUMN irr DECIMAL(20,10) NULL DEFAULT NULL COMMENT 'IRR-25'`);
      }
    }
    if (!irrExisting.has('b_investment_sum')) {
      await dbPool.query(`ALTER TABLE b_investment_sum ADD COLUMN irr DECIMAL(20,10) NULL DEFAULT NULL COMMENT 'IRR-19' AFTER dpi`);
    } else {
      const col = irrCols.find(c => c.TABLE_NAME === 'b_investment_sum');
      if (col && col.COLUMN_TYPE !== 'decimal(20,10)') {
        await dbPool.query(`ALTER TABLE b_investment_sum MODIFY COLUMN irr DECIMAL(20,10) NULL DEFAULT NULL COMMENT 'IRR-19'`);
      }
    }
  } catch (err) {
    console.warn('检查/添加 b_investment/b_investment_sum irr 字段时出现了警告:', err.message);
  }
  // b_investment_sum: 补充 first_date 字段 + 注释编号顺延（-5→-06 ... -18→-19）
  try {
    const [sumCols] = await dbPool.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_investment_sum'
    `);
    const colMap = new Map(sumCols.map(c => [c.COLUMN_NAME, c]));

    // 1) 添加 first_date（若缺失）
    if (!colMap.has('first_date')) {
      await dbPool.query(`ALTER TABLE b_investment_sum ADD COLUMN first_date DATETIME NULL DEFAULT NULL COMMENT '首次投资日期-05' AFTER transaction_type`);
    }

    // 2) 注释编号顺延：旧编号 → 新编号（从大到小避免冲突）
    //    旧格式与 performanceExportColumnComments.js 一致（两位编号）
    const commentShifts = [
      ['irr',              'IRR-18',           'IRR-19'],
      ['dpi',              'DPI-17',           'DPI-18'],
      ['moc',              'MOC-16',           'MOC-17'],
      ['total_value',      '总价值-15',         '总价值-16'],
      ['change_unrealized','未实现价值变动-14',  '未实现价值变动-15'],
      ['unrealized',       '未实现价值-13',      '未实现价值-14'],
      ['change_receive',   '回款金额本月变动-12','回款金额本月变动-13'],
      ['acc_receive',      '回款金额累计-11',    '回款金额累计-12'],
      ['change_exit',      '退出金额本月变动-10','退出金额本月变动-11'],
      ['acc_exit',         '退出金额累计-09',    '退出金额累计-10'],
      ['change_paidin',    '实缴金额本月变动-08','实缴金额本月变动-09'],
      ['acc_paidin',       '实缴金额累计-07',    '实缴金额累计-08'],
      ['change_sub',       '认缴金额本月变动-06','认缴金额本月变动-07'],
      ['acc_sub',          '认缴金额累计-05',    '认缴金额累计-06'],
    ];
    for (const [colName, oldComment, newComment] of commentShifts) {
      const col = colMap.get(colName);
      if (!col) continue;
      // 仅当注释仍为旧值时才更新，避免重复执行
      if (col.COLUMN_COMMENT === oldComment) {
        const type = col.COLUMN_TYPE.toUpperCase();
        let def = '';
        if (colName === 'change_unrealized') {
          def = 'NULL DEFAULT 0';
        } else {
          def = 'NULL DEFAULT NULL';
        }
        await dbPool.query(`ALTER TABLE b_investment_sum MODIFY COLUMN \`${colName}\` ${col.COLUMN_TYPE} ${def} COMMENT '${newComment}'`);
      }
    }
  } catch (err) {
    console.warn('b_investment_sum first_date/注释编号迁移时出现了警告:', err.message);
  }
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
      version VARCHAR(300) NULL DEFAULT NULL COMMENT '版本号-02',
      b_date DATETIME NULL DEFAULT NULL COMMENT '时间条件-01',
      set_up_date DATETIME NULL DEFAULT NULL COMMENT '成立时间-05',
      inv_start DATETIME NULL DEFAULT NULL COMMENT '投资期开始日-06',
      ba_date DATETIME NULL DEFAULT NULL COMMENT '备案时间-07',
      ba_num VARCHAR(300) NULL DEFAULT NULL COMMENT '备案编号-08',
      sub_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴规模-09',
      sub_add DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本年新增认缴-10',
      paid_in_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '实缴规模-11',
      paid_in_add DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本年新增实缴-12',
      dis_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '累计分配金额-13',
      dis_add DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本年新增分配-14',
      F_Lock INT NULL DEFAULT 0 COMMENT '锁定状态',
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
      spv_num INT NULL DEFAULT NULL COMMENT 'SPV数量_备案',
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
  // 同步业绩看板导出表字段 COMMENT（含 -数字 排序标记）
  try {
    const { applyPerformanceExportColumnComments } = require('./utils/performanceExportColumnComments');
    await applyPerformanceExportColumnComments(dbPool);
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
      spv_num_desc TEXT NULL COMMENT 'SPV数量_备案',
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
      spv_paidin_acc_desc TEXT NULL COMMENT 'SPV累计投资金额',
      spv_receive_acc_desc TEXT NULL COMMENT 'SPV累计回款金额',
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
        "ALTER TABLE b_indicator_describe MODIFY COLUMN spv_num_desc TEXT NULL COMMENT 'SPV数量_备案'",
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
        "ALTER TABLE b_indicator_describe MODIFY COLUMN spv_paidin_acc_desc TEXT NULL COMMENT 'SPV累计投资金额'",
        "ALTER TABLE b_indicator_describe MODIFY COLUMN spv_receive_acc_desc TEXT NULL COMMENT 'SPV累计回款金额'",
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

  // b_indicator_describe 表若已存在则补充 spv_num_desc 列（若缺失）
  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_indicator_describe' AND COLUMN_NAME = 'spv_num_desc'
    `);
    if (cols.length === 0) {
      await dbPool.query(`ALTER TABLE b_indicator_describe ADD COLUMN spv_num_desc TEXT NULL COMMENT 'SPV数量_备案' AFTER dis_amount_desc`);
    }
  } catch (e) { /* ignore */ }

  // b_indicator_describe 表若已存在则补充 spv_paidin_acc_desc、spv_receive_acc_desc 列（若缺失）
  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_indicator_describe' AND COLUMN_NAME IN ('spv_paidin_acc_desc', 'spv_receive_acc_desc')
    `);
    const existing = new Set(cols.map(c => c.COLUMN_NAME));
    if (!existing.has('spv_paidin_acc_desc')) {
      await dbPool.query(`ALTER TABLE b_indicator_describe ADD COLUMN spv_paidin_acc_desc TEXT NULL COMMENT 'SPV累计投资金额' AFTER project_receive_acc_desc`);
    }
    if (!existing.has('spv_receive_acc_desc')) {
      await dbPool.query(`ALTER TABLE b_indicator_describe ADD COLUMN spv_receive_acc_desc TEXT NULL COMMENT 'SPV累计回款金额' AFTER spv_paidin_acc_desc`);
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
      changes_json MEDIUMTEXT NULL COMMENT '变更明细JSON：[{field,fieldLabel,oldVal,newVal}]',
      PRIMARY KEY (F_Id), INDEX idx_b_sql_id (b_sql_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='业绩看板-数据接口配置修改日志';
  `);

  // 兼容已有表：将 changes_json 从 TEXT 升级为 MEDIUMTEXT，防止大 SQL 变更日志写入时报 Data too long
  try {
    const [colRows] = await dbPool.query(
      `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_sql_change_log' AND COLUMN_NAME = 'changes_json'`
    );
    if (colRows.length > 0 && colRows[0].DATA_TYPE === 'text') {
      await dbPool.query('ALTER TABLE b_sql_change_log MODIFY COLUMN changes_json MEDIUMTEXT NULL');
    }
  } catch (e) { /* ignore */ }

  console.log('  → 进度：业绩看板 b_* 表列清理与注释同步（数据多时可能需数十秒）…');

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

  // b_manage_indicator 表：若已存在则补充 spv_num 列（若缺失）
  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_manage_indicator' AND COLUMN_NAME = 'spv_num'
    `);
    if (cols.length === 0) {
      await dbPool.query(`ALTER TABLE b_manage_indicator ADD COLUMN spv_num INT NULL DEFAULT NULL COMMENT 'SPV数量_备案'`);
    }
  } catch (e) { /* ignore */ }

  // b_manage 表：若已存在则补充 inv_start/ba_date/ba_num 列（若缺失），并修正原有字段注释编号
  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_manage' AND COLUMN_NAME IN ('inv_start', 'ba_date', 'ba_num')
    `);
    const existing = new Set(cols.map(c => c.COLUMN_NAME));
    if (!existing.has('inv_start')) {
      await dbPool.query(`ALTER TABLE b_manage ADD COLUMN inv_start DATETIME NULL DEFAULT NULL COMMENT '投资期开始日-06' AFTER set_up_date`);
    }
    if (!existing.has('ba_date')) {
      await dbPool.query(`ALTER TABLE b_manage ADD COLUMN ba_date DATETIME NULL DEFAULT NULL COMMENT '备案时间-07' AFTER inv_start`);
    }
    if (!existing.has('ba_num')) {
      await dbPool.query(`ALTER TABLE b_manage ADD COLUMN ba_num VARCHAR(300) NULL DEFAULT NULL COMMENT '备案编号-08' AFTER ba_date`);
    }
    // 修正原有字段注释编号
    await dbPool.query(`ALTER TABLE b_manage MODIFY COLUMN sub_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '认缴规模-09'`);
    await dbPool.query(`ALTER TABLE b_manage MODIFY COLUMN sub_add DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本年新增认缴-10'`);
    await dbPool.query(`ALTER TABLE b_manage MODIFY COLUMN paid_in_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '实缴规模-11'`);
    await dbPool.query(`ALTER TABLE b_manage MODIFY COLUMN paid_in_add DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本年新增实缴-12'`);
    await dbPool.query(`ALTER TABLE b_manage MODIFY COLUMN dis_amount DECIMAL(30,10) NULL DEFAULT NULL COMMENT '累计分配金额-13'`);
    await dbPool.query(`ALTER TABLE b_manage MODIFY COLUMN dis_add DECIMAL(30,10) NULL DEFAULT NULL COMMENT '本年新增分配-14'`);
  } catch (e) { /* ignore */ }

  // b_all_indicator 表：若已存在则补充 SPV 相关列（若缺失）
  try {
    const spvFields = ['spv_paidin', 'lm_spv_paidin', 'spv_paidin_change', 'spv_receive', 'lm_spv_receive', 'spv_receive_change'];
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_all_indicator' AND COLUMN_NAME IN (${spvFields.map(() => '?').join(',')})
    `, spvFields);
    const existing = new Set(cols.map(c => c.COLUMN_NAME));
    const addCol = (name, type, comment) => {
      if (!existing.has(name)) {
        return dbPool.query(`ALTER TABLE b_all_indicator ADD COLUMN ${name} ${type} NULL DEFAULT NULL COMMENT '${comment}'`);
      }
    };
    await addCol('spv_paidin', 'DECIMAL(30,10)', 'SPV累计投资金额');
    await addCol('lm_spv_paidin', 'DECIMAL(30,10)', '上月SPV累计投资金额');
    await addCol('spv_paidin_change', 'DECIMAL(30,10)', 'SPV累计投资金额变动');
    await addCol('spv_receive', 'DECIMAL(30,10)', 'SPV累计回款金额');
    await addCol('lm_spv_receive', 'DECIMAL(30,10)', '上月SPV累计回款金额');
    await addCol('spv_receive_change', 'DECIMAL(30,10)', 'SPV累计回款金额变动');
  } catch (e) { /* ignore */ }

  // b_all_indicator 表：补充直投上市/辅导/受理指标列（若缺失）
  try {
    const indicatorFields = ['ipo_num', 'ipo_cost', 'ipo_valuation', 'fd_num', 'fd_cost', 'fd_valuation', 'sl_num', 'sl_cost', 'sl_valuation'];
    const [indCols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'b_all_indicator' AND COLUMN_NAME IN (${indicatorFields.map(() => '?').join(',')})
    `, indicatorFields);
    const indExisting = new Set(indCols.map(c => c.COLUMN_NAME));
    const addIndCol = (name, type, comment) => {
      if (!indExisting.has(name)) {
        return dbPool.query(`ALTER TABLE b_all_indicator ADD COLUMN ${name} ${type} DEFAULT 0 COMMENT '${comment}'`);
      }
    };
    await addIndCol('ipo_num', 'INT', '直投上市项目个数');
    await addIndCol('ipo_cost', 'DECIMAL(30,2)', '直投上市项目累计成本');
    await addIndCol('ipo_valuation', 'DECIMAL(30,2)', '直投上市项目总价值');
    await addIndCol('fd_num', 'INT', '直投辅导项目个数');
    await addIndCol('fd_cost', 'DECIMAL(30,2)', '直投辅导项目累计成本');
    await addIndCol('fd_valuation', 'DECIMAL(30,2)', '直投辅导项目总价值');
    await addIndCol('sl_num', 'INT', '直投受理项目个数');
    await addIndCol('sl_cost', 'DECIMAL(30,2)', '直投受理项目累计成本');
    await addIndCol('sl_valuation', 'DECIMAL(30,2)', '直投受理项目总价值');
  } catch (e) { /* ignore */ }

  // 为已有的 b_* 表补齐列注释（除 b_sql、b_sql_change_log、b_indicator_describe 外）
  await ensureBTableComments(dbPool);
  console.log('  ✓ 业绩看板相关表列注释已检查');
  await ensureCoreSchemaComments(dbPool);
  console.log('  ✓ 核心业务表空字段注释已检查');

  // enterprise_sync_task 表：被投企业数据同步定时任务
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS enterprise_sync_task (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      db_config_id VARCHAR(19) NOT NULL COMMENT '外部数据库配置ID',
      data_app_name VARCHAR(64) NOT NULL DEFAULT '新闻舆情' COMMENT '同步目标应用：新闻舆情、项目挖掘（与 invested_enterprises.data_app_name 一致）',
      sql_query TEXT NOT NULL COMMENT 'SQL查询语句',
      cron_expression VARCHAR(100) NOT NULL COMMENT 'Cron表达式，如：0 0 * * *',
      description VARCHAR(500) COMMENT '任务描述',
      is_active TINYINT(1) DEFAULT 1 COMMENT '是否启用：1-启用，0-禁用',
      last_execution_time DATETIME NULL COMMENT '最后执行时间',
      last_execution_status VARCHAR(20) DEFAULT 'pending' COMMENT '最后执行状态：success/failed/pending',
      last_execution_message TEXT COMMENT '最后执行结果消息',
      execution_count INT DEFAULT 0 COMMENT '执行次数',
      F_CreatorUserId VARCHAR(19) COMMENT '创建人ID',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyUserId VARCHAR(19) COMMENT '修改人ID',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
      F_DeleteMark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      INDEX idx_db_config_id (db_config_id),
      INDEX idx_est_db_app (db_config_id, data_app_name),
      INDEX idx_is_active (is_active),
      INDEX idx_last_execution_time (last_execution_time),
      FOREIGN KEY (db_config_id) REFERENCES external_db_config(F_Id) ON DELETE CASCADE,
      FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_LastModifyUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  try {
    const [estDm] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enterprise_sync_task' AND COLUMN_NAME = 'delete_mark'
    `);
    if (estDm.length === 0) {
      await dbPool.query(`
        ALTER TABLE enterprise_sync_task
        ADD COLUMN delete_mark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER F_LastModifyTime,
        ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间' AFTER delete_mark,
        ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID' AFTER delete_time
      `);
      try {
        await dbPool.query(`
          ALTER TABLE enterprise_sync_task
          ADD CONSTRAINT enterprise_sync_task_fk_del_user FOREIGN KEY (delete_user_id) REFERENCES users(F_Id) ON DELETE SET NULL
        `);
      } catch (fkErr) {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn('迁移 enterprise_sync_task 删除字段时出现警告:', err.message);
  }

  try {
    const [estAppCol] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'enterprise_sync_task' AND COLUMN_NAME = 'data_app_name'
    `);
    if (estAppCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE enterprise_sync_task
        ADD COLUMN data_app_name VARCHAR(64) NOT NULL DEFAULT '新闻舆情' COMMENT '同步目标应用：新闻舆情、项目挖掘' AFTER db_config_id
      `);
      await dbPool.query(`
        ALTER TABLE enterprise_sync_task
        ADD INDEX idx_est_db_app (db_config_id, data_app_name)
      `).catch(() => {});
      console.log('  ✓ 已为 enterprise_sync_task 表添加 data_app_name 字段');
    }
  } catch (err) {
    console.warn('检查/添加 enterprise_sync_task.data_app_name 时出现警告:', err.message);
  }

  // performance_scheduled 表：业绩看板定时任务配置
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS performance_scheduled (
      F_Id VARCHAR(19) NOT NULL COMMENT '任务ID：年月日时分秒+5位自增序列',
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
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '修改时间',
      F_DeleteMark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      PRIMARY KEY (F_Id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='业绩看板-定时任务配置';
  `);

  try {
    const [psDm] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'performance_scheduled' AND COLUMN_NAME = 'delete_mark'
    `);
    if (psDm.length === 0) {
      await dbPool.query(`
        ALTER TABLE performance_scheduled
        ADD COLUMN delete_mark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER F_LastModifyTime,
        ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间' AFTER delete_mark,
        ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID' AFTER delete_time
      `);
    }
  } catch (err) {
    console.warn('迁移 performance_scheduled 删除字段时出现警告:', err.message);
  }

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

  // 检查并添加 invested_enterprises.entity_type（新闻列表 COALESCE(nd.entity_type, ie.entity_type) 依赖）
  try {
    const [ieEntityCols] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'invested_enterprises' 
      AND COLUMN_NAME = 'entity_type'
    `);

    if (ieEntityCols.length === 0) {
      await dbPool.query(`
        ALTER TABLE invested_enterprises 
        ADD COLUMN entity_type VARCHAR(50) NULL COMMENT '企业类型：被投企业、基金相关主体、子基金、子基金管理人、子基金GP' AFTER enterprise_full_name
      `);
      console.log('  ✓ 已为 invested_enterprises 表添加 entity_type 字段');
    }
  } catch (err) {
    console.warn('检查/添加 invested_enterprises.entity_type 时出现警告:', err.message);
  }

  // invested_enterprises.data_app_name / data_app_id：隔离新闻舆情与项目挖掘；业务过滤以 data_app_id（applications.id）为准，见 investedEnterpriseNewsAppSql
  try {
    const [ieAppCols] = await dbPool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'invested_enterprises' 
      AND COLUMN_NAME = 'data_app_name'
    `);

    if (ieAppCols.length === 0) {
      await dbPool.query(`
        ALTER TABLE invested_enterprises 
        ADD COLUMN data_app_name VARCHAR(64) NOT NULL DEFAULT '新闻舆情' COMMENT '所属应用：新闻舆情、项目挖掘' AFTER exit_status
      `);
      console.log('  ✓ 已为 invested_enterprises 表添加 data_app_name 字段');
    }
  } catch (err) {
    console.warn('检查/添加 invested_enterprises.data_app_name 时出现警告:', err.message);
  }

  // invested_enterprises 成本类字段（项目挖掘等场景）
  for (const { name, ddl } of [
    {
      name: 'investment_cost',
      ddl: `ADD COLUMN investment_cost DECIMAL(20,2) NULL COMMENT '投资成本' AFTER data_app_name`,
    },
    {
      name: 'exited_cost',
      ddl: `ADD COLUMN exited_cost DECIMAL(20,2) NULL COMMENT '已退出成本' AFTER investment_cost`,
    },
    {
      name: 'remaining_cost',
      ddl: `ADD COLUMN remaining_cost DECIMAL(20,2) NULL COMMENT '剩余成本' AFTER exited_cost`,
    },
    {
      name: 'residual_value',
      ddl: `ADD COLUMN residual_value DECIMAL(20,2) NULL COMMENT '剩余价值' AFTER remaining_cost`,
    },
  ]) {
    try {
      const [cols] = await dbPool.query(
        `
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invested_enterprises' AND COLUMN_NAME = ?
      `,
        [name]
      );
      if (cols.length === 0) {
        await dbPool.query(`ALTER TABLE invested_enterprises ${ddl}`);
        console.log(`  ✓ 已为 invested_enterprises 表添加 ${name} 字段`);
      }
    } catch (err) {
      console.warn(`检查/添加 invested_enterprises.${name} 时出现警告:`, err.message);
    }
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
    const { generateId } = require('./utils/idGenerator');
    const PS_C = require('./utils/project-sourcing/constants');
    const CA_C = require('./utils/competitor-analysis/constants');
    const APPS = {
      performance: { id: '2026031616180010001', name: '业绩看板', created_at: '2026-03-16 16:18:00' },
      news: { id: '2025112019132600001', name: '新闻舆情', created_at: '2025-11-20 19:13:31' },
      listing: { id: '2026033000000000001', name: '上市进展', created_at: '2026-03-30 18:00:00' },
      projectSourcing: {
        id: PS_C.PROJECT_SOURCING_APP_ID,
        name: PS_C.APP_NAME_PROJECT_SOURCING,
        created_at: PS_C.PROJECT_SOURCING_CREATED_AT,
      },
      competitorAnalysis: {
        id: CA_C.COMPETITOR_ANALYSIS_APP_ID,
        name: CA_C.APP_NAME_COMPETITOR_ANALYSIS,
        created_at: CA_C.COMPETITOR_ANALYSIS_CREATED_AT,
      },
    };

    async function remapMembershipLevelReferences(fromLevelId, toLevelId) {
      if (!fromLevelId || !toLevelId || fromLevelId === toLevelId) return;

      await dbPool.execute('UPDATE users SET membership_level_id = ? WHERE membership_level_id = ?', [
        toLevelId,
        fromLevelId,
      ]);

      const [permUsers] = await dbPool.query(
        `SELECT F_Id AS id, app_permissions FROM users
         WHERE app_permissions IS NOT NULL
           AND app_permissions <> ''`
      );
      for (const user of permUsers) {
        let parsed;
        try {
          parsed = JSON.parse(user.app_permissions);
        } catch (e) {
          continue;
        }
        if (!Array.isArray(parsed)) continue;
        let changed = false;
        const nextPermissions = parsed.map((perm) => {
          if (perm && perm.membership_level_id === fromLevelId) {
            changed = true;
            return { ...perm, membership_level_id: toLevelId };
          }
          return perm;
        });
        if (changed) {
          await dbPool.execute('UPDATE users SET app_permissions = ? WHERE F_Id = ?', [
            JSON.stringify(nextPermissions),
            user.id,
          ]);
        }
      }
    }

    async function remapAppRelations(fromId, toId) {
      if (!fromId || !toId || fromId === toId) return;

      // email_config: app_id 唯一，避免冲突
      const [toEmail] = await dbPool.query('SELECT F_Id AS id FROM email_config WHERE app_id = ? LIMIT 1', [toId]);
      if (toEmail.length > 0) {
        await dbPool.execute('DELETE FROM email_config WHERE app_id = ?', [fromId]);
      } else {
        await dbPool.execute('UPDATE email_config SET app_id = ? WHERE app_id = ?', [toId, fromId]);
      }

      // qichacha_config: (app_id, interface_type) 唯一，逐类型迁移避免冲突
      const [fromQc] = await dbPool.query('SELECT F_Id AS id, interface_type FROM qichacha_config WHERE app_id = ?', [fromId]);
      for (const row of fromQc) {
        const [dupQc] = await dbPool.query(
          'SELECT F_Id AS id FROM qichacha_config WHERE app_id = ? AND interface_type = ? LIMIT 1',
          [toId, row.interface_type]
        );
        if (dupQc.length > 0) {
          await dbPool.execute('DELETE FROM qichacha_config WHERE F_Id = ?', [row.id]);
        } else {
          await dbPool.execute('UPDATE qichacha_config SET app_id = ? WHERE F_Id = ?', [toId, row.id]);
        }
      }

      // membership_levels：(app_id, level_name) 唯一；批量 UPDATE app_id 会与目标应用已有等级撞键
      const [fromLevels] = await dbPool.query(
        'SELECT F_Id AS id, level_name FROM membership_levels WHERE app_id = ?',
        [fromId]
      );
      for (const lvl of fromLevels) {
        const [dupLvl] = await dbPool.query(
          `SELECT F_Id AS id FROM membership_levels
           WHERE app_id = ? AND CAST(level_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci =
                 CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
           LIMIT 1`,
          [toId, lvl.level_name]
        );
        if (dupLvl.length > 0) {
          await remapMembershipLevelReferences(lvl.id, dupLvl[0].id);
          await dbPool.execute('DELETE FROM membership_levels WHERE F_Id = ?', [lvl.id]);
        } else {
          await dbPool.execute('UPDATE membership_levels SET app_id = ? WHERE F_Id = ?', [toId, lvl.id]);
        }
      }

      await dbPool.execute('UPDATE news_interface_config SET app_id = ? WHERE app_id = ?', [toId, fromId]);
      await dbPool.execute('UPDATE recipient_management SET app_id = ? WHERE app_id = ?', [toId, fromId]);

      const [toSig] = await dbPool.query('SELECT F_Id AS id FROM shanghai_international_group_config WHERE app_id = ? LIMIT 1', [toId]);
      if (toSig.length > 0) {
        await dbPool.execute('DELETE FROM shanghai_international_group_config WHERE app_id = ?', [fromId]);
      } else {
        await dbPool.execute('UPDATE shanghai_international_group_config SET app_id = ? WHERE app_id = ?', [toId, fromId]);
      }
    }

    async function ensureCanonicalApp(app) {
      const [byId] = await dbPool.query('SELECT F_Id AS id, app_name FROM applications WHERE F_Id = ? LIMIT 1', [app.id]);
      if (byId.length > 0) {
        if (byId[0].app_name !== app.name) {
          await dbPool.execute('UPDATE applications SET app_name = ?, F_CreatorTime = ? WHERE F_Id = ?', [
            app.name,
            app.created_at,
            app.id,
          ]);
        }
        return;
      }

      const [byName] = await dbPool.query(
        'SELECT F_Id AS id, app_name FROM applications WHERE BINARY app_name = BINARY ? LIMIT 1',
        [app.name]
      );
      if (byName.length > 0) {
        const oldId = byName[0].id;
        if (oldId === app.id) return;
        // app_name 有 UNIQUE：INSERT IGNORE 会因同名已存在而跳过插入，导致标准 id 不存在，后续 UPDATE membership_levels 外键失败
        await dbPool.execute(
          `UPDATE applications SET app_name = CONCAT('__migrate_app_', F_Id) WHERE F_Id = ?`,
          [oldId]
        );
        await dbPool.execute('INSERT INTO applications (F_Id, app_name, F_CreatorTime) VALUES (?, ?, ?)', [
          app.id,
          app.name,
          app.created_at,
        ]);
        await remapAppRelations(oldId, app.id);
        await dbPool.execute('DELETE FROM applications WHERE F_Id = ?', [oldId]);
        return;
      }

      await dbPool.execute('INSERT IGNORE INTO applications (F_Id, app_name, F_CreatorTime) VALUES (?, ?, ?)', [
        app.id,
        app.name,
        app.created_at,
      ]);
    }

    console.log('  → 校验标准应用记录…');
    await ensureCanonicalApp(APPS.performance);
    await ensureCanonicalApp(APPS.news);
    await ensureCanonicalApp(APPS.listing);
    await ensureCanonicalApp(APPS.projectSourcing);
    await ensureCanonicalApp(APPS.competitorAnalysis);
    console.log('  ✓ 标准应用记录已校验');

    // 竞品分析应用：从项目挖掘迁出 data_app_id / data_app_name（新闻舆情行不动）
    console.log('  → 竞品分析 data_app 迁移…');
    try {
      const psId = APPS.projectSourcing.id;
      const caId = APPS.competitorAnalysis.id;
      const caName = APPS.competitorAnalysis.name;
      const [ieM] = await dbPool.query(
        `UPDATE invested_enterprises
         SET data_app_id = ?, data_app_name = ?
         WHERE F_DeleteMark = 0
           AND (data_app_id = ? OR (data_app_id IS NULL AND data_app_name = ?))`,
        [caId, caName, psId, PS_C.APP_NAME_PROJECT_SOURCING]
      );
      if (ieM.affectedRows) console.log(`  ✓ invested_enterprises 已迁移 ${ieM.affectedRows} 行至竞品分析`);
      const [ipoM] = await dbPool.query(`UPDATE ipo_project SET data_app_id = ? WHERE data_app_id = ?`, [
        caId,
        psId,
      ]);
      if (ipoM.affectedRows) console.log(`  ✓ ipo_project 已迁移 ${ipoM.affectedRows} 行至竞品分析`);
      const [preM] = await dbPool.query(
        `UPDATE pre_investment_project
         SET data_app_id = ?, data_app_name = ?
         WHERE F_DeleteMark = 0 AND (data_app_id = ? OR data_app_name = ?)`,
        [caId, caName, psId, PS_C.APP_NAME_PROJECT_SOURCING]
      );
      if (preM.affectedRows) console.log(`  ✓ pre_investment_project 已迁移 ${preM.affectedRows} 行至竞品分析`);
      await dbPool.query(
        `UPDATE ipo_project_sql_sync_setting SET write_target = ? WHERE write_target = ?`,
        [CA_C.IPO_SQL_WRITE_TARGET_COMPETITOR, 'project_sourcing']
      ).catch(() => {});
    } catch (migErr) {
      console.warn('  竞品分析 data_app 迁移时出现警告:', migErr.message);
    }

    console.log('  → 竞品分析被投企业去重…');
    try {
      const [dedupeFlag] = await dbPool.query(
        `SELECT config_value FROM system_config WHERE config_key = 'migration_competitor_ie_dedupe_v1' LIMIT 1`
      );
      if (dedupeFlag.length > 0 && String(dedupeFlag[0].config_value) === '1') {
        console.log('  ✓ 竞品分析被投企业去重已跳过（此前已完成）');
      } else {
        const { dedupeCompetitorInvestedEnterprises } = require('./utils/competitor-analysis/investedEnterpriseDedupe');
        const deduped = await dedupeCompetitorInvestedEnterprises(dbPool);
        const flagId = await generateId('system_config', dbPool);
        await dbPool.execute(
          `INSERT INTO system_config (F_Id, config_key, config_value, config_desc)
           VALUES (?, 'migration_competitor_ie_dedupe_v1', '1', '竞品分析被投企业去重已完成')
           ON DUPLICATE KEY UPDATE config_value = '1', F_LastModifyTime = CURRENT_TIMESTAMP`,
          [flagId]
        );
        if (deduped > 0) {
          console.log(`  ✓ 竞品分析被投企业去重：已删除重复行 ${deduped} 条（信用代码/企业全称/项目简称）`);
        } else {
          console.log('  ✓ 竞品分析被投企业去重：未发现重复行');
        }
      }
    } catch (dedupeErr) {
      console.warn('  竞品分析被投企业去重时出现警告:', dedupeErr.message);
    }

    // 竞品分析：从项目挖掘复制 enterprise_sync_task（同库同用户各一条，供定时同步写入竞品分析）
    try {
      const psName = PS_C.APP_NAME_PROJECT_SOURCING;
      const caName = CA_C.APP_NAME_COMPETITOR_ANALYSIS;
      const [psSyncTasks] = await dbPool.query(
        `SELECT * FROM enterprise_sync_task WHERE data_app_name = ? AND F_DeleteMark = 0`,
        [psName]
      );
      let syncCopied = 0;
      for (const t of psSyncTasks) {
        const [exists] = await dbPool.query(
          `SELECT F_Id FROM enterprise_sync_task
           WHERE db_config_id = ? AND F_CreatorUserId <=> ? AND data_app_name = ? AND F_DeleteMark = 0`,
          [t.db_config_id, t.F_CreatorUserId, caName]
        );
        if (exists.length) continue;
        const newId = await generateId('enterprise_sync_task');
        await dbPool.execute(
          `INSERT INTO enterprise_sync_task
           (F_Id, db_config_id, data_app_name, sql_query, cron_expression, description, is_active,
            last_execution_time, last_execution_status, last_execution_message, execution_count,
            F_CreatorUserId, F_LastModifyUserId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId,
            t.db_config_id,
            caName,
            t.sql_query,
            t.cron_expression,
            t.description || '',
            t.is_active,
            t.last_execution_time,
            t.last_execution_status,
            t.last_execution_message,
            t.execution_count,
            t.F_CreatorUserId,
            t.F_CreatorUserId,
          ]
        );
        syncCopied += 1;
      }
      if (syncCopied > 0) {
        console.log(`  ✓ 已从项目挖掘复制 ${syncCopied} 条被投企业定时同步任务至竞品分析`);
      }
    } catch (syncMigErr) {
      console.warn('  复制竞品分析 enterprise_sync_task 时出现警告:', syncMigErr.message);
    }

    // 迁移历史“业绩看板/业绩看板应用/业绩应用看板/股权投资小工具锦集”等别名到标准业绩看板应用
    console.log('  → 归并历史业绩看板应用…');
    const [legacyPerfApps] = await dbPool.query(
      `SELECT F_Id AS id, app_name FROM applications
       WHERE F_Id <> ?
         AND (
           app_name LIKE '%业绩看板%'
           OR app_name LIKE '%业绩应用看板%'
           OR BINARY app_name = BINARY '业绩看板应用'
           OR BINARY app_name = BINARY '股权投资小工具锦集'
         )`,
      [APPS.performance.id]
    );
    for (const app of legacyPerfApps) {
      await remapAppRelations(app.id, APPS.performance.id);
      await dbPool.execute('DELETE FROM applications WHERE F_Id = ?', [app.id]);
      console.log(`  ✓ 已归并历史应用 ${app.app_name}(${app.id}) -> 业绩看板(${APPS.performance.id})`);
    }

    // 兜底：membership_levels 中 app_id 为空，统一补为新闻舆情（历史默认应用）
    await dbPool.execute('UPDATE membership_levels SET app_id = ? WHERE app_id IS NULL', [APPS.news.id]);

    // 统一会员等级：以“新闻舆情”应用为模板，同步到其他应用并去重
    console.log('  → 统一各应用会员等级…');
    const defaultLevelTemplate = [
      { level_name: '普通会员', validity_days: 30 },
      { level_name: '高级会员', validity_days: 90 },
      { level_name: 'VIP会员', validity_days: 365 },
    ];
    let levelTemplate = defaultLevelTemplate;

    const [newsTemplateRows] = await dbPool.query(
      `SELECT level_name, validity_days
       FROM membership_levels
       WHERE app_id = ?
       ORDER BY validity_days ASC, F_CreatorTime ASC`,
      [APPS.news.id]
    );
    if (newsTemplateRows.length > 0) {
      // 新闻舆情已有配置时，按其等级设计做全应用统一
      const dedup = new Map();
      for (const row of newsTemplateRows) {
        if (!dedup.has(row.level_name)) dedup.set(row.level_name, Number(row.validity_days || 0));
      }
      levelTemplate = Array.from(dedup.entries()).map(([level_name, validity_days]) => ({ level_name, validity_days }));
    } else {
      // 新闻舆情无历史等级时，先补默认模板
      for (const level of defaultLevelTemplate) {
        const newId = await generateId('membership_levels', dbPool);
        await dbPool.execute(
          'INSERT INTO membership_levels (F_Id, level_name, validity_days, app_id) VALUES (?, ?, ?, ?)',
          [newId, level.level_name, level.validity_days, APPS.news.id]
        );
      }
      console.log('  ✓ 新闻舆情会员等级模板已初始化');
    }

    async function ensureAppMembershipLevels(appId, appName) {
      // 1) 先确保模板等级存在
      for (const level of levelTemplate) {
        const [sameNameRows] = await dbPool.query(
          `SELECT F_Id AS id, validity_days, F_CreatorTime
           FROM membership_levels
           WHERE app_id = ? AND level_name = ?
           ORDER BY F_CreatorTime ASC, F_Id ASC`,
          [appId, level.level_name]
        );

        if (sameNameRows.length === 0) {
          const newId = await generateId('membership_levels', dbPool);
          await dbPool.execute(
            'INSERT INTO membership_levels (F_Id, level_name, validity_days, app_id) VALUES (?, ?, ?, ?)',
            [newId, level.level_name, level.validity_days, appId]
          );
          continue;
        }

        // 2) 保留首条，修正有效期，删除同名重复
        const keeper = sameNameRows[0];
        if (Number(keeper.validity_days) !== Number(level.validity_days)) {
          await dbPool.execute('UPDATE membership_levels SET validity_days = ? WHERE F_Id = ?', [
            level.validity_days,
            keeper.id,
          ]);
        }
        for (let i = 1; i < sameNameRows.length; i += 1) {
          await remapMembershipLevelReferences(sameNameRows[i].id, keeper.id);
          await dbPool.execute('DELETE FROM membership_levels WHERE F_Id = ?', [sameNameRows[i].id]);
        }
      }

      // 3) 全量兜底去重：同 app + 同等级名 只保留一条（避免历史脏数据）
      const [dups] = await dbPool.query(
        `SELECT level_name, MIN(F_Id) AS keep_id, COUNT(*) AS c
         FROM membership_levels
         WHERE app_id = ?
         GROUP BY level_name
         HAVING c > 1`,
        [appId]
      );
      for (const dup of dups) {
        const [dupRows] = await dbPool.query(
          `SELECT F_Id AS id FROM membership_levels
           WHERE app_id = ? AND level_name = ? AND F_Id <> ?`,
          [appId, dup.level_name, dup.keep_id]
        );
        for (const row of dupRows) {
          await remapMembershipLevelReferences(row.id, dup.keep_id);
        }
        await dbPool.execute(
          'DELETE FROM membership_levels WHERE app_id = ? AND level_name = ? AND F_Id <> ?',
          [appId, dup.level_name, dup.keep_id]
        );
      }

      console.log(`  ✓ ${appName} 会员等级已按新闻舆情模板统一`);
    }

    await ensureAppMembershipLevels(APPS.news.id, APPS.news.name);
    await ensureAppMembershipLevels(APPS.performance.id, APPS.performance.name);
    await ensureAppMembershipLevels(APPS.listing.id, APPS.listing.name);
    await ensureAppMembershipLevels(APPS.projectSourcing.id, APPS.projectSourcing.name);
    await ensureAppMembershipLevels(APPS.competitorAnalysis.id, APPS.competitorAnalysis.name);

    // 竞品分析：从项目挖掘复制企查查配置（按 interface_type 去重）
    try {
      const caId = APPS.competitorAnalysis.id;
      const psId = APPS.projectSourcing.id;
      const [fromQc] = await dbPool.query('SELECT * FROM qichacha_config WHERE app_id = ?', [psId]);
      for (const row of fromQc) {
        const [dup] = await dbPool.query(
          'SELECT F_Id AS id FROM qichacha_config WHERE app_id = ? AND interface_type = ? LIMIT 1',
          [caId, row.interface_type]
        );
        if (dup.length) continue;
        const newId = await generateId('qichacha_config', dbPool);
        await dbPool.execute(
          `INSERT INTO qichacha_config (
            id, app_id, qichacha_app_key, qichacha_secret_key, qichacha_daily_limit, interface_type
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            newId,
            caId,
            row.qichacha_app_key,
            row.qichacha_secret_key,
            row.qichacha_daily_limit,
            row.interface_type,
          ]
        );
      }
      console.log('  ✓ 竞品分析企查查配置已从项目挖掘模板复制（如有）');
    } catch (qcErr) {
      console.warn('  复制竞品分析企查查配置时出现警告:', qcErr.message);
    }

    // 防止后续重复写入：同应用下等级名称唯一
    const [lvlUniqIdx] = await dbPool.query(
      `SHOW INDEX FROM membership_levels WHERE Key_name = 'uk_membership_levels_app_level'`
    );
    if (lvlUniqIdx.length === 0) {
      await dbPool.query(
        `ALTER TABLE membership_levels
         ADD UNIQUE KEY uk_membership_levels_app_level (app_id, level_name)`
      );
      console.log('  ✓ membership_levels 已添加唯一索引(app_id, level_name)');
    }

  } catch (err) {
    // 不可向上抛出：否则后续建表（如 news_share_links）与迁移不会执行，导致新库表不完整
    console.error('  初始化基础数据时出错:', err.message);
    console.error('  错误堆栈:', err.stack);
    console.warn('  将继续执行后续表结构与迁移；请根据上述错误修复数据或清空相关表后重试。');
  }

  // 创建默认 admin 账号（如果不存在）
  try {
    // 检查并创建默认 admin 账号
    const bcrypt = require('bcrypt');
    const { generateId } = require('./utils/idGenerator');
    const [adminUsers] = await dbPool.query('SELECT F_Id AS id FROM users WHERE account = ?', ['admin']);
    if (adminUsers.length === 0) {
      const hashedPassword = await bcrypt.hash('wenchao', 10);
      const adminId = await generateId('users', dbPool);
      console.log(`  生成admin用户ID: ${adminId}`);
      await dbPool.execute(
        'INSERT INTO users (F_Id, account, phone, email, password, role, account_status) VALUES (?, ?, ?, ?, ?, ?, ?)',
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
      "SELECT F_Id AS id FROM applications WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci LIMIT 1",
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
        'INSERT INTO qichacha_config (F_Id, app_id, qichacha_app_key, qichacha_secret_key, qichacha_daily_limit, interface_type) VALUES (?, ?, ?, ?, ?, ?)',
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
              await dbPool.query('ALTER TABLE news_interface_config ADD CONSTRAINT fk_news_interface_config_app_id FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE');
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
        ADD COLUMN usage_type ENUM('content_analysis', 'image_recognition', 'project_mining') DEFAULT 'content_analysis' COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别，project_mining-项目挖掘'
        AFTER application_type
      `);
      console.log('✓ 已为 ai_model_config 表添加 usage_type 字段');
    }
  } catch (err) {
    console.warn('迁移ai_model_config表usage_type字段时出现警告:', err.message);
  }

  // 扩展 ai_model_config.usage_type：项目挖掘大模型
  try {
    const [ut] = await dbPool.query(`
      SELECT COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_model_config'
        AND COLUMN_NAME = 'usage_type'
      LIMIT 1
    `);
    const ct = ut.length ? String(ut[0].COLUMN_TYPE || '') : '';
    if (ct && !ct.includes('project_mining')) {
      await dbPool.query(`
        ALTER TABLE ai_model_config
        MODIFY COLUMN usage_type ENUM('content_analysis','image_recognition','project_mining')
        DEFAULT 'content_analysis'
        COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别，project_mining-项目挖掘'
      `);
      console.log('✓ ai_model_config.usage_type 已扩展 project_mining');
    }
  } catch (err) {
    console.warn('迁移 ai_model_config.usage_type 扩展 project_mining 时出现警告:', err.message);
  }

  // 扩展 ai_model_config.usage_type：上市数据（打新日历企业全称等）
  try {
    const [utListing] = await dbPool.query(`
      SELECT COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_model_config'
        AND COLUMN_NAME = 'usage_type'
      LIMIT 1
    `);
    const ctListing = utListing.length ? String(utListing[0].COLUMN_TYPE || '') : '';
    if (ctListing && !ctListing.includes('listing_data')) {
      await dbPool.query(`
        ALTER TABLE ai_model_config
        MODIFY COLUMN usage_type ENUM('content_analysis','image_recognition','project_mining','listing_data')
        DEFAULT 'content_analysis'
        COMMENT '用途类型：content_analysis-内容分析，image_recognition-图片识别，project_mining-项目挖掘，listing_data-上市数据'
      `);
      console.log('✓ ai_model_config.usage_type 已扩展 listing_data（上市数据）');
    }
  } catch (err) {
    console.warn('迁移 ai_model_config.usage_type 扩展 listing_data 时出现警告:', err.message);
  }

  // 扩展 ai_model_config.application_type：与前端 AI 模型配置「应用类型」一致（原仅 news_analysis/general，选上市进展分析会写入失败）
  try {
    const [atCol] = await dbPool.query(`
      SELECT COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_model_config'
        AND COLUMN_NAME = 'application_type'
      LIMIT 1
    `);
    const atType = atCol.length ? String(atCol[0].COLUMN_TYPE || '') : '';
    if (atType && !atType.includes('listing_progress_analysis')) {
      await dbPool.query(`
        ALTER TABLE ai_model_config
        MODIFY COLUMN application_type ENUM(
          'news_analysis',
          'general',
          'project_sourcing_analysis',
          'listing_progress_analysis'
        )
        DEFAULT 'news_analysis'
        COMMENT '应用类型：新闻分析/通用/项目挖掘分析/上市进展分析'
      `);
      console.log('✓ ai_model_config.application_type 已扩展 project_sourcing_analysis、listing_progress_analysis');
    }
    const [atCol2] = await dbPool.query(`
      SELECT COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_model_config'
        AND COLUMN_NAME = 'application_type'
      LIMIT 1
    `);
    const atType2 = atCol2.length ? String(atCol2[0].COLUMN_TYPE || '') : '';
    if (atType2 && !atType2.includes('competitor_analysis')) {
      // 先扩展 ENUM（临时保留旧值 project_sourcing_competitor），再回填，避免 Data truncated
      const enumWithLegacy = atType2.includes('project_sourcing_competitor')
        ? `'news_analysis','general','project_sourcing_analysis','listing_progress_analysis','competitor_analysis','project_sourcing_competitor'`
        : `'news_analysis','general','project_sourcing_analysis','listing_progress_analysis','competitor_analysis'`;
      await dbPool.query(`
        ALTER TABLE ai_model_config
        MODIFY COLUMN application_type ENUM(${enumWithLegacy})
        DEFAULT 'news_analysis'
        COMMENT '应用类型：含竞品分析应用 competitor_analysis'
      `);
      if (atType2.includes('project_sourcing_competitor')) {
        await dbPool.query(
          `UPDATE ai_model_config SET application_type = 'competitor_analysis' WHERE application_type = 'project_sourcing_competitor'`
        );
        await dbPool.query(`
          ALTER TABLE ai_model_config
          MODIFY COLUMN application_type ENUM(
            'news_analysis',
            'general',
            'project_sourcing_analysis',
            'listing_progress_analysis',
            'competitor_analysis'
          )
          DEFAULT 'news_analysis'
          COMMENT '应用类型：含竞品分析应用 competitor_analysis'
        `);
      }
      console.log('✓ ai_model_config.application_type 已迁移为 competitor_analysis');
    }
    const [fixCa] = await dbPool.query(
      `UPDATE ai_model_config
       SET application_type = 'competitor_analysis'
       WHERE F_DeleteMark = 0
         AND usage_type = 'competitor_match'
         AND application_type = 'project_sourcing_competitor'`
    );
    if (fixCa.affectedRows) {
      console.log(`  ✓ 已将 ${fixCa.affectedRows} 条竞品匹配配置的 application_type 更正为 competitor_analysis`);
    }
    await dbPool.query(
      `UPDATE base_dictionary SET F_DeleteMark = 1, is_enabled = 0
       WHERE parent_id IN (
         SELECT rid FROM (
           SELECT F_Id AS rid FROM base_dictionary WHERE dict_code = 'ai_model_application_type' AND parent_id IS NULL AND F_DeleteMark = 0 LIMIT 1
         ) t
       ) AND item_code = 'project_sourcing_competitor' AND F_DeleteMark = 0`
    ).catch(() => {});
  } catch (err) {
    console.warn('迁移 ai_model_config.application_type 扩展时出现警告:', err.message);
  }

  // 扩展 ai_model_config.usage_type：竞品匹配
  try {
    const [utComp] = await dbPool.query(`
      SELECT COLUMN_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_model_config'
        AND COLUMN_NAME = 'usage_type'
      LIMIT 1
    `);
    const ctComp = utComp.length ? String(utComp[0].COLUMN_TYPE || '') : '';
    if (ctComp && !ctComp.includes('competitor_match')) {
      const base = ctComp.includes('listing_data')
        ? `'content_analysis','image_recognition','project_mining','listing_data','competitor_match'`
        : ctComp.includes('project_mining')
          ? `'content_analysis','image_recognition','project_mining','competitor_match'`
          : `'content_analysis','image_recognition','competitor_match'`;
      await dbPool.query(`
        ALTER TABLE ai_model_config
        MODIFY COLUMN usage_type ENUM(${base})
        DEFAULT 'content_analysis'
        COMMENT '用途类型（含竞品匹配 competitor_match）'
      `);
      console.log('✓ ai_model_config.usage_type 已扩展 competitor_match');
    }
  } catch (err) {
    console.warn('迁移 ai_model_config.usage_type 扩展 competitor_match 时出现警告:', err.message);
  }
  
  // 创建舆情信息分享链接表
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS news_share_links (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID：年月日时分秒+5位自增序列',
      user_id VARCHAR(19) NOT NULL COMMENT '创建用户ID',
      share_token VARCHAR(64) NOT NULL UNIQUE COMMENT '分享链接token',
      status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态：active-启用，inactive-禁用',
      has_expiry TINYINT(1) DEFAULT 0 COMMENT '是否有有效期：1-是，0-否',
      expiry_time DATETIME NULL COMMENT '有效期至',
      has_password TINYINT(1) DEFAULT 0 COMMENT '是否有密码：1-是，0-否',
      password_hash VARCHAR(255) NULL COMMENT '密码哈希值',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      F_DeleteMark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
      F_DeleteTime DATETIME NULL COMMENT '删除时间',
      F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
      INDEX idx_user_id (user_id),
      INDEX idx_share_token (share_token),
      INDEX idx_status (status),
      FOREIGN KEY (user_id) REFERENCES users(F_Id) ON DELETE CASCADE,
      FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 上市进展：项目进展分享链接（与 news_share_links 结构类似，独立表）
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS listing_share_links (
      F_Id VARCHAR(19) PRIMARY KEY COMMENT '数据ID',
      user_id VARCHAR(19) NOT NULL COMMENT '创建用户ID',
      share_token VARCHAR(64) NOT NULL UNIQUE COMMENT '分享令牌',
      status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/inactive',
      has_expiry TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用过期时间',
      expiry_time DATETIME NULL COMMENT '过期时间',
      has_password TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用访问密码',
      password_hash VARCHAR(255) NULL COMMENT '访问密码哈希',
      F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      INDEX idx_listing_share_user (user_id),
      INDEX idx_listing_share_status (status),
      FOREIGN KEY (user_id) REFERENCES users(F_Id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上市进展项目进展分享链接';
  `);

  try {
    const [nslDm] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'news_share_links' AND COLUMN_NAME = 'delete_mark'
    `);
    if (nslDm.length === 0) {
      await dbPool.query(`
        ALTER TABLE news_share_links
        ADD COLUMN delete_mark TINYINT(1) DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER F_LastModifyTime,
        ADD COLUMN delete_time DATETIME NULL COMMENT '删除时间' AFTER delete_mark,
        ADD COLUMN delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID' AFTER delete_time
      `);
      try {
        await dbPool.query(`
          ALTER TABLE news_share_links
          ADD CONSTRAINT news_share_links_fk_del_user FOREIGN KEY (delete_user_id) REFERENCES users(F_Id) ON DELETE SET NULL
        `);
      } catch (fkErr) {
        /* ignore */
      }
    }
  } catch (err) {
    console.warn('迁移 news_share_links 删除字段时出现警告:', err.message);
  }

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

  // ========== 上市进展：业务表与 recipient_management.app_id ==========
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS ipo_progress (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        F_CreatorTime DATE NOT NULL COMMENT '入库日期（北京时间）',
        F_UpdateTime DATETIME NOT NULL COMMENT '交易所侧更新日期时间',
        code VARCHAR(20) NOT NULL DEFAULT '' COMMENT '证券代码',
        project_name TEXT NOT NULL COMMENT '项目简称',
        status VARCHAR(50) NOT NULL COMMENT '审核状态',
        register_address VARCHAR(200) NOT NULL DEFAULT '' COMMENT '注册地',
        receive_date DATE NULL COMMENT '受理日期',
        company TEXT NOT NULL COMMENT '公司全称',
        board VARCHAR(20) NOT NULL COMMENT '板块',
        exchange VARCHAR(100) NOT NULL DEFAULT '' COMMENT '交易所/拟上市地',
        F_CreatorUserId VARCHAR(19) NULL COMMENT '创建用户ID',
        F_LastModifyUserId VARCHAR(19) NULL COMMENT '修改用户ID',
        F_LastModifyTime DATETIME NULL COMMENT '修改时间',
        F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除状态：0未删除，1已删除',
        F_DeleteTime DATETIME NULL COMMENT '删除时间',
        KEY idx_ipo_progress_f_update_time (F_UpdateTime),
        KEY idx_ipo_progress_delete (F_DeleteMark)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上市进展（交易所爬取）';
    `);
    console.log('✓ ipo_progress 表已就绪');
  } catch (err) {
    console.warn('创建 ipo_progress 表时出现警告:', err.message);
  }

  const addIpoProgressCol = async (name, ddl) => {
    try {
      const [c] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_progress' AND COLUMN_NAME = ?`,
        [name]
      );
      if (c.length === 0) {
        await dbPool.query(`ALTER TABLE ipo_progress ${ddl}`);
        console.log(`  ✓ 已为 ipo_progress 表添加 ${name} 字段`);
        return true;
      }
      return false;
    } catch (err) {
      console.warn(`检查/添加 ipo_progress.${name} 时出现警告:`, err.message);
      return false;
    }
  };

  try {
    await addIpoProgressCol(
      'exchange_project_id',
      `ADD COLUMN exchange_project_id VARCHAR(64) NULL COMMENT '所侧项目ID' AFTER exchange`
    );
    const addedTimelineConfirmed = await addIpoProgressCol(
      'timeline_confirmed',
      `ADD COLUMN timeline_confirmed TINYINT(1) NOT NULL DEFAULT 0 COMMENT '详情时间轴已确认' AFTER exchange_project_id`
    );
    await addIpoProgressCol(
      'timeline_confirmed_at',
      `ADD COLUMN timeline_confirmed_at DATETIME NULL COMMENT '详情确认时间（匹配主窗）' AFTER timeline_confirmed`
    );
    if (addedTimelineConfirmed) {
      await dbPool.query(`
        UPDATE ipo_progress
        SET timeline_confirmed = 1,
            timeline_confirmed_at = COALESCE(F_LastModifyTime, F_UpdateTime)
        WHERE timeline_confirmed = 0
      `);
      console.log('  ✓ 已迁移历史 ipo_progress 行为 timeline_confirmed=1');
    }

    // 港交所无内地详情时间轴确认：历史未确认行一次性回填
    const [hkConfirmResult] = await dbPool.query(`
      UPDATE ipo_progress
      SET timeline_confirmed = 1,
          timeline_confirmed_at = COALESCE(timeline_confirmed_at, F_LastModifyTime, F_UpdateTime, NOW())
      WHERE F_DeleteMark = 0
        AND exchange IN ('港交所', '香港联交所')
        AND COALESCE(timeline_confirmed, 0) = 0
    `);
    const hkConfirmFixed = Number(hkConfirmResult?.affectedRows || 0);
    if (hkConfirmFixed > 0) {
      console.log(`  ✓ 已回填港交所 timeline_confirmed=1：${hkConfirmFixed} 条`);
    }

    // 沪深北已确认行：F_UpdateTime 对齐状态业务日 receive_date（修正列表 updateDate 误覆盖）
    const [mainlandUpdateResult] = await dbPool.query(`
      UPDATE ipo_progress
      SET F_UpdateTime = CONCAT(DATE_FORMAT(receive_date, '%Y-%m-%d'), ' 00:00:00'),
          F_LastModifyTime = COALESCE(F_LastModifyTime, NOW())
      WHERE F_DeleteMark = 0
        AND exchange IN ('深交所', '上交所', '北交所')
        AND COALESCE(timeline_confirmed, 1) = 1
        AND receive_date IS NOT NULL
        AND DATE(F_UpdateTime) <> DATE(receive_date)
    `);
    const mainlandFixed = Number(mainlandUpdateResult?.affectedRows || 0);
    if (mainlandFixed > 0) {
      console.log(`  ✓ 已对齐已确认内地 F_UpdateTime←receive_date：${mainlandFixed} 条`);
    }
  } catch (err) {
    console.warn('迁移 ipo_progress 确认字段时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS ipo_progress_recheck (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
        exchange VARCHAR(20) NOT NULL COMMENT '交易所',
        project_key VARCHAR(128) NOT NULL COMMENT '所侧项目ID或降级键',
        company TEXT NOT NULL COMMENT '公司全称',
        board VARCHAR(20) NOT NULL DEFAULT '' COMMENT '板块',
        list_status VARCHAR(50) NOT NULL COMMENT '入队时列表状态',
        list_update_ymd DATE NULL COMMENT '入队时列表更新日',
        reason VARCHAR(64) NOT NULL DEFAULT 'timeline_missing_status_date' COMMENT '入队原因',
        attempts INT NOT NULL DEFAULT 0 COMMENT '已复核次数',
        max_attempts INT NOT NULL DEFAULT 21 COMMENT '上限（深上21北45）',
        next_recheck_at DATETIME NOT NULL COMMENT '下次可执行时间',
        last_error VARCHAR(500) NULL COMMENT '最近失败原因',
        status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending|done|expired|cancelled',
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        F_UpdateTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_recheck_pending (status, next_recheck_at),
        KEY idx_recheck_exchange_project (exchange, project_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IPO进展详情待复核队列';
    `);
    console.log('✓ ipo_progress_recheck 表已就绪');
  } catch (err) {
    console.warn('创建 ipo_progress_recheck 表时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS ipo_project (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        project_no VARCHAR(64) NOT NULL COMMENT '项目编号',
        biz_update_time DATETIME NULL COMMENT '更新日期（业务库同步更新时间）',
        F_CreatorTime DATETIME NOT NULL COMMENT '创建时间',
        F_CreatorUserId VARCHAR(19) NOT NULL COMMENT '创建用户ID',
        F_LastModifyUserId VARCHAR(19) NULL COMMENT '修改用户ID',
        F_LastModifyTime DATETIME NULL COMMENT '修改时间',
        F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID',
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除状态：0未删除，1已删除',
        F_DeleteTime DATETIME NULL COMMENT '删除时间',
        project_name TEXT NOT NULL COMMENT '项目简称',
        company TEXT NOT NULL COMMENT '企业全称',
        inv_amount DECIMAL(20,2) NOT NULL COMMENT '投资成本',
        residual_amount DECIMAL(20,2) NOT NULL COMMENT '剩余成本',
        ratio DECIMAL(10,4) NOT NULL COMMENT '穿透权益占比',
        ct_amount DECIMAL(20,2) NOT NULL COMMENT '穿透投资成本',
        ct_residual DECIMAL(20,2) NOT NULL COMMENT '穿透剩余成本',
        fund TEXT NOT NULL COMMENT '归属基金',
        sub TEXT NULL COMMENT '归属子基金/SPV',
        UNIQUE KEY uk_ipo_project_no (project_no),
        KEY idx_ipo_project_creator (F_CreatorUserId),
        KEY idx_ipo_project_delete (F_DeleteMark)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上市进展-底层项目';
    `);
    console.log('✓ ipo_project 表已就绪');
  } catch (err) {
    console.warn('创建 ipo_project 表时出现警告:', err.message);
  }

  const addIpoProjectCol = async (name, ddl) => {
    try {
      const [c] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project' AND COLUMN_NAME = ?`,
        [name]
      );
      if (c.length === 0) {
        await dbPool.query(`ALTER TABLE ipo_project ${ddl}`);
        console.log(`  ✓ 已为 ipo_project 表添加 ${name} 字段`);
      }
    } catch (err) {
      console.warn(`检查/添加 ipo_project.${name} 时出现警告:`, err.message);
    }
  };
  await addIpoProjectCol(
    'data_app_id',
    `ADD COLUMN data_app_id VARCHAR(19) NULL COMMENT 'applications.id' AFTER sub`
  );
  await addIpoProjectCol(
    'unified_credit_code',
    `ADD COLUMN unified_credit_code VARCHAR(64) NULL COMMENT '统一社会信用代码' AFTER company`
  );
  await addIpoProjectCol(
    'ai_product_intro',
    `ADD COLUMN ai_product_intro LONGTEXT NULL COMMENT '产品介绍(AI)' AFTER unified_credit_code`
  );
  await addIpoProjectCol(
    'ai_industry_tags_display',
    `ADD COLUMN ai_industry_tags_display VARCHAR(2000) NULL COMMENT '行业标签(AI)展示' AFTER ai_product_intro`
  );
  await addIpoProjectCol(
    'ai_industry_tags_json',
    `ADD COLUMN ai_industry_tags_json JSON NULL COMMENT '行业标签(AI) JSON' AFTER ai_industry_tags_display`
  );
  await addIpoProjectCol(
    'ai_enrich_status',
    `ADD COLUMN ai_enrich_status VARCHAR(32) NULL COMMENT 'pending/running/success/failed' AFTER ai_industry_tags_json`
  );
  await addIpoProjectCol(
    'ai_enrich_at',
    `ADD COLUMN ai_enrich_at DATETIME NULL COMMENT '最近一次 AI 成功时间' AFTER ai_enrich_status`
  );
  await addIpoProjectCol(
    'ai_enrich_model',
    `ADD COLUMN ai_enrich_model VARCHAR(128) NULL COMMENT '模型名称快照' AFTER ai_enrich_at`
  );
  await addIpoProjectCol(
    'ai_enrich_version',
    `ADD COLUMN ai_enrich_version VARCHAR(64) NULL COMMENT '管线版本' AFTER ai_enrich_model`
  );
  await addIpoProjectCol(
    'ai_enrich_error',
    `ADD COLUMN ai_enrich_error VARCHAR(500) NULL COMMENT 'AI 失败摘要' AFTER ai_enrich_version`
  );
  await addIpoProjectCol(
    'qcc_company_intro',
    `ADD COLUMN qcc_company_intro LONGTEXT NULL COMMENT '企业介绍（企查查）' AFTER ai_enrich_error`
  );
  await addIpoProjectCol(
    'qcc_sync_at',
    `ADD COLUMN qcc_sync_at DATETIME NULL COMMENT '最近一次企查查同步时间' AFTER qcc_company_intro`
  );
  await addIpoProjectCol(
    'qcc_sync_error',
    `ADD COLUMN qcc_sync_error VARCHAR(500) NULL COMMENT '最近一次企查查同步失败摘要' AFTER qcc_sync_at`
  );

  try {
    const [listingRows] = await dbPool.query(
      `SELECT F_Id AS id FROM applications
       WHERE CAST(app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci =
             CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
       LIMIT 1`,
      ['上市进展']
    );
    if (listingRows.length) {
      const lid = String(listingRows[0].id);
      await dbPool.query(
        `UPDATE ipo_project SET data_app_id = ? WHERE data_app_id IS NULL OR TRIM(data_app_id) = ''`,
        [lid]
      );
      console.log('  ✓ ipo_project.data_app_id 已回填为「上市进展」应用 id');
    }
  } catch (err) {
    console.warn('  回填 ipo_project.data_app_id 时出现警告:', err.message);
  }

  try {
    await dbPool.query(
      `ALTER TABLE ipo_project MODIFY COLUMN data_app_id VARCHAR(19) NOT NULL COMMENT 'applications.id'`
    );
    console.log('  ✓ ipo_project.data_app_id 已设为 NOT NULL');
  } catch (err) {
    console.warn('  ipo_project.data_app_id 设 NOT NULL 时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS ipo_project_progress (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        F_CreatorTime DATETIME NOT NULL COMMENT '创建时间',
        F_CreatorUserId VARCHAR(19) NOT NULL COMMENT '创建用户ID',
        ipo_project_f_id BIGINT NULL COMMENT '底层项目 ipo_project.F_Id',
        ipo_progress_row_id BIGINT NULL COMMENT '对应 ipo_progress.F_Id 快照',
        new_share_row_id BIGINT NULL COMMENT '对应 ipo_new_share.id 快照',
        match_source VARCHAR(30) NOT NULL DEFAULT 'ipo_progress' COMMENT '匹配来源：ipo_progress|new_share',
        match_score DECIMAL(8,4) NULL COMMENT '匹配得分（0~1）',
        fund TEXT NOT NULL COMMENT '归属基金',
        sub TEXT NULL COMMENT '归属子基金/SPV',
        project_name TEXT NOT NULL COMMENT '项目简称',
        company TEXT NOT NULL COMMENT '企业全称',
        inv_amount DECIMAL(20,2) NOT NULL COMMENT '投资成本',
        residual_amount DECIMAL(20,2) NOT NULL COMMENT '剩余成本',
        ratio DECIMAL(10,4) NOT NULL COMMENT '穿透权益占比',
        ct_amount DECIMAL(20,2) NOT NULL COMMENT '穿透投资成本',
        ct_residual DECIMAL(20,2) NOT NULL COMMENT '穿透剩余成本',
        status VARCHAR(50) NOT NULL COMMENT '审核状态',
        board VARCHAR(20) NOT NULL COMMENT '板块',
        exchange VARCHAR(20) NOT NULL COMMENT '交易所',
        F_UpdateTime DATETIME NOT NULL COMMENT '更新日期（对应ipo_progress.F_UpdateTime）',
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记：0未删除，1已删除',
        F_DeleteTime DATETIME NULL COMMENT '删除时间',
        F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人ID',
        KEY idx_ipp_creator (F_CreatorUserId),
        KEY idx_ipp_update (F_UpdateTime),
        KEY idx_ipp_delete_mark (F_DeleteMark)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='底层项目与上市进展匹配结果';
    `);
    console.log('✓ ipo_project_progress 表已就绪');
  } catch (err) {
    console.warn('创建 ipo_project_progress 表时出现警告:', err.message);
  }

  try {
    const [ippDel] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_progress' AND COLUMN_NAME = 'F_DeleteMark'
    `);
    if (ippDel.length === 0) {
      // 先检查旧列名 delete_mark 是否存在（兼容迁移）
      const [ippOld] = await dbPool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_progress' AND COLUMN_NAME = 'delete_mark'
      `);
      if (ippOld.length > 0) {
        // 旧列存在，走重命名迁移（下方统一处理）
      } else {
        await dbPool.query(`
          ALTER TABLE ipo_project_progress
          ADD COLUMN F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记：0未删除，1已删除' AFTER F_UpdateTime,
          ADD COLUMN F_DeleteTime DATETIME NULL COMMENT '删除时间' AFTER F_DeleteMark,
          ADD COLUMN F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人ID' AFTER F_DeleteTime,
          ADD KEY idx_ipp_delete_mark (F_DeleteMark)
        `);
        console.log('✓ ipo_project_progress 已添加 F_DeleteMark/F_DeleteTime/F_DeleteUserId');
      }
    }
  } catch (err) {
    console.warn('迁移 ipo_project_progress 删除字段时出现警告:', err.message);
  }

  // ── ipo_project_progress 系统字段统一命名迁移（snake_case / f_ → F_ PascalCase）──
  try {
    const renameMap = [
      { old: 'f_id', new: 'F_Id', def: 'BIGINT NOT NULL AUTO_INCREMENT', comment: '主键ID' },
      { old: 'f_create_date', new: 'F_CreatorTime', def: 'DATETIME NOT NULL', comment: '创建时间' },
      { old: 'f_update_time', new: 'F_UpdateTime', def: 'DATETIME NOT NULL', comment: '更新日期（对应ipo_progress.F_UpdateTime）' },
      { old: 'delete_mark', new: 'F_DeleteMark', def: 'TINYINT(1) NOT NULL DEFAULT 0', comment: '删除标记：0未删除，1已删除' },
      { old: 'delete_time', new: 'F_DeleteTime', def: 'DATETIME NULL', comment: '删除时间' },
      { old: 'delete_user_id', new: 'F_DeleteUserId', def: 'VARCHAR(19) NULL', comment: '删除人ID' },
    ];
    for (const { old: oldCol, new: newCol, def, comment } of renameMap) {
      const [cols] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_progress' AND COLUMN_NAME = ?`,
        [oldCol]
      );
      if (cols.length > 0) {
        await dbPool.query(
          `ALTER TABLE ipo_project_progress CHANGE COLUMN \`${oldCol}\` \`${newCol}\` ${def} COMMENT '${comment}'`
        );
        console.log(`  ✓ ipo_project_progress: ${oldCol} → ${newCol}`);
      }
    }
  } catch (err) {
    console.warn('迁移 ipo_project_progress 字段重命名时出现警告:', err.message);
  }

  // ── ipo_progress 系统字段统一命名迁移 ──
  try {
    const progressRename = [
      { old: 'f_id', new: 'F_Id', def: 'BIGINT NOT NULL AUTO_INCREMENT', comment: '主键ID' },
      { old: 'f_create_date', new: 'F_CreatorTime', def: 'DATE NOT NULL', comment: '入库日期（北京时间）' },
      { old: 'f_update_time', new: 'F_UpdateTime', def: 'DATETIME NOT NULL', comment: '交易所侧更新日期时间' },
    ];
    for (const { old: o, new: n, def, comment } of progressRename) {
      const [cols] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_progress' AND COLUMN_NAME = ?`, [o]
      );
      if (cols.length > 0) {
        await dbPool.query(`ALTER TABLE ipo_progress CHANGE COLUMN \`${o}\` \`${n}\` ${def} COMMENT '${comment}'`);
        console.log(`  ✓ ipo_progress: ${o} → ${n}`);
      }
    }
  } catch (err) {
    console.warn('迁移 ipo_progress 字段重命名时出现警告:', err.message);
  }

  // ── ipo_project 系统字段统一命名迁移 ──
  try {
    const [cols] = await dbPool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project' AND COLUMN_NAME = 'f_id'`
    );
    if (cols.length > 0) {
      await dbPool.query(`ALTER TABLE ipo_project CHANGE COLUMN \`f_id\` \`F_Id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID'`);
      console.log('  ✓ ipo_project: f_id → F_Id');
    }
  } catch (err) {
    console.warn('迁移 ipo_project 字段重命名时出现警告:', err.message);
  }

  // ── 第三优先级：批量迁移剩余表的系统字段命名 ──
  await migrateBatchFColumns(dbPool);

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS ipo_new_share (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        stock_code VARCHAR(20) NOT NULL COMMENT '股票代码',
        stock_name VARCHAR(200) NOT NULL COMMENT '股票简称',
        enterprise_full_name_cn VARCHAR(255) NULL COMMENT '企业中文全称（AI补齐）',
        enterprise_full_name_en VARCHAR(255) NULL COMMENT '企业英文全称（AI补齐）',
        enterprise_full_name_display VARCHAR(600) NULL COMMENT '企业全称展示值（中/英）',
        issue_date DATE NOT NULL COMMENT '申购日期（北京时间）',
        issue_weekday VARCHAR(10) NULL COMMENT '星期几',
        issue_price DECIMAL(12,4) NULL COMMENT '发行价',
        offer_pe DECIMAL(12,4) NULL COMMENT '发行市盈率',
        limit_shares DECIMAL(20,2) NULL COMMENT '申购上限',
        issue_total_wan DECIMAL(20,2) NULL COMMENT '发行总数（万股，东财 ISSUE_NUM）',
        expected_raise_amount DECIMAL(12,2) NULL COMMENT '预计募资规模（亿元，发行价×发行总数万股/10000）',
        total_issued_shares DECIMAL(20,2) NULL COMMENT '总发行数量（股）',
        exchange VARCHAR(20) NOT NULL COMMENT '交易所',
        public_date DATE NULL COMMENT '上市日期（北京时间）',
        win_rate DECIMAL(12,6) NULL COMMENT '中签率（北交所为空）',
        first_day_close DECIMAL(12,4) NULL COMMENT '上市首日收盘价',
        first_day_chg_pct DECIMAL(10,4) NULL COMMENT '首日涨幅（数值，不含%）',
        first_day_market_cap DECIMAL(20,2) NULL COMMENT '首日市值（首日收盘价×总发行数量）',
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        UNIQUE KEY uk_ipo_new_share_code_exchange (stock_code, exchange),
        KEY idx_ipo_new_share_issue_date (issue_date),
        KEY idx_ipo_new_share_public_date (public_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='新股申购日历';
    `);
    console.log('✓ ipo_new_share 表已就绪');
  } catch (err) {
    console.warn('创建 ipo_new_share 表时出现警告:', err.message);
  }

  // 历史库兼容：补齐 ipo_new_share 的首日表现字段
  try {
    await dbPool.query(
      `ALTER TABLE ipo_new_share
         ADD COLUMN enterprise_full_name_cn VARCHAR(255) NULL COMMENT '企业中文全称（AI补齐）' AFTER stock_name`
    );
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column name')) {
      console.warn('为 ipo_new_share 增加 enterprise_full_name_cn 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE ipo_new_share
         ADD COLUMN enterprise_full_name_en VARCHAR(255) NULL COMMENT '企业英文全称（AI补齐）' AFTER enterprise_full_name_cn`
    );
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column name')) {
      console.warn('为 ipo_new_share 增加 enterprise_full_name_en 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE ipo_new_share
         ADD COLUMN enterprise_full_name_display VARCHAR(600) NULL COMMENT '企业全称展示值（中/英）' AFTER enterprise_full_name_en`
    );
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column name')) {
      console.warn('为 ipo_new_share 增加 enterprise_full_name_display 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE ipo_new_share
         ADD COLUMN total_issued_shares DECIMAL(20,2) NULL COMMENT '总发行数量（股）' AFTER limit_shares`
    );
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column name')) {
      console.warn('为 ipo_new_share 增加 total_issued_shares 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE ipo_new_share
         ADD COLUMN first_day_close DECIMAL(12,4) NULL COMMENT '上市首日收盘价' AFTER win_rate`
    );
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column name')) {
      console.warn('为 ipo_new_share 增加 first_day_close 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE ipo_new_share
         ADD COLUMN first_day_chg_pct DECIMAL(10,4) NULL COMMENT '首日涨幅（数值，不含%）' AFTER first_day_close`
    );
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column name')) {
      console.warn('为 ipo_new_share 增加 first_day_chg_pct 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE ipo_new_share
         ADD COLUMN first_day_market_cap DECIMAL(20,2) NULL COMMENT '首日市值（首日收盘价×总发行数量）' AFTER first_day_chg_pct`
    );
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column name')) {
      console.warn('为 ipo_new_share 增加 first_day_market_cap 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE ipo_new_share
         ADD COLUMN issue_total_wan DECIMAL(20,2) NULL COMMENT '发行总数（万股，东财 ISSUE_NUM）' AFTER limit_shares`
    );
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column name')) {
      console.warn('为 ipo_new_share 增加 issue_total_wan 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE ipo_new_share
         ADD COLUMN expected_raise_amount DECIMAL(12,2) NULL COMMENT '预计募资规模（亿元，发行价×发行总数万股/10000）' AFTER issue_total_wan`
    );
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column name')) {
      console.warn('为 ipo_new_share 增加 expected_raise_amount 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `UPDATE ipo_new_share
       SET issue_total_wan = ROUND(total_issued_shares / 10000, 2)
       WHERE issue_total_wan IS NULL
         AND total_issued_shares IS NOT NULL AND total_issued_shares > 0`
    );
  } catch (err) {
    console.warn('回填 ipo_new_share.issue_total_wan 时出现警告:', err.message);
  }
  try {
    await dbPool.query(
      `UPDATE ipo_new_share
       SET total_issued_shares = ROUND(issue_total_wan * 10000, 2)
       WHERE issue_total_wan IS NOT NULL AND issue_total_wan > 0
         AND (total_issued_shares IS NULL OR total_issued_shares <= 0 OR total_issued_shares <= issue_total_wan * 100)`
    );
  } catch (err) {
    console.warn('修正 ipo_new_share.total_issued_shares 股数单位时出现警告:', err.message);
  }
  try {
    await dbPool.query(
      `UPDATE ipo_new_share
       SET expected_raise_amount = ROUND(issue_price * issue_total_wan / 10000, 2)
       WHERE issue_total_wan IS NOT NULL AND issue_total_wan > 0
         AND issue_price IS NOT NULL AND issue_price > 0
         AND (expected_raise_amount IS NULL OR expected_raise_amount <= 0)`
    );
  } catch (err) {
    console.warn('回填 ipo_new_share.expected_raise_amount 时出现警告:', err.message);
  }

  // Stage 1a：ipo_new_share 上市主档画像字段（申万行业等）
  const ipoNewShareStage1Cols = [
    {
      name: 'unified_credit_code',
      sql: `ADD COLUMN unified_credit_code VARCHAR(20) NULL COMMENT '统一社会信用代码' AFTER enterprise_full_name_display`,
    },
    {
      name: 'sw_industry_l1',
      sql: `ADD COLUMN sw_industry_l1 VARCHAR(100) NULL COMMENT '申万行业一级（东财 EM2016）' AFTER unified_credit_code`,
    },
    {
      name: 'sw_industry_l2',
      sql: `ADD COLUMN sw_industry_l2 VARCHAR(100) NULL COMMENT '申万行业二级（东财 EM2016）' AFTER sw_industry_l1`,
    },
    {
      name: 'industry_category_4',
      sql: `ADD COLUMN industry_category_4 VARCHAR(32) NULL COMMENT '四大类 category_4' AFTER sw_industry_l2`,
    },
    {
      name: 'product_intro',
      sql: `ADD COLUMN product_intro TEXT NULL COMMENT '产品/经营范围简介' AFTER industry_category_4`,
    },
    {
      name: 'company_intro',
      sql: `ADD COLUMN company_intro TEXT NULL COMMENT '企业介绍（东财/百科等）' AFTER product_intro`,
    },
    {
      name: 'industry_tags_display',
      sql: `ADD COLUMN industry_tags_display VARCHAR(2000) NULL COMMENT '行业标签展示（申万/赛道）' AFTER company_intro`,
    },
    {
      name: 'industry_tags_json',
      sql: `ADD COLUMN industry_tags_json JSON NULL COMMENT '行业标签 JSON 数组' AFTER industry_tags_display`,
    },
    {
      name: 'baike_lemma_url',
      sql: `ADD COLUMN baike_lemma_url VARCHAR(512) NULL COMMENT '百科词条 URL' AFTER industry_tags_json`,
    },
    {
      name: 'baike_lemma_status',
      sql: `ADD COLUMN baike_lemma_status VARCHAR(32) NULL COMMENT '百科词条状态 found/not_found/anti_crawl' AFTER baike_lemma_url`,
    },
    {
      name: 'baike_miss_reason',
      sql: `ADD COLUMN baike_miss_reason VARCHAR(64) NULL COMMENT '百科未命中原因' AFTER baike_lemma_status`,
    },
    {
      name: 'profile_source',
      sql: `ADD COLUMN profile_source VARCHAR(32) NULL COMMENT '画像来源（eastmoney_sw/listed_sync/llm_web 等）' AFTER product_intro`,
    },
    {
      name: 'listed_pool_sync_at',
      sql: `ADD COLUMN listed_pool_sync_at DATETIME NULL COMMENT '上市主池全量同步时间（Stage 1a）' AFTER profile_source`,
    },
  ];
  for (const col of ipoNewShareStage1Cols) {
    try {
      await dbPool.query(`ALTER TABLE ipo_new_share ${col.sql}`);
    } catch (err) {
      if (!String(err.message || '').includes('Duplicate column name')) {
        console.warn(`为 ipo_new_share 增加 ${col.name} 时出现警告:`, err.message);
      }
    }
  }

  // 境外备案：已并入 ipo_progress（board=境外发行备案），不再创建 ipo_overseas_filing
  try {
    const [legacyOt] = await dbPool.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_overseas_filing'
    `);
    if (legacyOt.length) {
      try {
        await dbPool.query(
          `ALTER TABLE ipo_progress MODIFY COLUMN exchange VARCHAR(100) NOT NULL DEFAULT '' COMMENT '交易所/拟上市地'`
        );
      } catch (e2) {
        console.warn('扩展 ipo_progress.exchange 长度时出现警告（可忽略）:', e2.message);
      }
      await dbPool.query(`
        INSERT INTO ipo_progress (
          F_CreatorTime, F_UpdateTime, code, project_name, status, register_address, receive_date,
          company, board, exchange, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime, F_DeleteMark
        )
        SELECT
          DATE(COALESCE(o.F_CreatorTime, o.created_at, CURDATE())),
          CONCAT(DATE_FORMAT(o.receive_date, '%Y-%m-%d'), ' 00:00:00'),
          '',
          o.company_name,
          LEFT(COALESCE(o.filing_status, ''), 50),
          LEFT(COALESCE(o.filing_type, ''), 200),
          o.receive_date,
          COALESCE(NULLIF(TRIM(o.filing_entity), ''), o.company_name),
          '境外发行备案',
          LEFT(COALESCE(NULLIF(TRIM(o.target_exchange), ''), ''), 100),
          NULL,
          NULL,
          NOW(),
          0
        FROM ipo_overseas_filing o
        WHERE NOT EXISTS (
          SELECT 1 FROM ipo_progress p
          WHERE p.F_DeleteMark = 0 AND p.board = '境外发行备案'
            AND p.project_name = o.company_name
            AND p.receive_date = o.receive_date
            AND p.register_address = LEFT(COALESCE(o.filing_type, ''), 200)
        )
      `);
      await dbPool.query(`DROP TABLE IF EXISTS ipo_overseas_filing`);
      console.log('✓ 原 ipo_overseas_filing 已迁移至 ipo_progress 并删除扩展表');
    }
  } catch (err) {
    console.warn('迁移 ipo_overseas_filing → ipo_progress 时出现警告:', err.message);
  }

  // 境外发行备案：申报主体在 Excel 为「/」等占位时已写入 company，启动时纠为公司全称=企业名称
  try {
    const [fixOw] = await dbPool.query(`
      UPDATE ipo_progress SET company = project_name, F_LastModifyTime = NOW()
      WHERE F_DeleteMark = 0 AND board = '境外发行备案'
        AND project_name IS NOT NULL AND CHAR_LENGTH(TRIM(project_name)) > 0
        AND TRIM(company) IN ('/', '-', '—', '／', '－', '\\\\')
    `);
    if (fixOw.affectedRows > 0) {
      console.log(`✓ 已纠正境外发行备案占位 company（${fixOw.affectedRows} 行）`);
    }
  } catch (err) {
    console.warn('纠正境外发行备案 company 占位时出现警告:', err.message);
  }

  // ipo_* 三张业务表：为已存在历史库补齐字段注释（与《上市进展需求》一致）
  try {
    const ipoProgressCommentSql = [
      "ALTER TABLE ipo_progress COMMENT='上市进展（交易所爬取）'",
      "ALTER TABLE ipo_progress MODIFY COLUMN F_Id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID'",
      "ALTER TABLE ipo_progress MODIFY COLUMN F_CreatorTime DATE NOT NULL COMMENT '入库日期（北京时间）'",
      "ALTER TABLE ipo_progress MODIFY COLUMN F_UpdateTime DATETIME NOT NULL COMMENT '交易所侧更新日期时间'",
      "ALTER TABLE ipo_progress MODIFY COLUMN code VARCHAR(20) NOT NULL DEFAULT '' COMMENT '证券代码'",
      "ALTER TABLE ipo_progress MODIFY COLUMN project_name TEXT NOT NULL COMMENT '项目简称'",
      "ALTER TABLE ipo_progress MODIFY COLUMN status VARCHAR(50) NOT NULL COMMENT '审核状态'",
      "ALTER TABLE ipo_progress MODIFY COLUMN register_address VARCHAR(200) NOT NULL DEFAULT '' COMMENT '注册地'",
      "ALTER TABLE ipo_progress MODIFY COLUMN receive_date DATE NULL COMMENT '受理日期'",
      "ALTER TABLE ipo_progress MODIFY COLUMN company TEXT NOT NULL COMMENT '公司全称'",
      "ALTER TABLE ipo_progress MODIFY COLUMN board VARCHAR(20) NOT NULL COMMENT '板块'",
      "ALTER TABLE ipo_progress MODIFY COLUMN exchange VARCHAR(100) NOT NULL DEFAULT '' COMMENT '交易所/拟上市地'",
      "ALTER TABLE ipo_progress MODIFY COLUMN F_CreatorUserId VARCHAR(19) NULL COMMENT '创建用户ID'",
      "ALTER TABLE ipo_progress MODIFY COLUMN F_LastModifyUserId VARCHAR(19) NULL COMMENT '修改用户ID'",
      "ALTER TABLE ipo_progress MODIFY COLUMN F_LastModifyTime DATETIME NULL COMMENT '修改时间'",
      "ALTER TABLE ipo_progress MODIFY COLUMN F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID'",
      "ALTER TABLE ipo_progress MODIFY COLUMN F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除状态：0未删除，1已删除'",
      "ALTER TABLE ipo_progress MODIFY COLUMN F_DeleteTime DATETIME NULL COMMENT '删除时间'",
    ];
    const ipoProjectCommentSql = [
      "ALTER TABLE ipo_project COMMENT='上市进展-底层项目'",
      "ALTER TABLE ipo_project MODIFY COLUMN F_Id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID'",
      "ALTER TABLE ipo_project MODIFY COLUMN project_no VARCHAR(64) NOT NULL COMMENT '项目编号'",
      "ALTER TABLE ipo_project MODIFY COLUMN biz_update_time DATETIME NULL COMMENT '更新日期（业务库同步更新时间）'",
      "ALTER TABLE ipo_project MODIFY COLUMN F_CreatorTime DATETIME NOT NULL COMMENT '创建时间'",
      "ALTER TABLE ipo_project MODIFY COLUMN F_CreatorUserId VARCHAR(19) NOT NULL COMMENT '创建用户ID'",
      "ALTER TABLE ipo_project MODIFY COLUMN F_LastModifyUserId VARCHAR(19) NULL COMMENT '修改用户ID'",
      "ALTER TABLE ipo_project MODIFY COLUMN F_LastModifyTime DATETIME NULL COMMENT '修改时间'",
      "ALTER TABLE ipo_project MODIFY COLUMN F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID'",
      "ALTER TABLE ipo_project MODIFY COLUMN F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除状态：0未删除，1已删除'",
      "ALTER TABLE ipo_project MODIFY COLUMN F_DeleteTime DATETIME NULL COMMENT '删除时间'",
      "ALTER TABLE ipo_project MODIFY COLUMN project_name TEXT NOT NULL COMMENT '项目简称'",
      "ALTER TABLE ipo_project MODIFY COLUMN company TEXT NOT NULL COMMENT '企业全称'",
      "ALTER TABLE ipo_project MODIFY COLUMN inv_amount DECIMAL(20,2) NOT NULL COMMENT '投资成本'",
      "ALTER TABLE ipo_project MODIFY COLUMN residual_amount DECIMAL(20,2) NOT NULL COMMENT '剩余成本'",
      "ALTER TABLE ipo_project MODIFY COLUMN ratio DECIMAL(10,4) NOT NULL COMMENT '穿透权益占比'",
      "ALTER TABLE ipo_project MODIFY COLUMN ct_amount DECIMAL(20,2) NOT NULL COMMENT '穿透投资成本'",
      "ALTER TABLE ipo_project MODIFY COLUMN ct_residual DECIMAL(20,2) NOT NULL COMMENT '穿透剩余成本'",
      "ALTER TABLE ipo_project MODIFY COLUMN fund TEXT NOT NULL COMMENT '归属基金'",
      "ALTER TABLE ipo_project MODIFY COLUMN sub TEXT NULL COMMENT '归属子基金/SPV'",
    ];
    const ipoProjectProgressCommentSql = [
      "ALTER TABLE ipo_project_progress COMMENT='底层项目与上市进展匹配结果'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN F_Id BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN F_CreatorTime DATETIME NOT NULL COMMENT '创建时间'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN F_CreatorUserId VARCHAR(19) NOT NULL COMMENT '创建用户ID'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN ipo_project_f_id BIGINT NULL COMMENT '底层项目 ipo_project.F_Id'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN ipo_progress_row_id BIGINT NULL COMMENT '对应 ipo_progress.F_Id 快照'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN new_share_row_id BIGINT NULL COMMENT '对应 ipo_new_share.F_Id 快照'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN match_source VARCHAR(30) NOT NULL DEFAULT 'ipo_progress' COMMENT '匹配来源：ipo_progress|new_share'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN match_score DECIMAL(8,4) NULL COMMENT '匹配得分（0~1）'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN fund TEXT NOT NULL COMMENT '归属基金'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN sub TEXT NULL COMMENT '归属子基金/SPV'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN project_name TEXT NOT NULL COMMENT '项目简称'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN company TEXT NOT NULL COMMENT '企业全称'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN inv_amount DECIMAL(20,2) NOT NULL COMMENT '投资成本'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN residual_amount DECIMAL(20,2) NOT NULL COMMENT '剩余成本'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN ratio DECIMAL(10,4) NOT NULL COMMENT '穿透权益占比'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN ct_amount DECIMAL(20,2) NOT NULL COMMENT '穿透投资成本'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN ct_residual DECIMAL(20,2) NOT NULL COMMENT '穿透剩余成本'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN status VARCHAR(50) NOT NULL COMMENT '审核状态'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN board VARCHAR(20) NOT NULL COMMENT '板块'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN exchange VARCHAR(20) NOT NULL COMMENT '交易所'",
      "ALTER TABLE ipo_project_progress MODIFY COLUMN F_UpdateTime DATETIME NOT NULL COMMENT '更新日期（对应ipo_progress.F_UpdateTime）'",
    ];

    for (const sql of [...ipoProgressCommentSql, ...ipoProjectCommentSql, ...ipoProjectProgressCommentSql]) {
      await dbPool.query(sql);
    }
    console.log('✓ ipo_* 三张表字段注释已检查并补齐');
  } catch (err) {
    console.warn('补齐 ipo_* 字段注释时出现警告:', err.message);
  }

  try {
    const [ippProjCol] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_progress' AND COLUMN_NAME = 'ipo_project_f_id'
    `);
    if (ippProjCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE ipo_project_progress
        ADD COLUMN ipo_project_f_id BIGINT NULL COMMENT '底层项目 ipo_project.F_Id' AFTER F_CreatorUserId
      `);
      console.log('✓ ipo_project_progress 已添加 ipo_project_f_id');
    }
  } catch (err) {
    console.warn('迁移 ipo_project_progress.ipo_project_f_id 时出现警告:', err.message);
  }

  try {
    const [ippNewShareRowCol] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_progress' AND COLUMN_NAME = 'new_share_row_id'
    `);
    if (ippNewShareRowCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE ipo_project_progress
        ADD COLUMN new_share_row_id BIGINT NULL COMMENT '对应 ipo_new_share.F_Id 快照' AFTER ipo_progress_row_id
      `);
      console.log('✓ ipo_project_progress 已添加 new_share_row_id');
    }
  } catch (err) {
    console.warn('迁移 ipo_project_progress.new_share_row_id 时出现警告:', err.message);
  }

  try {
    const [ippMatchSourceCol] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_progress' AND COLUMN_NAME = 'match_source'
    `);
    if (ippMatchSourceCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE ipo_project_progress
        ADD COLUMN match_source VARCHAR(30) NOT NULL DEFAULT 'ipo_progress' COMMENT '匹配来源：ipo_progress|new_share' AFTER new_share_row_id
      `);
      console.log('✓ ipo_project_progress 已添加 match_source');
    }
  } catch (err) {
    console.warn('迁移 ipo_project_progress.match_source 时出现警告:', err.message);
  }

  try {
    const [ippMatchScoreCol] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_progress' AND COLUMN_NAME = 'match_score'
    `);
    if (ippMatchScoreCol.length === 0) {
      await dbPool.query(`
        ALTER TABLE ipo_project_progress
        ADD COLUMN match_score DECIMAL(8,4) NULL COMMENT '匹配得分（0~1）' AFTER match_source
      `);
      console.log('✓ ipo_project_progress 已添加 match_score');
    }
  } catch (err) {
    console.warn('迁移 ipo_project_progress.match_score 时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS listing_data_config (
        F_Id VARCHAR(19) PRIMARY KEY COMMENT '配置ID',
        name VARCHAR(200) NOT NULL COMMENT '配置名称',
        interface_type VARCHAR(20) NOT NULL COMMENT 'crawler|api',
        request_url VARCHAR(1000) NULL,
        min_sync_date DATE NOT NULL DEFAULT '2026-01-01' COMMENT '最早同步日期（该日期之前不处理）',
        cron_expression VARCHAR(100) NULL,
        last_sync_time DATETIME NULL,
        last_sync_range_end DATE NULL COMMENT '上次成功同步的闭区间结束日(北京时间)，用于定时补抓',
        skip_holiday TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=节假日不执行定时任务，工作日补抓区间',
        ifind_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=启用同花顺iFinD港股上市申请抓取',
        ifind_username TEXT NULL COMMENT '同花顺iFinD用户名（服务端加密存储）',
        ifind_password TEXT NULL COMMENT '同花顺iFinD密码（服务端加密存储）',
        ifind_token TEXT NULL COMMENT '同花顺iFinD token（服务端加密存储，Linux环境用）',
        ifind_dr_code VARCHAR(50) NOT NULL DEFAULT 'p04920' COMMENT 'THS_DR 数据集编码',
        ifind_query_params VARCHAR(1000) NOT NULL DEFAULT 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0' COMMENT 'THS_DR 入参',
        ifind_fields TEXT NULL COMMENT 'THS_DR 字段选择',
        ifind_format VARCHAR(20) NOT NULL DEFAULT 'json' COMMENT 'THS_DR 返回格式',
        ifind_fallback_to_hkex TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'iFinD无数据/失败时是否回退港交所网页抓取',
        status VARCHAR(50) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        news_interface_type VARCHAR(50) NULL COMMENT '上海国际集团|企查查|其他',
        F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除',
        F_DeleteTime DATETIME NULL COMMENT '删除时间',
        F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统配置-上市数据配置';
    `);
    console.log('✓ listing_data_config 表已就绪');
  } catch (err) {
    console.warn('创建 listing_data_config 表时出现警告:', err.message);
  }

  try {
    const [ldcDm] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'listing_data_config' AND COLUMN_NAME = 'F_DeleteMark'
    `);
    if (ldcDm.length === 0) {
      await dbPool.query(`
        ALTER TABLE listing_data_config
        ADD COLUMN F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标志：0-未删除，1-已删除' AFTER F_LastModifyTime,
        ADD COLUMN F_DeleteTime DATETIME NULL COMMENT '删除时间' AFTER F_DeleteMark,
        ADD COLUMN F_DeleteUserId VARCHAR(19) NULL COMMENT '删除用户ID' AFTER F_DeleteTime
      `);
    }
  } catch (err) {
    console.warn('迁移 listing_data_config 删除字段时出现警告:', err.message);
  }

  try {
    const columnDefs = [
      ["min_sync_date", "ADD COLUMN min_sync_date DATE NOT NULL DEFAULT '2026-01-01' COMMENT '最早同步日期（该日期之前不处理）' AFTER request_url"],
      ["ifind_enabled", "ADD COLUMN ifind_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=启用同花顺iFinD港股上市申请抓取' AFTER skip_holiday"],
      ["ifind_username", "ADD COLUMN ifind_username TEXT NULL COMMENT '同花顺iFinD用户名（服务端加密存储）' AFTER ifind_enabled"],
      ["ifind_password", "ADD COLUMN ifind_password TEXT NULL COMMENT '同花顺iFinD密码（服务端加密存储）' AFTER ifind_username"],
      ["ifind_token", "ADD COLUMN ifind_token TEXT NULL COMMENT '同花顺iFinD token（服务端加密存储，Linux环境用）' AFTER ifind_password"],
      ["ifind_dr_code", "ADD COLUMN ifind_dr_code VARCHAR(50) NOT NULL DEFAULT 'p04920' COMMENT 'THS_DR 数据集编码' AFTER ifind_token"],
      ["ifind_query_params", "ADD COLUMN ifind_query_params VARCHAR(1000) NOT NULL DEFAULT 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0' COMMENT 'THS_DR 入参' AFTER ifind_dr_code"],
      ["ifind_fields", "ADD COLUMN ifind_fields TEXT NULL COMMENT 'THS_DR 字段选择' AFTER ifind_query_params"],
      ["ifind_format", "ADD COLUMN ifind_format VARCHAR(20) NOT NULL DEFAULT 'json' COMMENT 'THS_DR 返回格式' AFTER ifind_fields"],
      ["ifind_fallback_to_hkex", "ADD COLUMN ifind_fallback_to_hkex TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'iFinD无数据/失败时是否回退港交所网页抓取' AFTER ifind_format"],
    ];
    for (const [name, ddl] of columnDefs) {
      const [rows] = await dbPool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'listing_data_config' AND COLUMN_NAME = '${name}'
      `);
      if (rows.length === 0) {
        await dbPool.query(`ALTER TABLE listing_data_config ${ddl}`);
        console.log(`✓ listing_data_config 已添加 ${name}`);
      }
    }
  } catch (err) {
    console.warn('迁移 listing_data_config iFinD 字段时出现警告:', err.message);
  }

  try {
    const [ldcSkip] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'listing_data_config' AND COLUMN_NAME = 'skip_holiday'
    `);
    if (ldcSkip.length === 0) {
      await dbPool.query(`
        ALTER TABLE listing_data_config
        ADD COLUMN skip_holiday TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=节假日不执行定时任务' AFTER last_sync_time
      `);
      console.log('✓ listing_data_config 已添加 skip_holiday');
    }
  } catch (err) {
    console.warn('迁移 listing_data_config.skip_holiday 时出现警告:', err.message);
  }

  try {
    const [ldcEnd] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'listing_data_config' AND COLUMN_NAME = 'last_sync_range_end'
    `);
    if (ldcEnd.length === 0) {
      await dbPool.query(`
        ALTER TABLE listing_data_config
        ADD COLUMN last_sync_range_end DATE NULL COMMENT '上次成功同步的闭区间结束日(北京时间)' AFTER last_sync_time
      `);
      console.log('✓ listing_data_config 已添加 last_sync_range_end');
    }
  } catch (err) {
    console.warn('迁移 listing_data_config.last_sync_range_end 时出现警告:', err.message);
  }

  try {
    const [legacyPerf] = await dbPool.query(
      `SELECT F_Id AS id FROM listing_data_config
       WHERE IFNULL(news_interface_type, '') = 'listed_performance'
          OR name = '新股五日表现'`
    );
    if (legacyPerf.length > 0) {
      await dbPool.query(
        `DELETE FROM listing_data_config
         WHERE IFNULL(news_interface_type, '') = 'listed_performance'
            OR name = '新股五日表现'`
      );
      console.log(`✓ listing_data_config 已清理新股五日表现历史配置: ${legacyPerf.length} 条`);
    }

    const defaults = [
      { name: '交易所IPO主爬虫', interface_type: 'crawler', news_interface_type: 'exchange_ipo', request_url: null },
      { name: '打新日历', interface_type: 'crawler', news_interface_type: 'new_share', request_url: null },
      {
        name: '证监会辅导备案',
        interface_type: 'crawler',
        news_interface_type: 'guidance_progress',
        request_url: 'https://eid.csrc.gov.cn/csrcfd/index.html',
      },
      {
        name: '境外上市备案审核',
        interface_type: 'api',
        news_interface_type: 'overseas_filing',
        request_url:
          (process.env.CSRC_ZFXXGK_PAGE_URL || '').trim() ||
          'http://www.csrc.gov.cn/csrc/c101935/zfxxgk_zdgk.shtml?channelid=8f3f0d4be56b4f8aa8183b3234b88ede',
      },
    ];

    const makeId = async () => {
      for (let i = 0; i < 5; i += 1) {
        const id = `${Date.now()}${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`.slice(0, 19);
        const [rows] = await dbPool.query(`SELECT F_Id FROM listing_data_config WHERE F_Id = ? LIMIT 1`, [id]);
        if (!rows.length) return id;
      }
      throw new Error('生成 listing_data_config.id 失败');
    };

    let created = 0;
    for (const d of defaults) {
      const [rows] = await dbPool.query(
        `SELECT F_Id AS id, request_url FROM listing_data_config WHERE name = ? AND interface_type = ? AND IFNULL(news_interface_type, '') = ? LIMIT 1`,
        [d.name, d.interface_type, d.news_interface_type]
      );
      if (rows.length) {
        const currentUrl = String(rows[0].request_url || '').trim();
        const targetUrl = String(d.request_url || '').trim();
        if (!currentUrl && targetUrl) {
          await dbPool.query(`UPDATE listing_data_config SET request_url = ? WHERE F_Id = ?`, [targetUrl, rows[0].id]);
        }
        continue;
      }
      const id = await makeId();
      await dbPool.query(
        `INSERT INTO listing_data_config (
          F_Id, name, interface_type, request_url, cron_expression, last_sync_time, status, is_active, news_interface_type, skip_holiday,
          ifind_enabled, ifind_username, ifind_password, ifind_token, ifind_dr_code, ifind_query_params, ifind_fields, ifind_format, ifind_fallback_to_hkex
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          d.name,
          d.interface_type,
          d.request_url || null,
          '0 0 8 * * ? *',
          'active',
          1,
          d.news_interface_type,
          0,
          0,
          null,
          null,
          null,
          'p04920',
          'iv_sfss=0;iv_sqlx=0;iv_sqzt=0',
          'p04920_f001:Y,p04920_f002:Y,p04920_f003:Y,p04920_f004:Y,p04920_f005:Y,p04920_f006:Y,p04920_f037:Y,p04920_f007:Y,p04920_f008:Y,p04920_f021:Y,p04920_f022:Y',
          'json',
          0,
        ]
      );
      created += 1;
    }
    if (created > 0) {
      console.log(`✓ listing_data_config 默认接口配置已自动补齐: ${created} 条`);
    } else {
      console.log('✓ listing_data_config 默认接口配置已存在');
    }
  } catch (err) {
    console.warn('自动补齐 listing_data_config 默认接口配置时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS listing_sync_execution_log (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        config_id VARCHAR(19) NULL COMMENT '配置ID',
        config_name VARCHAR(200) NULL COMMENT '配置名称',
        task_key VARCHAR(255) NULL COMMENT '互斥任务键',
        source_type VARCHAR(100) NULL COMMENT '来源类型',
        trigger_type VARCHAR(20) NOT NULL COMMENT '触发方式：scheduled/manual',
        window_start DATE NULL COMMENT '同步窗口开始日',
        window_end DATE NULL COMMENT '同步窗口结束日',
        retry_count INT NOT NULL DEFAULT 0 COMMENT '重试次数',
        dedup_hits INT NOT NULL DEFAULT 0 COMMENT '去重命中数',
        inserted_count INT NOT NULL DEFAULT 0 COMMENT '新增入库数',
        updated_count INT NOT NULL DEFAULT 0 COMMENT '更新入库数',
        skipped_count INT NOT NULL DEFAULT 0 COMMENT '跳过数',
        status VARCHAR(20) NOT NULL DEFAULT 'running' COMMENT 'running/success/failed/skipped',
        progress_log LONGTEXT NULL COMMENT '执行过程日志（滚动追加）',
        heartbeat_at DATETIME NULL COMMENT '最近进度更新时间',
        error_message TEXT NULL COMMENT '错误摘要',
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开始时间',
        finished_at DATETIME NULL COMMENT '结束时间',
        F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_listing_sync_log_cfg_time (config_id, started_at),
        KEY idx_listing_sync_log_status_time (status, started_at),
        KEY idx_listing_sync_log_task_key (task_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上市进展同步执行日志';
    `);
    console.log('✓ listing_sync_execution_log 表已就绪');
  } catch (err) {
    console.warn('创建 listing_sync_execution_log 表时出现警告:', err.message);
  }

  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'listing_sync_execution_log' AND COLUMN_NAME = 'progress_log'
    `);
    if (cols.length === 0) {
      await dbPool.query(`
        ALTER TABLE listing_sync_execution_log
        ADD COLUMN progress_log LONGTEXT NULL COMMENT '执行过程日志（滚动追加）' AFTER status
      `);
      console.log('✓ listing_sync_execution_log 已添加 progress_log');
    }
  } catch (err) {
    console.warn('迁移 listing_sync_execution_log.progress_log 时出现警告:', err.message);
  }

  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'listing_sync_execution_log' AND COLUMN_NAME = 'heartbeat_at'
    `);
    if (cols.length === 0) {
      await dbPool.query(`
        ALTER TABLE listing_sync_execution_log
        ADD COLUMN heartbeat_at DATETIME NULL COMMENT '最近进度更新时间' AFTER progress_log
      `);
      console.log('✓ listing_sync_execution_log 已添加 heartbeat_at');
    }
  } catch (err) {
    console.warn('迁移 listing_sync_execution_log.heartbeat_at 时出现警告:', err.message);
  }

  // ——— #13: 上市进展定时任务持久化互斥锁表 ———
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS listing_sync_task_lock (
        task_key VARCHAR(255) NOT NULL PRIMARY KEY COMMENT '互斥任务键',
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '锁获取时间'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='上市进展定时任务持久化互斥锁'
    `);
  } catch (err) {
    console.warn('创建 listing_sync_task_lock 表时出现警告:', err.message);
  }

  // ——— 项目挖掘：投融资明细层 + 标准层 ———
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_financing_event_w_infer (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        request_id VARCHAR(64) NULL COMMENT '本次接口请求流水号（RequestId）',
        query_type VARCHAR(32) NOT NULL COMMENT '查询方式：queryByCode/queryByDate/fuzzyQuery',
        proj_cd_xn VARCHAR(100) NULL COMMENT '项目烯牛编码',
        proj_id_xn BIGINT NULL COMMENT '项目烯牛ID',
        instn_id_xn BIGINT NULL COMMENT '被投机构烯牛ID',
        instn_idtfn_cd VARCHAR(64) NULL COMMENT '被投机构唯一识别码',
        instn_nm VARCHAR(255) NULL COMMENT '被投机构名称',
        reg_rgn VARCHAR(100) NULL COMMENT '被投机构所在国家或地区',
        reg_prov VARCHAR(100) NULL COMMENT '被投机构所在省',
        reg_city VARCHAR(100) NULL COMMENT '被投机构所在市',
        reg_cnty VARCHAR(100) NULL COMMENT '被投机构所在区',
        proj_nm VARCHAR(255) NULL COMMENT '项目名称',
        proj_desc TEXT NULL COMMENT '项目简介',
        cp_round VARCHAR(100) NULL COMMENT '项目最新融资轮次',
        xn_ic_lv1 VARCHAR(100) NULL COMMENT '一级行业标签（烯牛）',
        xn_ic_lv2 VARCHAR(100) NULL COMMENT '二级行业标签（烯牛）',
        funding_id VARCHAR(64) NOT NULL COMMENT '融资事件ID',
        funding_dt DATETIME NULL COMMENT '融资日期时间（Asia/Shanghai）',
        round VARCHAR(100) NULL COMMENT '融资轮次（烯牛推测）',
        funding_amt VARCHAR(100) NULL COMMENT '获投金额（原始文本）',
        estmt_funding_amt VARCHAR(100) NULL COMMENT '预估融资金额（原始文本）',
        post_valuation VARCHAR(100) NULL COMMENT '投后估值（原始文本）',
        funding_sts VARCHAR(100) NULL COMMENT '事件状态',
        inv_info_json LONGTEXT NULL COMMENT '投资方信息JSON数组（inv_info），来自国际集团接口 Data.deal_info_w_infer',
        create_time DATETIME NULL COMMENT '源端创建时间（Asia/Shanghai）',
        update_time DATETIME NULL COMMENT '源端更新时间（Asia/Shanghai）',
        ingested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本地入库时间（Asia/Shanghai）',
        record_hash VARCHAR(64) NOT NULL COMMENT '明细记录哈希（幂等去重）',
        UNIQUE KEY uk_sourcing_w_infer_hash (record_hash),
        KEY idx_sourcing_w_infer_funding_dt (funding_dt),
        KEY idx_sourcing_w_infer_instn (instn_idtfn_cd),
        KEY idx_sourcing_w_infer_funding_id (funding_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目挖掘-融资事件明细（含推测轮次）';
    `);
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_financing_event (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        source_record_id BIGINT NULL COMMENT '来源明细ID，关联 sourcing_financing_event_w_infer.id',
        event_id VARCHAR(64) NOT NULL COMMENT '融资事件ID（funding_id）',
        event_date DATE NULL COMMENT '融资日期（Asia/Shanghai）',
        company_name VARCHAR(255) NULL COMMENT '被投机构名称',
        company_credit_code VARCHAR(64) NULL COMMENT '被投机构唯一识别码',
        project_name VARCHAR(255) NULL COMMENT '项目名称',
        project_desc TEXT NULL COMMENT '项目简介',
        latest_round VARCHAR(100) NULL COMMENT '项目最新融资轮次（cp_round）',
        round VARCHAR(100) NULL COMMENT '融资轮次（w_infer推测口径）',
        funding_amt_raw VARCHAR(100) NULL COMMENT '原始融资金额字符串',
        estimated_amt_raw VARCHAR(100) NULL COMMENT '原始预估融资金额字符串',
        post_valuation_raw VARCHAR(100) NULL COMMENT '原始投后估值字符串',
        amount DECIMAL(20,2) NULL COMMENT '解析后的金额数值（原币种）',
        amount_currency VARCHAR(20) NULL COMMENT '金额币种',
        amount_cny DECIMAL(20,2) NULL COMMENT '折算人民币金额',
        amount_parse_status VARCHAR(20) NULL COMMENT '金额解析状态：parsed/estimated/unparsed',
        amount_parse_confidence DECIMAL(5,2) NULL COMMENT '金额解析置信度（0-1）',
        industry_source_lv1 VARCHAR(100) NULL COMMENT '来源一级行业标签（接口原始：xn_ic_lv1）',
        industry_source_lv2 VARCHAR(100) NULL COMMENT '来源二级行业标签（接口原始：xn_ic_lv2）',
        industry_std_lv1 VARCHAR(100) NULL COMMENT '标准一级行业（内部行业字典映射后）',
        industry_std_lv2 VARCHAR(100) NULL COMMENT '标准二级行业（内部行业字典映射后）',
        track_primary VARCHAR(100) NULL COMMENT '主赛道（业务分析口径）',
        track_secondary VARCHAR(100) NULL COMMENT '子赛道（业务分析口径）',
        track_keywords VARCHAR(500) NULL COMMENT '赛道关键词（逗号分隔）',
        business_tags VARCHAR(500) NULL COMMENT '业务标签（如AI、机器人、半导体等）',
        scenario_tags VARCHAR(500) NULL COMMENT '应用场景标签（如金融、医疗、制造等）',
        competition_bucket VARCHAR(100) NULL COMMENT '竞争分层（头部/腰部/长尾/新进入）',
        competitor_companies TEXT NULL COMMENT '主要竞争对手企业列表（JSON字符串）',
        competitor_count INT NULL COMMENT '识别出的竞争对手数量',
        market_heat_score DECIMAL(10,4) NULL COMMENT '赛道热度评分（0-100）',
        industry_match_confidence DECIMAL(5,2) NULL COMMENT '行业赛道分类置信度（0-1）',
        classification_version VARCHAR(50) NULL COMMENT '分类规则/模型版本号',
        classification_source VARCHAR(20) NULL COMMENT '分类来源：rule/llm/hybrid',
        classification_status VARCHAR(20) NOT NULL DEFAULT 'verified' COMMENT '分类状态：pending/filling/checking/verified/failed',
        classification_retry_count INT NOT NULL DEFAULT 0 COMMENT '分类重试次数（最大3次）',
        investor_names TEXT NULL COMMENT '投资主体名称列表（顿号拼接，原始 JSON 见明细表 inv_info_json）',
        lead_investor VARCHAR(255) NULL COMMENT '领投方（可空）',
        region_country VARCHAR(100) NULL COMMENT '国家/地区（reg_rgn）',
        region_province VARCHAR(100) NULL COMMENT '省（reg_prov）',
        region_city VARCHAR(100) NULL COMMENT '市（reg_city）',
        region_county VARCHAR(100) NULL COMMENT '区县（reg_cnty）',
        funding_status VARCHAR(100) NULL COMMENT '融资状态',
        source_create_time DATETIME NULL COMMENT '源端创建时间（Asia/Shanghai）',
        source_update_time DATETIME NULL COMMENT '源端更新时间（Asia/Shanghai）',
        F_DeleteMark TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记：0未删除，1已删除',
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（Asia/Shanghai）',
        F_LastModifyTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（Asia/Shanghai）',
        UNIQUE KEY uk_sourcing_event_natural (event_id, company_credit_code, event_date),
        KEY idx_sourcing_event_date (event_date),
        KEY idx_sourcing_event_track (track_primary, track_secondary),
        KEY idx_sourcing_event_company (company_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目挖掘-融资事件标准表（统一分析口径）';
    `);
    console.log('✓ sourcing_financing_event_w_infer / sourcing_financing_event 表已就绪');
  } catch (err) {
    console.warn('创建项目挖掘融资事件表时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS industry_source_l1_map (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        source_lv1 VARCHAR(100) NOT NULL COMMENT '烯牛一级行业（industry_source_lv1）',
        source_lv2 VARCHAR(100) NOT NULL DEFAULT '' COMMENT '烯牛二级行业（industry_source_lv2，空串表示 L1 默认）',
        category_4 VARCHAR(32) NOT NULL COMMENT '竞品四大类：ai/bio/semi_mfg/other',
        category_display VARCHAR(100) NULL COMMENT '业务映射分类展示名（xlsx 映射分类列）',
        sub_track VARCHAR(32) NULL COMMENT 'semi_mfg 子轨：semi/advanced_mfg',
        boundary_note VARCHAR(500) NULL COMMENT '边界说明',
        confirmed_by VARCHAR(100) NULL COMMENT '业务确认人',
        map_version VARCHAR(50) NULL DEFAULT 'stage0_v1' COMMENT '映射版本',
        F_DeleteMark TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删除，1已删除',
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        UNIQUE KEY uk_industry_source_l1_map (source_lv1, source_lv2),
        KEY idx_industry_map_category_4 (category_4),
        KEY idx_industry_map_display (category_display)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='烯牛行业→竞品 category_4 映射（Stage 0）';
    `);
    console.log('✓ industry_source_l1_map 表已就绪');
  } catch (err) {
    console.warn('创建 industry_source_l1_map 表时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sw_industry_category_map (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        sw_industry_l1 VARCHAR(100) NOT NULL COMMENT '申万一级（东财 EM2016）',
        sw_industry_l2 VARCHAR(100) NOT NULL DEFAULT '' COMMENT '申万二级（空串表示 L1 默认）',
        category_4 VARCHAR(32) NOT NULL COMMENT '竞品四大类：ai/bio/semi_mfg/other',
        category_display VARCHAR(100) NULL COMMENT '业务映射分类展示名',
        sub_track VARCHAR(32) NULL COMMENT 'semi_mfg 子轨：semi/advanced_mfg',
        boundary_note VARCHAR(500) NULL COMMENT '边界说明',
        confirmed_by VARCHAR(100) NULL COMMENT '业务确认人',
        map_version VARCHAR(50) NULL DEFAULT 'stage1c_v1' COMMENT '映射版本',
        F_DeleteMark TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删除，1已删除',
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        UNIQUE KEY uk_sw_industry_category_map (sw_industry_l1, sw_industry_l2),
        KEY idx_sw_industry_map_category_4 (category_4)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='申万行业→竞品 category_4 映射（Stage 1c）';
    `);
    console.log('✓ sw_industry_category_map 表已就绪');
  } catch (err) {
    console.warn('创建 sw_industry_category_map 表时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS competitor_gold_standard_pair (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
        category_4 VARCHAR(32) NOT NULL COMMENT '赛道：ai/bio/semi_mfg/other',
        target_source VARCHAR(40) NOT NULL COMMENT '目标来源：financing/new_share/pre_investment',
        target_ref_id BIGINT NULL COMMENT '目标来源表主键',
        target_display_name VARCHAR(255) NOT NULL COMMENT '目标企业展示名',
        target_credit_code VARCHAR(64) NULL COMMENT '目标统一社会信用代码',
        candidate_source VARCHAR(40) NULL COMMENT '候选来源',
        candidate_ref_id BIGINT NULL COMMENT '候选来源表主键',
        candidate_display_name VARCHAR(255) NULL COMMENT '候选企业展示名',
        candidate_credit_code VARCHAR(64) NULL COMMENT '候选统一社会信用代码',
        annotator_1_is_competitor TINYINT NULL COMMENT '标注人1：1竞品 0非竞品',
        annotator_1_type VARCHAR(64) NULL COMMENT '标注人1：竞品类型',
        annotator_2_is_competitor TINYINT NULL COMMENT '标注人2',
        annotator_2_type VARCHAR(64) NULL COMMENT '标注人2：竞品类型',
        annotator_3_is_competitor TINYINT NULL COMMENT '标注人3',
        annotator_3_type VARCHAR(64) NULL COMMENT '标注人3：竞品类型',
        final_is_competitor TINYINT NULL COMMENT '仲裁后：1竞品 0非竞品',
        final_type VARCHAR(64) NULL COMMENT '仲裁后竞品类型',
        status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/annotating/done',
        notes VARCHAR(500) NULL COMMENT '备注',
        batch_id VARCHAR(64) NULL COMMENT '导出批次',
        F_DeleteMark TINYINT NOT NULL DEFAULT 0,
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        F_LastModifyTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_gold_category (category_4, status),
        KEY idx_gold_target (target_credit_code, target_display_name(80))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品分析金标准样本对（Stage 0）';
    `);
    console.log('✓ competitor_gold_standard_pair 表已就绪');
  } catch (err) {
    console.warn('创建 competitor_gold_standard_pair 表时出现警告:', err.message);
  }

  // 项目挖掘：融资事件标准表 — AI 增强字段（阶段 A）
  const addSfeCol = async (colName, ddl) => {
    try {
      const [c] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_financing_event' AND COLUMN_NAME = ?`,
        [colName]
      );
      if (c.length === 0) {
        await dbPool.query(`ALTER TABLE sourcing_financing_event ${ddl}`);
        console.log(`✓ sourcing_financing_event 已添加列 ${colName}`);
      }
    } catch (err) {
      console.warn(`迁移 sourcing_financing_event.${colName} 时出现警告:`, err.message);
    }
  };
  await addSfeCol(
    'ai_product_intro',
    `ADD COLUMN ai_product_intro TEXT NULL COMMENT '产品简介(AI)，联网归纳，不覆盖 project_desc' AFTER F_LastModifyTime`
  );
  await addSfeCol(
    'ai_company_tags_display',
    `ADD COLUMN ai_company_tags_display VARCHAR(2000) NULL COMMENT '企业标签(AI)展示，顿号分隔' AFTER ai_product_intro`
  );
  await addSfeCol(
    'ai_company_tags_json',
    `ADD COLUMN ai_company_tags_json JSON NULL COMMENT '企业标签(AI)结构化 JSON' AFTER ai_company_tags_display`
  );
  await addSfeCol(
    'ai_enrich_status',
    `ADD COLUMN ai_enrich_status VARCHAR(20) NULL DEFAULT 'pending' COMMENT 'AI增强：pending/running/success/failed/skipped' AFTER ai_company_tags_json`
  );
  await addSfeCol(
    'ai_enrich_at',
    `ADD COLUMN ai_enrich_at DATETIME NULL COMMENT 'AI增强完成时间' AFTER ai_enrich_status`
  );
  await addSfeCol(
    'ai_enrich_model',
    `ADD COLUMN ai_enrich_model VARCHAR(100) NULL COMMENT 'AI增强所用模型快照' AFTER ai_enrich_at`
  );
  await addSfeCol(
    'ai_enrich_version',
    `ADD COLUMN ai_enrich_version VARCHAR(50) NULL COMMENT '提示词/管线版本' AFTER ai_enrich_model`
  );
  await addSfeCol(
    'ai_enrich_error',
    `ADD COLUMN ai_enrich_error VARCHAR(500) NULL COMMENT 'AI增强失败摘要' AFTER ai_enrich_version`
  );
  try {
    const [ix] = await dbPool.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_financing_event' AND INDEX_NAME = 'idx_sourcing_event_ai_enrich'`
    );
    if (ix.length === 0) {
      await dbPool.query(
        `ALTER TABLE sourcing_financing_event ADD KEY idx_sourcing_event_ai_enrich (ai_enrich_status, F_Id)`
      );
      console.log('✓ sourcing_financing_event 已添加 idx_sourcing_event_ai_enrich');
    }
  } catch (err) {
    console.warn('迁移 sourcing_financing_event AI 索引时出现警告:', err.message);
  }

  // Stage 2：融资池上市识别与 listed 画像同步字段
  await addSfeCol(
    'listing_status',
    `ADD COLUMN listing_status VARCHAR(20) NULL COMMENT '上市关联：matched/unknown/no_match' AFTER ai_enrich_error`
  );
  await addSfeCol(
    'listed_stock_code',
    `ADD COLUMN listed_stock_code VARCHAR(32) NULL COMMENT '上市股票代码（new_share 同步）' AFTER listing_status`
  );
  await addSfeCol(
    'listed_exchange',
    `ADD COLUMN listed_exchange VARCHAR(32) NULL COMMENT '上市交易所（new_share 同步）' AFTER listed_stock_code`
  );
  await addSfeCol(
    'new_share_row_id',
    `ADD COLUMN new_share_row_id BIGINT NULL COMMENT '关联 ipo_new_share.F_Id' AFTER listed_exchange`
  );
  await addSfeCol(
    'profile_source',
    `ADD COLUMN profile_source VARCHAR(32) NULL COMMENT '画像来源：listed_sync/llm_web/baike 等' AFTER new_share_row_id`
  );
  await addSfeCol(
    'industry_category_4',
    `ADD COLUMN industry_category_4 VARCHAR(32) NULL COMMENT '竞品四大类：ai/bio/semi_mfg/other' AFTER profile_source`
  );
  await addSfeCol(
    'company_intro',
    `ADD COLUMN company_intro TEXT NULL COMMENT '企业介绍（listed_sync 来自 new_share）' AFTER industry_category_4`
  );
  await addSfeCol(
    'listed_sync_at',
    `ADD COLUMN listed_sync_at DATETIME NULL COMMENT '上市主档画像同步时间（Stage 2）' AFTER company_intro`
  );
  try {
    const [ixListed] = await dbPool.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_financing_event' AND INDEX_NAME = 'idx_sfe_listing_status'`
    );
    if (ixListed.length === 0) {
      await dbPool.query(
        `ALTER TABLE sourcing_financing_event ADD KEY idx_sfe_listing_status (listing_status, F_Id)`
      );
      console.log('✓ sourcing_financing_event 已添加 idx_sfe_listing_status');
    }
    const [ixCredit] = await dbPool.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_financing_event' AND INDEX_NAME = 'idx_sfe_company_credit'`
    );
    if (ixCredit.length === 0) {
      await dbPool.query(
        `ALTER TABLE sourcing_financing_event ADD KEY idx_sfe_company_credit (company_credit_code(32))`
      );
      console.log('✓ sourcing_financing_event 已添加 idx_sfe_company_credit');
    }
  } catch (err) {
    console.warn('迁移 sourcing_financing_event listing 索引时出现警告:', err.message);
  }

  // Stage 2b：融资池百科查词元数据
  await addSfeCol(
    'baike_lemma_url',
    `ADD COLUMN baike_lemma_url VARCHAR(512) NULL COMMENT '百科词条 URL' AFTER listed_sync_at`
  );
  await addSfeCol(
    'baike_lemma_status',
    `ADD COLUMN baike_lemma_status VARCHAR(32) NULL COMMENT '百科：found/not_found/anti_crawl' AFTER baike_lemma_url`
  );
  await addSfeCol(
    'baike_miss_reason',
    `ADD COLUMN baike_miss_reason VARCHAR(64) NULL COMMENT '百科未命中原因' AFTER baike_lemma_status`
  );
  await addSfeCol(
    'baike_lookup_at',
    `ADD COLUMN baike_lookup_at DATETIME NULL COMMENT '最近一次百科查词时间' AFTER baike_miss_reason`
  );
  await addSfeCol(
    'structured_profile_json',
    `ADD COLUMN structured_profile_json JSON NULL COMMENT 'L2 structured 画像（Stage 3）' AFTER baike_lookup_at`
  );
  await addSfeCol(
    'structured_schema_version',
    `ADD COLUMN structured_schema_version VARCHAR(32) NULL COMMENT 'structured schema 版本' AFTER structured_profile_json`
  );
  await addSfeCol(
    'structured_at',
    `ADD COLUMN structured_at DATETIME NULL COMMENT 'structured 抽取时间' AFTER structured_schema_version`
  );

  // 项目挖掘：融资信息 AI 增强执行日志（追加型）
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_financing_ai_enrich_log (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
        financing_event_id BIGINT NOT NULL COMMENT '标准表 sourcing_financing_event.id',
        event_id VARCHAR(64) NULL COMMENT '融资事件业务键快照',
        company_name VARCHAR(255) NULL COMMENT '企业名称快照',
        trigger_type VARCHAR(32) NOT NULL COMMENT 'manual_api/auto_enqueue/batch_replay/system_retry',
        triggered_by_user_id VARCHAR(19) NULL COMMENT '触发人 users.id',
        triggered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '触发受理时间',
        client_ip VARCHAR(64) NULL COMMENT '客户端 IP',
        job_trace_id VARCHAR(64) NULL COMMENT '链路/幂等追踪 UUID',
        execution_status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/running/success/failed/skipped',
        started_at DATETIME NULL COMMENT '开始调用模型时间',
        finished_at DATETIME NULL COMMENT '结束时间',
        duration_ms INT NULL COMMENT '耗时毫秒',
        llm_model_config_id VARCHAR(19) NULL COMMENT 'ai_model_config.id',
        prompt_type VARCHAR(80) NULL COMMENT '提示词类型',
        prompt_version VARCHAR(80) NULL COMMENT '提示词版本',
        ai_enrich_version VARCHAR(50) NULL COMMENT '与标准表写入版本对齐',
        error_message VARCHAR(500) NULL COMMENT '失败摘要',
        retry_index INT NOT NULL DEFAULT 0 COMMENT '重试序号从0起',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        KEY idx_sf_ai_log_event_time (financing_event_id, triggered_at),
        KEY idx_sf_ai_log_type_time (trigger_type, triggered_at),
        KEY idx_sf_ai_log_status_time (execution_status, triggered_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目挖掘-融资信息AI增强触发与执行日志';
    `);
    console.log('✓ sourcing_financing_ai_enrich_log 表已就绪');
  } catch (err) {
    console.warn('创建 sourcing_financing_ai_enrich_log 时出现警告:', err.message);
  }

  const addSfAiLogCol = async (colName, ddl) => {
    try {
      const [c] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_financing_ai_enrich_log' AND COLUMN_NAME = ?`,
        [colName]
      );
      if (c.length === 0) {
        await dbPool.query(`ALTER TABLE sourcing_financing_ai_enrich_log ${ddl}`);
        console.log(`✓ sourcing_financing_ai_enrich_log 已添加列 ${colName}`);
      }
    } catch (err) {
      console.warn(`迁移 sourcing_financing_ai_enrich_log.${colName} 时出现警告:`, err.message);
    }
  };
  await addSfAiLogCol(
    'result_product_intro',
    `ADD COLUMN result_product_intro LONGTEXT NULL COMMENT '成功时写入的产品简介(AI)全文快照' AFTER error_message`
  );
  await addSfAiLogCol(
    'result_company_tags_display',
    `ADD COLUMN result_company_tags_display VARCHAR(2000) NULL COMMENT '成功时写入的企业标签(AI)展示快照' AFTER result_product_intro`
  );
  await addSfAiLogCol(
    'invoke_mode',
    `ADD COLUMN invoke_mode VARCHAR(40) NULL COMMENT '调用方式：chat_with_search/chat_no_search/batch_file/reuse_donor/reuse_existing' AFTER result_company_tags_display`
  );
  await addSfAiLogCol(
    'used_enable_search',
    `ADD COLUMN used_enable_search TINYINT(1) NULL COMMENT '成功请求是否带enable_search：1是0否NULL未调模型' AFTER invoke_mode`
  );
  await addSfAiLogCol(
    'search_degraded',
    `ADD COLUMN search_degraded TINYINT(1) NULL COMMENT '是否联网参数失败后降级：1是0否NULL未调模型' AFTER used_enable_search`
  );
  await addSfAiLogCol(
    'used_enable_thinking',
    `ADD COLUMN used_enable_thinking TINYINT(1) NULL COMMENT '成功请求是否带enable_thinking：1是0否NULL未调模型' AFTER search_degraded`
  );
  await addSfAiLogCol(
    'thinking_degraded',
    `ADD COLUMN thinking_degraded TINYINT(1) NULL COMMENT '是否深度思考参数失败后降级：1是0否NULL未调模型' AFTER used_enable_thinking`
  );

  // 项目挖掘：被投企业 invested_enterprises — 与融资事件同一套联网增强提示词产出（产品介绍 + 标签→行业标签落库）
  const addIeEnterpriseAiCol = async (name, ddl) => {
    try {
      const [c] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invested_enterprises' AND COLUMN_NAME = ?`,
        [name]
      );
      if (c.length === 0) {
        await dbPool.query(`ALTER TABLE invested_enterprises ${ddl}`);
        console.log(`  ✓ 已为 invested_enterprises 表添加 ${name} 字段`);
      }
    } catch (err) {
      console.warn(`检查/添加 invested_enterprises.${name} 时出现警告:`, err.message);
    }
  };
  await addIeEnterpriseAiCol(
    'ai_product_intro',
    `ADD COLUMN ai_product_intro LONGTEXT NULL COMMENT '产品介绍(AI)，与融资联网增强同一提示词' AFTER residual_value`
  );
  await addIeEnterpriseAiCol(
    'ai_industry_tags_display',
    `ADD COLUMN ai_industry_tags_display VARCHAR(2000) NULL COMMENT '行业标签(AI)展示（顿号拼接）' AFTER ai_product_intro`
  );
  await addIeEnterpriseAiCol(
    'ai_industry_tags_json',
    `ADD COLUMN ai_industry_tags_json JSON NULL COMMENT '行业标签(AI) JSON 数组' AFTER ai_industry_tags_display`
  );
  await addIeEnterpriseAiCol(
    'ai_enrich_status',
    `ADD COLUMN ai_enrich_status VARCHAR(32) NULL COMMENT 'pending/running/success/failed' AFTER ai_industry_tags_json`
  );
  await addIeEnterpriseAiCol(
    'ai_enrich_at',
    `ADD COLUMN ai_enrich_at DATETIME NULL COMMENT '最近一次 AI 成功时间' AFTER ai_enrich_status`
  );
  await addIeEnterpriseAiCol(
    'ai_enrich_model',
    `ADD COLUMN ai_enrich_model VARCHAR(128) NULL COMMENT '模型名称快照' AFTER ai_enrich_at`
  );
  await addIeEnterpriseAiCol(
    'ai_enrich_version',
    `ADD COLUMN ai_enrich_version VARCHAR(64) NULL COMMENT '管线版本' AFTER ai_enrich_model`
  );
  await addIeEnterpriseAiCol(
    'ai_enrich_error',
    `ADD COLUMN ai_enrich_error VARCHAR(500) NULL COMMENT 'AI 失败摘要' AFTER ai_enrich_version`
  );
  await addIeEnterpriseAiCol(
    'qcc_company_intro',
    `ADD COLUMN qcc_company_intro LONGTEXT NULL COMMENT '企业介绍（企查查 CompanyBrief/GetInfo Data.Desc）' AFTER ai_enrich_error`
  );
  await addIeEnterpriseAiCol(
    'qcc_sync_at',
    `ADD COLUMN qcc_sync_at DATETIME NULL COMMENT '最近一次企查查企业简介同步时间' AFTER qcc_company_intro`
  );
  await addIeEnterpriseAiCol(
    'qcc_sync_error',
    `ADD COLUMN qcc_sync_error VARCHAR(500) NULL COMMENT '最近一次企查查同步失败摘要' AFTER qcc_sync_at`
  );
  await addIeEnterpriseAiCol(
    'qcc_sync_via',
    `ADD COLUMN qcc_sync_via VARCHAR(32) NULL COMMENT '最近一次企查查简介写入来源：cross_table_propagate|qcc_api|legacy_api' AFTER qcc_sync_error`
  );
  await addIeEnterpriseAiCol(
    'competition_lens_json',
    `ADD COLUMN competition_lens_json JSON NULL COMMENT '最近确认的对标焦点（竞争透镜）快照' AFTER qcc_sync_via`
  );
  await addIeEnterpriseAiCol(
    'competition_lens_version',
    `ADD COLUMN competition_lens_version INT NULL COMMENT '竞争透镜版本号' AFTER competition_lens_json`
  );
  await addIeEnterpriseAiCol(
    'competition_lens_at',
    `ADD COLUMN competition_lens_at DATETIME NULL COMMENT '竞争透镜最近保存时间' AFTER competition_lens_version`
  );
  await addIeEnterpriseAiCol(
    'data_app_id',
    `ADD COLUMN data_app_id VARCHAR(19) NULL COMMENT 'applications.id，与 data_app_name 对齐；写入以 id 为准' AFTER data_app_name`
  );

  try {
    await dbPool.query(`
      UPDATE invested_enterprises ie
      INNER JOIN applications a
        ON CAST(a.app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci =
           CAST(ie.data_app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
      SET ie.data_app_id = a.F_Id
      WHERE (ie.data_app_id IS NULL OR TRIM(ie.data_app_id) = '')
        AND ie.data_app_name IS NOT NULL AND TRIM(ie.data_app_name) <> ''
    `);
    console.log('  ✓ invested_enterprises.data_app_id 已按 applications.app_name 回填');
  } catch (err) {
    console.warn('  回填 invested_enterprises.data_app_id 时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS invested_enterprise_ai_enrich_log (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
        invested_enterprise_id VARCHAR(19) NULL COMMENT 'invested_enterprises.id；与 ipo_project_f_id 二选一',
        ipo_project_f_id BIGINT NULL COMMENT 'ipo_project.F_Id（底层项目）',
        enterprise_full_name VARCHAR(255) NULL COMMENT '企业全称快照（被投企业或底层项目）',
        trigger_type VARCHAR(80) NOT NULL COMMENT 'invested_enterprises:<原值> 或 ipo_project:<原值>；无前缀的旧数据按被投企业解读',
        triggered_by_user_id VARCHAR(19) NULL COMMENT '触发人 users.id',
        triggered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '触发受理时间',
        client_ip VARCHAR(64) NULL COMMENT '客户端 IP',
        job_trace_id VARCHAR(64) NULL COMMENT '链路追踪 UUID',
        execution_status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/running/success/failed/skipped',
        started_at DATETIME NULL COMMENT '开始调用模型时间',
        finished_at DATETIME NULL COMMENT '结束时间',
        duration_ms INT NULL COMMENT '耗时毫秒',
        llm_model_config_id VARCHAR(19) NULL COMMENT 'ai_model_config.id',
        prompt_type VARCHAR(80) NULL COMMENT '提示词类型',
        prompt_version VARCHAR(80) NULL COMMENT '提示词版本',
        ai_enrich_version VARCHAR(50) NULL COMMENT '管线版本',
        error_message VARCHAR(500) NULL COMMENT '失败摘要',
        result_product_intro LONGTEXT NULL COMMENT '成功时产品介绍(AI)快照',
        result_industry_tags_display VARCHAR(2000) NULL COMMENT '成功时行业标签(AI)快照',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        KEY idx_ie_ai_log_ent_time (invested_enterprise_id, triggered_at),
        KEY idx_ie_ai_log_status_time (execution_status, triggered_at),
        KEY idx_ie_ai_log_ipo (ipo_project_f_id, triggered_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目挖掘-被投企业联网AI增强日志';
    `);
    console.log('✓ invested_enterprise_ai_enrich_log 表已就绪');
  } catch (err) {
    console.warn('创建 invested_enterprise_ai_enrich_log 时出现警告:', err.message);
  }

  const addIeAiLogCol = async (colName, ddl) => {
    try {
      const [c] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invested_enterprise_ai_enrich_log' AND COLUMN_NAME = ?`,
        [colName]
      );
      if (c.length === 0) {
        await dbPool.query(`ALTER TABLE invested_enterprise_ai_enrich_log ${ddl}`);
        console.log(`✓ invested_enterprise_ai_enrich_log 已添加列 ${colName}`);
      }
    } catch (err) {
      console.warn(`迁移 invested_enterprise_ai_enrich_log.${colName} 时出现警告:`, err.message);
    }
  };
  await addIeAiLogCol(
    'invoke_mode',
    `ADD COLUMN invoke_mode VARCHAR(40) NULL COMMENT '调用方式：chat_with_search/chat_no_search/batch_file/reuse_donor/reuse_existing' AFTER error_message`
  );
  await addIeAiLogCol(
    'used_enable_search',
    `ADD COLUMN used_enable_search TINYINT(1) NULL COMMENT '成功请求是否带enable_search：1是0否NULL未调模型' AFTER invoke_mode`
  );
  await addIeAiLogCol(
    'search_degraded',
    `ADD COLUMN search_degraded TINYINT(1) NULL COMMENT '是否联网参数失败后降级：1是0否NULL未调模型' AFTER used_enable_search`
  );
  await addIeAiLogCol(
    'used_enable_thinking',
    `ADD COLUMN used_enable_thinking TINYINT(1) NULL COMMENT '成功请求是否带enable_thinking：1是0否NULL未调模型' AFTER search_degraded`
  );
  await addIeAiLogCol(
    'thinking_degraded',
    `ADD COLUMN thinking_degraded TINYINT(1) NULL COMMENT '是否深度思考参数失败后降级：1是0否NULL未调模型' AFTER used_enable_thinking`
  );

  try {
    await dbPool.query(`
      ALTER TABLE invested_enterprise_ai_enrich_log
      MODIFY COLUMN trigger_type VARCHAR(80) NOT NULL COMMENT 'invested_enterprises:<原值> 或 ipo_project:<原值>；无前缀的旧数据按被投企业解读'
    `);
    console.log('✓ invested_enterprise_ai_enrich_log.trigger_type 已放宽至 VARCHAR(80) 并更新注释');
  } catch (err) {
    console.warn('迁移 invested_enterprise_ai_enrich_log.trigger_type 时出现警告:', err.message);
  }

  try {
    const [colIpo] = await dbPool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invested_enterprise_ai_enrich_log' AND COLUMN_NAME = 'ipo_project_f_id'`
    );
    if (!colIpo.length) {
      await dbPool.query(`
        ALTER TABLE invested_enterprise_ai_enrich_log
          ADD COLUMN ipo_project_f_id BIGINT NULL COMMENT 'ipo_project.F_Id（底层项目）' AFTER invested_enterprise_id
      `);
      console.log('✓ invested_enterprise_ai_enrich_log 已添加 ipo_project_f_id');
    }
  } catch (err) {
    console.warn('迁移 invested_enterprise_ai_enrich_log.ipo_project_f_id 时出现警告:', err.message);
  }

  try {
    const [colPreInvLog] = await dbPool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invested_enterprise_ai_enrich_log' AND COLUMN_NAME = 'pre_investment_project_id'`
    );
    if (!colPreInvLog.length) {
      await dbPool.query(`
        ALTER TABLE invested_enterprise_ai_enrich_log
          ADD COLUMN pre_investment_project_id VARCHAR(19) NULL COMMENT 'pre_investment_project.id（投前项目）' AFTER ipo_project_f_id
      `);
      console.log('✓ invested_enterprise_ai_enrich_log 已添加 pre_investment_project_id');
    }
  } catch (err) {
    console.warn('迁移 invested_enterprise_ai_enrich_log.pre_investment_project_id 时出现警告:', err.message);
  }
  try {
    await dbPool.query(`
      ALTER TABLE invested_enterprise_ai_enrich_log
      ADD KEY idx_ie_ai_log_pre_inv (pre_investment_project_id, triggered_at)
    `);
    console.log('✓ invested_enterprise_ai_enrich_log 已添加 idx_ie_ai_log_pre_inv');
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate key name')) {
      console.warn('迁移 invested_enterprise_ai_enrich_log.idx_ie_ai_log_pre_inv 时出现警告:', err.message);
    }
  }

  try {
    await dbPool.query(`
      ALTER TABLE invested_enterprise_ai_enrich_log
      MODIFY COLUMN invested_enterprise_id VARCHAR(19) NULL COMMENT 'invested_enterprises.id；与 ipo_project_f_id / pre_investment_project_id 三选一'
    `);
    console.log('✓ invested_enterprise_ai_enrich_log.invested_enterprise_id 已允许 NULL');
  } catch (err) {
    console.warn('迁移 invested_enterprise_ai_enrich_log.invested_enterprise_id NULL 时出现警告:', err.message);
  }

  // 被投企业同步硬删前：按统一社会信用代码保存 AI 列快照，全量写入后回填（便于故障恢复）
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS invested_enterprise_ai_sync_snapshot (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
        batch_id VARCHAR(36) NOT NULL COMMENT '单次同步 UUID',
        F_CreatorUserId VARCHAR(19) NOT NULL COMMENT '与 invested_enterprises.F_CreatorUserId 一致',
        data_app_name VARCHAR(64) NOT NULL COMMENT '应用名，与 invested_enterprises.data_app_name 一致',
        unified_credit_code VARCHAR(64) NOT NULL COMMENT '规范化后的统一社会信用代码（用于匹配）',
        ai_product_intro LONGTEXT NULL COMMENT '同步前产品简介(AI)',
        ai_industry_tags_display VARCHAR(2000) NULL COMMENT '同步前企业标签(AI)展示',
        ai_industry_tags_json JSON NULL COMMENT '同步前企业标签(AI) JSON',
        ai_enrich_status VARCHAR(32) NULL COMMENT '同步前 AI 状态',
        ai_enrich_at DATETIME NULL COMMENT '同步前 AI 成功时间',
        ai_enrich_model VARCHAR(128) NULL COMMENT '同步前模型名',
        ai_enrich_version VARCHAR(64) NULL COMMENT '同步前管线版本',
        qcc_company_intro LONGTEXT NULL COMMENT '同步前企业介绍（企查查）',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '快照写入时间',
        KEY idx_ie_ai_snap_batch (batch_id),
        KEY idx_ie_ai_snap_batch_credit (batch_id, unified_credit_code),
        KEY idx_ie_ai_snap_created (F_CreatorTime)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='被投企业定时同步前 AI 快照（按统一社会信用代码回填）';
    `);
    console.log('✓ invested_enterprise_ai_sync_snapshot 表已就绪');
  } catch (err) {
    console.warn('创建 invested_enterprise_ai_sync_snapshot 时出现警告:', err.message);
  }

  // 快照表扩展：企查查企业介绍（与硬删前回填一致）
  try {
    const [snapCol] = await dbPool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invested_enterprise_ai_sync_snapshot' AND COLUMN_NAME = 'qcc_company_intro'`
    );
    if (!snapCol.length) {
      await dbPool.query(`
        ALTER TABLE invested_enterprise_ai_sync_snapshot
        ADD COLUMN qcc_company_intro LONGTEXT NULL COMMENT '同步前企业介绍（企查查）' AFTER ai_enrich_version
      `);
      console.log('  ✓ invested_enterprise_ai_sync_snapshot 已添加列 qcc_company_intro');
    }
  } catch (err) {
    console.warn('迁移 invested_enterprise_ai_sync_snapshot.qcc_company_intro 时出现警告:', err.message);
  }

  // 竞品分析：被投企业定时同步硬删前快照（按信用代码/名称/简称恢复竞品运行与关系）
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS competitor_analysis_sync_snapshot (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
        batch_id VARCHAR(36) NOT NULL COMMENT '单次同步 UUID',
        F_CreatorUserId VARCHAR(19) NOT NULL COMMENT '与 invested_enterprises.F_CreatorUserId 一致',
        data_app_name VARCHAR(64) NOT NULL COMMENT '应用名（竞品分析）',
        match_type VARCHAR(8) NOT NULL COMMENT 'ucc|name|abbr',
        match_key VARCHAR(128) NOT NULL COMMENT '规范化匹配键',
        old_invested_enterprise_id VARCHAR(19) NULL COMMENT '同步前被投 id（审计）',
        payload_json LONGTEXT NOT NULL COMMENT 'runs/relations/step_logs/prefs/supplement',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '快照写入时间',
        KEY idx_ca_snap_batch (batch_id),
        KEY idx_ca_snap_batch_match (batch_id, match_type, match_key),
        KEY idx_ca_snap_created (F_CreatorTime)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品分析被投同步前竞品数据快照';
    `);
    console.log('✓ competitor_analysis_sync_snapshot 表已就绪');
  } catch (err) {
    console.warn('创建 competitor_analysis_sync_snapshot 时出现警告:', err.message);
  }

  // 底层项目 SQL 同步硬删前：按统一社会信用代码保存 AI/企查查简介，全量写入后回填
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS ipo_project_ai_sync_snapshot (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
        batch_id VARCHAR(36) NOT NULL COMMENT '单次同步 UUID',
        F_CreatorUserId VARCHAR(19) NOT NULL COMMENT '与 ipo_project.F_CreatorUserId 一致',
        data_app_id VARCHAR(19) NOT NULL COMMENT '本次同步写入的 applications.id（与回填目标行一致）',
        unified_credit_code VARCHAR(64) NOT NULL COMMENT '规范化后的统一社会信用代码（用于匹配）',
        ai_product_intro LONGTEXT NULL COMMENT '同步前产品介绍(AI)',
        ai_industry_tags_display VARCHAR(2000) NULL COMMENT '同步前行业标签(AI)展示',
        ai_industry_tags_json JSON NULL COMMENT '同步前行业标签(AI) JSON',
        ai_enrich_status VARCHAR(32) NULL COMMENT '同步前 AI 状态',
        ai_enrich_at DATETIME NULL COMMENT '同步前 AI 成功时间',
        ai_enrich_model VARCHAR(128) NULL COMMENT '同步前模型名',
        ai_enrich_version VARCHAR(64) NULL COMMENT '同步前管线版本',
        qcc_company_intro LONGTEXT NULL COMMENT '同步前企业介绍（企查查）',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '快照写入时间',
        KEY idx_ipo_ai_snap_batch (batch_id),
        KEY idx_ipo_ai_snap_batch_credit (batch_id, unified_credit_code),
        KEY idx_ipo_ai_snap_created (F_CreatorTime)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='底层项目 SQL 同步前 AI/企查查快照（按统一社会信用代码回填）';
    `);
    console.log('✓ ipo_project_ai_sync_snapshot 表已就绪');
  } catch (err) {
    console.warn('创建 ipo_project_ai_sync_snapshot 表时出现警告:', err.message);
  }

  // 项目挖掘：竞品匹配 — 用户补录（标签 / 自由文本经 AI 抽标签）
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS competitor_match_supplement (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        invested_enterprise_id VARCHAR(19) NOT NULL COMMENT 'invested_enterprises.id',
        user_tags_json JSON NULL COMMENT '用户录入的业务标签 JSON 数组',
        user_narrative_raw LONGTEXT NULL COMMENT '用户粘贴的企业业务/产品介绍原文',
        ai_extracted_tags_json JSON NULL COMMENT '从自由文本抽取的结构化标签 JSON 数组',
        ai_short_summary VARCHAR(500) NULL COMMENT '抽取时可选短摘要',
        batch_id VARCHAR(64) NULL COMMENT '可选批次号',
        F_CreatorUserId VARCHAR(19) NULL COMMENT '创建人 users.id',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记：0未删除，1已删除',
        F_DeleteTime DATETIME NULL COMMENT '删除时间',
        F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人用户ID',
        KEY idx_cms_ie_time (invested_enterprise_id, F_CreatorTime),
        KEY idx_cms_delete (F_DeleteMark),
        CONSTRAINT fk_cms_created_by FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL,
        CONSTRAINT fk_cms_delete_user FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品匹配—补充业务信息（标签/自由文本/AI抽标签）';
    `);
    console.log('✓ competitor_match_supplement 表已就绪');
  } catch (err) {
    console.warn('创建 competitor_match_supplement 时出现警告:', err.message);
  }

  // 竞品分析：三源召回开关（默认全开；融资源仍受用户项目挖掘权限约束）
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS competitor_recall_source_config (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        app_id VARCHAR(19) NOT NULL COMMENT 'applications.id，竞品分析应用',
        enable_ipo_project TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用底层项目池',
        enable_financing_event TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用融资事件池（须用户有项目挖掘权限）',
        enable_ai_web TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用联网发现',
        use_new_share_listed_recall TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Stage4：1=ipo_new_share主召回，0=1.0 ipo_project',
        enable_recall_ab_compare TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Stage4：并行新旧召回对比写入step_log',
        new_share_gray_categories VARCHAR(128) NULL COMMENT 'Stage4灰度赛道如ai,bio；空=全量',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0,
        UNIQUE KEY uk_ca_recall_app (app_id),
        CONSTRAINT fk_ca_recall_app FOREIGN KEY (app_id) REFERENCES applications(F_Id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品分析—三源召回配置';
    `);
    const recallStage4Cols = [
      {
        name: 'use_new_share_listed_recall',
        sql: `ADD COLUMN use_new_share_listed_recall TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Stage4：1=ipo_new_share主召回，0=1.0 ipo_project' AFTER enable_ai_web`,
      },
      {
        name: 'enable_recall_ab_compare',
        sql: `ADD COLUMN enable_recall_ab_compare TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Stage4：并行新旧召回对比写入step_log' AFTER use_new_share_listed_recall`,
      },
      {
        name: 'new_share_gray_categories',
        sql: `ADD COLUMN new_share_gray_categories VARCHAR(128) NULL COMMENT 'Stage4灰度赛道如ai,bio；空=全量' AFTER enable_recall_ab_compare`,
      },
    ];
    for (const col of recallStage4Cols) {
      try {
        await dbPool.query(`ALTER TABLE competitor_recall_source_config ${col.sql}`);
      } catch (e) {
        if (!String(e.message || '').includes('Duplicate column name')) {
          console.warn(`为 competitor_recall_source_config 增加 ${col.name} 时出现警告:`, e.message);
        }
      }
    }
    const CA_C = require('./utils/competitor-analysis/constants');
    const [existRecall] = await dbPool.query(
      'SELECT F_Id AS id FROM competitor_recall_source_config WHERE app_id = ? AND F_DeleteMark = 0 LIMIT 1',
      [CA_C.COMPETITOR_ANALYSIS_APP_ID]
    );
    if (!existRecall.length) {
      const { generateId } = require('./utils/idGenerator');
      const rid = await generateId('competitor_recall_source_config', dbPool);
      await dbPool.execute(
        `INSERT INTO competitor_recall_source_config (
          F_Id, app_id, enable_ipo_project, enable_financing_event, enable_ai_web,
          use_new_share_listed_recall, enable_recall_ab_compare
        ) VALUES (?, ?, 1, 1, 1, 0, 0)`,
        [rid, CA_C.COMPETITOR_ANALYSIS_APP_ID]
      );
    }
    console.log('✓ competitor_recall_source_config 表已就绪');
  } catch (err) {
    console.warn('创建 competitor_recall_source_config 时出现警告:', err.message);
  }

  // external_db_config.app_id：各应用「数据库连接」按顶栏应用隔离
  try {
    const [edbAppCol] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'external_db_config' AND COLUMN_NAME = 'app_id'
    `);
    if (!edbAppCol.length) {
      await dbPool.query(`
        ALTER TABLE external_db_config
        ADD COLUMN app_id VARCHAR(19) NULL COMMENT '所属应用 applications.id' AFTER is_active
      `);
      await dbPool.query(`
        ALTER TABLE external_db_config ADD INDEX idx_external_db_config_app_id (app_id)
      `);
      console.log('✓ external_db_config 已添加 app_id');
    }
    // 用 SHOW COLUMNS 实测列名，避免 INFORMATION_SCHEMA 与实际表不一致
    let dmColName = null;
    try {
      const [edbCols] = await dbPool.query('SHOW COLUMNS FROM `external_db_config`');
      const edbFields = new Set((edbCols || []).map((c) => String(c.Field || '')));
      if (edbFields.has('F_DeleteMark')) dmColName = 'F_DeleteMark';
      else if (edbFields.has('delete_mark')) dmColName = 'delete_mark';
    } catch (_) {
      dmColName = null;
    }
    const dmPredicate = dmColName ? `e.\`${dmColName}\` = 0` : '1=1';
    const dmPredicateSimple = dmColName ? `\`${dmColName}\` = 0` : '1=1';

    let bSqlDeletePred = '1=1';
    try {
      const [bSqlCols] = await dbPool.query('SHOW COLUMNS FROM `b_sql`');
      const bFields = new Set((bSqlCols || []).map((c) => String(c.Field || '')));
      if (bFields.has('F_DeleteMark')) bSqlDeletePred = 'b.`F_DeleteMark` = 0';
      else if (bFields.has('delete_mark')) bSqlDeletePred = 'b.`delete_mark` = 0';
    } catch (_) {
      bSqlDeletePred = '1=1';
    }

    const CA_C_EDB = require('./utils/competitor-analysis/constants');
    const LISTING_APP_ID = '2026033000000000001';
    await dbPool.execute(
      `UPDATE external_db_config e
       INNER JOIN ipo_project_sql_sync_setting s
         ON s.external_db_config_id = e.F_Id AND s.write_target = ?
       SET e.app_id = ?
       WHERE ${dmPredicate} AND (e.app_id IS NULL OR e.app_id = '')`,
      [CA_C_EDB.IPO_SQL_WRITE_TARGET_COMPETITOR, CA_C_EDB.COMPETITOR_ANALYSIS_APP_ID]
    );
    await dbPool.execute(
      `UPDATE external_db_config e
       INNER JOIN ipo_project_sql_sync_setting s
         ON s.external_db_config_id = e.F_Id
         AND (s.write_target IS NULL OR s.write_target = '' OR s.write_target = 'listing' OR s.write_target = 'project_sourcing')
       SET e.app_id = ?
       WHERE ${dmPredicate} AND (e.app_id IS NULL OR e.app_id = '')`,
      [LISTING_APP_ID]
    );
    const [perfApp] = await dbPool.query(
      "SELECT F_Id AS id FROM applications WHERE app_name = '业绩看板' AND F_DeleteMark = 0 LIMIT 1"
    );
    if (perfApp.length) {
      await dbPool.execute(
        `UPDATE external_db_config e
         INNER JOIN b_sql b ON b.external_db_config_id = e.F_Id AND ${bSqlDeletePred}
         SET e.app_id = ?
         WHERE ${dmPredicate} AND (e.app_id IS NULL OR e.app_id = '')`,
        [perfApp[0].id]
      );
    }
    await dbPool.execute(
      `UPDATE external_db_config SET app_id = ? WHERE ${dmPredicateSimple} AND (app_id IS NULL OR app_id = '')`,
      [LISTING_APP_ID]
    );
    console.log('✓ external_db_config.app_id 历史数据已回填');
  } catch (err) {
    console.warn('迁移 external_db_config.app_id 时出现警告:', err.message);
  }

  // 项目挖掘：投前项目（独立表）
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS pre_investment_project (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        enterprise_full_name VARCHAR(255) NOT NULL COMMENT '企业全称',
        unified_credit_code VARCHAR(64) NULL COMMENT '统一社会信用代码',
        project_abbreviation VARCHAR(255) NULL COMMENT '项目简称/检索用简称',
        project_no VARCHAR(32) NULL COMMENT '投前项目编号（展示，如 P202601011234）',
        qcc_company_intro LONGTEXT NULL COMMENT '企业介绍（企查查，可为清洗后写入）',
        qcc_sync_at DATETIME NULL COMMENT '最近一次企查查同步时间',
        qcc_sync_error VARCHAR(500) NULL COMMENT '最近一次企查查同步失败摘要',
        pipeline_status VARCHAR(32) NOT NULL DEFAULT 'draft' COMMENT 'draft/qcc_done/ai_done/failed 等',
        pipeline_error VARCHAR(500) NULL COMMENT '流水线错误摘要',
        ai_product_intro LONGTEXT NULL COMMENT '产品介绍(AI)',
        ai_industry_tags_display VARCHAR(2000) NULL COMMENT '行业标签(AI)展示',
        ai_industry_tags_json JSON NULL COMMENT '行业标签(AI) JSON',
        ai_enrich_status VARCHAR(32) NULL COMMENT 'AI 状态',
        ai_enrich_at DATETIME NULL COMMENT '最近 AI 成功时间',
        bp_filename VARCHAR(255) NULL COMMENT '上传的BP原始文件名',
        bp_file_path VARCHAR(500) NULL COMMENT 'BP文件磁盘路径（相对uploads根目录）',
        bp_extract_text LONGTEXT NULL COMMENT 'BP文件MarkItDown转换后的Markdown全文',
        data_app_id VARCHAR(19) NULL COMMENT 'applications.id',
        data_app_name VARCHAR(64) NOT NULL DEFAULT '项目挖掘' COMMENT '应用名',
        F_CreatorUserId VARCHAR(19) NOT NULL COMMENT '创建人',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记：0未删除，1已删除',
        F_DeleteTime DATETIME NULL COMMENT '删除时间',
        F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人用户ID',
        KEY idx_pip_creator (F_CreatorUserId, F_DeleteMark),
        KEY idx_pip_name (enterprise_full_name(64)),
        KEY idx_pip_delete (F_DeleteMark),
        CONSTRAINT fk_pip_creator FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE RESTRICT,
        CONSTRAINT fk_pip_delete_user FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目挖掘—投前项目';
    `);
    console.log('✓ pre_investment_project 表已就绪');
  } catch (err) {
    console.warn('创建 pre_investment_project 时出现警告:', err.message);
  }

  try {
    await dbPool.query(
      `ALTER TABLE pre_investment_project
       ADD COLUMN qcc_sync_at DATETIME NULL COMMENT '最近一次企查查同步时间' AFTER qcc_company_intro`
    );
    console.log('  ✓ pre_investment_project 已添加列 qcc_sync_at');
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column')) {
      console.warn('迁移 pre_investment_project.qcc_sync_at 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE pre_investment_project
       ADD COLUMN qcc_sync_error VARCHAR(500) NULL COMMENT '最近一次企查查同步失败摘要' AFTER qcc_sync_at`
    );
    console.log('  ✓ pre_investment_project 已添加列 qcc_sync_error');
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column')) {
      console.warn('迁移 pre_investment_project.qcc_sync_error 时出现警告:', err.message);
    }
  }

  try {
    await dbPool.query(
      `ALTER TABLE pre_investment_project
       ADD COLUMN project_no VARCHAR(32) NULL COMMENT '投前项目编号（展示）' AFTER project_abbreviation`
    );
    console.log('  ✓ pre_investment_project 已添加列 project_no');
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column')) {
      console.warn('迁移 pre_investment_project.project_no 时出现警告:', err.message);
    }
  }

  try {
    await dbPool.query(
      `ALTER TABLE pre_investment_project
       ADD COLUMN ai_enrich_model VARCHAR(128) NULL COMMENT 'AI 所用模型快照' AFTER ai_enrich_at`
    );
    console.log('  ✓ pre_investment_project 已添加列 ai_enrich_model');
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column')) {
      console.warn('迁移 pre_investment_project.ai_enrich_model 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE pre_investment_project
       ADD COLUMN ai_enrich_version VARCHAR(64) NULL COMMENT 'AI 管线版本' AFTER ai_enrich_model`
    );
    console.log('  ✓ pre_investment_project 已添加列 ai_enrich_version');
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column')) {
      console.warn('迁移 pre_investment_project.ai_enrich_version 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE pre_investment_project
       ADD COLUMN ai_enrich_error VARCHAR(500) NULL COMMENT 'AI 失败摘要' AFTER ai_enrich_version`
    );
    console.log('  ✓ pre_investment_project 已添加列 ai_enrich_error');
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column')) {
      console.warn('迁移 pre_investment_project.ai_enrich_error 时出现警告:', err.message);
    }
  }

  try {
    await dbPool.query(
      `ALTER TABLE pre_investment_project
       ADD COLUMN bp_filename VARCHAR(255) NULL COMMENT '上传的BP原始文件名' AFTER ai_enrich_at`
    );
    console.log('  ✓ pre_investment_project 已添加列 bp_filename');
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column')) {
      console.warn('迁移 pre_investment_project.bp_filename 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE pre_investment_project
       ADD COLUMN bp_file_path VARCHAR(500) NULL COMMENT 'BP文件磁盘路径' AFTER bp_filename`
    );
    console.log('  ✓ pre_investment_project 已添加列 bp_file_path');
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column')) {
      console.warn('迁移 pre_investment_project.bp_file_path 时出现警告:', err.message);
    }
  }
  try {
    await dbPool.query(
      `ALTER TABLE pre_investment_project
       ADD COLUMN bp_extract_text LONGTEXT NULL COMMENT 'BP文件MarkItDown转换后的Markdown全文' AFTER bp_file_path`
    );
    console.log('  ✓ pre_investment_project 已添加列 bp_extract_text');
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column')) {
      console.warn('迁移 pre_investment_project.bp_extract_text 时出现警告:', err.message);
    }
  }

  const addPipCol = async (colName, ddl) => {
    try {
      const [c] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_investment_project' AND COLUMN_NAME = ?`,
        [colName]
      );
      if (c.length === 0) {
        await dbPool.query(`ALTER TABLE pre_investment_project ${ddl}`);
        console.log(`  ✓ pre_investment_project 已添加列 ${colName}`);
      }
    } catch (err) {
      console.warn(`迁移 pre_investment_project.${colName} 时出现警告:`, err.message);
    }
  };
  await addPipCol(
    'company_intro',
    `ADD COLUMN company_intro LONGTEXT NULL COMMENT '企业介绍（百科/bp 等）' AFTER bp_extract_text`
  );
  await addPipCol(
    'product_intro',
    `ADD COLUMN product_intro LONGTEXT NULL COMMENT '产品简介（百科/bp 等）' AFTER company_intro`
  );
  await addPipCol(
    'profile_source',
    `ADD COLUMN profile_source VARCHAR(32) NULL COMMENT '画像来源：bp/baike/listed_sync/donor/llm_web' AFTER product_intro`
  );
  await addPipCol(
    'baike_lemma_url',
    `ADD COLUMN baike_lemma_url VARCHAR(512) NULL COMMENT '百科词条 URL' AFTER profile_source`
  );
  await addPipCol(
    'baike_lemma_status',
    `ADD COLUMN baike_lemma_status VARCHAR(32) NULL COMMENT '百科：found/not_found/anti_crawl' AFTER baike_lemma_url`
  );
  await addPipCol(
    'baike_miss_reason',
    `ADD COLUMN baike_miss_reason VARCHAR(64) NULL COMMENT '百科未命中原因' AFTER baike_lemma_status`
  );
  await addPipCol(
    'baike_lookup_at',
    `ADD COLUMN baike_lookup_at DATETIME NULL COMMENT '最近一次百科查词时间' AFTER baike_miss_reason`
  );
  await addPipCol(
    'structured_profile_json',
    `ADD COLUMN structured_profile_json JSON NULL COMMENT 'L2 structured 画像（Stage 3）' AFTER baike_lookup_at`
  );
  await addPipCol(
    'structured_schema_version',
    `ADD COLUMN structured_schema_version VARCHAR(32) NULL COMMENT 'structured schema 版本' AFTER structured_profile_json`
  );
  await addPipCol(
    'structured_at',
    `ADD COLUMN structured_at DATETIME NULL COMMENT 'structured 抽取时间' AFTER structured_schema_version`
  );
  await addPipCol(
    'competition_lens_json',
    `ADD COLUMN competition_lens_json JSON NULL COMMENT '最近确认的对标焦点（竞争透镜）快照' AFTER structured_at`
  );
  await addPipCol(
    'competition_lens_version',
    `ADD COLUMN competition_lens_version INT NULL COMMENT '竞争透镜版本号' AFTER competition_lens_json`
  );
  await addPipCol(
    'competition_lens_at',
    `ADD COLUMN competition_lens_at DATETIME NULL COMMENT '竞争透镜最近保存时间' AFTER competition_lens_version`
  );

  // BP 文件版本历史表
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS pre_investment_bp_version (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        project_id VARCHAR(19) NOT NULL COMMENT 'pre_investment_project.F_Id',
        version_no INT NOT NULL COMMENT '版本号（从1开始自增）',
        bp_filename VARCHAR(255) NOT NULL COMMENT 'BP原始文件名',
        bp_file_path VARCHAR(500) NOT NULL COMMENT 'BP文件磁盘路径（相对uploads根目录）',
        uploaded_by VARCHAR(19) NULL COMMENT '上传人',
        uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
        is_current TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否当前版本：1是 0否',
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记',
        KEY idx_bp_ver_project (project_id, version_no),
        KEY idx_bp_ver_current (project_id, is_current),
        CONSTRAINT fk_bp_ver_project FOREIGN KEY (project_id) REFERENCES pre_investment_project(F_Id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投前项目—BP文件版本历史'
    `);
    console.log('✓ pre_investment_bp_version 表已就绪');
  } catch (err) {
    console.warn('创建 pre_investment_bp_version 时出现警告:', err.message);
  }

  // 将现有 BP 记录迁移为版本 1
  try {
    const [existingVersions] = await dbPool.query(`
      SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pre_investment_bp_version'
    `);
    if (existingVersions.length && Number(existingVersions[0].c) > 0) {
      const [hasData] = await dbPool.query(`SELECT COUNT(*) AS c FROM pre_investment_bp_version`);
      if (Number(hasData[0].c || 0) === 0) {
        const [rows] = await dbPool.query(`
          SELECT F_Id, bp_filename, bp_file_path, F_CreatorUserId, F_CreatorTime
          FROM pre_investment_project
          WHERE F_DeleteMark = 0 AND bp_filename IS NOT NULL AND bp_filename != ''
        `);
        for (const row of rows) {
          const verId = await (require('./utils/idGenerator').generateId)();
          await dbPool.query(`
            INSERT INTO pre_investment_bp_version
            (F_Id, project_id, version_no, bp_filename, bp_file_path, uploaded_by, uploaded_at, is_current)
            VALUES (?, ?, 1, ?, ?, ?, ?, 1)
          `, [verId, row.F_Id, row.bp_filename, row.bp_file_path, row.F_CreatorUserId, row.F_CreatorTime]);
        }
        if (rows.length > 0) {
          console.log(`✓ 已将 ${rows.length} 条现有 BP 记录迁移为版本 1`);
        }
      }
    }
  } catch (err) {
    console.warn('迁移现有 BP 记录到版本表时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_competition_lens_version (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        subject_type VARCHAR(40) NOT NULL COMMENT 'invested_enterprise / pre_investment_project',
        subject_id VARCHAR(19) NOT NULL COMMENT '主体 id',
        version INT NOT NULL COMMENT '自增版本号',
        lens_json JSON NOT NULL COMMENT '该版本完整透镜快照',
        F_CreatorUserId VARCHAR(19) NULL COMMENT '保存人',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        KEY idx_lens_ver_subject (subject_type, subject_id, version),
        KEY idx_lens_ver_time (F_CreatorTime)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品分析—对标焦点透镜版本历史'
    `);
    console.log('✓ sourcing_competition_lens_version 表已就绪');
  } catch (err) {
    console.warn('创建 sourcing_competition_lens_version 时出现警告:', err.message);
  }

  // 修复 bp_filename 中文编码乱码（Windows multer 以 Latin-1 解析 UTF-8 字节）
  try {
    const rows = await dbPool.query(
      `SELECT F_Id AS id, bp_filename FROM pre_investment_project
       WHERE bp_filename IS NOT NULL AND bp_filename != '' AND F_DeleteMark = 0`
    );
    let fixedCount = 0;
    for (const row of rows) {
      try {
        const fixed = Buffer.from(row.bp_filename, 'latin1').toString('utf-8');
        // 修复后如果包含正常中文字符且与原来不同，说明原来确实是乱码
        if (fixed !== row.bp_filename && /[\u4e00-\u9fff]/.test(fixed)) {
          await dbPool.query(
            `UPDATE pre_investment_project SET bp_filename = ? WHERE F_Id = ?`,
            [fixed, row.id]
          );
          fixedCount++;
        }
      } catch { /* skip unconvertible rows */ }
    }
    if (fixedCount > 0) {
      console.log(`  ✓ 已修复 ${fixedCount} 条 bp_filename 编码乱码`);
    }
  } catch (err) {
    console.warn('迁移 bp_filename 编码修复时出现警告:', err.message);
  }

  // 项目挖掘：竞品分析任务运行记录
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_competitor_run (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        invested_enterprise_id VARCHAR(19) NOT NULL COMMENT '被投企业 id',
        status VARCHAR(32) NOT NULL DEFAULT 'success' COMMENT 'queued/running/success/failed/stub',
        message VARCHAR(500) NULL COMMENT '结果说明',
        triggered_by_user_id VARCHAR(19) NULL COMMENT '触发人',
        started_at DATETIME NULL COMMENT '开始时间',
        finished_at DATETIME NULL COMMENT '结束时间',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记',
        F_DeleteTime DATETIME NULL COMMENT '删除时间',
        F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人',
        KEY idx_scr_ie_time (invested_enterprise_id, F_CreatorTime),
        KEY idx_scr_delete (F_DeleteMark),
        CONSTRAINT fk_scr_user FOREIGN KEY (triggered_by_user_id) REFERENCES users(F_Id) ON DELETE SET NULL,
        CONSTRAINT fk_scr_del_user FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品分析运行记录';
    `);
    console.log('✓ sourcing_competitor_run 表已就绪');
  } catch (err) {
    console.warn('创建 sourcing_competitor_run 时出现警告:', err.message);
  }

  // 项目挖掘：竞品关系（后续接 LLM 打分写入）
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_competitor_relation (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        invested_enterprise_id VARCHAR(19) NOT NULL COMMENT '被投企业 id',
        run_id VARCHAR(19) NULL COMMENT 'sourcing_competitor_run.id',
        competitor_display_name VARCHAR(255) NULL COMMENT '竞品展示名',
        unified_credit_code VARCHAR(64) NULL COMMENT '竞品统一社会信用代码',
        competitor_weak_key VARCHAR(160) NULL COMMENT '无码时弱键',
        relevance_score INT NULL COMMENT '相关性 0-100',
        data_sources_json JSON NULL COMMENT '数据源标记数组',
        financing_amount_text VARCHAR(128) NULL COMMENT '融资金额展示',
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记',
        F_DeleteTime DATETIME NULL COMMENT '删除时间',
        F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        KEY idx_rel_ie (invested_enterprise_id, F_DeleteMark),
        KEY idx_rel_run (run_id),
        CONSTRAINT fk_rel_run FOREIGN KEY (run_id) REFERENCES sourcing_competitor_run(F_Id) ON DELETE SET NULL,
        CONSTRAINT fk_rel_del_user FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品关系明细';
    `);
    console.log('✓ sourcing_competitor_relation 表已就绪');
  } catch (err) {
    console.warn('创建 sourcing_competitor_relation 时出现警告:', err.message);
  }

  // 项目挖掘：投前项目竞品分析运行记录（与被投 sourcing_competitor_run 分离）
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_pre_investment_competitor_run (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        pre_investment_project_id VARCHAR(19) NOT NULL COMMENT 'pre_investment_project.id',
        status VARCHAR(32) NOT NULL DEFAULT 'stub' COMMENT 'queued/running/success/failed/stub',
        message VARCHAR(500) NULL COMMENT '结果说明',
        triggered_by_user_id VARCHAR(19) NULL COMMENT '触发人',
        started_at DATETIME NULL COMMENT '开始时间',
        finished_at DATETIME NULL COMMENT '结束时间',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记：0未删除，1已删除',
        F_DeleteTime DATETIME NULL COMMENT '删除时间',
        F_DeleteUserId VARCHAR(19) NULL COMMENT '删除人用户ID',
        KEY idx_spicr_pip_time (pre_investment_project_id, F_CreatorTime),
        KEY idx_spicr_delete (F_DeleteMark),
        CONSTRAINT fk_spicr_pip FOREIGN KEY (pre_investment_project_id) REFERENCES pre_investment_project(F_Id) ON DELETE CASCADE,
        CONSTRAINT fk_spicr_user FOREIGN KEY (triggered_by_user_id) REFERENCES users(F_Id) ON DELETE SET NULL,
        CONSTRAINT fk_spicr_del_user FOREIGN KEY (F_DeleteUserId) REFERENCES users(F_Id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投前项目竞品分析运行记录';
    `);
    console.log('✓ sourcing_pre_investment_competitor_run 表已就绪');
  } catch (err) {
    console.warn('创建 sourcing_pre_investment_competitor_run 时出现警告:', err.message);
  }

  // 项目挖掘：竞品分析步骤日志
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_competitor_run_step_log (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        run_id VARCHAR(19) NOT NULL COMMENT '运行记录 id（被投或投前 run 表）',
        subject_type VARCHAR(32) NOT NULL DEFAULT 'invested_enterprise' COMMENT 'invested_enterprise|pre_investment_project',
        step_code VARCHAR(32) NOT NULL COMMENT '步骤编码 S0~S6',
        status VARCHAR(16) NOT NULL DEFAULT 'ok' COMMENT 'ok|warn|failed',
        message VARCHAR(500) NULL COMMENT '步骤摘要',
        detail_json JSON NULL COMMENT '结构化明细',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        KEY idx_scrs_run (run_id, F_CreatorTime),
        KEY idx_scrs_step (step_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品分析运行步骤日志';
    `);
    console.log('✓ sourcing_competitor_run_step_log 表已就绪');
  } catch (err) {
    console.warn('创建 sourcing_competitor_run_step_log 时出现警告:', err.message);
  }

  const addScrCol = async (colName, ddl) => {
    try {
      const [c] = await dbPool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_competitor_relation' AND COLUMN_NAME = ?`,
        [colName]
      );
      if (c.length === 0) {
        await dbPool.query(`ALTER TABLE sourcing_competitor_relation ${ddl}`);
        console.log(`  ✓ sourcing_competitor_relation 已添加列 ${colName}`);
      }
    } catch (err) {
      console.warn(`迁移 sourcing_competitor_relation.${colName} 时出现警告:`, err.message);
    }
  };
  await addScrCol(
    'subject_type',
    `ADD COLUMN subject_type VARCHAR(32) NOT NULL DEFAULT 'invested_enterprise' COMMENT '主体类型' AFTER F_Id`
  );
  await addScrCol(
    'pre_investment_project_id',
    `ADD COLUMN pre_investment_project_id VARCHAR(19) NULL COMMENT '投前项目 id' AFTER invested_enterprise_id`
  );
  await addScrCol(
    'pre_investment_run_id',
    `ADD COLUMN pre_investment_run_id VARCHAR(19) NULL COMMENT '投前竞品 run id' AFTER run_id`
  );
  await addScrCol(
    'subject_display_name',
    `ADD COLUMN subject_display_name VARCHAR(255) NULL COMMENT '主体展示名' AFTER pre_investment_run_id`
  );
  await addScrCol(
    'confidence_grade',
    `ADD COLUMN confidence_grade VARCHAR(4) NULL COMMENT '置信等级 S/A/B/C' AFTER relevance_score`
  );
  await addScrCol(
    'score_breakdown_json',
    `ADD COLUMN score_breakdown_json JSON NULL COMMENT '评分明细 JSON' AFTER confidence_grade`
  );
  await addScrCol(
    'competitor_product_intro',
    `ADD COLUMN competitor_product_intro TEXT NULL COMMENT '竞品产品介绍(AI)' AFTER financing_amount_text`
  );
  await addScrCol(
    'competitor_tags_display',
    `ADD COLUMN competitor_tags_display VARCHAR(2000) NULL COMMENT '竞品企业标签展示' AFTER competitor_product_intro`
  );
  await addScrCol(
    'competitor_tags_json',
    `ADD COLUMN competitor_tags_json JSON NULL COMMENT '竞品企业标签JSON' AFTER competitor_tags_display`
  );
  await addScrCol(
    'sub_fund_names',
    `ADD COLUMN sub_fund_names VARCHAR(1000) NULL COMMENT '子基金名称(顿号分隔,来自底层项目)' AFTER competitor_tags_json`
  );
  await addScrCol(
    'is_listed',
    `ADD COLUMN is_listed TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否上市：1是0否(LLM不确定按否)' AFTER unified_credit_code`
  );
  await addScrCol(
    'financing_history_text',
    `ADD COLUMN financing_history_text TEXT NULL COMMENT '融资全轮次展示(日期-轮次-金额,多行)' AFTER financing_amount_text`
  );
  await addScrCol(
    'include_in_comparable',
    `ADD COLUMN include_in_comparable TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否放入可比公司：1是0否' AFTER F_CreatorTime`
  );
  await addScrCol(
    'F_CreatorUserId',
    `ADD COLUMN F_CreatorUserId VARCHAR(19) NULL COMMENT '创建人ID（NULL为AI创建）' AFTER include_in_comparable`
  );
  await addScrCol(
    'competitor_type',
    `ADD COLUMN competitor_type VARCHAR(32) NULL COMMENT '竞品类型：direct/indirect/substitute/upstream_downstream/same_track/not_competitor' AFTER score_breakdown_json`
  );
  await addScrCol(
    'dimension_scores',
    `ADD COLUMN dimension_scores JSON NULL COMMENT 'S5三维度子分 substitutability/customer_overlap/scenario_overlap' AFTER competitor_type`
  );
  await addScrCol(
    'evidence_summary',
    `ADD COLUMN evidence_summary TEXT NULL COMMENT 'S5竞品判断依据摘要' AFTER dimension_scores`
  );
  await addScrCol(
    'evidence_confidence',
    `ADD COLUMN evidence_confidence INT NULL COMMENT '证据可信度 0-100（系统计算）' AFTER evidence_summary`
  );
  await addScrCol(
    'needs_review',
    `ADD COLUMN needs_review TINYINT(1) NOT NULL DEFAULT 0 COMMENT '待人工复核：1是0否' AFTER evidence_confidence`
  );
  await addScrCol(
    'evidence_breakdown_json',
    `ADD COLUMN evidence_breakdown_json JSON NULL COMMENT '证据可信度四维子分 JSON' AFTER needs_review`
  );
  await addScrCol(
    'review_status',
    `ADD COLUMN review_status VARCHAR(32) NULL COMMENT '复核状态 pending/confirmed/dismissed/corrected' AFTER evidence_breakdown_json`
  );
  await addScrCol(
    'review_disposition',
    `ADD COLUMN review_disposition VARCHAR(32) NULL COMMENT '最近复核处置 confirm/reject/corrected/refresh' AFTER review_status`
  );
  await addScrCol(
    'reviewed_by_user_id',
    `ADD COLUMN reviewed_by_user_id VARCHAR(19) NULL COMMENT '复核人 users.F_Id' AFTER review_disposition`
  );
  await addScrCol(
    'reviewed_at',
    `ADD COLUMN reviewed_at DATETIME NULL COMMENT '复核时间' AFTER reviewed_by_user_id`
  );
  await addScrCol(
    'review_note',
    `ADD COLUMN review_note VARCHAR(500) NULL COMMENT '复核备注' AFTER reviewed_at`
  );
  await addScrCol(
    'human_locked',
    `ADD COLUMN human_locked TINYINT(1) NOT NULL DEFAULT 0 COMMENT '人工锁定：重跑不覆盖 1是0否' AFTER review_note`
  );
  try {
    await dbPool.query(
      `UPDATE sourcing_competitor_relation
       SET review_status = 'pending', F_LastModifyTime = NOW()
       WHERE F_DeleteMark = 0 AND needs_review = 1 AND (review_status IS NULL OR review_status = '')`
    );
  } catch (err) {
    console.warn('回填 sourcing_competitor_relation.review_status 时出现警告:', err.message);
  }
  try {
    const [migFlag] = await dbPool.query(
      `SELECT config_value FROM system_config WHERE config_key = 'migration_comparable_opt_in_v1' LIMIT 1`
    );
    if (migFlag.length > 0 && String(migFlag[0].config_value) === '1') {
      console.log('  ✓ 可比公司 opt-in 迁移已跳过（此前已完成）');
    } else {
      const { generateId } = require('./utils/idGenerator');
      const [resetResult] = await dbPool.query(
        `UPDATE sourcing_competitor_relation
         SET include_in_comparable = 0, F_LastModifyTime = NOW()
         WHERE F_DeleteMark = 0
           AND include_in_comparable = 1
           AND F_CreatorUserId IS NULL`
      );
      if (resetResult.affectedRows > 0) {
        console.log(
          `  ✓ sourcing_competitor_relation 已撤销 AI 默认可比勾选 ${resetResult.affectedRows} 条（改为用户主动勾选）`
        );
      }
      const prefRows = await dbPool.query(
        `SELECT subject_type, invested_enterprise_id, pre_investment_project_id, competitor_key
         FROM sourcing_competitor_comparable_pref
         WHERE include_in_comparable = 1`
      );
      let restored = 0;
      for (const p of prefRows) {
        const key = String(p.competitor_key || '').trim();
        if (!key) continue;
        let sql;
        let params;
        if (key.startsWith('name:')) {
          const namePart = key.slice(5);
          sql = `UPDATE sourcing_competitor_relation
                 SET include_in_comparable = 1, F_LastModifyTime = NOW()
                 WHERE F_DeleteMark = 0
                   AND subject_type = ?
                   AND (invested_enterprise_id <=> ?)
                   AND (pre_investment_project_id <=> ?)
                   AND (
                     LEFT(IFNULL(competitor_display_name,''), 160) = ?
                     OR LEFT(IFNULL(competitor_weak_key,''), 160) = ?
                   )`;
          params = [
            p.subject_type,
            p.invested_enterprise_id || null,
            p.pre_investment_project_id || null,
            namePart,
            namePart,
          ];
        } else {
          sql = `UPDATE sourcing_competitor_relation
                 SET include_in_comparable = 1, F_LastModifyTime = NOW()
                 WHERE F_DeleteMark = 0
                   AND subject_type = ?
                   AND (invested_enterprise_id <=> ?)
                   AND (pre_investment_project_id <=> ?)
                   AND UPPER(REPLACE(REPLACE(IFNULL(unified_credit_code,''),' ',''),'　','')) = ?`;
          params = [
            p.subject_type,
            p.invested_enterprise_id || null,
            p.pre_investment_project_id || null,
            key.toUpperCase(),
          ];
        }
        const [r] = await dbPool.query(sql, params);
        restored += r.affectedRows || 0;
      }
      if (restored > 0) {
        console.log(`  ✓ sourcing_competitor_relation 已从可比偏好恢复勾选 ${restored} 条`);
      }
      const flagId = await generateId('system_config', dbPool);
      await dbPool.execute(
        `INSERT INTO system_config (F_Id, config_key, config_value, config_desc)
         VALUES (?, 'migration_comparable_opt_in_v1', '1', '可比公司改为用户主动勾选')
         ON DUPLICATE KEY UPDATE config_value = '1', F_LastModifyTime = CURRENT_TIMESTAMP`,
        [flagId]
      );
    }
  } catch (err) {
    console.warn('修正 sourcing_competitor_relation.include_in_comparable 默认值时出现警告:', err.message);
  }
  try {
    const [fkRows] = await dbPool.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_competitor_relation'
         AND CONSTRAINT_NAME = 'fk_scr_rel_creator_user' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
       LIMIT 1`
    );
    if (!fkRows.length) {
      await dbPool.query(
        `ALTER TABLE sourcing_competitor_relation
         ADD CONSTRAINT fk_scr_rel_creator_user FOREIGN KEY (F_CreatorUserId) REFERENCES users(F_Id) ON DELETE SET NULL`
      );
      console.log('  ✓ sourcing_competitor_relation 已添加 F_CreatorUserId 外键');
    }
  } catch (err) {
    console.warn('迁移 sourcing_competitor_relation.F_CreatorUserId 外键时出现警告:', err.message);
  }
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_competitor_comparable_pref (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        subject_type VARCHAR(32) NOT NULL COMMENT 'invested_enterprise|pre_investment_project',
        invested_enterprise_id VARCHAR(19) NULL COMMENT '被投企业 id',
        pre_investment_project_id VARCHAR(19) NULL COMMENT '投前项目 id',
        competitor_key VARCHAR(200) NOT NULL COMMENT '竞品稳定键 cc:或 name:',
        include_in_comparable TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否放入可比公司',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        KEY idx_sccp_subject (subject_type, invested_enterprise_id, pre_investment_project_id),
        UNIQUE KEY uk_sccp_subject_competitor (subject_type, invested_enterprise_id, pre_investment_project_id, competitor_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='竞品可比公司勾选偏好(跨分析重跑保留)';
    `);
    console.log('✓ sourcing_competitor_comparable_pref 表已就绪');
  } catch (err) {
    console.warn('创建 sourcing_competitor_comparable_pref 时出现警告:', err.message);
  }

  // 投后竞品分析 — 定时任务
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_competitor_schedule_task (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        recipient_emails VARCHAR(1000) NOT NULL COMMENT '收件人，逗号/分号分隔',
        email_subject VARCHAR(255) NOT NULL COMMENT '邮件主题',
        email_body TEXT NULL COMMENT '邮件正文',
        cron_expression VARCHAR(128) NOT NULL COMMENT 'Cron（支持 Quartz 7 段）',
        project_status VARCHAR(32) NOT NULL COMMENT '项目状态=被投 exit_status',
        excluded_enterprise_ids JSON NULL COMMENT '长期排除的被投企业 ID 列表',
        is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
        last_run_at DATETIME NULL COMMENT '最近执行时间',
        last_run_status VARCHAR(32) NULL COMMENT '最近执行状态',
        last_run_summary VARCHAR(500) NULL COMMENT '最近执行摘要',
        F_CreatorUserId VARCHAR(19) NULL COMMENT '创建人',
        F_LastModifyUserId VARCHAR(19) NULL COMMENT '修改人',
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0 COMMENT '删除标记',
        KEY idx_scst_active (is_active, F_DeleteMark)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投后竞品分析定时任务'
    `);
    console.log('✓ sourcing_competitor_schedule_task 表已就绪');
  } catch (err) {
    console.warn('创建 sourcing_competitor_schedule_task 时出现警告:', err.message);
  }
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_competitor_schedule_run (
        F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
        task_id VARCHAR(19) NOT NULL COMMENT 'sourcing_competitor_schedule_task.F_Id',
        status VARCHAR(32) NOT NULL DEFAULT 'running' COMMENT 'running/success/partial/failed/skipped',
        trigger_type VARCHAR(16) NOT NULL DEFAULT 'cron' COMMENT 'cron/manual',
        started_at DATETIME NULL COMMENT '开始时间',
        finished_at DATETIME NULL COMMENT '结束时间',
        included_enterprise_ids JSON NULL COMMENT '本次实际纳入的企业 ID（供下次状态不符对比）',
        success_count INT NOT NULL DEFAULT 0,
        fail_count INT NOT NULL DEFAULT 0,
        skip_count INT NOT NULL DEFAULT 0,
        result_json JSON NULL COMMENT '明细：成功/失败/状态不符等',
        message VARCHAR(1000) NULL COMMENT '摘要',
        F_CreatorUserId VARCHAR(19) NULL,
        F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0,
        KEY idx_scsr_task (task_id, F_CreatorTime)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='投后竞品分析定时任务执行日志'
    `);
    console.log('✓ sourcing_competitor_schedule_run 表已就绪');
  } catch (err) {
    console.warn('创建 sourcing_competitor_schedule_run 时出现警告:', err.message);
  }
  try {
    const [ieCol] = await dbPool.query(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_competitor_relation' AND COLUMN_NAME = 'invested_enterprise_id'`
    );
    if (ieCol.length && ieCol[0].IS_NULLABLE === 'NO') {
      await dbPool.query(
        `ALTER TABLE sourcing_competitor_relation MODIFY COLUMN invested_enterprise_id VARCHAR(19) NULL COMMENT '被投企业 id（投前主体可空）'`
      );
      console.log('  ✓ sourcing_competitor_relation.invested_enterprise_id 已改为可空');
    }
  } catch (err) {
    console.warn('迁移 sourcing_competitor_relation.invested_enterprise_id 可空时出现警告:', err.message);
  }
  try {
    await dbPool.query(
      `UPDATE sourcing_competitor_relation SET subject_type = 'invested_enterprise'
       WHERE subject_type IS NULL OR TRIM(subject_type) = ''`
    );
  } catch (err) {
    console.warn('回填 sourcing_competitor_relation.subject_type 时出现警告:', err.message);
  }

  // 被投企业硬删时不级联清除竞品数据：同步后按企业全称/信用代码 UPDATE invested_enterprise_id 重挂
  for (const { table, fk } of [
    { table: 'sourcing_competitor_run', fk: 'fk_scr_ie' },
    { table: 'sourcing_competitor_relation', fk: 'fk_rel_ie' },
    { table: 'competitor_match_supplement', fk: 'fk_cms_ie' },
  ]) {
    try {
      const [existing] = await dbPool.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'
         LIMIT 1`,
        [table, fk]
      );
      if (existing.length) {
        await dbPool.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${fk}\``);
        console.log(`  ✓ ${table} 已移除 ${fk}（避免被投硬删级联清除竞品分析数据）`);
      }
    } catch (err) {
      if (!String(err.message || '').includes("doesn't exist")) {
        console.warn(`迁移 ${table}.${fk} 时出现警告:`, err.message);
      }
    }
  }

  // 项目挖掘：赛道 — 一级分类 — 二级分类（配置化匹配）
  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_track (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '赛道ID',
        name VARCHAR(100) NOT NULL COMMENT '赛道名称',
        sort_order INT NOT NULL DEFAULT 0 COMMENT '排序（小在前）',
        F_DeleteMark TINYINT NOT NULL DEFAULT 0 COMMENT '0正常 1删除',
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        F_LastModifyTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_sourcing_track_sort (F_DeleteMark, sort_order, F_Id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目挖掘-赛道';
    `);
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_track_lv1 (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '一级分类ID',
        track_id BIGINT NOT NULL COMMENT '赛道ID',
        name VARCHAR(100) NOT NULL COMMENT '一级分类名称',
        sort_order INT NOT NULL DEFAULT 0,
        F_DeleteMark TINYINT NOT NULL DEFAULT 0,
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        F_LastModifyTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_sourcing_track_lv1_track (track_id, F_DeleteMark, sort_order),
        CONSTRAINT fk_sourcing_track_lv1_track
          FOREIGN KEY (track_id) REFERENCES sourcing_track(F_Id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目挖掘-赛道下一级分类';
    `);
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_track_lv2 (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '二级分类ID（分组节点）',
        lv1_id BIGINT NOT NULL COMMENT '一级分类ID',
        name VARCHAR(100) NOT NULL COMMENT '二级分类名称',
        sort_order INT NOT NULL DEFAULT 0,
        F_DeleteMark TINYINT NOT NULL DEFAULT 0,
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        F_LastModifyTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_sourcing_track_lv2_lv1 (lv1_id, F_DeleteMark, sort_order),
        CONSTRAINT fk_sourcing_track_lv2_lv1
          FOREIGN KEY (lv1_id) REFERENCES sourcing_track_lv1(F_Id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目挖掘-二级分类（分组）';
    `);
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS sourcing_track_lv3 (
        F_Id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '三级节点ID（匹配叶子）',
        lv2_id BIGINT NOT NULL COMMENT '二级分类ID',
        name VARCHAR(100) NOT NULL COMMENT '三级名称',
        sort_order INT NOT NULL DEFAULT 0,
        match_industry_lv1 VARCHAR(100) NULL COMMENT '匹配用来源/标准一级行业（精确，可空）',
        match_industry_lv2 VARCHAR(100) NULL COMMENT '匹配用来源/标准二级行业（精确，可空）',
        match_keywords VARCHAR(500) NULL COMMENT '关键词（逗号/分号分隔，任一命中）',
        match_priority INT NOT NULL DEFAULT 0 COMMENT '优先级，越大越先匹配',
        F_DeleteMark TINYINT NOT NULL DEFAULT 0,
        F_CreatorTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        F_LastModifyTime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_sourcing_track_lv3_lv2 (lv2_id, F_DeleteMark, match_priority),
        CONSTRAINT fk_sourcing_track_lv3_lv2
          FOREIGN KEY (lv2_id) REFERENCES sourcing_track_lv2(F_Id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目挖掘-三级分类（匹配规则）';
    `);
    console.log('✓ sourcing_track / lv1 / lv2 / lv3 表已就绪');
  } catch (err) {
    console.warn('创建项目挖掘赛道表时出现警告:', err.message);
  }

  // 注意：此函数在 migrateBatchFColumns 之后运行，内部已兼容 F_ 命名列（F_DeleteMark 等），可安全重复执行
  try {
    await migrateSoftDeleteToDeleteMarkConvention(dbPool);
  } catch (err) {
    console.warn('migrateSoftDeleteToDeleteMarkConvention 执行时出现警告:', err.message);
  }

  // 软删除补齐可能新增 snake_case 列（delete_mark 等），再跑一轮 F_ 重命名确保 API 可用
  try {
    await migrateBatchFColumns(dbPool);
  } catch (err) {
    console.warn('migrateBatchFColumns（软删除补齐后）执行时出现警告:', err.message);
  }

  try {
    await ensureBaseDictionarySchema(dbPool);
    console.log('✓ base_dictionary 表结构终检完成（F_ 系统字段）');
  } catch (err) {
    console.warn('base_dictionary 终检迁移时出现警告:', err.message);
  }

  // 赛道：将二级上的匹配字段迁移到三级（旧库一次性迁移）
  try {
    const [tblRow] = await dbPool.query(`
      SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_track_lv3'
    `);
    if (tblRow.length && Number(tblRow[0].c) > 0) {
      const [mCol] = await dbPool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_track_lv2' AND COLUMN_NAME = 'match_industry_lv1'
      `);
      const [lv3Cnt] = await dbPool.query(`SELECT COUNT(*) AS c FROM sourcing_track_lv3`);
      if (mCol.length && Number(lv3Cnt[0].c || 0) === 0) {
        await dbPool.query(`
          INSERT INTO sourcing_track_lv3 (lv2_id, name, sort_order, match_industry_lv1, match_industry_lv2, match_keywords, match_priority, F_DeleteMark)
          SELECT F_Id, name, sort_order, match_industry_lv1, match_industry_lv2, match_keywords, match_priority, F_DeleteMark
          FROM sourcing_track_lv2 WHERE F_DeleteMark = 0
        `);
        console.log('✓ 已将旧版 sourcing_track_lv2 匹配规则迁移至 sourcing_track_lv3');
      }
      const dropMatchCols = ['match_industry_lv1', 'match_industry_lv2', 'match_keywords', 'match_priority'];
      for (let di = 0; di < dropMatchCols.length; di++) {
        const cn = dropMatchCols[di];
        const [hasCol] = await dbPool.query(`
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sourcing_track_lv2' AND COLUMN_NAME = ?
        `, [cn]);
        if (hasCol.length) {
          await dbPool.query('ALTER TABLE sourcing_track_lv2 DROP COLUMN `' + cn + '`');
          console.log('✓ sourcing_track_lv2 已移除列 ' + cn);
        }
      }
    }
  } catch (err) {
    console.warn('迁移赛道 lv2→lv3 匹配字段时出现警告:', err.message);
  }

  try {
    const { seedDefaultSourcingTracks } = require('./utils/project-sourcing/dbSeedTrackDefaults');
    await seedDefaultSourcingTracks(dbPool);
  } catch (err) {
    console.warn('写入默认赛道种子（人工智能/生物医药/半导体）时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS ipo_project_sql_sync_setting (
        F_Id VARCHAR(19) PRIMARY KEY COMMENT '配置ID',
        user_id VARCHAR(50) NOT NULL COMMENT '用户ID',
        write_target VARCHAR(32) NOT NULL DEFAULT 'listing' COMMENT 'listing=上市进展写入; project_sourcing=项目挖掘写入',
        external_db_config_id VARCHAR(19) NULL COMMENT 'external_db_config.id',
        sql_text TEXT NULL COMMENT '只读查询 SQL',
        is_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用：1启用，0禁用',
        cron_expression VARCHAR(100) NULL COMMENT '定时同步Cron表达式（5位或Quartz 6/7位）',
        column_map JSON NULL COMMENT 'SQL列名 -> ipo_project 业务字段名',
        F_CreatorTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        F_LastModifyTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_ipo_sql_sync_user_db_target (user_id, external_db_config_id, write_target)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='底层项目-业务库SQL同步配置（按用户+数据库连接+写入应用）';
    `);
    console.log('✓ ipo_project_sql_sync_setting 表已就绪');
  } catch (err) {
    console.warn('创建 ipo_project_sql_sync_setting 表时出现警告:', err.message);
  }

  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_sql_sync_setting' AND COLUMN_NAME = 'is_enabled'
    `);
    if (cols.length === 0) {
      await dbPool.query(`
        ALTER TABLE ipo_project_sql_sync_setting
        ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用：1启用，0禁用' AFTER sql_text
      `);
      console.log('✓ ipo_project_sql_sync_setting 已添加 is_enabled');
    }
  } catch (err) {
    console.warn('迁移 ipo_project_sql_sync_setting.is_enabled 时出现警告:', err.message);
  }

  try {
    const [cols] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_sql_sync_setting' AND COLUMN_NAME = 'cron_expression'
    `);
    if (cols.length === 0) {
      await dbPool.query(`
        ALTER TABLE ipo_project_sql_sync_setting
        ADD COLUMN cron_expression VARCHAR(100) NULL COMMENT '定时同步Cron表达式（5位或Quartz 6/7位）' AFTER is_enabled
      `);
      console.log('✓ ipo_project_sql_sync_setting 已添加 cron_expression');
    }
  } catch (err) {
    console.warn('迁移 ipo_project_sql_sync_setting.cron_expression 时出现警告:', err.message);
  }

  try {
    const [idx] = await dbPool.query(`
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ipo_project_sql_sync_setting'
        AND INDEX_NAME = 'uk_ipo_sql_sync_user'
      LIMIT 1
    `);
    if (idx.length > 0) {
      await dbPool.query(`
        ALTER TABLE ipo_project_sql_sync_setting
        DROP INDEX uk_ipo_sql_sync_user
      `);
      console.log('✓ ipo_project_sql_sync_setting 已移除旧唯一索引 uk_ipo_sql_sync_user');
    }
  } catch (err) {
    console.warn('迁移 ipo_project_sql_sync_setting 旧唯一索引时出现警告:', err.message);
  }

  try {
    const [colWt] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_sql_sync_setting' AND COLUMN_NAME = 'write_target'
    `);
    if (!colWt.length) {
      await dbPool.query(`
        ALTER TABLE ipo_project_sql_sync_setting
        ADD COLUMN write_target VARCHAR(32) NOT NULL DEFAULT 'listing'
          COMMENT 'listing=上市进展写入; project_sourcing=项目挖掘写入'
          AFTER user_id
      `);
      console.log('✓ ipo_project_sql_sync_setting 已添加 write_target');
    }
  } catch (err) {
    console.warn('迁移 ipo_project_sql_sync_setting.write_target 时出现警告:', err.message);
  }

  try {
    const [idxOld] = await dbPool.query(`
      SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_sql_sync_setting'
        AND INDEX_NAME = 'uk_ipo_sql_sync_user_db'
      LIMIT 1
    `);
    if (idxOld.length) {
      await dbPool.query(`ALTER TABLE ipo_project_sql_sync_setting DROP INDEX uk_ipo_sql_sync_user_db`);
      console.log(
        '✓ ipo_project_sql_sync_setting 已移除遗留 uk_ipo_sql_sync_user_db（上市进展与项目挖掘可各一条配置）'
      );
    }
    const [idxNew] = await dbPool.query(`
      SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_sql_sync_setting'
        AND INDEX_NAME = 'uk_ipo_sql_sync_user_db_target'
      LIMIT 1
    `);
    if (!idxNew.length) {
      await dbPool.query(`
        ALTER TABLE ipo_project_sql_sync_setting
        ADD UNIQUE KEY uk_ipo_sql_sync_user_db_target (user_id, external_db_config_id, write_target)
      `);
      console.log('✓ ipo_project_sql_sync_setting 已添加 uk_ipo_sql_sync_user_db_target');
    }
  } catch (err) {
    console.warn('迁移 ipo_project_sql_sync_setting 唯一索引 write_target 时出现警告:', err.message);
  }

  try {
    const [colQccSql] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ipo_project_sql_sync_setting' AND COLUMN_NAME = 'qcc_brief_after_sync_enabled'
    `);
    if (!colQccSql.length) {
      await dbPool.query(`
        ALTER TABLE ipo_project_sql_sync_setting
        ADD COLUMN qcc_brief_after_sync_enabled TINYINT(1) NOT NULL DEFAULT 0
          COMMENT 'SQL全量写入后是否对有效统一社会信用代码批量拉取企查查企业简介（仅项目挖掘 data_app_id 写入时生效）'
          AFTER cron_expression
      `);
      console.log('✓ ipo_project_sql_sync_setting 已添加 qcc_brief_after_sync_enabled');
    }
  } catch (err) {
    if (!String(err.message || '').includes('Duplicate column')) {
      console.warn('迁移 ipo_project_sql_sync_setting.qcc_brief_after_sync_enabled 时出现警告:', err.message);
    }
  }

  try {
    const [rcpAppId] = await dbPool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recipient_management' AND COLUMN_NAME = 'app_id'
    `);
    if (rcpAppId.length === 0) {
      await dbPool.query(`
        ALTER TABLE recipient_management
        ADD COLUMN app_id VARCHAR(19) NULL COMMENT '应用ID' AFTER user_id
      `);
      const [newsApps] = await dbPool.query(
        `SELECT F_Id AS id FROM applications WHERE BINARY app_name = BINARY ? LIMIT 1`,
        ['新闻舆情']
      );
      if (newsApps.length > 0) {
        await dbPool.query(`UPDATE recipient_management SET app_id = ? WHERE app_id IS NULL`, [newsApps[0].id]);
      }
      console.log('✓ recipient_management 已添加 app_id 并回填新闻舆情应用');
    }
  } catch (err) {
    console.warn('迁移 recipient_management.app_id 时出现警告:', err.message);
  }

  try {
    await dbPool.query(`
      INSERT IGNORE INTO applications (F_Id, app_name, F_CreatorTime)
      VALUES ('2026033000000000001', '上市进展', '2026-03-30 18:00:00')
    `);
    console.log('✓ applications 上市进展应用记录已就绪');
  } catch (err) {
    console.warn('插入 applications 上市进展时出现警告:', err.message);
  }

  // 上市进展：会员等级（用户管理中可选）+ 邮件配置（复制新闻舆情 SMTP，便于开箱发信）
  try {
    const { generateId } = require('./utils/idGenerator');
    const [listingApps] = await dbPool.query(
      `SELECT F_Id AS id FROM applications WHERE BINARY app_name = BINARY ? LIMIT 1`,
      ['上市进展']
    );
    if (listingApps.length) {
      const listingAppId = listingApps[0].id;
      const [existEc] = await dbPool.query(
        `SELECT F_Id AS id FROM email_config WHERE app_id = ? LIMIT 1`,
        [listingAppId]
      );
      if (existEc.length === 0) {
        const [newsEc] = await dbPool.query(
          `SELECT ec.* FROM email_config ec
           INNER JOIN applications a ON ec.app_id = a.F_Id
           WHERE BINARY a.app_name = BINARY ? LIMIT 1`,
          ['新闻舆情']
        );
        if (newsEc.length > 0) {
          const ne = newsEc[0];
          const newEcId = await generateId('email_config', dbPool);
          await dbPool.execute(
            `INSERT INTO email_config (
              F_Id, app_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password,
              from_email, from_name, pop_host, pop_port, pop_secure, pop_user, pop_password, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newEcId,
              listingAppId,
              ne.smtp_host,
              ne.smtp_port,
              ne.smtp_secure,
              ne.smtp_user,
              ne.smtp_password,
              ne.from_email,
              ne.from_name || '上市进展',
              ne.pop_host,
              ne.pop_port,
              ne.pop_secure,
              ne.pop_user,
              ne.pop_password,
              ne.is_active !== undefined ? ne.is_active : 1,
            ]
          );
          console.log('✓ 已按新闻舆情 SMTP 复制上市进展 email_config');
        } else {
          console.warn('  未找到新闻舆情 email_config，跳过上市进展邮件配置自动创建（请管理员在「邮件配置」中手动添加上市进展应用）');
        }
      }
    }
  } catch (err) {
    console.warn('上市进展会员等级或邮件配置初始化时出现警告:', err.message);
  }

  const { seedApplicationsAndEmailFallback } = require('./utils/project-sourcing/dbSeedFinancing');
  await seedApplicationsAndEmailFallback(dbPool);

  console.log('  → 竞品分析 AI 提示词默认种子…');
  try {
    const { seedCompetitorAnalysisPrompts } = require('./utils/initPrompts');
    const promptSeed = await seedCompetitorAnalysisPrompts(dbPool);
    if (promptSeed.skipped) {
      console.warn('  跳过竞品分析提示词种子：ai_prompt_config 表不存在');
    } else if (promptSeed.created > 0 || promptSeed.updated > 0) {
      console.log(
        `  ✓ 竞品分析提示词：创建 ${promptSeed.created} 条，更新 ${promptSeed.updated} 条`
      );
    } else {
      console.log('  ✓ 竞品分析提示词已就绪');
    }
  } catch (err) {
    console.warn('  竞品分析提示词种子时出现警告:', err.message);
    if (err.stack) {
      console.warn(err.stack);
    }
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
  const restoreDbInitLogs = installDbInitLogFilter();
  try {
    console.log('正在初始化数据库...');
    // 确保数据库存在
    await createDatabaseIfNeeded();
    // 创建数据库连接池
    pool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT_NUM,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
      timezone: '+08:00',
      connectTimeout: 20000
    });
    await pool.query("SET time_zone = '+08:00'");
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

    try {
      const { ensureAiEnrichLogSearchColumns } = require('./utils/migrateAiEnrichLogColumns');
      const n = await ensureAiEnrichLogSearchColumns(pool);
      if (n > 0) {
        console.log(`✓ AI 增强日志表联网/思考列补全 ${n} 列`);
      }
    } catch (migColErr) {
      console.warn('补全 AI 增强日志列时出现警告:', migColErr.message);
    }

    try {
      const { ensureAiModelConfigEnrichFlags } = require('./utils/migrateAiModelConfigEnrichFlags');
      const nModel = await ensureAiModelConfigEnrichFlags(pool);
      if (nModel > 0) {
        console.log('✓ ai_model_config 已添加 enable_thinking（联网 AI 补齐）');
      }
    } catch (migModelErr) {
      console.warn('补全 ai_model_config.enable_thinking 时出现警告:', migModelErr.message);
    }

    try {
      const { ensureAiModelConfigLlmFields } = require('./utils/migrateAiModelConfigLlmFields');
      const nLlm = await ensureAiModelConfigLlmFields(pool);
      if (nLlm > 0) {
        console.log(`✓ ai_model_config 已添加 LLM 协议字段 ${nLlm} 列`);
      }
    } catch (migLlmErr) {
      console.warn('补全 ai_model_config LLM 字段时出现警告:', migLlmErr.message);
    }

    console.log('✓ 数据库初始化完成');
  } catch (error) {
    const detail =
      [
        error.code,
        error.errno,
        error.sqlState,
        error.sqlMessage,
        error.syscall,
        error.address != null && error.port != null ? `${error.address}:${error.port}` : null,
        error.message
      ]
        .filter(Boolean)
        .join(' | ') || '(无详细消息)';
    console.error('数据库初始化过程中出错:', detail);
    console.error('错误堆栈:', error.stack);
    throw error;
  } finally {
    restoreDbInitLogs();
  }
}

const ready = init().catch((err) => {
  const detail =
    [
      err.code,
      err.errno,
      err.sqlState,
      err.sqlMessage,
      err.syscall,
      err.address != null && err.port != null ? `${err.address}:${err.port}` : null,
      err.message
    ]
      .filter(Boolean)
      .join(' | ') || '(无详细消息)';
  console.error('数据库初始化失败:', detail);
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

async function runPendingMigrations() {
  await ready;
  const { ensureAiEnrichLogSearchColumns } = require('./utils/migrateAiEnrichLogColumns');
  const { ensureAiModelConfigEnrichFlags } = require('./utils/migrateAiModelConfigEnrichFlags');
  const { migrateOverseasNameNormalization } = require('./utils/listing/migrateOverseasNameNormalization');
  const n1 = await ensureAiEnrichLogSearchColumns(pool);
  const n2 = await ensureAiModelConfigEnrichFlags(pool);
  const n3 = await migrateOverseasNameNormalization(pool);
  return n1 + n2 + n3;
}

module.exports = {
  query,
  execute,
  getConnection,
  closePool,
  runPendingMigrations,
};
