"""
智能路由系统
支持小模型路由模式和多平台转发模式
"""

import json
import asyncio
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
import logging
from sqlalchemy.orm import Session

from database import RoutingConfig, ModelConfig, PlatformConfig
from database import RoutingScene as DBRoutingScene
from platforms import PlatformManager, PlatformType, PlatformClient
from format_converter import FormatConverter

logger = logging.getLogger(__name__)

class RoutingMode(Enum):
    """路由模式"""
    CLAUDE_CODE = "claude_code"  # 原有的Claude Code API
    SMART_ROUTING = "smart_routing"  # 小模型路由模式
    GLOBAL_DIRECT = "global_direct"  # 多平台转发模式

@dataclass
class RoutingResult:
    """路由结果"""
    success: bool
    platform_type: Optional[PlatformType] = None
    model_id: Optional[str] = None
    error_message: Optional[str] = None
    scene_name: Optional[str] = None

@dataclass
class RoutingScene:
    """路由场景"""
    name: str
    description: str
    models: List[str]  # 格式: ["platform:model_id"]
    enabled: bool = True

class SmartRouter:
    """智能路由器（小模型路由模式）"""
    
    def __init__(self, platform_manager: PlatformManager, routing_models: List[str]):
        self.platform_manager = platform_manager
        self.routing_models = routing_models  # 用于判断场景的小模型优先级列表（支持降级）
        self.scenes: List[RoutingScene] = []
    
    def load_scenes(self, db: Session, routing_config_id: int):
        """从数据库加载场景配置"""
        scenes = db.query(DBRoutingScene).filter(
            DBRoutingScene.routing_config_id == routing_config_id,
            DBRoutingScene.enabled == True
        ).order_by(DBRoutingScene.priority).all()
        
        self.scenes = []
        for scene in scenes:
            try:
                models = json.loads(scene.models)
                self.scenes.append(RoutingScene(
                    name=scene.scene_name,
                    description=scene.scene_description,
                    models=models,
                    enabled=scene.enabled
                ))
            except json.JSONDecodeError:
                logger.error(f"Failed to parse models for scene {scene.scene_name}")
    
    async def route_request(self, user_prompt: str) -> RoutingResult:
        """根据用户prompt路由请求"""
        # 1. 判断场景
        scene = await self._detect_scene(user_prompt)
        if not scene:
            return RoutingResult(
                success=False,
                error_message="无法识别请求场景"
            )
        
        # 2. 选择可用模型
        for model_spec in scene.models:
            try:
                platform_type, model_id = self._parse_model_spec(model_spec)
                client = self.platform_manager.get_platform(platform_type)
                
                if client:
                    return RoutingResult(
                        success=True,
                        platform_type=platform_type,
                        model_id=model_id,
                        scene_name=scene.name
                    )
            except Exception as e:
                logger.error(f"Failed to parse model {model_spec}: {e}")
                continue
        
        return RoutingResult(
            success=False,
            error_message=f"场景 '{scene.name}' 的所有模型都不可用"
        )
    
    async def _detect_scene(self, user_prompt: str) -> Optional[RoutingScene]:
        """使用小模型检测场景"""
        if not self.scenes:
            return None
        
        # 构造场景判断的prompt
        scene_descriptions = []
        for i, scene in enumerate(self.scenes):
            scene_descriptions.append(f"{i+1}. {scene.name}: {scene.description}")
        
        judgment_prompt = f"""
请分析以下用户请求属于哪个场景，只返回场景编号（1-{len(self.scenes)}）：

用户请求：{user_prompt}

可选场景：
{chr(10).join(scene_descriptions)}

请只需要回复场景编号数字（如：1、2、3 等），不要包含其他内容，不要解释。
"""
        
        # 尝试使用路由模型进行判断
        for routing_model in self.routing_models:
            try:
                platform_type, model_id = self._parse_model_spec(routing_model)
                client = self.platform_manager.get_platform(platform_type)
                
                if not client:
                    continue
                
                messages = [{"role": "user", "content": judgment_prompt}]
                
                # 获取响应
                response_text = ""
                async for chunk in client.chat_completion(model_id, messages, stream=False):
                    try:
                        response_data = json.loads(chunk)
                        if "choices" in response_data:
                            response_text = response_data["choices"][0]["message"]["content"]
                            break
                    except json.JSONDecodeError:
                        continue
                
                # 解析场景编号
                scene_index = self._parse_scene_number(response_text)
                if 1 <= scene_index <= len(self.scenes):
                    return self.scenes[scene_index - 1]
                
            except Exception as e:
                logger.error(f"Failed to use routing model {routing_model}: {e}")
                continue
        
        # 如果所有路由模型都失败，返回默认场景（第一个）
        return self.scenes[0] if self.scenes else None
    
    def _parse_scene_number(self, response: str) -> int:
        """解析场景编号"""
        import re
        
        # 查找数字
        numbers = re.findall(r'\d+', response.strip())
        if numbers:
            return int(numbers[0])
        
        return 0
    
    def _parse_model_spec(self, model_spec: str) -> Tuple[PlatformType, str]:
        """解析模型规格 "platform:model_id" """
        if ":" not in model_spec:
            raise ValueError(f"Invalid model spec format: {model_spec}")
        
        platform_str, model_id = model_spec.split(":", 1)
        platform_type = PlatformType(platform_str)
        
        return platform_type, model_id

