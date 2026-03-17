# -*- coding: utf-8 -*-
"""
黑马API 专用插件
适配 谷歌 Gemini 官方请求格式 + Grok API 格式
完全适配原生 UI 规范
"""

import os
import sys
import json
import base64
import requests
import time
import re
from io import BytesIO
from PIL import Image
from datetime import datetime
from pathlib import Path

# 导入 PySide6 组件
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                               QLineEdit, QSpinBox, QComboBox, QSizePolicy)
from PySide6.QtGui import QFont

# 导入自定义控件 (处理无滚轮干扰的下拉框)
try:
    from gui.custom_widgets import NoWheelComboBox
except:
    from PySide6.QtWidgets import QComboBox as NoWheelComboBox

# 导入 PasswordEditor
plugin_dir = Path(__file__).parent
generator_dir = plugin_dir.parent.parent.parent
sys.path.insert(0, str(generator_dir))
from gui import password_editor

# 导入插件通用工具
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from plugin_utils import load_plugin_config, update_plugin_param, update_plugin_params

# 保存插件文件路径
_PLUGIN_FILE = __file__

# === 基础配置与默认参数 ===
GROK_BASE_URL = 'https://api.mmg.lat'

_default_params = {
    'api_key': '',
    'model': 'nanobanana2',  # 基础模型名
    'aspect_ratio': '16:9',
    'image_size': '2K',      # 分辨率选项
    'request_timeout': 300, 
    'download_timeout': 120,
    'retry_count': 3,

    # Jimeng(OpenAI兼容) - 走 NewAPI 域名
    'jimeng_image_model': 'jimeng-4.5',
    'jimeng_video_model': 'jimeng-video-3.5-pro',
    'jimeng_poll_interval': 2,
}

# 供用户选择的基础模型
AVAILABLE_MODELS = [
    'nanobanana2',
    'nanobananapro',
    'grok-imagine-1.0',       # Grok 图像生成
    'grok-imagine-1.0-edit',  # Grok 图像编辑

    # Jimeng（通过 NewAPI / OpenAI 兼容接口）
    'jimeng-image',
    'jimeng-video',
]

# 供用户选择的比例和分辨率
ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '2:3', '3:2']
GROK_ASPECT_RATIOS = ['16:9', '9:16', '1:1']
IMAGE_SIZES = ['2K', '4K']

# Grok 比例与实际 size 映射
GROK_SIZE_MAP = {
    '16:9': '1280x720',
    '9:16': '720x1280',
    '1:1': '1024x1024'
}

# 全局参数存储
_global_params = _default_params.copy()
_global_params.update(load_plugin_config(_PLUGIN_FILE))

print("[Nano Banana] 插件加载完成 (Gemini + Grok 模式)。")


def get_info():
    return {
        "name": "黑马 API",
        "description": "黑马API插件。\n支持图生图及Grok图像生成与编辑。",
        "version": "V5.4",
        "author": "黑马API"
    }


