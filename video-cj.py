# -*- coding: utf-8 -*-
"""
黑马API
适配兼容 OpenAI 格式的 Grok 视频接口流式返回 (自动折算多轮进度)
"""

import os
import sys
import time
import json
import base64
import requests
import traceback
import re
from io import BytesIO
from pathlib import Path
from datetime import datetime

from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QLabel, 
                                QLineEdit, QPushButton, QSpinBox, QSizePolicy)
from PySide6.QtGui import QFont, QCursor
from PySide6.QtCore import Qt

# 导入自定义控件
plugin_dir = Path(__file__).parent
generator_dir = plugin_dir.parent.parent.parent
sys.path.insert(0, str(generator_dir))
from gui.widget.no_wheel_combo_box import NoWheelComboBox
from gui import password_editor

from plugin_utils import load_plugin_config, update_plugin_param, get_plugin_params

# 保存插件文件路径
_PLUGIN_FILE = __file__

# 默认参数 (移除了 stream)
_default_params = {
    'api_url': 'https://api.mmg.lat/v1/chat/completions',
    'api_key': '',
    # 双下拉：模型类别 + 模型细项
    'model_category': 'grok',
    'model_name': 'grok-video-6s',
    'aspect_ratio': '16:9',
    'duration': '6',
    'resolution': '720p',
    'timeout': 300,
    'generation_mode': '文生视频',
    'retry_count': 3,

    # Jimeng(OpenAI兼容) - 走 NewAPI 域名（固定日本节点）
    'jimeng_base_url': 'https://api.mmg.lat',
    'jimeng_video_model': 'jimeng-video-3.5-pro',
    'jimeng_poll_interval': 10,
}

JIMENG_VIDEO_MODELS_JP = [
    # JP 节点支持（见 README.CN.md），不包含仅国内站的 seedance
    'jimeng-video-3.5-pro',
    'jimeng-video-veo3',
    'jimeng-video-veo3.1',
    'jimeng-video-sora2',
    'jimeng-video-3.0-pro',
    'jimeng-video-3.0',
    'jimeng-video-3.0-fast',
    'jimeng-video-2.0-pro',
    'jimeng-video-2.0',
]

GROK_VIDEO_MODELS = [
    'grok-video-6s',
    'grok-video-10s',
    'grok-video-15s',
]

# 全局参数存储
_global_params = _default_params.copy()
_global_params.update(load_plugin_config(_PLUGIN_FILE))

print(f"[Grok Plugin] 插件初始化完成")

def get_info():
    """返回插件信息"""
    return {
        "name": "黑马API插件",
        "version": "1.5.0",
        "author": "黑马API"
    }

