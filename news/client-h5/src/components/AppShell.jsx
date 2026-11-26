import { TabBar } from 'antd-mobile'
import { AppOutline, UserOutline } from 'antd-mobile-icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const TABS = [
  { key: '/', title: '首页', icon: <AppOutline /> },
  { key: '/me', title: '我的', icon: <UserOutline /> }
]

export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()

  // 仅在真正处于首页/我的时高亮；应用内页面不高亮「首页」，
  // 这样再点底栏「首页」一定能触发跳转回 /
  const active =
    location.pathname === '/'
      ? '/'
      : location.pathname.startsWith('/me')
        ? '/me'
        : null

  return (
    <div className="h5-page">
      <Outlet />
      <TabBar
        activeKey={active}
        onChange={(key) => {
          if (key === '/') {
            navigate('/', { replace: true })
            return
          }
          navigate(key)
        }}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          borderTop: '1px solid #eee',
          background: '#fff',
          paddingBottom: 'var(--h5-safe-bottom)'
        }}
      >
        {TABS.map((t) => (
          <TabBar.Item key={t.key} icon={t.icon} title={t.title} />
        ))}
      </TabBar>
    </div>
  )
}
