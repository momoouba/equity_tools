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
const aiPromptConfigRoutes = require('./routes/aiPromptConfig');
const newsAnalysisRoutes = require('./routes/newsAnalysis');
const emailRoutes = require('./routes/email');
const scheduledTasksRoutes = require('./routes/scheduledTasks');
const externalDbRoutes = require('./routes/externalDb');
const newsShareRoutes = require('./routes/newsShare');
const newsDetailRoutes = require('./routes/newsDetail');
const { initializeScheduledTasks } = require('./utils/scheduledEmailTasks');
const { initializeExternalDatabases } = require('./utils/externalDb');
const { initializeEnterpriseSyncTasks } = require('./utils/enterpriseSyncTasks');
const { initializeNewsSyncScheduledTasks } = require('./utils/scheduledNewsSyncTasks');
const { initializeScheduledTaskFromConfig: initializeNewsReanalysisTask } = require('./utils/scheduledNewsReanalysisTasks');

const app = express();
const PORT = process.env.PORT || 3001;

// 服务器就绪标志（在服务器完全初始化前为false）
let serverReady = false;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 服务器就绪检查中间件（健康检查接口除外）
app.use((req, res, next) => {
  // 健康检查接口始终允许访问
  if (req.path === '/api/health') {
    return next();
  }
  
  // 如果服务器未完全就绪，返回503
  if (!serverReady) {
    return res.status(503).json({
      success: false,
      message: '服务器正在启动中，请稍后重试',
      status: 'starting'
    });
  }
  
  next();
});

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
app.use('/api/ai-prompt-config', aiPromptConfigRoutes);
app.use('/api/news-analysis', newsAnalysisRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/scheduled-tasks', scheduledTasksRoutes);
app.use('/api/external-db', externalDbRoutes);
app.use('/api/news-share', newsShareRoutes);
app.use('/api/news-detail', newsDetailRoutes);

// SPA路由支持：对于所有非API路径，返回前端应用的index.html
// 这样前端路由（如 /share/:token）才能正常工作
const clientDistPath = path.join(__dirname, '../client/dist');
const isProduction = fs.existsSync(clientDistPath);

if (isProduction) {
  // 生产环境：提供静态文件服务
  app.use(express.static(clientDistPath));
  
  // 所有非API路径都返回index.html，让前端路由处理
  app.get('*', (req, res, next) => {
    // 排除API路径
    if (req.path.startsWith('/api')) {
      return next();
    }
    
    // 静态资源（assets目录下的文件）应该由express.static处理，这里不需要特殊处理
    // 如果请求的是静态资源文件（有扩展名），让express.static处理
    if (req.path.includes('.') && !req.path.startsWith('/share')) {
      return next();
    }
    
    // 对于其他路径（如 /share/:token），返回index.html
    const indexPath = path.join(clientDistPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
} else {
  // 开发环境：将前端请求代理到 Vite 开发服务器（localhost:5173）
  const http = require('http');
  const { URL } = require('url');
  
  // 处理所有非API请求
  app.use((req, res, next) => {
    // 排除API路径
    if (req.path.startsWith('/api')) {
      return next();
    }
    
    // 调试日志
    console.log(`[开发环境代理] ${req.method} ${req.originalUrl} -> Vite (localhost:5173)`);
    
    // 代理到 Vite 开发服务器
    const vitePort = 5173;
    const targetUrl = new URL(`http://localhost:${vitePort}${req.originalUrl}`);
    
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: `localhost:${vitePort}`
      }
    };
    
    const proxyReq = http.request(options, (proxyRes) => {
      // 复制响应头
      res.statusCode = proxyRes.statusCode;
      Object.keys(proxyRes.headers).forEach(key => {
        // 跳过一些不应该转发的头
        if (key.toLowerCase() !== 'content-encoding' && 
            key.toLowerCase() !== 'transfer-encoding' &&
            key.toLowerCase() !== 'connection') {
          res.setHeader(key, proxyRes.headers[key]);
        }
      });
      
      // 转发响应体
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        console.error(`[开发环境代理] 无法连接到 Vite 开发服务器 (localhost:${vitePort}):`, err.message);
        res.status(503).send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>开发服务器未启动</title>
              <style>
                body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
                h1 { color: #e53e3e; }
                pre { background: #f5f5f5; padding: 15px; border-radius: 5px; display: inline-block; }
              </style>
            </head>
            <body>
              <h1>无法连接到 Vite 开发服务器</h1>
              <p>请确保前端开发服务器正在运行：</p>
              <pre>cd client && npm run dev</pre>
              <p>或者直接访问 Vite 开发服务器：</p>
              <p><a href="http://localhost:${vitePort}${req.originalUrl}">http://localhost:${vitePort}${req.originalUrl}</a></p>
            </body>
          </html>
        `);
      }
    });
    
    // 处理请求体
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
      // GET/HEAD/DELETE 请求没有 body，直接结束
      proxyReq.end();
    } else {
      // POST/PUT/PATCH 等有 body 的请求，转发请求体
      req.on('data', (chunk) => {
        proxyReq.write(chunk);
      });
      req.on('end', () => {
        proxyReq.end();
      });
      req.on('error', (err) => {
        proxyReq.destroy();
        if (!res.headersSent) {
          res.status(500).send('Request error');
        }
      });
    }
  });
  
  console.log('✓ 开发环境：前端请求将代理到 Vite 开发服务器 (localhost:5173)');
  console.log('  提示：如果 Vite 未启动，请运行: cd client && npm run dev');
  console.log('  或者直接访问: http://localhost:5173');
}

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

// 健康检查 - 确保在服务器启动前就可用
app.get('/api/health', async (req, res) => {
  try {
    // 测试数据库连接
    await db.query('SELECT 1');
    // 如果服务器还未完全就绪，返回503，但数据库连接正常
    if (!serverReady) {
      return res.status(503).json({ 
        status: 'starting', 
        message: '服务器正在启动中，请稍后重试', 
        database: 'connected' 
      });
    }
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
    const server = app.listen(PORT, '0.0.0.0', async () => {
      console.log(`✓ 服务器运行在 http://localhost:${PORT}`);
      console.log(`✓ 服务器正在初始化，健康检查端点已可用`);
      
      // 先标记为就绪，让API可以正常响应（核心功能已可用）
      // 异步初始化任务在后台执行，不阻塞API响应
      serverReady = true;
      console.log(`✓ 服务器核心功能已就绪，可以接收请求`);
      
      // 异步执行非关键初始化任务（不阻塞API响应）
      setImmediate(async () => {
        try {
          // 初始化新闻同步定时任务（根据news_interface_config表中的配置）
          console.log('正在初始化新闻同步定时任务...');
          initializeNewsSyncScheduledTasks().catch(error => {
            console.error('初始化新闻同步定时任务失败:', error);
          });
          
          // 初始化空摘要新闻重新分析定时任务
          console.log('正在初始化空摘要新闻重新分析定时任务...');
          initializeNewsReanalysisTask().catch(error => {
            console.error('初始化空摘要新闻重新分析定时任务失败:', error);
          });
          
          // 初始化邮件发送定时任务（异步，不阻塞）
          console.log('正在初始化邮件发送定时任务...');
          initializeScheduledTasks().catch(error => {
            console.error('初始化邮件发送定时任务失败:', error);
          });

          // 初始化外部数据库连接（异步，不阻塞）
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
            .then(() => {
              console.log(`✓ 所有后台初始化任务已完成`);
            })
            .catch(error => {
              console.error('初始化外部数据库连接或企业同步任务失败:', error);
            });
        } catch (error) {
          console.error('后台初始化过程中出错:', error);
        }
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

