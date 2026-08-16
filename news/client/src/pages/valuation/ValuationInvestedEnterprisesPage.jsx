import React from 'react'
import { useNavigate } from 'react-router-dom'
import EnterpriseManagement from '../EnterpriseManagement'
import './valuation.css'

export default function ValuationInvestedEnterprisesPage() {
  const navigate = useNavigate()
  return (
    <EnterpriseManagement
      dataAppName="项目估值"
      pageTitle="被投企业"
      hideEntityTabs
      viewportBoundTable
      onValuationClick={(caseId) => navigate(`/dashboard/valuation/workbench/${caseId}`)}
    />
  )
}
