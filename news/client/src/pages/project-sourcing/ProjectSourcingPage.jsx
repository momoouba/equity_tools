import React from 'react'
import { Card, Typography, Empty } from '@arco-design/web-react'

/**
 * 项目挖掘 onepage（融资概览 / 赛道 / 投资主体 / AI 摘要）占位。
 * 数据接入与聚合接口就绪后在本页串联。
 */
function ProjectSourcingPage() {
  return (
    <div style={{ padding: '16px 24px', maxWidth: 1200 }}>
      <Typography.Title heading={5} style={{ marginBottom: 16 }}>
        项目挖掘
      </Typography.Title>
      <Card bordered={false}>
        <Empty description="融资事件聚合与 AI 分析页面建设中。请先完成「系统配置 → 融资信息源配置」与数据同步。" />
      </Card>
    </div>
  )
}

export default ProjectSourcingPage
