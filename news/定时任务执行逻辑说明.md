# 新闻接口定时任务执行逻辑说明

## 问题：定时任务设置为"每天"，是否每天都取数？

**答案：不是每天都取数，只在工作日取数，节假日会跳过执行。**

## 执行逻辑

### 代码位置

**文件：** `server/routes/news.js`

**函数：** `syncConfigWithSchedule`（第596-640行）

### 关键逻辑

```javascript
const skipHolidayCheck = isManual || frequency !== 'daily';
if (!skipHolidayCheck) {
  const workday = await isWorkdayDate(baseRunDate);
  if (!workday) {
    const runDateStr = formatDateOnly(baseRunDate);
    console.log(`[新闻同步] 配置 ${config.id} 在 ${runDateStr} 为节假日，跳过执行`);
    return { success: true, skipped: true, reason: 'holiday', runDate: runDateStr };
  }
}
```

### 执行条件

1. **频率为"每天"（daily）**
   - 如果频率不是"每天"（如"每周"、"每月"），不检查节假日

2. **不是手动触发**
   - 手动触发时，不检查节假日，直接执行

3. **是工作日**
   - 通过 `isWorkdayDate` 函数判断是否是工作日
   - 如果不是工作日（节假日），跳过执行

## 工作日判断逻辑

### 代码位置

**函数：** `isWorkdayDate`（第170-185行）

### 判断规则

```javascript
async function isWorkdayDate(date) {
  const dateStr = formatDateOnly(date);
  try {
    // 1. 首先查询 holiday_calendar 表
    const rows = await db.query(
      'SELECT is_workday FROM holiday_calendar WHERE holiday_date = ? AND is_deleted = 0 LIMIT 1',
      [dateStr]
    );
    
    // 2. 如果表中存在记录，使用 is_workday 字段判断
    if (rows.length > 0) {
      return rows[0].is_workday === 1; // 1=工作日，0=非工作日
    }
  } catch (error) {
    console.warn('查询节假日数据失败：', error.message);
  }
  
  // 3. 如果表中没有记录，使用默认规则：不是周日和周六就是工作日
  const day = date.getDay();
  return day !== 0 && day !== 6; // 0=周日，6=周六
}
```

### 判断优先级

1. **优先使用 `holiday_calendar` 表**
   - 如果日期在 `holiday_calendar` 表中，使用 `is_workday` 字段
   - `is_workday = 1`：工作日（执行）
   - `is_workday = 0`：非工作日（跳过）

2. **默认规则（表中没有记录时）**
   - 周日（0）和周六（6）：非工作日（跳过）
   - 周一至周五（1-5）：工作日（执行）

## 执行示例

### 工作日（执行）

**日期：** 2025-12-04（周四）

**判断过程：**
1. 查询 `holiday_calendar` 表，未找到记录
2. 使用默认规则：周四（4）不是周日或周六
3. **结果：工作日，执行同步**

### 周末（跳过）

**日期：** 2025-12-07（周日）

**判断过程：**
1. 查询 `holiday_calendar` 表，未找到记录
2. 使用默认规则：周日（0）是周末
3. **结果：非工作日，跳过执行**

### 节假日（跳过）

**日期：** 2025-01-01（元旦）

**判断过程：**
1. 查询 `holiday_calendar` 表，找到记录
2. `is_workday = 0`（非工作日）
3. **结果：非工作日，跳过执行**

### 调休工作日（执行）

**日期：** 2025-10-07（国庆调休工作日）

**判断过程：**
1. 查询 `holiday_calendar` 表，找到记录
2. `is_workday = 1`（工作日）
3. **结果：工作日，执行同步**

## 定时任务配置

### Cron 表达式

**文件：** `server/index.js` 第177行

```javascript
cron.schedule('0 0 * * *', async () => {
  // 每天00:00:00执行
}, {
  scheduled: true,
  timezone: 'Asia/Shanghai'
});
```

**说明：**
- Cron 表达式：`0 0 * * *`（每天00:00:00）
- 时区：`Asia/Shanghai`
- **但实际执行时会检查是否是工作日**

## 日志输出

### 正常执行

```
定时任务触发：开始同步前一天新闻数据...
[新闻同步] 配置 xxx 区间 2025-12-03 00:00:00 -> 2025-12-04 00:00:00
定时任务完成：同步完成，成功同步 XX 条数据
```

### 跳过执行（节假日）

```
定时任务触发：开始同步前一天新闻数据...
[新闻同步] 配置 xxx 在 2025-12-07 为节假日，跳过执行
```

## 总结

| 情况 | 是否执行 | 说明 |
|------|---------|------|
| 工作日（周一至周五） | ✅ 执行 | 正常执行同步 |
| 周末（周六、周日） | ❌ 跳过 | 默认规则：周末不执行 |
| 节假日（在表中且is_workday=0） | ❌ 跳过 | 使用节假日表判断 |
| 调休工作日（在表中且is_workday=1） | ✅ 执行 | 使用节假日表判断 |
| 手动触发 | ✅ 执行 | 不检查节假日，直接执行 |

## 注意事项

1. **节假日表配置**
   - 需要在 `holiday_calendar` 表中配置节假日和调休工作日
   - `is_workday = 1`：工作日（执行）
   - `is_workday = 0`：非工作日（跳过）

2. **默认规则**
   - 如果表中没有记录，默认周末不执行
   - 建议在表中配置所有节假日和调休工作日

3. **手动触发**
   - 手动触发时，不检查节假日，直接执行
   - 适用于需要强制同步的情况

4. **其他频率**
   - 如果频率设置为"每周"或"每月"，不检查节假日
   - 只在"每天"频率时检查节假日

## 建议

如果需要**每天都取数**（包括节假日），可以：

1. **修改代码逻辑**
   - 移除节假日检查
   - 或添加配置项控制是否检查节假日

2. **配置节假日表**
   - 将所有日期都设置为工作日（`is_workday = 1`）
   - 这样即使检查节假日，也会执行

3. **使用手动触发**
   - 在节假日时手动触发同步
   - 手动触发不检查节假日

