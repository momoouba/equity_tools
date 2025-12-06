require('dotenv').config();
const mysql = require('mysql2/promise');
const { Pool: PgPool } = require('pg');

// 存储所有外部数据库连接池
const externalPools = new Map();

/**
 * 创建外部数据库连接池
 * @param {Object} config - 数据库配置
 * @param {string} config.id - 配置ID
 * @param {string} config.db_type - 数据库类型：mysql/postgresql
 * @param {string} config.host - 数据库主机
 * @param {number} config.port - 数据库端口
 * @param {string} config.user - 数据库用户名
 * @param {string} config.password - 数据库密码
 * @param {string} config.database - 数据库名称
 * @returns {Promise<Object>} 连接池对象
 */
async function createExternalPool(config) {
  try {
    const dbType = config.db_type || 'mysql';
    
    if (dbType === 'postgresql' || dbType === 'pg') {
      // PostgreSQL 连接池
      const pool = new PgPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000 // 增加连接超时时间
      });

      // 测试连接
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      
      // 将连接池保存到缓存中
      externalPools.set(config.id, pool);

      return pool;
    } else {
      // MySQL 连接池
      const pool = mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0, // 无限制等待队列
        charset: 'utf8mb4',
        connectTimeout: 30000, // 连接超时时间30秒（MySQL2 支持）
        enableKeepAlive: true, // 启用keep-alive保持连接
        keepAliveInitialDelay: 0
        // 注意：MySQL2 不支持 acquireTimeout 和 timeout 选项
        // 查询超时需要在执行查询时单独设置，或使用 connection.query() 的 timeout 选项
      });

      // 测试连接
      const connection = await pool.getConnection();
      await connection.ping();
      connection.release();
      
      // 将连接池保存到缓存中
      externalPools.set(config.id, pool);

      return pool;
    }
  } catch (error) {
    console.error(`创建外部数据库连接池失败 (${config.id}):`, error.message);
    throw error;
  }
}

/**
 * 初始化外部数据库连接
 * @param {Array} configs - 外部数据库配置列表
 */
async function initializeExternalDatabases(configs) {
  try {
    // 关闭所有现有连接
    for (const [id, pool] of externalPools.entries()) {
      try {
        await pool.end();
      } catch (err) {
        console.warn(`关闭外部数据库连接失败 (${id}):`, err.message);
      }
    }
    externalPools.clear();

    // 创建新连接
    for (const config of configs) {
      if (config.is_active === 1 && !config.is_deleted) {
        try {
          const pool = await createExternalPool(config);
          externalPools.set(config.id, pool);
          console.log(`✓ 外部数据库连接已建立: ${config.name} (${config.host}:${config.port}/${config.database})`);
        } catch (error) {
          console.error(`✗ 外部数据库连接失败: ${config.name}`, error.message);
        }
      }
    }

    console.log(`✓ 外部数据库初始化完成，共 ${externalPools.size} 个连接`);
  } catch (error) {
    console.error('初始化外部数据库失败:', error.message);
    throw error;
  }
}

/**
 * 获取外部数据库连接池
 * @param {string} configId - 配置ID
 * @returns {Object|null} 连接池对象，如果不存在则返回null
 */
function getExternalPool(configId) {
  return externalPools.get(configId) || null;
}

/**
 * 查询外部数据库
 * @param {string} configId - 配置ID
 * @param {string} sql - SQL查询语句
 * @param {Array} params - 查询参数
 * @returns {Promise<Array>} 查询结果
 */
async function queryExternal(configId, sql, params = []) {
  const pool = getExternalPool(configId);
  if (!pool) {
    throw new Error(`外部数据库连接不存在: ${configId}`);
  }

  try {
    // 判断是 PostgreSQL 还是 MySQL
    if (pool.constructor.name === 'Pool' && pool.query && typeof pool.query === 'function' && !pool.getConnection) {
      // PostgreSQL
      const result = await pool.query(sql, params);
      return result.rows;
    } else {
      // MySQL
      const [rows] = await pool.query(sql, params);
      return rows;
    }
  } catch (error) {
    console.error(`外部数据库查询失败 (${configId}):`, error.message);
    throw error;
  }
}

