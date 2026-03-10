import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import ShareNewsPage from './pages/ShareNewsPage'
// 业绩看板应用扩展 - 导入业绩看板分享页
import PerformanceSharePage from './pages/PerformanceSharePage'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard/*" element={<Dashboard />} />
        {/* 业绩看板应用扩展 - 业绩看板分享路由 */}
        <Route path="/share/:token" element={<ShareNewsPage />} />
        <Route path="/performance/share/:token" element={<PerformanceSharePage />} />
      </Routes>
    </Router>
  )
}

export default App