class PluginUI:
    def __init__(self):
        self.widgets = {}
        self.size_label = None  
    
    def create_ui(self, parent_widget):
        container = QWidget(parent_widget)
        layout = QVBoxLayout()
        layout.setSpacing(8)
        # 严格使用 153 左边距，保证与主界面完美对齐
        layout.setContentsMargins(153, 10, 10, 10)
        container.setLayout(layout)
        
        # 统一样式定义
        font_yahei = QFont("Microsoft YaHei", 9)
        label_color = "color: #CCCCCC;"
        input_style = """
            QWidget {
                background-color: #2b2b2b;
                color: #CCCCCC;
                border: 1px solid #3d3d3d;
                border-radius: 3px;
                padding: 5px;
            }
            QWidget:focus {
                border: 1px solid #0d7377;
            }
        """

        # 1. API Key
        api_key_layout = QHBoxLayout()
        api_key_label = QLabel("API Key:")
        api_key_label.setFixedWidth(100)
        api_key_label.setFont(font_yahei)
        api_key_label.setStyleSheet(label_color)
        
        self.widgets['api_key'] = password_editor.PasswordEditor(
            textChanged=lambda: self._update_param('api_key', self.widgets['api_key'].text()),
            default_text=_global_params.get('api_key', ''),
            placeholder="请输入 API Key"
        )
        self.widgets['api_key'].setFixedHeight(32)
        self.widgets['api_key'].editor.input.setFont(font_yahei)
        
        api_key_layout.addWidget(api_key_label)
        api_key_layout.addWidget(self.widgets['api_key'])
        layout.addLayout(api_key_layout)
        
        # 2. 基础模型选择
        model_layout = QHBoxLayout()
        model_label = QLabel("基础模型:")
        model_label.setFixedWidth(100)
        model_label.setFont(font_yahei)
        model_label.setStyleSheet(label_color)
        
        self.widgets['model'] = NoWheelComboBox()
        self.widgets['model'].addItems(AVAILABLE_MODELS)
        self.widgets['model'].setCurrentText(_global_params.get('model', 'nanobanana2'))
        self.widgets['model'].setFont(font_yahei)
        self.widgets['model'].setFixedHeight(32)
        self.widgets['model'].setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.widgets['model'].setStyleSheet(input_style.replace('QWidget', 'QComboBox'))
        
        model_layout.addWidget(model_label)
        model_layout.addWidget(self.widgets['model'])
        layout.addLayout(model_layout)
        
        # 3. 图片比例
        ratio_layout = QHBoxLayout()
        ratio_label = QLabel("图片比例:")
        ratio_label.setFixedWidth(100)
        ratio_label.setFont(font_yahei)
        ratio_label.setStyleSheet(label_color)
        
        self.widgets['aspect_ratio'] = NoWheelComboBox()
        self.widgets['aspect_ratio'].setFont(font_yahei)
        self.widgets['aspect_ratio'].setFixedHeight(32)
        self.widgets['aspect_ratio'].setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.widgets['aspect_ratio'].setStyleSheet(input_style.replace('QWidget', 'QComboBox'))
        self.widgets['aspect_ratio'].currentTextChanged.connect(lambda text: self._update_param('aspect_ratio', text))
        
        ratio_layout.addWidget(ratio_label)
        ratio_layout.addWidget(self.widgets['aspect_ratio'])
        layout.addLayout(ratio_layout)

        # 4. 分辨率
        self.size_layout = QHBoxLayout()
        self.size_label = QLabel("分辨率:")
        self.size_label.setFixedWidth(100)
        self.size_label.setFont(font_yahei)
        self.size_label.setStyleSheet(label_color)
        
        self.widgets['image_size'] = NoWheelComboBox()
        self.widgets['image_size'].addItems(IMAGE_SIZES)
        self.widgets['image_size'].setCurrentText(_global_params.get('image_size', '2K'))
        self.widgets['image_size'].setFont(font_yahei)
        self.widgets['image_size'].setFixedHeight(32)
        self.widgets['image_size'].setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.widgets['image_size'].setStyleSheet(input_style.replace('QWidget', 'QComboBox'))
        self.widgets['image_size'].currentTextChanged.connect(lambda text: self._update_param('image_size', text))
        
        self.size_layout.addWidget(self.size_label)
        self.size_layout.addWidget(self.widgets['image_size'])
        layout.addLayout(self.size_layout)

        # 5. 请求超时
        req_timeout_layout = QHBoxLayout()
        req_label = QLabel("请求超时(秒):")
        req_label.setFixedWidth(100)
        req_label.setFont(font_yahei)
        req_label.setStyleSheet(label_color)
        
        self.widgets['request_timeout'] = QSpinBox()
        self.widgets['request_timeout'].setMinimum(10)
        self.widgets['request_timeout'].setMaximum(999999)
        self.widgets['request_timeout'].setValue(int(_global_params.get('request_timeout', 300)))
        self.widgets['request_timeout'].setFont(font_yahei)
        self.widgets['request_timeout'].setFixedHeight(32)
        self.widgets['request_timeout'].setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.widgets['request_timeout'].setStyleSheet(input_style.replace('QWidget', 'QSpinBox'))
        self.widgets['request_timeout'].valueChanged.connect(lambda val: self._update_param('request_timeout', val))
        
        req_timeout_layout.addWidget(req_label)
        req_timeout_layout.addWidget(self.widgets['request_timeout'])
        layout.addLayout(req_timeout_layout)
        
        # 6. 下载超时
        dl_timeout_layout = QHBoxLayout()
        dl_label = QLabel("下载超时(秒):")
        dl_label.setFixedWidth(100)
        dl_label.setFont(font_yahei)
        dl_label.setStyleSheet(label_color)
        
        self.widgets['download_timeout'] = QSpinBox()
        self.widgets['download_timeout'].setMinimum(10)
        self.widgets['download_timeout'].setMaximum(999999)
        self.widgets['download_timeout'].setValue(int(_global_params.get('download_timeout', 120)))
        self.widgets['download_timeout'].setFont(font_yahei)
        self.widgets['download_timeout'].setFixedHeight(32)
        self.widgets['download_timeout'].setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.widgets['download_timeout'].setStyleSheet(input_style.replace('QWidget', 'QSpinBox'))
        self.widgets['download_timeout'].valueChanged.connect(lambda val: self._update_param('download_timeout', val))
        
        dl_timeout_layout.addWidget(dl_label)
        dl_timeout_layout.addWidget(self.widgets['download_timeout'])
        layout.addLayout(dl_timeout_layout)

        # 7. 重试次数
        retry_layout = QHBoxLayout()
        retry_label = QLabel("重试次数:")
        retry_label.setFixedWidth(100)
        retry_label.setFont(font_yahei)
        retry_label.setStyleSheet(label_color)
        
        self.widgets['retry_count'] = QSpinBox()
        self.widgets['retry_count'].setMinimum(0)
        self.widgets['retry_count'].setMaximum(10)
        self.widgets['retry_count'].setValue(int(_global_params.get('retry_count', 3)))
        self.widgets['retry_count'].setFont(font_yahei)
        self.widgets['retry_count'].setFixedHeight(32)
        self.widgets['retry_count'].setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        self.widgets['retry_count'].setStyleSheet(input_style.replace('QWidget', 'QSpinBox'))
        self.widgets['retry_count'].valueChanged.connect(lambda val: self._update_param('retry_count', val))
        
        retry_layout.addWidget(retry_label)
        retry_layout.addWidget(self.widgets['retry_count'])
        layout.addLayout(retry_layout)

        # 绑定模型切换事件 (UI 联动)
        self.widgets['model'].currentTextChanged.connect(self._on_model_changed)
        
        # 初始化触发一次，确保显示状态正确
        self._on_model_changed(self.widgets['model'].currentText())

        return container
    
    def _on_model_changed(self, model_name):
        self._update_param('model', model_name)
        
        # 记录当前选择的比例
        current_ratio = self.widgets['aspect_ratio'].currentText() or _global_params.get('aspect_ratio', '16:9')
        
        # 暂停信号以防止触发多次保存
        self.widgets['aspect_ratio'].blockSignals(True)
        self.widgets['aspect_ratio'].clear()
        
        if model_name.startswith('grok'):
            # Grok 模型：更新比例列表并隐藏分辨率
            self.widgets['aspect_ratio'].addItems(GROK_ASPECT_RATIOS)
            if current_ratio in GROK_ASPECT_RATIOS:
                self.widgets['aspect_ratio'].setCurrentText(current_ratio)
            else:
                self.widgets['aspect_ratio'].setCurrentText('16:9')
                
            self.size_label.hide()
            self.widgets['image_size'].hide()
        else:
            # 原生模型：恢复所有比例和分辨率选项
            self.widgets['aspect_ratio'].addItems(ASPECT_RATIOS)
            if current_ratio in ASPECT_RATIOS:
                self.widgets['aspect_ratio'].setCurrentText(current_ratio)
            else:
                self.widgets['aspect_ratio'].setCurrentText('16:9')
                
            self.size_label.show()
            self.widgets['image_size'].show()
            
        self.widgets['aspect_ratio'].blockSignals(False)
        self._update_param('aspect_ratio', self.widgets['aspect_ratio'].currentText())

    def _update_param(self, key, value):
        global _global_params
        _global_params[key] = value
        update_plugin_param(_PLUGIN_FILE, key, value)
    
    def load_params(self, params):
        global _global_params
        _global_params.update(params)
        if 'api_key' in self.widgets: self.widgets['api_key'].setText(str(params.get('api_key', '')))
        if 'model' in self.widgets: self.widgets['model'].setCurrentText(str(params.get('model', 'nanobanana2')))
        if 'image_size' in self.widgets: self.widgets['image_size'].setCurrentText(str(params.get('image_size', '2K')))
        if 'request_timeout' in self.widgets: self.widgets['request_timeout'].setValue(int(params.get('request_timeout', 300)))
        if 'download_timeout' in self.widgets: self.widgets['download_timeout'].setValue(int(params.get('download_timeout', 120)))
        if 'retry_count' in self.widgets: self.widgets['retry_count'].setValue(int(params.get('retry_count', 3)))

