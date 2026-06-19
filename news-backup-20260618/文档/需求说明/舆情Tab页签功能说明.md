# 舆情Tab页签功能说明

## 📋 功能概述

为舆情信息页面添加了时间筛选的Tab页签功能，用户可以按照不同时间范围查看舆情信息，同时新增了被投企业全称字段，提升数据的可读性和完整性。

## 🎯 主要功能

### 1. Tab页签时间筛选

#### 五个时间维度
1. **昨日舆情** - 显示昨天（00:00:00 - 23:59:59）的舆情信息
2. **本周舆情** - 显示本周一至今的舆情信息  
3. **上周舆情** - 显示上周一至上周日的舆情信息
4. **本月舆情** - 显示本月1日至今的舆情信息
5. **全部舆情** - 显示所有舆情信息（无时间限制）

#### 时间计算逻辑
```javascript
// 昨日：前一天00:00:00到23:59:59
const yesterday = new Date(now);
yesterday.setDate(yesterday.getDate() - 1);

// 本周：本周一00:00:00到现在
const weekStart = new Date(now);
const dayOfWeek = weekStart.getDay();
const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
weekStart.setDate(weekStart.getDate() - daysToMonday);

// 上周：上周一00:00:00到上周日23:59:59
const lastWeekStart = new Date(weekStart);
lastWeekStart.setDate(lastWeekStart.getDate() - 7);
const lastWeekEnd = new Date(weekStart);
lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
lastWeekEnd.setHours(23, 59, 59, 999);

// 本月：本月1日00:00:00到现在
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
```

### 2. 被投企业全称字段

#### 数据库字段
- **字段名**: `enterprise_full_name`
- **类型**: `VARCHAR(255)`
- **位置**: `news_detail`表中，位于`wechat_account`字段之后
- **索引**: 已添加索引提升查询性能

#### 数据匹配逻辑
```sql
-- 在数据采集时自动匹配企业全称
SELECT enterprise_full_name 
FROM invested_enterprises 
WHERE wechat_official_account_id = ? 
AND delete_mark = 0 
LIMIT 1
```

## 🔧 技术实现

### 数据库变更

#### 1. 表结构更新
```sql
-- 添加被投企业全称字段
ALTER TABLE news_detail 
ADD COLUMN enterprise_full_name VARCHAR(255) COMMENT '被投企业全称' 
AFTER wechat_account;

-- 添加索引
CREATE INDEX idx_enterprise_full_name ON news_detail(enterprise_full_name);
```

#### 2. 自动字段检查
- 系统启动时自动检查字段是否存在
- 如不存在则自动添加，确保向后兼容
- 历史数据保持不变，新数据自动填充

### 后端API更新

#### 1. 时间筛选参数
```javascript
// 新增timeRange参数支持
const timeRange = req.query.timeRange || 'all'; // yesterday, thisWeek, thisMonth, all
```

#### 2. 动态时间条件
```javascript
// 根据timeRange动态生成SQL条件
let timeCondition = '';
let timeParams = [];

if (timeRange === 'yesterday') {
  timeCondition = ' AND public_time >= ? AND public_time <= ?';
  timeParams = [yesterdayStart, yesterdayEnd];
}
// ... 其他时间范围
```

#### 3. 搜索功能增强
```javascript
// 搜索范围扩展到企业全称
condition += ' AND (title LIKE ? OR account_name LIKE ? OR wechat_account LIKE ? OR enterprise_full_name LIKE ?)';
```

#### 4. 数据采集优化
```javascript
// 同步新闻时自动匹配企业全称
const enterpriseResult = await db.query(
  `SELECT enterprise_full_name 
   FROM invested_enterprises 
   WHERE wechat_official_account_id = ? 
   AND delete_mark = 0 
   LIMIT 1`,
  [wechatAccount]
);
```

### 前端实现

#### 1. Tab组件
```jsx
<div className="news-tabs">
  <button className={`tab-button ${activeTab === 'yesterday' ? 'active' : ''}`}>
    昨日舆情
  </button>
  {/* 其他tab按钮 */}
</div>
```

#### 2. 状态管理
```javascript
const [activeTab, setActiveTab] = useState('yesterday');

const handleTabChange = (tab) => {
  setActiveTab(tab);
  setCurrentPage(1); // 切换tab时重置页码
};
```

#### 3. API调用
```javascript
const params = {
  page: currentPage,
  pageSize,
  timeRange: activeTab // 传递时间范围参数
};
```

## 🎨 样式设计

### Tab页签样式
- **默认状态**: 灰色背景，深灰色文字
- **悬浮状态**: 浅蓝色背景，蓝色文字
- **激活状态**: 蓝色背景，白色文字，底部蓝色边框
- **响应式**: 移动端垂直排列，左侧蓝色边框

### 表格列样式
- **被投企业全称**: 蓝色文字，加粗显示，最大宽度200px
- **自动换行**: 长文本自动换行显示
- **优先显示**: 作为第二列，仅次于序号

## ✅ 批量选择和AI重新分析功能

### 功能概述
在所有时间维度的Tab页签中，都支持批量选择新闻并进行AI重新分析，方便用户对特定新闻进行重新分析，提高分析准确性。

### 主要功能

#### 1. 复选框选择
- **全选功能**: 表头提供全选/取消全选复选框
- **单选功能**: 每行新闻提供独立复选框
- **选择状态**: 实时显示已选择的新闻数量
- **适用范围**: 所有Tab页签（昨日、本周、上周、本月、全部）

