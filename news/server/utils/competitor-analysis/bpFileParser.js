/**
 * BP 文件解析模块
 * 1. MarkItDown 将上传的 BP 文件转换为 Markdown
 * 2. 保存 .md 副本并将文本写入数据库
 * 3. 通过 LLM 从 Markdown 中提取「产品介绍」和「企业标签」
 *    - 短文本（≤ SINGLE_CALL_THRESHOLD）单次调用
 *    - 长文本按标题分块 → 逐块提取 → 合并
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const {
  callDashScopeOpenAIChat,
  withFinancingAiConcurrency,
} = require('../project-sourcing/financingAiEnrichService');

// ── 常量 ──────────────────────────────────────────────
const MARKITDOWN_TIMEOUT_MS = 5 * 60 * 1000;           // MarkItDown 超时 5 分钟
const SINGLE_CALL_THRESHOLD = 12000;                    // 单次调用字符阈值
const CHUNK_MAX_CHARS = 8000;                           // 单块最大字符数
const CHUNK_OVERLAP = 500;                              // 分块重叠字符数

// ── 提取用 Prompt ────────────────────────────────────
const BP_EXTRACT_SYSTEM = `你是一个专业的商业文档分析助手。你的任务是从用户提供的商业计划书（BP）内容片段中，提取以下两项信息并以严格 JSON 格式输出：
1. product_intro：该企业的产品介绍，包括主要产品/服务、核心业务、技术优势等。请用一段完整的文字概括，200-500字。
2. tags：企业标签数组，包括所属行业、细分领域、技术方向、商业模式等关键词，5-15个。

输出格式（仅输出 JSON，不要额外文字）：
{"product_intro": "...", "tags": ["标签1", "标签2", ...]}`;

const BP_MERGE_SYSTEM = `你是一个专业的商业文档分析助手。你的任务是将多个从商业计划书不同段落中提取的信息片段，合并为一份完整、去重的结果。

输出格式（仅输出 JSON，不要额外文字）：
{"product_intro": "...", "tags": ["标签1", "标签2", ...]}

要求：
- product_intro：将各段的产品介绍合并为一段完整连贯的文字，去除重复信息，保留所有独特要点，300-800字。
- tags：合并所有标签，去重后保留5-20个最重要的标签。`;

// ── MarkItDown 转换 ─────────────────────────────────

/**
 * 调用 MarkItDown 将文件转换为 Markdown 文本。
 */
function convertToMarkdown(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', ['-m', 'markitdown', filePath], {
      timeout: MARKITDOWN_TIMEOUT_MS,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      reject(new Error(`MarkItDown 进程启动失败: ${err.message}`));
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`MarkItDown 退出码 ${code}: ${stderr.slice(0, 2000)}`));
      }
      const text = stdout.trim();
      if (!text) {
        return reject(new Error('MarkItDown 输出为空（文件可能无可提取文本）'));
      }
      resolve(text);
    });
  });
}

/**
 * 将 Markdown 文本保存为 .md 文件（与原始文件同目录、同名不同后缀）。
 */
function saveMarkdownFile(originalFilePath, markdownText) {
  const dir = path.dirname(originalFilePath);
  const ext = path.extname(originalFilePath);
  const baseName = path.basename(originalFilePath, ext);
  const mdPath = path.join(dir, `${baseName}.md`);
  fs.writeFileSync(mdPath, markdownText, 'utf-8');
  return mdPath;
}

// ── 模型配置解析 ─────────────────────────────────────

/**
 * 从数据库获取可用的 LLM 模型配置（复用项目挖掘的 application_type 兜底逻辑）。
 */
async function resolveBpModelConfig() {
  const rows = await db.query(
    `SELECT F_Id AS id, model_name, api_key, api_endpoint, temperature, max_tokens, top_p, enable_thinking
     FROM ai_model_config
     WHERE application_type = 'project_sourcing_analysis'
       AND is_active = 1 AND F_DeleteMark = 0
     ORDER BY F_CreatorTime DESC LIMIT 1`
  );
  if (rows.length && rows[0].api_key && rows[0].model_name) {
    return {
      llm_model_config_id: rows[0].id,
      config: {
        model_name: rows[0].model_name,
        api_key: rows[0].api_key,
        api_endpoint: rows[0].api_endpoint,
        temperature: rows[0].temperature,
        max_tokens: rows[0].max_tokens,
        top_p: rows[0].top_p,
        enable_thinking: rows[0].enable_thinking,
      },
    };
  }
  return { llm_model_config_id: null, config: null };
}

// ── JSON 解析工具 ────────────────────────────────────

/**
 * 从 LLM 返回文本中提取 JSON 对象。
 */