_plugin_ui = None

def create_ui(parent_widget):
    global _plugin_ui
    _plugin_ui = PluginUI()
    return _plugin_ui.create_ui(parent_widget)

def get_params():
    return _global_params.copy()

def load_params(params):
    global _global_params
    if _plugin_ui: _plugin_ui.load_params(_global_params)

def _force_sync_params_from_ui():
    global _global_params, _plugin_ui
    if not _plugin_ui: return
    w = _plugin_ui.widgets
    if 'api_key' in w: _global_params['api_key'] = w['api_key'].text()
    if 'model' in w: _global_params['model'] = w['model'].currentText()
    if 'aspect_ratio' in w: _global_params['aspect_ratio'] = w['aspect_ratio'].currentText()
    if 'image_size' in w: _global_params['image_size'] = w['image_size'].currentText()
    if 'request_timeout' in w: _global_params['request_timeout'] = w['request_timeout'].value()
    if 'download_timeout' in w: _global_params['download_timeout'] = w['download_timeout'].value()
    if 'retry_count' in w: _global_params['retry_count'] = w['retry_count'].value()
    update_plugin_params(_PLUGIN_FILE, _global_params)


# ==========================================
# Grok 新增请求逻辑 (图像生成 / 图像编辑)
# ==========================================

def send_grok_generation_request(api_key, target_model, prompt, size_str, timeout):
    url = f"{GROK_BASE_URL.rstrip('/')}/v1/images/generations"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    payload = {
        "model": target_model,
        "prompt": prompt,
        "n": 1,
        "size": size_str,
        "response_format": "b64_json"
    }
    
    print(f"[Grok Request] {url} | Model: {target_model} | Size: {size_str}")
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=timeout)
    except requests.exceptions.Timeout:
        raise Exception("请求超时，请检查网络或增加超时时间")
    except Exception as e:
        raise Exception(f"网络连接失败: {str(e)}")

    if response.status_code != 200:
        raise Exception(f"Grok API Error {response.status_code}: {response.text[:200]}")

    data = response.json()
    if 'data' not in data or len(data['data']) == 0:
        raise Exception(f"Grok API 响应格式异常: {str(data)[:200]}")
        
    item = data['data'][0]
    if 'b64_json' in item and item['b64_json']:
        return item['b64_json']
    elif 'url' in item and item['url']:
        return download_image(item['url'])
    else:
        raise Exception("返回内容中未找到有效的 b64_json 或 url")


