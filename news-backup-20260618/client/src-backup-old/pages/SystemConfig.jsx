import React, { useState } from 'react'
import AIConfig from './AIConfig'
import EmailConfig from './EmailConfig'
import QichachaConfig from './QichachaConfig'
import NewsConfig from './NewsConfig'
import BasicSystemConfig from './BasicSystemConfig'
import HolidayConfig from './HolidayConfig'
import DatabaseConfig from './DatabaseConfig'
import './SystemConfig.css'

function SystemConfig() {
  const [activeTab, setActiveTab] = useState('basic')

  return (
    <div className="system-config">
      <div className="config-header">
        <h2>系统配置</h2>
      </div>

      <div className="config-tabs">
        <button
          className={`tab-button ${activeTab === 'basic' ? 'active' : ''}`}
          onClick={() => setActiveTab('basic')}
        >
          系统配置
        </button>
        <button
          className={`tab-button ${activeTab === 'qichacha' ? 'active' : ''}`}
          onClick={() => setActiveTab('qichacha')}
        >
          企查查接口配置
        </button>
        <button
          className={`tab-button ${activeTab === 'news' ? 'active' : ''}`}
          onClick={() => setActiveTab('news')}
        >
          新闻接口配置
        </button>
        <button
          className={`tab-button ${activeTab === 'ai' ? 'active' : ''}`}
          onClick={() => setActiveTab('ai')}
        >
          AI模型配置
        </button>
        <button
          className={`tab-button ${activeTab === 'email' ? 'active' : ''}`}
          onClick={() => setActiveTab('email')}
        >
          邮件配置
        </button>
        <button
          className={`tab-button ${activeTab === 'holiday' ? 'active' : ''}`}
          onClick={() => setActiveTab('holiday')}
        >
          节假日维护
        </button>
        <button
          className={`tab-button ${activeTab === 'database' ? 'active' : ''}`}
          onClick={() => setActiveTab('database')}
        >
          数据库连接
        </button>
      </div>

      {activeTab === 'basic' && (
        <BasicSystemConfig />
      )}

      {activeTab === 'qichacha' && (
        <QichachaConfig />
      )}

      {activeTab === 'news' && (
        <NewsConfig />
      )}

      {activeTab === 'ai' && (
        <AIConfig />
      )}

      {activeTab === 'email' && (
        <EmailConfig />
      )}

      {activeTab === 'holiday' && (
        <HolidayConfig />
      )}

      {activeTab === 'database' && (
        <DatabaseConfig />
      )}
    </div>
  )
}

export default SystemConfig

