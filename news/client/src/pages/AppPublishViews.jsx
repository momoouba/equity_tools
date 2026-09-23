import React from 'react'
import { Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import ProjectSourcingPreInvestmentPage from './competitor-analysis/ProjectSourcingPreInvestmentPage'
import ValuationHubPage from './valuation/ValuationHubPage'
import ValuationWorkbenchPage from './valuation/ValuationWorkbenchPage'

function usePublishAppName() {
  const ctx = useOutletContext()
  return ctx?.appName || ''
}

function publishHomePath(token) {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/share/app/')) {
    return `/share/app/${token}`
  }
  return `/publish/${token}`
}

export function AppPublishHome() {
  const appName = usePublishAppName()
  const navigate = useNavigate()
  const { token } = useParams()
  if (appName === '项目估值') {
    return (
      <ValuationHubPage
        showPublish={false}
        onOpenWorkbench={(caseId) => navigate(`${publishHomePath(token)}/workbench/${caseId}`)}
      />
    )
  }
  if (appName === '竞品分析') {
    return <ProjectSourcingPreInvestmentPage showPublish={false} />
  }
  return <div style={{ padding: 24 }}>未知的发布应用</div>
}

export function AppPublishWorkbench() {
  const appName = usePublishAppName()
  const { token } = useParams()
  if (appName !== '项目估值') {
    return <Navigate to={publishHomePath(token)} replace />
  }
  return <ValuationWorkbenchPage />
}
