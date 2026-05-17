import React from 'react'
import EnterpriseManagement from '../EnterpriseManagement'

/**
 * 竞品分析 — 被投企业：复用舆情监控对象列表能力，数据落在 invested_enterprises.data_app_name = 竞品分析
 */
export default function ProjectSourcingInvestedEnterprisesPage() {
  return (
    <EnterpriseManagement
      dataAppName="竞品分析"
      pageTitle="被投企业"
      hideEntityTabs
      viewportBoundTable
    />
  )
}
