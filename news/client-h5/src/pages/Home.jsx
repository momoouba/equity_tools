import { Link } from 'react-router-dom'
import {
  getUser,
  hasCompetitorPermission,
  hasListingPermission,
  hasNewsPermission,
  hasPerformancePermission,
  hasProjectSourcingPermission,
  hasValuationPermission
} from '../utils/auth'

export default function Home() {
  const user = getUser()
  const name = user?.username || user?.account || user?.name || '用户'
  const canNews = hasNewsPermission(user)
  const canListing = hasListingPermission(user)
  const canSourcing = hasProjectSourcingPermission(user)
  const canValuation = hasValuationPermission(user)
  const canCompetitor = hasCompetitorPermission(user)
  const canPerformance = hasPerformancePermission(user)

  return (
    <div>
      <div className="h5-home__hero">
        <h1>你好，{name}</h1>
        <p>手机端仅支持查看结果，配置与编辑请使用电脑版。</p>
      </div>
      {canNews ? (
        <Link className="h5-card-link" to="/news">
          <h3>舆情信息</h3>
          <p>查看与我相关的企业舆情（只读）</p>
        </Link>
      ) : null}
      {canListing ? (
        <Link className="h5-card-link" to="/listing/new-share">
          <h3>打新日历</h3>
          <p>按申购日查看新股（只读）</p>
        </Link>
      ) : null}
      {canListing ? (
        <Link className="h5-card-link" to="/listing/progress">
          <h3>上市进展</h3>
          <p>底层项目审核与持仓进展（只读）</p>
        </Link>
      ) : null}
      {canSourcing ? (
        <Link className="h5-card-link" to="/financing">
          <h3>融资事件</h3>
          <p>市场融资动态（只读）</p>
        </Link>
      ) : null}
      {canValuation ? (
        <Link className="h5-card-link" to="/valuation">
          <h3>项目估值</h3>
          <p>草稿与已保存结果（只读）</p>
        </Link>
      ) : null}
      {canCompetitor ? (
        <Link className="h5-card-link" to="/competitor">
          <h3>竞品分析</h3>
          <p>进度与结果（只读）</p>
        </Link>
      ) : null}
      {canPerformance ? (
        <Link className="h5-card-link" to="/performance">
          <h3>业绩看板</h3>
          <p>按日期版本查看指标（只读）</p>
        </Link>
      ) : null}
      {!canNews &&
      !canListing &&
      !canSourcing &&
      !canValuation &&
      !canCompetitor &&
      !canPerformance ? (
        <div className="h5-empty">当前账号暂无可查看的业务模块</div>
      ) : null}
    </div>
  )
}
