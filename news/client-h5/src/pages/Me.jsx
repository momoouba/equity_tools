import { Button, Dialog } from 'antd-mobile'
import { useNavigate } from 'react-router-dom'
import { clearUser, getUser, hasNewsPermission } from '../utils/auth'

export default function Me() {
  const navigate = useNavigate()
  const user = getUser() || {}
  const displayName = user.username || user.account || user.name || '—'
  const roleLabel = user.role === 'admin' ? '管理员（手机端仍按「我的企业」）' : '用户'

  const logout = async () => {
    const ok = await Dialog.confirm({ content: '确定退出登录？' })
    if (!ok) return
    clearUser()
    navigate('/login', { replace: true })
  }

  return (
    <div className="h5-me">
      <div className="h5-me__card">
        <div className="h5-me__row">
          <span className="h5-me__label">账号</span>
          <span>{displayName}</span>
        </div>
        <div className="h5-me__row">
          <span className="h5-me__label">角色</span>
          <span>{roleLabel}</span>
        </div>
        <div className="h5-me__row">
          <span className="h5-me__label">舆情权限</span>
          <span>{hasNewsPermission(user) ? '有' : '无'}</span>
        </div>
      </div>
      <Button block color="primary" fill="outline" onClick={logout}>
        退出登录
      </Button>
      <p style={{ marginTop: 16, color: '#8f959e', fontSize: 12, lineHeight: 1.5 }}>
        需要完整管理功能时，请在电脑浏览器打开同一网址（或加参数 ?pc=1）。
      </p>
    </div>
  )
}
