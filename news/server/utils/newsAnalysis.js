const axios = require('axios');
const db = require('../db');

/**
 * 新闻分析工具类
 */
class NewsAnalysis {
  constructor() {
    this.aiConfig = null;
  }

  /**
   * 获取活跃的AI配置
   */
  async getActiveAIConfig() {
    if (!this.aiConfig) {
      const configs = await db.query(
        `SELECT * FROM ai_model_config 
         WHERE application_type = 'news_analysis' 
         AND is_active = 1 
         AND delete_mark = 0 
         ORDER BY created_at DESC 
         LIMIT 1`
      );
      
      if (configs.length === 0) {
        throw new Error('未找到可用的AI模型配置');
      }
      
      this.aiConfig = configs[0];
    }
    
    return this.aiConfig;
  }

  /**
   * 调用AI模型进行分析
   */
  async callAIModel(prompt, config = null) {
    const aiConfig = config || await this.getActiveAIConfig();
    
    try {
      if (aiConfig.provider === 'alibaba') {
        return await this.callAlibabaModel(prompt, aiConfig);
      } else if (aiConfig.provider === 'openai') {
        return await this.callOpenAIModel(prompt, aiConfig);
      } else {
        throw new Error(`不支持的AI提供商: ${aiConfig.provider}`);
      }
    } catch (error) {
      console.error('AI模型调用失败:', error);
      throw error;
    }
  }