function extractJson(text) {
  if (!text) return null;
  let s = text.replace(/^\uFEFF/, '').trim();
  // 去除 markdown 代码围栏
  s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
}

/**
 * 从解析后的 JSON 中标准化提取 product_intro 和 tags。
 */
function normalizeExtract(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const intro = String(
    obj.product_intro || obj.ai_product_intro || obj.product_introduction || ''
  ).trim() || null;
  let tags = obj.tags || obj.company_tags || obj.ai_company_tags || obj.industry_tags || [];
  if (typeof tags === 'string') {
    tags = tags.split(/[,，、;；\n]+/).map((t) => String(t).trim()).filter(Boolean);
  }
  if (!Array.isArray(tags)) tags = [];
  tags = tags.map((t) => String(t).trim()).filter(Boolean);
  if (!intro && tags.length === 0) return null;
  return { product_intro: intro || '', tags };
}

// ── 分块逻辑 ─────────────────────────────────────────

/**
 * 将 Markdown 文本按标题分块。短文本直接返回单块。
 * @param {string} text
 * @returns {string[]}
 */
function chunkMarkdown(text) {
  if (!text || text.length <= SINGLE_CALL_THRESHOLD) {
    return [text];
  }

  // 按一级/二级标题切分
  const headingRe = /^(?=#{1,2}\s)/m;
  const sections = text.split(headingRe).filter((s) => s.trim().length > 0);

  const chunks = [];
  for (const section of sections) {
    if (section.length <= CHUNK_MAX_CHARS) {
      chunks.push(section);
    } else {
      // 超长段落二次切分，保留重叠
      let start = 0;
      while (start < section.length) {
        const end = Math.min(start + CHUNK_MAX_CHARS, section.length);
        chunks.push(section.slice(start, end));
        start = end - CHUNK_OVERLAP;
        if (start >= section.length || end >= section.length) break;
      }
    }
  }

  return chunks.length > 0 ? chunks : [text];
}

// ── LLM 调用 ─────────────────────────────────────────

/**
 * 对单个 chunk 调用 LLM 提取产品介绍和企业标签。
 */
async function extractChunk(chunkText, modelConfig) {
  const userPrompt = `请从以下商业计划书内容中提取产品介绍和企业标签：\n\n${chunkText}`;
  const result = await callDashScopeOpenAIChat(BP_EXTRACT_SYSTEM, userPrompt, modelConfig, {
    wantSearch: false,
    searchRequired: false,
  });
  const raw = result?.content || '';
  const parsed = extractJson(raw);
  return normalizeExtract(parsed);
}

/**
 * 将多个 chunk 的提取结果合并为一份完整结果。
 */
async function mergeChunkResults(extracts, modelConfig) {
  // 过滤空结果
  const valid = extracts.filter(Boolean);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  const summaries = valid.map((e, i) => {
    const intro = e.product_intro || '（无）';
    const tags = e.tags.length > 0 ? e.tags.join('、') : '（无）';
    return `【片段${i + 1}】\n产品介绍：${intro}\n企业标签：${tags}`;
  }).join('\n\n');

  const userPrompt = `以下是从商业计划书不同段落中分别提取的信息，请合并为一份完整、去重的结果：\n\n${summaries}`;
  const result = await callDashScopeOpenAIChat(BP_MERGE_SYSTEM, userPrompt, modelConfig, {
    wantSearch: false,
    searchRequired: false,
  });
  const raw = result?.content || '';
  const parsed = extractJson(raw);
  return normalizeExtract(parsed);
}

// ── 主提取流程 ───────────────────────────────────────

/**
 * 从 BP 的 Markdown 文本中提取产品介绍和企业标签。
 * 短文本单次调用，长文本分块提取后合并。
 *
 * @param {string} markdownText - MarkItDown 转换后的 Markdown 全文
 * @returns {Promise<{productIntro: string, tagsDisplay: string, tagsJson: string} | null>}
 */
async function extractBpContent(markdownText) {
  if (!markdownText || !markdownText.trim()) return null;

  // 获取模型配置
  const { config: modelConfig } = await resolveBpModelConfig();
  if (!modelConfig) {
    console.warn('[bpFileParser] 未找到可用的 AI 模型配置，跳过 BP 内容提取');
    return null;
  }

  const chunks = chunkMarkdown(markdownText);
  console.log(`[bpFileParser] BP 文本 ${markdownText.length} 字符，分为 ${chunks.length} 块处理`);

  if (chunks.length === 1) {
    // 短文本：单次调用
    const result = await withFinancingAiConcurrency(() => extractChunk(chunks[0], modelConfig));
    if (!result) return null;
    return formatExtractResult(result);
  }

  // 长文本：逐块提取（使用并发控制）
  const extracts = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const result = await withFinancingAiConcurrency(() => extractChunk(chunks[i], modelConfig));
      extracts.push(result);
    } catch (err) {
      console.warn(`[bpFileParser] 第 ${i + 1} 块提取失败: ${err.message}`);
      extracts.push(null);
    }
  }

  // 合并
  const merged = await withFinancingAiConcurrency(() => mergeChunkResults(extracts, modelConfig));
  if (!merged) return null;
  return formatExtractResult(merged);
}