class GlobalDirectRouter:
    """全局直连路由器"""
    
    def __init__(self, platform_manager: PlatformManager):
        self.platform_manager = platform_manager
        self.model_priority_list: List[str] = []  # 格式: ["platform:model_id"]
    
    def load_config(self, db: Session, routing_config_id: int):
        """从数据库加载配置"""
        config = db.query(RoutingConfig).filter(
            RoutingConfig.id == routing_config_id
        ).first()
        
        if config and config.config_data:
            try:
                config_data = json.loads(config.config_data)
                self.model_priority_list = config_data.get("model_priority_list", [])
            except json.JSONDecodeError:
                logger.error(f"Failed to parse routing config {routing_config_id}")
                self.model_priority_list = []
    
    async def route_request(self, user_prompt: str = "") -> RoutingResult:
        """按优先级顺序路由请求"""
        for model_spec in self.model_priority_list:
            try:
                platform_type, model_id = self._parse_model_spec(model_spec)
                client = self.platform_manager.get_platform(platform_type)
                
                if client:
                    return RoutingResult(
                        success=True,
                        platform_type=platform_type,
                        model_id=model_id
                    )
            except Exception as e:
                logger.error(f"Failed to parse model {model_spec}: {e}")
                continue
        
        return RoutingResult(
            success=False,
            error_message="所有配置的模型都不可用"
        )
    
    def _parse_model_spec(self, model_spec: str) -> Tuple[PlatformType, str]:
        """解析模型规格"""
        if ":" not in model_spec:
            raise ValueError(f"Invalid model spec format: {model_spec}")
        
        platform_str, model_id = model_spec.split(":", 1)
        platform_type = PlatformType(platform_str)
        
        return platform_type, model_id

class RoutingManager:
    """路由管理器"""
    
    def __init__(self, platform_manager: PlatformManager):
        self.platform_manager = platform_manager
        self.current_mode = RoutingMode.CLAUDE_CODE
        self.smart_router: Optional[SmartRouter] = None
        self.global_direct_router: Optional[GlobalDirectRouter] = None
    
    def load_config(self, db: Session):
        """从数据库加载路由配置"""
        # 获取当前激活的路由配置
        active_config = db.query(RoutingConfig).filter(
            RoutingConfig.is_active == True
        ).first()
        
        if not active_config:
            self.current_mode = RoutingMode.CLAUDE_CODE
            return
        
        if active_config.config_type == "smart_routing":
            self.current_mode = RoutingMode.SMART_ROUTING
            
            # 加载智能路由配置
            try:
                config_data = json.loads(active_config.config_data)
                routing_models = config_data.get("routing_models", [])
                
                self.smart_router = SmartRouter(self.platform_manager, routing_models)
                self.smart_router.load_scenes(db, active_config.id)
            except json.JSONDecodeError:
                logger.error("Failed to parse smart routing config")
                self.current_mode = RoutingMode.CLAUDE_CODE
        
        elif active_config.config_type == "global_direct":
            self.current_mode = RoutingMode.GLOBAL_DIRECT
            
            # 加载全局直连配置
            self.global_direct_router = GlobalDirectRouter(self.platform_manager)
            self.global_direct_router.load_config(db, active_config.id)
    
    async def route_request(self, messages: List[Dict[str, Any]]) -> RoutingResult:
        """路由请求"""
        if self.current_mode == RoutingMode.CLAUDE_CODE:
            # 使用原有的Claude Code API
            return RoutingResult(
                success=True,
                error_message="Use original Claude Code API"
            )
        
        # 提取最后一条用户消息
        user_prompt = FormatConverter.extract_last_user_message(messages)
        
        if self.current_mode == RoutingMode.SMART_ROUTING and self.smart_router:
            return await self.smart_router.route_request(user_prompt)
        
        elif self.current_mode == RoutingMode.GLOBAL_DIRECT and self.global_direct_router:
            return await self.global_direct_router.route_request(user_prompt)
        
        return RoutingResult(
            success=False,
            error_message="路由配置未正确初始化"
        )
    
    def get_current_mode(self) -> RoutingMode:
        """获取当前路由模式"""
        return self.current_mode