  /**
   * 调用阿里云千问模型
   */
  async callAlibabaModel(prompt, config) {
    const requestData = {
      model: config.model_name,
      input: {
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      },
      parameters: {
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        top_p: config.top_p
      }
    };

    const response = await axios.post(config.api_endpoint, requestData, {
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    return response.data.output?.text || response.data.output?.choices?.[0]?.message?.content;
  }

  /**
   * 调用OpenAI模型
   */
  async callOpenAIModel(prompt, config) {
    const requestData = {
      model: config.model_name,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: config.temperature,
      max_tokens: config.max_tokens,
      top_p: config.top_p
    };

    const response = await axios.post(config.api_endpoint, requestData, {
      headers: {
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    });

    return response.data.choices?.[0]?.message?.content;
  }

  /**
   * 分析新闻情绪和类型
   */
  async analyzeNewsSentimentAndType(title, content, sourceUrl) {
    const prompt = `
请分析以下新闻文章的情绪倾向和类型分类：

标题：${title}
内容：${content.substring(0, 2000)}...
链接：${sourceUrl}

请按照以下JSON格式返回分析结果：
{
  "sentiment": "positive|neutral|negative",
  "sentiment_reason": "情绪判断的原因",
  "news_type": ["类型标签1", "类型标签2"],
  "news_abstract": "100字左右的关键信息摘要"
}

情绪分类标准（重要：请仔细区分以下情况）：
- positive: 正面新闻
  * 获奖、融资、业务增长、产品发布、合作等
  * 企业及时响应外部风险/漏洞并提供解决方案（展示企业能力和产品优势）
  * 企业主动发现并修复问题（展示技术实力和责任心）
  * 企业帮助客户或行业应对风险（展示专业能力）
  * 企业获得认可、荣誉、认证等
  * 企业业务拓展、市场增长、技术突破等

- neutral: 中性新闻
  * 一般性报道、事实陈述、行业动态等
  * 客观报道行业风险或问题，未涉及具体企业应对措施
  * 企业常规运营信息、公告等

- negative: 负面新闻（严格判断，仅限以下情况）
  * 企业自身出现争议、问题、亏损、裁员等
  * 企业被批评、投诉、处罚等
  * 企业产品/服务出现严重问题且未及时解决
  * 企业应对风险不力，导致负面影响
  * 企业自身的安全漏洞、数据泄露等（非外部风险应对）

**关键判断原则：**
1. 如果文章提到"漏洞"、"风险"等词汇，但内容是展示企业及时响应、提供防护方案、帮助客户解决问题，这属于正面新闻（展示企业能力和产品优势）
2. 只有当风险/问题直接指向企业自身，或企业应对不力时，才判断为负面
3. 企业主动应对外部风险并成功解决，应判断为正面新闻
4. 如果不确定，优先判断为中性而非负面

类型标签包括但不限于（每个标签最多4个字符）：
- 企业发展
- 企业荣誉
- 产品发布
- 融资消息
- 合作伙伴
- 技术创新
- 市场拓展
- 人事变动
- 财务报告
- 行业分析
- 安全防护（新增：企业提供安全防护、漏洞修复等）
- 产品能力（新增：展示产品功能、技术实力等）
- 广告推广
- 商业广告
- 营销推广
- 其他

**重要要求：每个类型标签必须控制在4个字符以内，超过4个字符的标签将被截断。**

**广告识别重要提示：**
- 如果文章主要目的是推销产品、服务或品牌，请标记为"广告推广"、"商业广告"或"营销推广"
- 广告特征包括：产品宣传、服务推介、品牌营销、促销活动、商业合作推广等
- 即使涉及真实的企业信息，如果主要目的是营销推广，仍应标记为广告类型

请确保返回的是有效的JSON格式。
`;

    try {
      const response = await this.callAIModel(prompt);
      
      // 尝试解析JSON响应
      let result;
      try {
        // 提取JSON部分（可能包含在代码块中）
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('未找到JSON格式的响应');
        }
      } catch (parseError) {
        console.warn('AI响应解析失败，使用默认值:', parseError.message);
        result = {
          sentiment: 'neutral',
          sentiment_reason: '解析失败，使用默认值',
          news_type: ['其他'],
          news_abstract: content.substring(0, 100) + '...'
        };
      }

      // 限制关键词长度为4个字符以内
      const limitedKeywords = (result.news_type || ['其他']).map(keyword => {
        if (typeof keyword === 'string' && keyword.length > 4) {
          return keyword.substring(0, 4);
        }
        return keyword;
      });

      return {
        sentiment: result.sentiment || 'neutral',
        sentiment_reason: result.sentiment_reason || '',
        keywords: limitedKeywords,
        news_abstract: result.news_abstract || content.substring(0, 100) + '...'
      };
    } catch (error) {
      console.error('新闻分析失败:', error);
      return {
        sentiment: 'neutral',
        sentiment_reason: '分析失败',
        keywords: ['其他'],
        news_abstract: content.substring(0, 100) + '...'
      };
    }
  }

  /**
   * 分析新闻与被投企业的关联性
   */
  async analyzeEnterpriseRelevance(title, content, enterprises) {
    const enterpriseList = enterprises.map(e => `${e.enterprise_full_name}(${e.project_abbreviation})`).join('、');
    
    const prompt = `
请严格分析以下新闻文章与被投企业的关联性。请注意：只有当新闻内容与企业有直接、明确的关联时才认为相关。

**重要：您只能从以下被投企业列表中选择企业，不得返回列表之外的任何企业名称！**

新闻标题：${title}
新闻内容：${content.substring(0, 3000)}...

被投企业列表（您只能从这些企业中选择）：
${enterpriseList}

请严格按照以下标准评估相关度：

**严格评估标准**：
- 90-100%：新闻直接提及企业名称、产品名称、高管姓名或具体业务
- 70-89%：新闻涉及企业的具体项目、合作伙伴关系或直接影响企业的事件
- 50-69%：新闻涉及企业所在的细分行业领域，且对该企业有明确影响
- 30-49%：新闻涉及相关行业趋势，但必须与企业业务有明确关联
- 0-29%：基本无关或仅有模糊的行业关联

**重要提醒**：
1. 仅仅因为都属于"科技"、"医疗"、"AI"、"信息技术"等大类行业不足以构成关联
2. 必须有具体的业务关联、竞争关系或直接影响
3. 宁可保守，不要过度关联
4. 如果不确定，请给出较低的相关度分数
5. **特别注意**：医保政策、行业监管、通用技术趋势等新闻通常与具体企业无直接关联
6. **企业名称检查**：如果新闻中没有明确提及企业名称或其产品/服务，相关度应该非常低
7. **业务匹配**：必须确认新闻内容与企业的具体业务领域有直接关系，而非泛泛的行业关系

请按照以下JSON格式返回分析结果：
{
  "relevant_enterprises": [
    {
      "enterprise_name": "企业全称",
      "relevance_score": 85,
      "relevance_reason": "详细说明为什么认为相关，包括具体的关联点"
    }
  ],
  "analysis_summary": "整体分析总结，说明为什么选择了这些企业"
}

**严格要求**：
1. 只返回相关度30%以上的企业
2. 只能返回上述被投企业列表中的企业，不得返回任何其他企业名称
3. 如果新闻中提到的企业不在被投企业列表中，不得返回该企业
4. 如果没有明确相关的被投企业，请返回空数组
5. 请确保返回的是有效的JSON格式

**特别提醒**：如果新闻中提到"武汉启云方科技有限公司"等不在被投企业列表中的企业，绝对不要返回这些企业名称！
`;

    try {
      const response = await this.callAIModel(prompt);
      
      // 尝试解析JSON响应
      let result;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('未找到JSON格式的响应');
        }
      } catch (parseError) {
        console.warn('企业关联性分析解析失败:', parseError.message);
        return [];
      }

      // 筛选相关度30%以上的企业，并确保企业名称在被投企业列表中
      let relevantEnterprises = (result.relevant_enterprises || [])
        .filter(item => item.relevance_score >= 30)
        .map(item => ({
          enterprise_name: item.enterprise_name,
          relevance_score: item.relevance_score,
          relevance_reason: item.relevance_reason
        }))
        .filter(item => {
          // 验证企业名称是否在被投企业列表中
          const isValidEnterprise = enterprises.some(e => 
            e.enterprise_full_name === item.enterprise_name ||
            e.enterprise_full_name.includes(item.enterprise_name) ||
            item.enterprise_name.includes(e.enterprise_full_name)
          );
          
          if (!isValidEnterprise) {
            console.log(`⚠️ AI返回了不在被投企业列表中的企业: "${item.enterprise_name}"，已过滤`);
          }
          
          return isValidEnterprise;
        });

      // 二次验证：检查企业名称和关键业务词汇是否在新闻内容中出现
      relevantEnterprises = relevantEnterprises.filter(enterprise => {
        const fullContent = (title + ' ' + content).toLowerCase();
        const enterpriseName = enterprise.enterprise_name.toLowerCase();
        
        // 检查企业全称是否在内容中出现
        const nameInContent = fullContent.includes(enterpriseName);
        
        // 检查企业简称或关键词是否出现
        const enterpriseKeywords = [
          enterpriseName,
          enterprise.enterprise_name.replace(/有限公司|股份有限公司|集团|科技|信息/g, '').toLowerCase(),
          // 可以根据需要添加更多关键词提取逻辑
        ].filter(keyword => keyword.length > 2); // 过滤太短的关键词
        
        const hasKeywordInContent = enterpriseKeywords.some(keyword => fullContent.includes(keyword));
        
        // 如果企业名称和关键词都不在内容中，大幅降低相关度
        if (!nameInContent && !hasKeywordInContent) {
          console.log(`二次验证：企业"${enterprise.enterprise_name}"及其关键词未在新闻内容中出现，相关度从${enterprise.relevance_score}%降低到0%`);
          enterprise.relevance_score = 0;
        } else if (!nameInContent && enterprise.relevance_score > 40) {
          // 如果只有关键词匹配但没有企业全名，降低相关度
          console.log(`二次验证：企业"${enterprise.enterprise_name}"未直接出现，但有关键词匹配，相关度从${enterprise.relevance_score}%降低到${Math.max(enterprise.relevance_score - 40, 0)}%`);
          enterprise.relevance_score = Math.max(enterprise.relevance_score - 40, 0);
        }
        
        // 如果相关度仍然大于等于30%，则保留
        return enterprise.relevance_score >= 30;
      });

      return relevantEnterprises;
    } catch (error) {
      console.error('企业关联性分析失败:', error);
      return [];
    }
  }

