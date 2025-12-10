const axios = require('axios');
const newsAnalysis = require('./newsAnalysis');

/**
 * 网页内容提取工具类
 */
class WebContentExtractor {
  constructor() {
    // newsAnalysis已经是导出的实例，直接使用
  }

  /**
   * 抓取网页HTML内容
   * @param {string} url - 网页URL
   * @returns {Promise<string>} HTML内容
   */
  async fetchWebContent(url) {
    try {
      console.log(`[网页抓取] 开始抓取网页内容: ${url}`);
      
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400
      });

      // 检查响应内容类型
      const contentType = response.headers['content-type'] || '';
      if (!contentType.includes('text/html')) {
        console.warn(`[网页抓取] 警告: 响应内容类型不是HTML: ${contentType}`);
      }

      const htmlContent = response.data;
      console.log(`[网页抓取] 成功抓取网页，内容长度: ${htmlContent.length} 字符`);
      
      return htmlContent;
    } catch (error) {
      console.error(`[网页抓取] 抓取网页失败 (${url}):`, error.message);
      if (error.response) {
        console.error(`[网页抓取] HTTP状态码: ${error.response.status}`);
      }
      throw new Error(`抓取网页失败: ${error.message}`);
    }
  }

  /**
   * 使用AI提取网页正文内容并生成摘要
   * @param {string} htmlContent - HTML内容
   * @param {string} url - 网页URL
   * @param {string} title - 新闻标题（可选）
   * @returns {Promise<{content: string, abstract: string}>} 提取的正文和摘要
   */
  async extractContentWithAI(htmlContent, url, title = '') {
    try {
      // 获取当前使用的AI配置信息
      let aiConfigInfo = '未知';
      try {
        const aiConfig = await newsAnalysis.getActiveAIConfig();
        aiConfigInfo = `${aiConfig.provider} - ${aiConfig.model_name} (${aiConfig.config_name || '未命名配置'})`;
      } catch (configError) {
        console.warn(`[AI提取] 获取AI配置信息失败:`, configError.message);
      }
      
      console.log(`[AI提取] 开始使用AI提取正文和生成摘要`);
      console.log(`[AI提取] 使用的AI配置: ${aiConfigInfo}`);
      
      // 限制HTML内容长度，避免超过AI模型的token限制
      const maxHtmlLength = 50000; // 约50KB的HTML内容
      const truncatedHtml = htmlContent.length > maxHtmlLength 
        ? htmlContent.substring(0, maxHtmlLength) + '...'
        : htmlContent;

      const prompt = `
请从以下网页HTML内容中提取正文内容，并生成摘要。

网页URL: ${url}
${title ? `新闻标题: ${title}` : ''}

HTML内容:
${truncatedHtml}

请按照以下要求处理：
1. **提取正文内容**：
   - 去除HTML标签、脚本、样式等无关内容
   - 提取文章的主要正文内容
   - 保留段落结构，使用换行符分隔段落
   - 去除导航栏、侧边栏、广告、版权信息等非正文内容
   - 如果无法提取到有效正文，返回"无法提取正文内容"

2. **生成摘要**：
   - 基于提取的正文内容，生成100字左右的关键信息摘要
   - 摘要应包含文章的核心要点和关键数据
   - 如果无法提取正文，摘要可以为空

请按照以下JSON格式返回结果：
{
  "content": "提取的正文内容（去除HTML标签，保留段落结构）",
  "abstract": "100字左右的摘要"
}

注意：
- content字段应包含完整的正文内容，不要截断
- abstract字段应为100字左右的精炼摘要
- 如果HTML内容无法提取到有效正文，content可以为空字符串，abstract也可以为空
`;

      const aiResponse = await newsAnalysis.callAIModel(prompt);
      
      if (!aiResponse) {
        throw new Error('AI模型未返回有效响应');
      }

      // 尝试解析JSON响应
      let result;
      try {
        // 尝试提取JSON部分（AI可能返回markdown格式的代码块）
        const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/) || 
                         aiResponse.match(/```\s*([\s\S]*?)\s*```/) ||
                         aiResponse.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
          const jsonStr = jsonMatch[1] || jsonMatch[0];
          result = JSON.parse(jsonStr);
        } else {
          // 如果没有找到JSON，尝试直接解析整个响应
          result = JSON.parse(aiResponse);
        }
      } catch (parseError) {
        console.error(`[AI提取] JSON解析失败，原始响应:`, aiResponse.substring(0, 500));
        throw new Error(`AI响应格式错误: ${parseError.message}`);
      }

      if (!result.content && !result.abstract) {
        throw new Error('AI返回的结果中content和abstract均为空');
      }

      console.log(`[AI提取] 成功提取正文（长度: ${result.content?.length || 0}）和摘要（长度: ${result.abstract?.length || 0}）`);
      
      return {
        content: result.content || '',
        abstract: result.abstract || ''
      };
    } catch (error) {
      console.error(`[AI提取] AI提取失败:`, error.message);
      throw error;
    }
  }

  /**
   * 从URL抓取内容并提取正文和摘要
   * @param {string} url - 网页URL
   * @param {string} title - 新闻标题（可选）
   * @returns {Promise<{content: string, abstract: string}>} 提取的正文和摘要
   */
  async extractFromUrl(url, title = '') {
    try {
      // 1. 抓取网页内容
      const htmlContent = await this.fetchWebContent(url);
      
      // 2. 使用AI提取正文和生成摘要
      const result = await this.extractContentWithAI(htmlContent, url, title);
      
      return result;
    } catch (error) {
      console.error(`[内容提取] 从URL提取内容失败 (${url}):`, error.message);
      throw error;
    }
  }
}

module.exports = WebContentExtractor;