#### 2. AI重新分析
- **批量分析**: 可对选中的多条新闻进行批量AI重新分析
- **分析内容**: 
  - 重新进行情绪分析（正面/中性/负面）
  - 重新生成类型标签
  - 重新生成新闻摘要
  - 重新评估企业关联性（如适用）
- **进度显示**: 实时显示分析进度条和当前处理状态
- **异步处理**: 支持大量新闻的异步批量处理

#### 3. 使用流程
1. **选择新闻**: 
   - 在任意Tab页签中，勾选需要重新分析的新闻
   - 可单独选择或使用全选功能
   
2. **触发分析**:
   - 选中新闻后，页面右上角会显示"AI分析(数量)"按钮
   - 点击按钮，确认后开始分析
   
3. **查看进度**:
   - 分析开始后，页面顶部显示进度条
   - 实时显示已处理数量、总数量、百分比
   - 显示当前正在处理的新闻标题
   
4. **完成处理**:
   - 分析完成后自动刷新新闻列表
   - 显示分析结果统计（成功/失败数量）

### 技术实现

#### 前端实现
```javascript
// 判断是否显示复选框功能（所有tab都支持）
const shouldShowCheckbox = () => {
  return ['yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'all'].includes(activeTab)
}

// 批量AI分析
const handleBatchAnalysis = async () => {
  const response = await axios.post('/api/news-analysis/batch-analyze-selected', {
    newsIds: selectedNewsIds
  })
  // 处理异步任务和进度更新
}
```

#### 后端接口
- **批量分析接口**: `POST /api/news-analysis/batch-analyze-selected`
- **进度查询接口**: `GET /api/news-analysis/analysis-progress/:taskId`
- **请求参数**: `{ newsIds: [1, 2, 3, ...] }`

### 功能特点

1. **全Tab支持**: 所有时间维度的Tab页签都支持此功能
2. **智能进度**: 实时显示分析进度，用户体验友好
3. **异步处理**: 支持大量新闻的异步批量处理，不阻塞界面
4. **状态管理**: 切换Tab时自动清空选择状态，避免混淆
5. **错误处理**: 完善的错误提示和处理机制

### 注意事项

1. **选择状态**: 切换Tab页签时，已选择的新闻会被清空
2. **分析时间**: 大量新闻分析可能需要较长时间，请耐心等待
3. **网络要求**: 需要稳定的网络连接，确保AI服务正常
4. **权限要求**: 所有用户（管理员和普通用户）都可以使用此功能

## 📱 用户体验

### 1. 交互优化
- **默认选中**: 页面加载时默认显示"昨日舆情"
- **切换动画**: Tab切换时平滑过渡效果
- **状态保持**: 切换Tab时保持搜索条件
- **页码重置**: 切换Tab时自动重置到第一页

### 2. 响应式设计
- **桌面端**: 水平Tab布局
- **移动端**: 垂直Tab布局，节省空间
- **小屏幕**: 优化按钮大小和间距

### 3. 数据展示
- **企业信息**: 优先显示企业全称，便于识别
- **时间筛选**: 清晰的时间范围标识
- **空数据**: 友好的空状态提示

## 🔍 功能特点

### 1. 智能匹配
- **自动关联**: 新闻数据自动匹配企业信息
- **容错处理**: 匹配失败时优雅降级
- **性能优化**: 使用索引提升查询速度

### 2. 时间精确性
- **精确计算**: 基于服务器时间精确计算时间范围
- **时区支持**: 支持本地时区
- **边界处理**: 正确处理跨天、跨周、跨月边界

### 3. 向后兼容
- **历史数据**: 不影响现有历史数据
- **渐进增强**: 新功能不破坏原有功能
- **平滑升级**: 数据库字段自动添加

## 📊 数据流程

### 新闻采集流程
1. **获取新闻数据** → API接口返回原始数据
2. **匹配企业信息** → 根据微信账号查询企业全称
3. **数据入库** → 包含企业全称的完整数据存储
4. **索引更新** → 自动更新相关索引

### 页面展示流程
1. **选择时间范围** → 用户点击Tab页签
2. **构建查询条件** → 根据时间范围生成SQL条件
3. **执行查询** → 后端返回筛选后的数据
4. **渲染页面** → 前端展示包含企业全称的数据

## 🚀 使用方法

### 用户操作
1. 进入舆情信息页面
2. 点击顶部Tab页签选择时间范围
3. 查看对应时间范围内的舆情信息
4. 可结合搜索功能进一步筛选

### 管理员功能
- 管理员同样支持Tab页签筛选
- 可查看全系统的舆情数据
- 支持按企业全称搜索

## 📝 注意事项

1. **历史数据**: 历史数据的企业全称字段为空，不影响正常使用
2. **时间基准**: 所有时间计算基于服务器本地时间
3. **性能考虑**: 大量数据时建议使用时间筛选提升查询速度
4. **数据一致性**: 企业信息变更不会自动更新历史新闻数据

---

**功能完成时间**: 2024-11-21  
**最后更新**: 2025-01-XX（新增上周舆情Tab、批量选择和AI重新分析功能）  
**适用范围**: 所有用户（普通用户和管理员）  
**功能状态**: ✅ 已完成并测试通过
