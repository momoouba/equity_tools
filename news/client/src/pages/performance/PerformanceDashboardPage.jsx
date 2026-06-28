/**
 * 业绩看板应用 - React包装器
 * 由于现有系统使用React+JSX，这里创建React包装页面
 * 实际业务逻辑在PerformanceDashboard.vue中（通过iFrame或独立页面加载）
 */
import React, { useState, useEffect } from 'react'
import { Spin, Message } from '@arco-design/web-react'
import axios from '../../utils/axios'
import PerformanceApp from './PerformanceApp'

function PerformanceDashboardPage() {
  const [loading, setLoading] = useState(false)

  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <PerformanceApp />
    </div>
  )
}

export default PerformanceDashboardPage
