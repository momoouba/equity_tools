import React, { useState } from 'react'
import { Tabs, Typography } from '@arco-design/web-react'
import NewsConfig from '../NewsConfig'

const TabPane = Tabs.TabPane

/**
 * 系统配置 · 融资信息源配置：接口类型（news_interface_config）+ 爬虫预留（listing_data_config）。
 */
function FinancingSourceConfig() {
  const [activeTab, setActiveTab] = useState('interface')

  return (
    <div className="financing-source-config">
      <Typography.Paragraph style={{ marginBottom: 16, color: 'var(--color-text-2)' }}>
        为「项目挖掘」维护数据源：接口类型写入 news_interface_config（凭证走「上海国际集团接口配置」，按应用绑定）；
        爬虫类型将复用 listing_data_config，第一步仅预留入口。
      </Typography.Paragraph>
      <Tabs activeTab={activeTab} onChange={setActiveTab} type="line">
        <TabPane key="interface" title="接口类型">
          <NewsConfig financingSourceMode />
        </TabPane>
        <TabPane key="crawler" title="爬虫类型（预留）">
          <Typography.Paragraph style={{ color: 'var(--color-text-2)' }}>
            当前阶段不启用。后续将在此扩展项目挖掘专用爬虫配置（表结构与上市进展「上市数据配置」一致，子类型如 sourcing_crawler）。
          </Typography.Paragraph>
        </TabPane>
      </Tabs>
    </div>
  )
}

export default FinancingSourceConfig
