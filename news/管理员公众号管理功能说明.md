# 管理员公众号管理功能说明

## 📋 功能概述

为管理员舆情页面添加了Tab页签切换功能和额外公众号数据源管理功能，管理员可以配置额外的公众号信息作为舆情数据的补充来源。

## 🎯 主要功能

### 1. 管理员Tab页签切换

#### Tab页签结构
- **舆情信息**：原有的舆情信息管理页面
- **公众号管理**：新增的额外公众号数据源管理页面

#### 权限控制
- 只有管理员用户才能看到Tab页签
- 普通用户保持原有的舆情信息页面不变

### 2. 额外公众号管理功能

#### 基本管理功能
- **新增公众号**：弹窗形式添加公众号信息
- **编辑公众号**：修改已有公众号信息
- **删除公众号**：软删除公众号记录
- **状态管理**：生效/失效状态切换
- **搜索筛选**：按公众号名称、账号ID搜索，按状态筛选

#### 批量导入功能
- **模板下载**：提供标准Excel导入模板
- **批量导入**：支持Excel文件批量导入
- **去重处理**：按账号ID自动去重，重复数据跳过
- **导入反馈**：显示成功、跳过、错误统计

## 🔧 技术实现

### 数据库设计

#### additional_wechat_accounts表结构
```sql
CREATE TABLE additional_wechat_accounts (
  id VARCHAR(19) PRIMARY KEY COMMENT '数据ID',
  account_name VARCHAR(255) NOT NULL COMMENT '公众号名称',
  wechat_account_id VARCHAR(255) NOT NULL UNIQUE COMMENT '微信账号ID',
  status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态',
  creator_user_id VARCHAR(19) COMMENT '创建用户ID',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updater_user_id VARCHAR(19) COMMENT '更新用户ID',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  delete_mark INT DEFAULT 0 COMMENT '删除标志',
  delete_time DATETIME NULL COMMENT '删除时间',
  delete_user_id VARCHAR(19) NULL COMMENT '删除用户ID'
);
```

#### 字段说明
- **id**: 数据唯一标识，使用年月日时分秒+5位序列格式
- **account_name**: 公众号名称
- **wechat_account_id**: 微信账号ID，唯一索引
- **status**: 状态（active-生效，inactive-失效）
- **creator_user_id**: 创建用户ID，关联users表
- **delete_mark**: 软删除标识（0-未删除，1-已删除）

### 后端API接口

#### 1. 公众号列表查询
```javascript
GET /api/additional-accounts
// 支持分页、搜索、状态筛选
```

#### 2. 新增公众号
```javascript
POST /api/additional-accounts
{
  "account_name": "公众号名称",
  "wechat_account_id": "账号ID",
  "status": "active"
}
```

#### 3. 更新公众号
```javascript
PUT /api/additional-accounts/:id
{
  "account_name": "公众号名称",
  "wechat_account_id": "账号ID",
  "status": "active"
}
```

#### 4. 删除公众号
```javascript
DELETE /api/additional-accounts/:id
// 软删除，设置delete_mark=1
```

#### 5. 批量导入
```javascript
POST /api/additional-accounts/batch-import
// multipart/form-data格式，上传Excel文件
```

#### 6. 下载模板
```javascript
GET /api/additional-accounts/download-template
// 返回Excel模板文件
```

### 前端组件设计

#### 1. Tab页签切换
```jsx
{isAdmin && (
  <div className="admin-tabs">
    <button onClick={() => setAdminActiveTab('news')}>舆情信息</button>
    <button onClick={() => setAdminActiveTab('accounts')}>公众号管理</button>
  </div>
)}
```

#### 2. 公众号管理页面
- **AdditionalAccounts.jsx**: 主要管理组件
- **AdditionalAccounts.css**: 样式文件
- 集成在NewsInfo组件中，通过Tab切换显示

#### 3. 功能模块
- **列表展示**: 分页表格显示公众号列表
- **搜索筛选**: 实时搜索和状态筛选
- **新增/编辑**: 模态框表单操作
- **批量导入**: 文件上传和导入处理