def send_grok_edit_request(api_key, target_model, prompt, image_path, size_str, timeout):
    url = f"{GROK_BASE_URL.rstrip('/')}/v1/images/edits"
    headers = {
        "Authorization": f"Bearer {api_key}"
    }
    
    mime_type = 'image/png'
    if image_path.lower().endswith(('.jpg', '.jpeg')): mime_type = 'image/jpeg'
    elif image_path.lower().endswith('.webp'): mime_type = 'image/webp'
    
    print(f"[Grok Edit Request] {url} | Image: {os.path.basename(image_path)} | Size: {size_str}")
    try:
        with open(image_path, 'rb') as f:
            files = {
                'image': (os.path.basename(image_path), f, mime_type)
            }
            data = {
                "model": target_model,
                "prompt": prompt,
                "n": 1,
                "size": size_str,
                "response_format": "b64_json"
            }
            response = requests.post(url, headers=headers, data=data, files=files, timeout=timeout)
    except requests.exceptions.Timeout:
        raise Exception("请求超时，请检查网络或增加超时时间")
    except Exception as e:
        raise Exception(f"网络连接失败: {str(e)}")

    if response.status_code != 200:
        raise Exception(f"Grok API Error {response.status_code}: {response.text[:200]}")

    data = response.json()
    if 'data' not in data or len(data['data']) == 0:
        raise Exception(f"Grok API 响应格式异常: {str(data)[:200]}")
        
    item = data['data'][0]
    if 'b64_json' in item and item['b64_json']:
        return item['b64_json']
    elif 'url' in item and item['url']:
        return download_image(item['url'])
    else:
        raise Exception("返回内容中未找到有效的 b64_json 或 url")


