import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from '@arco-design/web-react'
import '@arco-design/web-react/dist/css/arco.css'
import { redirectToH5IfMobile } from './utils/mobileH5Redirect'
import App from './App'
import './index.css'

// 尽早跳转，避免刷新 PC 口时先闪电脑版
if (!redirectToH5IfMobile()) {
  const themeConfig = {
    primaryColor: '#165dff',
    successColor: '#00b42a',
    warningColor: '#ff7d00',
    errorColor: '#f53f3f',
    fontSize: 14,
    borderRadius: 4,
    sizeStep: 4,
    componentSize: 'default'
  }

  const rootElement = document.getElementById('root')
  if (rootElement) {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ConfigProvider theme={themeConfig}>
          <App />
        </ConfigProvider>
      </React.StrictMode>
    )
  }
}
