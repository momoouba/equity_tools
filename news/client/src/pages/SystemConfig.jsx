import React, { useState } from 'react'
import { Tabs, Card } from '@arco-design/web-react'
import BasicSystemConfig from './BasicSystemConfig'
import AIConfig from './AIConfig'
import EmailConfig from './EmailConfig'
import QichachaConfig from './QichachaConfig'
import ShanghaiInternationalGroupConfig from './ShanghaiInternationalGroupConfig'
import NewsConfig from './NewsConfig'
import HolidayConfig from './HolidayConfig'
import DatabaseConfig from './DatabaseConfig'
import ListingDataConfig from './上市进展/ListingDataConfig'
import './SystemConfig.css'

const TabPane = Tabs.TabPane

function SystemConfig({ isAdmin = true }) {
  const [activeTab, setActiveTab] = useState(isAdmin ? 'basic' : 'database')

  if (!isAdmin) {
    return (
      <div className="system-config">
        <Card className="config-card" bordered={false}>
          <div className="config-content">
            <DatabaseConfig />
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="system-config">
      <Card className="config-card" bordered={false}>
        <Tabs
          activeTab={activeTab}
          onChange={setActiveTab}
          className="config-tabs"
          type="line"
        >
          <TabPane key="basic" title="系统配置">
            <div className="config-content">
              <BasicSystemConfig />
            </div>
          </TabPane>

          <TabPane key="qichacha" title="企查查接口配置">
            <div className="config-content">
              <QichachaConfig />
            </div>
          </TabPane>

          <TabPane key="shanghai-international-group" title="上海国际集团接口配置">
            <div className="config-content">
              <ShanghaiInternationalGroupConfig />
            </div>
          </TabPane>

          <TabPane key="news" title="新闻接口配置">
            <div className="config-content">
              <NewsConfig />
            </div>
          </TabPane>

          <TabPane key="ai" title="AI模型配置">
            <div className="config-content">
              <AIConfig />
            </div>
          </TabPane>

          <TabPane key="email" title="邮件配置">
            <div className="config-content">
              <EmailConfig />
            </div>
          </TabPane>

          <TabPane key="holiday" title="节假日维护">
            <div className="config-content">
              <HolidayConfig />
            </div>
          </TabPane>

          <TabPane key="database" title="数据库连接">
            <div className="config-content">
              <DatabaseConfig />
            </div>
          </TabPane>

          <TabPane key="listing-data" title="上市数据配置">
            <div className="config-content">
              <ListingDataConfig />
            </div>
          </TabPane>
        </Tabs>
      </Card>
    </div>
  )
}

export default SystemConfig