/**
 * 执行外部数据库操作（INSERT/UPDATE/DELETE）
 * @param {string} configId - 配置ID
 * @param {string} sql - SQL语句
 * @param {Array} params - 参数
 * @returns {Promise<Object>} 执行结果
 */
async function executeExternal(configId, sql, params = []) {
  const pool = getExternalPool(configId);
  if (!pool) {
    throw new Error(`外部数据库连接不存在: ${configId}`);
  }

  try {
    // 判断是 PostgreSQL 还是 MySQL
    if (pool.constructor.name === 'Pool' && pool.query && typeof pool.query === 'function' && !pool.getConnection) {
      // PostgreSQL
      const result = await pool.query(sql, params);
      return { rowCount: result.rowCount, rows: result.rows };
    } else {
      // MySQL
      const [result] = await pool.execute(sql, params);
      return result;
    }
  } catch (error) {
    console.error(`外部数据库执行失败 (${configId}):`, error.message);
    throw error;
  }
}

/**
 * 获取外部数据库连接
 * @param {string} configId - 配置ID
 * @returns {Promise<Object>} 数据库连接对象
 */
async function getExternalConnection(configId) {
  const pool = getExternalPool(configId);
  if (!pool) {
    throw new Error(`外部数据库连接不存在: ${configId}`);
  }

  // PostgreSQL 使用不同的方式获取连接
  if (pool.constructor.name === 'Pool' && pool.query && typeof pool.query === 'function' && !pool.getConnection) {
    return await pool.connect();
  } else {
    // MySQL
    return await pool.getConnection();
  }
}

/**
 * 测试外部数据库连接
 * @param {Object} config - 数据库配置
 * @returns {Promise<Object>} 测试结果
 */
async function testExternalConnection(config) {
  let connection = null;
  try {
    const dbType = config.db_type || 'mysql';
    
    if (dbType === 'postgresql' || dbType === 'pg') {
      // PostgreSQL 连接测试
      const { Client } = require('pg');
      connection = new Client({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        connectionTimeoutMillis: 5000
      });

      await connection.connect();
      await connection.query('SELECT 1');

      return {
        success: true,
        message: '连接成功'
      };
    } else {
      // MySQL 连接测试
      connection = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        connectTimeout: 5000
      });

      await connection.ping();
      await connection.query('SELECT 1');

      return {
        success: true,
        message: '连接成功'
      };
    }
  } catch (error) {
    return {
      success: false,
      message: error.message || '连接失败'
    };
  } finally {
    if (connection) {
      if (connection.end) {
        await connection.end();
      } else if (connection.release) {
        connection.release();
      }
    }
  }
}

/**
 * 关闭所有外部数据库连接
 */
async function closeAllExternalPools() {
  for (const [id, pool] of externalPools.entries()) {
    try {
      // PostgreSQL 和 MySQL 都使用 end() 方法
      await pool.end();
      console.log(`✓ 已关闭外部数据库连接: ${id}`);
    } catch (error) {
      console.error(`关闭外部数据库连接失败 (${id}):`, error.message);
    }
  }
  externalPools.clear();
}

/**
 * 关闭指定外部数据库连接
 * @param {string} configId - 配置ID
 */
async function closeExternalPool(configId) {
  const pool = externalPools.get(configId);
  if (pool) {
    try {
      await pool.end();
      externalPools.delete(configId);
      console.log(`✓ 已关闭外部数据库连接: ${configId}`);
    } catch (error) {
      console.error(`关闭外部数据库连接失败 (${configId}):`, error.message);
    }
  }
}

module.exports = {
  createExternalPool,
  initializeExternalDatabases,
  getExternalPool,
  queryExternal,
  executeExternal,
  getExternalConnection,
  testExternalConnection,
  closeAllExternalPools,
  closeExternalPool
};

