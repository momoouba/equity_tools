const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const authRoutes = require('./routes/auth');
const enterpriseRoutes = require('./routes/enterprises');
const companyRoutes = require('./routes/companies');
const systemRoutes = require('./routes/system');
const qichachaRoutes = require('./routes/qichacha');
const newsRoutes = require('./routes/news');
const additionalAccountsRoutes = require('./routes/additionalAccounts');
const aiConfigRoutes = require('./routes/aiConfig');
const newsAnalysisRoutes = require('./routes/newsAnalysis');
const emailRoutes = require('./routes/email');
const scheduledTasksRoutes = require('./routes/scheduledTasks');
const externalDbRoutes = require('./routes/externalDb');
const syncNewsData = newsRoutes.syncNewsData;
const { initializeScheduledTasks } = require('./utils/scheduledEmailTasks');
const { initializeExternalDatabases } = require('./utils/externalDb');
const { initializeEnterpriseSyncTasks } = require('./utils/enterpriseSyncTasks');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务 - 提供uploads目录的访问
// 注意：必须在所有路由之前配置，以确保静态文件请求不会被其他路由拦截
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 添加调试中间件（记录静态文件请求）
app.use('/api/uploads', (req, res, next) => {
  // express.static 会自动去掉 /api/uploads 前缀，所以 req.path 已经是文件名了
  const filePath = path.join(uploadsDir, req.path);
  const exists = fs.existsSync(filePath);
  console.log(`[Static File] Request: ${req.originalUrl}, Path: ${req.path}, File: ${filePath}, Exists: ${exists}`);
  if (!exists && req.path !== '/') {
    try {
      const files = fs.readdirSync(uploadsDir);
      console.log(`[Static File] Available files (first 10): ${files.slice(0, 10).join(', ')}`);
    } catch (err) {
      console.error(`[Static File] Cannot read directory:`, err.message);
    }
  }
  next();
});

// 配置静态文件服务
app.use('/api/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    // 设置缓存控制头
    res.set('Cache-Control', 'public, max-age=86400');
    // 设置内容类型
    if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
      res.set('Content-Type', 'image/jpeg');
    } else if (filePath.endsWith('.png')) {
      res.set('Content-Type', 'image/png');
    }
  },
  dotfiles: 'ignore',
  index: false
}));

async function restoreStoredConfigFiles() {
  try {
    const files = await db.query(
      'SELECT config_key, filename, file_data FROM system_file_storage WHERE file_data IS NOT NULL'
    );
    for (const file of files) {
      if (!file.filename || !file.file_data) continue;
      const targetPath = path.join(uploadsDir, file.filename);
      if (!fs.existsSync(targetPath)) {
        try {
          fs.writeFileSync(targetPath, file.file_data);
          console.log(`✓ 已恢复配置文件: ${file.config_key} -> ${file.filename}`);
        } catch (err) {
          console.error(`恢复配置文件 ${file.config_key} 失败:`, err.message);
        }
      }
    }
  } catch (error) {
    if (error.message?.includes('system_file_storage')) {
      console.warn('system_file_storage 表不存在，跳过配置文件恢复');
    } else {
      console.error('恢复配置文件失败：', error.message || error);
    }
  }
}

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/enterprises', enterpriseRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/qichacha', qichachaRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/additional-accounts', additionalAccountsRoutes);
app.use('/api/ai-config', aiConfigRoutes);
app.use('/api/news-analysis', newsAnalysisRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/scheduled-tasks', scheduledTasksRoutes);
app.use('/api/external-db', externalDbRoutes);

// 全局错误日志
app.use((err, req, res, next) => {
  console.error(`[Express Error] ${req.method} ${req.originalUrl}:`, err.stack || err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      success: false,
      message: err.message || '服务器内部错误'
    });
  }
});

// 健康检查
app.get('/api/health', async (req, res) => {
  try {
    // 测试数据库连接
    await db.query('SELECT 1');
    res.json({ status: 'ok', message: '服务器运行正常', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: '数据库连接失败', error: error.message });
  }
});