/**
 * 格式化提取结果为写入数据库的最终格式。
 */
function formatExtractResult(result) {
  const productIntro = (result.product_intro || '').trim();
  const tags = Array.isArray(result.tags) ? result.tags : [];
  const tagsDisplay = tags.join('、');
  const tagsJson = JSON.stringify(tags);
  if (!productIntro && tags.length === 0) return null;
  return { productIntro, tagsDisplay, tagsJson };
}

// ── 文件处理 + 提取 + 写入 ───────────────────────────

/**
 * 处理已上传的 BP 文件：转换 → 保存 .md → 写入数据库。
 * 注意：LLM 提取（extractBpContent）由 AI 取数 pipeline 单独调用，
 *       以确保在企查查简介之后、AI 取数之前正确排序。
 *
 * @param {object} options
 * @param {string} options.absolutePath - 文件在磁盘上的绝对路径
 * @param {string} options.projectId - pre_investment_project 表记录 ID
 * @returns {Promise<{success: boolean, markdownText?: string, error?: string}>}
 */
async function processBpFile({ absolutePath, projectId }) {
  try {
    // 1. MarkItDown 转换
    const markdownText = await convertToMarkdown(absolutePath);

    // 2. 保存 .md 文件
    saveMarkdownFile(absolutePath, markdownText);

    // 3. 将 Markdown 全文写入数据库
    await db.execute(
      'UPDATE pre_investment_project SET bp_extract_text = ? WHERE F_Id = ?',
      [markdownText, projectId]
    );
    console.log(`[bpFileParser] Markdown 已保存: ${projectId}, ${markdownText.length} 字符`);

    return { success: true, markdownText };
  } catch (err) {
    const errMsg = err.message || String(err);
    console.warn(`[bpFileParser] BP 文件处理失败 (${projectId}): ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

/**
 * 从数据库读取 BP Markdown 文本，调用 LLM 提取产品介绍和企业标签，写入项目记录。
 * 在 AI 取数 pipeline 中调用（企查查简介之后、AI 取数之前）。
 * 内置轮询等待 MarkItDown 转换完成（最多等待 60 秒）。
 *
 * @param {string} projectId - pre_investment_project 表记录 ID
 * @returns {Promise<{success: boolean, extracted?: boolean, error?: string}>}
 */
async function extractBpForProject(projectId) {
  try {
    // 轮询等待 bp_extract_text 被 processBpFile 写入（MarkItDown 转换可能需要数秒）
    const POLL_INTERVAL = 2000;
    const POLL_MAX_WAIT = 60000;
    const start = Date.now();
    let markdownText = null;

    while (Date.now() - start < POLL_MAX_WAIT) {
      const rows = await db.query(
        'SELECT bp_filename, bp_extract_text FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0',
        [projectId]
      );
      if (!rows.length) {
        return { success: false, error: '项目不存在' };
      }
      // 无 BP 文件 → 无需提取
      if (!rows[0].bp_filename) {
        return { success: true, extracted: false };
      }
      // bp_extract_text 已就绪
      if (rows[0].bp_extract_text) {
        markdownText = rows[0].bp_extract_text;
        break;
      }
      // 等待后重试
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }

    if (!markdownText) {
      console.warn(`[bpFileParser] 等待 BP 文本超时 (${projectId})，MarkItDown 可能仍在处理`);
      return { success: true, extracted: false };
    }

    const extracted = await extractBpContent(markdownText);
    if (extracted) {
      await db.execute(
        `UPDATE pre_investment_project
         SET ai_product_intro = ?, ai_industry_tags_display = ?, ai_industry_tags_json = ?,
             ai_enrich_status = 'success', pipeline_status = 'ai_done'
         WHERE F_Id = ?`,
        [extracted.productIntro, extracted.tagsDisplay, extracted.tagsJson, projectId]
      );
      console.log(`[bpFileParser] BP 提取成功: ${projectId}`);
      return { success: true, extracted: true };
    }
    return { success: true, extracted: false };
  } catch (err) {
    const errMsg = err.message || String(err);
    console.warn(`[bpFileParser] BP 提取失败 (${projectId}): ${errMsg}`);
    return { success: false, error: errMsg };
  }
}

module.exports = {
  convertToMarkdown,
  saveMarkdownFile,
  processBpFile,
  extractBpContent,
  extractBpForProject,
  chunkMarkdown,
};
