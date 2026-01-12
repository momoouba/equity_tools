import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from '@arco-design/web-react'
import '@arco-design/web-react/dist/css/arco.css'
import App from './src-arco/App'
import './src-arco/index.css'

// Arco Design 主题配置 - 简约互联网商务风
// 配色：简约互联网商务风，间距：8px倍数规范（在组件中实现）
const themeConfig = {
  primaryColor: '#165dff',      // 主色调：蓝色
  successColor: '#00b42a',      // 成功色：绿色
  warningColor: '#ff7d00',      // 警告色：橙色
  errorColor: '#f53f3f',        // 错误色：红色
  fontSize: 14,                 // 基础字体大小
  borderRadius: 4,              // 圆角：4px（8px的倍数）
  sizeStep: 4,                  // 尺寸步长：4px（8px的倍数）
  componentSize: 'default'      // 组件尺寸：默认
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider theme={themeConfig}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)