  /**
   * 验证现有企业关联的合理性
   */
  async validateExistingAssociation(title, content, enterpriseName) {
    if (!enterpriseName) {
      return false;
    }

    // 第一步：检查企业是否在被投企业表中存在
    const enterpriseExists = await db.query(
      `SELECT enterprise_full_name FROM invested_enterprises 
       WHERE enterprise_full_name = ? AND delete_mark = 0`,
      [enterpriseName]
    );

    if (enterpriseExists.length === 0) {
      console.log(`🚫 数据库检查：企业"${enterpriseName}"不在被投企业表中，直接解除关联`);
      return false;
    }

    // 第二步：进行基础文本匹配检查
    const fullText = (title + ' ' + content).toLowerCase();
    const enterpriseKeywords = [
      enterpriseName.toLowerCase(),
      enterpriseName.replace(/有限公司|股份有限公司|集团|科技|信息|医疗/g, '').toLowerCase(),
      enterpriseName.split(/有限公司|股份有限公司|集团/)[0].toLowerCase()
    ].filter(keyword => keyword.length > 2);

    const hasDirectMention = enterpriseKeywords.some(keyword => 
      fullText.includes(keyword) && keyword.length > 2
    );

    if (!hasDirectMention) {
      console.log(`🚫 文本检查：企业"${enterpriseName}"未在新闻内容中出现，解除关联`);
      return false;
    }

    const prompt = `
请极其严格地评估以下新闻与指定企业的关联性。

新闻标题：${title}
新闻内容：${content.substring(0, 3000)}...

指定企业：${enterpriseName}

**严格评估标准**：

**必须满足以下条件之一才能判断为合理关联**：
1. 新闻中直接提及企业的完整名称或简称
2. 新闻中提及企业的具体产品、服务或品牌名称
3. 新闻中提及企业的高管姓名或具体人员
4. 新闻涉及企业的具体项目、合作伙伴或商业活动
5. 新闻对企业的业务、股价、经营状况有直接影响

**以下情况必须判断为不合理关联**：
1. 仅因为行业相同（如都是"科技"、"医疗"、"AI"、"芯片"等）
2. 通用的行业新闻、政策法规、技术趋势
3. 其他公司的产品发布、技术突破、商业活动
4. 行业分析、市场报告、投资观点等泛泛内容
5. 企业名称、产品名称、人员姓名均未在新闻中出现

**特别严格的判断原则**：
- 如果新闻主体是其他公司（如安谋科技、英伟达等），与指定企业无关
- 如果新闻内容完全没有提及指定企业的任何信息，必须判断为不合理
- 医疗行业新闻不等于与医疗企业相关
- 科技行业新闻不等于与科技企业相关
- 宁可错误地解除关联，也不要错误地保持关联

**示例**：
- "安谋科技发布NPU芯片" 与 "浙江太美医疗" → 不合理（完全不同的公司和业务）
- "医保局新政策" 与 "医疗企业" → 不合理（通用政策，非企业特定）
- "AI技术发展趋势" 与 "AI企业" → 不合理（行业趋势，非企业特定）

请返回JSON格式：
{
  "is_reasonable": false,
  "confidence": 95,
  "reason": "新闻主体是安谋科技的NPU产品发布，与太美医疗的业务领域完全无关，仅因为都涉及技术不构成关联"
}

只返回JSON，不要其他内容。
`;

    try {
      const response = await this.callAIModel(prompt);
      
      // 尝试解析JSON响应
      let result;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          result = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('未找到JSON格式的响应');
        }
      } catch (parseError) {
        console.warn('企业关联验证解析失败:', parseError.message);
        // 如果解析失败，默认保持关联（保守策略）
        return true;
      }

