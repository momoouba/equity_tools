import React, { useEffect, useState } from 'react'
import { useNavigate, Routes, Route, useLocation } from 'react-router-dom'
import axios from '../utils/axios'
import EnterpriseManagement from './EnterpriseManagement'
import CompanyManagement from './CompanyManagement'
import SystemConfig from './SystemConfig'
import NewsInfo from './NewsInfo'
import EmailManagement from './EmailManagement'
import UserManagement from './UserManagement'
import ScheduledTaskManagement from './ScheduledTaskManagement'
import UserProfileModal from '../components/UserProfileModal'
import './Dashboard.css'

function Dashboard() {
  const [user, setUser] = useState(null)
  const [activeMenu, setActiveMenu] = useState('enterprises')
  const [isAdmin, setIsAdmin] = useState(false)
  const [hasNewsPermission, setHasNewsPermission] = useState(false)
  const [systemConfig, setSystemConfig] = useState({
    system_name: '',
    logo: ''
  })
  const [showUserProfileModal, setShowUserProfileModal] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // 根据路径设置活动菜单
    if (location.pathname.includes('enterprises')) {
      setActiveMenu('enterprises')
    } else if (location.pathname.includes('companies')) {
      setActiveMenu('companies')
    } else if (location.pathname.includes('email')) {
      setActiveMenu('email')
    } else if (location.pathname.includes('system')) {
      setActiveMenu('system')
    } else if (location.pathname.includes('news')) {
      setActiveMenu('news')
    } else if (location.pathname.includes('users')) {
      setActiveMenu('users')
    } else if (location.pathname.includes('scheduled-tasks')) {
      setActiveMenu('scheduled-tasks')
    }
  }, [location])

  useEffect(() => {
    // 检查用户是否已登录
    const userData = localStorage.getItem('user')
    if (!userData) {
      navigate('/login')
      return
    }
    const userInfo = JSON.parse(userData)
    setUser(userInfo)
    const isAdminUser = userInfo.role === 'admin'
    setIsAdmin(isAdminUser)
    
    // 检查用户是否有"新闻舆情"应用权限
    const appPermissions = userInfo.app_permissions || []
    const hasPermission = appPermissions.some(perm => perm.app_name === '新闻舆情')
    setHasNewsPermission(hasPermission || isAdminUser)
    
    // 获取系统配置
    fetchSystemConfig()
  }, [navigate])

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

  // 监听系统配置更新事件
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
    navigate('/login')
  }

  const handleUpdateUser = (updatedUser) => {
    setUser(updatedUser)
  }

  if (!user) {
    return <div>加载中...</div>
  }

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-content">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {systemConfig.logo && (
              <img 
                src={`/api/uploads/${systemConfig.logo}`} 
                alt="Logo" 
                style={{ height: '40px', width: 'auto', objectFit: 'contain' }}
              />
            )}
            <h1>{systemConfig.system_name || '股权投资小工具锦集'}</h1>
          </div>
          <div className="user-info">
            <span>
              欢迎，<span 
                className="user-account-link" 
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setShowUserProfileModal(true)
                }}
                title="点击查看个人信息"
                style={{ cursor: 'pointer', userSelect: 'none' }}
              >
                {user.account}
              </span>
            </span>
            <button onClick={handleLogout} className="logout-button">
              退出登录
            </button>
          </div>
        </div>
      </header>
      
      <div className="dashboard-body">
        <aside className="dashboard-sidebar">
          <nav className="sidebar-nav">
            <button
              className={`nav-item ${activeMenu === 'enterprises' ? 'active' : ''}`}
              onClick={() => {
                setActiveMenu('enterprises')
                navigate('/dashboard/enterprises')
              }}
            >
              被投企业管理
            </button>
            <button
              className={`nav-item ${activeMenu === 'news' ? 'active' : ''}`}
              onClick={() => {
                setActiveMenu('news')
                navigate('/dashboard/news')
              }}
            >
              舆情信息
            </button>
            {isAdmin && (
              <>
                <button
                  className={`nav-item ${activeMenu === 'companies' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveMenu('companies')
                    navigate('/dashboard/companies')
                  }}
                >
                  企业列表
                </button>
                <button
                  className={`nav-item ${activeMenu === 'email' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveMenu('email')
                    navigate('/dashboard/email')
                  }}
                >
                  邮件收发
                </button>
                <button
                  className={`nav-item ${activeMenu === 'users' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveMenu('users')
                    navigate('/dashboard/users')
                  }}
                >
                  用户管理
                </button>
                <button
                  className={`nav-item ${activeMenu === 'scheduled-tasks' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveMenu('scheduled-tasks')
                    navigate('/dashboard/scheduled-tasks')
                  }}
                >
                  定时任务管理
                </button>
                <button
                  className={`nav-item ${activeMenu === 'system' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveMenu('system')
                    navigate('/dashboard/system')
                  }}
                >
                  系统配置
                </button>
              </>
            )}
          </nav>
        </aside>

        <main className="dashboard-main">
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
            <Route path="/system" element={<SystemConfig />} />
            <Route path="/" element={
              (isAdmin || hasNewsPermission) ? <EnterpriseManagement /> : <CompanyManagement />
            } />
          </Routes>
        </main>
      </div>

      <UserProfileModal
        isOpen={showUserProfileModal}
        onClose={() => setShowUserProfileModal(false)}
        onUpdateUser={handleUpdateUser}
      />
    </div>
  )
}

export default Dashboard
