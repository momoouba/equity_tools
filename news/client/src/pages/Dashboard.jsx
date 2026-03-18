import React, { useEffect, useState, useRef } from 'react'
import { useNavigate, Routes, Route, useLocation } from 'react-router-dom'
import { Layout, Button, Spin, Message } from '@arco-design/web-react'
import { IconCommon, IconApps, IconSettings } from '@arco-design/web-react/icon'
import axios from '../utils/axios'
import EnterpriseManagement from './EnterpriseManagement'
import CompanyManagement from './CompanyManagement'
import SystemConfig from './SystemConfig'
import NewsInfo from './NewsInfo'
import EmailManagement from './EmailManagement'
import UserManagement from './UserManagement'
import ScheduledTaskManagement from './ScheduledTaskManagement'
import PerformanceDashboardPage from './业绩看板应用/PerformanceDashboardPage'
import PerformanceSettingsPage from './业绩看板应用/PerformanceSettingsPage'
import UserProfileModal from '../components/UserProfileModal'
import './Dashboard.css'

const { Header, Content } = Layout

function Dashboard() {
  const [user, setUser] = useState(null)
  const [selectedKeys, setSelectedKeys] = useState(['enterprises'])
  const [isAdmin, setIsAdmin] = useState(false)
  const [hasNewsPermission, setHasNewsPermission] = useState(false)
  const [hasPerformancePermission, setHasPerformancePermission] = useState(false)
  const [systemConfig, setSystemConfig] = useState({
    system_name: '',
    logo: ''
  })
  const [showUserProfileModal, setShowUserProfileModal] = useState(false)
  const [activeAppKey, setActiveAppKey] = useState('news-app')
  const [openAppKey, setOpenAppKey] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()
  const headerRef = useRef(null)

  const applyUserInfo = (userInfo) => {
    setUser(userInfo)
    const isAdminUser = userInfo.role === 'admin'
    setIsAdmin(isAdminUser)

    const appPermissions = userInfo.app_permissions || []
    
    // 新闻舆情权限：只要存在 app_permissions 中 app_name='新闻舆情' 的记录即可
    const hasNewsPerm = appPermissions.some(
      perm => perm.app_name === '新闻舆情'
    )
    
    // 业绩看板权限：必须存在 app_permissions 中 app_name='业绩看板应用' 的记录（必须有会员等级配置）
    const hasPerfPerm = appPermissions.some(
      perm => perm.app_name === '业绩看板应用' && perm.membership_level_id
    )
    
    const newsEnabled = hasNewsPerm || isAdminUser
    const perfEnabled = hasPerfPerm || isAdminUser
    setHasNewsPermission(newsEnabled)
    setHasPerformancePermission(perfEnabled)

    if (newsEnabled) {
      setActiveAppKey('news-app')
    } else if (perfEnabled) {
      setActiveAppKey('performance-app')
    } else if (isAdminUser) {
      setActiveAppKey('admin')
    }
  }

  // 刷新当前用户信息（从后端获取最新 app_permissions）
  const refreshCurrentUser = async () => {
    try {
      const res = await axios.get('/api/auth/me')
      if (res.data?.success && res.data.user) {
        const freshUser = res.data.user
        applyUserInfo(freshUser)
        localStorage.setItem('user', JSON.stringify(freshUser))
      }
    } catch (error) {
      console.error('刷新当前用户信息失败:', error)
    }
  }

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (!userData) {
      navigate('/login')
      return
    }
    const userInfo = JSON.parse(userData)
    applyUserInfo(userInfo)

    // 后台再刷新一次，拿到最新会员配置
    refreshCurrentUser()
    fetchSystemConfig()
    setLoading(false)
  }, [navigate])

  useEffect(() => {
    if (location.pathname.includes('enterprises')) {
      setSelectedKeys(['enterprises'])
      setActiveAppKey('news-app')
    } else if (location.pathname.includes('news')) {
      setSelectedKeys(['news'])
      setActiveAppKey('news-app')
    } else if (location.pathname.includes('system-db')) {
      setSelectedKeys(['system-db'])
    } else if (location.pathname.includes('system')) {
      setSelectedKeys(['system'])
      // system 在不同 APP 下都可见，这里不切换 activeAppKey
    } else if (location.pathname.includes('performance-settings')) {
      setSelectedKeys(['performance-settings'])
      setActiveAppKey('performance-app')
    } else if (location.pathname.includes('performance')) {
      setSelectedKeys(['performance'])
      setActiveAppKey('performance-app')
    } else if (location.pathname.includes('companies')) {
      setSelectedKeys(['companies'])
      setActiveAppKey('admin')
    } else if (location.pathname.includes('email')) {
      setSelectedKeys(['email'])
      setActiveAppKey('admin')
    } else if (location.pathname.includes('users')) {
      setSelectedKeys(['users'])
      setActiveAppKey('admin')
    } else if (location.pathname.includes('scheduled-tasks')) {
      setSelectedKeys(['scheduled-tasks'])
      setActiveAppKey('admin')
    }
  }, [location])

  // 点击页面其他区域时收起下拉
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (headerRef.current && !headerRef.current.contains(e.target)) {
        setOpenAppKey(null)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [])

  const fetchSystemConfig = async () => {
    try {
      const response = await axios.get('/api/system/basic-config')
      if (response.data.success) {
        setSystemConfig(response.data.data || { system_name: '', logo: '' })
      }
    } catch (error) {
      console.error('获取系统配置失败:', error)
    }
  }

  useEffect(() => {
    const handleConfigUpdate = () => {
      fetchSystemConfig()
    }
    window.addEventListener('systemConfigUpdated', handleConfigUpdate)
    return () => {
      window.removeEventListener('systemConfigUpdated', handleConfigUpdate)
    }
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('user')
    Message.success('已退出登录')
    navigate('/login')
  }

  const handleUpdateUser = (updatedUser) => {
    setUser(updatedUser)
    localStorage.setItem('user', JSON.stringify(updatedUser))
  }

  const handleMenuClick = (key) => {
    setSelectedKeys([key])
    if (key === 'system-db') {
      navigate('/dashboard/system-db')
    } else {
      navigate(`/dashboard/${key}`)
    }
  }

  if (loading || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  const menuGroups = [
    {
      key: 'news-app',
      title: '新闻舆情',
      icon: <IconCommon />,
      visible: isAdmin || hasNewsPermission,
      children: [
        { key: 'news',        title: '舆情信息' },
        { key: 'enterprises', title: '舆情监控对象' },
        { key: 'system-db',   title: '数据库连接配置' }
      ]
    },
    {
      key: 'performance-app',
      title: '业绩看板',
      icon: <IconApps />,
      visible: isAdmin || hasPerformancePermission,
      children: [
        { key: 'performance',          title: '业绩看板' },
        { key: 'performance-settings', title: '业绩看板设置' },
        { key: 'system-db',            title: '数据库连接配置' }
      ]
    },
    {
      key: 'admin',
      title: '管理员设置',
      icon: <IconSettings />,
      visible: isAdmin,
      children: [
        { key: 'users',          title: '用户管理' },
        { key: 'system',         title: '系统配置' },
        { key: 'companies',      title: '企业列表' },
        { key: 'email',          title: '邮件收发' },
        { key: 'scheduled-tasks', title: '定时任务' }
      ]
    }
  ].filter(group => group.visible)

  return (
    <Layout className="dashboard-layout">
      <Header className="dashboard-header" ref={headerRef}>
        <div className="header-main">
          <div className="header-left">
            {systemConfig.logo && (
              <img 
                src={`/api/uploads/${systemConfig.logo}`} 
                alt="Logo" 
                className="header-logo"
              />
            )}
            <h1 className="header-title">{systemConfig.system_name || '股权投资小工具锦集'}</h1>
            <div className="app-nav">
              <div className="app-trigger-row">
                {menuGroups.map(group => {
                  const isActive = group.key === activeAppKey
                  return (
                    <div
                      key={group.key}
                      className={`app-trigger${isActive ? ' active' : ''}`}
                      onMouseEnter={() => setOpenAppKey(group.key)}
                      onMouseLeave={() => setOpenAppKey(null)}
                      onClick={(e) => {
                        e.stopPropagation()
                        const nextOpen = openAppKey === group.key ? null : group.key
                        setOpenAppKey(nextOpen)
                        setActiveAppKey(group.key)
                      }}
                    >
                      <span className="app-trigger-icon">{group.icon}</span>
                      <span className="app-trigger-text">{group.title}</span>
                      {openAppKey === group.key && (
                        <div className="app-dropdown">
                          {group.children.map(item => (
                            <button
                              key={item.key}
                              className={
                                'app-dropdown-item' +
                                (selectedKeys[0] === item.key ? ' selected' : '')
                              }
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedKeys([item.key])
                                setActiveAppKey(group.key)
                                handleMenuClick(item.key)
                                setOpenAppKey(null)
                              }}
                            >
                              <span className="app-dropdown-item-title">
                                {item.title}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="header-right">
            <span className="welcome-text">
              欢迎，<span 
                className="user-account-link" 
                onClick={() => setShowUserProfileModal(true)}
              >
                {user.account}
              </span>
            </span>
            <Button 
              type="primary" 
              status="danger" 
              size="small"
              onClick={handleLogout}
            >
              退出登录
            </Button>
          </div>
        </div>
      </Header>
      <Layout>
        <Content className="dashboard-content">
          <Routes>
            <Route path="/enterprises" element={
              (isAdmin || hasNewsPermission) ? <EnterpriseManagement /> : <div>您没有访问权限</div>
            } />
            <Route path="/news" element={
              (isAdmin || hasNewsPermission) ? <NewsInfo /> : <div>您没有访问权限</div>
            } />
            <Route path="/companies" element={<CompanyManagement />} />
            <Route path="/email" element={<EmailManagement />} />
            <Route path="/users" element={<UserManagement />} />
            <Route path="/scheduled-tasks" element={<ScheduledTaskManagement />} />
            <Route path="/system" element={<SystemConfig isAdmin={isAdmin} />} />
            <Route path="/system-db" element={<SystemConfig isAdmin={false} />} />
            <Route
              path="/performance"
              element={
                (isAdmin || hasPerformancePermission)
                  ? <PerformanceDashboardPage />
                  : <div>您没有访问权限</div>
              }
            />
            <Route
              path="/performance-settings"
              element={
                (isAdmin || hasPerformancePermission)
                  ? <PerformanceSettingsPage />
                  : <div>您没有访问权限</div>
              }
            />
            <Route path="/" element={
              (isAdmin || hasNewsPermission) ? <EnterpriseManagement /> : <CompanyManagement />
            } />
          </Routes>
        </Content>
      </Layout>

      <UserProfileModal
        isOpen={showUserProfileModal}
        onClose={() => setShowUserProfileModal(false)}
        onUpdateUser={handleUpdateUser}
      />
    </Layout>
  )
}

export default Dashboard