      const isReasonable = result.is_reasonable === true;
      const confidence = result.confidence || 0;
      const reason = result.reason || '无具体原因';

      console.log(`企业关联验证结果: ${enterpriseName}`);
      console.log(`- 是否合理: ${isReasonable}`);
      console.log(`- 置信度: ${confidence}%`);
      console.log(`- 理由: ${reason}`);

      // 更严格的判断：如果AI判断为不合理且置信度>=60%，就解除关联
      if (!isReasonable && confidence >= 60) {
        console.log(`🚫 解除不合理关联: ${enterpriseName} (置信度: ${confidence}%)`);
        return false;
      }
      
      // 如果AI判断为合理，但置信度很低(<50%)，也解除关联
      if (isReasonable && confidence < 50) {
        console.log(`🚫 解除低置信度关联: ${enterpriseName} (置信度: ${confidence}%)`);
        return false;
      }
      
      return isReasonable;

    } catch (error) {
      console.error('企业关联验证失败:', error);
      // 出错时保持关联（保守策略）
      return true;
    }
  }


  /**
   * 处理有被投企业的新闻
   */
  async processNewsWithEnterprise(newsItem) {
    try {
      console.log(`\n[processNewsWithEnterprise] 开始分析有企业关联的新闻`);
      console.log(`[processNewsWithEnterprise] 新闻标题: ${newsItem.title}`);
      console.log(`[processNewsWithEnterprise] 当前企业全称: "${newsItem.enterprise_full_name}"`);
      
      // 检查该企业是否来自invested_enterprises表且状态不为"完全退出"
      // 如果是，则不应该解除关联，直接使用该企业全称
      let finalEnterpriseName = newsItem.enterprise_full_name;
      let shouldValidate = true;
      
      console.log(`[processNewsWithEnterprise] 检查企业是否来自invested_enterprises表...`);
      try {
        const enterpriseCheck = await db.query(
          `SELECT enterprise_full_name, exit_status, delete_mark
           FROM invested_enterprises 
           WHERE enterprise_full_name = ? 
           AND exit_status NOT IN ('完全退出', '已上市')
           AND delete_mark = 0 
           LIMIT 1`,
          [newsItem.enterprise_full_name]
        );
        
        console.log(`[processNewsWithEnterprise] 查询结果数量: ${enterpriseCheck.length}`);
        if (enterpriseCheck.length > 0) {
          console.log(`[processNewsWithEnterprise] 查询结果详情:`, enterpriseCheck[0]);
          // 该企业来自invested_enterprises表且状态不为"完全退出"
          // 不需要验证关联性，直接保持企业全称
          console.log(`[processNewsWithEnterprise] ✅ 企业来自invested_enterprises表且状态不为"完全退出"，保持关联: ${newsItem.enterprise_full_name}`);
          shouldValidate = false;
        } else {
          console.log(`[processNewsWithEnterprise] ⚠️ 企业不在invested_enterprises表中或状态为"完全退出"，需要AI验证关联性`);
          // 查询所有相关记录以便调试
          const allResults = await db.query(
            `SELECT enterprise_full_name, exit_status, delete_mark
             FROM invested_enterprises 
             WHERE enterprise_full_name = ?`,
            [newsItem.enterprise_full_name]
          );
          console.log(`[processNewsWithEnterprise] 所有相关记录（不限制状态）:`, allResults);
        }
      } catch (e) {
        console.error(`[processNewsWithEnterprise] ❌ 检查企业状态时出错:`, e.message);
        console.error(`[processNewsWithEnterprise] 错误堆栈:`, e.stack);
      }
      
      // 只有需要验证的才进行AI验证（例如来自additional_wechat_accounts的新闻）
      let shouldKeepAssociation = true; // 默认保持关联
      if (shouldValidate) {
        console.log(`[processNewsWithEnterprise] 需要AI验证企业关联性`);
        // 重新验证企业关联的合理性
        shouldKeepAssociation = await this.validateExistingAssociation(
          newsItem.title,
          newsItem.content,
          newsItem.enterprise_full_name
        );

        if (!shouldKeepAssociation) {
          console.log(`[processNewsWithEnterprise] 🚫 AI判断需要解除企业关联: ${newsItem.enterprise_full_name}`);
          finalEnterpriseName = null;
        } else {
          console.log(`[processNewsWithEnterprise] ✅ AI验证企业关联合理: ${newsItem.enterprise_full_name}`);
        }
      } else {
        console.log(`[processNewsWithEnterprise] 跳过AI验证，直接保持企业关联`);
      }

      console.log(`[processNewsWithEnterprise] 开始分析新闻情绪和类型...`);
      const analysis = await this.analyzeNewsSentimentAndType(
        newsItem.title,
        newsItem.content,
        newsItem.source_url
      );
      console.log(`[processNewsWithEnterprise] 分析完成 - 情绪: ${analysis.sentiment}, 关键词: ${JSON.stringify(analysis.keywords)}`);

      // 更新数据库，包括可能的企业关联变更
      console.log(`[processNewsWithEnterprise] 准备更新数据库`);
      console.log(`[processNewsWithEnterprise] 企业全称: "${finalEnterpriseName || '(空)'}"`);
      console.log(`[processNewsWithEnterprise] 情绪: ${analysis.sentiment}`);
      console.log(`[processNewsWithEnterprise] 执行SQL: UPDATE news_detail SET enterprise_full_name = ?, news_sentiment = ?, keywords = ?, news_abstract = ? WHERE id = ?`);
      
      await db.execute(
        `UPDATE news_detail 
         SET enterprise_full_name = ?, news_sentiment = ?, keywords = ?, news_abstract = ?
         WHERE id = ?`,
        [
          finalEnterpriseName,
          analysis.sentiment,
          JSON.stringify(analysis.keywords),
          analysis.news_abstract,
          newsItem.id
        ]
      );
      
      // 验证更新是否成功
      console.log(`[processNewsWithEnterprise] 验证更新结果...`);
      const verifyResult = await db.query(
        'SELECT enterprise_full_name, news_sentiment FROM news_detail WHERE id = ?',
        [newsItem.id]
      );
      if (verifyResult.length > 0) {
        console.log(`[processNewsWithEnterprise] ✓ 更新成功！`);
        console.log(`[processNewsWithEnterprise] 数据库中的企业全称: "${verifyResult[0].enterprise_full_name || '(空)'}"`);
        console.log(`[processNewsWithEnterprise] 数据库中的情绪: ${verifyResult[0].news_sentiment}`);
      } else {
        console.log(`[processNewsWithEnterprise] ❌ 更新失败！无法验证更新结果`);
      }

      console.log(`[processNewsWithEnterprise] ✓ 已完成新闻分析: ${newsItem.id}${shouldValidate && !shouldKeepAssociation ? ' (已解除企业关联)' : ''}`);
      return true;
    } catch (error) {
      console.error(`新闻分析失败 ${newsItem.id}:`, error);
      return false;
    }
  }

  /**
   * 处理无被投企业的新闻
   */
  async processNewsWithoutEnterprise(newsItem) {
    try {
      console.log(`分析无企业关联的新闻: ${newsItem.title}`);
      
      // 获取所有被投企业信息
      const enterprises = await db.query(
        `SELECT enterprise_full_name, project_abbreviation 
         FROM invested_enterprises 
         WHERE delete_mark = 0 
         AND exit_status NOT IN ('完全退出', '已上市')`
      );

      if (enterprises.length === 0) {
        console.log('没有可匹配的被投企业');
        return await this.processNewsWithEnterprise(newsItem);
      }

      // 分析企业关联性
      const relevantEnterprises = await this.analyzeEnterpriseRelevance(
        newsItem.title,
        newsItem.content,
        enterprises
      );

      // 分析新闻情绪和类型
      const analysis = await this.analyzeNewsSentimentAndType(
        newsItem.title,
        newsItem.content,
        newsItem.source_url
      );

      // 检查是否为广告类型
      const isAdvertisement = analysis.keywords.some(keyword => {
        const keywordLower = keyword.toLowerCase();
        return keywordLower.includes('广告') || 
               keywordLower.includes('推广') || 
               keywordLower.includes('营销') ||
               keywordLower === '商业广告' ||
               keywordLower === '营销推广' ||
               keywordLower === '广告推广';
      });

      if (relevantEnterprises.length === 0 || isAdvertisement) {
        // 没有相关企业，或者是广告类型，保持enterprise_full_name为空
        await db.execute(
          `UPDATE news_detail 
           SET news_sentiment = ?, keywords = ?, news_abstract = ?
           WHERE id = ?`,
          [
            analysis.sentiment,
            JSON.stringify(analysis.keywords),
            analysis.news_abstract,
            newsItem.id
          ]
        );
        const reason = isAdvertisement ? '广告类型' : '无关联企业';
        console.log(`✓ 已完成新闻分析（${reason}): ${newsItem.id}`);
      } else {
        // 有相关企业且非广告类型，需要复制数据
        // 最终验证：确保所有企业名称都在被投企业表中存在
        const validEnterprises = [];
        for (const enterprise of relevantEnterprises) {
          const existsInDB = await db.query(
            `SELECT enterprise_full_name FROM invested_enterprises 
             WHERE enterprise_full_name = ? AND delete_mark = 0 AND exit_status != '完全退出'`,
            [enterprise.enterprise_name]
          );
          
          if (existsInDB.length > 0) {
            validEnterprises.push(enterprise);
          } else {
            console.log(`🚫 最终验证失败：企业"${enterprise.enterprise_name}"不在被投企业数据库中，已排除`);
          }
        }
        
        if (validEnterprises.length === 0) {
          // 没有有效的企业关联，保持enterprise_full_name为空
          await db.execute(
            `UPDATE news_detail 
             SET news_sentiment = ?, keywords = ?, news_abstract = ?
             WHERE id = ?`,
            [
              analysis.sentiment,
              JSON.stringify(analysis.keywords),
              analysis.news_abstract,
              newsItem.id
            ]
          );
          console.log(`✓ 已完成新闻分析（无有效企业关联): ${newsItem.id}`);
        } else {
          // 处理有效的企业关联
          for (let i = 0; i < validEnterprises.length; i++) {
            const enterprise = validEnterprises[i];
            
            if (i === 0) {
              // 更新原记录
              await db.execute(
                `UPDATE news_detail 
                 SET enterprise_full_name = ?, news_sentiment = ?, keywords = ?, news_abstract = ?
                 WHERE id = ?`,
                [
                  enterprise.enterprise_name,
                  analysis.sentiment,
                  JSON.stringify(analysis.keywords),
                  analysis.news_abstract,
                  newsItem.id
                ]
              );
            } else {
              // 创建新记录
              const { generateId } = require('./idGenerator');
              const newId = await generateId('news_detail');
              
              await db.execute(
                `INSERT INTO news_detail 
                 (id, account_name, wechat_account, enterprise_full_name, source_url, 
                  title, summary, public_time, content, keywords, news_abstract, news_sentiment)
                 SELECT ?, account_name, wechat_account, ?, source_url, 
                        title, summary, public_time, content, ?, ?, ?
                 FROM news_detail WHERE id = ?`,
                [
                  newId,
                  enterprise.enterprise_name,
                  JSON.stringify(analysis.keywords),
                  analysis.news_abstract,
                  analysis.sentiment,
                  newsItem.id
                ]
              );
            }
          }
          console.log(`✓ 已完成新闻分析（关联${validEnterprises.length}家有效企业): ${newsItem.id}`);
        }
      }

      return true;
    } catch (error) {
      console.error(`新闻分析失败 ${newsItem.id}:`, error);
      return false;
    }
  }

  /**
   * 批量分析新闻
   */
  async batchAnalyzeNews(limit = 50) {
    try {
      console.log('开始批量分析新闻...');
      
      // 获取需要分析的新闻（news_abstract为空的记录），包括公众号信息
      const newsItems = await db.query(
        `SELECT id, title, content, source_url, enterprise_full_name, wechat_account, account_name, created_at
         FROM news_detail 
         WHERE news_abstract IS NULL 
         AND content IS NOT NULL 
         AND content != ''
         ORDER BY created_at DESC 
         LIMIT ?`,
        [limit]
      );

      if (newsItems.length === 0) {
        console.log('没有需要分析的新闻');
        return { success: true, processed: 0, message: '没有需要分析的新闻' };
      }

      console.log(`找到 ${newsItems.length} 条需要分析的新闻`);

      let successCount = 0;
      let errorCount = 0;

      for (const newsItem of newsItems) {
        try {
          let result;
          // 在AI分析前，先检查是否是企业公众号发的
          // 如果是invested_enterprises表中状态不为"完全退出"的企业公众号，直接设置企业全称
          if (!newsItem.enterprise_full_name && newsItem.wechat_account) {
            try {
              const enterpriseResult = await db.query(
                // 支持逗号分隔的多个公众号ID
                `SELECT enterprise_full_name 
                 FROM invested_enterprises 
                 WHERE (wechat_official_account_id = ? 
                   OR wechat_official_account_id LIKE ?
                   OR wechat_official_account_id LIKE ?
                   OR wechat_official_account_id LIKE ?)
                 AND exit_status NOT IN ('完全退出', '已上市')
                 AND delete_mark = 0 
                 LIMIT 1`,
                [
                  newsItem.wechat_account,
                  `${newsItem.wechat_account},%`,
                  `%,${newsItem.wechat_account},%`,
                  `%,${newsItem.wechat_account}`
                ]
              );
              
              if (enterpriseResult.length > 0) {
                newsItem.enterprise_full_name = enterpriseResult[0].enterprise_full_name;
                console.log(`[批量分析] ✓ 匹配到企业公众号，设置企业全称: ${newsItem.enterprise_full_name}`);
                // 更新数据库中的企业全称
                await db.execute(
                  'UPDATE news_detail SET enterprise_full_name = ? WHERE id = ?',
                  [newsItem.enterprise_full_name, newsItem.id]
                );
              }
            } catch (e) {
              console.warn(`[批量分析] 检查企业公众号时出错:`, e.message);
            }
          }
          
          if (newsItem.enterprise_full_name) {
            // 有被投企业的新闻
            result = await this.processNewsWithEnterprise(newsItem);
          } else {
            // 无被投企业的新闻
            result = await this.processNewsWithoutEnterprise(newsItem);
          }

          if (result) {
            successCount++;
          } else {
            errorCount++;
          }

          // 添加延迟避免API频率限制
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`处理新闻 ${newsItem.id} 时出错:`, error);
          errorCount++;
        }
      }

      console.log(`批量分析完成: 成功 ${successCount} 条, 失败 ${errorCount} 条`);

      // AI分析完成后，执行去重检查
      let duplicateCount = 0;
      try {
        console.log('开始执行去重检查...');
        duplicateCount = await this.performDuplicateCheck(newsItems);
        console.log(`去重检查完成: 标记删除 ${duplicateCount} 条重复文章`);
      } catch (duplicateError) {
        console.error('去重检查失败:', duplicateError);
      }

      return {
        success: true,
        processed: newsItems.length,
        successCount,
        errorCount,
        duplicateCount,
        message: `批量分析完成: 成功 ${successCount} 条, 失败 ${errorCount} 条, 去重 ${duplicateCount} 条`
      };
    } catch (error) {
      console.error('批量分析新闻失败:', error);
      throw error;
    }
  }

  /**
   * 执行去重检查
   * 按时间顺序检查，将后遇到的相似文章标记为删除状态
   */
  async performDuplicateCheck(newsItems) {
    try {
      const { checkArticleDuplicate } = require('./duplicateDetection');
      let duplicateCount = 0;

      // 按创建时间正序排列，确保先处理早期文章
      const sortedNews = newsItems.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      
      console.log(`开始对 ${sortedNews.length} 条新闻进行去重检查...`);

      for (let i = 0; i < sortedNews.length; i++) {
        const currentNews = sortedNews[i];
        
        try {
          // 检查当前文章是否与之前的文章重复
          const duplicateResult = await checkArticleDuplicate(
            currentNews.title,
            currentNews.content,
            currentNews.source_url,
            currentNews.created_at
          );

          if (duplicateResult.isDuplicate) {
            // 标记当前文章（后遇到的）为删除状态
            await db.execute(
              'UPDATE news_detail SET delete_mark = 1 WHERE id = ?',
              [currentNews.id]
            );
            
            duplicateCount++;
            console.log(`标记重复文章为删除: ${currentNews.title}`);
            console.log(`  相似度: ${(duplicateResult.similarity * 100).toFixed(1)}%`);
            console.log(`  原文章: ${duplicateResult.duplicateTitle}`);
          }

          // 添加小延迟避免数据库压力
          if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

        } catch (error) {
          console.error(`检查文章 ${currentNews.id} 重复时出错:`, error);
        }
      }

      return duplicateCount;
    } catch (error) {
      console.error('执行去重检查失败:', error);
      return 0;
    }
  }
}

module.exports = new NewsAnalysis();
