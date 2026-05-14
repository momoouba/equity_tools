const express = require('express');
const { fetchQichachaFuzzyCompanies } = require('../utils/qichachaFuzzySearch');

const router = express.Router();

// 企查查接口查询
router.get('/search', async (req, res) => {
  try {
    const { keyword } = req.query;

    if (!keyword || keyword.trim() === '') {
      return res.status(400).json({ success: false, message: '请输入查询关键词' });
    }

    const out = await fetchQichachaFuzzyCompanies(keyword, { pageIndex: 1 });
    if (out.companies.length > 0) {
      res.json({ success: true, data: out.companies });
    } else {
      res.json({
        success: true,
        data: [],
        message: out.message || '未找到相关企业信息',
      });
    }
  } catch (error) {
    console.error('企查查接口调用失败：', error);
    console.error('错误详情：', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    if (error.code === 400 || error.code === 'NO_CONFIG') {
      return res.status(400).json({ success: false, message: error.message || '参数错误' });
    }

    if (error.response) {
      const errorMessage =
        error.response.data?.Message ||
        error.response.data?.message ||
        `企查查接口调用失败（状态码：${error.response.status}）`;
      res.status(error.response.status).json({
        success: false,
        message: errorMessage,
      });
    } else if (error.request) {
      res.status(500).json({
        success: false,
        message: '企查查接口无响应，请检查网络连接或稍后重试',
      });
    } else {
      res.status(500).json({
        success: false,
        message: error.message || '查询失败，请稍后重试',
      });
    }
  }
});

module.exports = router;

