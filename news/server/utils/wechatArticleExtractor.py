#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信公众号文章内容提取器
支持提取正文文本和图片文字识别
"""

import json
import sys
import re
import base64
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse, parse_qs
from PIL import Image
import io
import os
from typing import Dict, List, Optional, Tuple

class WeChatArticleExtractor:
    def __init__(self, image_model_config: Optional[Dict] = None):
        """
        初始化提取器
        :param image_model_config: 图片识别模型配置
        """
        self.image_model_config = image_model_config
        self.session = requests.Session()
        # 设置请求头，模拟浏览器访问（更完整的浏览器标识）
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
            'Referer': 'https://www.google.com/',
        })
    
    def extract_article_content(self, url: str) -> Dict:
        """
        提取微信公众号文章内容
        :param url: 文章URL
        :return: 包含正文内容和图片信息的字典
        """
        try:
            # 步骤1：爬取网页源码
            html_content = self._fetch_html(url)
            if not html_content:
                return {'success': False, 'error': '无法获取网页内容', 'content': ''}
            
            # 步骤2：解析HTML，提取正文和图片
            soup = BeautifulSoup(html_content, 'html.parser')
            text_content = self._extract_text(soup)
            images = self._extract_images(soup, url)
            
            # 步骤3：识别图片文字
            image_texts = []
            if images and self.image_model_config:
                for img_info in images:
                    try:
                        img_text = self._recognize_image_text(img_info)
                        if img_text:
                            image_texts.append({
                                'url': img_info['url'],
                                'position': img_info['position'],
                                'text': img_text
                            })
                    except Exception as e:
                        print(f"图片识别失败: {img_info['url']}, 错误: {str(e)}", file=sys.stderr)
            
            # 步骤4：整合正文和图片文字
            final_content = self._combine_content(text_content, image_texts)
            
            return {
                'success': True,
                'content': final_content,
                'text_length': len(text_content),
                'image_count': len(images),
                'recognized_image_count': len(image_texts)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f'提取失败: {str(e)}',
                'content': ''
            }
    
    def _fetch_html(self, url: str) -> Optional[str]:
        """
        获取网页HTML内容
        :param url: 文章URL
        :return: HTML内容
        """
        try:
            # 添加延迟，避免请求过快
            import time
            time.sleep(1)
            
            # 设置更长的超时时间
            response = self.session.get(url, timeout=60, allow_redirects=True)
            response.raise_for_status()
            response.encoding = response.apparent_encoding or 'utf-8'
            
            # 检查是否是反爬页面
            html_content = response.text
            anti_crawl_keywords = ['环境异常', '完成验证', '参数错误', '当前环境异常', '去验证', '轻点两下取消赞', '轻点两下取消在看']
            if any(keyword in html_content for keyword in anti_crawl_keywords):
                print(f"检测到微信公众号反爬页面，无法直接获取内容", file=sys.stderr)
                # 微信公众号有严格的反爬机制，需要有效的Cookie和JavaScript执行
                # 直接HTTP请求无法绕过，返回None
                return None
            
            # 检查是否包含实际文章内容（通过检查常见的文章标识）
            if len(html_content) < 500:
                print(f"返回内容太短，可能是错误页面", file=sys.stderr)
                return None
            
            return html_content
        except requests.exceptions.RequestException as e:
            print(f"请求失败: {str(e)}", file=sys.stderr)
            return None
    
    def _extract_text(self, soup: BeautifulSoup) -> str:
        """
        提取正文文本
        :param soup: BeautifulSoup对象
        :return: 正文文本
        """
        # 尝试多种选择器来定位正文
        content_selectors = [
            '#js_content',
            '.rich_media_content',
            '#article_content',
            '.article-content',
            'div[class*="content"]',
            'div[id*="content"]'
        ]
        
        text_content = ''
        for selector in content_selectors:
            content_elem = soup.select_one(selector)
            if content_elem:
                # 移除script和style标签
                for script in content_elem(['script', 'style']):
                    script.decompose()
                
                text_content = content_elem.get_text(separator='\n', strip=True)
                if len(text_content) > 100:  # 如果提取到的文本长度大于100，认为找到了正文
                    break
        
        # 如果没找到，尝试从body中提取
        if not text_content or len(text_content) < 100:
            body = soup.find('body')
            if body:
                for script in body(['script', 'style', 'nav', 'header', 'footer']):
                    script.decompose()
                text_content = body.get_text(separator='\n', strip=True)
        
        # 清理文本：移除多余空白
        text_content = re.sub(r'\n{3,}', '\n\n', text_content)
        text_content = re.sub(r' {2,}', ' ', text_content)
        
        return text_content.strip()
    
    def _extract_images(self, soup: BeautifulSoup, base_url: str) -> List[Dict]:
        """
        提取页面中的所有图片
        :param soup: BeautifulSoup对象
        :param base_url: 基础URL
        :return: 图片信息列表
        """
        images = []
        
        # 查找所有img标签
        img_tags = soup.find_all('img')
        
        for idx, img in enumerate(img_tags):
            img_url = img.get('src') or img.get('data-src') or img.get('data-original')
            if not img_url:
                continue
            
            # 处理相对URL
            if img_url.startswith('//'):
                img_url = 'https:' + img_url
            elif img_url.startswith('/'):
                parsed = urlparse(base_url)
                img_url = f"{parsed.scheme}://{parsed.netloc}{img_url}"
            elif not img_url.startswith('http'):
                parsed = urlparse(base_url)
                img_url = f"{parsed.scheme}://{parsed.netloc}/{img_url}"
            
            # 获取图片尺寸
            width = img.get('width') or img.get('data-width') or ''
            height = img.get('height') or img.get('data-height') or ''
            
            images.append({
                'url': img_url,
                'position': idx + 1,  # 在正文中的位置（从1开始）
                'width': width,
                'height': height,
                'alt': img.get('alt', '')
            })
        
        return images
    
    def _recognize_image_text(self, img_info: Dict) -> Optional[str]:
        """
        使用AI模型识别图片文字
        :param img_info: 图片信息
        :return: 识别的文字内容
        """
        if not self.image_model_config:
            return None
        
        try:
            # 下载图片
            img_response = self.session.get(img_info['url'], timeout=30)
            img_response.raise_for_status()
            
            # 将图片转换为base64
            img_base64 = base64.b64encode(img_response.content).decode('utf-8')
            
            # 调用AI模型API
            api_endpoint = self.image_model_config.get('api_endpoint')
            api_key = self.image_model_config.get('api_key')
            model_name = self.image_model_config.get('model_name', 'Qwen2.5-VL-32B-Instruct')
            
            # 构建请求
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            }
            
            # 构建提示词
            prompt = "请识别这张图片中的所有文字内容，包括图片中的标题、正文、图表文字等。如果图片中没有文字，请返回'无文字内容'。"
            
            # 根据不同的API类型构建请求体
            api_type = self.image_model_config.get('api_type', 'chat')
            if api_type == 'chat' or api_type == 'chat_completion':
                # Chat API 或 Chat Completion API（兼容OpenAI格式）
                payload = {
                    'model': model_name,
                    'messages': [
                        {
                            'role': 'user',
                            'content': [
                                {
                                    'type': 'text',
                                    'text': prompt
                                },
                                {
                                    'type': 'image_url',
                                    'image_url': {
                                        'url': f'data:image/jpeg;base64,{img_base64}'
                                    }
                                }
                            ]
                        }
                    ],
                    'temperature': self.image_model_config.get('temperature', 0.7),
                    'max_tokens': self.image_model_config.get('max_tokens', 2000)
                }
            else:
                # 其他API类型的处理
                payload = {
                    'model': model_name,
                    'prompt': prompt,
                    'image': img_base64,
                    'temperature': self.image_model_config.get('temperature', 0.7),
                    'max_tokens': self.image_model_config.get('max_tokens', 2000)
                }
            
            # 发送请求
            response = requests.post(
                api_endpoint,
                headers=headers,
                json=payload,
                timeout=60
            )
            response.raise_for_status()
            
            result = response.json()
            
            # 解析响应
            api_type = self.image_model_config.get('api_type', 'chat')
            if api_type == 'chat' or api_type == 'chat_completion':
                # Chat API 或 Chat Completion API响应格式（兼容OpenAI）
                if 'choices' in result and len(result['choices']) > 0:
                    return result['choices'][0]['message']['content']
            else:
                # 其他API类型的响应格式
                if 'text' in result:
                    return result['text']
                elif 'content' in result:
                    return result['content']
            
            return None
            
        except Exception as e:
            print(f"图片识别失败: {str(e)}", file=sys.stderr)
            return None
    
    def _combine_content(self, text_content: str, image_texts: List[Dict]) -> str:
        """
        整合正文文本和图片识别的文字
        :param text_content: 正文文本
        :param image_texts: 图片识别的文字列表
        :return: 整合后的内容
        """
        if not image_texts:
            return text_content
        
        # 构建完整内容
        parts = [text_content]
        
        for img_text_info in image_texts:
            parts.append(f"\n\n[图片{img_text_info['position']}文字识别内容]\n{img_text_info['text']}")
        
        return '\n'.join(parts)


def main():
    """
    主函数：从命令行参数读取URL和配置，返回JSON结果
    """
    if len(sys.argv) < 2:
        result = {
            'success': False,
            'error': '缺少参数：需要提供文章URL',
            'content': ''
        }
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)
    
    url = sys.argv[1]
    
    # 读取图片识别模型配置（如果提供）
    image_model_config = None
    if len(sys.argv) >= 3:
        try:
            config_json = sys.argv[2]
            image_model_config = json.loads(config_json)
        except json.JSONDecodeError:
            print(f"警告：无法解析图片识别模型配置JSON", file=sys.stderr)
    
    # 创建提取器并提取内容
    extractor = WeChatArticleExtractor(image_model_config)
    result = extractor.extract_article_content(url)
    
    # 输出JSON结果
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()

