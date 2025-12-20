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
   * 从URL抓取网页内容
   */
  async fetchContentFromUrl(url) {
    try {
      if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        console.warn(`[fetchContentFromUrl] 无效的URL: ${url}`);
        return null;
      }

      console.log(`[fetchContentFromUrl] 开始抓取网页内容: ${url}`);
      
      // 设置请求头，模拟浏览器访问
      const response = await axios.get(url, {
        timeout: 15000, // 15秒超时
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 500 // 允许3xx和4xx状态码，但不允许5xx
      });

      if (response.status !== 200) {
        console.warn(`[fetchContentFromUrl] HTTP状态码: ${response.status}, URL: ${url}`);
        return null;
      }

      const html = response.data;
      if (!html || typeof html !== 'string') {
        console.warn(`[fetchContentFromUrl] 返回内容不是HTML字符串, URL: ${url}`);
        return null;
      }

      // 智能提取正文内容
      console.log(`[fetchContentFromUrl] 开始提取正文内容，HTML长度: ${html.length}字符`);
      // 检查HTML中是否包含article标签（用于调试）
      const hasArticleTag = /<article[^>]*>/i.test(html);
      const hasMainNews = /main-news/i.test(html);
      const hasArticleWithHtml = /article-with-html/i.test(html);
      const isGelonghui = /gelonghui\.com/i.test(url);
      console.log(`[fetchContentFromUrl] HTML检查: hasArticleTag=${hasArticleTag}, hasMainNews=${hasMainNews}, hasArticleWithHtml=${hasArticleWithHtml}, isGelonghui=${isGelonghui}`);
      
      let text = this.extractArticleContent(html, url);
      console.log(`[fetchContentFromUrl] 提取完成，文本长度: ${text.length}字符`);

      // 如果提取的文本太短（少于50个字符），可能提取失败
      if (text.length < 50) {
        console.warn(`[fetchContentFromUrl] 提取的文本内容太短（${text.length}字符），可能提取失败, URL: ${url}`);
        console.warn(`[fetchContentFromUrl] 如果HTML中包含article标签但提取失败，可能是匹配规则需要调整`);
        
        // 对于格隆汇网站，尝试更宽松的提取策略
        if (isGelonghui) {
          console.log(`[fetchContentFromUrl] 格隆汇网站提取失败，尝试使用更宽松的提取策略`);
          // 尝试查找包含正文内容的div或其他容器
          const gelonghuiPatterns = [
            /<div[^>]*class="[^"]*news-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*article-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*content-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<section[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/section>/i
          ];
          
          for (const pattern of gelonghuiPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
              const extracted = match[1]
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              if (extracted.length > text.length) {
                text = extracted;
                console.log(`[fetchContentFromUrl] 使用格隆汇特殊模式提取，长度: ${text.length}字符`);
                break;
              }
            }
          }
        }
        
        // 如果仍然太短，尝试提取前5000个字符作为备用
        if (text.length < 50) {
          const fallbackText = html.substring(0, 5000)
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (fallbackText.length > text.length) {
            text = fallbackText;
          }
        }
      }

      if (text.length === 0) {
        console.warn(`[fetchContentFromUrl] 未能提取到文本内容, URL: ${url}`);
        return null;
      }

      // 限制最大长度为50000字符（避免内容过长）
      if (text.length > 50000) {
        text = text.substring(0, 50000) + '...[内容已截断]';
      }

      console.log(`[fetchContentFromUrl] ✓ 成功抓取网页内容，长度: ${text.length}字符`);
      return text;

    } catch (error) {
      console.error(`[fetchContentFromUrl] 抓取网页内容失败: ${error.message}, URL: ${url}`);
      if (error.response) {
        console.error(`[fetchContentFromUrl] HTTP状态码: ${error.response.status}`);
      }
      return null;
    }
  }

  /**
   * 从HTML中智能提取正文内容
   * @param {string} html - HTML内容
   * @param {string} url - 网页URL（可选，用于特殊处理）
   */
  extractArticleContent(html, url = '') {
    // 第一步：先提取article标签，避免在清理过程中被截断
    // 使用智能匹配函数查找完整的article标签（处理嵌套和script标签中的</article>）
    const findCompleteArticle = (html) => {
      // 查找所有包含main-news的article开始标签
      const articleStartRegex = /<article[^>]*class\s*=\s*["'][^"']*\bmain-news\b[^"']*["'][^>]*>/gi;
      const matches = [];
      let match;
      
      while ((match = articleStartRegex.exec(html)) !== null) {
        const startPos = match.index;
        const tagEnd = match.index + match[0].length;
        
        // 从开始标签后查找对应的结束标签（处理嵌套和script标签）
        let depth = 1;
        let pos = tagEnd;
        let endPos = -1;
        
        while (pos < html.length && depth > 0) {
          // 查找下一个<article或</article>
          const nextOpen = html.indexOf('<article', pos);
          const nextClose = html.indexOf('</article>', pos);
          
          if (nextClose === -1) {
            // 没有找到结束标签，使用HTML末尾
            endPos = html.length;
            break;
          }
          
          // 检查在</article>之前是否有<script>标签，如果有，跳过script标签内的</article>
          if (nextOpen !== -1 && nextOpen < nextClose) {
            // 检查这个<article是否在script标签内
            const scriptBeforeArticle = html.lastIndexOf('<script', nextOpen);
            const scriptAfterArticle = html.indexOf('</script>', nextOpen);
            if (scriptBeforeArticle !== -1 && scriptAfterArticle !== -1 && scriptAfterArticle > nextOpen) {
              // 这个<article在script标签内，跳过
              pos = scriptAfterArticle + 9;
              continue;
            }
            
            // 找到嵌套的article标签
            depth++;
            pos = nextOpen + 8;
          } else {
            // 检查这个</article>是否在script标签内
            const scriptBeforeClose = html.lastIndexOf('<script', nextClose);
            const scriptAfterClose = html.indexOf('</script>', nextClose);
            if (scriptBeforeClose !== -1 && scriptAfterClose !== -1 && scriptAfterClose > nextClose) {
              // 这个</article>在script标签内，跳过
              pos = scriptAfterClose + 9;
              continue;
            }
            
            // 找到结束标签
            depth--;
            if (depth === 0) {
              endPos = nextClose;
              break;
            }
            pos = nextClose + 11;
          }
        }
        
        if (endPos !== -1) {
          const content = html.substring(tagEnd, endPos);
          const textOnly = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          console.log(`[findCompleteArticle] 找到article内容，位置: ${tagEnd}-${endPos}, 文本长度: ${textOnly.length}字符`);
          
          // 检查内容是否包含不应该出现的标签（如footer、body、html等）
          const hasInvalidTags = /<\/?(?:footer|body|html|head)[\s>]/i.test(content);
          if (hasInvalidTags) {
            console.log(`[findCompleteArticle] ⚠️ 内容包含无效标签（footer/body/html/head），可能匹配到了错误的结束标签`);
            console.log(`[findCompleteArticle] 内容预览（后200字符）: ...${content.substring(Math.max(0, content.length - 200))}`);
            
            // 尝试查找更早的</article>标签
            let searchPos = tagEnd;
            let foundValidEnd = false;
            while (searchPos < endPos) {
              const earlierClose = html.indexOf('</article>', searchPos);
              if (earlierClose === -1 || earlierClose >= endPos) break;
              
              const earlierContent = html.substring(tagEnd, earlierClose);
              const earlierText = earlierContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              const earlierHasInvalidTags = /<\/?(?:footer|body|html|head)[\s>]/i.test(earlierContent);
              
              console.log(`[findCompleteArticle] 检查更早的结束标签，位置: ${tagEnd}-${earlierClose}, 文本长度: ${earlierText.length}字符, 包含无效标签: ${earlierHasInvalidTags}`);
              
              if (!earlierHasInvalidTags && earlierText.length >= textOnly.length * 0.5) {
                // 找到不包含无效标签的结束位置
                console.log(`[findCompleteArticle] ✓ 找到有效的结束标签，位置: ${tagEnd}-${earlierClose}, 文本长度: ${earlierText.length}字符`);
                matches.push({
                  content: earlierContent,
                  textLength: earlierText.length,
                  startPos: startPos,
                  endPos: earlierClose
                });
                foundValidEnd = true;
                break;
              }
              
              searchPos = earlierClose + 11;
            }
            
            if (!foundValidEnd) {
              console.log(`[findCompleteArticle] ⚠️ 未找到有效的结束标签，使用原始匹配`);
              matches.push({
                content: content,
                textLength: textOnly.length,
                startPos: startPos,
                endPos: endPos
              });
            }
          } else {
            // 内容不包含无效标签，直接使用
            matches.push({
              content: content,
              textLength: textOnly.length,
              startPos: startPos,
              endPos: endPos
            });
          }
        }
      }
      
      // 返回内容最长的匹配
      if (matches.length > 0) {
        matches.sort((a, b) => b.textLength - a.textLength);
        return matches[0].content;
      }
      return null;
    };
    
    // 先尝试从原始HTML中提取完整的article标签
    const extractedArticleContent = findCompleteArticle(html);
    if (extractedArticleContent) {
      const articleText = extractedArticleContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log(`[extractArticleContent] ✓ 从原始HTML中提取到article标签内容，长度: ${articleText.length}字符`);
      
      // 如果内容足够长（>500字符），直接使用并返回
      if (articleText.length > 500) {
        console.log(`[extractArticleContent] ✓ 使用原始HTML中的article标签内容，长度: ${articleText.length}字符`);
        // 清理article内容中的script、style等标签
        let cleanedContent = extractedArticleContent
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
          .replace(/<!--[\s\S]*?-->/g, '');
        
        // 清理后的内容就是最终结果，直接返回
        const finalText = cleanedContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        console.log(`[extractArticleContent] ✓ 清理后最终内容长度: ${finalText.length}字符`);
        console.log(`[extractArticleContent] ✓ 清理后HTML内容长度: ${cleanedContent.length}字符`);
        // 记录清理后内容的预览（前500字符和后500字符）
        const previewStart = cleanedContent.substring(0, 500);
        const previewEnd = cleanedContent.substring(Math.max(0, cleanedContent.length - 500));
        console.log(`[extractArticleContent] ✓ 清理后内容预览（前500字符）: ${previewStart}...`);
        console.log(`[extractArticleContent] ✓ 清理后内容预览（后500字符）: ...${previewEnd}`);
        return cleanedContent;
      }
    }
    
    // 第二步：移除script、style、noscript等标签及其内容（如果还没有提取article标签）
    const originalHtmlLength = html.length;
    let cleanedHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    
    console.log(`[extractArticleContent] HTML清理: 原始长度=${originalHtmlLength}字符，清理后长度=${cleanedHtml.length}字符`);
    
    // 检查清理后的HTML中是否包含完整的article标签
    // 注意：使用非贪婪匹配可能匹配到错误的结束标签，需要检查
    const articleTagMatch = cleanedHtml.match(/<article[^>]*class\s*=\s*["'][^"']*\bmain-news\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i);
    if (articleTagMatch) {
      const articleContent = articleTagMatch[1];
      const articleText = articleContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      console.log(`[extractArticleContent] 清理后HTML中article标签内容长度: ${articleText.length}字符`);
      console.log(`[extractArticleContent] 清理后HTML中article标签HTML长度: ${articleContent.length}字符`);
      // 检查是否有多个</article>标签
      const allArticleEnds = cleanedHtml.match(/<\/article>/gi);
      if (allArticleEnds) {
        console.log(`[extractArticleContent] 清理后HTML中找到 ${allArticleEnds.length} 个</article>标签`);
      }
      
      // 如果内容太短（少于800字符），可能是匹配到了错误的结束标签
      if (articleText.length < 800) {
        console.log(`[extractArticleContent] ⚠️ 清理后HTML中article标签内容较短（${articleText.length}字符），可能匹配到了错误的结束标签`);
        // 尝试查找所有匹配main-news的article标签
        const allMainNewsArticles = cleanedHtml.match(/<article[^>]*class\s*=\s*["'][^"']*\bmain-news\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi);
        if (allMainNewsArticles && allMainNewsArticles.length > 1) {
          console.log(`[extractArticleContent] 找到 ${allMainNewsArticles.length} 个main-news article标签，可能需要使用更长的匹配`);
        }
      }
    } else {
      console.log(`[extractArticleContent] ⚠️ 清理后HTML中未找到完整的article标签`);
    }

    // 辅助函数：智能匹配article标签（处理嵌套和重复）
    const findArticleContent = (html, classPattern) => {
      console.log(`[findArticleContent] 开始智能匹配，pattern: ${classPattern}`);
      console.log(`[findArticleContent] HTML长度: ${html.length}字符`);
      
      // 查找所有匹配class的article开始标签
      // 注意：classPattern可能包含转义字符，需要正确处理
      // 例如：\\bmain-news\\b[^"\']*\\barticle-with-html\\b 应该匹配 "main-news article-with-html"
      const escapedPattern = classPattern.replace(/\\b/g, '\\b'); // 确保单词边界正确
      const startTagRegex = new RegExp(`<article[^>]*class\\s*=\\s*["'][^"']*${escapedPattern}[^"']*["'][^>]*>`, 'gi');
      console.log(`[findArticleContent] 使用的正则表达式: ${startTagRegex.source}`);
      let match;
      const candidates = [];
      let matchCount = 0;
      
      while ((match = startTagRegex.exec(html)) !== null) {
        matchCount++;
        console.log(`[findArticleContent] 找到第 ${matchCount} 个匹配的article开始标签，位置: ${match.index}`);
        const startPos = match.index;
        const tagEnd = match.index + match[0].length;
        
        // 从开始标签后查找对应的结束标签（处理嵌套）
        let depth = 1;
        let pos = tagEnd;
        let endPos = -1;
        
        // 查找所有article开始和结束标签的位置
        // 注意：要从tagEnd开始查找，因为当前article标签的开始位置是startPos
        const articleStarts = [];
        const articleEnds = [];
        let searchPos = tagEnd; // 从当前article标签的结束位置开始查找
        
        // 先查找当前article标签之后的所有标签
        while (searchPos < html.length) {
          const nextOpen = html.indexOf('<article', searchPos);
          const nextClose = html.indexOf('</article>', searchPos);
          
          if (nextOpen === -1 && nextClose === -1) break;
          
          if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
            articleStarts.push(nextOpen);
            searchPos = nextOpen + 8;
          } else if (nextClose !== -1) {
            articleEnds.push(nextClose);
            searchPos = nextClose + 11;
          }
        }
        
        console.log(`[findArticleContent] 找到 ${articleStarts.length} 个后续article开始标签，${articleEnds.length} 个结束标签`);
        console.log(`[findArticleContent] 当前article开始位置: ${startPos}, 标签结束位置: ${tagEnd}, HTML总长度: ${html.length}`);
        
        // 如果没有找到结束标签，说明article标签可能没有正确关闭，尝试查找到HTML末尾
        if (articleEnds.length === 0) {
          console.log(`[findArticleContent] ⚠️ 未找到任何结束标签，尝试查找HTML中所有的</article>标签`);
          // 在整个HTML中查找所有</article>标签
          let allEnds = [];
          let searchAllPos = 0;
          while ((searchAllPos = html.indexOf('</article>', searchAllPos)) !== -1) {
            allEnds.push(searchAllPos);
            searchAllPos += 11;
          }
          console.log(`[findArticleContent] HTML中总共找到 ${allEnds.length} 个</article>标签`);
          if (allEnds.length > 0) {
            // 找到第一个在当前article标签之后的结束标签
            const firstEndAfterTag = allEnds.find(pos => pos > tagEnd);
            if (firstEndAfterTag) {
              articleEnds.push(firstEndAfterTag);
              console.log(`[findArticleContent] 找到当前article标签后的第一个结束标签，位置: ${firstEndAfterTag}`);
            } else {
              // 如果没有找到，使用最后一个结束标签
              articleEnds.push(allEnds[allEnds.length - 1]);
              console.log(`[findArticleContent] 使用最后一个结束标签，位置: ${allEnds[allEnds.length - 1]}`);
            }
          }
        }
        
        // 找到匹配当前开始标签的结束标签（处理嵌套）
        let currentDepth = 1;
        let startIdx = 0; // 当前开始标签在articleStarts中的索引（0表示当前标签）
        let endIdx = -1;
        
        for (let i = 0; i < articleEnds.length; i++) {
          // 检查在这个结束标签之前是否有新的开始标签
          while (startIdx < articleStarts.length && articleStarts[startIdx] < articleEnds[i]) {
            if (articleStarts[startIdx] > tagEnd) { // 排除当前开始标签
              currentDepth++;
              console.log(`[findArticleContent] 发现嵌套的article标签，depth=${currentDepth}`);
            }
            startIdx++;
          }
          
          // 如果depth为1，说明找到了匹配的结束标签
          if (currentDepth === 1) {
            endIdx = i;
            break;
          }
          
          // 遇到结束标签，depth减1
          currentDepth--;
        }
        
        if (endIdx !== -1) {
          endPos = articleEnds[endIdx];
          console.log(`[findArticleContent] 找到匹配的结束标签，位置: ${endPos}`);
        } else if (articleEnds.length > 0) {
          // 如果没有找到匹配的结束标签，使用最后一个结束标签
          endPos = articleEnds[articleEnds.length - 1];
          console.log(`[findArticleContent] ⚠️ 未找到匹配的结束标签，使用最后一个结束标签位置: ${endPos}`);
        } else {
          // 没有找到任何结束标签，使用HTML末尾
          endPos = html.length;
          console.log(`[findArticleContent] ⚠️ 未找到任何结束标签，使用HTML末尾: ${endPos}`);
        }
        
        // 验证提取的内容是否完整
        if (endPos !== -1) {
          const extractedContent = html.substring(tagEnd, endPos);
          const extractedText = extractedContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          // 检查内容是否以完整的句子结尾（应该以句号、问号或感叹号结尾）
          const lastChar = extractedText.charAt(extractedText.length - 1);
          if (!['。', '！', '？', '.', '!', '?'].includes(lastChar) && endPos < html.length - 100) {
            console.log(`[findArticleContent] ⚠️ 提取的内容可能不完整，最后字符: "${lastChar}", 结束位置: ${endPos}, HTML总长度: ${html.length}`);
            // 尝试查找下一个</article>标签
            const nextArticleEnd = html.indexOf('</article>', endPos + 11);
            if (nextArticleEnd !== -1) {
              const extendedContent = html.substring(tagEnd, nextArticleEnd);
              const extendedText = extendedContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              if (extendedText.length > extractedText.length) {
                console.log(`[findArticleContent] ✓ 找到更完整的内容，使用下一个结束标签，位置: ${nextArticleEnd}, 长度: ${extendedText.length}字符`);
                endPos = nextArticleEnd;
              }
            }
          }
        }
        
        if (endPos !== -1) {
          const content = html.substring(tagEnd, endPos);
          const textOnly = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          console.log(`[findArticleContent] 候选 ${matchCount}: 内容长度=${textOnly.length}字符, HTML内容长度=${content.length}字符, 位置=${startPos}-${endPos}`);
          console.log(`[findArticleContent] 候选 ${matchCount}: 内容预览（前200字符）: ${textOnly.substring(0, 200)}...`);
          console.log(`[findArticleContent] 候选 ${matchCount}: 内容预览（后200字符）: ...${textOnly.substring(Math.max(0, textOnly.length - 200))}`);
          candidates.push({
            content: content,
            textLength: textOnly.length,
            startPos: startPos,
            endPos: endPos + 11 // 包含结束标签
          });
        } else {
          console.log(`[findArticleContent] 候选 ${matchCount}: 未找到匹配的结束标签`);
        }
      }
      
      // 返回内容最长的匹配（如果有多个相同的article标签，选择最长的）
      if (candidates.length > 0) {
        candidates.sort((a, b) => b.textLength - a.textLength);
        const bestMatch = candidates[0];
        
        console.log(`[findArticleContent] 找到 ${candidates.length} 个匹配的article标签`);
        candidates.forEach((candidate, idx) => {
          console.log(`[findArticleContent] 候选 ${idx + 1}: 内容长度=${candidate.textLength}字符, 位置=${candidate.startPos}-${candidate.endPos}`);
        });
        
        // 如果最佳匹配的内容长度明显短于其他候选（可能是截断），尝试使用更长的
        if (candidates.length > 1 && bestMatch.textLength < candidates[1].textLength * 0.8) {
          console.log(`[findArticleContent] ⚠️ 发现多个article标签，最佳匹配可能不完整（${bestMatch.textLength}字符），使用最长的匹配（${candidates[0].textLength}字符）`);
          return candidates[0].content; // 已经排序，第一个就是最长的
        }
        
        // 如果最佳匹配的内容太短（少于500字符），但还有其他候选，尝试使用更长的
        // 注意：对于格隆汇等网站，完整文章通常超过500字符
        if (bestMatch.textLength < 500 && candidates.length > 1) {
          console.log(`[findArticleContent] ⚠️ 最佳匹配内容太短（${bestMatch.textLength}字符），使用更长的匹配（${candidates[0].textLength}字符）`);
          return candidates[0].content; // 已经排序，第一个就是最长的
        }
        
        // 如果只有一个候选但内容太短（少于500字符），可能是提取不完整
        if (candidates.length === 1 && bestMatch.textLength < 500) {
          console.log(`[findArticleContent] ⚠️ 单个article标签内容较短（${bestMatch.textLength}字符），可能提取不完整`);
          // 尝试重新提取：从开始位置到HTML结束，查找所有内容
          const fullContent = html.substring(bestMatch.startPos);
          const nextArticleClose = fullContent.indexOf('</article>', bestMatch.endPos - bestMatch.startPos);
          if (nextArticleClose !== -1) {
            const extendedContent = html.substring(bestMatch.startPos + bestMatch.endPos - bestMatch.startPos, bestMatch.startPos + nextArticleClose);
            const extendedText = extendedContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (extendedText.length > bestMatch.textLength) {
              console.log(`[findArticleContent] ✓ 找到更完整的内容，长度: ${extendedText.length}字符`);
              return extendedContent;
            }
          }
        }
        
        console.log(`[findArticleContent] ✓ 使用最佳匹配，内容长度: ${bestMatch.textLength}字符`);
        return bestMatch.content;
      }
      return null;
    };

    // 第二步：优先查找正文内容容器（按优先级排序）
    const articleSelectors = [
      // 最高优先级：企查查、格隆汇等网站的 article 标签，包含 main-news、article-with-html 等 class
      // 使用智能匹配函数处理嵌套
      { type: 'smart', pattern: '\\bmain-news\\b[^"\']*\\barticle-with-html\\b', priority: 1 },
      { type: 'smart', pattern: '\\barticle-with-html\\b[^"\']*\\bmain-news\\b', priority: 2 },
      { type: 'smart', pattern: '\\bmain-news\\b', priority: 3 },
      { type: 'smart', pattern: '\\barticle-with-html\\b', priority: 4 },
      // 格隆汇网站的特殊匹配（添加更多可能的类名）
      { type: 'regex', pattern: /<div[^>]*class="[^"]*news-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 4.5 },
      { type: 'regex', pattern: /<div[^>]*class="[^"]*article-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 4.6 },
      { type: 'regex', pattern: /<div[^>]*class="[^"]*content-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 4.7 },
      { type: 'regex', pattern: /<section[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/section>/i, priority: 4.8 },
      // 正则表达式匹配（作为备用）
      { type: 'regex', pattern: /<article[^>]*class\s*=\s*["'][^"']*\bmain-news\b[^"']*\barticle-with-html\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i, priority: 5 },
      { type: 'regex', pattern: /<article[^>]*class\s*=\s*["'][^"']*\barticle-with-html\b[^"']*\bmain-news\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i, priority: 6 },
      { type: 'regex', pattern: /<article[^>]*class\s*=\s*["'][^"']*\bmain-news\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i, priority: 7 },
      { type: 'regex', pattern: /<article[^>]*class\s*=\s*["'][^"']*\barticle-with-html\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i, priority: 8 },
      // 优先查找：article-txt-content、article-content、txt-content 等常见的正文容器class
      { type: 'regex', pattern: /<div[^>]*class="[^"]*article-txt-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 9 },
      { type: 'regex', pattern: /<div[^>]*class="[^"]*article-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 10 },
      { type: 'regex', pattern: /<div[^>]*class="[^"]*txt-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 11 },
      { type: 'regex', pattern: /<div[^>]*class="[^"]*article-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 12 },
      { type: 'regex', pattern: /<div[^>]*class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 13 },
      { type: 'regex', pattern: /<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 14 },
      { type: 'regex', pattern: /<div[^>]*id="[^"]*article-txt-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 15 },
      { type: 'regex', pattern: /<div[^>]*id="[^"]*article-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 16 },
      { type: 'regex', pattern: /<div[^>]*id="[^"]*txt-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 17 },
      // 其次查找：通用的article、main标签（放在后面，避免匹配到非正文的article）
      { type: 'regex', pattern: /<article[^>]*>([\s\S]*?)<\/article>/i, priority: 18 },
      { type: 'regex', pattern: /<main[^>]*>([\s\S]*?)<\/main>/i, priority: 19 },
      // 最后查找：其他可能的正文容器
      { type: 'regex', pattern: /<div[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 20 },
      { type: 'regex', pattern: /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 21 },
      { type: 'regex', pattern: /<div[^>]*id="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 22 },
      { type: 'regex', pattern: /<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 23 },
      { type: 'regex', pattern: /<div[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 24 },
      { type: 'regex', pattern: /<div[^>]*class="[^"]*entry[^"]*"[^>]*>([\s\S]*?)<\/div>/i, priority: 25 }
    ];

    let articleContent = null;
    let matchedSelector = null;
    
    // 先检查HTML中是否包含main-news或article-with-html（用于调试）
    const hasMainNewsInHtml = /main-news/i.test(cleanedHtml);
    const hasArticleWithHtmlInHtml = /article-with-html/i.test(cleanedHtml);
    const isGelonghui = /gelonghui\.com/i.test(url);
    console.log(`[extractArticleContent] HTML检查: hasMainNews=${hasMainNewsInHtml}, hasArticleWithHtml=${hasArticleWithHtmlInHtml}, isGelonghui=${isGelonghui}`);
    
    // 如果包含这些标记，尝试查找所有article标签（用于调试）
    if (hasMainNewsInHtml || hasArticleWithHtmlInHtml) {
      const allArticles = cleanedHtml.match(/<article[^>]*>/gi);
      if (allArticles) {
        console.log(`[extractArticleContent] 找到 ${allArticles.length} 个article标签`);
        allArticles.forEach((tag, idx) => {
          const classMatch = tag.match(/class\s*=\s*["']([^"']*)["']/i);
          if (classMatch) {
            console.log(`[extractArticleContent] Article ${idx + 1} class: "${classMatch[1]}"`);
          }
        });
      }
    }
    
    for (let i = 0; i < articleSelectors.length; i++) {
      const selector = articleSelectors[i];
      let content = null;
      let textOnly = '';
      
      if (selector.type === 'smart') {
        // 使用智能匹配函数
        console.log(`[extractArticleContent] 使用智能匹配（规则 ${i + 1}），pattern: ${selector.pattern}`);
        content = findArticleContent(cleanedHtml, selector.pattern);
        if (content) {
          textOnly = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          console.log(`[extractArticleContent] 智能匹配返回内容，长度: ${textOnly.length}字符`);
        } else {
          console.log(`[extractArticleContent] 智能匹配返回null，未找到匹配`);
        }
      } else if (selector.type === 'regex') {
        // 使用正则表达式匹配
        const match = cleanedHtml.match(selector.pattern);
        if (match && match[1]) {
          content = match[1];
          textOnly = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
      }
      
      if (content && textOnly) {
        // 检查提取的内容是否足够长
        // 对于格隆汇网站，使用更低的阈值
        const baseMinLength = (selector.priority <= 4) ? 100 : 200; // 前4个规则使用更低的阈值
        const gelonghuiMinLength = (selector.priority <= 4) ? 50 : 100; // 格隆汇网站使用更低的阈值
        const minLength = isGelonghui ? gelonghuiMinLength : baseMinLength;
        const actualMinLength = (selector.priority <= 4 && textOnly.length >= 50) ? 50 : minLength;
        
        console.log(`[extractArticleContent] 尝试匹配规则 ${i + 1}（优先级${selector.priority}），提取内容长度: ${textOnly.length}字符，最小要求: ${actualMinLength}字符`);
        
        if (textOnly.length >= actualMinLength) {
          articleContent = content;
          matchedSelector = i + 1;
          console.log(`[extractArticleContent] ✓ 找到正文容器（规则${matchedSelector}），长度: ${textOnly.length}字符`);
          // 如果是前4个规则（main-news匹配），记录更多信息
          if (selector.priority <= 4) {
            console.log(`[extractArticleContent] 匹配到企查查/格隆汇等网站的article标签（main-news/article-with-html）`);
            // 查找匹配到的article标签
            const articleStartMatch = cleanedHtml.match(new RegExp(`<article[^>]*class\\s*=\\s*["'][^"']*${selector.pattern.replace(/\\b/g, '')}[^"']*["'][^>]*>`, 'i'));
            if (articleStartMatch) {
              const articleTag = articleStartMatch[0];
              const classMatch = articleTag.match(/class\s*=\s*["']([^"']*)["']/i);
              if (classMatch) {
                console.log(`[extractArticleContent] 匹配到的article标签class: "${classMatch[1]}"`);
                console.log(`[extractArticleContent] 完整的article标签: ${articleTag.substring(0, 300)}${articleTag.length > 300 ? '...' : ''}`);
              }
            }
          }
          break;
        } else {
          console.log(`[extractArticleContent] ⚠️ 规则 ${i + 1} 匹配成功但内容太短（${textOnly.length}字符 < ${actualMinLength}字符），继续尝试下一个规则`);
        }
      } else {
        // 只在调试时输出前4个规则，避免日志过多
        if (selector.priority <= 4) {
          console.log(`[extractArticleContent] 规则 ${i + 1}（main-news匹配）未匹配到内容`);
        }
      }
    }
    
    if (!articleContent) {
      console.log(`[extractArticleContent] ⚠️ 所有匹配规则都未找到足够长的正文内容，将使用整个HTML`);
      // 如果HTML中包含main-news但未匹配，记录警告
      if (hasMainNewsInHtml || hasArticleWithHtmlInHtml) {
        console.warn(`[extractArticleContent] ⚠️ HTML中包含main-news或article-with-html，但未成功提取，可能需要检查匹配规则`);
        // 尝试直接查找包含main-news的article标签位置
        const mainNewsArticleMatch = cleanedHtml.match(/<article[^>]*class\s*=\s*["'][^"']*\bmain-news\b[^"']*["'][^>]*>/i);
        if (mainNewsArticleMatch) {
          console.warn(`[extractArticleContent] 找到包含main-news的article标签，但正则表达式未匹配到内容，可能需要调整匹配规则`);
          console.warn(`[extractArticleContent] article标签示例: ${mainNewsArticleMatch[0].substring(0, 200)}...`);
        }
      }
    }

    // 如果找到正文容器，使用它；否则使用整个HTML
    let contentHtml = articleContent || cleanedHtml;

    // 第三步：移除常见的导航、侧边栏、页脚等元素
    contentHtml = contentHtml
      // 移除导航栏
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      // 移除侧边栏
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<div[^>]*class="[^"]*sidebar[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/<div[^>]*id="[^"]*sidebar[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
      // 移除常见的导航相关class
      .replace(/<div[^>]*class="[^"]*(?:nav|menu|header|footer|topbar|bottombar)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
      // 移除表单元素（搜索框、登录框等）
      .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, '')
      .replace(/<input[^>]*>/gi, '')
      .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
      // 移除链接但保留文本（导航链接通常不是正文）
      .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, (match, text) => {
        // 如果链接文本很短（可能是导航），移除它
        const linkText = text.replace(/<[^>]+>/g, '').trim();
        if (linkText.length < 5) {
          return '';
        }
        return text;
      })
      // 移除常见的UI元素
      .replace(/<ul[^>]*class="[^"]*(?:nav|menu)[^"]*"[^>]*>[\s\S]*?<\/ul>/gi, '')
      .replace(/<div[^>]*class="[^"]*(?:search|login|register|user-info)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
    
    // 对于格隆汇网站，在HTML阶段就移除页脚内容
    if (isGelonghui) {
      console.log(`[extractArticleContent] 格隆汇网站：在HTML阶段移除页脚内容`);
      // 移除"实时快讯"相关的HTML块
      contentHtml = contentHtml.replace(/<[^>]*实时快讯[^>]*>[\s\S]*?/gi, '');
      // 移除"格隆汇APP下载"相关的HTML块
      contentHtml = contentHtml.replace(/<[^>]*格隆汇APP下载[^>]*>[\s\S]*?/gi, '');
      // 移除"关于格隆汇"相关的HTML块
      contentHtml = contentHtml.replace(/<[^>]*关于格隆汇[^>]*>[\s\S]*?/gi, '');
      // 移除"合作伙伴"相关的HTML块（仅在HTML末尾）
      const partnersMatch = contentHtml.match(/([\s\S]*)(<[^>]*合作伙伴[^>]*>[\s\S]*)/i);
      if (partnersMatch && partnersMatch[1].length < contentHtml.length * 0.7) {
        contentHtml = partnersMatch[1];
        console.log(`[extractArticleContent] 移除了格隆汇网站的"合作伙伴"HTML块`);
      }
      // 移除"声明未经授权"相关的HTML块
      contentHtml = contentHtml.replace(/<[^>]*声明未经授权[^>]*>[\s\S]*/gi, '');
      // 移除"违法与不良信息举报"相关的HTML块
      contentHtml = contentHtml.replace(/<[^>]*违法与不良信息举报[^>]*>[\s\S]*/gi, '');
      // 移除版权信息相关的HTML块
      contentHtml = contentHtml.replace(/<[^>]*©深圳格隆汇信息科技有限公司[^>]*>[\s\S]*/gi, '');
    }

    // 第四步：提取纯文本
    let text = contentHtml
      .replace(/<[^>]+>/g, ' ')
      // 解码HTML实体
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&hellip;/g, '…')
      .replace(/&ldquo;/g, '"')
      .replace(/&rdquo;/g, '"')
      .replace(/&lsquo;/g, '\'')
      .replace(/&rsquo;/g, '\'')
      // 移除多余的空白字符
      .replace(/\s+/g, ' ')
      .trim();

    // 第五步：移除格隆汇网站特有的页脚和无关内容（文本阶段再次清理，确保彻底移除）
    if (isGelonghui) {
      console.log(`[extractArticleContent] 格隆汇网站：在文本阶段再次清理页脚内容，原始长度: ${text.length}字符`);
      
      // 移除"实时快讯"及其后续内容（使用更宽松的匹配）
      const realtimeNewsPatterns = [
        /实时快讯[\s\S]*/i,
        /实时.*快讯[\s\S]*/i
      ];
      for (const pattern of realtimeNewsPatterns) {
        const beforeReplace = text;
        text = text.replace(pattern, '').trim();
        if (text !== beforeReplace) {
          console.log(`[extractArticleContent] 移除了格隆汇网站的"实时快讯"部分，清理后长度: ${text.length}字符`);
          break;
        }
      }
      
      // 移除"格隆汇APP下载"及其后续内容
      const appDownloadPatterns = [
        /格隆汇APP下载[\s\S]*/i,
        /格隆汇.*APP.*下载[\s\S]*/i
      ];
      for (const pattern of appDownloadPatterns) {
        const beforeReplace = text;
        text = text.replace(pattern, '').trim();
        if (text !== beforeReplace) {
          console.log(`[extractArticleContent] 移除了格隆汇网站的"格隆汇APP下载"部分，清理后长度: ${text.length}字符`);
          break;
        }
      }
      
      // 移除"关于格隆汇"及其后续内容
      const aboutPatterns = [
        /关于格隆汇[\s\S]*/i,
        /关于.*格隆汇[\s\S]*/i
      ];
      for (const pattern of aboutPatterns) {
        const beforeReplace = text;
        text = text.replace(pattern, '').trim();
        if (text !== beforeReplace) {
          console.log(`[extractArticleContent] 移除了格隆汇网站的"关于格隆汇"部分，清理后长度: ${text.length}字符`);
          break;
        }
      }
      
      // 移除"合作伙伴"及其后续内容（仅在文本的后30%部分出现时移除）
      const partnersIndex = text.indexOf('合作伙伴');
      if (partnersIndex !== -1 && partnersIndex > text.length * 0.7) {
        text = text.substring(0, partnersIndex).trim();
        console.log(`[extractArticleContent] 移除了格隆汇网站的"合作伙伴"部分，清理后长度: ${text.length}字符`);
      }
      
      // 移除"声明未经授权"及其后续内容
      const statementPatterns = [
        /声明未经授权[\s\S]*/i,
        /声明.*未经授权[\s\S]*/i
      ];
      for (const pattern of statementPatterns) {
        const beforeReplace = text;
        text = text.replace(pattern, '').trim();
        if (text !== beforeReplace) {
          console.log(`[extractArticleContent] 移除了格隆汇网站的"声明未经授权"部分，清理后长度: ${text.length}字符`);
          break;
        }
      }
      
      // 移除"违法与不良信息举报"及其后续内容
      const reportPatterns = [
        /违法与不良信息举报[\s\S]*/i,
        /违法.*不良信息.*举报[\s\S]*/i
      ];
      for (const pattern of reportPatterns) {
        const beforeReplace = text;
        text = text.replace(pattern, '').trim();
        if (text !== beforeReplace) {
          console.log(`[extractArticleContent] 移除了格隆汇网站的"违法与不良信息举报"部分，清理后长度: ${text.length}字符`);
          break;
        }
      }
      
      // 移除"©深圳格隆汇信息科技有限公司"及其后续内容
      const copyrightPatterns = [
        /©深圳格隆汇信息科技有限公司[\s\S]*/i,
        /©.*深圳.*格隆汇[\s\S]*/i,
        /深圳格隆汇信息科技有限公司[\s\S]*/i
      ];
      for (const pattern of copyrightPatterns) {
        const beforeReplace = text;
        text = text.replace(pattern, '').trim();
        if (text !== beforeReplace) {
          console.log(`[extractArticleContent] 移除了格隆汇网站的版权信息部分，清理后长度: ${text.length}字符`);
          break;
        }
      }
      
      // 移除"查看全部"、"查看更多"等链接文本
      text = text.replace(/查看全部[\s\S]*/i, '').trim();
      text = text.replace(/查看更多[\s\S]*/i, '').trim();
      
      console.log(`[extractArticleContent] 格隆汇网站清理完成，最终长度: ${text.length}字符`);
    }
    
    // 第五步：移除常见的导航文本模式
    const navigationPatterns = [
      // 常见的导航词汇（前后可能有空格或标点）
      /\b(搜索|热门搜索|搜索历史|首页|私信|消息|个人主页|我的文章|账号设置|退出|登录|注册|收藏|评论|点赞|分享|微信|微博|空间|关注|订阅|设置|帮助|关于|联系我们)\b/gi,
      // 重复的导航文本（如"搜索 搜索"）
      /(搜索\s*){2,}/gi,
      // 数字+操作（如"+1 收藏 0 评论 +1 点赞"）
      /[+\-]?\d+\s*(收藏|评论|点赞|分享|转发)/gi,
      // 常见的页面元素文本
      /(上一页|下一页|返回|顶部|底部|更多|展开|收起|收起全文|展开全文)/gi,
      // 移除"风闻"相关的导航文本（针对观察者网）
      /风闻\s*(搜索|热门搜索|搜索历史)/gi,
      // 移除常见的导航分隔符模式（如"搜索 热门搜索 搜索历史"）
      /(搜索|热门搜索|搜索历史|首页|私信|消息|个人主页|我的文章|账号设置|退出|登录|注册)\s+(搜索|热门搜索|搜索历史|首页|私信|消息|个人主页|我的文章|账号设置|退出|登录|注册)/gi
    ];

    for (const pattern of navigationPatterns) {
      text = text.replace(pattern, '');
    }

    // 第六步：移除文本开头的导航模式（通常在正文前出现）
    // 匹配模式：标题 + 下划线 + 导航词汇序列
    const leadingNavPatterns = [
      // 匹配：标题_风闻 搜索 热门搜索...（观察者网模式）
      /^[^。！？\n]+_风闻\s+(搜索|热门搜索|搜索历史|首页|私信|消息|个人主页|我的文章|账号设置|退出|登录|注册|收藏|评论|点赞|分享|微信|微博|空间)[\s\S]{0,500}?(?=\d{1,2}\s*[天小时分钟]|昨天|今天|在|而|由于|当前|随着|值得|制造|键合|量检测)/i,
      // 匹配：导航词汇序列（至少3个导航词连续出现）
      /^(\s*(搜索|热门搜索|搜索历史|首页|私信|消息|个人主页|我的文章|账号设置|退出|登录|注册|收藏|评论|点赞|分享|微信|微博|空间|风闻)\s*[_\s\-|/]*\s*){3,}/i,
      // 匹配：标题重复出现（如"国产半导体设备，大举进军HBM"出现两次）
      /^([^。！？\n]+?)(\s+[\s\S]{0,200}?)\1\s+/i
    ];

    for (const pattern of leadingNavPatterns) {
      const beforeReplace = text;
      text = text.replace(pattern, '').trim();
      if (text !== beforeReplace) {
        console.log(`[extractArticleContent] 移除了开头的导航模式`);
      }
    }

    // 第七步：移除文本中重复出现的导航序列
    // 匹配：导航词汇 + 数字操作（如"+1 收藏 0 评论 +1 点赞"）
    text = text.replace(/[+\-]?\d+\s*(收藏|评论|点赞|分享|转发)\s*\d+\s*(收藏|评论|点赞|分享|转发)/gi, '');
    
    // 移除：标题 + 导航词汇 + 重复标题的模式
    const titleNavPattern = /([^。！？\n]{10,50}?)\s+(搜索|热门搜索|搜索历史|首页|私信|消息|个人主页|我的文章|账号设置|退出|登录|注册|收藏|评论|点赞|分享|微信|微博|空间|风闻|半导体产业纵横|探索IC产业无限可能)[\s\S]{0,300}?\1/gi;
    text = text.replace(titleNavPattern, '$1');

    // 第八步：清理多余的空白和标点
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\s*[。！？]\s*[。！？]+/g, '。') // 移除重复的标点
      .replace(/^\s*[，。！？、]\s*/g, '') // 移除开头的标点
      .trim();

    // 第七步：对于格隆汇网站，如果文本太短，尝试更精确的提取
    if (isGelonghui && text.length < 200) {
      console.warn(`[extractArticleContent] 格隆汇网站提取的文本太短（${text.length}字符），尝试更精确的提取`);
      // 尝试直接从article标签中提取，但移除页脚内容
      if (articleContent) {
        let refinedText = articleContent
          .replace(/<[^>]*实时快讯[^>]*>[\s\S]*?/gi, '')
          .replace(/<[^>]*格隆汇APP[^>]*>[\s\S]*?/gi, '')
          .replace(/<[^>]*关于格隆汇[^>]*>[\s\S]*?/gi, '')
          .replace(/<[^>]*合作伙伴[^>]*>[\s\S]*?/gi, '')
          .replace(/<[^>]*声明未经授权[^>]*>[\s\S]*?/gi, '')
          .replace(/<[^>]*违法与不良信息[^>]*>[\s\S]*?/gi, '')
          .replace(/<[^>]*©深圳格隆汇[^>]*>[\s\S]*?/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // 再次清理文本中的页脚内容
        refinedText = refinedText.replace(/实时快讯[\s\S]*/i, '').trim();
        refinedText = refinedText.replace(/格隆汇APP下载[\s\S]*/i, '').trim();
        refinedText = refinedText.replace(/关于格隆汇[\s\S]*/i, '').trim();
        refinedText = refinedText.replace(/声明未经授权[\s\S]*/i, '').trim();
        refinedText = refinedText.replace(/违法与不良信息举报[\s\S]*/i, '').trim();
        refinedText = refinedText.replace(/©深圳格隆汇信息科技有限公司[\s\S]*/i, '').trim();
        
        if (refinedText.length > text.length) {
          text = refinedText;
          console.log(`[extractArticleContent] 使用精炼后的文本，长度: ${text.length}字符`);
        }
      }
    }
    
    // 第八步：如果文本太短，尝试从整个HTML提取（作为备用）
    if (text.length < 100) {
      console.warn(`[extractArticleContent] 提取的文本太短（${text.length}字符），尝试备用方法`);
      // 备用方法：从body标签中提取，但移除更多无关元素
      const bodyMatch = cleanedHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch && bodyMatch[1]) {
        let fallbackText = bodyMatch[1]
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (fallbackText.length > text.length) {
          text = fallbackText;
        }
      }
    }
    
    // 最终检查：确保文本长度足够
    if (text.length < 50) {
      console.warn(`[extractArticleContent] ⚠️ 最终提取的文本太短（${text.length}字符），可能提取失败`);
    } else {
      console.log(`[extractArticleContent] ✓ 最终提取的文本长度: ${text.length}字符`);
      // 输出文本预览（前200字符和后100字符）
      if (text.length > 300) {
        console.log(`[extractArticleContent] 文本预览（前200字符）: ${text.substring(0, 200)}...`);
        console.log(`[extractArticleContent] 文本预览（后100字符）: ...${text.substring(text.length - 100)}`);
      } else {
        console.log(`[extractArticleContent] 文本预览: ${text}`);
      }
    }

    return text;
  }

  /**
   * 循环清理脏信息，直到内容干净为止
   */
  cleanDirtyContent(text, maxIterations = 10) {
    if (!text || text.trim() === '') {
      return text;
    }

    let cleanedText = text;
    let previousLength = cleanedText.length;
    let iteration = 0;

    // 定义脏信息模式
    const dirtyPatterns = [
      // JavaScript代码和网页模板代码（优先清理）
      /<script[^>]*>[\s\S]*?<\/script>/gi,
      /document\.title\s*=\s*['"][^'"]*['"]/gi,
      /var\s+PAGE_MID\s*=\s*['"][^'"]*['"]/gi,
      /setTimeout\s*\([^)]*\)/gi,
      /function\s*\(\)\s*\{[^}]*\}/gi,
      /title\s*===\s*['"][^'"]*['"]/gi,
      /document\.title\s*=/gi,
      /PAGE_MID\s*=/gi,
      /mmbizwap[^;]*/gi,
      /secitptpage[^;]*/gi,
      /verify\.html[^;]*/gi,
      /微信公众号平台[^;]*/gi,
      /body\s*,/gi,
      // 导航词汇
      /\b(搜索|热门搜索|搜索历史|首页|私信|消息|个人主页|我的文章|账号设置|退出|登录|注册|收藏|评论|点赞|分享|微信|微博|空间|关注|订阅|设置|帮助|关于|联系我们)\b/gi,
      // 重复的导航文本
      /(搜索\s*){2,}/gi,
      // 数字+操作
      /[+\-]?\d+\s*(收藏|评论|点赞|分享|转发)/gi,
      // 页面元素文本
      /(上一页|下一页|返回|顶部|底部|更多|展开|收起|收起全文|展开全文|点击展开全文|打开.*APP|阅读体验更佳)/gi,
      // 风闻相关
      /风闻\s*(搜索|热门搜索|搜索历史)/gi,
      // 标题_风闻模式
      /^[^。！？\n]+_风闻\s+(搜索|热门搜索|搜索历史|首页|私信|消息|个人主页|我的文章|账号设置|退出|登录|注册|收藏|评论|点赞|分享|微信|微博|空间)[\s\S]{0,500}?(?=\d{1,2}\s*[天小时分钟]|昨天|今天|在|而|由于|当前|随着|值得|制造|键合|量检测)/i,
      // 导航词汇序列（至少3个连续）
      /^(\s*(搜索|热门搜索|搜索历史|首页|私信|消息|个人主页|我的文章|账号设置|退出|登录|注册|收藏|评论|点赞|分享|微信|微博|空间|风闻)\s*[_\s\-|/]*\s*){3,}/i,
      // 标题重复出现
      /^([^。！？\n]+?)(\s+[\s\S]{0,200}?)\1\s+/i,
      // 数字+操作序列
      /[+\-]?\d+\s*(收藏|评论|点赞|分享|转发)\s*\d+\s*(收藏|评论|点赞|分享|转发)/gi,
      // 标题+导航+重复标题
      /([^。！？\n]{10,50}?)\s+(搜索|热门搜索|搜索历史|首页|私信|消息|个人主页|我的文章|账号设置|退出|登录|注册|收藏|评论|点赞|分享|微信|微博|空间|风闻|半导体产业纵横|探索IC产业无限可能)[\s\S]{0,300}?\1/gi,
      // 常见的页脚信息
      /(科技\s*举报|点击展开全文|打开.*APP.*阅读体验更佳|分享到：|收藏\s*\d+|点赞\s*\d+|更多好问|最新提问|邀您参与问答|等\d+人\s*已参与问答|热点\s*\d+|站务|观察者网评论|请你来预测|风闻社区小助手|最近更新的专栏|查看全部|联系我们|关于我们|版权声明|服务条款|刊登广告|联系微博|加入我们|网站地图|举报制度规范|网站自律管理承诺书|Copyright[\s\S]{0,100}?All rights reserved|沪ICP备[\s\S]{0,50}?互联网新闻信息服务许可证[\s\S]{0,50}?违法及不良信息举报电话)/gi,
      // 作者信息模式
      /(半导体产业纵横|探索IC产业无限可能)[\s\S]{0,50}?\|\s*\d+篇文章[\s\S]{0,50}?\d+人关注[\s\S]{0,50}?\+关注/gi,
      // 相关文章推荐
      /(查看全部>>|作者文章|相关文章|推荐阅读|热门文章|最新文章)/gi,
      // 格隆汇网站特有的页脚内容
      /实时快讯[\s\S]*/gi,
      /格隆汇APP下载[\s\S]*/gi,
      /关于格隆汇[\s\S]*/gi,
      /声明未经授权[\s\S]*/gi,
      /违法与不良信息举报[\s\S]*/gi,
      /©深圳格隆汇信息科技有限公司[\s\S]*/gi,
      /深圳格隆汇信息科技有限公司[\s\S]*/gi,
      /合作伙伴[\s\S]*/gi,
      /查看全部[\s\S]*/gi,
      /查看更多[\s\S]*/gi
    ];

    // 循环清理，直到没有变化或达到最大迭代次数
    while (iteration < maxIterations) {
      iteration++;
      const beforeClean = cleanedText;

      // 应用所有清理模式
      for (const pattern of dirtyPatterns) {
        cleanedText = cleanedText.replace(pattern, '');
      }

      // 清理多余的空白和标点
      cleanedText = cleanedText
        .replace(/\s+/g, ' ')
        .replace(/\s*[。！？]\s*[。！？]+/g, '。')
        .replace(/^\s*[，。！？、]\s*/g, '')
        .trim();

      // 如果内容没有变化，说明已经清理干净
      if (cleanedText.length === beforeClean.length && cleanedText === beforeClean) {
        console.log(`[cleanDirtyContent] 经过${iteration}次迭代，内容已清理干净`);
        break;
      }

      // 如果内容变得太短，停止清理
      if (cleanedText.length < 100 && previousLength > 200) {
        console.warn(`[cleanDirtyContent] 内容清理后变得太短，停止清理`);
        break;
      }

      previousLength = cleanedText.length;
    }

    if (iteration >= maxIterations) {
      console.warn(`[cleanDirtyContent] 达到最大迭代次数(${maxIterations})，停止清理`);
    }

    return cleanedText;
  }

  /**
   * 检查内容是否包含导航信息（需要重新抓取）
   */
  isContentContaminated(content) {
    if (!content || content.trim() === '') {
      return false;
    }

    // 检查是否包含JavaScript代码或网页模板代码（这些通常是错误的内容提取）
    const jsPatterns = [
      /document\.title\s*=/i,
      /var\s+PAGE_MID/i,
      /mmbizwap/i,
      /secitptpage/i,
      /verify\.html/i,
      /微信公众号平台/i,
      /setTimeout\s*\(/i,
      /function\s*\(\)\s*\{/i,
      /<script[^>]*>/i,
      /<\/script>/i,
      /body\s*,/i,
      /title\s*===/i,
      /document\.title\s*=\s*['"]/i,
      /PAGE_MID\s*=/i,
      /noMobile\s*&&/i,
      /=>\s*\{/i
    ];
    
    // 检查是否包含CSS样式代码（这些通常是错误的内容提取）
    const cssPatterns = [
      /\.wx-root/i,
      /--weui-/i,
      /@media\s*\(prefers-color-scheme/i,
      /data-weui-theme/i,
      /rgba\s*\(/i,
      /#[0-9a-f]{3,6}/i, // CSS颜色代码
      /:\s*#[0-9a-f]{3,6}/i, // CSS属性值中的颜色
      /:\s*rgba\s*\(/i, // CSS属性值中的rgba
      /:\s*#[a-f0-9]{3,6}\s*;/i // CSS属性值
    ];
    
    // 如果内容主要是JavaScript代码或网页模板代码，认为内容被污染
    const jsPatternCount = jsPatterns.filter(pattern => pattern.test(content)).length;
    const cssPatternCount = cssPatterns.filter(pattern => pattern.test(content)).length;
    
    // 如果包含2个或以上JavaScript模式，或1个JavaScript模式+1个CSS模式，认为内容被污染
    if (jsPatternCount >= 2 || (jsPatternCount >= 1 && cssPatternCount >= 1)) {
      console.log(`[isContentContaminated] 检测到JavaScript代码或CSS样式代码（JS: ${jsPatternCount}, CSS: ${cssPatternCount}），需要重新抓取`);
      return true;
    }
    
    // 如果包含大量CSS样式代码（3个或以上），认为内容被污染
    if (cssPatternCount >= 3) {
      console.log(`[isContentContaminated] 检测到大量CSS样式代码（${cssPatternCount}个模式），需要重新抓取`);
      return true;
    }
    
    // 如果包含JavaScript代码且长度较短（少于200字符），可能是错误提取
    if (jsPatternCount >= 1 && content.trim().length < 200) {
      console.log(`[isContentContaminated] 检测到JavaScript代码且内容较短，需要重新抓取`);
      return true;
    }

    // 检查是否包含大量导航词汇
    const navKeywords = ['搜索', '热门搜索', '搜索历史', '首页', '私信', '消息', '个人主页', '我的文章', '账号设置', '退出', '登录/注册', '收藏', '评论', '点赞', '分享', '微信', '微博', '空间', '风闻'];
    let navCount = 0;
    for (const keyword of navKeywords) {
      if (content.includes(keyword)) {
        navCount++;
      }
    }

    // 如果包含5个或以上导航关键词，认为内容被污染
    if (navCount >= 5) {
      console.log(`[isContentContaminated] 检测到内容包含${navCount}个导航关键词，需要重新抓取`);
      return true;
    }

    // 检查是否包含"数字+操作"模式（如"+1 收藏 0 评论"）
    if (/[+\-]?\d+\s*(收藏|评论|点赞|分享)/i.test(content)) {
      console.log(`[isContentContaminated] 检测到内容包含"数字+操作"模式，需要重新抓取`);
      return true;
    }

    // 检查文本开头是否包含导航模式
    const leadingNavCheck = /^[^。！？\n]+_[风闻]\s+(搜索|热门搜索)/i.test(content);
    if (leadingNavCheck) {
      console.log(`[isContentContaminated] 检测到内容开头包含导航模式，需要重新抓取`);
      return true;
    }

    return false;
  }

  /**
   * 确保新闻有内容（如果content为空但有source_url，则从URL抓取）
   * 如果content包含导航信息，会清理或重新抓取
   * @param {Object} newsItem - 新闻对象
   * @param {boolean} forceRefetch - 是否强制重新抓取（即使content不为空）
   */
  async ensureNewsContent(newsItem, forceRefetch = false) {
    // 检查现有content是否有效
    const hasValidContent = newsItem.content && 
                            newsItem.content.trim() !== '' && 
                            newsItem.content.length > 50 &&
                            !newsItem.content.includes('无法提取正文内容') &&
                            !newsItem.content.includes('正文无文字');
    
    // 检查content是否包含JavaScript/CSS代码（这是乱码的标志）
    const isContentContaminated = this.isContentContaminated(newsItem.content || '');
    
    // 对于新榜接口的新闻，如果content已经存在且有效，不应该强制重新抓取
    // 只有在content为空、无效或包含乱码时，才应该从URL抓取
    const interfaceType = newsItem.APItype || '新榜';
    const isXinbang = (interfaceType === '新榜' || interfaceType === '新榜接口');
    
    // 如果强制重新抓取，或者content无效，则重新抓取
    // 但对于新榜接口，如果content有效且不包含乱码，不应该强制重新抓取
    const shouldRefetch = forceRefetch && !(isXinbang && hasValidContent && !isContentContaminated) || 
                          !hasValidContent || 
                          isContentContaminated;
    
    if (shouldRefetch) {
      if (newsItem.source_url && newsItem.source_url.trim() !== '') {
        const refetchReason = isContentContaminated ? 'content包含乱码' : 
                             (forceRefetch ? '强制重新抓取' : 'content无效');
        console.log(`[ensureNewsContent] 新闻ID ${newsItem.id} ${refetchReason}，尝试从source_url抓取内容`);
        console.log(`[ensureNewsContent] 接口类型: ${interfaceType}, 是否新榜接口: ${isXinbang}`);
        
        // 先尝试常规提取
        let fetchedContent = await this.fetchContentFromUrl(newsItem.source_url);
        
        // 如果常规提取失败或内容太短，尝试使用AI提取（仅对格隆汇等网站）
        const isGelonghui = /gelonghui\.com/i.test(newsItem.source_url);
        // 检查提取的内容是否包含太多无关信息（如"实时快讯"、"格隆汇APP下载"等）
        const hasUnwantedContent = fetchedContent && (
          fetchedContent.includes('实时快讯') ||
          fetchedContent.includes('格隆汇APP下载') ||
          fetchedContent.includes('关于格隆汇') ||
          fetchedContent.includes('声明未经授权') ||
          fetchedContent.includes('违法与不良信息举报') ||
          fetchedContent.includes('©深圳格隆汇信息科技有限公司')
        );
        
        if ((!fetchedContent || fetchedContent.length < 200 || hasUnwantedContent) && isGelonghui) {
          console.log(`[ensureNewsContent] 常规提取失败或包含无关内容（长度: ${fetchedContent ? fetchedContent.length : 0}字符，包含无关内容: ${hasUnwantedContent}），尝试使用AI提取（格隆汇网站）`);
          try {
            const WebContentExtractor = require('./webContentExtractor');
            const extractor = new WebContentExtractor();
            const aiResult = await extractor.extractFromUrl(newsItem.source_url, newsItem.title);
            if (aiResult && aiResult.content && aiResult.content.length > 100) {
              // 清理AI提取的内容中的页脚信息
              let cleanedAiContent = aiResult.content;
              cleanedAiContent = cleanedAiContent.replace(/实时快讯[\s\S]*/i, '').trim();
              cleanedAiContent = cleanedAiContent.replace(/格隆汇APP下载[\s\S]*/i, '').trim();
              cleanedAiContent = cleanedAiContent.replace(/关于格隆汇[\s\S]*/i, '').trim();
              cleanedAiContent = cleanedAiContent.replace(/声明未经授权[\s\S]*/i, '').trim();
              cleanedAiContent = cleanedAiContent.replace(/违法与不良信息举报[\s\S]*/i, '').trim();
              cleanedAiContent = cleanedAiContent.replace(/©深圳格隆汇信息科技有限公司[\s\S]*/i, '').trim();
              
              if (cleanedAiContent.length > 100) {
                fetchedContent = cleanedAiContent;
                console.log(`[ensureNewsContent] ✓ AI提取成功并清理，长度: ${fetchedContent.length}字符`);
              } else {
                console.warn(`[ensureNewsContent] AI提取的内容清理后太短（${cleanedAiContent.length}字符），使用原始AI提取结果`);
                fetchedContent = aiResult.content;
              }
            }
          } catch (aiError) {
            console.warn(`[ensureNewsContent] AI提取失败: ${aiError.message}，继续使用常规提取结果`);
          }
        }
        
        if (fetchedContent && fetchedContent.length > 50) {
          // 清理脏信息
          console.log(`[ensureNewsContent] 开始清理抓取到的内容，原始长度: ${fetchedContent.length}字符`);
          const cleanedContent = this.cleanDirtyContent(fetchedContent);
          console.log(`[ensureNewsContent] 清理完成，清理后长度: ${cleanedContent.length}字符`);
          
          // 检查清理后的内容是否仍然被污染
          if (this.isContentContaminated(cleanedContent)) {
            console.warn(`[ensureNewsContent] 清理后的内容仍然包含脏信息，但继续使用清理后的版本`);
          }
          
          // 将清理后的内容更新到数据库
          try {
            await db.execute(
              'UPDATE news_detail SET content = ? WHERE id = ?',
              [cleanedContent, newsItem.id]
            );
            console.log(`[ensureNewsContent] ✓ 已将清理后的内容更新到数据库，新闻ID: ${newsItem.id}`);
            // 更新newsItem对象，以便后续使用
            newsItem.content = cleanedContent;
            return cleanedContent;
          } catch (error) {
            console.error(`[ensureNewsContent] 更新数据库失败: ${error.message}`);
            // 即使更新失败，也返回清理后的内容供本次分析使用
            return cleanedContent;
          }
        } else {
          console.warn(`[ensureNewsContent] 无法从source_url抓取有效内容，新闻ID: ${newsItem.id}, URL: ${newsItem.source_url}`);
          return null;
        }
      }
    }
    
    // 检查现有content是否被污染（包含导航信息）
    if (newsItem.content && newsItem.content.trim() !== '') {
      if (this.isContentContaminated(newsItem.content)) {
        console.log(`[ensureNewsContent] 新闻ID ${newsItem.id} 的content包含脏信息，开始清理`);
        
        // 先尝试清理现有内容
        const cleanedContent = this.cleanDirtyContent(newsItem.content);
        console.log(`[ensureNewsContent] 清理完成，原始长度: ${newsItem.content.length}字符，清理后长度: ${cleanedContent.length}字符`);
        
        // 检查清理后是否仍然被污染
        if (this.isContentContaminated(cleanedContent)) {
          console.log(`[ensureNewsContent] 清理后仍然包含脏信息，尝试重新抓取`);
          // 如果有source_url，重新抓取
          if (newsItem.source_url && newsItem.source_url.trim() !== '') {
            return await this.ensureNewsContent(newsItem, true); // 递归调用，强制重新抓取
          } else {
            // 没有source_url，使用清理后的版本
            console.log(`[ensureNewsContent] 没有source_url，使用清理后的版本`);
            newsItem.content = cleanedContent;
            // 更新数据库
            try {
              await db.execute('UPDATE news_detail SET content = ? WHERE id = ?', [cleanedContent, newsItem.id]);
            } catch (error) {
              console.error(`[ensureNewsContent] 更新数据库失败: ${error.message}`);
            }
            return cleanedContent;
          }
        } else {
          // 清理成功，使用清理后的内容
          console.log(`[ensureNewsContent] ✓ 内容已清理干净`);
          newsItem.content = cleanedContent;
          // 更新数据库
          try {
            await db.execute('UPDATE news_detail SET content = ? WHERE id = ?', [cleanedContent, newsItem.id]);
            console.log(`[ensureNewsContent] ✓ 已将清理后的内容更新到数据库`);
          } catch (error) {
            console.error(`[ensureNewsContent] 更新数据库失败: ${error.message}`);
          }
          return cleanedContent;
        }
      } else {
        // content正常，直接返回
        return newsItem.content;
      }
    }

    // content为空且没有source_url，或抓取失败
    console.warn(`[ensureNewsContent] 新闻ID ${newsItem.id} 的content为空且无法抓取，标题: ${newsItem.title}`);
    return null;
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
        temperature: typeof config.temperature === 'string' ? parseFloat(config.temperature) : config.temperature,
        max_tokens: typeof config.max_tokens === 'string' ? parseInt(config.max_tokens, 10) : config.max_tokens,
        top_p: typeof config.top_p === 'string' ? parseFloat(config.top_p) : config.top_p
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
      temperature: typeof config.temperature === 'string' ? parseFloat(config.temperature) : config.temperature,
      max_tokens: typeof config.max_tokens === 'string' ? parseInt(config.max_tokens, 10) : config.max_tokens,
      top_p: typeof config.top_p === 'string' ? parseFloat(config.top_p) : config.top_p
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
   * 获取提示词配置（包含关联的AI模型配置）
   * 支持多条配置，返回所有匹配的配置（按创建时间倒序），调用方可以选择使用哪一个
   */
  async getPrompt(interfaceType, promptType) {
    try {
      // 从数据库获取所有匹配的提示词配置（不限制数量）
      const prompts = await db.query(
        `SELECT 
          p.*, 
          m.id as ai_model_config_id_full,
          m.config_name, m.provider, m.model_name, m.api_type, 
          m.api_key, m.api_endpoint, m.temperature, m.max_tokens, m.top_p
         FROM ai_prompt_config p
         LEFT JOIN ai_model_config m ON p.ai_model_config_id = m.id AND m.is_active = 1 AND m.delete_mark = 0
         WHERE p.interface_type = ? 
         AND p.prompt_type = ? 
         AND p.is_active = 1 
         AND p.delete_mark = 0 
         ORDER BY p.created_at DESC`,
        [interfaceType, promptType]
      );

      if (prompts.length > 0) {
        // 记录找到的配置数量
        if (prompts.length === 1) {
          console.log(`✓ 找到 1 条匹配的提示词配置：${interfaceType} - ${promptType} (ID: ${prompts[0].id}, 名称: ${prompts[0].prompt_name || '未命名'})`);
        } else {
          console.log(`✓ 找到 ${prompts.length} 条匹配的提示词配置：${interfaceType} - ${promptType}`);
          prompts.forEach((p, index) => {
            console.log(`  ${index === 0 ? '→' : ' '} [${index + 1}] ID: ${p.id}, 名称: ${p.prompt_name || '未命名'}, 创建时间: ${p.created_at}`);
          });
          console.log(`  使用最新配置: ${prompts[0].id}(${prompts[0].prompt_name || '未命名'})`);
        }
        
        // 如果有多个配置，使用最新的（第一个）
        // 如果需要使用其他配置，可以后续扩展选择逻辑
        const promptConfig = prompts[0];
        
        return {
          prompt_content: promptConfig.prompt_content,
          ai_model_config: promptConfig.ai_model_config_id_full ? {
            id: promptConfig.ai_model_config_id_full,
            config_name: promptConfig.config_name,
            provider: promptConfig.provider,
            model_name: promptConfig.model_name,
            api_type: promptConfig.api_type,
            api_key: promptConfig.api_key,
            api_endpoint: promptConfig.api_endpoint,
            temperature: promptConfig.temperature,
            max_tokens: promptConfig.max_tokens,
            top_p: promptConfig.top_p
          } : null,
          // 返回所有匹配的配置，供调用方选择使用
          all_prompts: prompts.map(p => ({
            id: p.id,
            prompt_name: p.prompt_name,
            prompt_content: p.prompt_content,
            ai_model_config_id: p.ai_model_config_id_full,
            created_at: p.created_at
          }))
        };
      }

      // 如果数据库中没有，返回null，使用默认提示词
      console.warn(`未找到启用的提示词配置：${interfaceType} - ${promptType}，使用默认提示词`);
      return null;
    } catch (error) {
      console.error('获取提示词配置失败:', error);
      return null;
    }
  }

  /**
   * 替换提示词中的变量
   */
  replacePromptVariables(prompt, variables) {
    let result = prompt;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
      result = result.replace(regex, value || '');
    }
    return result;
  }

  /**
   * 分析新闻情绪和类型
   */
  async analyzeNewsSentimentAndType(title, content, sourceUrl, isAdditionalAccount = false, interfaceType = '新榜') {
    // 特殊处理：新榜接口的微信公众号里面是图片且无正文内容的情况
    // 注意：只有当content真正是图片内容（通过isImageOnlyContent检测）或者是空的时候，才跳过AI分析
    // 如果content很短但不是图片内容，应该继续走正常的AI分析流程
    // 同时检查内容是否被污染（包含JavaScript代码等脏信息）
    const isContentDirty = content && this.isContentContaminated(content);
    const isImageOnly = this.isImageOnlyContent(content) || 
                       (!content || content.trim().length === 0) ||
                       isContentDirty;
    
    if ((interfaceType === '新榜' || interfaceType === '新榜接口') && isImageOnly) {
      console.log(`[analyzeNewsSentimentAndType] 检测到新榜接口的图片内容或脏内容，跳过AI分析`);
      if (isContentDirty) {
        console.log(`[analyzeNewsSentimentAndType] 内容被污染（包含JavaScript代码等），视为图片内容处理`);
      }
      
      // 先尝试从标题推断关键词和摘要
      const inferredKeywords = this.inferKeywordsFromContent(title, '');
      let finalKeywords = inferredKeywords.length > 0 ? inferredKeywords : ['图片内容'];
      let finalAbstract = '无正文内容，该新闻为图片，请查看详情';
        
        // 如果标题包含会议相关关键词，设置会议相关的摘要和关键词
        const titleLower = (title || '').toLowerCase();
        const meetingKeywords = [
          '会议预告', '会议召开', '会议', '论坛', '座谈会', '研讨会', '交流会', 
          '讨论会', '圆桌会', '峰会', '大会', '年会', '发布会', '启动会', 
          '签约会', '路演', '说明会', '推介会', '培训会', '分享会', 
          '学术会议', '行业会议', '战略会议', '董事会', '股东大会', 
          '临时股东大会', '年度股东大会', '会议通知', '会议公告', 
          '会议邀请', '会议报名', '会议议程', '会议日程', '会议安排',
          '即将召开', '即将举办', '即将举行', '召开会议', '举办会议', '举行会议'
        ];
        
        // 招聘相关关键词
        const recruitmentKeywords = [
          '招聘', '招聘信息', '实习生', '校园招聘', '社会招聘', '校招', '社招', 
          '岗位', '职位', '应聘', '求职', '加入我们', '加入团队', '人才招聘', '人才需求',
          '招聘启动', '招聘开启', '招聘开始', '招聘公告', '招聘通知', '招聘启事',
          '实习生招聘', '应届生招聘', '2027届', '2026届', '2025届'
        ];
        
        const hasMeetingKeyword = meetingKeywords.some(kw => titleLower.includes(kw));
        const hasRecruitmentKeyword = recruitmentKeywords.some(kw => titleLower.includes(kw));
        
        if (hasMeetingKeyword) {
          // 如果标题包含会议关键词，优先使用会议事项标签
          if (!finalKeywords.includes('会议事项')) {
            finalKeywords = ['会议事项'];
          }
          // 基于标题生成摘要
          finalAbstract = '无正文内容，该新闻为图片，请查看详情';
          console.log(`[analyzeNewsSentimentAndType] 标题包含会议关键词，设置会议事项标签和基于标题的摘要`);
        } else if (hasRecruitmentKeyword) {
          // 如果标题包含招聘关键词，使用人员招聘标签
          if (!finalKeywords.includes('人员招聘')) {
            finalKeywords = ['人员招聘'];
          }
          // 基于标题生成摘要
          finalAbstract = '无正文内容，该新闻为图片，请查看详情';
          console.log(`[analyzeNewsSentimentAndType] 标题包含招聘关键词，设置人员招聘标签和基于标题的摘要`);
        } else if (inferredKeywords.length > 0) {
          // 如果从标题推断出了关键词，使用推断的关键词和基于标题的摘要
          finalAbstract = '无正文内容，该新闻为图片，请查看详情';
          console.log(`[analyzeNewsSentimentAndType] 从标题推断出关键词: ${JSON.stringify(inferredKeywords)}`);
        }
        
        console.log(`[analyzeNewsSentimentAndType] 设置特殊摘要和关键词`);
        console.log(`[analyzeNewsSentimentAndType] 关键词: ${JSON.stringify(finalKeywords)}`);
        console.log(`[analyzeNewsSentimentAndType] 摘要: ${finalAbstract}`);
        
        return {
          sentiment: 'neutral',
          sentiment_reason: '无正文内容，该新闻为图片，请查看详情',
          keywords: finalKeywords,
          news_abstract: finalAbstract
        };
    }
    
    // 获取提示词配置（包含关联的AI模型配置）
    let promptConfig = await this.getPrompt(interfaceType, 'sentiment_analysis');
    let promptTemplate = null;
    let aiModelConfig = null;
    
    if (promptConfig && promptConfig.prompt_content) {
      // 优先使用数据库中的提示词
      promptTemplate = promptConfig.prompt_content;
      aiModelConfig = promptConfig.ai_model_config;
      console.log(`✓ 使用数据库中的提示词配置：${interfaceType} - sentiment_analysis`);
    } else {
      // 如果数据库中没有，使用默认提示词
      console.log(`⚠️ 未找到数据库提示词配置，使用默认提示词：${interfaceType} - sentiment_analysis`);
    }
    
    // 如果数据库中没有，使用默认提示词
    if (!promptTemplate) {
      promptTemplate = `
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
  "news_abstract": "150字左右的关键信息摘要（最多不超过170字）"
}

**重要要求（必须严格遵守）：**

1. **摘要要求（极其重要，必须严格遵守）**：
   - news_abstract字段必须是完整的、完整的句子，绝对不能以省略号（...）结尾，也不能以数字或未完成的短语结尾（如"还背着27."、"营收达到1."等）
   - 摘要必须是一个完整的、有意义的句子，能够独立表达新闻的核心内容
   - 摘要应该包含：时间、主体、事件、结果或意义等关键信息
   - **极其重要**：摘要必须是文章正文内容的核心关键内容的**总结和提炼**，而不是简单提取正文的第一句话、第一段话或每一段的首句
   - **绝对禁止**：直接摘取第一段话、摘取每一段的首句、或简单复制原文的某句话作为摘要
   - **必须跳过**：正文开头的引导语、关注提示、广告语等无关内容（如"点击关注"、"点击左上方关注"、"欢迎关注"、"扫描二维码"等），直接总结文章的核心主题和关键信息
   - **摘要应该是总结性的**：需要阅读**完整文章**后，提炼出核心要点，形成总结性的表述。如果正文开头只是引入，应该总结后续的核心内容。摘要应该是对全文信息的提炼和概括，而不是原文的片段拼接
   - **摘要生成方法**：通读全文，理解文章的核心主题、关键信息、主要观点，然后用简洁的语言总结成150字左右的完整句子（最多不超过170字）。不要逐段摘取，而要提炼整合
   - **特别重要**：如果文章是负面新闻（看衰、质疑、担忧企业），摘要必须准确反映文章的核心观点和担忧点，不能只是复制开头段落。例如，如果文章质疑企业能否成功上市、指出现金流紧张、债务压力大等风险，摘要应该总结这些核心担忧点，而不是只提取开头引入性文字。
   - 摘要长度应该在150字左右，最多不超过170字，即使需要压缩也要确保句子完整，不能中途截断，不能以数字、未完成的短语结尾
   - **绝对禁止**：在不完整的句子后直接加句号。必须生成完整的句子。禁止以数字、未完成的短语、未完成的句子结尾。
   - 示例：
     ✅ 正确："12月13日是国家公祭日，全国各地举行纪念活动，缅怀遇难同胞，提醒人们铭记历史、珍爱和平，吾辈应当自强不息，建设更强大的祖国。"
     ✅ 正确："企业发布国家公祭日文章，缅怀南京大屠杀遇难同胞、铭记民族苦难的庄严时刻。"
     ✅ 正确："鼎泰药研赴港IPO，2025年上半年通过生物资产公允价值变动实现扭亏，但账上现金4.19亿面临27亿赎回债务压力。"
     ✅ 正确（负面新闻摘要）："鼎泰药研赴港IPO面临多重挑战，现金流紧张，4.19亿现金需应对27.27亿赎回债务，利润波动依赖实验猴公允价值，行业遇冷背景下能否成功上市存疑。"
     ❌ 错误："点击左上方关注"博睿康"！"（这是引导语，不是核心内容）
     ❌ 错误："国内心血管代谢疾病非临床研究的头部CRO——鼎泰药研，最近敲了港交所的大门。营收看着稳当当，利润却跟坐过山车似的，2025年上半年靠生物资产公允价值赚了1.36亿才扭亏，可账上现金只剩4.19亿，还背着27."（这是原文第一句的复制，且不完整）
     ❌ 错误："12月13日是国家公祭日，全国各地举行纪念活动，缅怀遇难同胞。"（只是开头，不是总结）
     ❌ 错误："点击左上方关注"博睿康"！《CAAE脑电读图会》第三十九期，本期读图会由来自空军军医大学第一附属医院的刘永红教授担任主持人。"（这是第一段话的摘取，不是总结）
     ❌ 错误：逐段摘取首句拼接而成的摘要（如"首先...接着...然后..."这种结构，明显是逐段摘取）
   - 如果新闻正文只是一个链接地址（URL），请根据标题推断新闻主题，生成完整的摘要句子
   - 如果新闻正文包含图片链接，请根据标题和上下文推断图片内容，生成完整的摘要句子
   - **关键**：摘要必须能够独立阅读，不需要依赖原文就能理解新闻的核心内容，必须反映文章的核心主题和关键信息，是总结性的表述，而不是原文的片段

2. **标签要求（极其重要，必须严格遵守）**：
   - news_type字段必须包含具体的、有意义的标签，**绝对不能只返回["其他"]**
   - 必须仔细分析新闻内容，根据实际内容选择合适的标签
   - 标签应该准确反映新闻的核心主题和内容类型
   - 如果新闻涉及多个方面，可以包含多个标签（最多3-4个）
   - **标签选择规则（按优先级判断）**：
     * **优先判断**：如果标题或内容主要是关于节假日、纪念日、节日等（如国家公祭日、春节、国庆节、清明节、中秋节、劳动节等），应选择"节假日"标签。如果文章以节假日内容为主要主题，则只标记"节假日"即可，不需要其他标签，即使内容中包含企业介绍、产品信息等附加内容。
     * 如果新闻涉及企业活动、业务发展 → 选择"企业发展"、"市场拓展"等
     * 如果新闻涉及获奖、荣誉、认证 → **严格判断**：只有明确在标题或正文中描述对应的企业获得**具体的**奖项、荣誉、认证时（如"获得XX奖"、"荣获XX奖"），才选择"获奖"、"企业荣誉"标签。**必须排除**：①论坛、座谈会、会诊、会议、分享会、研讨会、读图会、病例分享等活动；②泛泛而谈的表述（如"获得了众多荣誉"、"获得了荣誉"等，没有具体奖项名称）；③参与性表述（如"成为XX供应商"、"成为XX协办方"等，不是获奖）。如果不符合上述条件，应该根据活动性质选择其他标签（如"行业分析"、"产品能力"等）
     * 如果新闻涉及产品发布、技术突破 → 选择"产品发布"、"技术创新"等
     * 如果新闻涉及融资、投资 → 选择"融资消息"
     * 如果新闻涉及合作、伙伴关系 → 选择"合作伙伴"
     * 如果新闻涉及榜单 → **严格判断**：只有明确由某家企业发布的榜单信息，或标题中包含"榜单"字样时，才选择"榜单"标签。行业分享会、企业单独获奖信息不应标记为"榜单"
     * 如果新闻涉及广告、推广 → 选择"广告推广"、"营销推广"等
     * 如果新闻涉及纪念活动、社会事件、行业分享会（但不是节假日） → 根据内容选择合适标签，如"行业分析"等
   - **只有当新闻内容确实无法归类到任何具体类别时，才使用"其他"标签，且必须作为最后一个补充标签，前面要有至少1-2个具体标签**
   - **绝对禁止**：只返回["其他"]，必须至少包含1个具体标签
   - 标签应该基于新闻的实际内容判断，不能因为内容是链接或图片就简单地使用"其他"

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
  * **重要**：如果文章整体基调是看衰、质疑、担忧企业的发展前景，或指出企业面临重大风险、挑战、困境，应判断为负面新闻
  * **示例**：文章提到企业"现金流紧张"、"面临XX亿债务压力"、"能否成功上市存疑"、"风险较大"、"能否避开这个坑不好说"等表述，整体呈现担忧、质疑的基调，应判断为负面

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
- 安全防护（企业提供安全防护、漏洞修复等）
- 产品能力（展示产品功能、技术实力等）
- 节假日（**优先判断**：如果标题或内容主要是关于节假日、纪念日、节日等，如国家公祭日、春节、国庆节、清明节等，应标记为"节假日"。如果文章以节假日内容为主要主题，则只标记"节假日"即可，不需要其他标签）
- 榜单（**严格使用**：仅用于明确由某家企业发布的榜单信息，或标题中包含"榜单"字样的新闻。行业分享会、企业单独获奖信息不应使用此标签）
- 获奖（**严格使用**：仅用于明确在标题或正文中描述对应的企业获得**具体的**奖项、荣誉、认证时（如"获得XX奖"、"荣获XX奖"）。**必须排除**：①论坛、座谈会、会诊、会议、分享会、研讨会、读图会、病例分享等活动；②泛泛而谈的表述（如"获得了众多荣誉"，没有具体奖项名称）；③参与性表述（如"成为XX供应商"、"成为XX协办方"等）。注意：企业单独的获奖信息应使用"获奖"标签，不是"榜单"标签）
- 广告推广
- 商业广告
- 营销推广
- 其他（仅在确实无法归类时使用，且应作为补充标签）

**标签选择要求（非常重要）**：
- 每个类型标签必须控制在4个字符以内，超过4个字符的标签将被截断
- 必须根据新闻的实际内容选择最贴切的标签，不能简单地使用"其他"
- 仔细阅读新闻内容，识别新闻的核心主题和类型
- 如果新闻涉及节假日、纪念日、节日等（如国家公祭日、春节、国庆节等），应优先标记为"节假日"标签
- 如果新闻涉及纪念活动、历史事件、社会关注等，应该选择合适的标签，不能随意归类为"其他"
- 标签应该具体、准确，反映新闻的核心信息

${isAdditionalAccount ? `**额外公众号新闻特殊处理（重要）：**
- 如果新闻内容涉及获奖、荣誉、认证等信息，请添加"获奖"标签
- 如果新闻内容涉及榜单信息，请**严格判断**：
  * 只有明确由某家企业发布的榜单信息，或标题中包含"榜单"字样时，才添加"榜单"标签
  * 行业分享会不应标记为"榜单"
  * 企业单独的获奖信息应使用"获奖"标签，不是"榜单"标签
- 获奖相关：**严格判断**，只有明确在标题或正文中描述企业获得某类奖项、荣誉、认证时，才添加"获奖"标签。**必须排除**：论坛、座谈会、会诊、会议、分享会、研讨会等活动
- 榜单相关：明确由企业发布的榜单、标题包含"榜单"字样的新闻
- 请仔细分析内容，区分"榜单"和"获奖"，确保标签准确。特别注意：论坛、座谈会、会诊等活动不应标记为"获奖"
` : ''}

**广告识别重要提示：**
- 如果文章主要目的是推销产品、服务或品牌，请标记为"广告推广"、"商业广告"或"营销推广"
- 广告特征包括：产品宣传、服务推介、品牌营销、促销活动、商业合作推广等
- 即使涉及真实的企业信息，如果主要目的是营销推广，仍应标记为广告类型

请确保返回的是有效的JSON格式。
`;
    }

    // 处理内容：如果内容为空或只是一个URL，需要在提示词中特别说明
    let processedContent = content || '';
    let contentNote = '';
    
    // 记录传递给AI的内容信息
    console.log(`[analyzeNewsSentimentAndType] 接收到的content长度: ${(content || '').length}字符`);
    if (content && content.length > 0) {
      console.log(`[analyzeNewsSentimentAndType] content预览: ${content.substring(0, 100)}...`);
    } else {
      console.warn(`[analyzeNewsSentimentAndType] ⚠️ content为空，可能无法生成有效摘要`);
    }
    
    if (!processedContent || processedContent.trim() === '') {
      contentNote = '\n**注意：新闻正文内容为空，可能只是链接地址，请根据标题和链接地址进行判断。**';
      console.warn(`[analyzeNewsSentimentAndType] ⚠️ 内容为空，将在提示词中添加说明`);
    } else if (processedContent.trim().startsWith('http://') || processedContent.trim().startsWith('https://')) {
      contentNote = '\n**注意：新闻正文似乎只是一个链接地址，请根据标题和链接地址进行判断，如果可能，请说明链接指向的内容类型。**';
    }
    
    // 发送完整内容给AI，不截取（确保AI能看到全文进行准确分析）
    // 注意：如果内容过长，AI模型配置中的max_tokens会限制响应长度，但输入内容应该完整发送
    const contentForAnalysis = processedContent;
    
    console.log(`[analyzeNewsSentimentAndType] 发送给AI的内容长度: ${contentForAnalysis.length}字符`);

    // 替换变量
    const prompt = this.replacePromptVariables(promptTemplate, {
      title: title || '',
      content: contentForAnalysis + contentNote,
      sourceUrl: sourceUrl || '',
      isAdditionalAccount: isAdditionalAccount ? '\n**注意：此新闻来自额外公众号，请特别关注榜单、获奖、荣誉等相关信息。注意区分"榜单"和"获奖"：只有明确由企业发布的榜单或标题包含"榜单"字样时才使用"榜单"标签，企业单独获奖应使用"获奖"标签。**' : ''
    });

    try {
      // 如果提示词配置中有关联的AI模型配置，使用它；否则使用默认配置
      const response = await this.callAIModel(prompt, aiModelConfig);
      
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
        // 生成默认摘要，确保是完整句子，并跳过引导语
        const processedContent = this.skipIrrelevantContent(content || '');
        const contentPreview = processedContent.substring(0, 100);
        const lastSentenceMatch = contentPreview.match(/(.+[。！？.!?])/);
        const defaultAbstract = lastSentenceMatch ? lastSentenceMatch[1] : (contentPreview || '新闻内容摘要') + '。';
        
        result = {
          sentiment: 'neutral',
          sentiment_reason: '解析失败，使用默认值',
          news_type: ['其他'],
          news_abstract: defaultAbstract
        };
      }

      // 限制关键词长度为4个字符以内，并处理"其他"标签
      let keywords = result.news_type || [];
      if (!Array.isArray(keywords) || keywords.length === 0) {
        // 如果AI没有返回标签，尝试从内容中提取
        console.warn('⚠️ AI未返回news_type，尝试从标题和内容推断标签');
        keywords = this.inferKeywordsFromContent(title, content);
      } else {
        // 过滤掉无效标签
        keywords = keywords.filter(k => k && typeof k === 'string' && k.trim() !== '');
        
        // 如果所有标签都是"其他"，尝试从标题和内容推断可能的标签
        const allOthers = keywords.every(k => k.trim() === '其他' || k.trim() === '其它');
        if (allOthers && keywords.length === 1) {
          console.warn('⚠️ AI只返回了"其他"标签，尝试根据内容推断');
          const inferredKeywords = this.inferKeywordsFromContent(title, content);
          if (inferredKeywords.length > 0 && inferredKeywords[0] !== '其他') {
            keywords = inferredKeywords;
            console.log(`✓ 推断出标签: ${JSON.stringify(keywords)}`);
          }
        } else if (allOthers && keywords.length > 1) {
          // 如果只有"其他"标签，移除多余的"其他"
          keywords = keywords.filter(k => k.trim() !== '其他' && k.trim() !== '其它');
          if (keywords.length === 0) {
            const inferredKeywords = this.inferKeywordsFromContent(title, content);
            keywords = inferredKeywords;
          }
        }
        
        // 限制每个标签长度为4个字符以内
        keywords = keywords.map(keyword => {
          const trimmed = typeof keyword === 'string' ? keyword.trim() : String(keyword).trim();
          if (trimmed.length > 4) {
            return trimmed.substring(0, 4);
          }
          return trimmed;
        });
        
        // 去重
        keywords = [...new Set(keywords)];
      }

      // 处理摘要：确保完整句子，去除末尾的省略号
      let abstract = result.news_abstract || '';
      
      // 检查摘要是否是错误消息（AI返回的错误提示）
      const errorMessages = [
        '由于未提供具体新闻内容',
        '无法生成有效摘要',
        '未提供具体新闻正文内容',
        '由于未提供具体的新闻正文内容',
        '无法生成有效摘要',
        '未提供具体新闻内容',
        '无法生成摘要',
        '内容为空',
        '没有提供内容',
        '无法生成',
        '未提供'
      ];
      
      // 检查摘要是否包含错误消息关键词（更严格的检测）
      const isErrorMessage = abstract && (
        abstract.includes('未提供具体新闻内容') || 
        abstract.includes('无法生成有效摘要') ||
        abstract.includes('无法生成摘要') ||
        abstract.includes('未提供具体新闻正文内容') ||
        (abstract.includes('未提供') && abstract.includes('无法生成'))
      );
      
      if (isErrorMessage) {
        console.warn(`[analyzeNewsSentimentAndType] AI返回了错误消息，将尝试从原文提取摘要`);
        console.warn(`AI返回的摘要: ${abstract}`);
        console.warn(`当前content长度: ${(content || '').length}字符`);
        if (content && content.length > 0) {
          console.warn(`当前content预览: ${content.substring(0, 200)}...`);
        }
        // 清空摘要，后续会从原文提取
        abstract = '';
      }
      
      if (abstract) {
        // 去除末尾的省略号（可能是多个...或…）
        abstract = abstract.trim()
          .replace(/\.{2,}$/, '')  // 去除末尾的多个点
          .replace(/…+$/, '')      // 去除末尾的中文省略号
          .replace(/\.{3,}$/, '')  // 再次去除多个点
          // 去除末尾的分号或分号+句号（如";。"）
          .replace(/[;；]+[。.!?]?$/, '')
          .trim();
        
        // 检查摘要是否完整（至少包含主语和谓语，且长度合理）
        const isComplete = this.isAbstractComplete(abstract, title, content);
        
        // 检查摘要是否以数字结尾（可能是被截断）
        const endsWithNumber = /[\d\.]+[。！？.!?]?$/.test(abstract.trim());
        if (endsWithNumber) {
          const abstractTrimmed = abstract.trim();
          const beforeNum = abstractTrimmed.replace(/[\d\.]+[。！？.!?]?$/, '').trim();
          // 如果数字前的内容太短，或者以不完整的短语结尾，标记为不完整
          if (beforeNum.length < 10) {
            console.warn('⚠️ AI返回的摘要以数字结尾，数字前内容太少，可能被截断');
            isComplete = false;
          } else {
            // 检查数字前的最后一个短语是否完整
            const lastPhrase = beforeNum.split(/[，。！？.!?]/).pop().trim();
            if (lastPhrase.length < 5 && /[着了的]$/.test(lastPhrase)) {
              console.warn('⚠️ AI返回的摘要以数字结尾，且数字前短语不完整');
              isComplete = false;
            } else {
              // 检查最后几个字符是否包含"还/只/仅"且短语较短
              const lastFewChars = beforeNum.substring(Math.max(0, beforeNum.length - 5));
              if (/[还只仅]/.test(lastFewChars) && lastPhrase.length < 8) {
                // 特别检查"还背着"、"还剩下"、"只剩下"等模式
                if (/还.*[着下]|只.*[剩下]|仅.*[剩下]/.test(lastPhrase)) {
                  console.warn('⚠️ AI返回的摘要以数字结尾，且数字前以"还背着/还剩下"等不完整短语结尾');
                  isComplete = false;
                }
              }
            }
          }
        }
        
        if (!isComplete) {
          console.warn('⚠️ AI返回的摘要不完整或只是第一段话，尝试生成总结性摘要');
          console.warn(`当前摘要: ${abstract.substring(0, 80)}...`);
          console.warn(`摘要长度: ${abstract.length}字符，内容长度: ${(content || '').length}字符`);
          
          // 检查摘要是否与原文开头高度相似（可能是简单复制第一段话）
          const contentStart = (content || '').trim().substring(0, Math.min(abstract.length + 50, (content || '').length));
          const abstractStart = abstract.substring(0, Math.min(abstract.length, 100));
          let sameCount = 0;
          const checkLen = Math.min(abstractStart.length, contentStart.length);
          for (let i = 0; i < checkLen; i++) {
            if (abstractStart[i] === contentStart[i]) {
              sameCount++;
            }
          }
          const copySimilarity = checkLen > 0 ? sameCount / checkLen : 0;
          
          // 如果相似度超过60%，认为是简单复制第一段话，直接使用extractCompleteAbstract重新提取
          if (copySimilarity > 0.6) {
            console.warn(`⚠️ 检测到摘要与原文开头相似度${(copySimilarity * 100).toFixed(1)}%，可能是简单复制第一段话，将重新提取`);
            const extractedAbstract = this.extractCompleteAbstract(title, content, abstract);
            if (extractedAbstract && extractedAbstract.length >= 30) {
              abstract = extractedAbstract;
              console.log(`✓ 已从原文重新提取摘要（跳过第一段话），长度: ${abstract.length}字符`);
              console.log(`新摘要预览: ${abstract.substring(0, 80)}...`);
              // 重新检查是否完整
              isComplete = this.isAbstractComplete(abstract, title, content);
            }
          }
          
          // 如果摘要以数字结尾，先尝试补充完整
          if (!isComplete && endsWithNumber) {
            const supplemented = this.supplementAbstract(abstract, title, content);
            if (supplemented && supplemented.length > abstract.length && 
                !/[\d\.]+[。！？.!?]?$/.test(supplemented.trim())) {
              abstract = supplemented;
              console.log(`✓ 已补充完整摘要: ${abstract.substring(0, 80)}...`);
              // 重新检查是否完整
              isComplete = this.isAbstractComplete(abstract, title, content);
            }
          }
          
          // 如果还是不完整，尝试从原文中提取完整的摘要（会跳过引导语，提取核心内容）
          if (!isComplete) {
            const extractedAbstract = this.extractCompleteAbstract(title, content, abstract);
            // 如果提取的摘要比AI返回的更长，且更完整，使用提取的摘要
            if (extractedAbstract && 
                extractedAbstract.length >= Math.max(abstract.length, 50) &&
                !/[\d\.]+[。！？.!?]?$/.test(extractedAbstract.trim()) &&
                this.isAbstractComplete(extractedAbstract, title, content)) {
              abstract = extractedAbstract;
              console.log(`✓ 已从原文提取完整摘要: ${abstract.substring(0, 80)}...`);
            } else {
              // 如果提取的摘要也不合适，尝试修复当前摘要
              // 如果摘要以数字结尾，尝试在原文中找到完整的表述
              if (endsWithNumber) {
                const supplemented = this.supplementAbstract(abstract, title, content);
                if (supplemented && supplemented.length > abstract.length) {
                  abstract = supplemented;
                  console.log(`✓ 已补充完整摘要: ${abstract.substring(0, 50)}...`);
                } else {
                  // 如果找不到，至少确保以句号结尾，并尝试修复
                  abstract = abstract.replace(/[\d\.]+[。！？.!?]?$/, '').trim();
                  if (!/[。！？.!?]$/.test(abstract)) {
                    abstract += '。';
                  }
                }
              } else {
                // 确保以句号结尾
                if (abstract && !/[。！？.!?]$/.test(abstract)) {
                  // 尝试找到最后一个完整句子
                  const lastSentenceMatch = abstract.match(/(.+[。！？.!?])/);
                  if (lastSentenceMatch) {
                    abstract = lastSentenceMatch[1];
                  } else {
                    abstract += '。';
                  }
                }
              }
            }
          }
        } else {
          // 确保摘要以句号、问号或感叹号结尾
          if (abstract && !/[。！？.!?]$/.test(abstract)) {
            abstract += '。';
          }
        }
      } else {
        // 如果没有摘要或摘要被识别为错误消息，从原文提取
        console.log(`[analyzeNewsSentimentAndType] AI未返回摘要或摘要为空/错误，从原文提取`);
        console.log(`内容长度: ${(content || '').length}字符`);
        if (content && content.length > 0) {
          console.log(`内容预览: ${content.substring(0, 200)}...`);
        }
        
        if (content && content.trim().length > 20) {
          // 确保content不是错误消息本身
          const contentTrimmed = content.trim();
          const isContentErrorMessage = contentTrimmed.includes('未提供具体新闻内容') || 
                                       contentTrimmed.includes('无法生成有效摘要') ||
                                       contentTrimmed.includes('无法生成摘要');
          
          if (isContentErrorMessage) {
            console.warn(`[analyzeNewsSentimentAndType] ⚠️ 警告：content本身包含错误消息，可能content字段存储的是错误消息而不是正文内容`);
            console.warn(`content值: ${contentTrimmed.substring(0, 100)}...`);
            // 基于标题生成摘要
            if (title && title.length > 5) {
              abstract = `${title}相关新闻报道。`;
            } else {
              abstract = '新闻内容摘要。';
            }
          } else {
            // 从原文提取摘要
            console.log(`[analyzeNewsSentimentAndType] 开始从原文提取摘要...`);
            abstract = this.extractCompleteAbstract(title, content, '');
            
            // 如果提取的摘要仍然为空或太短，尝试基于标题生成
            if (!abstract || abstract.length < 20) {
              console.warn(`[analyzeNewsSentimentAndType] 无法从原文提取有效摘要，基于标题生成`);
              console.warn(`提取的摘要: ${abstract || '(空)'}`);
              if (title && title.length > 5) {
                abstract = `${title}相关新闻报道。`;
              } else {
                abstract = '新闻内容摘要。';
              }
            } else {
              console.log(`[analyzeNewsSentimentAndType] ✓ 已从原文提取摘要，长度: ${abstract.length}字符`);
              console.log(`摘要预览: ${abstract.substring(0, 100)}...`);
            }
          }
        } else {
          console.warn(`[analyzeNewsSentimentAndType] 内容为空或太短，无法提取摘要`);
          console.warn(`content值: ${content || '(空)'}`);
          
          // 特殊处理：新榜接口且内容为空的情况（可能是图片内容）
          if ((interfaceType === '新榜' || interfaceType === '新榜接口') && 
              (!content || content.trim().length === 0)) {
            console.log(`[analyzeNewsSentimentAndType] 检测到新榜接口且内容为空或很短，可能是图片内容，从标题推断关键词和摘要`);
            
            // 从标题推断关键词
            const inferredKeywords = this.inferKeywordsFromContent(title, '');
            let finalKeywords = inferredKeywords.length > 0 ? inferredKeywords : ['图片内容'];
            
            // 检查标题是否包含会议关键词
            const titleLower = (title || '').toLowerCase();
            const meetingKeywords = [
              '会议预告', '会议召开', '会议', '论坛', '座谈会', '研讨会', '交流会', 
              '讨论会', '圆桌会', '峰会', '大会', '年会', '发布会', '启动会', 
              '签约会', '路演', '说明会', '推介会', '培训会', '分享会', 
              '学术会议', '行业会议', '战略会议', '董事会', '股东大会', 
              '临时股东大会', '年度股东大会', '会议通知', '会议公告', 
              '会议邀请', '会议报名', '会议议程', '会议日程', '会议安排',
              '即将召开', '即将举办', '即将举行', '召开会议', '举办会议', '举行会议'
            ];
            
            const hasMeetingKeyword = meetingKeywords.some(kw => titleLower.includes(kw));
            if (hasMeetingKeyword) {
              // 如果标题包含会议关键词，优先使用会议事项标签
              if (!finalKeywords.includes('会议事项')) {
                finalKeywords = ['会议事项'];
              }
              // 基于标题生成摘要
              abstract = '正文无文字，无法生成摘要';
              console.log(`[analyzeNewsSentimentAndType] 标题包含会议关键词，设置会议事项标签和基于标题的摘要`);
            } else if (inferredKeywords.length > 0) {
              // 如果从标题推断出了关键词，使用推断的关键词和基于标题的摘要
              abstract = '正文无文字，无法生成摘要';
              console.log(`[analyzeNewsSentimentAndType] 从标题推断出关键词: ${JSON.stringify(inferredKeywords)}`);
            } else {
              // 基于标题生成摘要
              abstract = '正文无文字，无法生成摘要';
            }
            
            // 确保关键词不为空
            if (finalKeywords.length === 0) {
              finalKeywords = ['图片内容'];
            }
            
            // 确保摘要不为空
            if (!abstract || abstract.trim().length === 0) {
              abstract = '正文无文字，无法生成摘要';
            }
            
            console.log(`[analyzeNewsSentimentAndType] 设置后的关键词: ${JSON.stringify(finalKeywords)}`);
            console.log(`[analyzeNewsSentimentAndType] 设置后的摘要: ${abstract}`);
            
            // 更新keywords和abstract变量，确保返回时包含正确的关键词和摘要
            keywords = finalKeywords;
            // abstract已经在上面设置好了
          } else {
            // 基于标题生成摘要
            if (title && title.length > 5) {
              abstract = `${title}相关新闻报道。`;
            } else {
              abstract = '新闻内容摘要。';
            }
          }
        }
      }

      return {
        sentiment: result.sentiment || 'neutral',
        sentiment_reason: result.sentiment_reason || '',
        keywords: keywords.length > 0 ? keywords : ['其他'],
        news_abstract: abstract
      };
    } catch (error) {
      console.error('新闻分析失败:', error);
      // 生成默认摘要，确保是完整句子，并跳过引导语
      const processedContent = this.skipIrrelevantContent(content || '');
      const contentPreview = processedContent.substring(0, 100);
      const lastSentenceMatch = contentPreview.match(/(.+[。！？.!?])/);
      const defaultAbstract = lastSentenceMatch ? lastSentenceMatch[1] : (contentPreview || '新闻内容摘要') + '。';
      
      return {
        sentiment: 'neutral',
        sentiment_reason: '分析失败',
        keywords: ['其他'],
        news_abstract: defaultAbstract
      };
    }
  }

  /**
   * 分析新闻与被投企业的关联性
   */
  async analyzeEnterpriseRelevance(title, content, enterprises, interfaceType = '新榜') {
    const enterpriseList = enterprises.map(e => `${e.enterprise_full_name}(${e.project_abbreviation})`).join('、');
    
    // 获取提示词配置（包含关联的AI模型配置）
    let promptConfig = await this.getPrompt(interfaceType, 'enterprise_relevance');
    let promptTemplate = null;
    let aiModelConfig = null;
    
    if (promptConfig) {
      promptTemplate = promptConfig.prompt_content;
      aiModelConfig = promptConfig.ai_model_config;
    }
    
    // 如果数据库中没有，使用默认提示词
    if (!promptTemplate) {
      promptTemplate = `
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
    }

    // 替换变量
    const prompt = this.replacePromptVariables(promptTemplate, {
      title: title || '',
      content: (content || '').substring(0, 3000) + ((content || '').length > 3000 ? '...' : ''),
      enterpriseList: enterpriseList || ''
    });

    try {
      // 如果提示词配置中有关联的AI模型配置，使用它；否则使用默认配置
      const response = await this.callAIModel(prompt, aiModelConfig);
      
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
  async validateExistingAssociation(title, content, enterpriseName, interfaceType = '新榜') {
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

    // 获取提示词配置（包含关联的AI模型配置）
    let promptConfig = await this.getPrompt(interfaceType, 'validation');
    let promptTemplate = null;
    let aiModelConfig = null;
    
    if (promptConfig) {
      promptTemplate = promptConfig.prompt_content;
      aiModelConfig = promptConfig.ai_model_config;
    }
    
    // 如果数据库中没有，使用默认提示词
    if (!promptTemplate) {
      promptTemplate = `
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
    }

    // 替换变量
    const prompt = this.replacePromptVariables(promptTemplate, {
      title: title || '',
      content: (content || '').substring(0, 3000),
      enterpriseName: enterpriseName || ''
    });

    try {
      // 如果提示词配置中有关联的AI模型配置，使用它；否则使用默认配置
      const response = await this.callAIModel(prompt, aiModelConfig);
      
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
   * 校验分析结果（摘要和关键词）
   * 确保摘要不包含错误消息，关键词不包含"其他"
   */
  validateAnalysisResult(analysis, title, content, interfaceType = '新榜') {
    let validatedAbstract = analysis.news_abstract || '';
    let validatedKeywords = [...(analysis.keywords || [])];
    let needsFix = false;
    
    // 1. 检查摘要是否包含错误消息
    const errorMessages = [
      '未提供具体新闻内容',
      '无法生成有效摘要',
      '无法生成摘要',
      '未提供具体新闻正文内容',
      '由于未提供具体的新闻正文内容'
    ];
    
    const hasErrorMessage = errorMessages.some(msg => validatedAbstract.includes(msg));
    if (hasErrorMessage) {
      console.warn(`[validateAnalysisResult] ⚠️ 检测到摘要包含错误消息: ${validatedAbstract}`);
      
      // 特殊处理：新榜接口的图片内容（只有当content真正是图片内容或者是空的时候）
      // 同时检查内容是否被污染（包含JavaScript代码、CSS样式等脏信息）
      const isContentDirty = content && this.isContentContaminated(content);
      const isImageContent = this.isImageOnlyContent(content) || 
                            (!content || content.trim().length === 0) ||
                            isContentDirty;
      
      if ((interfaceType === '新榜' || interfaceType === '新榜接口') && isImageContent) {
        console.log(`[validateAnalysisResult] 检测到新榜接口的图片内容或脏内容，设置特殊摘要`);
        if (isContentDirty) {
          console.log(`[validateAnalysisResult] 内容被污染（包含JavaScript代码、CSS样式等），视为图片内容处理`);
        }
        
        // 先尝试从标题推断关键词
        const inferredKeywords = this.inferKeywordsFromContent(title, '');
        let finalKeywords = inferredKeywords.length > 0 ? inferredKeywords : ['图片内容'];
        let finalAbstract = '正文无文字，无法生成摘要';
        
        // 如果标题包含会议相关关键词，设置会议相关的摘要和关键词
        const titleLower = (title || '').toLowerCase();
        const meetingKeywords = [
          '会议预告', '会议召开', '会议', '论坛', '座谈会', '研讨会', '交流会', 
          '讨论会', '圆桌会', '峰会', '大会', '年会', '发布会', '启动会', 
          '签约会', '路演', '说明会', '推介会', '培训会', '分享会', 
          '学术会议', '行业会议', '战略会议', '董事会', '股东大会', 
          '临时股东大会', '年度股东大会', '会议通知', '会议公告', 
          '会议邀请', '会议报名', '会议议程', '会议日程', '会议安排',
          '即将召开', '即将举办', '即将举行', '召开会议', '举办会议', '举行会议'
        ];
        
        // 招聘相关关键词
        const recruitmentKeywords = [
          '招聘', '招聘信息', '实习生', '校园招聘', '社会招聘', '校招', '社招', 
          '岗位', '职位', '应聘', '求职', '加入我们', '加入团队', '人才招聘', '人才需求',
          '招聘启动', '招聘开启', '招聘开始', '招聘公告', '招聘通知', '招聘启事',
          '实习生招聘', '应届生招聘', '2027届', '2026届', '2025届'
        ];
        
        const hasMeetingKeyword = meetingKeywords.some(kw => titleLower.includes(kw));
        const hasRecruitmentKeyword = recruitmentKeywords.some(kw => titleLower.includes(kw));
        
        if (hasMeetingKeyword) {
          // 如果标题包含会议关键词，优先使用会议事项标签
          if (!finalKeywords.includes('会议事项')) {
            finalKeywords = ['会议事项'];
          }
          // 基于标题生成摘要
          finalAbstract = '正文无文字，无法生成摘要';
          console.log(`[validateAnalysisResult] 标题包含会议关键词，设置会议事项标签和基于标题的摘要`);
        } else if (hasRecruitmentKeyword) {
          // 如果标题包含招聘关键词，使用人员招聘标签
          if (!finalKeywords.includes('人员招聘')) {
            finalKeywords = ['人员招聘'];
          }
          // 基于标题生成摘要
          finalAbstract = '正文无文字，无法生成摘要';
          console.log(`[validateAnalysisResult] 标题包含招聘关键词，设置人员招聘标签和基于标题的摘要`);
        } else if (inferredKeywords.length > 0) {
          // 如果从标题推断出了关键词，使用推断的关键词和基于标题的摘要
          finalAbstract = '正文无文字，无法生成摘要';
          console.log(`[validateAnalysisResult] 从标题推断出关键词: ${JSON.stringify(inferredKeywords)}`);
        }
        
        validatedAbstract = finalAbstract;
        validatedKeywords = finalKeywords;
        console.log(`[validateAnalysisResult] 设置后的关键词: ${JSON.stringify(validatedKeywords)}`);
        console.log(`[validateAnalysisResult] 设置后的摘要: ${validatedAbstract}`);
        needsFix = true;
      } else {
        console.warn(`[validateAnalysisResult] 将尝试从原文重新提取摘要`);
        
        // 尝试从原文提取摘要
        if (content && content.trim().length > 20) {
          const extractedAbstract = this.extractCompleteAbstract(title, content, '');
          if (extractedAbstract && extractedAbstract.length >= 20) {
            validatedAbstract = extractedAbstract;
            console.log(`[validateAnalysisResult] ✓ 已从原文重新提取摘要，长度: ${validatedAbstract.length}字符`);
          } else {
            // 如果提取失败，基于标题生成
            validatedAbstract = title && title.length > 5 ? `${title}相关新闻报道。` : '新闻内容摘要。';
            console.warn(`[validateAnalysisResult] 无法从原文提取，使用标题生成摘要`);
          }
        } else {
          // 如果content为空，基于标题生成
          // 特殊处理：新榜接口且内容为空的情况（可能是图片内容）
          const isImageContent = this.isImageOnlyContent(content) || 
                                (!content || content.trim().length === 0);
          
          if ((interfaceType === '新榜' || interfaceType === '新榜接口') && isImageContent) {
            console.log(`[validateAnalysisResult] 检测到新榜接口且内容为空或很短，可能是图片内容，从标题生成摘要`);
            
            // 检查标题是否包含会议关键词或招聘关键词
            const titleLower = (title || '').toLowerCase();
            const meetingKeywords = [
              '会议预告', '会议召开', '会议', '论坛', '座谈会', '研讨会', '交流会', 
              '讨论会', '圆桌会', '峰会', '大会', '年会', '发布会', '启动会', 
              '签约会', '路演', '说明会', '推介会', '培训会', '分享会', 
              '学术会议', '行业会议', '战略会议', '董事会', '股东大会', 
              '临时股东大会', '年度股东大会', '会议通知', '会议公告', 
              '会议邀请', '会议报名', '会议议程', '会议日程', '会议安排',
              '即将召开', '即将举办', '即将举行', '召开会议', '举办会议', '举行会议'
            ];
            
            const recruitmentKeywords = [
              '招聘', '招聘信息', '实习生', '校园招聘', '社会招聘', '校招', '社招', 
              '岗位', '职位', '应聘', '求职', '加入我们', '加入团队', '人才招聘', '人才需求',
              '招聘启动', '招聘开启', '招聘开始', '招聘公告', '招聘通知', '招聘启事',
              '实习生招聘', '应届生招聘', '2027届', '2026届', '2025届'
            ];
            
            const hasMeetingKeyword = meetingKeywords.some(kw => titleLower.includes(kw));
            const hasRecruitmentKeyword = recruitmentKeywords.some(kw => titleLower.includes(kw));
            
            if (hasMeetingKeyword || hasRecruitmentKeyword) {
              // 如果标题包含会议关键词或招聘关键词，基于标题生成摘要
              validatedAbstract = '正文无文字，无法生成摘要';
              console.log(`[validateAnalysisResult] 标题包含${hasMeetingKeyword ? '会议' : '招聘'}关键词，设置基于标题的摘要`);
            } else {
              // 基于标题生成摘要
              validatedAbstract = '正文无文字，无法生成摘要';
            }
          } else {
            validatedAbstract = title && title.length > 5 ? `${title}相关新闻报道。` : '新闻内容摘要。';
            console.warn(`[validateAnalysisResult] content为空，使用标题生成摘要`);
          }
        }
        needsFix = true;
      }
    }
    
    // 2. 检查关键词是否为空或包含"其他"
    const isEmptyKeywords = !validatedKeywords || validatedKeywords.length === 0;
    const hasOtherKeyword = validatedKeywords && validatedKeywords.some(kw => 
      kw === '其他' || kw === '其它' || kw.trim() === '其他' || kw.trim() === '其它'
    );
    
    if (isEmptyKeywords || hasOtherKeyword) {
      if (isEmptyKeywords) {
        console.warn(`[validateAnalysisResult] ⚠️ 检测到关键词为空`);
      } else {
        console.warn(`[validateAnalysisResult] ⚠️ 检测到关键词包含"其他": ${JSON.stringify(validatedKeywords)}`);
      }
      
      // 移除"其他"关键词
      validatedKeywords = (validatedKeywords || []).filter(kw => 
        kw !== '其他' && kw !== '其它' && kw.trim() !== '其他' && kw.trim() !== '其它'
      );
      
      // 如果移除后没有关键词，尝试从标题和内容推断
      if (validatedKeywords.length === 0) {
        console.warn(`[validateAnalysisResult] 关键词为空或移除"其他"后没有关键词，尝试从标题推断`);
        
        // 特殊处理：新榜接口且内容为空的情况（可能是图片内容）
        const isImageContent = this.isImageOnlyContent(content) || 
                              (!content || content.trim().length === 0);
        
        if ((interfaceType === '新榜' || interfaceType === '新榜接口') && isImageContent) {
          console.log(`[validateAnalysisResult] 检测到新榜接口且内容为空或很短，可能是图片内容，从标题推断关键词`);
          
          // 从标题推断关键词
          const inferredKeywords = this.inferKeywordsFromContent(title, '');
          let finalKeywords = inferredKeywords.length > 0 ? inferredKeywords : ['图片内容'];
          
          // 检查标题是否包含会议关键词或招聘关键词
          const titleLower = (title || '').toLowerCase();
          const meetingKeywords = [
            '会议预告', '会议召开', '会议', '论坛', '座谈会', '研讨会', '交流会', 
            '讨论会', '圆桌会', '峰会', '大会', '年会', '发布会', '启动会', 
            '签约会', '路演', '说明会', '推介会', '培训会', '分享会', 
            '学术会议', '行业会议', '战略会议', '董事会', '股东大会', 
            '临时股东大会', '年度股东大会', '会议通知', '会议公告', 
            '会议邀请', '会议报名', '会议议程', '会议日程', '会议安排',
            '即将召开', '即将举办', '即将举行', '召开会议', '举办会议', '举行会议'
          ];
          
          const recruitmentKeywords = [
            '招聘', '招聘信息', '实习生', '校园招聘', '社会招聘', '校招', '社招', 
            '岗位', '职位', '应聘', '求职', '加入我们', '加入团队', '人才招聘', '人才需求',
            '招聘启动', '招聘开启', '招聘开始', '招聘公告', '招聘通知', '招聘启事',
            '实习生招聘', '应届生招聘', '2027届', '2026届', '2025届'
          ];
          
          const hasMeetingKeyword = meetingKeywords.some(kw => titleLower.includes(kw));
          const hasRecruitmentKeyword = recruitmentKeywords.some(kw => titleLower.includes(kw));
          
          if (hasMeetingKeyword) {
            // 如果标题包含会议关键词，优先使用会议事项标签
            if (!finalKeywords.includes('会议事项')) {
              finalKeywords = ['会议事项'];
            }
            console.log(`[validateAnalysisResult] 标题包含会议关键词，设置会议事项标签`);
          } else if (hasRecruitmentKeyword) {
            // 如果标题包含招聘关键词，使用人员招聘标签
            if (!finalKeywords.includes('人员招聘')) {
              finalKeywords = ['人员招聘'];
            }
            console.log(`[validateAnalysisResult] 标题包含招聘关键词，设置人员招聘标签`);
          }
          
          validatedKeywords = finalKeywords;
          console.log(`[validateAnalysisResult] ✓ 已推断关键词: ${JSON.stringify(validatedKeywords)}`);
        } else {
          // 从标题和内容推断关键词
          const inferredKeywords = this.inferKeywordsFromContent(title, content);
          if (inferredKeywords.length > 0) {
            validatedKeywords = inferredKeywords;
            console.log(`[validateAnalysisResult] ✓ 已推断关键词: ${JSON.stringify(validatedKeywords)}`);
          } else {
            // 如果推断失败，至少保留一个基于标题的关键词
            validatedKeywords = ['新闻资讯'];
            console.warn(`[validateAnalysisResult] 无法推断关键词，使用默认关键词`);
          }
        }
      } else {
        console.log(`[validateAnalysisResult] ✓ 已移除"其他"关键词，剩余: ${JSON.stringify(validatedKeywords)}`);
      }
      needsFix = true;
    }
    
    // 3. 对于新榜接口的新闻，强制确保摘要和关键词不为空（除非内容为空或乱码）
    if ((interfaceType === '新榜' || interfaceType === '新榜接口')) {
      const isContentEmpty = !content || content.trim().length === 0;
      const isContentDirty = content && this.isContentContaminated(content);
      const isImageContent = this.isImageOnlyContent(content);
      
      // 如果内容为空、乱码或只是图片，允许摘要和关键词为空或使用默认值
      const allowEmpty = isContentEmpty || isContentDirty || isImageContent;
      
      if (!allowEmpty) {
        // 内容有效，强制确保摘要和关键词不为空
        if (!validatedAbstract || validatedAbstract.trim().length === 0) {
          console.warn(`[validateAnalysisResult] ⚠️ 新榜接口：摘要为空，强制生成摘要`);
          // 尝试从原文提取摘要
          if (content && content.trim().length > 20) {
            const extractedAbstract = this.extractCompleteAbstract(title, content, '');
            if (extractedAbstract && extractedAbstract.length >= 20) {
              validatedAbstract = extractedAbstract;
              console.log(`[validateAnalysisResult] ✓ 已从原文强制提取摘要，长度: ${validatedAbstract.length}字符`);
            } else {
              // 如果提取失败，基于标题和内容生成
              validatedAbstract = title && title.length > 5 ? `${title}相关新闻报道。` : '新闻内容摘要。';
              console.warn(`[validateAnalysisResult] 无法从原文提取，使用标题生成摘要`);
            }
          } else {
            validatedAbstract = title && title.length > 5 ? `${title}相关新闻报道。` : '新闻内容摘要。';
            console.warn(`[validateAnalysisResult] content为空或太短，使用标题生成摘要`);
          }
          needsFix = true;
        }
        
        if (!validatedKeywords || validatedKeywords.length === 0) {
          console.warn(`[validateAnalysisResult] ⚠️ 新榜接口：关键词为空，强制生成关键词`);
          // 从标题和内容推断关键词
          const inferredKeywords = this.inferKeywordsFromContent(title, content);
          if (inferredKeywords.length > 0) {
            validatedKeywords = inferredKeywords;
            console.log(`[validateAnalysisResult] ✓ 已强制推断关键词: ${JSON.stringify(validatedKeywords)}`);
          } else {
            // 如果推断失败，至少保留一个基于标题的关键词
            validatedKeywords = ['新闻资讯'];
            console.warn(`[validateAnalysisResult] 无法推断关键词，使用默认关键词`);
          }
          needsFix = true;
        }
      } else {
        console.log(`[validateAnalysisResult] 新榜接口：内容为空/乱码/图片，允许摘要和关键词为空或使用默认值`);
      }
    }
    
    if (needsFix) {
      console.log(`[validateAnalysisResult] ✓ 校验完成，已修复分析结果`);
      console.log(`[validateAnalysisResult] 修复后的摘要: ${validatedAbstract.substring(0, 100)}...`);
      console.log(`[validateAnalysisResult] 修复后的关键词: ${JSON.stringify(validatedKeywords)}`);
    } else {
      console.log(`[validateAnalysisResult] ✓ 校验通过，分析结果正常`);
    }
    
    return {
      sentiment: analysis.sentiment,
      sentiment_reason: analysis.sentiment_reason,
      keywords: validatedKeywords,
      news_abstract: validatedAbstract
    };
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
      // 对于企查查接口的数据，无论企业是否在invested_enterprises表中，都需要进行二次校验
      // 对于新榜接口的数据，如果企业来自invested_enterprises表且状态不为"完全退出"，则不需要验证
      let finalEnterpriseName = newsItem.enterprise_full_name;
      let shouldValidate = true;
      const interfaceType = newsItem.APItype || '新榜';
      const isXinbang = (interfaceType === '新榜' || interfaceType === '新榜接口');
      
      console.log(`[processNewsWithEnterprise] 检查企业是否来自invested_enterprises表...`);
      console.log(`[processNewsWithEnterprise] 接口类型: ${interfaceType}`);
      
      try {
        // 对于企查查接口的数据，始终需要进行二次校验
        if (interfaceType === '企查查' || interfaceType === 'qichacha') {
          console.log(`[processNewsWithEnterprise] 企查查接口数据，需要进行二次校验关联性`);
          shouldValidate = true;
        } else {
          // 对于新榜接口的数据，检查企业是否在invested_enterprises表中
          const enterpriseCheck = await db.query(
            `SELECT enterprise_full_name, exit_status, delete_mark
             FROM invested_enterprises 
             WHERE enterprise_full_name = ? 
             AND exit_status NOT IN ('完全退出', '已上市', '不再观察')
             AND delete_mark = 0 
             LIMIT 1`,
            [newsItem.enterprise_full_name]
          );
          
          console.log(`[processNewsWithEnterprise] 查询结果数量: ${enterpriseCheck.length}`);
          if (enterpriseCheck.length > 0) {
            console.log(`[processNewsWithEnterprise] 查询结果详情:`, enterpriseCheck[0]);
            // 该企业来自invested_enterprises表且状态不为"完全退出"
            // 对于新榜接口的数据，不需要验证关联性，直接保持企业全称
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
        }
      } catch (e) {
        console.error(`[processNewsWithEnterprise] ❌ 检查企业状态时出错:`, e.message);
        console.error(`[processNewsWithEnterprise] 错误堆栈:`, e.stack);
      }
      
      // 只有需要验证的才进行AI验证
      let shouldKeepAssociation = true; // 默认保持关联
      if (shouldValidate) {
        console.log(`[processNewsWithEnterprise] 需要AI验证企业关联性（接口类型: ${interfaceType}）`);
        // 确保新闻有内容（如果content为空但有source_url，则从URL抓取）
        const validationContent = await this.ensureNewsContent(newsItem);
        
        // 重新验证企业关联的合理性
        shouldKeepAssociation = await this.validateExistingAssociation(
          newsItem.title,
          validationContent || newsItem.content || '', // 使用抓取到的内容，如果为空则使用原始content
          newsItem.enterprise_full_name,
          interfaceType
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

      // 检查是否是额外公众号的新闻
      const isAdditionalAccount = await db.query(
        `SELECT id FROM additional_wechat_accounts 
         WHERE wechat_account_id = ? 
         AND status = 'active' 
         AND delete_mark = 0`,
        [newsItem.wechat_account]
      );

      console.log(`[processNewsWithEnterprise] 开始分析新闻情绪和类型...`);
      
      // 确保新闻有内容（如果content为空但有source_url，则从URL抓取）
      // 对于新榜接口，如果content已经存在且有效（不包含乱码），不应该强制重新抓取
      const hasValidContentForAnalysis = newsItem.content && 
                                         newsItem.content.trim() !== '' && 
                                         newsItem.content.length > 50 &&
                                         !newsItem.content.includes('无法提取正文内容') &&
                                         !newsItem.content.includes('正文无文字');
      const isContentContaminatedForAnalysis = newsItem.content && this.isContentContaminated(newsItem.content);
      
      // 对于新榜接口，如果content有效且不包含乱码，不强制重新抓取
      const shouldForceRefetch = !(isXinbang && hasValidContentForAnalysis && !isContentContaminatedForAnalysis);
      
      console.log(`[processNewsWithEnterprise] 接口类型: ${interfaceType}, 是否新榜接口: ${isXinbang}`);
      console.log(`[processNewsWithEnterprise] content有效性: ${hasValidContentForAnalysis}, 是否包含乱码: ${isContentContaminatedForAnalysis}`);
      console.log(`[processNewsWithEnterprise] 是否强制重新抓取: ${shouldForceRefetch}`);
      
      const actualContent = await this.ensureNewsContent(newsItem, shouldForceRefetch);
      
      // 确保使用清理后的内容
      const contentForAnalysis = actualContent || newsItem.content || '';
      console.log(`[processNewsWithEnterprise] 准备分析，内容长度: ${contentForAnalysis.length}字符`);
      if (contentForAnalysis.length === 0) {
        console.warn(`[processNewsWithEnterprise] ⚠️ 警告：内容为空，可能无法生成有效摘要`);
      } else {
        console.log(`[processNewsWithEnterprise] 内容预览: ${contentForAnalysis.substring(0, 100)}...`);
      }
      
      // interfaceType已在前面声明，直接使用
      const analysis = await this.analyzeNewsSentimentAndType(
        newsItem.title,
        contentForAnalysis, // 使用确保后的内容
        newsItem.source_url,
        isAdditionalAccount.length > 0, // 传递是否是额外公众号的标志
        interfaceType
      );
      console.log(`[processNewsWithEnterprise] 分析完成 - 情绪: ${analysis.sentiment}, 关键词: ${JSON.stringify(analysis.keywords)}`);

      // 在更新数据库之前，校验分析结果（摘要和关键词）
      console.log(`[processNewsWithEnterprise] 开始校验分析结果...`);
      let validatedAnalysis = this.validateAnalysisResult(analysis, newsItem.title, contentForAnalysis, interfaceType);
      
      // 对于新榜接口的新闻，强制检查摘要和关键词是否为空（除非内容为空或乱码）
      if ((interfaceType === '新榜' || interfaceType === '新榜接口')) {
        const isContentEmpty = !contentForAnalysis || contentForAnalysis.trim().length === 0;
        const isContentDirty = contentForAnalysis && this.isContentContaminated(contentForAnalysis);
        const isImageContent = this.isImageOnlyContent(contentForAnalysis);
        const allowEmpty = isContentEmpty || isContentDirty || isImageContent;
        
        if (!allowEmpty) {
          // 内容有效，强制确保摘要和关键词不为空
          if (!validatedAnalysis.news_abstract || validatedAnalysis.news_abstract.trim().length === 0) {
            console.warn(`[processNewsWithEnterprise] ⚠️ 新榜接口：摘要为空，强制重新生成`);
            // 重新分析以生成摘要
            const reAnalysis = await this.analyzeNewsSentimentAndType(
              newsItem.title,
              contentForAnalysis,
              newsItem.source_url,
              isAdditionalAccount.length > 0,
              interfaceType
            );
            const reValidatedAnalysis = this.validateAnalysisResult(reAnalysis, newsItem.title, contentForAnalysis, interfaceType);
            validatedAnalysis.news_abstract = reValidatedAnalysis.news_abstract;
            validatedAnalysis.keywords = reValidatedAnalysis.keywords;
          }
          
          if (!validatedAnalysis.keywords || validatedAnalysis.keywords.length === 0) {
            console.warn(`[processNewsWithEnterprise] ⚠️ 新榜接口：关键词为空，强制重新生成`);
            // 重新分析以生成关键词
            const reAnalysis = await this.analyzeNewsSentimentAndType(
              newsItem.title,
              contentForAnalysis,
              newsItem.source_url,
              isAdditionalAccount.length > 0,
              interfaceType
            );
            const reValidatedAnalysis = this.validateAnalysisResult(reAnalysis, newsItem.title, contentForAnalysis, interfaceType);
            validatedAnalysis.news_abstract = reValidatedAnalysis.news_abstract || validatedAnalysis.news_abstract;
            validatedAnalysis.keywords = reValidatedAnalysis.keywords;
          }
        }
      }
      
      // 更新数据库，包括可能的企业关联变更
      console.log(`[processNewsWithEnterprise] 准备更新数据库`);
      console.log(`[processNewsWithEnterprise] 企业全称: "${finalEnterpriseName || '(空)'}"`);
      console.log(`[processNewsWithEnterprise] 情绪: ${validatedAnalysis.sentiment}`);
      console.log(`[processNewsWithEnterprise] 关键词: ${JSON.stringify(validatedAnalysis.keywords)}`);
      console.log(`[processNewsWithEnterprise] 摘要: ${validatedAnalysis.news_abstract.substring(0, 100)}...`);
      console.log(`[processNewsWithEnterprise] 内容长度: ${contentForAnalysis ? contentForAnalysis.length : 0}字符`);
      
      // 确保content字段也被更新（如果ensureNewsContent成功抓取了内容）
      // 对于新榜接口，如果原始content有效且不包含乱码，优先使用原始content
      let contentToSave = null;
      if (isXinbang && hasValidContentForAnalysis && !isContentContaminatedForAnalysis) {
        // 新榜接口且content有效，使用原始content，不覆盖
        contentToSave = newsItem.content;
        console.log(`[processNewsWithEnterprise] 新榜接口且content有效，保留原始content，不覆盖`);
      } else {
        // 其他情况，使用抓取到的内容或原始content
        contentToSave = contentForAnalysis || newsItem.content || null;
      }
      console.log(`[processNewsWithEnterprise] 执行SQL: UPDATE news_detail SET enterprise_full_name = ?, news_sentiment = ?, keywords = ?, news_abstract = ?, content = ? WHERE id = ?`);
      
      await db.execute(
        `UPDATE news_detail 
         SET enterprise_full_name = ?, news_sentiment = ?, keywords = ?, news_abstract = ?, content = ?
         WHERE id = ?`,
        [
          finalEnterpriseName,
          validatedAnalysis.sentiment,
          JSON.stringify(validatedAnalysis.keywords),
          validatedAnalysis.news_abstract,
          contentToSave,
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

      // 确保新闻有内容（如果content为空但有source_url，则从URL抓取）
      // 对于新榜接口，如果content已经存在且有效（不包含乱码），不应该强制重新抓取
      const interfaceType = newsItem.APItype || '新榜';
      const isXinbangForContent = (interfaceType === '新榜' || interfaceType === '新榜接口');
      const hasValidContentForAnalysis = newsItem.content && 
                                         newsItem.content.trim() !== '' && 
                                         newsItem.content.length > 50 &&
                                         !newsItem.content.includes('无法提取正文内容') &&
                                         !newsItem.content.includes('正文无文字');
      const isContentContaminatedForAnalysis = newsItem.content && this.isContentContaminated(newsItem.content);
      
      // 对于新榜接口，如果content有效且不包含乱码，不强制重新抓取
      const shouldForceRefetch = !(isXinbangForContent && hasValidContentForAnalysis && !isContentContaminatedForAnalysis);
      
      console.log(`[processNewsWithoutEnterprise] 接口类型: ${interfaceType}, 是否新榜接口: ${isXinbangForContent}`);
      console.log(`[processNewsWithoutEnterprise] content有效性: ${hasValidContentForAnalysis}, 是否包含乱码: ${isContentContaminatedForAnalysis}`);
      console.log(`[processNewsWithoutEnterprise] 是否强制重新抓取: ${shouldForceRefetch}`);
      
      const actualContent = await this.ensureNewsContent(newsItem, shouldForceRefetch);
      
      // 分析企业关联性
      const relevantEnterprises = await this.analyzeEnterpriseRelevance(
        newsItem.title,
        actualContent || newsItem.content || '', // 使用抓取到的内容，如果为空则使用原始content
        enterprises,
        interfaceType
      );

      // 检查是否是额外公众号的新闻
      const isAdditionalAccount = await db.query(
        `SELECT id FROM additional_wechat_accounts 
         WHERE wechat_account_id = ? 
         AND status = 'active' 
         AND delete_mark = 0`,
        [newsItem.wechat_account]
      );

      // 确保新闻有内容（如果content为空但有source_url，则从URL抓取）
      // 对于新榜接口，如果content已经存在且有效（不包含乱码），不应该强制重新抓取
      const hasValidContentForAnalysis2 = newsItem.content && 
                                         newsItem.content.trim() !== '' && 
                                         newsItem.content.length > 50 &&
                                         !newsItem.content.includes('无法提取正文内容') &&
                                         !newsItem.content.includes('正文无文字');
      const isContentContaminatedForAnalysis2 = newsItem.content && this.isContentContaminated(newsItem.content);
      
      // 对于新榜接口，如果content有效且不包含乱码，不强制重新抓取
      const shouldForceRefetch2 = !(isXinbangForContent && hasValidContentForAnalysis2 && !isContentContaminatedForAnalysis2);
      
      console.log(`[processNewsWithoutEnterprise] 第二次调用ensureNewsContent，接口类型: ${interfaceType}, 是否新榜接口: ${isXinbangForContent}`);
      console.log(`[processNewsWithoutEnterprise] content有效性: ${hasValidContentForAnalysis2}, 是否包含乱码: ${isContentContaminatedForAnalysis2}`);
      console.log(`[processNewsWithoutEnterprise] 是否强制重新抓取: ${shouldForceRefetch2}`);
      
      const analysisContent = await this.ensureNewsContent(newsItem, shouldForceRefetch2);
      
      // 确保使用清理后的内容
      const contentForAnalysis = analysisContent || newsItem.content || '';
      console.log(`[processNewsWithoutEnterprise] 准备分析，内容长度: ${contentForAnalysis.length}字符`);
      if (contentForAnalysis.length === 0) {
        console.warn(`[processNewsWithoutEnterprise] ⚠️ 警告：内容为空，可能无法生成有效摘要`);
      } else {
        console.log(`[processNewsWithoutEnterprise] 内容预览: ${contentForAnalysis.substring(0, 100)}...`);
      }
      
      // 分析新闻情绪和类型（使用已确保的content）
      const analysis = await this.analyzeNewsSentimentAndType(
        newsItem.title,
        contentForAnalysis, // 使用确保后的内容
        newsItem.source_url,
        isAdditionalAccount.length > 0, // 传递是否是额外公众号的标志
        interfaceType
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
        // 在更新数据库之前，校验分析结果（摘要和关键词）
        console.log(`[processNewsWithoutEnterprise] 开始校验分析结果...`);
        let validatedAnalysis = this.validateAnalysisResult(analysis, newsItem.title, contentForAnalysis, interfaceType);
        
        // 对于新榜接口的新闻，强制检查摘要和关键词是否为空（除非内容为空或乱码）
        if ((interfaceType === '新榜' || interfaceType === '新榜接口')) {
          const isContentEmpty = !contentForAnalysis || contentForAnalysis.trim().length === 0;
          const isContentDirty = contentForAnalysis && this.isContentContaminated(contentForAnalysis);
          const isImageContent = this.isImageOnlyContent(contentForAnalysis);
          const allowEmpty = isContentEmpty || isContentDirty || isImageContent;
          
          if (!allowEmpty) {
            // 内容有效，强制确保摘要和关键词不为空
            if (!validatedAnalysis.news_abstract || validatedAnalysis.news_abstract.trim().length === 0) {
              console.warn(`[processNewsWithoutEnterprise] ⚠️ 新榜接口：摘要为空，强制重新生成`);
              // 重新分析以生成摘要
              const reAnalysis = await this.analyzeNewsSentimentAndType(
                newsItem.title,
                contentForAnalysis,
                newsItem.source_url,
                isAdditionalAccount.length > 0,
                interfaceType
              );
              const reValidatedAnalysis = this.validateAnalysisResult(reAnalysis, newsItem.title, contentForAnalysis, interfaceType);
              validatedAnalysis.news_abstract = reValidatedAnalysis.news_abstract;
              validatedAnalysis.keywords = reValidatedAnalysis.keywords;
            }
            
            if (!validatedAnalysis.keywords || validatedAnalysis.keywords.length === 0) {
              console.warn(`[processNewsWithoutEnterprise] ⚠️ 新榜接口：关键词为空，强制重新生成`);
              // 重新分析以生成关键词
              const reAnalysis = await this.analyzeNewsSentimentAndType(
                newsItem.title,
                contentForAnalysis,
                newsItem.source_url,
                isAdditionalAccount.length > 0,
                interfaceType
              );
              const reValidatedAnalysis = this.validateAnalysisResult(reAnalysis, newsItem.title, contentForAnalysis, interfaceType);
              validatedAnalysis.news_abstract = reValidatedAnalysis.news_abstract || validatedAnalysis.news_abstract;
              validatedAnalysis.keywords = reValidatedAnalysis.keywords;
            }
          }
        }
        
        // 确保content字段也被更新（如果ensureNewsContent成功抓取了内容）
        // 对于新榜接口，如果原始content有效且不包含乱码，优先使用原始content
        let contentToSave = null;
        if (isXinbangForContent && hasValidContentForAnalysis2 && !isContentContaminatedForAnalysis2) {
          // 新榜接口且content有效，使用原始content，不覆盖
          contentToSave = newsItem.content;
          console.log(`[processNewsWithoutEnterprise] 新榜接口且content有效，保留原始content，不覆盖`);
        } else {
          // 其他情况，使用抓取到的内容或原始content
          contentToSave = contentForAnalysis || newsItem.content || null;
        }
        console.log(`[processNewsWithoutEnterprise] 内容长度: ${contentToSave ? contentToSave.length : 0}字符`);
        
        await db.execute(
          `UPDATE news_detail 
           SET news_sentiment = ?, keywords = ?, news_abstract = ?, content = ?
           WHERE id = ?`,
          [
            validatedAnalysis.sentiment,
            JSON.stringify(validatedAnalysis.keywords),
            validatedAnalysis.news_abstract,
            contentToSave,
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
             WHERE enterprise_full_name = ? AND delete_mark = 0 AND exit_status NOT IN ('完全退出', '已上市', '不再观察')`,
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
          // 在更新数据库之前，校验分析结果（摘要和关键词）
          console.log(`[processNewsWithoutEnterprise] 开始校验分析结果（无有效企业关联）...`);
          const validatedAnalysis = this.validateAnalysisResult(analysis, newsItem.title, contentForAnalysis);
          
          // 确保content字段也被更新（如果ensureNewsContent成功抓取了内容）
          // 对于新榜接口，如果原始content有效且不包含乱码，优先使用原始content
          let contentToSave2 = null;
          if (isXinbangForContent && hasValidContentForAnalysis2 && !isContentContaminatedForAnalysis2) {
            // 新榜接口且content有效，使用原始content，不覆盖
            contentToSave2 = newsItem.content;
            console.log(`[processNewsWithoutEnterprise] 新榜接口且content有效，保留原始content，不覆盖`);
          } else {
            // 其他情况，使用抓取到的内容或原始content
            contentToSave2 = contentForAnalysis || newsItem.content || null;
          }
          console.log(`[processNewsWithoutEnterprise] 内容长度: ${contentToSave2 ? contentToSave2.length : 0}字符`);
          
          await db.execute(
            `UPDATE news_detail 
             SET news_sentiment = ?, keywords = ?, news_abstract = ?, content = ?
             WHERE id = ?`,
            [
              validatedAnalysis.sentiment,
              JSON.stringify(validatedAnalysis.keywords),
              validatedAnalysis.news_abstract,
              contentToSave2,
              newsItem.id
            ]
          );
          console.log(`✓ 已完成新闻分析（无有效企业关联): ${newsItem.id}`);
        } else {
          // 处理有效的企业关联
          // 在更新数据库之前，先校验分析结果（摘要和关键词），所有记录使用相同的校验结果
          console.log(`[processNewsWithoutEnterprise] 开始校验分析结果（有企业关联）...`);
          const validatedAnalysis = this.validateAnalysisResult(analysis, newsItem.title, contentForAnalysis);
          
          for (let i = 0; i < validEnterprises.length; i++) {
            const enterprise = validEnterprises[i];
            
            if (i === 0) {
              // 更新原记录
              // 确保content字段也被更新（如果ensureNewsContent成功抓取了内容）
              // 对于新榜接口，如果原始content有效且不包含乱码，优先使用原始content
              let contentToSave3 = null;
              if (isXinbangForContent && hasValidContentForAnalysis2 && !isContentContaminatedForAnalysis2) {
                // 新榜接口且content有效，使用原始content，不覆盖
                contentToSave3 = newsItem.content;
                console.log(`[processNewsWithoutEnterprise] 新榜接口且content有效，保留原始content，不覆盖`);
              } else {
                // 其他情况，使用抓取到的内容或原始content
                contentToSave3 = contentForAnalysis || newsItem.content || null;
              }
              
              await db.execute(
                `UPDATE news_detail 
                 SET enterprise_full_name = ?, news_sentiment = ?, keywords = ?, news_abstract = ?, content = ?
                 WHERE id = ?`,
                [
                  enterprise.enterprise_name,
                  validatedAnalysis.sentiment,
                  JSON.stringify(validatedAnalysis.keywords),
                  validatedAnalysis.news_abstract,
                  contentToSave3,
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
                  JSON.stringify(validatedAnalysis.keywords),
                  validatedAnalysis.news_abstract,
                  validatedAnalysis.sentiment,
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
  /**
   * 补充新榜接口数据的摘要和关键词（在批量分析完成后调用）
   * 检查新榜接口中content不为空但摘要或关键词为空的记录，重新调用AI分析
   * @returns {Promise<number>} - 补充的记录数
   */
  async supplementXinbangNewsAnalysis() {
    try {
      console.log('[补充新榜分析] 开始查询需要补充的新榜接口数据...');
      
      // 查询新榜接口中content不为空但摘要或关键词为空的记录
      const newsToSupplement = await db.query(
        `SELECT id, title, content, source_url, wechat_account, enterprise_full_name, account_name
         FROM news_detail 
         WHERE APItype = '新榜'
         AND content IS NOT NULL 
         AND content != ''
         AND (news_abstract IS NULL OR news_abstract = '' OR keywords IS NULL OR keywords = '[]' OR keywords = '')
         AND delete_mark = 0
         ORDER BY created_at DESC
         LIMIT 100`,
        []
      );

      if (newsToSupplement.length === 0) {
        console.log('[补充新榜分析] 没有需要补充的新榜接口数据');
        return 0;
      }

      console.log(`[补充新榜分析] 找到 ${newsToSupplement.length} 条需要补充的新榜接口数据`);

      let supplementCount = 0;
      const interfaceType = '新榜';

      for (const newsItem of newsToSupplement) {
        try {
          // 检查是否是额外公众号
          const isAdditionalAccountResult = await db.query(
            `SELECT id FROM additional_wechat_accounts 
             WHERE wechat_account_id = ? 
             AND status = 'active' 
             AND delete_mark = 0`,
            [newsItem.wechat_account]
          );
          const isAdditionalAccount = isAdditionalAccountResult.length > 0;

          // 检查内容是否被污染
          const isContentDirty = newsItem.content && this.isContentContaminated(newsItem.content);
          
          let analysisResult = null;
          let finalContent = newsItem.content || '';
          
          if (isContentDirty) {
            // 内容被污染，尝试从source_url提取内容
            if (newsItem.source_url && newsItem.source_url.includes('mp.weixin.qq.com')) {
              try {
                console.log(`[补充新榜分析] 新闻ID ${newsItem.id} 内容被污染，尝试从微信公众号URL提取内容: ${newsItem.source_url}`);
                const extractResult = await this.extractWeChatArticleContent(newsItem.source_url);
                
                if (extractResult.success && extractResult.content && extractResult.content.trim().length > 0) {
                  finalContent = extractResult.content;
                  console.log(`[补充新榜分析] ✓ 成功从微信公众号提取内容，长度: ${finalContent.length}字符`);
                  
                  // 更新数据库中的content
                  await db.execute(
                    'UPDATE news_detail SET content = ? WHERE id = ?',
                    [finalContent, newsItem.id]
                  );
                  
                  // 使用提取的内容进行AI分析
                  analysisResult = await this.analyzeNewsSentimentAndType(
                    newsItem.title,
                    finalContent,
                    newsItem.source_url || '',
                    isAdditionalAccount,
                    interfaceType
                  );
                } else {
                  // 提取失败，使用默认处理
                  console.log(`[补充新榜分析] 从微信公众号提取内容失败，使用默认处理`);
                  const inferredKeywords = this.inferKeywordsFromContent(newsItem.title, '');
                  const finalKeywords = inferredKeywords.length > 0 ? inferredKeywords : ['图片内容'];
                  const finalAbstract = '无正文内容，该新闻为图片，请查看详情';
                  
                  analysisResult = {
                    sentiment: 'neutral',
                    sentiment_reason: '无正文内容，该新闻为图片，请查看详情',
                    keywords: finalKeywords,
                    news_abstract: finalAbstract
                  };
                }
              } catch (extractError) {
                console.error(`[补充新榜分析] 从微信公众号提取内容时出错: ${extractError.message}`);
                // 提取失败，使用默认处理
                const inferredKeywords = this.inferKeywordsFromContent(newsItem.title, '');
                const finalKeywords = inferredKeywords.length > 0 ? inferredKeywords : ['图片内容'];
                const finalAbstract = '无正文内容，该新闻为图片，请查看详情';
                
                analysisResult = {
                  sentiment: 'neutral',
                  sentiment_reason: '无正文内容，该新闻为图片，请查看详情',
                  keywords: finalKeywords,
                  news_abstract: finalAbstract
                };
              }
            } else {
              // 不是微信公众号URL或没有source_url，使用默认处理
              console.log(`[补充新榜分析] 新闻ID ${newsItem.id} 内容被污染，且不是微信公众号URL，使用默认处理`);
              const inferredKeywords = this.inferKeywordsFromContent(newsItem.title, '');
              const finalKeywords = inferredKeywords.length > 0 ? inferredKeywords : ['图片内容'];
              const finalAbstract = '无正文内容，该新闻为图片，请查看详情';
              
              analysisResult = {
                sentiment: 'neutral',
                sentiment_reason: '无正文内容，该新闻为图片，请查看详情',
                keywords: finalKeywords,
                news_abstract: finalAbstract
              };
            }
          } else {
            // 内容有效，调用AI分析
            console.log(`[补充新榜分析] 新闻ID ${newsItem.id} 调用AI分析，内容长度: ${newsItem.content.length}字符`);
            analysisResult = await this.analyzeNewsSentimentAndType(
              newsItem.title,
              newsItem.content,
              newsItem.source_url || '',
              isAdditionalAccount,
              interfaceType
            );
          }

          // 更新数据库
          if (analysisResult) {
            await db.execute(
              `UPDATE news_detail 
               SET news_sentiment = ?, keywords = ?, news_abstract = ?
               WHERE id = ?`,
              [
                analysisResult.sentiment || 'neutral',
                JSON.stringify(analysisResult.keywords || []),
                analysisResult.news_abstract || '',
                newsItem.id
              ]
            );
            supplementCount++;
            console.log(`[补充新榜分析] ✓ 已补充新闻ID: ${newsItem.id}`);
          }

          // 如果是额外公众号，执行企业关联分析和关联验证
          if (isAdditionalAccount && finalContent && finalContent.trim().length > 0) {
            try {
              console.log(`[补充新榜分析] 额外公众号新闻，执行企业关联分析，新闻ID: ${newsItem.id}`);
              
              // 获取所有被投企业信息
              const enterprises = await db.query(
                `SELECT enterprise_full_name, project_abbreviation 
                 FROM invested_enterprises 
                 WHERE delete_mark = 0 
                 AND exit_status NOT IN ('完全退出', '已上市')`
              );

              if (enterprises.length > 0) {
                // 分析企业关联性
                const relevantEnterprises = await this.analyzeEnterpriseRelevance(
                  newsItem.title,
                  finalContent,
                  enterprises,
                  interfaceType
                );

                if (relevantEnterprises.length > 0) {
                  // 有相关企业，更新企业全称
                  const firstEnterprise = relevantEnterprises[0];
                  await db.execute(
                    'UPDATE news_detail SET enterprise_full_name = ? WHERE id = ?',
                    [firstEnterprise.enterprise_name, newsItem.id]
                  );
                  console.log(`[补充新榜分析] ✓ 额外公众号新闻已关联企业: ${firstEnterprise.enterprise_name}, 新闻ID: ${newsItem.id}`);
                }
              }
            } catch (enterpriseError) {
              console.error(`[补充新榜分析] 额外公众号企业关联分析失败，新闻ID: ${newsItem.id}, 错误: ${enterpriseError.message}`);
            }
          }

          // 添加延迟避免API频率限制
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`[补充新榜分析] 处理新闻 ${newsItem.id} 时出错:`, error);
        }
      }

      return supplementCount;
    } catch (error) {
      console.error('[补充新榜分析] 补充新榜接口数据失败:', error);
      return 0;
    }
  }

  /**
   * 调用Python脚本提取微信公众号文章内容
   * @param {string} url - 文章URL
   * @returns {Promise<Object>} - 提取结果
   */
  async extractWeChatArticleContent(url) {
    try {
      const { spawn } = require('child_process');
      const path = require('path');
      
      // 获取图片识别模型配置
      const imageModelConfig = await db.query(
        `SELECT * FROM ai_model_config 
         WHERE usage_type = 'image_recognition' 
         AND is_active = 1 
         AND delete_mark = 0 
         ORDER BY created_at DESC 
         LIMIT 1`
      );
      
      const pythonScriptPath = path.join(__dirname, 'wechatArticleExtractor.py');
      const args = [pythonScriptPath, url];
      
      // 如果有图片识别模型配置，传递配置JSON
      if (imageModelConfig.length > 0) {
        const config = imageModelConfig[0];
        const configJson = JSON.stringify({
          api_endpoint: config.api_endpoint,
          api_key: config.api_key,
          model_name: config.model_name,
          api_type: config.api_type,
          temperature: config.temperature,
          max_tokens: config.max_tokens
        });
        args.push(configJson);
      }
      
      return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python3', args, {
          cwd: __dirname,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        pythonProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        pythonProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        pythonProcess.on('close', (code) => {
          if (code !== 0) {
            console.error(`[提取微信公众号文章] Python脚本执行失败，退出码: ${code}, 错误: ${stderr}`);
            reject(new Error(`Python脚本执行失败: ${stderr}`));
            return;
          }
          
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (parseError) {
            console.error(`[提取微信公众号文章] 解析Python脚本输出失败: ${parseError.message}`);
            console.error(`[提取微信公众号文章] 输出内容: ${stdout}`);
            reject(new Error(`解析输出失败: ${parseError.message}`));
          }
        });
        
        pythonProcess.on('error', (error) => {
          console.error(`[提取微信公众号文章] 启动Python脚本失败: ${error.message}`);
          reject(error);
        });
      });
    } catch (error) {
      console.error(`[提取微信公众号文章] 调用Python脚本失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 立即分析新榜接口的新闻（在入库后立即调用）
   * @param {Object} newsItem - 新闻对象（包含id, title, content, source_url, wechat_account, enterprise_full_name等）
   * @param {boolean} isAdditionalAccount - 是否是额外公众号
   * @returns {Promise<boolean>} - 是否分析成功
   */
  async analyzeXinbangNewsImmediately(newsItem, isAdditionalAccount = false) {
    try {
      console.log(`[立即分析新榜新闻] 开始分析新闻ID: ${newsItem.id}, 标题: ${newsItem.title.substring(0, 50)}...`);
      
      const interfaceType = '新榜';
      const hasContent = newsItem.content && newsItem.content.trim().length > 0;
      const isContentDirty = newsItem.content && this.isContentContaminated(newsItem.content);
      
      let analysisResult = null;
      let finalContent = newsItem.content || '';
      
      if (!hasContent || isContentDirty) {
        // content为空或包含乱码，尝试从source_url提取内容
        if (newsItem.source_url && newsItem.source_url.includes('mp.weixin.qq.com')) {
          try {
            console.log(`[立即分析新榜新闻] content为空或包含乱码，尝试从微信公众号URL提取内容: ${newsItem.source_url}`);
            const extractResult = await this.extractWeChatArticleContent(newsItem.source_url);
            
            if (extractResult.success && extractResult.content && extractResult.content.trim().length > 0) {
              finalContent = extractResult.content;
              console.log(`[立即分析新榜新闻] ✓ 成功从微信公众号提取内容，长度: ${finalContent.length}字符`);
              
              // 更新数据库中的content
              await db.execute(
                'UPDATE news_detail SET content = ? WHERE id = ?',
                [finalContent, newsItem.id]
              );
              
              // 使用提取的内容进行AI分析
              analysisResult = await this.analyzeNewsSentimentAndType(
                newsItem.title,
                finalContent,
                newsItem.source_url || '',
                isAdditionalAccount,
                interfaceType
              );
            } else {
              // 提取失败，使用默认处理
              console.log(`[立即分析新榜新闻] 从微信公众号提取内容失败，使用默认处理`);
              const inferredKeywords = this.inferKeywordsFromContent(newsItem.title, '');
              const finalKeywords = inferredKeywords.length > 0 ? inferredKeywords : ['图片内容'];
              const finalAbstract = '无正文内容，该新闻为图片，请查看详情';
              
              analysisResult = {
                sentiment: 'neutral',
                sentiment_reason: '无正文内容，该新闻为图片，请查看详情',
                keywords: finalKeywords,
                news_abstract: finalAbstract
              };
            }
          } catch (extractError) {
            console.error(`[立即分析新榜新闻] 从微信公众号提取内容时出错: ${extractError.message}`);
            // 提取失败，使用默认处理
            const inferredKeywords = this.inferKeywordsFromContent(newsItem.title, '');
            const finalKeywords = inferredKeywords.length > 0 ? inferredKeywords : ['图片内容'];
            const finalAbstract = '无正文内容，该新闻为图片，请查看详情';
            
            analysisResult = {
              sentiment: 'neutral',
              sentiment_reason: '无正文内容，该新闻为图片，请查看详情',
              keywords: finalKeywords,
              news_abstract: finalAbstract
            };
          }
        } else {
          // 不是微信公众号URL或没有source_url，使用默认处理
          console.log(`[立即分析新榜新闻] content为空或包含乱码，且不是微信公众号URL，使用默认处理`);
          const inferredKeywords = this.inferKeywordsFromContent(newsItem.title, '');
          const finalKeywords = inferredKeywords.length > 0 ? inferredKeywords : ['图片内容'];
          const finalAbstract = '无正文内容，该新闻为图片，请查看详情';
          
          analysisResult = {
            sentiment: 'neutral',
            sentiment_reason: '无正文内容，该新闻为图片，请查看详情',
            keywords: finalKeywords,
            news_abstract: finalAbstract
          };
        }
      } else {
        // content有内容，调用AI分析
        console.log(`[立即分析新榜新闻] content有内容，调用AI分析，内容长度: ${newsItem.content.length}字符`);
        analysisResult = await this.analyzeNewsSentimentAndType(
          newsItem.title,
          newsItem.content,
          newsItem.source_url || '',
          isAdditionalAccount,
          interfaceType
        );
      }
      
      // 更新数据库
      if (analysisResult) {
        await db.execute(
          `UPDATE news_detail 
           SET news_sentiment = ?, keywords = ?, news_abstract = ?
           WHERE id = ?`,
          [
            analysisResult.sentiment || 'neutral',
            JSON.stringify(analysisResult.keywords || []),
            analysisResult.news_abstract || '',
            newsItem.id
          ]
        );
        console.log(`[立即分析新榜新闻] ✓ 已更新数据库，新闻ID: ${newsItem.id}`);
        
        // 如果是额外公众号，执行企业关联分析和关联验证
        if (isAdditionalAccount && hasContent && !isContentDirty) {
          try {
            console.log(`[立即分析新榜新闻] 额外公众号新闻，执行企业关联分析，新闻ID: ${newsItem.id}`);
            
            // 获取所有被投企业信息
            const enterprises = await db.query(
              `SELECT enterprise_full_name, project_abbreviation 
               FROM invested_enterprises 
               WHERE delete_mark = 0 
               AND exit_status NOT IN ('完全退出', '已上市')`
            );

            if (enterprises.length > 0) {
              // 分析企业关联性
              const relevantEnterprises = await this.analyzeEnterpriseRelevance(
                newsItem.title,
                finalContent,
                enterprises,
                interfaceType
              );

              if (relevantEnterprises.length > 0) {
                // 有相关企业，更新企业全称
                const firstEnterprise = relevantEnterprises[0];
                await db.execute(
                  'UPDATE news_detail SET enterprise_full_name = ? WHERE id = ?',
                  [firstEnterprise.enterprise_name, newsItem.id]
                );
                console.log(`[立即分析新榜新闻] ✓ 额外公众号新闻已关联企业: ${firstEnterprise.enterprise_name}, 新闻ID: ${newsItem.id}`);
              }
            }
          } catch (enterpriseError) {
            console.error(`[立即分析新榜新闻] 额外公众号企业关联分析失败，新闻ID: ${newsItem.id}, 错误: ${enterpriseError.message}`);
          }
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`[立即分析新榜新闻] ✗ 分析失败，新闻ID: ${newsItem.id}, 错误: ${error.message}`);
      return false;
    }
  }

  async batchAnalyzeNews(limit = 50) {
    try {
      console.log('开始批量分析新闻...');
      
      // 获取需要分析的新闻（news_abstract为空的记录），包括公众号信息和接口类型
      const newsItems = await db.query(
        `SELECT id, title, content, source_url, enterprise_full_name, wechat_account, account_name, created_at, APItype
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
          // 检查内容是否是乱码（针对新榜接口的新闻）
          const interfaceType = newsItem.APItype || '新榜';
          if ((interfaceType === '新榜' || interfaceType === '新榜接口') && newsItem.content) {
            // 检查内容是否被污染（包含JavaScript代码、CSS样式等脏信息）
            if (this.isContentContaminated(newsItem.content)) {
              console.log(`[批量分析] ⚠️ 跳过乱码内容（新榜接口）: ${newsItem.id} - ${newsItem.title.substring(0, 50)}`);
              errorCount++;
              continue;
            }
            
            // 检查内容长度（至少20字符才认为是有效正文）
            if (newsItem.content.trim().length < 20) {
              console.log(`[批量分析] ⚠️ 跳过内容太短（新榜接口）: ${newsItem.id} - ${newsItem.title.substring(0, 50)}`);
              errorCount++;
              continue;
            }
          }
          
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

      // AI分析完成后，检查新榜接口数据，补充缺失的摘要和关键词
      let xinbangSupplementCount = 0;
      try {
        console.log('[批量分析] 开始检查新榜接口数据，补充缺失的摘要和关键词...');
        xinbangSupplementCount = await this.supplementXinbangNewsAnalysis();
        console.log(`[批量分析] 新榜接口数据补充完成: 补充了 ${xinbangSupplementCount} 条新闻的摘要和关键词`);
      } catch (supplementError) {
        console.error('[批量分析] 补充新榜接口数据失败:', supplementError);
      }

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

  /**
   * 从标题和内容推断关键词标签
   */
  inferKeywordsFromContent(title, content) {
    const fullText = ((title || '') + ' ' + (content || '')).toLowerCase();
    const keywords = [];
    
    // 关键词匹配规则（按优先级排序，节假日最优先）
    const keywordRules = [
      // 节假日标签优先判断（如果是节假日内容，只返回节假日标签）
      { 
        keywords: ['公祭日', '清明节', '春节', '国庆节', '中秋节', '劳动节', '端午节', '元旦', '纪念日', '节日', '节假日'],
        tag: '节假日',
        // 验证是否为节假日内容：标题或内容主要是节假日相关
        validate: (title, content) => {
          const titleLower = (title || '').toLowerCase();
          const contentLower = (content || '').toLowerCase();
          const fullText = titleLower + ' ' + contentLower;
          
          // 节假日关键词
          const holidayKeywords = ['公祭日', '清明节', '春节', '国庆节', '中秋节', '劳动节', '端午节', '元旦', '纪念日', '节日', '节假日'];
          
          // 检查标题是否包含节假日关键词
          const titleHasHoliday = holidayKeywords.some(kw => titleLower.includes(kw));
          if (titleHasHoliday) return true;
          
          // 检查内容开头部分是否主要是节假日相关（前300字）
          const contentStart = contentLower.substring(0, 300);
          const holidayCount = holidayKeywords.filter(kw => contentStart.includes(kw)).length;
          // 如果前300字中包含2个或以上节假日关键词，认为是节假日内容
          if (holidayCount >= 2) return true;
          
          // 检查是否明确提到节假日相关的活动（国家公祭日、缅怀、悼念等）
          if (/国家.*公祭|公祭.*日|缅怀.*遇难|悼念.*同胞|纪念.*日|节日.*活动|节假日/.test(fullText)) {
            return true;
          }
          
          return false;
        },
        // 如果是节假日，只返回这一个标签（独占标签）
        exclusive: true
      },
      // 政策信息标签：检测政策法规、征求意见稿、管理办法、通知等政策类新闻（优先级高于技术创新）
      { 
        keywords: ['政策', '法规', '办法', '条例', '规定', '通知', '意见', '征求意见', '征求意见稿', '管理办法', '实施细则', '指导意见', '暂行办法', '试行办法', '管理办法', '评估办法', '安全法', '数据安全', '网络安全', '网信办', '国家互联网信息办公室', '工信部', '发改委', '市场监管', '监管', '合规', '规范', '标准', '国家标准', '行业标准'],
        tag: '政策信息',
        // 验证条件：标题或内容明确提到政策、法规、办法、条例、通知等
        validate: (title, content) => {
          const titleLower = (title || '').toLowerCase();
          const contentLower = (content || '').toLowerCase();
          const fullText = titleLower + ' ' + contentLower;
          
          // 政策相关关键词
          const policyKeywords = [
            '政策', '法规', '办法', '条例', '规定', '通知', '意见', 
            '征求意见', '征求意见稿', '管理办法', '实施细则', '指导意见', 
            '暂行办法', '试行办法', '管理办法', '评估办法', 
            '安全法', '数据安全法', '网络安全法', '个人信息保护法',
            '网信办', '国家互联网信息办公室', '工信部', '发改委', 
            '市场监管', '监管', '合规', '规范', '标准', '国家标准', '行业标准',
            '公开征求意见', '向社会公开征求意见', '征求意见稿', 
            '第.*条', '第一条', '第二条', '第三条', '第四条', '第五条',
            '根据.*法', '根据.*条例', '根据.*规定', '根据.*办法',
            '应当遵守', '应当符合', '应当执行', '应当遵循'
          ];
          
          // 检查标题是否包含政策关键词
          const titleHasPolicy = policyKeywords.some(kw => titleLower.includes(kw));
          if (titleHasPolicy) {
            return true;
          }
          
          // 检查内容开头部分是否包含政策关键词（前500字）
          const contentStart = contentLower.substring(0, 500);
          const policyCount = policyKeywords.filter(kw => contentStart.includes(kw)).length;
          // 如果前500字中包含3个或以上政策关键词，认为是政策内容
          if (policyCount >= 3) {
            return true;
          }
          
          // 检查是否明确提到政策相关的活动（征求意见、管理办法、评估办法等）
          if (/征求意见|管理办法|评估办法|实施细则|指导意见|暂行办法|试行办法|公开征求意见|向社会公开征求意见|征求意见稿|第.*条|根据.*法|根据.*条例|根据.*规定|根据.*办法|应当遵守|应当符合|应当执行|应当遵循/.test(fullText)) {
            return true;
          }
          
          // 检查是否包含政策发布机构（网信办、工信部、发改委等）
          if (/网信办|国家互联网信息办公室|工信部|发改委|市场监管|监管机构|政府部门|国家机关/.test(fullText)) {
            return true;
          }
          
          return false;
        },
        // 政策信息标签优先级较高，但不是独占标签（可以与其他标签共存，但会优先于技术创新）
        priority: 1
      },
      // 会议事项标签：检测会议预告、会议召开等类型的新闻
      { 
        keywords: ['会议预告', '会议召开', '会议', '论坛', '座谈会', '研讨会', '交流会', '讨论会', '圆桌会', '峰会', '大会', '年会', '发布会', '启动会', '签约会', '路演', '说明会', '推介会', '培训会', '分享会', '学术会议', '行业会议', '战略会议', '董事会', '股东大会', '临时股东大会', '年度股东大会'],
        tag: '会议事项',
        // 验证条件：标题或内容明确提到会议相关活动
        validate: (title, content) => {
          const titleLower = (title || '').toLowerCase();
          const contentLower = (content || '').toLowerCase();
          const fullText = titleLower + ' ' + contentLower;
          
          // 会议相关关键词
          const meetingKeywords = [
            '会议预告', '会议召开', '会议', '论坛', '座谈会', '研讨会', '交流会', 
            '讨论会', '圆桌会', '峰会', '大会', '年会', '发布会', '启动会', 
            '签约会', '路演', '说明会', '推介会', '培训会', '分享会', 
            '学术会议', '行业会议', '战略会议', '董事会', '股东大会', 
            '临时股东大会', '年度股东大会', '会议通知', '会议公告', 
            '会议邀请', '会议报名', '会议议程', '会议日程', '会议安排',
            '即将召开', '即将举办', '即将举行', '召开会议', '举办会议', '举行会议'
          ];
          
          // 检查标题是否包含会议关键词
          const titleHasMeeting = meetingKeywords.some(kw => titleLower.includes(kw));
          if (titleHasMeeting) {
            return true;
          }
          
          // 检查内容开头部分是否包含会议关键词（前500字）
          const contentStart = contentLower.substring(0, 500);
          const meetingCount = meetingKeywords.filter(kw => contentStart.includes(kw)).length;
          // 如果前500字中包含2个或以上会议关键词，认为是会议内容
          if (meetingCount >= 2) {
            return true;
          }
          
          // 检查是否明确提到会议相关的活动（会议预告、会议召开、会议通知等）
          if (/会议预告|会议召开|会议通知|会议公告|会议邀请|会议报名|会议议程|会议日程|会议安排|召开会议|举办会议|举行会议|即将召开|即将举办|即将举行/.test(fullText)) {
            return true;
          }
          
          return false;
        }
      },
      // 获奖标签需要严格判断：必须明确描述企业获得奖项，排除论坛、座谈会、会诊等活动
      { 
        keywords: ['获奖', '荣誉', '认证', '称号', '资质'], 
        tag: '获奖',
        // 验证条件：必须明确在标题或正文中描述企业获得某类奖项
        validate: (title, content) => {
          const titleLower = (title || '').toLowerCase();
          const contentLower = (content || '').toLowerCase();
          const fullText = titleLower + ' ' + contentLower;
          
          // 排除条件：如果是论坛、座谈会、会诊、会议、分享会、研讨会、读图会等活动，不应标记为"获奖"
          const activityKeywords = ['论坛', '座谈会', '会诊', '会议', '分享会', '研讨会', '交流会', '讨论会', '圆桌会', '峰会', '读图会', '病例分享', '学术专场'];
          const hasActivityKeyword = activityKeywords.some(kw => titleLower.includes(kw) || contentLower.substring(0, 300).includes(kw));
          if (hasActivityKeyword) {
            // 如果标题或内容开头明确提到这些活动，即使有"获奖"、"荣誉"等词，也不应标记为"获奖"
            return false;
          }
          
          // 排除泛泛而谈的表述，如"获得了众多荣誉"、"获得了荣誉"等，必须明确具体奖项
          const vaguePatterns = [
            /获得了.*众多.*荣誉/,
            /获得了.*荣誉$/,
            /获得了.*荣誉[，。！？]/,
            /获得.*众多.*荣誉/,
            /获得.*荣誉$/,
            /获得.*荣誉[，。！？]/
          ];
          const hasVaguePattern = vaguePatterns.some(pattern => pattern.test(fullText));
          if (hasVaguePattern) {
            return false; // 泛泛而谈，不标记为"获奖"
          }
          
          // 排除"成为...供应商"、"成为...协办方"等参与性表述
          const participationPatterns = [
            /成为.*供应商/,
            /成为.*协办/,
            /成为.*合作/,
            /成为.*指定/,
            /担任.*供应商/,
            /担任.*协办/
          ];
          const hasParticipationPattern = participationPatterns.some(pattern => pattern.test(fullText));
          if (hasParticipationPattern && !/获得.*奖|荣获.*奖/.test(fullText)) {
            return false; // 只是参与或合作，不是获奖
          }
          
          // 必须明确提到企业获得具体的奖项、荣誉、认证等
          // 检查是否包含"获得XX奖"、"荣获XX奖"、"被授予XX"等明确表述
          // 要求"获得"或"荣获"后面必须跟具体的奖项名称，不能只是"荣誉"、"认证"等泛泛词汇
          const awardPatterns = [
            /获得.*[一二三四五六七八九十\d]+.*奖/,  // 获得XX奖（必须有具体奖项名称）
            /荣获.*[一二三四五六七八九十\d]+.*奖/,  // 荣获XX奖
            /获得.*年度.*奖/,  // 获得年度XX奖
            /荣获.*年度.*奖/,  // 荣获年度XX奖
            /获得.*[最佳|优秀|杰出|创新|领先|先进].*奖/,  // 获得最佳/优秀/杰出/创新/领先/先进XX奖
            /荣获.*[最佳|优秀|杰出|创新|领先|先进].*奖/,  // 荣获最佳/优秀/杰出/创新/领先/先进XX奖
            /被授予.*[一二三四五六七八九十\d]+.*奖/,  // 被授予XX奖
            /被授予.*[最佳|优秀|杰出|创新|领先|先进].*奖/,  // 被授予最佳/优秀/杰出/创新/领先/先进XX奖
            /获得.*[一二三四五六七八九十\d]+.*荣誉/,  // 获得XX荣誉（必须有具体荣誉名称）
            /荣获.*[一二三四五六七八九十\d]+.*荣誉/,  // 荣获XX荣誉
            /获得.*[一二三四五六七八九十\d]+.*认证/,  // 获得XX认证（必须有具体认证名称）
            /获得.*[一二三四五六七八九十\d]+.*称号/,  // 获得XX称号（必须有具体称号名称）
            /获得.*[一二三四五六七八九十\d]+.*资质/,  // 获得XX资质（必须有具体资质名称）
            /[企业公司].*获得.*[一二三四五六七八九十\d]+.*奖/,  // 企业获得XX奖
            /[企业公司].*荣获.*[一二三四五六七八九十\d]+.*奖/   // 企业荣获XX奖
          ];
          
          const hasAwardPattern = awardPatterns.some(pattern => pattern.test(fullText));
          if (!hasAwardPattern) {
            return false;
          }
          
          return true;
        }
      },
      // 榜单标签需要更严格的判断：标题必须包含"榜单"字样，或内容明确提到"发布榜单"、"榜单发布"等
      { 
        keywords: ['榜单'], 
        tag: '榜单',
        // 额外的验证条件：标题必须包含"榜单"，或内容明确提到企业发布榜单
        validate: (title, content) => {
          const titleLower = (title || '').toLowerCase();
          const contentLower = (content || '').toLowerCase();
          
          // 排除条件：如果是行业分享会、交流会、论坛等，即使有"榜单"也不应该标记
          if (/分享会|交流会|论坛|会议|研讨会/.test(titleLower) && !titleLower.includes('榜单')) {
            return false;
          }
          
          // 排除条件：如果是单独的获奖信息（标题包含"获奖"、"荣誉"等，但不包含"榜单"），不应该标记为榜单
          if ((/获奖|荣誉|认证|称号/.test(titleLower)) && !titleLower.includes('榜单')) {
            return false;
          }
          
          // 条件1：标题明确包含"榜单"字样（最优先）
          if (titleLower.includes('榜单')) {
            return true;
          }
          
          // 条件2：内容明确提到企业"发布榜单"、"榜单发布"、"推出榜单"等
          if (/发布.*榜单|榜单.*发布|推出.*榜单|榜单.*推出|公布.*榜单|榜单.*公布|企业.*榜单|榜单.*企业/.test(contentLower)) {
            return true;
          }
          
          // 其他情况不标记为榜单
          return false;
        }
      },
      { keywords: ['融资', '投资', '轮', '资金', '募资'], tag: '融资消息' },
      { keywords: ['合作', '伙伴', '战略', '联盟', '协议'], tag: '合作伙伴' },
      { keywords: ['产品', '发布', '推出', '上市', '新品'], tag: '产品发布' },
      // 人员招聘标签：检测招聘、招聘信息、实习生招聘、校园招聘等（优先级高于人事变动）
      { 
        keywords: ['招聘', '招聘信息', '实习生', '校园招聘', '社会招聘', '校招', '社招', '岗位', '职位', '应聘', '求职', '加入我们', '加入团队', '人才招聘', '人才需求', '招聘项目', '招聘启动', '招聘开启', '招聘开始', '招聘公告', '招聘通知', '招聘启事', '实习生招聘', '应届生招聘'],
        tag: '人员招聘',
        // 验证条件：标题或内容明确提到招聘相关信息
        validate: (title, content) => {
          const titleLower = (title || '').toLowerCase();
          const contentLower = (content || '').toLowerCase();
          const fullText = titleLower + ' ' + contentLower;
          
          // 招聘相关关键词
          const recruitmentKeywords = [
            '招聘', '招聘信息', '实习生', '校园招聘', '社会招聘', '校招', '社招', 
            '岗位', '职位', '应聘', '求职', '加入我们', '加入团队', '人才招聘', '人才需求',
            '招聘启动', '招聘开启', '招聘开始', '招聘公告', '招聘通知', '招聘启事',
            '实习生招聘', '应届生招聘', '2027届', '2026届', '2025届'
          ];
          
          // 检查标题是否包含招聘关键词
          const titleHasRecruitment = recruitmentKeywords.some(kw => titleLower.includes(kw));
          if (titleHasRecruitment) {
            return true;
          }
          
          // 检查内容开头部分是否包含招聘关键词（前300字）
          const contentStart = contentLower.substring(0, 300);
          const recruitmentCount = recruitmentKeywords.filter(kw => contentStart.includes(kw)).length;
          // 如果前300字中包含2个或以上招聘关键词，认为是招聘内容
          if (recruitmentCount >= 2) {
            return true;
          }
          
          return false;
        }
      },
      { keywords: ['技术', '创新', '突破', '研发', '专利'], tag: '技术创新' },
      { keywords: ['市场', '拓展', '扩张', '布局', '进入'], tag: '市场拓展' },
      { keywords: ['人事', '任命', '离职', '加入', '高管'], tag: '人事变动' },
      { keywords: ['财务', '财报', '营收', '利润', '业绩'], tag: '财务报告' },
      { keywords: ['广告', '推广', '营销', '宣传', '促销'], tag: '广告推广' },
      { keywords: ['安全', '防护', '漏洞', '修复', '安全'], tag: '安全防护' },
      { keywords: ['发展', '成长', '壮大', '进步'], tag: '企业发展' },
    ];
    
    for (const rule of keywordRules) {
      if (rule.keywords.some(kw => fullText.includes(kw))) {
        // 如果规则有验证函数，需要先验证
        if (rule.validate) {
          if (rule.validate(title, content)) {
            keywords.push(rule.tag);
            // 如果是独占标签（如节假日），只返回这一个标签
            if (rule.exclusive) {
              return keywords;
            }
            if (keywords.length >= 2) break; // 最多返回2个标签
          }
        } else {
          keywords.push(rule.tag);
          if (keywords.length >= 2) break; // 最多返回2个标签
        }
      }
    }
    
    // 如果没找到，返回行业分析
    if (keywords.length === 0) {
      keywords.push('行业分析');
    }
    
    return keywords;
  }

  /**
   * 检查摘要是否完整且包含核心内容
   */
  isAbstractComplete(abstract, title, content) {
    if (!abstract || abstract.length < 10) return false;
    
    // 检查是否包含引导语等无关内容
    if (/点击.*关注|欢迎关注|扫描.*二维码|关注.*公众号|点击左上方|点击上方.*关注/.test(abstract)) {
      return false; // 包含引导语，不是核心内容
    }
    
    // 检查是否以数字或未完成的短语结尾（如"还背着27."、"营收达到1."等）
    if (/[\d\.]+[。！？.!?]?$/.test(abstract.trim())) {
      const abstractTrimmed = abstract.trim();
      const lastChar = abstractTrimmed.slice(-1);
      // 如果以数字结尾，且不是以句号结尾，说明不完整
      if (!/[。！？.!?]$/.test(lastChar)) {
        return false;
      }
      // 即使以数字+句号结尾，检查数字前的表述是否完整
      const beforeLastNum = abstractTrimmed.replace(/[\d\.]+[。！？.!?]?$/, '').trim();
      // 如果数字前的内容太短（少于10字），可能不完整
      if (beforeLastNum.length < 10) {
        return false;
      }
      // 检查数字前的短语是否看起来完整（如"还背着27."中的"还背着"明显不完整）
      const lastPhrase = beforeLastNum.split(/[，。！？.!?]/).pop().trim();
      // 如果最后一个短语很短（少于5字）且以"着"、"了"、"的"等助词结尾，可能不完整
      if (lastPhrase.length < 5 && /[着了的]$/.test(lastPhrase)) {
        return false;
      }
      // 如果数字前的内容以"还"、"只"、"仅"等词结尾，且后面直接是数字，可能不完整
      // 检查最后几个字符是否包含这些词
      const lastFewChars = beforeLastNum.substring(Math.max(0, beforeLastNum.length - 5));
      if (/[还只仅]/.test(lastFewChars) && lastPhrase.length < 8) {
        // 如果最后几个字符包含"还/只/仅"且短语较短，可能不完整
        // 特别检查"还背着"、"还剩下"、"只剩下"等模式
        if (/还.*[着下]|只.*[剩下]|仅.*[剩下]/.test(lastPhrase)) {
          return false;
        }
      }
    }
    
    // 检查是否以句号结尾
    if (!/[。！？.!?]$/.test(abstract)) return false;
    
    // 检查是否只是原文的第一句话（如果摘要长度与原文前100字相似度很高，可能是简单复制）
    const contentStart = (content || '').trim().substring(0, 150);
    if (contentStart && abstract.length > 30) {
      // 检查摘要是否与原文开头高度相似（简单判断）
      const abstractWords = abstract.substring(0, 50);
      const contentWords = contentStart.substring(0, 50);
      // 如果前50字相似度超过80%，可能是直接复制，需要检查是否是总结性的
      let sameCount = 0;
      const minLen = Math.min(abstractWords.length, contentWords.length);
      for (let i = 0; i < minLen; i++) {
        if (abstractWords[i] === contentWords[i]) {
          sameCount++;
        }
      }
      const similarity = minLen > 0 ? sameCount / minLen : 0;
      
      // 更严格地检测：如果摘要与原文开头高度相似，可能是简单复制第一段话
      // 检查摘要是否与原文前200字高度相似（不仅仅是前50字）
      const abstractLong = abstract.substring(0, Math.min(abstract.length, 100));
      const contentLong = contentStart.substring(0, Math.min(contentStart.length, 200));
      let longSameCount = 0;
      const longMinLen = Math.min(abstractLong.length, contentLong.length);
      for (let i = 0; i < longMinLen; i++) {
        if (abstractLong[i] === contentLong[i]) {
          longSameCount++;
        }
      }
      const longSimilarity = longMinLen > 0 ? longSameCount / longMinLen : 0;
      
      // 如果相似度太高（超过60%）且摘要长度较短（可能只是第一段话），可能不是总结性的
      // 或者如果前100字的相似度超过70%，也认为是简单复制
      const isLikelyCopy = (similarity > 0.7 && abstract.length < 150) || 
                          (longSimilarity > 0.6 && abstract.length < 150);
      
      if (isLikelyCopy && contentStart.length > abstract.length * 1.2) {
        // 可能是简单复制第一段话，检查是否包含总结性的表述
        if (!/[总结|概括|要点|核心|主要|关键|总之|综上所述|总的来说|整体|总体|综合]/i.test(abstract)) {
          // 进一步检查：如果摘要末尾被截断（以数字结尾或明显不完整），则不合格
          if (/[\d\.]+[。！？.!?]$/.test(abstract)) {
            // 检查数字前的短语是否完整
            const beforeNum = abstract.replace(/[\d\.]+[。！？.!?]?$/, '').trim();
            const lastPhrase = beforeNum.split(/[，。！？.!?]/).pop().trim();
            // 如果最后短语包含"还背着"、"还剩下"等不完整模式，不合格
            if (/还.*[着下]|只.*[剩下]|仅.*[剩下]/.test(lastPhrase) && lastPhrase.length < 8) {
              return false;
            }
            // 如果数字前的内容以"还/只/仅"结尾，也不合格
            const lastFewChars = beforeNum.substring(Math.max(0, beforeNum.length - 5));
            if (/[还只仅]/.test(lastFewChars) && lastPhrase.length < 8) {
              return false;
            }
          }
          // 如果摘要长度太短，也可能不是总结性的
          if (abstract.length < 60) {
            return false;
          }
        }
      }
    }
    
    // 检查是否包含关键信息（至少包含标题中的关键词或内容的核心信息）
    const titleKeywords = (title || '').split(/[，。！？\s]+/).filter(w => w.length > 1);
    const hasTitleInfo = titleKeywords.length === 0 || titleKeywords.some(kw => abstract.includes(kw));
    
    // 检查摘要长度是否合理（至少30字，最多170字）
    if (abstract.length < 30 || abstract.length > 170) return false;
    
    // 检查是否包含完整的句子结构（至少包含一个动词或形容词）
    const hasVerb = /[进行|开展|发布|获得|实现|完成|达成|启动|推出|宣布|表示|认为|指出|强调|要求|希望|期待|计划|预计|将|已|正在|是|有|为|在|缅怀|悼念|纪念|面临|达到|实现|完成]/i.test(abstract);
    
    return hasTitleInfo && hasVerb;
  }

  /**
   * 从原文提取完整的摘要（跳过引导语等无关内容）
   * 改进：提取文章的核心内容，而不是简单提取第一段话
   */
  extractCompleteAbstract(title, content, existingAbstract) {
    const fullText = (content || '').trim();
    if (!fullText || fullText.length < 20) {
      // 如果内容太短，基于标题生成摘要
      if (title && title.length > 5) {
        return `${title}相关新闻报道。`;
      }
      return '新闻内容摘要。';
    }
    
    // 跳过开头的引导语、关注提示等无关内容
    let processedText = this.skipIrrelevantContent(fullText);
    
    // 策略：不要简单提取前170字，而是提取文章的核心内容
    // 1. 将文章按句子分割
    const sentences = processedText.match(/(.+?[。！？.!?])/g) || [];
    
    if (sentences.length === 0) {
      // 如果没有找到句子，返回基于标题的摘要
      if (title && title.length > 5) {
        return `${title}相关新闻报道。`;
      }
      return '新闻内容摘要。';
    }
    
    // 2. 跳过前1-2句（通常是引入性内容），寻找核心内容
    const titleKeywords = (title || '').split(/[，。！？\s]+/).filter(w => w.length > 1);
    let startIndex = 0;
    
    // 跳过前1-2句引入性内容
    if (sentences.length > 2) {
      startIndex = Math.min(1, sentences.length - 1); // 从第2句开始
    }
    
    // 查找包含标题关键词或重要信息的句子（核心内容通常在文章前1/3处）
    const searchRange = Math.min(Math.floor(sentences.length / 3), 5); // 在前1/3的句子中查找
    for (let i = startIndex; i < Math.min(startIndex + searchRange, sentences.length); i++) {
      const sentence = sentences[i];
      const hasTitleKeyword = titleKeywords.length === 0 || titleKeywords.some(kw => sentence.includes(kw));
      const hasImportantVerb = /[发布|宣布|表示|获得|实现|完成|达成|启动|推出|面临|达到|成为|是|有|为|在|涉及|关于|针对]/i.test(sentence);
      
      if (hasTitleKeyword || hasImportantVerb) {
        startIndex = i;
        break;
      }
    }
    
    // 3. 从核心句子开始，提取2-4句形成总结（不超过170字）
    let extracted = '';
    let extractedLength = 0;
    const maxLength = 170;
    
    // 从startIndex开始，提取2-4句核心内容
    for (let i = startIndex; i < Math.min(startIndex + 4, sentences.length); i++) {
      const sentence = sentences[i];
      if (extractedLength + sentence.length <= maxLength) {
        extracted += sentence;
        extractedLength += sentence.length;
      } else {
        // 如果加上这句会超过150字，检查是否可以截断这句
        const remaining = maxLength - extractedLength;
        if (remaining > 30) {
          // 如果剩余空间足够，尝试截取这句的一部分
          const truncated = sentence.substring(0, remaining);
          const lastSentenceMatch = truncated.match(/(.+[。！？.!?])/);
          if (lastSentenceMatch) {
            extracted += lastSentenceMatch[1];
          }
        }
        break;
      }
    }
    
    // 如果提取的内容太短（少于30字），尝试提取更多
    if (extracted.length < 30 && sentences.length > startIndex + 4) {
      // 继续提取更多句子
      for (let i = startIndex + 4; i < Math.min(startIndex + 6, sentences.length); i++) {
        const sentence = sentences[i];
        if (extractedLength + sentence.length <= maxLength) {
          extracted += sentence;
          extractedLength += sentence.length;
        } else {
          break;
        }
      }
    }
    
    // 如果提取的内容仍然太短，使用前170字作为备用（但至少跳过第一句）
    if (extracted.length < 30) {
      // 跳过第一句，从第二句开始提取
      if (sentences.length > 1) {
        extracted = sentences.slice(1, Math.min(4, sentences.length)).join('');
        if (extracted.length > maxLength) {
          // 如果超过170字，截断到最后一个完整句子
          const truncated = extracted.substring(0, maxLength);
          const lastSentenceMatch = truncated.match(/(.+[。！？.!?])/);
          if (lastSentenceMatch) {
            extracted = lastSentenceMatch[1];
          } else {
            extracted = truncated.trim() + '。';
          }
        }
      } else {
        // 如果只有一句，使用它
        extracted = sentences[0];
      }
    }
    
    // 确保摘要不超过170字
    if (extracted.length > 170) {
      const sentences = extracted.match(/(.+?[。！？.!?])/g);
      if (sentences) {
        let result = '';
        for (const sentence of sentences) {
          if ((result + sentence).length <= 170) {
            result += sentence;
          } else {
            break;
          }
        }
        if (result) extracted = result;
      } else {
        extracted = extracted.substring(0, 170);
        const lastSentence = extracted.match(/(.+[。！？.!?])/);
        if (lastSentence) {
          extracted = lastSentence[1];
        } else {
          extracted = extracted.trim() + '。';
        }
      }
    }
    
    return extracted.trim();
  }

  /**
   * 跳过正文开头的引导语、关注提示等无关内容
   */
  skipIrrelevantContent(content) {
    if (!content || content.length < 10) return content;
    
    // 定义需要跳过的引导语模式
    const irrelevantPatterns = [
      /^点击.*关注.*[！!。.\n]/i,
      /^欢迎关注.*[！!。.\n]/i,
      /^扫描.*二维码.*[！!。.\n]/i,
      /^关注.*公众号.*[！!。.\n]/i,
      /^点击左上方关注.*[！!。.\n]/i,
      /^点击上方.*关注.*[！!。.\n]/i,
      /^长按.*关注.*[！!。.\n]/i,
      /^识别.*二维码.*[！!。.\n]/i,
      /^·[^·]*·\s*[\n\r]/m, // 类似 "·国家公祭日·" 这样的装饰性分隔符
    ];
    
    let processed = content;
    
    // 尝试匹配并跳过引导语
    for (const pattern of irrelevantPatterns) {
      const match = processed.match(pattern);
      if (match) {
        // 跳过匹配到的内容
        processed = processed.substring(match[0].length).trim();
        // 如果后面还有换行，也跳过
        processed = processed.replace(/^[\n\r]+/, '').trim();
      }
    }
    
    // 如果处理后的内容太短（少于20字），说明可能跳过了太多，尝试另一种方式
    if (processed.length < 20 && content.length > 50) {
      // 尝试另一种方式：查找第一个包含实质性内容的句子
      const sentences = content.split(/[。！？.!?]/);
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        // 跳过明显的引导语
        if (trimmed.length > 10 && 
            !/点击|关注|扫描|二维码|欢迎/.test(trimmed) &&
            !/^[·•●\-\*]\s*$/.test(trimmed)) {
          // 如果这个句子包含实质性内容，返回它
          if (trimmed.length > 15) {
            return trimmed + '。';
          }
        }
      }
      return content; // 如果都找不到，返回原内容
    }
    
    return processed;
  }

  /**
   * 检测内容是否是图片内容（图片标签或图片URL）
   */
  isImageOnlyContent(content) {
    if (!content || content.trim().length === 0) {
      return true;
    }
    
    const contentTrimmed = content.trim();
    
    // 如果内容非常短（少于10个字符），可能是图片
    if (contentTrimmed.length < 10) {
      return true;
    }
    
    // 检测是否包含JavaScript代码或网页模板代码（这些通常是错误的内容提取）
    const jsPatterns = [
      /document\.title\s*=/i,
      /var\s+PAGE_MID/i,
      /mmbizwap/i,
      /secitptpage/i,
      /verify\.html/i,
      /微信公众号平台/i,
      /setTimeout\s*\(/i,
      /function\s*\(\)\s*\{/i,
      /<script[^>]*>/i,
      /<\/script>/i,
      /body\s*,/i,
      /title\s*===/i,
      /noMobile\s*&&/i,
      /document\.title\s*=\s*['"]/i,
      /PAGE_MID\s*=/i
    ];
    
    // 检测是否包含CSS样式代码（这些通常是错误的内容提取）
    const cssPatterns = [
      /\.wx-root/i,
      /--weui-/i,
      /@media\s*\(prefers-color-scheme/i,
      /data-weui-theme/i,
      /rgba\s*\(/i,
      /#[0-9a-f]{3,6}/i, // CSS颜色代码
      /:\s*#[0-9a-f]{3,6}/i, // CSS属性值中的颜色
      /:\s*rgba\s*\(/i, // CSS属性值中的rgba
      /:\s*#[a-f0-9]{3,6}\s*;/i // CSS属性值
    ];
    
    // 如果内容主要是JavaScript代码或网页模板代码，认为是图片内容（错误提取）
    const jsPatternCount = jsPatterns.filter(pattern => pattern.test(contentTrimmed)).length;
    const cssPatternCount = cssPatterns.filter(pattern => pattern.test(contentTrimmed)).length;
    
    // 如果包含2个或以上JavaScript模式，或1个JavaScript模式+1个CSS模式，认为是图片内容
    if (jsPatternCount >= 2 || (jsPatternCount >= 1 && cssPatternCount >= 1)) {
      console.log(`[isImageOnlyContent] 检测到JavaScript代码或CSS样式代码（JS: ${jsPatternCount}, CSS: ${cssPatternCount}），认为是图片内容（错误提取）`);
      return true;
    }
    
    // 如果内容包含CSS样式代码且长度较长（超过500字符），可能是错误提取
    if (cssPatternCount >= 3 && contentTrimmed.length > 500) {
      console.log(`[isImageOnlyContent] 检测到大量CSS样式代码（${cssPatternCount}个模式），认为是图片内容（错误提取）`);
      return true;
    }
    
    // 如果内容包含JavaScript代码且长度较短（少于200字符），可能是错误提取
    if (jsPatternCount >= 1 && contentTrimmed.length < 200) {
      console.log(`[isImageOnlyContent] 检测到JavaScript代码且内容较短，认为是图片内容（错误提取）`);
      return true;
    }
    
    // 检测是否包含图片标签
    const imageTagPatterns = [
      /<img[^>]*>/i,
      /<image[^>]*>/i,
      /\[图片\]/i,
      /\[image\]/i,
      /图片内容/i,
      /image content/i
    ];
    
    for (const pattern of imageTagPatterns) {
      if (pattern.test(contentTrimmed)) {
        return true;
      }
    }
    
    // 检测是否主要是图片URL（http/https链接，且以图片扩展名结尾）
    const imageUrlPattern = /^https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|bmp|webp|svg)(\?[^\s]*)?$/i;
    if (imageUrlPattern.test(contentTrimmed)) {
      return true;
    }
    
    // 检测内容是否只包含图片URL（没有其他文本）
    const urlOnlyPattern = /^https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|bmp|webp|svg)(\?[^\s]*)?(\s+https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|bmp|webp|svg)(\?[^\s]*)?)*$/i;
    if (urlOnlyPattern.test(contentTrimmed)) {
      return true;
    }
    
    // 如果内容中图片URL的比例很高（超过80%），可能是图片内容
    const allUrls = contentTrimmed.match(/https?:\/\/[^\s]+/gi) || [];
    const imageUrls = allUrls.filter(url => /\.(jpg|jpeg|png|gif|bmp|webp|svg)(\?|$)/i.test(url));
    if (allUrls.length > 0 && imageUrls.length / allUrls.length > 0.8) {
      return true;
    }
    
    return false;
  }

  /**
   * 补充不完整的摘要
   */
  supplementAbstract(incompleteAbstract, title, content) {
    const fullText = (content || '').trim();
    if (!fullText || fullText.length < 20) return null;
    
    // 如果摘要以数字结尾（如"还背着27."），尝试在原文中找到完整的表述
    if (/[\d\.]+[。！？.!?]?$/.test(incompleteAbstract)) {
      // 提取摘要中最后一个数字之前的文本（取最后30字作为关键词，提高匹配成功率）
      const beforeNum = incompleteAbstract.replace(/[\d\.]+[。！？.!?]?$/, '').trim();
      const searchKeyword = beforeNum.length > 30 ? beforeNum.substring(beforeNum.length - 30) : beforeNum;
      
      // 跳过引导语后查找
      const processedText = this.skipIrrelevantContent(fullText);
      
      // 在原文中查找包含这个文本的完整句子
      const keywordIndex = processedText.indexOf(searchKeyword);
      if (keywordIndex >= 0) {
        // 从关键词位置开始，查找完整的句子
        const start = keywordIndex;
        const end = Math.min(processedText.length, start + 300);
        const context = processedText.substring(start, end);
        
        // 查找包含关键词和数字的完整句子（到句号为止）
        // 先尝试找到包含数字的完整句子
        const sentenceWithNum = context.match(/([^。！？.!?]*[\d\.]+[^。！？.!?]*[。！？.!?])/);
        if (sentenceWithNum) {
          const extracted = sentenceWithNum[1].trim();
          // 确保提取的句子包含数字且完整（至少30字）
          if (extracted.length >= 30 && extracted.length <= 150) {
            return extracted;
          }
        }
        
        // 如果找不到包含数字的完整句子，尝试找到关键词后的第一个完整句子
        const afterKeyword = context.substring(searchKeyword.length);
        const firstSentence = afterKeyword.match(/(.+?[。！？.!?])/);
        if (firstSentence) {
          const extracted = (searchKeyword + firstSentence[1]).trim();
          if (extracted.length >= 30 && extracted.length <= 150) {
            return extracted;
          }
        }
      }
    }
    
    // 如果摘要太短或不完整，尝试从原文补充
    if (incompleteAbstract && incompleteAbstract.length < 30) {
      if (fullText && fullText.length > incompleteAbstract.length) {
        // 跳过引导语
        const processedText = this.skipIrrelevantContent(fullText);
        // 尝试找到包含摘要关键词的完整句子
        const keywords = incompleteAbstract.split(/[，。！？\s]+/).filter(w => w.length > 1);
        for (const keyword of keywords) {
          const keywordIndex = processedText.indexOf(keyword);
          if (keywordIndex >= 0) {
            // 找到包含关键词的句子
            const start = Math.max(0, keywordIndex - 50);
            const end = Math.min(processedText.length, keywordIndex + 150);
            const context = processedText.substring(start, end);
            // 查找完整的句子
            const sentenceMatch = context.match(/(.+[。！？.!?])/);
            if (sentenceMatch) {
              const extracted = sentenceMatch[1].trim();
              // 确保提取的句子长度合理且完整
              if (extracted.length >= 30 && extracted.length <= 150) {
                return extracted;
              }
            }
          }
        }
      }
    }
    
    return null;
  }
}

module.exports = new NewsAnalysis();