// 测试上传文件访问的路由（用于调试）
app.get('/api/test-upload-file/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);
  const exists = fs.existsSync(filePath);
  
  res.json({
    filename,
    filePath,
    exists,
    uploadsDir,
    files: exists ? undefined : fs.readdirSync(uploadsDir).slice(0, 20)
  });
});

// 等待数据库初始化完成后启动服务器
async function startServer() {
  try {
    // 等待数据库初始化（通过执行一个查询来确保数据库已就绪）
    console.log('正在初始化数据库...');
    try {
      await db.query('SELECT 1');
      console.log('✓ 数据库连接已就绪');
      await restoreStoredConfigFiles();
    } catch (dbError) {
      console.error('✗ 数据库初始化失败:', dbError.message);
      console.error('错误堆栈:', dbError.stack);
      console.error('请检查：');
      console.error('1. MySQL 服务是否已启动');
      console.error('2. .env 文件配置是否正确');
      console.error('3. 数据库连接信息是否正确');
      console.error('4. 数据库表结构是否已正确创建');
      throw dbError;
    }
    
    // 启动服务器
    console.log(`正在启动服务器，监听端口 ${PORT}...`);
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`✓ 服务器运行在 http://localhost:${PORT}`);
      console.log(`✓ 服务器已就绪，可以接收请求`);
      
      // 启动定时任务：每天00:00:00执行新闻同步
      console.log('正在启动定时任务...');
      cron.schedule('0 0 * * *', async () => {
        console.log('定时任务触发：开始同步前一天新闻数据...');
        try {
          const result = await syncNewsData({ isManual: false });
          console.log('定时任务完成：', result.message);
        } catch (error) {
          console.error('定时任务执行失败：', error.message);
        }
      }, {
        scheduled: true,
        timezone: 'Asia/Shanghai'
      });
      console.log('✓ 定时任务已启动：每天00:00:00自动同步前一天新闻数据');
      
      // 初始化邮件发送定时任务
      console.log('正在初始化邮件发送定时任务...');
      initializeScheduledTasks().catch(error => {
        console.error('初始化邮件发送定时任务失败:', error);
      });

      // 初始化外部数据库连接
      console.log('正在初始化外部数据库连接...');
      db.query('SELECT * FROM external_db_config WHERE is_deleted = 0 AND is_active = 1')
        .then(configs => {
          if (configs && configs.length > 0) {
            return initializeExternalDatabases(configs);
          } else {
            console.log('✓ 没有启用的外部数据库配置');
          }
        })
        .then(() => {
          // 初始化企业同步定时任务
          console.log('正在初始化企业同步定时任务...');
          return initializeEnterpriseSyncTasks();
        })
        .catch(error => {
          console.error('初始化外部数据库连接或企业同步任务失败:', error);
        });
    });
    
    // 处理服务器启动错误
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`✗ 端口 ${PORT} 已被占用，请关闭占用该端口的程序或更改端口号`);
        console.error(`提示：可以使用命令查看占用端口的进程`);
        console.error(`  Windows: netstat -ano | findstr :${PORT}`);
        console.error(`  然后使用 taskkill /F /PID <进程ID> 结束进程`);
      } else {
        console.error('✗ 服务器启动失败:', error.message);
        console.error('错误详情:', error);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error('✗ 服务器启动失败:', error.message);
    console.error('错误堆栈:', error.stack);
    console.error('请检查：');
    console.error('1. MySQL 服务是否已启动');
    console.error('2. .env 文件配置是否正确');
    console.error('3. 数据库连接信息是否正确');
    console.error('4. 数据库表结构是否已正确创建');
    process.exit(1);
  }
}

startServer();

// 优雅关闭
process.on('SIGINT', async () => {
  try {
    const { closeAllExternalPools } = require('./utils/externalDb');
    await closeAllExternalPools();
    await db.closePool();
    console.log('数据库连接已关闭');
  } catch (error) {
    console.error('关闭数据库连接时出错：', error);
  } finally {
    process.exit(0);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

