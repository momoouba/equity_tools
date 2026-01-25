import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Form, Input, Button, Message } from '@arco-design/web-react'
import axios from '../utils/axios'
import './Login.css'

const FormItem = Form.Item

function Login() {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [backgroundImage, setBackgroundImage] = useState('')
  const navigate = useNavigate()
  const canvasRef = useRef(null)
  const animationFrameRef = useRef(null)
  const particlesArrayRef = useRef([])
  const mouseRef = useRef({ x: null, y: null, radius: 150 })

  useEffect(() => {
    fetchSystemConfig()
  }, [])

  const fetchSystemConfig = async () => {
    try {
      const response = await axios.get('/api/system/basic-config')
      if (response.data.success && response.data.data.login_background) {
        setBackgroundImage(`/api/uploads/${response.data.data.login_background}`)
      } else {
        setBackgroundImage('')
      }
    } catch (error) {
      console.error('获取系统配置失败:', error)
      setBackgroundImage('')
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

  // 粒子特效相关代码
  useEffect(() => {
    // 如果有背景图片，不初始化粒子特效
    if (backgroundImage) {
      // 清理之前的动画
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }

    // 等待 canvas 渲染完成
    let timeoutId = null
    let resizeHandler = null
    let mouseMoveHandler = null
    let mouseOutHandler = null
    let particlesArray = []

    const initParticleEffect = () => {
      const canvas = canvasRef.current
      if (!canvas) {
        // 如果 canvas 还没准备好，延迟重试
        timeoutId = setTimeout(initParticleEffect, 100)
        return
      }

      // 确保 canvas 已经显示并且有尺寸
      if (canvas.offsetWidth === 0 || canvas.offsetHeight === 0) {
        // 如果 canvas 还没有尺寸，等待下一帧
        timeoutId = requestAnimationFrame(() => {
          setTimeout(initParticleEffect, 50)
        })
        return
      }

      const ctx = canvas.getContext('2d')
      let mouse = mouseRef.current

      // 粒子类
      class Particle {
        constructor() {
          this.x = Math.random() * canvas.width
          this.y = Math.random() * canvas.height
          this.directionX = (Math.random() * 2) - 1
          this.directionY = (Math.random() * 2) - 1
          this.size = (Math.random() * 3) + 1
          this.color = '#3B82F6'
        }
        draw() {
          ctx.beginPath()
          ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2, false)
          ctx.fillStyle = this.color
          ctx.fill()
        }
        update() {
          if (this.x > canvas.width || this.x < 0) this.directionX = -this.directionX
          if (this.y > canvas.height || this.y < 0) this.directionY = -this.directionY

          let dx = mouse.x - this.x
          let dy = mouse.y - this.y
          let distance = Math.sqrt(dx*dx + dy*dy)

          if (distance < mouse.radius) {
            if (mouse.x < this.x && this.x < canvas.width - this.size * 10) this.x += 2
            if (mouse.x > this.x && this.x > this.size * 10) this.x -= 2
            if (mouse.y < this.y && this.y < canvas.height - this.size * 10) this.y += 2
            if (mouse.y > this.y && this.y > this.size * 10) this.y -= 2
          }
          this.x += this.directionX * 0.4
          this.y += this.directionY * 0.4
          this.draw()
        }
      }

      // 初始化粒子数组
      const initParticles = () => {
        particlesArray = []
        let numberOfParticles = (canvas.width * canvas.height) / 9000
        for (let i = 0; i < numberOfParticles; i++) {
          particlesArray.push(new Particle())
        }
        particlesArrayRef.current = particlesArray
      }

      // 适配窗口大小
      resizeHandler = () => {
        canvas.width = window.innerWidth
        canvas.height = window.innerHeight
        initParticles()
      }
      resizeHandler()

      // 监听鼠标移动/离开
      mouseMoveHandler = (event) => {
        mouse.x = event.x
        mouse.y = event.y
      }
      mouseOutHandler = () => {
        mouse.x = undefined
        mouse.y = undefined
      }

      window.addEventListener('resize', resizeHandler)
      window.addEventListener('mousemove', mouseMoveHandler)
      window.addEventListener('mouseout', mouseOutHandler)

      // 粒子之间连线
      const connect = () => {
        for (let a = 0; a < particlesArray.length; a++) {
          for (let b = a; b < particlesArray.length; b++) {
            let distance = ((particlesArray[a].x - particlesArray[b].x) * (particlesArray[a].x - particlesArray[b].x)) + 
                           ((particlesArray[a].y - particlesArray[b].y) * (particlesArray[a].y - particlesArray[b].y))
            if (distance < (canvas.width/7) * (canvas.height/7)) {
              let opacityValue = 1 - (distance/20000)
              ctx.strokeStyle = 'rgba(59, 130, 246,' + opacityValue + ')'
              ctx.lineWidth = 1
              ctx.beginPath()
              ctx.moveTo(particlesArray[a].x, particlesArray[a].y)
              ctx.lineTo(particlesArray[b].x, particlesArray[b].y)
              ctx.stroke()
            }
          }
        }
      }

      // 动画循环
      const animate = () => {
        animationFrameRef.current = requestAnimationFrame(animate)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        for (let i = 0; i < particlesArray.length; i++) {
          particlesArray[i].update()
        }
        connect()
      }

      // 启动粒子特效
      initParticles()
      animate()
    }

    // 初始化粒子特效
    initParticleEffect()
    
    // 返回清理函数
    return () => {
      if (timeoutId) {
        if (typeof timeoutId === 'number') {
          clearTimeout(timeoutId)
        } else {
          cancelAnimationFrame(timeoutId)
        }
        timeoutId = null
      }
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler)
      }
      if (mouseMoveHandler) {
        window.removeEventListener('mousemove', mouseMoveHandler)
      }
      if (mouseOutHandler) {
        window.removeEventListener('mouseout', mouseOutHandler)
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      particlesArray = []
    }
  }, [backgroundImage])

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      const response = await axios.post('/api/auth/login', values)
      if (response.data.success) {
        localStorage.setItem('user', JSON.stringify(response.data.user))
        Message.success('登录成功')
        navigate('/dashboard')
      }
    } catch (err) {
      Message.error(err.response?.data?.message || '登录失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container" style={backgroundImage ? {
      backgroundImage: `url(${backgroundImage})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    } : {
      background: 'transparent'
    }}>
      <canvas 
        ref={canvasRef}
        id="particle-canvas"
        className="particle-canvas"
        style={{ display: backgroundImage ? 'none' : 'block' }}
      />
      
      <div className="login-card">
        <h1 className="login-title">股权投资小工具锦集</h1>
        <Form
          form={form}
          onSubmit={handleSubmit}
          layout="vertical"
          autoComplete="off"
        >
          <FormItem
            label="账号"
            field="account"
            rules={[{ required: true, message: '请输入账号' }]}
          >
            <Input placeholder="请输入账号" />
          </FormItem>
          
          <FormItem
            label="密码"
            field="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="请输入密码" />
          </FormItem>

          <FormItem>
            <Button
              type="primary"
              htmlType="submit"
              long
              loading={loading}
            >
              {loading ? '登录中...' : '登录'}
            </Button>
          </FormItem>

          <div className="register-link">
            还没有账号？<Link to="/register">立即注册</Link>
          </div>
        </Form>
      </div>
    </div>
  )
}

export default Login

