// PM2 生态系统配置文件
// 用于管理新闻管理系统的Node.js进程

module.exports = {
  apps: [
    {
      // 应用基本信息
      name: 'newsapp',
      script: './server/index.js',
      cwd: '/opt/newsapp/news',
      
      // 进程管理
      instances: 'max', // 使用所有CPU核心
      exec_mode: 'cluster', // 集群模式
      
      // 环境配置
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      
      // 日志配置
      log_file: '/var/log/newsapp/combined.log',
      out_file: '/var/log/newsapp/out.log',
      error_file: '/var/log/newsapp/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // 进程监控
      min_uptime: '10s',
      max_restarts: 10,
      
      // 内存管理
      max_memory_restart: '1G',
      
      // 自动重启配置
      watch: false, // 生产环境不建议开启文件监控
      ignore_watch: [
        'node_modules',
        'logs',
        '*.log'
      ],
      
      // 进程管理选项
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      
      // 自动重启时间（避免频繁重启）
      restart_delay: 4000,
      
      // 进程异常退出处理
      autorestart: true,
      
      // 合并日志
      merge_logs: true,
      
      // 时间戳
      time: true,
      
      // 进程ID文件
      pid_file: '/var/run/newsapp.pid',
      
      // 源码映射支持
      source_map_support: true,
      
      // 实例变量（集群模式下区分不同实例）
      instance_var: 'INSTANCE_ID',
      
      // 优雅关闭
      shutdown_with_message: true,
      
      // 健康检查
      health_check_grace_period: 3000
    }
  ],
  
  // 部署配置
  deploy: {
    // 生产环境部署配置
    production: {
      user: 'newsapp',
      host: ['your-server-ip'], // 替换为实际服务器IP
      ref: 'origin/main',
      repo: 'https://github.com/your-username/newsapp.git', // 替换为实际仓库地址
      path: '/opt/newsapp',
      'post-deploy': 'npm install --production && npm run build:client && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'apt update && apt install git -y'
    },
    
    // 预发布环境配置
    staging: {
      user: 'newsapp',
      host: ['staging-server-ip'],
      ref: 'origin/develop',
      repo: 'https://github.com/your-username/newsapp.git',
      path: '/opt/newsapp-staging',
      'post-deploy': 'npm install && npm run build:client && pm2 reload ecosystem.config.js --env staging',
      env: {
        NODE_ENV: 'staging',
        PORT: 3002
      }
    }
  }
};
