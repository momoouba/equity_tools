# Stage 2b 融资池百科查词报告



> 生成时间：2026-07-24 09:53:33  

> 版本：`baike_lookup_v1`  

> 范围：**自 2026-07-01** 有融资事件的去重企业；结果 **fan-out 至全部历史行**  

> 模式：**写入** | 抓取：browser | force：false | fast-item-only：true | worker：true | apply并发：8



## 结果



| 指标 | 值 |

|------|-----|

| 查词抓取 | 92 |

| 写库完成 | 30 |

| 有词条 | 13（43.33%） |

| 确认无词条 | 17 |

| 反爬/受限 | 0 |

| 其它错误 | 0 |

| fan-out 事件行（累计） | 34 |

| 画像写入行 | 17 |



## 说明



- `listed_sync` / `listing_status=matched` 行仅写百科元数据，不覆盖上市主档画像

- pending 文件：`E:\桌面\equity_news\需求文档\竞品分析\Stage2b融资百科查词pending.jsonl`（checkpoint 同名 `.checkpoint.json`）

- 仅写库：`npm run backfill:financing-baike-lookup -- --apply-only`

- 全量跑建议 `--mode=browser` + CDP（`startChromeForBaike.ps1`）