# ==========================================
# Jimeng(OpenAI兼容) - async 任务轮询
# ==========================================

def _jm_headers(api_key: str):
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        # 固定日本节点（依赖你的 NewAPI/反代放行这些头）
        "X-Token-Node": "jp",
        "X-From-NewAPI": "1",
    }


def _poll_task_result(base_url: str, api_key: str, task_id: str, timeout: int, poll_interval: int = 2):
    url = f"{base_url.rstrip('/')}/v1/tasks/{task_id}"
    start = time.time()
    last_print = 0
    while True:
        if time.time() - start > timeout:
            raise Exception(f"任务查询超时: {task_id}")

        try:
            resp = requests.get(url, headers=_jm_headers(api_key), timeout=min(30, timeout))
        except requests.exceptions.Timeout:
            resp = None
        except Exception as e:
            raise Exception(f"任务查询网络异常: {str(e)}")

        if not resp or resp.status_code != 200:
            # 查询接口偶发波动时继续轮询
            now = time.time()
            if now - last_print >= poll_interval:
                print("生成中..")
                last_print = now
            time.sleep(poll_interval)
            continue

        data = resp.json()
        status = data.get("status")
        if status == "processing":
            now = time.time()
            if now - last_print >= poll_interval:
                print("生成中..")
                last_print = now
            time.sleep(poll_interval)
            continue
        if status == "failed":
            err = data.get("error") or {}
            raise Exception(err.get("message") or "任务失败")
        if status == "succeeded":
            return data.get("result")

        # 兜底：未知状态也继续轮询
        now = time.time()
        if now - last_print >= poll_interval:
            print("生成中..")
            last_print = now
        time.sleep(poll_interval)


