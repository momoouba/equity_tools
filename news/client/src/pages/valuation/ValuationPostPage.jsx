import React from 'react'
import { Tabs } from '@arco-design/web-react'
import ValuationPostCasesPage from './ValuationPostCasesPage'
import EnterpriseManagement from '../EnterpriseManagement'
import { useNavigate } from 'react-router-dom'
import './valuation.css'

const { TabPane } = Tabs

export default function ValuationPostPage() {
  const navigate = useNavigate()
  return (
    <div className="merged-tabs-page">
      <Tabs defaultActiveTab="post-cases" type="line">
        <TabPane key="post-cases" title="投后项目估值">
          <ValuationPostCasesPage embedded />
        </TabPane>
        <TabPane key="invested-enterprises" title="被投企业（在此处发起估值）">
          <EnterpriseManagement
            dataAppName="项目估值"
            pageTitle="被投企业"
            hideEntityTabs
            hidePageTitle
            viewportBoundTable
            onValuationClick={(caseId) => navigate(`/dashboard/valuation/workbench/${caseId}`)}
          />
        </TabPane>
      </Tabs>
    </div>
  )
}