class PluginUI:
    """插件自定义 UI 类"""
    
    def __init__(self):
        self.widgets = {}
    
    def create_ui(self, parent_widget):
        """创建自定义 UI"""
        container = QWidget(parent_widget)
        layout = QVBoxLayout()
        layout.setSpacing(8)
        layout.setContentsMargins(153, 10, 10, 10)
        container.setLayout(layout)
        
        # API Key 输入
        api_key_layout = QHBoxLayout()
        api_key_label = QLabel("API Key:")
        api_key_label.setFixedWidth(100)
        api_key_label.setFont(QFont("Microsoft YaHei", 9))
        api_key_label.setStyleSheet("color: #CCCCCC;")
        
        self.widgets['api_key'] = password_editor.PasswordEditor(
            textChanged=lambda: self._update_param('api_key', self.widgets['api_key'].text()),
            default_text=_global_params.get('api_key', ''),
            placeholder="sk-..." 
        )
        self.widgets['api_key'].setFixedHeight(32)
        self.widgets['api_key'].editor.input.setFont(QFont("Microsoft YaHei", 9))
        
        api_key_layout.addWidget(api_key_label)
        api_key_layout.addWidget(self.widgets['api_key'])
        layout.addLayout(api_key_layout)
        
        # 模型类别
        cat_layout = QHBoxLayout()
        cat_label = QLabel("模型类别:")
        cat_label.setFixedWidth(100)
        cat_label.setFont(QFont("Microsoft YaHei", 9))
        cat_label.setStyleSheet("color: #CCCCCC;")

        self.widgets['model_category'] = NoWheelComboBox()
        self.widgets['model_category'].addItems(['grok', 'jimeng'])
        self.widgets['model_category'].setCurrentText(_global_params.get('model_category', 'grok'))
        self.widgets['model_category'].setFont(QFont("Microsoft YaHei", 9))
        self.widgets['model_category'].setFixedHeight(32)

        cat_layout.addWidget(cat_label)
        cat_layout.addWidget(self.widgets['model_category'])
        layout.addLayout(cat_layout)

        # 模型选择（细项）
        model_layout = QHBoxLayout()
        model_label = QLabel("模型选择:")
        model_label.setFixedWidth(100)
        model_label.setFont(QFont("Microsoft YaHei", 9))
        model_label.setStyleSheet("color: #CCCCCC;")
        
        self.widgets['model_name'] = NoWheelComboBox()
        self.widgets['model_name'].setFont(QFont("Microsoft YaHei", 9))
        self.widgets['model_name'].setFixedHeight(32)
        
        model_layout.addWidget(model_label)
        model_layout.addWidget(self.widgets['model_name'])
        layout.addLayout(model_layout)
        
        # 宽高比选择
        aspect_ratio_layout = QHBoxLayout()
        aspect_ratio_label = QLabel("宽高比:")
        aspect_ratio_label.setFixedWidth(100)
        aspect_ratio_label.setFont(QFont("Microsoft YaHei", 9))
        aspect_ratio_label.setStyleSheet("color: #CCCCCC;")
        
        self.widgets['aspect_ratio'] = NoWheelComboBox()
        self.widgets['aspect_ratio'].addItems(['16:9', '9:16', '1:1'])
        self.widgets['aspect_ratio'].setCurrentText(_global_params.get('aspect_ratio', '16:9'))
        self.widgets['aspect_ratio'].setFont(QFont("Microsoft YaHei", 9))
        self.widgets['aspect_ratio'].setFixedHeight(32)
        self.widgets['aspect_ratio'].currentTextChanged.connect(lambda text: self._update_param('aspect_ratio', text))
        
        aspect_ratio_layout.addWidget(aspect_ratio_label)
        aspect_ratio_layout.addWidget(self.widgets['aspect_ratio'])
        layout.addLayout(aspect_ratio_layout)
        
        # 视频时长选择（Grok：由模型细项决定；Jimeng：根据模型限制动态校验）
        duration_layout = QHBoxLayout()
        duration_label = QLabel("视频时长(秒):")
        duration_label.setFixedWidth(100)
        duration_label.setFont(QFont("Microsoft YaHei", 9))
        duration_label.setStyleSheet("color: #CCCCCC;")
        
        self.widgets['duration'] = NoWheelComboBox()
        self.widgets['duration'].addItems(['6', '10', '15']) 
        self.widgets['duration'].setCurrentText(_global_params.get('duration', '6'))
        self.widgets['duration'].setFont(QFont("Microsoft YaHei", 9))
        self.widgets['duration'].setFixedHeight(32)
        self.widgets['duration'].currentTextChanged.connect(lambda text: self._update_param('duration', text))
        
        duration_layout.addWidget(duration_label)
        duration_layout.addWidget(self.widgets['duration'])
        layout.addLayout(duration_layout)

        # 分辨率（仅 Jimeng 3.0 / 3.0-fast 支持 1080p）
        self.res_layout = QHBoxLayout()
        res_label = QLabel("分辨率:")
        res_label.setFixedWidth(100)
        res_label.setFont(QFont("Microsoft YaHei", 9))
        res_label.setStyleSheet("color: #CCCCCC;")

        self.widgets['resolution'] = NoWheelComboBox()
        self.widgets['resolution'].addItems(['720p', '1080p'])
        self.widgets['resolution'].setCurrentText(_global_params.get('resolution', '720p'))
        self.widgets['resolution'].setFont(QFont("Microsoft YaHei", 9))
        self.widgets['resolution'].setFixedHeight(32)
        self.widgets['resolution'].currentTextChanged.connect(lambda text: self._update_param('resolution', text))

        self.res_layout.addWidget(res_label)
        self.res_layout.addWidget(self.widgets['resolution'])
        layout.addLayout(self.res_layout)
        
        # 生成模式选择
        mode_layout = QHBoxLayout()
        mode_label = QLabel("生成模式:")
        mode_label.setFixedWidth(100)
        mode_label.setFont(QFont("Microsoft YaHei", 9))
        mode_label.setStyleSheet("color: #CCCCCC;")
        
        self.widgets['generation_mode'] = NoWheelComboBox()
        self.widgets['generation_mode'].addItems(['文生视频', '首帧生视频'])
        self.widgets['generation_mode'].setCurrentText(_global_params.get('generation_mode', '文生视频'))
        self.widgets['generation_mode'].setFont(QFont("Microsoft YaHei", 9))
        self.widgets['generation_mode'].setFixedHeight(32)
        self.widgets['generation_mode'].currentTextChanged.connect(lambda text: self._update_param('generation_mode', text))
        
        mode_layout.addWidget(mode_label)
        mode_layout.addWidget(self.widgets['generation_mode'])
        layout.addLayout(mode_layout)

        # 超时设置
        timeout_layout = QHBoxLayout()
        timeout_label = QLabel("超时(秒):")
        timeout_label.setFixedWidth(100)
        timeout_label.setFont(QFont("Microsoft YaHei", 9))
        timeout_label.setStyleSheet("color: #CCCCCC;")
        
        self.widgets['timeout'] = QSpinBox()
        self.widgets['timeout'].setRange(60, 3600)
        self.widgets['timeout'].setValue(_global_params.get('timeout', 300))
        self.widgets['timeout'].setStyleSheet("background-color: #2b2b2b; color: #CCCCCC; border: 1px solid #3d3d3d;")
        self.widgets['timeout'].valueChanged.connect(lambda v: self._update_param('timeout', v))
        
        timeout_layout.addWidget(timeout_label)
        timeout_layout.addWidget(self.widgets['timeout'])
        layout.addLayout(timeout_layout)
        
        # 联动：类别 -> 细项列表 + 参数显隐
        self.widgets['model_category'].currentTextChanged.connect(self._on_category_changed)
        self.widgets['model_name'].currentTextChanged.connect(self._on_model_name_changed)
        self._on_category_changed(self.widgets['model_category'].currentText())

        layout.addStretch()
        return container

    def _set_model_name_items(self, category: str):
        self.widgets['model_name'].blockSignals(True)
        self.widgets['model_name'].clear()
        items = GROK_VIDEO_MODELS if category == 'grok' else JIMENG_VIDEO_MODELS_JP
        self.widgets['model_name'].addItems(items)
        saved = _global_params.get('model_name')
        if isinstance(saved, str) and saved in items:
            self.widgets['model_name'].setCurrentText(saved)
        else:
            self.widgets['model_name'].setCurrentText(items[0] if items else '')
        self.widgets['model_name'].blockSignals(False)
        self._update_param('model_name', self.widgets['model_name'].currentText())

    def _on_category_changed(self, category: str):
        self._update_param('model_category', category)
        self._set_model_name_items(category)

        # Grok/Jimeng 参数联动
        if category == 'jimeng':
            self.widgets['generation_mode'].blockSignals(True)
            self.widgets['generation_mode'].clear()
            self.widgets['generation_mode'].addItems(['文生视频', '首帧生视频', '首尾帧生视频'])
            self.widgets['generation_mode'].setCurrentText(str(_global_params.get('generation_mode', '文生视频')))
            self.widgets['generation_mode'].blockSignals(False)
            self._update_param('generation_mode', self.widgets['generation_mode'].currentText())

            # Jimeng 时长选项保持（服务端会按模型兜底），这里给常用值
            self.widgets['duration'].blockSignals(True)
            self.widgets['duration'].clear()
            self.widgets['duration'].addItems(['4', '5', '8', '10', '12', '15'])
            self.widgets['duration'].setCurrentText(str(_global_params.get('duration', '5')))
            self.widgets['duration'].blockSignals(False)
        else:
            self.widgets['generation_mode'].blockSignals(True)
            self.widgets['generation_mode'].clear()
            self.widgets['generation_mode'].addItems(['文生视频', '首帧生视频'])
            self.widgets['generation_mode'].setCurrentText(str(_global_params.get('generation_mode', '文生视频')))
            self.widgets['generation_mode'].blockSignals(False)

            # Grok：时长由模型细项决定，避免出现三处不一致
            self.widgets['duration'].blockSignals(True)
            self.widgets['duration'].clear()
            self.widgets['duration'].addItems(['6', '10', '15'])
            # 尝试从模型名同步时长
            mn = self.widgets['model_name'].currentText()
            dur = '6'
            if mn.endswith('10s'): dur = '10'
            elif mn.endswith('15s'): dur = '15'
            self.widgets['duration'].setCurrentText(dur)
            self.widgets['duration'].blockSignals(False)
            self._update_param('duration', dur)

        # 分类切换后也刷新分辨率显隐
        self._apply_resolution_visibility()

    def _on_model_name_changed(self, text: str):
        self._update_param('model_name', text)
        self._apply_resolution_visibility()

    def _apply_resolution_visibility(self):
        category = self.widgets.get('model_category').currentText() if 'model_category' in self.widgets else _global_params.get('model_category', 'grok')
        model_name = self.widgets.get('model_name').currentText() if 'model_name' in self.widgets else _global_params.get('model_name', '')

        show = False
        if category == 'jimeng':
            m = str(model_name or '').lower()
            show = ('jimeng-video-3.0' in m) or ('jimeng-video-3.0-fast' in m)

        if show:
            self.widgets['resolution'].show()
            # label 是 layout 里第一个 widget
            self.res_layout.itemAt(0).widget().show()
        else:
            self.widgets['resolution'].setCurrentText('720p')
            self._update_param('resolution', '720p')
            self.widgets['resolution'].hide()
            self.res_layout.itemAt(0).widget().hide()
    
    def _update_param(self, key, value):
        global _global_params
        _global_params[key] = value
        update_plugin_param(_PLUGIN_FILE, key, value)
    
    def load_params(self, params):
        global _global_params
        _global_params.update(params)
        for key, widget in self.widgets.items():
            if key not in params: continue
            if isinstance(widget, QLineEdit) or isinstance(widget, password_editor.PasswordEditor):
                widget.setText(str(params[key]))
            elif isinstance(widget, NoWheelComboBox):
                widget.setCurrentText(str(params[key]))
            elif isinstance(widget, QSpinBox):
                widget.setValue(int(params[key]))

