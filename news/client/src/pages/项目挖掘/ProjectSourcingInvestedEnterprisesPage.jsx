import React from 'react'
import EnterpriseManagement from '../EnterpriseManagement'

/**
 * 项目挖掘 — 被投企业：复用舆情监控对象列表能力，数据落在 invested_enterprises.data_app_name = 项目挖掘
 */
export default function ProjectSourcingInvestedEnterprisesPage() {
  return (
    <EnterpriseManagement
      dataAppName="项目挖掘"
      pageTitle="被投企业"
      hideEntityTabs
      viewportBoundTable
    />
  )
}
