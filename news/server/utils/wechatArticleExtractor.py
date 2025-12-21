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
        # 设置请求头，模拟真实浏览器访问（更完整的浏览器标识）
        # 注意：微信公众号有严格的反爬机制，需要尽可能模拟真实浏览器
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
            'Referer': 'https://mp.weixin.qq.com/',
            'DNT': '1',
        })
    
    def extract_article_content(self, url: str) -> Dict:
        """
        提取微信公众号文章内容
        :param url: 文章URL
        :return: 包含正文内容和图片信息的字典
        """
        try:
            # 步骤1：处理URL（如果是验证页面，提取真实URL）
            actual_url = url
            if 'wappoc_appmsgcaptcha' in url and 'target_url' in url:
                try:
                    from urllib.parse import urlparse, parse_qs
                    parsed = urlparse(url)
                    params = parse_qs(parsed.query)
                    if 'target_url' in params and params['target_url']:
                        actual_url = params['target_url'][0]
                        import urllib.parse
                        actual_url = urllib.parse.unquote(actual_url)
                except Exception as e:
                    print(f"解析验证页面URL失败，使用原始URL: {str(e)}", file=sys.stderr)
            
            # 步骤2：爬取网页源码
            html_content = self._fetch_html(actual_url)
            if not html_content:
                return {'success': False, 'error': '无法获取网页内容', 'content': ''}
            
            # 步骤3：解析HTML，提取正文和图片（使用实际URL作为base_url）
            # 保存原始HTML字符串，用于正则表达式提取图片（备用方案）
            original_html = html_content
            soup = BeautifulSoup(html_content, 'html.parser')
            text_content = self._extract_text(soup)
            
            # ========== 图片提取逻辑已禁用 ==========
            # 暂时不实现从微信公众号内容中提取图片的功能
            # 传递原始HTML字符串，以便在BeautifulSoup找不到图片时使用正则表达式
            # images = self._extract_images(soup, actual_url, original_html)
            images = []  # 图片提取功能已禁用
            print(f"[图片提取] ⚠️ 图片提取功能已禁用，跳过从URL中提取图片", file=sys.stderr)
            
            # ========== 图片识别逻辑已注释 ==========
            # 即使正文为空，也要尝试识别图片文字（纯图片文章）
            image_texts = []
            # print(f"[图片识别] 准备识别图片，找到 {len(images)} 张图片，图片识别模型配置: {'已配置' if self.image_model_config else '未配置'}", file=sys.stderr)
            
            # if images:
            #     if self.image_model_config:
            #         print(f"[图片识别] 开始识别 {len(images)} 张图片的文字内容...", file=sys.stderr)
            #         print(f"[图片识别] 使用模型: {self.image_model_config.get('model_name', '未知')}, API: {self.image_model_config.get('api_endpoint', '未知')}", file=sys.stderr)
            #         
            #         for img_info in images:
            #             try:
            #                 print(f"[图片识别] 开始识别图片 {img_info['position']}: {img_info['url'][:100]}...", file=sys.stderr)
            #                 img_text = self._recognize_image_text(img_info)
            #                 
            #                 if img_text and img_text.strip() and img_text.strip() != '无文字内容':
            #                     image_texts.append({
            #                         'url': img_info['url'],
            #                         'position': img_info['position'],
            #                         'text': img_text
            #                     })
            #                     print(f"[图片识别] ✓ 图片 {img_info['position']} 识别成功，文字长度: {len(img_text)}字符", file=sys.stderr)
            #                     print(f"[图片识别] 图片 {img_info['position']} 识别内容预览（前200字符）: {img_text[:200]}...", file=sys.stderr)
            #                 else:
            #                     print(f"[图片识别] ⚠️ 图片 {img_info['position']} 识别结果为空或无效", file=sys.stderr)
            #             except Exception as e:
            #                 import traceback
            #                 print(f"[图片识别] ✗ 图片 {img_info['position']} 识别失败: {img_info['url'][:100]}...", file=sys.stderr)
            #                 print(f"[图片识别] 错误详情: {str(e)}", file=sys.stderr)
            #                 print(f"[图片识别] 错误堆栈: {traceback.format_exc()}", file=sys.stderr)
            #         
            #         print(f"[图片识别] 完成，成功识别 {len(image_texts)}/{len(images)} 张图片", file=sys.stderr)
            #     else:
            #         print(f"[图片识别] ⚠️ 找到 {len(images)} 张图片，但未配置图片识别模型（usage_type='image_recognition'），跳过图片识别", file=sys.stderr)
            #         print(f"[图片识别] 提示：需要在AI模型配置中添加图片识别模型配置", file=sys.stderr)
            
            # 步骤4：整合正文和图片文字
            final_content = self._combine_content(text_content, image_texts)
            
            # 如果最终内容为空，记录警告
            if not final_content or len(final_content.strip()) < 10:
                print(f"警告：提取的内容为空或太短（{len(final_content) if final_content else 0}字符）", file=sys.stderr)
                # if images:
                #     print(f"提示：文章包含 {len(images)} 张图片，但未配置图片识别模型或识别失败", file=sys.stderr)
            
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
    
    def _fetch_html_with_chromium_subprocess(self, url: str) -> Optional[str]:
        """
        使用subprocess直接调用系统Chromium获取网页HTML内容（绕过Playwright兼容性问题）
        注意：系统Chromium可能存在crashpad兼容性问题，如果失败会返回None
        :param url: 文章URL
        :return: HTML内容，如果失败返回None
        """
        try:
            import subprocess
            import shutil
            import tempfile
            import os
            import time
            
            chromium_path = shutil.which('chromium') or shutil.which('chromium-browser')
            if not chromium_path:
                print(f"[Chromium] ⚠️ 未找到系统Chromium", file=sys.stderr)
                return None
            
            print(f"[Chromium] 开始使用系统Chromium获取页面内容: {url[:100]}...", file=sys.stderr)
            
            # 创建假的crashpad handler来绕过crashpad问题
            # 创建一个简单的shell脚本，什么都不做
            fake_crashpad_path = None
            try:
                fake_crashpad_dir = tempfile.mkdtemp()
                fake_crashpad_path = os.path.join(fake_crashpad_dir, 'chrome_crashpad_handler')
                with open(fake_crashpad_path, 'w') as f:
                    f.write('#!/bin/sh\n')
                    f.write('# Fake crashpad handler\n')
                    f.write('exit 0\n')
                os.chmod(fake_crashpad_path, 0o755)
                
                # 将假的crashpad handler添加到PATH的最前面
                original_path = os.environ.get('PATH', '')
                os.environ['PATH'] = fake_crashpad_dir + ':' + original_path
            except Exception as e:
                print(f"[Chromium] ⚠️ 创建假的crashpad handler失败: {str(e)}", file=sys.stderr)
            
            # 创建临时文件存储HTML
            with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False) as tmp_file:
                tmp_path = tmp_file.name
            
            try:
                # 使用Chromium的headless模式获取页面
                # 使用--dump-dom参数直接输出HTML
                # 使用--single-process模式来避免crashpad问题
                cmd = [
                    chromium_path,
                    '--headless=new',  # 使用新的headless模式
                    '--single-process',  # 单进程模式，避免crashpad问题
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-breakpad',
                    '--disable-crashpad',
                    '--disable-crash-reporter',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-features=TranslateUI,Crashpad',
                    '--disable-ipc-flooding-protection',
                    '--disable-hang-monitor',
                    '--disable-popup-blocking',
                    '--disable-prompt-on-repost',
                    '--disable-sync',
                    '--metrics-recording-only',
                    '--no-first-run',
                    '--safebrowsing-disable-auto-update',
                    '--enable-automation',
                    '--password-store=basic',
                    '--use-mock-keychain',
                    '--no-zygote',  # 禁用zygote进程
                    '--dump-dom',
                    '--virtual-time-budget=5000',  # 等待5秒让JavaScript执行
                    url
                ]
                
                # 设置环境变量来禁用crashpad
                env = os.environ.copy()
                env['DISPLAY'] = ':99'  # 设置虚拟显示
                env['CHROME_DEVEL_SANDBOX'] = '/usr/lib/chromium/chrome-sandbox'  # 如果存在
                # 尝试禁用crashpad相关的环境变量
                env.pop('CHROME_CRASHPAD_HANDLER', None)
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    env=env
                )
                
                # 即使有crashpad错误，如果stdout有内容，仍然可以使用
                html_content = result.stdout
                has_crashpad_error = result.stderr and ('crashpad' in result.stderr.lower() or 'chrome_crashpad_handler' in result.stderr)
                
                if html_content and len(html_content) > 100:
                    if has_crashpad_error:
                        print(f"[Chromium] ⚠️ 检测到crashpad错误，但HTML内容已获取", file=sys.stderr)
                    print(f"[Chromium] ✓ 成功获取HTML内容，长度: {len(html_content)}字符", file=sys.stderr)
                    return html_content
                elif result.returncode == 0:
                    print(f"[Chromium] ⚠️ 命令执行成功但HTML内容太短: {len(html_content) if html_content else 0}字符", file=sys.stderr)
                    return None
                else:
                    print(f"[Chromium] ✗ 命令执行失败，退出码: {result.returncode}", file=sys.stderr)
                    if result.stderr and not has_crashpad_error:
                        print(f"[Chromium] 错误信息: {result.stderr[:500]}", file=sys.stderr)
                    # 即使有crashpad错误，如果stdout有内容，仍然尝试返回
                    if html_content and len(html_content) > 100:
                        print(f"[Chromium] ⚠️ 尽管有错误，但HTML内容已获取，尝试使用", file=sys.stderr)
                        return html_content
                    # 如果stdout为空，说明Chromium在输出HTML之前就崩溃了
                    if has_crashpad_error and not html_content:
                        print(f"[Chromium] ✗ 系统Chromium因crashpad错误无法正常工作，stdout为空", file=sys.stderr)
                        print(f"[Chromium] 建议：1) 使用HTTP请求 2) 手动处理重要文章 3) 考虑使用其他工具", file=sys.stderr)
                    return None
                    
            finally:
                # 清理临时文件
                try:
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
                except:
                    pass
                # 清理假的crashpad handler
                try:
                    if fake_crashpad_path and os.path.exists(fake_crashpad_path):
                        os.unlink(fake_crashpad_path)
                    if fake_crashpad_path:
                        fake_crashpad_dir = os.path.dirname(fake_crashpad_path)
                        if os.path.exists(fake_crashpad_dir):
                            os.rmdir(fake_crashpad_dir)
                except:
                    pass
                    
        except subprocess.TimeoutExpired:
            print(f"[Chromium] ✗ 命令执行超时", file=sys.stderr)
            return None
        except Exception as e:
            print(f"[Chromium] ✗ 使用系统Chromium获取页面失败: {str(e)}", file=sys.stderr)
            import traceback
            print(f"[Chromium] 错误堆栈: {traceback.format_exc()}", file=sys.stderr)
            return None
    
    def _fetch_html_with_selenium(self, url: str) -> Optional[str]:
        """
        使用Selenium无头浏览器获取网页HTML内容（可以执行JavaScript，绕过部分反爬）
        优先尝试Firefox（避免Chromium的crashpad问题），如果失败则尝试Chrome
        :param url: 文章URL
        :return: HTML内容
        """
        # 先尝试Firefox（避免Chromium的crashpad问题）
        firefox_html = self._fetch_html_with_selenium_firefox(url)
        if firefox_html:
            return firefox_html
        
        # Firefox失败，尝试Chrome
        return self._fetch_html_with_selenium_chrome(url)
    
    def _fetch_html_with_selenium_firefox(self, url: str) -> Optional[str]:
        """
        使用Selenium Firefox无头浏览器获取网页HTML内容
        :param url: 文章URL
        :return: HTML内容
        """
        try:
            from selenium import webdriver
            from selenium.webdriver.firefox.options import Options as FirefoxOptions
            from selenium.webdriver.firefox.service import Service as FirefoxService
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            import shutil
            import os
            
            print(f"[Selenium Firefox] 开始使用Firefox无头浏览器获取页面内容: {url[:100]}...", file=sys.stderr)
            
            # 配置Firefox选项
            firefox_options = FirefoxOptions()
            firefox_options.add_argument('--headless')
            firefox_options.add_argument('--width=1920')
            firefox_options.add_argument('--height=1080')
            firefox_options.add_argument('--no-sandbox')
            firefox_options.add_argument('--disable-dev-shm-usage')
            firefox_options.set_preference('general.useragent.override', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            # 禁用图片加载以加快速度
            firefox_options.set_preference('permissions.default.image', 2)
            # 设置超时时间
            firefox_options.set_preference('dom.max_script_run_time', 30)
            firefox_options.set_preference('dom.max_chrome_script_run_time', 30)
            # 禁用图片加载以加快速度
            firefox_options.set_preference('permissions.default.image', 2)
            firefox_options.set_preference('dom.ipc.plugins.enabled.libflashplayer.so', False)
            # 禁用JavaScript（如果需要的话，但WeChat可能需要JS，所以先不禁用）
            # firefox_options.set_preference('javascript.enabled', False)
            
            # 尝试使用系统Firefox
            firefox_path = shutil.which('firefox') or shutil.which('firefox-esr')
            if firefox_path:
                print(f"[Selenium Firefox] 使用系统Firefox: {firefox_path}", file=sys.stderr)
                firefox_options.binary_location = firefox_path
            
            # 禁用SeleniumManager的自动下载（避免网络问题）
            os.environ['SE_MANAGER_DISABLE'] = '1'
            os.environ['SE_SELENIUM_MANAGER_DISABLE'] = '1'
            
            # 查找geckodriver路径
            geckodriver_path = shutil.which('geckodriver')
            if not geckodriver_path:
                # 检查/tmp/.geckodriver目录
                tmp_geckodriver = '/tmp/.geckodriver/geckodriver'
                if os.path.exists(tmp_geckodriver) and os.access(tmp_geckodriver, os.X_OK):
                    geckodriver_path = tmp_geckodriver
            
            if not geckodriver_path:
                print(f"[Selenium Firefox] 未找到geckodriver，返回None让Chrome尝试", file=sys.stderr)
                return None
            
            # 创建WebDriver（使用明确的geckodriver路径）
            # 注意：Firefox启动可能会卡住，直接跳过Firefox
            print(f"[Selenium Firefox] ⚠️ Firefox启动可能会卡住，跳过Firefox以避免阻塞", file=sys.stderr)
            print(f"[Selenium Firefox] ⚠️ 建议：对于需要验证的微信公众号文章，使用第三方API服务或手动处理", file=sys.stderr)
            return None
            
            # 以下代码已被禁用，因为Firefox启动可能会卡住
            try:
                # 创建Service，设置日志路径
                service = FirefoxService(
                    geckodriver_path,
                    service_log_path='/tmp/geckodriver.log'
                )
                # 创建driver，不设置service_args（避免连接问题）
                driver = webdriver.Firefox(
                    service=service, 
                    options=firefox_options
                )
                print(f"[Selenium Firefox] ✓ 使用geckodriver: {geckodriver_path}", file=sys.stderr)
            except Exception as e:
                print(f"[Selenium Firefox] ✗ 启动Firefox失败: {str(e)[:300]}", file=sys.stderr)
                # 如果启动失败，检查日志
                if os.path.exists('/tmp/geckodriver.log'):
                    try:
                        with open('/tmp/geckodriver.log', 'r') as f:
                            log_content = f.read()
                            if log_content:
                                print(f"[Selenium Firefox] geckodriver日志（最后500字符）: {log_content[-500:]}", file=sys.stderr)
                    except:
                        pass
                return None
            
            try:
                # 设置页面加载超时
                driver.set_page_load_timeout(60)  # 60秒超时
                driver.implicitly_wait(10)  # 隐式等待10秒
                
                print(f"[Selenium Firefox] 正在访问页面: {url[:100]}...", file=sys.stderr)
                # 访问页面
                driver.get(url)
                print(f"[Selenium Firefox] 页面访问完成，等待加载...", file=sys.stderr)
                
                # 等待页面加载完成
                try:
                    WebDriverWait(driver, 30).until(
                        EC.presence_of_element_located((By.TAG_NAME, "body"))
                    )
                    print(f"[Selenium Firefox] body元素已加载", file=sys.stderr)
                except Exception as e:
                    print(f"[Selenium Firefox] ⚠️ 等待body元素超时: {str(e)[:200]}", file=sys.stderr)
                    # 即使超时，也尝试获取HTML
                
                # 等待JavaScript执行
                import time
                print(f"[Selenium Firefox] 等待JavaScript执行（3秒）...", file=sys.stderr)
                time.sleep(3)
                
                # 获取页面HTML
                print(f"[Selenium Firefox] 正在获取页面HTML...", file=sys.stderr)
                html_content = driver.page_source
                
                print(f"[Selenium Firefox] ✓ 成功获取HTML内容，长度: {len(html_content)}字符", file=sys.stderr)
                return html_content
                
            except Exception as e:
                print(f"[Selenium Firefox] ✗ 访问页面时出错: {str(e)[:300]}", file=sys.stderr)
                import traceback
                print(f"[Selenium Firefox] 错误堆栈: {traceback.format_exc()}", file=sys.stderr)
                return None
            finally:
                try:
                    print(f"[Selenium Firefox] 正在关闭浏览器...", file=sys.stderr)
                    driver.quit()
                    print(f"[Selenium Firefox] 浏览器已关闭", file=sys.stderr)
                except Exception as e:
                    print(f"[Selenium Firefox] ⚠️ 关闭浏览器时出错: {str(e)[:200]}", file=sys.stderr)
                
        except ImportError:
            print(f"[Selenium Firefox] ⚠️ Selenium未安装，无法使用Firefox", file=sys.stderr)
            return None
        except Exception as e:
            print(f"[Selenium Firefox] ✗ 使用Firefox获取页面失败: {str(e)}", file=sys.stderr)
            return None
    
    def _fetch_html_with_selenium_chrome(self, url: str) -> Optional[str]:
        """
        使用Selenium Chrome无头浏览器获取网页HTML内容
        :param url: 文章URL
        :return: HTML内容
        """
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
            from selenium.webdriver.chrome.service import Service
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            import shutil
            
            print(f"[Selenium Chrome] 开始使用Chrome无头浏览器获取页面内容: {url[:100]}...", file=sys.stderr)
            
            # 配置Chrome选项
            chrome_options = Options()
            chrome_options.add_argument('--headless=new')
            chrome_options.add_argument('--no-sandbox')
            chrome_options.add_argument('--disable-setuid-sandbox')
            chrome_options.add_argument('--disable-dev-shm-usage')
            chrome_options.add_argument('--disable-gpu')
            chrome_options.add_argument('--disable-software-rasterizer')
            chrome_options.add_argument('--disable-breakpad')
            chrome_options.add_argument('--disable-crashpad')
            chrome_options.add_argument('--disable-crash-reporter')
            chrome_options.add_argument('--disable-background-networking')
            chrome_options.add_argument('--disable-background-timer-throttling')
            chrome_options.add_argument('--disable-backgrounding-occluded-windows')
            chrome_options.add_argument('--disable-renderer-backgrounding')
            chrome_options.add_argument('--disable-features=TranslateUI,Crashpad,CrashReporting')
            chrome_options.add_argument('--window-size=1920,1080')
            chrome_options.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
            chrome_options.add_argument('--single-process')  # 单进程模式，避免crashpad问题
            chrome_options.add_argument('--no-zygote')  # 禁用zygote进程
            chrome_options.add_argument('--disable-extensions')
            chrome_options.add_argument('--disable-plugins')
            # 添加实验性参数来禁用crashpad
            chrome_options.add_experimental_option('excludeSwitches', ['enable-logging', 'enable-crashpad'])
            chrome_options.add_experimental_option('useAutomationExtension', False)
            
            # 尝试使用系统Chromium
            chromium_path = shutil.which('chromium') or shutil.which('chromium-browser')
            if chromium_path:
                print(f"[Selenium] 使用系统Chromium: {chromium_path}", file=sys.stderr)
                chrome_options.binary_location = chromium_path
            
            # 创建WebDriver
            # Selenium 4.x 会自动管理ChromeDriver，但为了避免网络问题，我们禁用SeleniumManager
            import os
            # 禁用SeleniumManager的自动下载（避免网络问题）
            os.environ['SE_MANAGER_DISABLE'] = '1'
            os.environ['SE_SELENIUM_MANAGER_DISABLE'] = '1'
            
            # 创建假的crashpad handler来绕过crashpad问题
            fake_crashpad_path = '/tmp/chrome_crashpad_handler'
            try:
                with open(fake_crashpad_path, 'w') as f:
                    f.write('#!/bin/sh\n')
                    f.write('# Fake crashpad handler\n')
                    f.write('exit 0\n')
                os.chmod(fake_crashpad_path, 0o755)
                # 将假的crashpad handler添加到PATH的最前面
                original_path = os.environ.get('PATH', '')
                os.environ['PATH'] = '/tmp:' + original_path
                print(f"[Selenium] 创建假的crashpad handler: {fake_crashpad_path}", file=sys.stderr)
            except Exception as e:
                print(f"[Selenium] ⚠️ 创建假的crashpad handler失败: {str(e)}", file=sys.stderr)
            
            # 添加更多Chrome启动参数以避免crashpad问题
            chrome_options.add_argument('--single-process')  # 单进程模式
            chrome_options.add_argument('--no-zygote')  # 禁用zygote
            chrome_options.add_argument('--disable-extensions')
            chrome_options.add_argument('--disable-plugins')
            chrome_options.add_argument('--disable-images')  # 禁用图片加载以加快速度
            
            # 如果指定了binary_location，Selenium应该能直接使用系统Chromium
            # 但Selenium 4.x仍然需要ChromeDriver，我们需要手动指定或使用chromedriver-autoinstaller
            try:
                # 尝试直接创建（如果ChromeDriver已安装或Selenium能找到）
                driver = webdriver.Chrome(options=chrome_options)
            except Exception as e:
                # 如果失败，尝试使用chromedriver-autoinstaller或手动指定路径
                print(f"[Selenium] 标准方式失败: {str(e)[:200]}", file=sys.stderr)
                # 尝试安装chromedriver-autoinstaller（如果可用）
                try:
                    import chromedriver_autoinstaller
                    import tempfile
                    # 使用/tmp目录来安装ChromeDriver（用户可写）
                    chromedriver_dir = '/tmp/.chromedriver'
                    os.makedirs(chromedriver_dir, exist_ok=True)
                    chromedriver_path = chromedriver_autoinstaller.install(path=chromedriver_dir)
                    from selenium.webdriver.chrome.service import Service
                    # 创建Service，启用日志以便调试
                    log_path = '/tmp/chromedriver.log'
                    service = Service(
                        chromedriver_path,
                        service_args=['--verbose', '--log-path=' + log_path] if os.path.exists('/tmp') else []
                    )
                    driver = webdriver.Chrome(service=service, options=chrome_options)
                    print(f"[Selenium] 使用自动安装的ChromeDriver: {chromedriver_path}", file=sys.stderr)
                    # 如果启动失败，尝试读取日志
                    if os.path.exists(log_path):
                        try:
                            with open(log_path, 'r') as f:
                                log_content = f.read()
                                if log_content:
                                    print(f"[Selenium] ChromeDriver日志: {log_content[-500:]}", file=sys.stderr)
                        except:
                            pass
                except ImportError:
                    # chromedriver-autoinstaller不可用，尝试查找系统chromedriver
                    chromedriver_path = shutil.which('chromedriver')
                    if chromedriver_path:
                        from selenium.webdriver.chrome.service import Service
                        service = Service(chromedriver_path)
                        driver = webdriver.Chrome(service=service, options=chrome_options)
                        print(f"[Selenium] 使用系统ChromeDriver: {chromedriver_path}", file=sys.stderr)
                    else:
                        print(f"[Selenium] ✗ 未找到ChromeDriver，且无法自动安装", file=sys.stderr)
                        raise e
            
            try:
                # 访问页面
                driver.get(url)
                
                # 等待页面加载完成
                WebDriverWait(driver, 30).until(
                    EC.presence_of_element_located((By.TAG_NAME, "body"))
                )
                
                # 等待JavaScript执行（给页面更多时间加载）
                import time
                time.sleep(3)
                
                # 获取页面HTML
                html_content = driver.page_source
                
                print(f"[Selenium] ✓ 成功获取HTML内容，长度: {len(html_content)}字符", file=sys.stderr)
                return html_content
                
            finally:
                driver.quit()
                
        except ImportError:
            print(f"[Selenium] ⚠️ Selenium未安装，无法使用无头浏览器", file=sys.stderr)
            return None
        except Exception as e:
            print(f"[Selenium] ✗ 使用无头浏览器获取页面失败: {str(e)}", file=sys.stderr)
            import traceback
            print(f"[Selenium] 错误堆栈: {traceback.format_exc()}", file=sys.stderr)
            return None
    
    def _fetch_html_with_playwright(self, url: str) -> Optional[str]:
        """
        使用Playwright无头浏览器获取网页HTML内容（可以执行JavaScript，绕过部分反爬）
        注意：Playwright不支持Alpine Linux（musl libc），如果运行在Alpine上会失败
        :param url: 文章URL
        :return: HTML内容
        """
        try:
            from playwright.sync_api import sync_playwright
            
            print(f"[Playwright] 开始使用无头浏览器获取页面内容: {url[:100]}...", file=sys.stderr)
            
            with sync_playwright() as p:
                # 启动浏览器（无头模式）
                # 如果默认路径失败，尝试使用系统Chromium
                try:
                    browser = p.chromium.launch(headless=True)
                except Exception as launch_error:
                    # 如果默认安装失败，尝试使用系统Chromium（如果可用）
                    import shutil
                    chromium_path = shutil.which('chromium') or shutil.which('chromium-browser')
                    if chromium_path:
                        print(f"[Playwright] 使用系统Chromium: {chromium_path}", file=sys.stderr)
                        # 系统Chromium需要额外的启动参数，特别是禁用crashpad
                        browser = p.chromium.launch(
                            headless=True,
                            executable_path=chromium_path,
                            args=[
                                '--no-sandbox',
                                '--disable-setuid-sandbox',
                                '--disable-dev-shm-usage',
                                '--disable-gpu',
                                '--disable-software-rasterizer',
                                '--disable-background-timer-throttling',
                                '--disable-backgrounding-occluded-windows',
                                '--disable-renderer-backgrounding',
                                '--disable-breakpad',  # 禁用crashpad
                                '--disable-crashpad',  # 禁用crashpad
                                '--disable-crash-reporter',  # 禁用崩溃报告
                                '--single-process',  # 单进程模式（可能更稳定）
                                '--no-zygote'  # 禁用zygote进程
                            ]
                        )
                    else:
                        raise launch_error
                context = browser.new_context(
                    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    viewport={'width': 1920, 'height': 1080},
                    locale='zh-CN'
                )
                page = context.new_page()
                
                # 访问页面
                page.goto(url, wait_until='networkidle', timeout=60000)
                
                # 等待页面加载完成（给JavaScript执行时间）
                import time
                time.sleep(2)
                
                # 获取页面HTML
                html_content = page.content()
                
                browser.close()
                
                print(f"[Playwright] ✓ 成功获取HTML内容，长度: {len(html_content)}字符", file=sys.stderr)
                return html_content
                
        except ImportError:
            print(f"[Playwright] ⚠️ Playwright未安装，跳过Selenium（Firefox启动可能会卡住）", file=sys.stderr)
            print(f"[Playwright] 建议：使用第三方API服务或手动处理需要验证的文章", file=sys.stderr)
            # 跳过Selenium，因为Firefox启动可能会卡住
            # selenium_html = self._fetch_html_with_selenium(url)
            # if selenium_html:
            #     return selenium_html
            print(f"[Playwright] 跳过系统Chromium（subprocess方式，crashpad问题）", file=sys.stderr)
            return None
        except Exception as e:
            print(f"[Playwright] ✗ 使用无头浏览器获取页面失败: {str(e)}", file=sys.stderr)
            import traceback
            print(f"[Playwright] 错误堆栈: {traceback.format_exc()}", file=sys.stderr)
            # Playwright失败时，跳过Selenium（Firefox启动可能会卡住）
            print(f"[Playwright] 跳过Selenium（Firefox启动可能会卡住）", file=sys.stderr)
            print(f"[Playwright] 建议：使用第三方API服务或手动处理需要验证的文章", file=sys.stderr)
            # selenium_html = self._fetch_html_with_selenium(url)
            # if selenium_html:
            #     return selenium_html
            # 跳过subprocess方式（crashpad问题）
            print(f"[Playwright] 跳过系统Chromium（subprocess方式，crashpad问题）", file=sys.stderr)
            return None
    
    def _fetch_html(self, url: str) -> Optional[str]:
        """
        获取网页HTML内容
        优先使用HTTP请求，如果检测到反爬页面，尝试使用Playwright无头浏览器
        :param url: 文章URL
        :return: HTML内容
        """
        try:
            # 处理验证页面URL：如果是wappoc_appmsgcaptcha验证页面，提取target_url参数
            actual_url = url
            if 'wappoc_appmsgcaptcha' in url and 'target_url' in url:
                try:
                    from urllib.parse import urlparse, parse_qs
                    parsed = urlparse(url)
                    params = parse_qs(parsed.query)
                    if 'target_url' in params and params['target_url']:
                        actual_url = params['target_url'][0]
                        # URL解码
                        import urllib.parse
                        actual_url = urllib.parse.unquote(actual_url)
                        print(f"检测到验证页面URL，提取真实文章URL: {actual_url}", file=sys.stderr)
                except Exception as e:
                    print(f"解析验证页面URL失败，使用原始URL: {str(e)}", file=sys.stderr)
            
            # 添加延迟，避免请求过快
            import time
            time.sleep(1)
            
            # 设置更长的超时时间
            # 注意：微信公众号可能会根据请求特征进行反爬检测
            print(f"[HTTP请求] 开始请求URL: {actual_url[:100]}...", file=sys.stderr)
            response = self.session.get(actual_url, timeout=60, allow_redirects=True)
            response.raise_for_status()
            response.encoding = response.apparent_encoding or 'utf-8'
            
            # 检查是否被重定向到验证页面
            final_url = response.url
            is_captcha_page = 'wappoc_appmsgcaptcha' in final_url
            if final_url != actual_url:
                print(f"⚠️ URL被重定向: {actual_url} -> {final_url}", file=sys.stderr)
                if is_captcha_page:
                    print(f"⚠️ 检测到重定向到验证页面（wappoc_appmsgcaptcha），需要使用无头浏览器", file=sys.stderr)
            
            # 检查是否是反爬页面
            html_content = response.text
            print(f"[HTTP请求] 获取到HTML内容，长度: {len(html_content)}字符", file=sys.stderr)
            
            # 输出完整的HTML内容，方便调试和确认是否抓取到有效信息
            print(f"\n{'='*80}", file=sys.stderr)
            print(f"[完整HTML内容] 开始输出（长度: {len(html_content)}字符）:", file=sys.stderr)
            print(f"{'='*80}", file=sys.stderr)
            print(html_content, file=sys.stderr)
            print(f"{'='*80}", file=sys.stderr)
            print(f"[完整HTML内容] 输出结束", file=sys.stderr)
            print(f"{'='*80}\n", file=sys.stderr)
            
            # 检查关键内容
            print(f"[HTML内容检查] 检查关键标识...", file=sys.stderr)
            checks = {
                '包含js_content': 'js_content' in html_content,
                '包含rich_media_content': 'rich_media_content' in html_content,
                '包含article_content': 'article_content' in html_content,
                '包含mmbiz.qpic.cn': 'mmbiz.qpic.cn' in html_content,
                '包含mmbiz&amp;.qpic.cn': 'mmbiz&amp;.qpic.cn' in html_content,
                '包含img标签': '<img' in html_content,
                '包含环境异常': '环境异常' in html_content,
                '包含完成验证': '完成验证' in html_content,
            }
            for key, value in checks.items():
                print(f"  {key}: {'✓' if value else '✗'}", file=sys.stderr)
            
            # 统计img标签数量（在原始HTML中）
            img_count = html_content.count('<img')
            print(f"[HTML内容检查] 原始HTML中<img标签数量: {img_count}", file=sys.stderr)
            
            # 检查响应中是否包含反爬关键词（更详细的检查）
            anti_crawl_indicators = {
                '环境异常': html_content.count('环境异常'),
                '完成验证': html_content.count('完成验证'),
                '去验证': html_content.count('去验证'),
                '当前环境异常': html_content.count('当前环境异常'),
            }
            if any(count > 0 for count in anti_crawl_indicators.values()):
                print(f"⚠️ 检测到反爬页面指示词: {anti_crawl_indicators}", file=sys.stderr)
                print(f"⚠️ 最终URL: {final_url}", file=sys.stderr)
                print(f"⚠️ 这是微信公众号的反爬验证页面，无法直接获取文章内容", file=sys.stderr)
                print(f"⚠️ 建议：需要使用无头浏览器（如Selenium/Playwright）或API方式获取内容", file=sys.stderr)
            
            # 检查是否包含实际文章内容标识（优先检查）
            # 微信公众号文章通常包含这些标识之一
            article_indicators = ['js_content', 'rich_media_content', 'article_content', 'id="js_content"', 'class="rich_media_content"']
            has_article_content = any(indicator in html_content for indicator in article_indicators)
            
            if has_article_content:
                print(f"✓ 检测到文章内容标识: {[ind for ind in article_indicators if ind in html_content][:3]}", file=sys.stderr)
                # 即使有反爬提示，只要找到文章内容标识，就继续提取
                return html_content
            
            # 如果没有找到文章内容标识，检查是否是反爬页面
            # 检查1：URL是否被重定向到验证页面
            # 检查2：HTML内容中是否包含反爬关键词
            anti_crawl_keywords = ['环境异常', '完成验证', '参数错误', '当前环境异常', '去验证']
            # 注意：'轻点两下取消赞'和'轻点两下取消在看'是正常文章页面的元素，不应该作为反爬页面的标志
            has_anti_crawl = is_captcha_page or any(keyword in html_content for keyword in anti_crawl_keywords)
            
            if has_anti_crawl:
                if is_captcha_page:
                    print(f"⚠️ 检测到验证页面URL（wappoc_appmsgcaptcha），需要使用无头浏览器", file=sys.stderr)
                else:
                    print(f"⚠️ 检测到反爬关键词: {[kw for kw in anti_crawl_keywords if kw in html_content]}", file=sys.stderr)
                
                # ========== 图片提取逻辑已禁用 ==========
                # 即使检测到反爬页面，也检查是否包含图片URL（图片URL可能在JavaScript代码中）
                # 但图片提取功能已禁用，不再尝试提取图片
                # mmbiz_count = html_content.count('mmbiz.qpic.cn') + html_content.count('mmbiz&amp;.qpic.cn')
                # if mmbiz_count > 0:
                #     print(f"⚠️ 虽然检测到反爬页面，但HTML中包含 {mmbiz_count} 个图片URL，尝试提取图片", file=sys.stderr)
                #     print(f"⚠️ 注意：即使无法提取正文，也可以尝试提取图片并进行OCR识别", file=sys.stderr)
                #     # 返回HTML，让后续的图片提取逻辑处理
                #     return html_content
                
                print(f"⚠️ HTTP请求获取到的是反爬验证页面，尝试使用Playwright无头浏览器...", file=sys.stderr)
                
                # 尝试使用Playwright无头浏览器
                playwright_html = self._fetch_html_with_playwright(actual_url)
                if playwright_html:
                    # 检查Playwright获取的内容是否有效
                    playwright_has_content = any(indicator in playwright_html for indicator in article_indicators)
                    if playwright_has_content:
                        print(f"✓ Playwright成功获取到有效内容", file=sys.stderr)
                        return playwright_html
                    else:
                        print(f"⚠️ Playwright获取的内容仍然无效", file=sys.stderr)
                else:
                    print(f"⚠️ Playwright不可用，跳过Selenium（Firefox启动可能会卡住）", file=sys.stderr)
                    print(f"⚠️ 建议：1) 使用第三方API服务 2) 手动处理需要验证的文章", file=sys.stderr)
                    # 跳过Selenium，因为Firefox启动可能会卡住
                    # selenium_html = self._fetch_html_with_selenium(actual_url)
                    # if selenium_html:
                    #     selenium_has_content = any(indicator in selenium_html for indicator in article_indicators)
                    #     if selenium_has_content:
                    #         print(f"✓ Selenium成功获取到有效内容", file=sys.stderr)
                    #         return selenium_html
                    #     else:
                    #         print(f"⚠️ Selenium获取的内容仍然无效", file=sys.stderr)
                
                # 即使有反爬提示，如果HTML内容足够长，也尝试提取（可能包含部分内容或图片URL）
                if len(html_content) > 5000:
                    print(f"⚠️ 虽然有反爬提示，但HTML内容较长（{len(html_content)}字符），继续尝试提取", file=sys.stderr)
                    return html_content
                else:
                    print(f"✗ 检测到微信公众号反爬页面且内容太短，无法直接获取内容", file=sys.stderr)
                    print(f"✗ 建议：1) 使用无头浏览器（Playwright/Selenium） 2) 使用第三方API服务 3) 手动处理", file=sys.stderr)
                    return None
            
            # 检查HTML内容长度
            if len(html_content) < 500:
                print(f"⚠️ 返回内容太短（{len(html_content)}字符），可能是错误页面", file=sys.stderr)
                return None
            
            # 如果HTML内容足够长，即使没有明确的文章标识，也尝试提取
            if len(html_content) > 3000:
                print(f"⚠️ 未找到明确的文章内容标识，但HTML内容较长（{len(html_content)}字符），继续尝试提取", file=sys.stderr)
                return html_content
            
            # 其他情况，返回None
            print(f"⚠️ HTML内容可能无效（长度: {len(html_content)}字符，无文章标识）", file=sys.stderr)
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
    
    # ========== 图片提取方法已禁用 ==========
    # 暂时不实现从微信公众号内容中提取图片的功能
    def _extract_images(self, soup: BeautifulSoup, base_url: str, original_html: str = None) -> List[Dict]:
        """
        提取页面中的所有图片（已禁用）
        :param soup: BeautifulSoup对象
        :param base_url: 基础URL
        :return: 图片信息列表（始终返回空列表）
        """
        # 图片提取功能已禁用，直接返回空列表
        print(f"[图片提取] ⚠️ _extract_images方法被调用，但功能已禁用，返回空列表", file=sys.stderr)
        return []
        
        # ========== 以下代码已被注释 ==========
        """
        images = []
        
        # 优先使用原始HTML字符串进行搜索（如果提供）
        # 因为BeautifulSoup解析可能会改变HTML结构或属性格式
        html_str = original_html if original_html else str(soup)
        print(f"[图片提取] 使用{'原始HTML' if original_html else 'BeautifulSoup解析后的HTML'}进行搜索，长度: {len(html_str)}字符", file=sys.stderr)
        
        # 首先检查原始HTML中是否包含图片URL（用于诊断）
        # 注意：HTML中可能使用&amp;代替&，需要检查两种格式
        mmbiz_count_raw = html_str.count('mmbiz.qpic.cn')
        mmbiz_count_amp = html_str.count('mmbiz&amp;.qpic.cn')
        mmbiz_count_total = mmbiz_count_raw + mmbiz_count_amp
        print(f"[图片提取] 原始HTML中包含 'mmbiz.qpic.cn' 的次数: {mmbiz_count_raw}", file=sys.stderr)
        print(f"[图片提取] 原始HTML中包含 'mmbiz&amp;.qpic.cn' 的次数: {mmbiz_count_amp}", file=sys.stderr)
        print(f"[图片提取] 总计: {mmbiz_count_total} 次", file=sys.stderr)
        
        # 查找所有img标签（使用多种方式）
        img_tags = soup.find_all('img')
        print(f"[图片提取] BeautifulSoup找到 {len(img_tags)} 个img标签", file=sys.stderr)
        
        # 如果没找到，尝试查找包含图片URL的元素
        if len(img_tags) == 0:
            print(f"[图片提取] 未找到img标签，尝试其他方式查找图片...", file=sys.stderr)
            # 查找包含data-src或src属性的元素
            elements_with_src = soup.find_all(attrs={'data-src': True}) + soup.find_all(attrs={'src': True})
            print(f"[图片提取] BeautifulSoup找到 {len(elements_with_src)} 个包含src或data-src属性的元素", file=sys.stderr)
            
            # 如果原始HTML中包含图片URL但BeautifulSoup没找到img标签，使用正则表达式提取
            if mmbiz_count_total > 0:
                print(f"[图片提取] ⚠️ HTML中包含图片URL但未找到img标签，可能是HTML结构问题或JavaScript动态加载", file=sys.stderr)
                # 尝试使用正则表达式直接提取图片URL（从原始HTML字符串中）
                import re
                # 查找所有包含mmbiz.qpic.cn的URL（更精确的模式，匹配data-src和src属性中的URL）
                # 注意：HTML中可能使用&amp;代替&，需要同时匹配两种格式
                img_url_patterns = [
                    r'data-src=["\'](https?://mmbiz(?:&amp;|&)?\.qpic\.cn/[^"\']+)["\']',  # data-src属性（支持&amp;和&）
                    r'src=["\'](https?://mmbiz(?:&amp;|&)?\.qpic\.cn/[^"\']+)["\']',        # src属性（支持&amp;和&）
                    r'https?://mmbiz(?:&amp;|&)?\.qpic\.cn/[^\s"\'<>]+'                     # 直接匹配URL（支持&amp;和&）
                ]
                
                found_urls = []
                seen_urls = set()
                for pattern in img_url_patterns:
                    matches = re.findall(pattern, html_str, re.IGNORECASE)
                    for match in matches:
                        # 如果pattern有分组，match是元组，取第一个元素
                        url = match if isinstance(match, str) else match[0] if match else ''
                        if url:
                            # 清理URL：将&amp;转换为&
                            url = url.replace('&amp;', '&')
                            # 移除HTML实体编码
                            import html
                            url = html.unescape(url)
                            if url not in seen_urls:
                                found_urls.append(url)
                                seen_urls.add(url)
                                print(f"[图片提取] 正则匹配找到图片URL: {url[:100]}...", file=sys.stderr)
                print(f"[图片提取] 使用正则表达式找到 {len(found_urls)} 个图片URL", file=sys.stderr)
                
                # 将找到的URL转换为img标签格式进行处理
                for idx, img_url in enumerate(found_urls):
                    # 清理URL（移除HTML实体编码和锚点）
                    import html
                    img_url = html.unescape(img_url)
                    if '#' in img_url:
                        img_url = img_url.split('#')[0]
                    
                    # 清理微信公众号图片URL参数
                    if 'mmbiz.qpic.cn' in img_url:
                        from urllib.parse import urlparse as parse_url, urlencode, parse_qs
                        try:
                            parsed_url = parse_url(img_url)
                            query_params = parse_qs(parsed_url.query)
                            params_to_remove = ['imgIndex', 'wxfrom', 'wx_lazy', 'tp']
                            for param in params_to_remove:
                                if param in query_params:
                                    del query_params[param]
                            new_query = urlencode(query_params, doseq=True)
                            if new_query:
                                img_url = f"{parsed_url.scheme}://{parsed_url.netloc}{parsed_url.path}?{new_query}"
                            else:
                                img_url = f"{parsed_url.scheme}://{parsed_url.netloc}{parsed_url.path}"
                        except Exception as e:
                            print(f"[图片提取] 清理URL参数时出错: {str(e)}", file=sys.stderr)
                    
                    images.append({
                        'url': img_url,
                        'position': idx + 1,
                        'width': '',
                        'height': '',
                        'alt': ''
                    })
                    print(f"[图片提取] ✓ 从HTML中直接提取图片 {idx + 1}: {img_url[:100]}...", file=sys.stderr)
                
                if len(images) > 0:
                    print(f"[图片提取] ✓ 使用正则表达式成功提取 {len(images)} 张图片", file=sys.stderr)
                    return images
        
        print(f"[图片提取] 在HTML中找到 {len(img_tags)} 个img标签", file=sys.stderr)
        
        for idx, img in enumerate(img_tags):
            # 优先使用data-src（微信公众号懒加载图片），然后是src（已加载的图片），最后是data-original
            # 注意：微信公众号的图片可能同时有data-src和src，优先使用data-src（原始高清图）
            data_src = img.get('data-src')
            src = img.get('src')
            data_original = img.get('data-original')
            
            img_url = data_src or src or data_original
            if not img_url:
                print(f"图片 {idx + 1} 没有找到URL（data-src={data_src is not None}, src={src is not None}, data-original={data_original is not None}），跳过", file=sys.stderr)
                continue
            
            # 记录使用的URL来源
            url_source = 'data-src' if data_src else ('src' if src else 'data-original')
            print(f"图片 {idx + 1} 使用 {url_source} 属性，原始URL: {img_url[:100]}...", file=sys.stderr)
            
            # 移除URL中的HTML实体编码（如&amp;），必须在处理URL之前进行
            import html
            img_url = html.unescape(img_url)
            
            # 移除URL中的锚点（#后面的部分），避免影响图片下载
            if '#' in img_url:
                img_url = img_url.split('#')[0]
                print(f"图片 {idx + 1} 移除URL锚点后的URL: {img_url[:100]}...", file=sys.stderr)
            
            # 处理相对URL
            if img_url.startswith('//'):
                img_url = 'https:' + img_url
            elif img_url.startswith('/'):
                parsed = urlparse(base_url)
                img_url = f"{parsed.scheme}://{parsed.netloc}{img_url}"
            elif not img_url.startswith('http'):
                parsed = urlparse(base_url)
                img_url = f"{parsed.scheme}://{parsed.netloc}/{img_url}"
            
            # 对于微信公众号图片，清理可能影响下载的参数
            if 'mmbiz.qpic.cn' in img_url or 'mmbizurl.cn' in img_url:
                from urllib.parse import urlparse as parse_url, urlencode, parse_qs
                try:
                    parsed_url = parse_url(img_url)
                    query_params = parse_qs(parsed_url.query)
                    # 移除可能影响下载的参数，但保留格式参数（wx_fmt）
                    params_to_remove = ['imgIndex', 'wxfrom', 'wx_lazy', 'tp']
                    original_param_count = len(query_params)
                    for param in params_to_remove:
                        if param in query_params:
                            del query_params[param]
                    # 重新构建URL
                    new_query = urlencode(query_params, doseq=True)
                    if new_query:
                        img_url = f"{parsed_url.scheme}://{parsed_url.netloc}{parsed_url.path}?{new_query}"
                    else:
                        img_url = f"{parsed_url.scheme}://{parsed_url.netloc}{parsed_url.path}"
                    print(f"图片 {idx + 1} 清理微信公众号图片URL参数（移除 {original_param_count - len(query_params)} 个参数）: {img_url[:150]}...", file=sys.stderr)
                except Exception as e:
                    print(f"图片 {idx + 1} 清理URL参数时出错: {str(e)}，使用原始URL", file=sys.stderr)
            
            # 过滤掉明显不是文章内容的图片（如头像、图标等）
            # 微信公众号文章图片通常包含 mmbiz.qpic.cn 或 mmbizurl.cn
            if 'mmbiz.qpic.cn' not in img_url and 'mmbizurl.cn' not in img_url:
                # 检查是否是文章内容图片（尺寸较大）
                width = img.get('width') or img.get('data-width') or img.get('data-w') or ''
                height = img.get('height') or img.get('data-height') or ''
                # 如果图片很小（可能是图标），跳过
                try:
                    if width and height:
                        w = int(str(width).replace('px', '').strip())
                        h = int(str(height).replace('px', '').strip())
                        if w < 100 or h < 100:
                            continue
                except:
                    pass
            
            # 获取图片尺寸
            width = img.get('width') or img.get('data-width') or img.get('data-w') or ''
            height = img.get('height') or img.get('data-height') or ''
            
            images.append({
                'url': img_url,
                'position': idx + 1,  # 在正文中的位置（从1开始）
                'width': width,
                'height': height,
                'alt': img.get('alt', '')
            })
            print(f"✓ 成功提取图片 {idx + 1}: {img_url[:100]}... (尺寸: {width}x{height}, alt: {img.get('alt', '无')[:30]})", file=sys.stderr)
        
        # 去重（相同的URL只保留一个）
        seen_urls = set()
        unique_images = []
        for img in images:
            # 在去重时，也清理URL中的锚点和参数，确保相同图片的不同URL变体能被识别为同一张
            clean_url = img['url'].split('#')[0]  # 移除锚点
            if clean_url not in seen_urls:
                seen_urls.add(clean_url)
                unique_images.append(img)
        
        print(f"总共提取到 {len(images)} 张图片，去重后 {len(unique_images)} 张", file=sys.stderr)
        return unique_images
        """
    
    # ========== 图片识别方法已禁用 ==========
    # 暂时不实现图片文字识别功能
    def _recognize_image_text(self, img_info: Dict) -> Optional[str]:
        """
        使用AI模型识别图片文字（已禁用）
        :param img_info: 图片信息
        :return: 识别的文字内容（始终返回None）
        """
        # 图片识别功能已禁用，直接返回None
        print(f"[图片识别] ⚠️ _recognize_image_text方法被调用，但功能已禁用，返回None", file=sys.stderr)
        return None
        
        # ========== 以下代码已被注释（使用三引号注释） ==========
        # 注意：以下代码已被禁用，暂时不实现图片文字识别功能
        """
        if not self.image_model_config:
            return None
        
        try:
            print(f"开始下载图片: {img_info['url'][:100]}...", file=sys.stderr)
            # 下载图片，设置更完整的请求头
            img_response = self.session.get(
                img_info['url'], 
                timeout=30,
                headers={
                    'Referer': 'https://mp.weixin.qq.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            )
            img_response.raise_for_status()
            
            # 检查响应内容类型
            content_type = img_response.headers.get('Content-Type', '')
            if not content_type.startswith('image/'):
                print(f"警告：响应内容类型不是图片: {content_type}", file=sys.stderr)
            
            # 检查图片大小
            img_size = len(img_response.content)
            print(f"图片下载成功，大小: {img_size} 字节，类型: {content_type}", file=sys.stderr)
            
            if img_size < 100:
                print(f"警告：图片太小（{img_size}字节），可能下载失败", file=sys.stderr)
                return None
            
            # 将图片转换为base64
            img_base64 = base64.b64encode(img_response.content).decode('utf-8')
            print(f"图片转换为base64成功，base64长度: {len(img_base64)}字符", file=sys.stderr)
            
            # 调用AI模型API
            api_endpoint = self.image_model_config.get('api_endpoint')
            api_key = self.image_model_config.get('api_key')
            model_name = self.image_model_config.get('model_name', 'Qwen2.5-VL-32B-Instruct')
            
            print(f"[图片识别API] 准备调用API，endpoint: {api_endpoint}, model: {model_name}, api_type: {self.image_model_config.get('api_type', 'chat')}", file=sys.stderr)
            
            # 构建请求
            headers = {
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            }
            
            # 构建提示词
            prompt = "请识别这张图片中的所有文字内容，包括图片中的标题、正文、图表文字等。如果图片中没有文字，请返回'无文字内容'。"
            
            # 根据不同的API类型构建请求体
            api_type = self.image_model_config.get('api_type', 'chat')
            print(f"[图片识别API] API类型: {api_type}", file=sys.stderr)
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
            print(f"[图片识别API] 发送API请求...", file=sys.stderr)
            response = requests.post(
                api_endpoint,
                headers=headers,
                json=payload,
                timeout=60
            )
            print(f"[图片识别API] API响应状态码: {response.status_code}", file=sys.stderr)
            response.raise_for_status()
            
            result = response.json()
            print(f"[图片识别API] API响应解析成功", file=sys.stderr)
            
            # 解析响应
            api_type = self.image_model_config.get('api_type', 'chat')
            print(f"[图片识别API] 解析响应，API类型: {api_type}, 响应键: {list(result.keys())}", file=sys.stderr)
            
            if api_type == 'chat' or api_type == 'chat_completion':
                # Chat API 或 Chat Completion API响应格式（兼容OpenAI）
                if 'choices' in result and len(result['choices']) > 0:
                    content = result['choices'][0]['message']['content']
                    print(f"[图片识别API] ✓ 成功解析响应，内容长度: {len(content)}字符", file=sys.stderr)
                    return content
                else:
                    print(f"[图片识别API] ⚠️ 响应中没有choices字段或choices为空", file=sys.stderr)
                    print(f"[图片识别API] 响应内容: {str(result)[:500]}...", file=sys.stderr)
            else:
                # 其他API类型的响应格式
                if 'text' in result:
                    content = result['text']
                    print(f"[图片识别API] ✓ 成功解析响应（text字段），内容长度: {len(content)}字符", file=sys.stderr)
                    return content
                elif 'content' in result:
                    content = result['content']
                    print(f"[图片识别API] ✓ 成功解析响应（content字段），内容长度: {len(content)}字符", file=sys.stderr)
                    return content
                else:
                    print(f"[图片识别API] ⚠️ 响应中没有text或content字段", file=sys.stderr)
                    print(f"[图片识别API] 响应内容: {str(result)[:500]}...", file=sys.stderr)
            
            print(f"[图片识别API] ✗ 无法解析响应，返回None", file=sys.stderr)
            return None
            
        except requests.exceptions.RequestException as e:
            print(f"[图片识别API] ✗ 网络请求失败: {str(e)}", file=sys.stderr)
            import traceback
            print(f"[图片识别API] 错误堆栈: {traceback.format_exc()}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"[图片识别API] ✗ 图片识别失败: {str(e)}", file=sys.stderr)
            import traceback
            print(f"[图片识别API] 错误堆栈: {traceback.format_exc()}", file=sys.stderr)
            return None
        """
    
    def _combine_content(self, text_content: str, image_texts: List[Dict]) -> str:
        """
        整合正文文本和图片识别的文字
        :param text_content: 正文文本
        :param image_texts: 图片识别的文字列表
        :return: 整合后的内容
        """
        # 如果正文为空或太短，但图片识别有内容，优先使用图片识别内容
        if (not text_content or len(text_content.strip()) < 50) and image_texts:
            # 纯图片文章，只返回图片识别内容
            parts = []
            for img_text_info in image_texts:
                parts.append(f"[图片{img_text_info['position']}文字识别内容]\n{img_text_info['text']}")
            return '\n\n'.join(parts)
        
        # 如果正文有内容，整合正文和图片文字
        if not image_texts:
            return text_content
        
        # 构建完整内容
        parts = [text_content] if text_content.strip() else []
        
        for img_text_info in image_texts:
            parts.append(f"\n\n[图片{img_text_info['position']}文字识别内容]\n{img_text_info['text']}")
        
        return '\n'.join(parts) if parts else ''


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

