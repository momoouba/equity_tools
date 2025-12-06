const express = require('express');
const axios = require('axios');
const db = require('../db');

const router = express.Router();

// 企查查接口查询
router.get('/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    
    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({ success: false, message: '请输入查询关键词' });
    }

    // 获取企查查配置 - 只使用接口类型为"企业信息"的配置
    const configs = await db.query(
      `SELECT * FROM qichacha_config 
       WHERE interface_type = '企业信息' AND is_active = 1 
       ORDER BY created_at DESC LIMIT 1`
    );
    let appKey = '';
    let secretKey = '';
    let dailyLimit = 100;
    
    if (configs.length > 0) {
      appKey = configs[0].qichacha_app_key || '';
      secretKey = configs[0].qichacha_secret_key || '';
      dailyLimit = parseInt(configs[0].qichacha_daily_limit || '100', 10);
    }

    if (!appKey || !secretKey) {
      return res.status(400).json({ 
        success: false, 
        message: '请先配置企查查企业信息接口的应用凭证和秘钥（接口类型：企业信息）' 
      });
    }

    // 检查今日查询次数（简化版，实际应该记录每日查询次数）
    // 这里可以添加查询次数限制的逻辑
    // dailyLimit 变量已从配置中获取

    // 调用企查查接口
    // 根据文档：企业模糊搜索接口
    // 接口地址：https://api.qichacha.com/FuzzySearch/GetList
    // 请求方式：GET
    // 参数：key (AppKey), searchKey (搜索关键词), pageIndex (页码)
    // 请求头：Token (Md5(key+Timespan+SecretKey)), Timespan (Unix时间戳，精确到秒)
    
    // Timespan 需要是精确到秒的Unix时间戳
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const token = require('crypto')
      .createHash('md5')
      .update(appKey + timestamp + secretKey)
      .digest('hex')
      .toUpperCase();

    console.log('企查查接口调用参数：', {
      searchKey: keyword,
      key: appKey.substring(0, 5) + '...',
      token: token.substring(0, 10) + '...',
      timestamp
    });

    // 调用企查查企业模糊搜索接口
    const response = await axios.get('https://api.qichacha.com/FuzzySearch/GetList', {
      params: {
        key: appKey,
        searchKey: keyword,
        pageIndex: 1
      },
      headers: {
        'Token': token,
        'Timespan': timestamp
      },
      timeout: 10000
    });

    // 处理返回数据
    console.log('企查查接口返回数据：', JSON.stringify(response.data).substring(0, 300));
    
    // 检查返回状态
    if (response.data.Status === '200' || response.data.status === '200') {
      const result = response.data.Result || response.data.result;
      if (result && Array.isArray(result) && result.length > 0) {
        // 格式化返回数据
        const formattedCompanies = result.map(item => ({
          name: item.Name || '',
          creditCode: item.CreditCode || '',
          website: item.Website || '',
          startDate: item.StartDate || '',
          operName: item.OperName || '',
          status: item.Status || '',
          address: item.Address || ''
        }));

        res.json({
          success: true,
          data: formattedCompanies
        });
      } else {
        res.json({
          success: true,
          data: [],
          message: '未找到相关企业信息'
        });
      }
    } else {
      const errorMsg = response.data.Message || response.data.message || '查询失败';
      res.status(400).json({
        success: false,
        message: errorMsg
      });
    }
  } catch (error) {
    console.error('企查查接口调用失败：', error);
    console.error('错误详情：', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    
    if (error.response) {
      // 如果企查查返回了错误信息
      const errorMessage = error.response.data?.Message || 
                          error.response.data?.message || 
                          `企查查接口调用失败（状态码：${error.response.status}）`;
      res.status(error.response.status).json({
        success: false,
        message: errorMessage
      });
    } else if (error.request) {
      // 请求已发出但没有收到响应
      res.status(500).json({
        success: false,
        message: '企查查接口无响应，请检查网络连接或稍后重试'
      });
    } else {
      // 其他错误
      res.status(500).json({
        success: false,
        message: error.message || '查询失败，请稍后重试'
      });
    }
  }
});

module.exports = router;

