# UI 切换指南

## 当前状态

- **原 UI**：位于 `src/` 目录
- **新 UI（Arco Design）**：位于 `src/src-arco/` 目录

## 切换到新 UI（Arco Design）

### 步骤 1：备份当前 main.jsx

```bash
cp src/main.jsx src/main.jsx.backup
```

### 步骤 2：修改 main.jsx

将 `src/main.jsx` 的内容替换为：

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from '@arco-design/web-react'
import '@arco-design/web-react/dist/css/arco.css'
import App from './src-arco/App'
import './src-arco/index.css'

// Arco Design 主题配置 - 简约商务风
const themeConfig = {
  primaryColor: '#165dff',
  successColor: '#00b42a',
  warningColor: '#ff7d00',
  errorColor: '#f53f3f',
  fontSize: 14,
  borderRadius: 4,
  sizeStep: 4,
  componentSize: 'default'
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider theme={themeConfig}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
```

### 步骤 3：启动开发服务器

```bash
npm run dev
```

## 回滚到原 UI

### 方法 1：恢复备份文件

```bash
cp src/main.jsx.backup src/main.jsx
```

### 方法 2：手动恢复

将 `src/main.jsx` 恢复为：

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

## 已优化的页面

使用新 UI 时，以下页面已优化：
- ✅ Login（登录页）
- ✅ Register（注册页）
- ✅ Dashboard（主控制台）
- ✅ CompanyManagement（企业管理）
- ✅ CompanyForm（企业表单）

其他页面仍使用原 UI，会在后续逐步优化。

## 注意事项

1. 切换 UI 后，需要重新启动开发服务器
2. 确保已安装 `@arco-design/web-react` 依赖
3. 所有业务逻辑保持不变，只是 UI 组件替换
4. 如果遇到问题，可以随时回滚到原 UI

