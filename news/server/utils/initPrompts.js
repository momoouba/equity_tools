const db = require('../db');
const { generateId } = require('./idGenerator');

/**
 * 初始化提示词配置到数据库
 */
async function initPrompts() {
  try {
    console.log('开始初始化提示词配置...');

    // 获取默认的AI模型配置（优先选择 news_analysis 类型且启用的配置）
    let defaultAiModelConfigId = null;
    try {
      // 先检查 ai_model_config 表是否存在
      const [tables] = await db.query(`
        SELECT TABLE_NAME 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'ai_model_config'
      `);
      
      if (tables.length === 0) {
        console.warn('  警告：ai_model_config 表不存在，提示词将不关联AI模型');
      } else {
        const aiConfigs = await db.query(
          `SELECT id FROM ai_model_config 
           WHERE application_type = 'news_analysis' 
           AND is_active = 1 
           AND delete_mark = 0 
           ORDER BY created_at DESC 
           LIMIT 1`
        );
        
        if (aiConfigs.length === 0) {
          // 如果没有 news_analysis 类型的，尝试获取任何启用的配置
          const anyConfigs = await db.query(
            `SELECT id FROM ai_model_config 
             WHERE is_active = 1 
             AND delete_mark = 0 
             ORDER BY created_at DESC 
             LIMIT 1`
          );
          if (anyConfigs.length > 0) {
            defaultAiModelConfigId = anyConfigs[0].id;
            console.log(`  ✓ 使用默认AI模型配置: ${anyConfigs[0].id}`);
          } else {
            console.warn('  警告：未找到可用的AI模型配置，提示词将不关联AI模型');
          }
        } else {
          defaultAiModelConfigId = aiConfigs[0].id;
          console.log(`  ✓ 使用新闻分析AI模型配置: ${aiConfigs[0].id}`);
        }
      }
    } catch (error) {
      console.warn('  获取AI模型配置时出现警告:', error.message);
      if (error.code) {
        console.warn('  错误代码:', error.code);
      }
      if (error.sqlMessage) {
        console.warn('  SQL错误:', error.sqlMessage);
      }
    }

    // 检查每个必需的提示词是否存在，如果不存在则创建
    // 定义所有必需的提示词配置

    // 新榜接口 - 情绪分析提示词
    const xinbangSentimentPrompt = `
请分析以下新闻文章的情绪倾向和类型分类：

标题：\${title}
内容：\${content}
链接：\${sourceUrl}
\${isAdditionalAccount}

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
- 榜单（新增：各类榜单、排名等）
- 获奖（新增：获奖、荣誉、认证等）
- 广告推广
- 商业广告
- 营销推广
- 其他

**重要要求：每个类型标签必须控制在4个字符以内，超过4个字符的标签将被截断。**

${isAdditionalAccount ? `**额外公众号新闻特殊处理（重要）：**
- 如果新闻内容涉及榜单、排名、获奖、荣誉、认证等信息，请务必添加"榜单"或"获奖"标签
- 榜单相关：各类榜单、排名、TOP榜单、排行榜等
- 获奖相关：获奖、荣誉、认证、资质、称号等
- 请仔细分析内容，确保不遗漏榜单或获奖相关信息
` : ''}

**广告识别重要提示：**
- 如果文章主要目的是推销产品、服务或品牌，请标记为"广告推广"、"商业广告"或"营销推广"
- 广告特征包括：产品宣传、服务推介、品牌营销、促销活动、商业合作推广等
- 即使涉及真实的企业信息，如果主要目的是营销推广，仍应标记为广告类型

请确保返回的是有效的JSON格式。
`;

    // 新榜接口 - 企业关联分析提示词
    const xinbangEnterpriseRelevancePrompt = `
请严格分析以下新闻文章与被投企业的关联性。请注意：只有当新闻内容与企业有直接、明确的关联时才认为相关。

**重要：您只能从以下被投企业列表中选择企业，不得返回列表之外的任何企业名称！**

新闻标题：\${title}
新闻内容：\${content}

被投企业列表（您只能从这些企业中选择）：
\${enterpriseList}

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

    // 新榜接口 - 关联验证提示词
    const xinbangValidationPrompt = `
请极其严格地评估以下新闻与指定企业的关联性。

新闻标题：\${title}
新闻内容：\${content}

指定企业：\${enterpriseName}

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

    // 企查查接口 - 情绪分析提示词（与新榜相同，但可以针对企查查特点优化）
    const qichachaSentimentPrompt = xinbangSentimentPrompt;

    // 企查查接口 - 企业关联分析提示词（与新榜相同）
    const qichachaEnterpriseRelevancePrompt = xinbangEnterpriseRelevancePrompt;

    // 企查查接口 - 关联验证提示词（与新榜相同）
    const qichachaValidationPrompt = xinbangValidationPrompt;

    const prompts = [
      {
        prompt_name: '新榜-情绪分析',
        interface_type: '新榜',
        prompt_type: 'sentiment_analysis',
        prompt_content: xinbangSentimentPrompt
      },
      {
        prompt_name: '新榜-企业关联分析',
        interface_type: '新榜',
        prompt_type: 'enterprise_relevance',
        prompt_content: xinbangEnterpriseRelevancePrompt
      },
      {
        prompt_name: '新榜-关联验证',
        interface_type: '新榜',
        prompt_type: 'validation',
        prompt_content: xinbangValidationPrompt
      },
      {
        prompt_name: '企查查-情绪分析',
        interface_type: '企查查',
        prompt_type: 'sentiment_analysis',
        prompt_content: qichachaSentimentPrompt
      },
      {
        prompt_name: '企查查-企业关联分析',
        interface_type: '企查查',
        prompt_type: 'enterprise_relevance',
        prompt_content: qichachaEnterpriseRelevancePrompt
      },
      {
        prompt_name: '企查查-关联验证',
        interface_type: '企查查',
        prompt_type: 'validation',
        prompt_content: qichachaValidationPrompt
      }
    ];

    // 获取系统用户ID（admin用户）
    const adminUsers = await db.query("SELECT id FROM users WHERE account = 'admin' LIMIT 1");
    const adminUserId = adminUsers.length > 0 ? adminUsers[0].id : null;

    let createdCount = 0;
    let updatedCount = 0;

    for (const prompt of prompts) {
      try {
        // 检查该提示词是否已存在（按 interface_type 和 prompt_type 组合）
        const existing = await db.query(
          `SELECT id, ai_model_config_id, prompt_content FROM ai_prompt_config 
           WHERE interface_type = ? 
           AND prompt_type = ? 
           AND delete_mark = 0 
           LIMIT 1`,
          [prompt.interface_type, prompt.prompt_type]
        );

        if (existing.length > 0) {
          // 如果已存在，检查是否需要更新AI模型配置或提示词内容
          const existingPrompt = existing[0];
          let needsUpdate = false;
          let updateFields = [];
          let updateValues = [];

          // 如果缺少AI模型配置，添加它
          if (!existingPrompt.ai_model_config_id && defaultAiModelConfigId) {
            updateFields.push('ai_model_config_id = ?');
            updateValues.push(defaultAiModelConfigId);
            needsUpdate = true;
          }

          // 更新提示词内容（确保使用最新的提示词）
          if (existingPrompt.prompt_content !== prompt.prompt_content) {
            updateFields.push('prompt_content = ?');
            updateValues.push(prompt.prompt_content);
            needsUpdate = true;
          }

          if (needsUpdate) {
            updateValues.push(existingPrompt.id);
            await db.execute(
              `UPDATE ai_prompt_config 
               SET ${updateFields.join(', ')}, updated_at = NOW()
               WHERE id = ?`,
              updateValues
            );
            updatedCount++;
            console.log(`  ✓ 已更新提示词: ${prompt.prompt_name}`);
          }
        } else {
        // 如果不存在，创建新的提示词配置
        const promptId = await generateId('ai_prompt_config');
        await db.execute(
          `INSERT INTO ai_prompt_config 
           (id, prompt_name, interface_type, prompt_type, prompt_content, ai_model_config_id, is_active, creator_user_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            promptId,
            prompt.prompt_name,
            prompt.interface_type,
            prompt.prompt_type,
            prompt.prompt_content,
            defaultAiModelConfigId, // 关联默认的AI模型配置
            1, // 默认启用
            adminUserId
          ]
        );
        createdCount++;
        console.log(`  ✓ 已创建提示词: ${prompt.prompt_name}`);

        // 记录创建日志
        if (adminUserId) {
          const logId = await generateId('ai_prompt_change_log');
          const logData = {
            ...prompt,
            ai_model_config_id: defaultAiModelConfigId
          };
          await db.execute(
            `INSERT INTO ai_prompt_change_log 
             (id, prompt_config_id, change_type, old_value, new_value, change_user_id, change_reason) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              logId,
              promptId,
              'create',
              null,
              JSON.stringify(logData),
              adminUserId,
              '系统初始化'
            ]
          );
        }
      } catch (promptError) {
        console.error(`  ✗ 处理提示词 "${prompt.prompt_name}" 时出错:`, promptError.message);
        if (promptError.code) {
          console.error(`    错误代码: ${promptError.code}`);
        }
        if (promptError.sqlMessage) {
          console.error(`    SQL错误: ${promptError.sqlMessage}`);
        }
        if (promptError.sqlState) {
          console.error(`    SQL状态: ${promptError.sqlState}`);
        }
        // 继续处理下一个提示词，不中断整个初始化过程
      }
    }

    if (createdCount > 0 || updatedCount > 0) {
      console.log(`✓ 提示词初始化完成：创建 ${createdCount} 个，更新 ${updatedCount} 个`);
    } else {
      console.log('✓ 所有提示词配置已存在且为最新版本');
    }
  } catch (error) {
    console.error('✗ 初始化提示词配置失败:', error.message);
    console.error('错误详情:', {
      name: error.name,
      code: error.code,
      sqlMessage: error.sqlMessage,
      sqlState: error.sqlState,
      errno: error.errno
    });
    if (error.stack) {
      console.error('错误堆栈:', error.stack);
    }
    // 不抛出错误，避免影响服务器启动
    console.warn('提示词初始化失败，但不影响服务器启动，可以稍后手动初始化');
  }
}

module.exports = { initPrompts };

