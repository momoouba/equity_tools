import React, { useEffect, useState } from 'react'
import { useNavigate, Routes, Route, useLocation } from 'react-router-dom'
import { Layout, Menu, Button, Spin, Message } from '@arco-design/web-react'
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

const { Header, Sider, Content } = Layout
const MenuItem = Menu.Item

function Dashboard() {
  const [user, setUser] = useState(null)
  const [selectedKeys, setSelectedKeys] = useState(['enterprises'])
  const [isAdmin, setIsAdmin] = useState(false)
  const [hasNewsPermission, setHasNewsPermission] = useState(false)
  const [systemConfig, setSystemConfig] = useState({
    system_name: '',
    logo: ''
  })
  const [showUserProfileModal, setShowUserProfileModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (!userData) {
      navigate('/login')
      return
    }
    const userInfo = JSON.parse(userData)
    setUser(userInfo)
    const isAdminUser = userInfo.role === 'admin'
    setIsAdmin(isAdminUser)
    
    const appPermissions = userInfo.app_permissions || []
    const hasPermission = appPermissions.some(perm => perm.app_name === '新闻舆情')
    setHasNewsPermission(hasPermission || isAdminUser)
    
    fetchSystemConfig()
    setLoading(false)
  }, [navigate])

  useEffect(() => {
    if (location.pathname.includes('enterprises')) {
      setSelectedKeys(['enterprises'])
    } else if (location.pathname.includes('companies')) {
      setSelectedKeys(['companies'])
    } else if (location.pathname.includes('email')) {
      setSelectedKeys(['email'])
    } else if (location.pathname.includes('system')) {
      setSelectedKeys(['system'])
    } else if (location.pathname.includes('news')) {
      setSelectedKeys(['news'])
    } else if (location.pathname.includes('users')) {
      setSelectedKeys(['users'])
    } else if (location.pathname.includes('scheduled-tasks')) {
      setSelectedKeys(['scheduled-tasks'])
    }
  }, [location])

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
    navigate(`/dashboard/${key}`)
  }

  if (loading || !user) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  const menuItems = [
    {
      key: 'enterprises',
      title: '被投企业管理',
      visible: isAdmin || hasNewsPermission
    },
    {
      key: 'news',
      title: '舆情信息',
      visible: isAdmin || hasNewsPermission
    },
    {
      key: 'companies',
      title: '企业列表',
      visible: isAdmin
    },
    {
      key: 'email',
      title: '邮件收发',
      visible: isAdmin
    },
    {
      key: 'users',
      title: '用户管理',
      visible: isAdmin
    },
    {
      key: 'scheduled-tasks',
      title: '定时任务管理',
      visible: isAdmin
    },
    {
      key: 'system',
      title: '系统配置',
      visible: isAdmin
    }
  ].filter(item => item.visible)

  return (
    <Layout className="dashboard-layout">
      <Header className="dashboard-header">
        <div className="header-left">
          {systemConfig.logo && (
            <img 
              src={`/api/uploads/${systemConfig.logo}`} 
              alt="Logo" 
              className="header-logo"
            />
          )}
          <h1 className="header-title">{systemConfig.system_name || '股权投资小工具锦集'}</h1>
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
      </Header>
      <Layout>
        <Sider className="dashboard-sider" width={200}>
          <Menu
            selectedKeys={selectedKeys}
            onClickMenuItem={handleMenuClick}
            className="dashboard-menu"
          >
            {menuItems.map(item => (
              <MenuItem key={item.key}>
                {item.title}
              </MenuItem>
            ))}
          </Menu>
        </Sider>
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
            <Route path="/system" element={<SystemConfig />} />
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