# 全局 UI 实例
_plugin_ui = None

def create_ui(parent_widget):
    global _plugin_ui
    _plugin_ui = PluginUI()
    return _plugin_ui.create_ui(parent_widget)

def get_params():
    return _global_params.copy()

def load_params(params):
    global _global_params
    if _plugin_ui:
        _plugin_ui.load_params(_global_params)

def _force_sync_params_from_ui():
    """强制同步UI参数"""
    global _global_params, _plugin_ui
    if not _plugin_ui: return
    
    widgets = _plugin_ui.widgets
    updated = False
    
    param_map = {
        'model_category': 'combo',
        'model_name': 'combo',
        'api_key': 'text',
        'aspect_ratio': 'combo',
        'duration': 'combo',
        'generation_mode': 'combo',
        'resolution': 'combo',
        'timeout': 'spin',
    }

    for key, type_ in param_map.items():
        if key not in widgets: continue
        val = None
        if type_ == 'text': val = widgets[key].text()
        elif type_ == 'combo': val = widgets[key].currentText()
        elif type_ == 'spin': val = widgets[key].value()
        
        if val is not None and _global_params.get(key) != val:
            _global_params[key] = val
            updated = True
            
    if updated:
        from plugin_utils import update_plugin_params
        update_plugin_params(_PLUGIN_FILE, _global_params)

