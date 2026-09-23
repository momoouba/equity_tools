import React, { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Tabs } from '@arco-design/web-react'
import ValuationPreProjectsPage from './ValuationPreProjectsPage'
import ValuationPostCasesPage from './ValuationPostCasesPage'
import EnterpriseManagement from '../EnterpriseManagement'
import AppPublishButton from '../../components/AppPublishButton'
import './valuation.css'

const { TabPane } = Tabs
const TABS = ['pre', 'post', 'invested']

/**
 * 项目估值：投前、投后、被投企业（在此发起估值）同一页三个标签。
 * showPublish 为 false 时用于免登录发布嵌入，不提供再次发布。
 */
export default function ValuationHubPage({ showPublish = true, onOpenWorkbench }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const urlTab = params.get('tab')
  const [localTab, setLocalTab] = useState(TABS.includes(urlTab) ? urlTab : 'pre')
  const tab = showPublish ? (TABS.includes(urlTab) ? urlTab : 'pre') : localTab

  const openWorkbench = (caseId) => {
    if (onOpenWorkbench) onOpenWorkbench(caseId)
    else navigate(`/dashboard/valuation/workbench/${caseId}`)
  }

  return (
    <div className="merged-tabs-page">
      <Tabs
        activeTab={tab}
        type="line"
        onChange={(key) => {
          if (showPublish) setParams({ tab: key }, { replace: true })
          else setLocalTab(key)
        }}
        extra={showPublish ? <AppPublishButton appName="项目估值" /> : null}
      >
        <TabPane key="pre" title="投前项目估值">
          <ValuationPreProjectsPage embedded onOpenWorkbench={openWorkbench} />
        </TabPane>
        <TabPane key="post" title="投后项目估值">
          <ValuationPostCasesPage embedded onOpenWorkbench={openWorkbench} />
        </TabPane>
        <TabPane key="invested" title="被投企业（在此发起估值）">
          <EnterpriseManagement
            dataAppName="项目估值"
            pageTitle="被投企业"
            hideEntityTabs
            hidePageTitle
            viewportBoundTable
            onValuationClick={openWorkbench}
          />
        </TabPane>
      </Tabs>
    </div>
  )
}