def send_jimeng_image_request(api_key: str, prompt: str, aspect_ratio: str, image_size: str, timeout: int):
    base_url = GROK_BASE_URL
    url = f"{base_url.rstrip('/')}/v1/images/generations"
    payload = {
        "model": _global_params.get("jimeng_image_model", "jimeng-4.5"),
        "prompt": prompt,
        "ratio": aspect_ratio,
        "resolution": image_size.lower(),
        "response_format": "b64_json",
        "async": True,
    }
    resp = requests.post(url, json=payload, headers=_jm_headers(api_key), timeout=timeout)
    if resp.status_code != 200:
        raise Exception(f"Jimeng 图片提交失败 {resp.status_code}: {resp.text[:200]}")
    j = resp.json()
    task_id = j.get("task_id")
    if not task_id:
        raise Exception(f"Jimeng 图片提交返回异常: {str(j)[:200]}")

    result = _poll_task_result(
        base_url=base_url,
        api_key=api_key,
        task_id=task_id,
        timeout=timeout,
        poll_interval=int(_global_params.get("jimeng_poll_interval", 2)),
    )
    return result


def send_jimeng_video_request(api_key: str, prompt: str, aspect_ratio: str, resolution: str, timeout: int):
    base_url = GROK_BASE_URL
    url = f"{base_url.rstrip('/')}/v1/videos/generations"
    payload = {
        "model": _global_params.get("jimeng_video_model", "jimeng-video-3.5-pro"),
        "prompt": prompt,
        "ratio": aspect_ratio,
        "resolution": resolution.lower(),
        "duration": 5,
        "response_format": "url",
        "async": True,
    }
    resp = requests.post(url, json=payload, headers=_jm_headers(api_key), timeout=timeout)
    if resp.status_code != 200:
        raise Exception(f"Jimeng 视频提交失败 {resp.status_code}: {resp.text[:200]}")
    j = resp.json()
    task_id = j.get("task_id")
    if not task_id:
        raise Exception(f"Jimeng 视频提交返回异常: {str(j)[:200]}")

    result = _poll_task_result(
        base_url=base_url,
        api_key=api_key,
        task_id=task_id,
        timeout=timeout,
        poll_interval=int(_global_params.get("jimeng_poll_interval", 2)),
    )
    return result


# ==========================================
# 核心网络请求逻辑 (Gemini 原生格式)
# ==========================================

def send_gemini_request(api_key, target_model, prompt, reference_images, aspect_ratio, image_size, timeout):
    url = f"https://api.mmg.lat/v1beta/models/{target_model}:generateContent"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}" 
    }
    
    parts = [{"text": prompt}]
    
    for position, img_path in reference_images.items():
        if os.path.exists(img_path) and os.path.getsize(img_path) > 0:
            try:
                with open(img_path, 'rb') as f:
                    b64_data = base64.b64encode(f.read()).decode('utf-8')
                mime_type = 'image/png'
                if img_path.lower().endswith(('.jpg', '.jpeg')): mime_type = 'image/jpeg'
                elif img_path.lower().endswith('.webp'): mime_type = 'image/webp'
                
                parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
            except Exception as e:
                print(f"  ! 参考图加载失败 {img_path}: {e}")

    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"], 
            "imageConfig": {
                "aspectRatio": aspect_ratio,
                "imageSize": image_size.upper() 
            }
        }
    }

    print(f"[Request] {url}")
    print(f"[AR] {aspect_ratio} | [Size] {image_size}")
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=timeout)
    except requests.exceptions.Timeout:
        raise Exception("请求超时，请检查网络或增加超时时间")
    except Exception as e:
        raise Exception(f"网络连接失败: {str(e)}")
        
    if response.status_code != 200:
        raise Exception(f"API Error {response.status_code}: {response.text[:200]}")

    data = response.json()
    if 'candidates' not in data or len(data['candidates']) == 0:
        raise Exception(f"API 未返回候选结果: {str(data)[:200]}")
    
    candidate = data['candidates'][0]
    if 'content' not in candidate or 'parts' not in candidate['content']:
        raise Exception("响应格式异常：未找到 content.parts 节点")
        
    for part in candidate['content']['parts']:
        if 'inlineData' in part:
            return part['inlineData']['data']
        elif 'text' in part:
            text = part['text']
            data_uri_match = re.search(r'data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)', text)
            if data_uri_match:
                return data_uri_match.group(2)
            url_match = re.search(r'!\[.*?\]\((https?://[^\)]+)\)', text)
            if url_match:
                img_url = url_match.group(1)
                return download_image(img_url)

    raise Exception("API 响应成功，但未能从中提取到图片数据")