def encode_image_to_base64(image_path):
    """读取本地图片并转换为 Base64"""
    if not image_path or not os.path.exists(image_path):
        return None
    try:
        with open(image_path, 'rb') as f:
            return base64.b64encode(f.read()).decode('utf-8')
    except Exception as e:
        print(f"[图片编码] 失败: {e}")
        return None


# ==========================================
# Jimeng(OpenAI兼容) - async 任务轮询
# ==========================================

def _jm_headers(api_key: str, is_multipart: bool = False):
    h = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        # 固定日本节点（依赖你的 NewAPI/反代放行这些头）
        "X-Token-Node": "jp",
        "X-From-NewAPI": "1",
    }
    # multipart 时不要手动写 Content-Type，让 requests 自动加 boundary
    if not is_multipart:
        h["Content-Type"] = "application/json"
    return h


def _poll_task_result(base_url: str, api_key: str, task_id: str, timeout: int, poll_interval: int = 2, progress_callback=None):
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
            now = time.time()
            if now - last_print >= poll_interval:
                if progress_callback:
                    progress_callback("生成中..", 50)
                print("生成中..")
                last_print = now
            time.sleep(poll_interval)
            continue

        data = resp.json()
        status = data.get("status")
        if status == "processing":
            now = time.time()
            if now - last_print >= poll_interval:
                if progress_callback:
                    progress_callback("生成中..", 50)
                print("生成中..")
                last_print = now
            time.sleep(poll_interval)
            continue
        if status == "failed":
            err = data.get("error") or {}
            raise Exception(err.get("message") or "任务失败")
        if status == "succeeded":
            return data.get("result")

        now = time.time()
        if now - last_print >= poll_interval:
            if progress_callback:
                progress_callback("生成中..", 50)
            print("生成中..")
            last_print = now
        time.sleep(poll_interval)


