# 页面预览指南

## 开发服务器已启动

开发服务器正在后台运行。请按照以下步骤预览页面：

## 访问地址

开发服务器通常运行在：
- **本地地址**: http://localhost:5173
- **网络地址**: 查看终端输出的 Network 地址

## 已优化的页面预览

### 1. 登录页面 (Login)
- **路径**: http://localhost:5173/login
- **优化内容**:
  - ✅ Arco Design Form 组件
  - ✅ 必填项红色 * 标识
  - ✅ 输入校验红色提示
  - ✅ 按钮 loading 状态
  - ✅ 统一的交互反馈

### 2. 注册页面 (Register)
- **路径**: http://localhost:5173/register
- **优化内容**:
  - ✅ 完整的表单校验
  - ✅ 必填项标识
  - ✅ 统一的交互反馈

### 3. 主控制台 (Dashboard)
- **路径**: http://localhost:5173/dashboard
- **优化内容**:
  - ✅ Arco Layout 布局
  - ✅ Arco Menu 导航菜单
  - ✅ 统一的导航样式
  - ✅ 响应式布局

### 4. 企业管理页面 (CompanyManagement) ⭐ 重点优化
- **路径**: http://localhost:5173/dashboard/companies
- **优化内容**:
  - ✅ Arco Table 组件
  - ✅ 表格隔行高亮（stripe）
  - ✅ 表头吸顶（sticky）
  - ✅ 行点击选中功能
  - ✅ 表格加载骨架屏（Skeleton）
  - ✅ 筛选区表单折叠展开（Collapse）
  - ✅ 操作按钮组统一间距和尺寸
  - ✅ 分页组件居中显示
  - ✅ 所有交互按钮添加状态反馈

### 5. 企业表单 (CompanyForm)
- **触发**: 在企业管理页面点击"新增"或"编辑"按钮
- **优化内容**:
  - ✅ Arco Modal 组件
  - ✅ Arco Form 表单
  - ✅ 必填项标识和校验提示
  - ✅ 统一的表单样式

## 预览要点

### 设计规范验证

1. **间距规范**
   - 所有间距使用 8px 倍数（8px, 16px, 24px, 32px）
   - 检查按钮间距、表单间距、卡片内边距

2. **配色方案**
   - 主色：`#165dff`（蓝色）
   - 成功色：`#00b42a`（绿色）
   - 警告色：`#ff7d00`（橙色）
   - 错误色：`#f53f3f`（红色）

3. **按钮交互**
   - Hover 时颜色加深
   - 点击时有按压效果
   - Loading 状态显示加载动画

4. **表单交互**
   - 必填项显示红色 *
   - 输入错误时显示红色提示
   - 输入框 focus 时有高亮效果

5. **表格交互**
   - 隔行高亮显示
   - 鼠标悬停行时背景色加深
   - 点击行可以选中
   - 表头滚动时保持吸顶
   - 加载时显示骨架屏

## 待优化的页面

以下页面目前显示占位内容，将在后续优化：
- 被投企业管理 (EnterpriseManagement)
- 舆情信息 (NewsInfo)
- 邮件收发 (EmailManagement)
- 用户管理 (UserManagement)
- 定时任务管理 (ScheduledTaskManagement)
- 系统配置 (SystemConfig)

## 注意事项

1. 如果页面无法访问，请检查：
   - 开发服务器是否正常运行
   - 端口是否被占用
   - 浏览器控制台是否有错误

2. 如果样式显示异常，请检查：
   - Arco Design CSS 是否正确加载
   - 浏览器缓存是否需要清除

3. 测试建议：
   - 测试所有按钮的 hover 和点击效果
   - 测试表单的校验功能
   - 测试表格的交互功能
   - 测试响应式布局

## 回滚到原 UI

如果需要回滚到原 UI，请修改 `src/main.jsx`：

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

然后重启开发服务器。