def download_image(url):
    timeout = int(_global_params.get('download_timeout', 120))
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        resp = requests.get(url, timeout=timeout, headers=headers)
        if resp.status_code == 200:
            if 'text/html' in resp.headers.get('Content-Type', ''):
                raise Exception("图片下载失败，URL 被重定向至 HTML 网页(可能被防爬虫拦截)")
            return base64.b64encode(resp.content).decode('utf-8')
        else:
            raise Exception(f"下载失败 HTTP Code: {resp.status_code}")
    except Exception as e:
        raise Exception(f"图片下载异常: {str(e)}")


def generate(context):
    print("\n" + "="*60)
    print("API Generator (Gemini + Grok 协议)")
    print("="*60)
    
    _force_sync_params_from_ui()
    
    prompt = context.get('prompt', '')
    ref_imgs = context.get('reference_images', {})
    output_dir = context.get('output_dir', '')
    
    api_key = _global_params.get('api_key', '')
    base_model = _global_params.get('model', 'nanobanana2')
    aspect_ratio = _global_params.get('aspect_ratio', '16:9')
    image_size = _global_params.get('image_size', '2K')
    req_timeout = int(_global_params.get('request_timeout', 300))
    retry_max = int(_global_params.get('retry_count', 3))

    if not api_key or api_key.strip() == '':
        print(f"❌ 错误: 未设置 API Key")
        return []

    # === 模型拼接与判断逻辑 ===
    is_jimeng_image = (base_model == 'jimeng-image')
    is_jimeng_video = (base_model == 'jimeng-video')
    is_grok = base_model.startswith('grok')
    
    if is_jimeng_image or is_jimeng_video:
        target_model = base_model
    elif is_grok:
        target_model = base_model
        grok_size_str = GROK_SIZE_MAP.get(aspect_ratio, '1280x720')
    else:
        model_prefix = "nanobanana-2" if base_model == "nanobanana2" else "nanobanana-pro"
        size_suffix = image_size.lower()
        target_model = f"{model_prefix}-{size_suffix}"

    os.makedirs(output_dir, exist_ok=True)
    generated_files = []
    max_attempts = retry_max + 1
    
    for attempt in range(max_attempts):
        try:
            if attempt > 0:
                print(f"\n[重试] 第 {attempt + 1}/{max_attempts} 次尝试...")
            
            # === 分流处理 ===
            if is_jimeng_image:
                result = send_jimeng_image_request(api_key, prompt, aspect_ratio, image_size, req_timeout)
                # 期望 result 结构：{created, data:[{b64_json|url}, ...]}
                items = (result or {}).get("data") or []
                if not items:
                    raise Exception("Jimeng 未返回图片数据")

                viewer_index = context.get('viewer_index', 0)
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                safe_model_name = (_global_params.get("jimeng_image_model", "jimeng-4.5") or "jimeng-4.5").replace('.', '-')

                for idx, it in enumerate(items):
                    b64_image = it.get("b64_json")
                    if not b64_image and it.get("url"):
                        b64_image = download_image(it.get("url"))
                    if not b64_image:
                        continue
                    if ',' in b64_image and str(b64_image).startswith('data:'):
                        b64_image = b64_image.split(',', 1)[1]
                    image_data = base64.b64decode(b64_image)
                    img = Image.open(BytesIO(image_data))
                    if img.mode not in ('RGB', 'RGBA'):
                        img = img.convert('RGBA')
                    filename = f"{viewer_index:04d}_{safe_model_name}_{timestamp}_{idx+1}.png"
                    output_path = os.path.join(output_dir, filename)
                    img.save(output_path, 'PNG')
                    generated_files.append(output_path)
                    print(f"✓ 生成成功: {output_path}")

                if not generated_files:
                    raise Exception("Jimeng 返回项中没有可保存的图片")
                break

            if is_jimeng_video:
                result = send_jimeng_video_request(api_key, prompt, aspect_ratio, image_size, req_timeout)
                items = (result or {}).get("data") or []
                if not items:
                    raise Exception("Jimeng 未返回视频数据")
                url = items[0].get("url")
                if not url:
                    raise Exception("Jimeng 视频结果缺少 url")

                viewer_index = context.get('viewer_index', 0)
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                safe_model_name = (_global_params.get("jimeng_video_model", "jimeng-video-3.5-pro") or "jimeng-video-3.5-pro").replace('.', '-')
                filename = f"{viewer_index:04d}_{safe_model_name}_{timestamp}.mp4"
                output_path = os.path.join(output_dir, filename)

                # 下载视频
                try:
                    resp = requests.get(url, timeout=int(_global_params.get('download_timeout', 120)), stream=True)
                    if resp.status_code != 200:
                        raise Exception(f"下载失败 HTTP Code: {resp.status_code}")
                    with open(output_path, "wb") as f:
                        for chunk in resp.iter_content(chunk_size=1024 * 256):
                            if chunk:
                                f.write(chunk)
                except Exception as e:
                    raise Exception(f"视频下载异常: {str(e)}")

                generated_files.append(output_path)
                print(f"✓ 生成成功: {output_path}")
                break

            if is_grok:
                if target_model == 'grok-imagine-1.0-edit':
                    if not ref_imgs:
                        raise Exception("Grok 图像编辑需要参考图 (垫图)")
                    first_img_path = list(ref_imgs.values())[0]
                    b64_image = send_grok_edit_request(api_key, target_model, prompt, first_img_path, grok_size_str, req_timeout)
                else:
                    b64_image = send_grok_generation_request(api_key, target_model, prompt, grok_size_str, req_timeout)
            else:
                b64_image = send_gemini_request(api_key, target_model, prompt, ref_imgs, aspect_ratio, image_size, req_timeout)
            
            # === 统一的图片保存逻辑 ===
            if ',' in b64_image and b64_image.startswith('data:'):
                b64_image = b64_image.split(',', 1)[1]
                
            image_data = base64.b64decode(b64_image)
            img = Image.open(BytesIO(image_data))
            
            # 【修复 1】强制规范化色彩模式，防止宿主UI组件（如 QPixmap）因无法解析 CMYK 或索引模式导致图片无法显示
            if img.mode not in ('RGB', 'RGBA'):
                img = img.convert('RGBA')
            
            viewer_index = context.get('viewer_index', 0)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            
            # 【修复 2】去除模型名称中的 `.` (点)，防止宿主软件通过 `.` 切割后缀名时发生越界或判断错误
            safe_model_name = target_model.replace('.', '-')
            
            filename = f"{viewer_index:04d}_{safe_model_name}_{timestamp}.png"
            output_path = os.path.join(output_dir, filename)
            
            # 存至硬盘
            img.save(output_path, 'PNG')
            generated_files.append(output_path)
            print(f"✓ 生成成功: {output_path}")
            
            break
            
        except Exception as e:
            is_last_attempt = (attempt == max_attempts - 1)
            err_msg = str(e)
            
            if is_last_attempt:
                print(f"❌ 生成失败（已尝试 {max_attempts} 次）: {err_msg}")
                raise Exception(f"PLUGIN_ERROR:::{err_msg}")
            else:
                print(f"⚠️ 第 {attempt + 1} 次尝试失败: {err_msg}")
                print("   将在 2 秒后重试...")
                time.sleep(2)

    print("="*60 + "\n")
    return generated_files