def _normalize_jimeng_duration(model: str, duration: int) -> int:
    m = str(model or '').lower()
    if 'veo3.1' in m or 'veo3' in m:
        return 8
    if 'sora2' in m:
        return duration if duration in (4, 8, 12) else 4
    if '3.5-pro' in m or '3.5_pro' in m:
        return duration if duration in (5, 10, 12) else 5
    if 'seedance-2.0' in m or 'seedance' in m:
        # JP 不支持该模型，这里仅兜底
        if duration < 4: return 4
        if duration > 15: return 15
        return int(duration)
    # 其他：5/10
    return duration if duration in (5, 10) else 5


def _normalize_jimeng_resolution(model: str, resolution: str) -> str:
    m = str(model or '').lower()
    res = str(resolution or '720p').lower()
    if ('jimeng-video-3.0' in m) or ('jimeng-video-3.0-fast' in m):
        return res if res in ('720p', '1080p') else '720p'
    return '720p'


def send_jimeng_video_request(
    base_url: str,
    api_key: str,
    model: str,
    prompt: str,
    ratio: str,
    duration: int,
    resolution: str,
    timeout: int,
    progress_callback=None,
    first_frame_path: str = None,
    last_frame_path: str = None,
):
    # 走 chat/completions 触发任务（NewAPI 可计费）
    url = f"{base_url.rstrip('/')}/v1/chat/completions"
    final_duration = _normalize_jimeng_duration(model, int(duration))
    final_resolution = _normalize_jimeng_resolution(model, resolution)
    content_list = []
    if first_frame_path and os.path.exists(first_frame_path):
        b64 = encode_image_to_base64(first_frame_path)
        if b64:
            ext = os.path.splitext(first_frame_path)[1].lower()
            mime_type = "image/png" if ext == '.png' else "image/jpeg"
            content_list.append({"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}})
    if last_frame_path and os.path.exists(last_frame_path):
        b64 = encode_image_to_base64(last_frame_path)
        if b64:
            ext = os.path.splitext(last_frame_path)[1].lower()
            mime_type = "image/png" if ext == '.png' else "image/jpeg"
            content_list.append({"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}})

    content_list.append({"type": "text", "text": prompt})
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content_list}],
        "ratio": ratio,
        "resolution": final_resolution,
        "duration": final_duration,
        "functionMode": "first_last_frames",
    }

    resp = requests.post(url, json=payload, headers=_jm_headers(api_key), timeout=timeout)
    if resp.status_code != 200:
        raise Exception(f"Jimeng 视频提交失败 {resp.status_code}: {resp.text[:200]}")
    j = resp.json()
    task_id = j.get("task_id") or (j.get("task") or {}).get("task_id")
    if not task_id:
        raise Exception(f"Jimeng 视频提交返回异常: {str(j)[:200]}")

    return _poll_task_result(
        base_url=base_url,
        api_key=api_key,
        task_id=task_id,
        timeout=timeout,
        poll_interval=int(_global_params.get("jimeng_poll_interval", 10)),
        progress_callback=progress_callback,
    )

def generate(context):
    """
    生成视频主函数 - 强制流式返回并自动折算多轮进度
    """
    print("\n" + "="*60)
    print("[Grok Plugin] 开始生成视频")
    print("="*60)
    
    # 获取上下文与参数
    prompt = context.get('prompt', '')
    output_dir = context.get('output_dir', context.get('project_path', '.'))
    plugin_params = context.get('plugin_params', _global_params)
    
    # 提取参数
    api_url = 'https://api.mmg.lat/v1/chat/completions'
    api_key = plugin_params.get('api_key', '')
    provider = plugin_params.get('model_category', 'grok')
    model_name = plugin_params.get('model_name', _global_params.get('model_name', 'grok-video-6s'))
    aspect_ratio = plugin_params.get('aspect_ratio', '16:9')
    duration = str(plugin_params.get('duration', '6'))
    resolution = plugin_params.get('resolution', '720p')
    generation_mode = plugin_params.get('generation_mode', '文生视频')
    timeout = plugin_params.get('timeout', 300)
    
    # 根据时长动态选择实际后端模型
    actual_model = model_name if provider == 'grok' else 'grok-video-6s'

    # 获取图片路径（首帧/尾帧）
    first_frame_path = None
    last_frame_path = None
    if generation_mode in ('首帧生视频', '首尾帧生视频'):
        first_frame_path = context.get('first_frame_path')
        last_frame_path = context.get('last_frame_path')
        if not first_frame_path or (generation_mode == '首尾帧生视频' and not last_frame_path):
            ref_imgs = context.get('reference_images', {})
            if isinstance(ref_imgs, dict):
                first_frame_path = first_frame_path or ref_imgs.get('首帧') or ref_imgs.get(0)
                last_frame_path = last_frame_path or ref_imgs.get('尾帧') or ref_imgs.get(1)
    
    print(f"API地址: {api_url}")
    print(f"模式: {generation_mode}")
    print(f"请求模型: {actual_model}")
    print(f"请求比例(size): {aspect_ratio}")
    
    # 构造消息
    messages = []
    content_list = []
    
    if generation_mode == '首帧生视频' and first_frame_path:
        b64_str = encode_image_to_base64(first_frame_path)
        if b64_str:
            ext = os.path.splitext(first_frame_path)[1].lower()
            mime_type = "image/png" if ext == '.png' else "image/jpeg"
            content_list.append({
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{b64_str}"}
            })
            print("✅ 已添加参考图 (Base64)")
    
    content_list.append({"type": "text", "text": prompt})
    messages.append({"role": "user", "content": content_list})
    
    # 构造 Payload
    payload = {
        "model": actual_model,
        "messages": messages,
        "stream": True,  # 固定使用流式
        "size": aspect_ratio
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    progress_callback = context.get("progress_callback")

    # Jimeng：走标准 OpenAI 路径 + async=true -> 轮询 /v1/tasks/{id}
    if provider == 'jimeng':
        base_url = plugin_params.get('jimeng_base_url', 'https://api.mmg.lat')
        jm_model = model_name if isinstance(model_name, str) and model_name.startswith('jimeng-video-') else _global_params.get('jimeng_video_model', 'jimeng-video-3.5-pro')
        try:
            if progress_callback:
                progress_callback("提交任务...", 1)

            if generation_mode in ('首帧生视频', '首尾帧生视频'):
                if not first_frame_path or (generation_mode == '首尾帧生视频' and not last_frame_path):
                    raise Exception("Jimeng 图生视频需要提供首帧（以及可选尾帧）图片路径")

            duration_int = 6
            try:
                duration_int = int(duration)
            except Exception:
                duration_int = 6

            result = send_jimeng_video_request(
                base_url=base_url,
                api_key=api_key,
                model=jm_model,
                prompt=prompt,
                ratio=aspect_ratio,
                duration=duration_int,
                resolution=resolution,
                timeout=timeout,
                progress_callback=progress_callback,
                first_frame_path=first_frame_path if generation_mode in ('首帧生视频', '首尾帧生视频') else None,
                last_frame_path=last_frame_path if generation_mode == '首尾帧生视频' else None,
            )
            items = (result or {}).get("data") or []
            if not items:
                raise Exception("Jimeng 未返回视频数据")
            video_url = items[0].get("url")
            if not video_url:
                raise Exception("Jimeng 视频结果缺少 url")

            if progress_callback:
                progress_callback("正在下载视频...", 95)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            idx = context.get('viewer_index', 0)
            safe_model_name = (jm_model or "jimeng-video-3.5-pro").replace('.', '-')
            filename = f"{idx:04d}_{safe_model_name}_{timestamp}.mp4"
            output_path = os.path.join(output_dir, filename)

            with requests.get(video_url, stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(output_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)

            if progress_callback:
                progress_callback("完成", 100)
            print(f"✅ 视频生成并下载完成: {output_path}")
            return [output_path]
        except Exception as e:
            error_msg = f"生成失败: {str(e)}"
            print(f"❌ {error_msg}")
            traceback.print_exc()
            raise Exception(f"PLUGIN_ERROR:::{error_msg}")
    
    try:
        print("正在发送请求 (等待服务端流式返回)...")
        response = requests.post(api_url, json=payload, headers=headers, timeout=timeout, stream=True)
        response.raise_for_status()

        video_url = None
        full_content = ""

        # 逐行解析流式响应
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8').strip()
                if line_str == "data: [DONE]":
                    break
                
                if line_str.startswith("data: "):
                    json_str = line_str[6:]
                    try:
                        data = json.loads(json_str)
                        choices = data.get('choices', [])
                        if not choices:
                            continue
                            
                        delta = choices[0].get('delta', {})
                        content = delta.get('content', '')
                        if not content:
                            continue

                        # 拼接到完整文本中以防链接被拆分
                        full_content += content
                        
                        # 1. 提取多轮进度 (例如 [round=1/2] progress=50%)
                        round_match = re.search(r'\[round=(\d+)/(\d+)\] progress=(\d+)%', content)
                        if round_match and progress_callback:
                            current_round = int(round_match.group(1))
                            total_rounds = int(round_match.group(2))
                            round_progress = int(round_match.group(3))
                            
                            # 将多轮进度折算为全局 0-100%
                            # 例如 2轮总计：第1轮50% = 25%；第2轮50% = 75%
                            overall_progress = int(((current_round - 1) * 100 + round_progress) / total_rounds)
                            
                            # 限制最高显示为99，因为100%后面可能还有超分和URL解析
                            display_progress = min(overall_progress, 99)
                            progress_callback(f"生成中 ({display_progress}%)", display_progress)
                        
                        # 2. 兼容没有轮次的常规进度 (当前进度x% 或 progress=x%)
                        elif not round_match:
                            prog_match = re.search(r'(?:当前进度|progress=)(\d+)%', content)
                            if prog_match and progress_callback:
                                progress_val = int(prog_match.group(1))
                                progress_callback(f"生成中 ({progress_val}%)", min(progress_val, 99))
                            
                        # 3. 提取“超分辨率”状态
                        if "超分辨率" in content and progress_callback:
                            progress_callback("高清中...", 99)

                    except json.JSONDecodeError:
                        continue

        if progress_callback:
            progress_callback("正在提取视频链接...", 99)

        # 从全量返回文本中提取视频 URL (支持任何格式里包裹的 http...mp4)
        url_match = re.search(r'(https?://[^\s"\'<>]+?\.mp4)', full_content)
        if url_match:
            video_url = url_match.group(1)
            print(f"解析到视频URL: {video_url}")
        else:
            print(f"完整返回内容: {full_content}")
            raise Exception("未在响应中找到视频链接，请检查上方完整返回内容。")
        
        # 下载视频
        if progress_callback:
            progress_callback("正在下载视频...", 100)
            
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        idx = context.get('viewer_index', 0)
        filename = f"{idx:04d}_grok_{timestamp}.mp4"
        output_path = os.path.join(output_dir, filename)
        
        print(f"开始下载到: {output_path}")
        with requests.get(video_url, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(output_path, 'wb') as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
                    
        print(f"✅ 视频生成并下载完成: {output_path}")
        return [output_path]
        
    except Exception as e:
        error_msg = f"生成失败: {str(e)}"
        print(f"❌ {error_msg}")
        traceback.print_exc()
        raise Exception(f"PLUGIN_ERROR:::{error_msg}")