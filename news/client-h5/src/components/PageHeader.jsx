import { LeftOutline } from 'antd-mobile-icons'
import { useNavigate } from 'react-router-dom'

/**
 * 各应用列表页顶栏：左上角蓝色返回 → 默认首页；可传 onBack 自定义（如退回项目列表）
 */
export default function PageHeader({ title, subtitle, onBack }) {
  const navigate = useNavigate()

  return (
    <div className="h5-page-header">
      <button
        type="button"
        className="h5-page-header__back"
        aria-label={onBack ? '返回' : '返回首页'}
        onClick={() => (typeof onBack === 'function' ? onBack() : navigate('/'))}
      >
        <LeftOutline fontSize={22} />
      </button>
      <div className="h5-page-header__text">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </div>
  )
}
