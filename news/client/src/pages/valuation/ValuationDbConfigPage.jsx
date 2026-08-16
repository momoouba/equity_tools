import React from 'react'
import SystemConfig from '../SystemConfig'

/** 项目估值 — 数据库连接配置（共用连接定义，被投同步写入本应用） */
export default function ValuationDbConfigPage() {
  return <SystemConfig isAdmin={false} />
}
