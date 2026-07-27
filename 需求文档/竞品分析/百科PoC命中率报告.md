# 百科 PoC 命中率报告（Stage 0 §4.3 / D8 爬虫方案）

生成时间：2026-07-01 06:44:43

## D8 定稿（本期）

| 项 | 结论 |
| --- | --- |
| 接入方式 | **百度百科可控爬虫**（`baidu_baike_fetch.py` / CDP：`baidu_baike_fetch_browser.py`） |
| 本次模式 | **Playwright CDP（本机 Chrome）** |
| CDP 地址 | `http://127.0.0.1:9222` |
| 验证码等待 | **8000ms**（命中安全验证时供人工处理） |
| 抓取字段 | `company_intro`（企业介绍）、`product_intro`（产品介绍/主营业务） |
| 降级规则 | **无独立产品介绍段落时，`product_intro` = `company_intro`** |
| 频率限制 | 默认请求间隔 **1200ms**（可调 `--sleep-ms`） |
| 全量门禁 | 本 PoC 通过后，才启动 Stage 1/2 全量 `backfill*BaikeLookup` |

## 1. 抽样范围

- 优先行业批：**2026年6月** 发生融资的去重企业（`event_date` ∈ [2026-06-01, 2026-07-01)）
- 赛道：ai / bio / semi_mfg
- 每类抽样：**30** 家，合计 **90** 家

## 2. 命中率

- 有词条（has_lemma）：**47 / 90**（52.22%）

### 2.1 词条状态分布（区分无词条 vs 反爬）

| 状态 | 数量 | 占比 | 说明 |
| --- | --- | --- | --- |
| 有词条 | 47 | 52.22% | 成功抓取百科内容 |
| 确认无词条 | 43 | 47.78% | 页面明确提示尚未收录/约为0/页面不存在 |
| 反爬/访问受限 | 0 | 0.00% | 安全验证页；**词条是否存在未知，不可当作无词条** |

| category_4 | 样本 | 有词条 | 企业介绍≥20字 | 产品介绍≥20字 | 产品来自企业介绍降级 |
| --- | --- | --- | --- | --- | --- |
| ai | 30 | 63.33% | 63.33% | 63.33% | 40.00% |
| bio | 30 | 50.00% | 50.00% | 50.00% | 40.00% |
| semi_mfg | 30 | 43.33% | 43.33% | 43.33% | 26.67% |

## 3. 失败样例（Top 10）

> `确认无词条` 与 `反爬/访问受限` 分开统计；后者表示未能访问百科，**不等于**企业没有词条。

| 企业 | category_4 | miss_reason | lemma_status | 详情 |
| --- | --- | --- | --- | --- |
| 上海深穹星核科技有限公司 | ai | 确认无词条 | not_found | no_lemma |
| 杭州骅羲智能科技有限公司 | ai | 确认无词条 | not_found | no_lemma |
| 千寻智能（北京）科技有限公司 | ai | 确认无词条 | not_found | no_lemma |
| 深圳市手亿计算机有限责任公司 | ai | 确认无词条 | not_found | no_lemma |
| Global Vision Multimedia Group | ai | 确认无词条 | not_found | no_lemma |
| 深圳市圣宠心科技有限公司 | ai | 确认无词条 | not_found | no_lemma |
| Mainfunc Inc. | ai | 确认无词条 | not_found | no_lemma |
| 北京将闲科技有限公司 | ai | 确认无词条 | not_found | no_lemma |
| 上海源策未来智能科技有限公司 | ai | 确认无词条 | not_found | no_lemma |
| 上海伏曦量子科技有限公司 | ai | 确认无词条 | not_found | no_lemma |

## 4. 结构化质量（人工抽检入口）

建议业务对每类再抽 ≥10 条，对比：百科 `product_intro` vs 现 AI enrich vs 主观判断（§4.3）。
