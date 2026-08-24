import React from 'react'
import { Tabs } from '@arco-design/web-react'
import ProjectSourcingCompetitorAnalysisPage from './ProjectSourcingCompetitorAnalysisPage'
import EnterpriseManagement from '../EnterpriseManagement'
import '../EnterpriseManagement.css'

const { TabPane } = Tabs

export default function CompetitorAnalysisPostPage() {
  return (
    <div className="merged-tabs-page">
      <Tabs defaultActiveTab="analysis" type="line">
        <TabPane key="analysis" title="投后-竞品分析">
          <ProjectSourcingCompetitorAnalysisPage embedded />
        </TabPane>
        <TabPane key="invested-enterprises" title="被投企业（在此处发起竞品分析）">
          <EnterpriseManagement
            dataAppName="竞品分析"
            pageTitle="被投企业"
            hideEntityTabs
            hidePageTitle
            viewportBoundTable
          />
        </TabPane>
      </Tabs>
    </div>
  )
}