## 🎨 用户界面设计

### Tab页签样式
- **默认状态**: 浅灰色背景
- **激活状态**: 蓝色背景 + 白色文字 + 底部边框
- **悬浮效果**: 浅蓝色背景过渡

### 管理页面布局
- **页面头部**: 标题 + 搜索筛选 + 操作按钮
- **数据表格**: 分页表格展示公众号信息
- **操作按钮**: 编辑、删除按钮
- **状态标识**: 彩色徽章显示状态

### 模态框设计
- **新增/编辑**: 表单模态框
- **批量导入**: 分步骤导入向导
- **响应式**: 移动端适配

## 📊 数据流程

### 新增公众号流程
1. 点击"新增公众号"按钮
2. 弹出表单模态框
3. 填写公众号信息
4. 提交表单，后端验证
5. 检查账号ID是否重复
6. 保存数据，返回结果

### 批量导入流程
1. 点击"批量导入"按钮
2. 下载Excel模板
3. 填写公众号数据
4. 上传Excel文件
5. 后端解析文件内容
6. 逐行验证和去重
7. 批量插入数据
8. 返回导入统计结果

### 数据验证规则
- **必填字段**: 公众号名称、账号ID
- **唯一性**: 账号ID不能重复
- **状态值**: 只能是active或inactive
- **权限检查**: 只有管理员可以操作

## 🔒 权限控制

### 管理员权限验证
```javascript
const checkAdminPermission = (req, res, next) => {
  const userRole = req.headers['x-user-role'];
  const userId = req.headers['x-user-id'];
  
  if (!userId) {
    return res.status(401).json({ message: '未登录' });
  }
  
  if (userRole !== 'admin') {
    return res.status(403).json({ message: '权限不足' });
  }
  
  next();
};
```

### 前端权限控制
- Tab页签只对管理员显示
- 普通用户无法访问公众号管理功能
- 基于用户角色动态渲染界面

## 📱 响应式设计

### 桌面端
- Tab页签水平排列
- 表格完整显示所有列
- 模态框居中显示

### 移动端
- Tab页签保持水平布局
- 表格字体和间距优化
- 模态框全屏显示
- 按钮和输入框适配触摸操作

## 🔍 搜索和筛选

### 搜索功能
- **搜索范围**: 公众号名称、账号ID
- **搜索方式**: 模糊匹配
- **实时搜索**: 输入后自动触发

### 状态筛选
- **全部状态**: 显示所有记录
- **生效**: 只显示active状态
- **失效**: 只显示inactive状态

### 分页功能
- **页面大小**: 每页10条记录
- **分页控件**: 上一页/下一页按钮
- **页码信息**: 显示当前页和总页数

## 📈 数据统计

### 导入统计
- **成功数量**: 成功导入的记录数
- **跳过数量**: 重复跳过的记录数
- **错误数量**: 导入失败的记录数
- **错误详情**: 显示具体错误信息

### 操作日志
- **创建记录**: 记录创建用户和时间
- **更新记录**: 记录更新用户和时间
- **删除记录**: 记录删除用户和时间
- **软删除**: 保留历史数据，便于审计

## 🚀 使用方法

### 基本操作流程
1. 管理员登录系统
2. 进入舆情信息页面
3. 点击"公众号管理"Tab
4. 进行公众号的增删改查操作

### 批量导入流程
1. 点击"批量导入"按钮
2. 下载Excel模板文件
3. 按模板格式填写数据
4. 上传填好的Excel文件
5. 查看导入结果统计

## 📝 注意事项

1. **数据唯一性**: 账号ID必须唯一，重复数据会被跳过
2. **权限限制**: 只有管理员可以管理公众号数据源
3. **软删除**: 删除操作为软删除，数据仍保留在数据库中
4. **文件格式**: 批量导入只支持Excel格式（.xlsx, .xls）
5. **数据验证**: 导入时会验证必填字段和数据格式

---

**功能完成时间**: 2024-11-21  
**适用用户**: 管理员  
**功能状态**: ✅ 已完成并测试通过
