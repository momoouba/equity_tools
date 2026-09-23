import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import ShareNewsPage from './pages/ShareNewsPage'
// 业绩看板应用扩展 - 导入业绩看板分享页
import PerformanceSharePage from './pages/PerformanceSharePage'
import ShareListingProjectProgressPage from './pages/ShareListingProjectProgressPage'
import AppPublishPage, { PublishErrorBoundary } from './pages/AppPublishPage'
import { AppPublishHome, AppPublishWorkbench } from './pages/AppPublishViews'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard/*" element={<Dashboard />} />
        {/* 业绩看板应用扩展 - 业绩看板分享路由 */}
        <Route path="/share/app/:token" element={<PublishErrorBoundary><AppPublishPage /></PublishErrorBoundary>}>
          <Route index element={<AppPublishHome />} />
          <Route path="workbench/:caseId" element={<AppPublishWorkbench />} />
        </Route>
        <Route path="/share/:token" element={<ShareNewsPage />} />
        <Route path="/performance/share/:token" element={<PerformanceSharePage />} />
        <Route path="/share/listing-project-progress/:token" element={<ShareListingProjectProgressPage />} />
        <Route path="/publish/:token" element={<PublishErrorBoundary><AppPublishPage /></PublishErrorBoundary>}>
          <Route index element={<AppPublishHome />} />
          <Route path="workbench/:caseId" element={<AppPublishWorkbench />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App

