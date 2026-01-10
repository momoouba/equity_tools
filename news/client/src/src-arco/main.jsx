import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from '@arco-design/web-react'
import '@arco-design/web-react/dist/css/arco.css'
import App from './App'
import './index.css'

// Arco Design 主题配置 - 简约商务风
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider theme={themeConfig}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)

