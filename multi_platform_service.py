"""
多平台API服务
整合所有组件，提供统一的API接口
"""

import json
import asyncio
import logging
import httpx
from typing import Dict, List, Any, Optional, AsyncGenerator
from sqlalchemy.orm import Session
from fastapi import Response
from fastapi.responses import StreamingResponse

from platforms import PlatformManager, PlatformConfig, PlatformType
from routing_system import RoutingManager, RoutingMode
from format_converter import FormatConverter, StreamingConverter
from database import (
    PlatformConfig as DBPlatformConfig, 
    ModelConfig, 
    SystemConfig,
    get_db
)

# 配置日志
import os
DEBUG_MODE = os.getenv('DEBUG_MODE', 'false').lower() == 'true'

logging.basicConfig(level=logging.DEBUG if DEBUG_MODE else logging.INFO)
logger = logging.getLogger(__name__)

def debug_print(*args, **kwargs):
    """统一的DEBUG输出函数，只在DEBUG_MODE启用时输出"""
    if DEBUG_MODE:
        print(*args, **kwargs)

class MultiPlatformService:
    """多平台API服务"""
    
    def __init__(self):
        self.platform_manager = PlatformManager()
        self.routing_manager = RoutingManager(self.platform_manager)
        self.format_converter = FormatConverter()
        self.streaming_converter = None  # 每次请求时创建新的实例
        self.initialized = False
    
    async def initialize(self, db: Session):
        """初始化服务，加载配置"""
        logger.info("🚀 [MultiPlatformService] 开始初始化多平台服务...")
        
        try:
            logger.info("📋 [MultiPlatformService] 加载平台配置...")
            await self._load_platform_configs(db)
            
            logger.info("🧭 [MultiPlatformService] 加载路由配置...")
            self.routing_manager.load_config(db)
            
            self.initialized = True
            logger.info("✅ [MultiPlatformService] 多平台服务初始化成功")
        except Exception as e:
            logger.error(f"❌ [MultiPlatformService] 初始化失败: {e}")
            self.initialized = False
    
    async def _load_platform_configs(self, db: Session):
        """加载平台配置"""
        logger.info("🔍 [MultiPlatformService] 查询数据库中的平台配置...")
        
        platform_configs = db.query(DBPlatformConfig).filter(
            DBPlatformConfig.enabled == True
        ).all()
        
        logger.info(f"📊 [MultiPlatformService] 找到 {len(platform_configs)} 个启用的平台配置")
        
        for db_config in platform_configs:
            try:
                logger.info(f"⚙️ [MultiPlatformService] 加载 {db_config.platform_type} 平台配置...")
                
                platform_type = PlatformType(db_config.platform_type)
                config = PlatformConfig(
                    platform_type=platform_type,
                    api_key=db_config.api_key or "",
                    base_url=db_config.base_url or "",
                    enabled=db_config.enabled,
                    timeout=db_config.timeout
                )
                
                self.platform_manager.add_platform(config)
                logger.info(f"✅ [MultiPlatformService] {platform_type.value} 平台配置加载成功")
                
            except Exception as e:
                logger.error(f"❌ [MultiPlatformService] 加载 {db_config.platform_type} 平台配置失败: {e}")
    
    async def handle_request(
        self, 
        messages: List[Dict[str, Any]], 
        model: str = "",
        stream: bool = False,
        db: Session = None,
        original_request: Dict[str, Any] = None,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        # 保存路由信息供外部访问
        self.last_routing_result = None
        # 保存HOOK处理数据供外部访问
        self.processed_prompt = None
        self.processed_headers = None
        self.model_raw_headers = None
        self.model_raw_response = None
        """处理聊天请求"""
        if not self.initialized:
            if db:
                await self.initialize(db)
            else:
                yield json.dumps({"error": "Service not initialized"})
                return
        
        # 1. 判断路由模式
        routing_result = await self.routing_manager.route_request(messages)
        self.last_routing_result = routing_result
        
        if not routing_result.success:
            if routing_result.error_message == "Use original Claude Code API":
                # 使用原有的Claude Code API逻辑
                yield json.dumps({"error": "Should use original Claude Code API"})
                return
            else:
                yield json.dumps({"error": routing_result.error_message})
                return
        
        # 2. 转换消息格式
        openai_messages = self.format_converter.claude_to_openai(messages)
        
        # 处理system参数：如果有system字段，添加为system message
        extracted_tools = None
        if "system" in kwargs and kwargs["system"]:
            system_content = kwargs["system"]
            
            # 如果system是数组格式（Claude格式），提取文本内容和工具信息
            if isinstance(system_content, list):
                text_parts = []
                for item in system_content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        text_parts.append(item.get("text", ""))
                system_content = "\n".join(text_parts)
            
            if system_content:  # 确保有内容
                system_message = {
                    "role": "system",
                    "content": system_content
                }
                # 将system message插入到消息列表开头
                openai_messages.insert(0, system_message)
                debug_print(f"[DEBUG] 添加system message: {system_content[:100]}...")
        
        # 暂时保存转换后的消息，稍后会用完整的payload覆盖
        self.processed_prompt = None
        
        # 3. 获取目标平台客户端
        client = self.platform_manager.get_platform(routing_result.platform_type)
        if not client:
            yield json.dumps({"error": f"Platform {routing_result.platform_type} not available"})
            return
        
        # 4. 创建流式转换器（每次请求都是新的实例）
        if stream:
            debug_print(f"[DEBUG] MultiPlatformService: 创建流式转换器, original_model={model}, target_model={routing_result.model_id}")
            self.streaming_converter = StreamingConverter(original_model=model)
            # 估算输入token数量
            estimated_input_tokens = self._estimate_input_tokens(openai_messages)
            self.streaming_converter.total_input_tokens = estimated_input_tokens
            debug_print(f"[DEBUG] MultiPlatformService: 估算输入tokens: {estimated_input_tokens}")
        
        # 5. 处理 tools 参数（如果有的话，转换为 system prompt）
        tools_processed = False
        tools_to_process = None
        
        # 优先检查独立的tools参数
        if "tools" in kwargs and kwargs["tools"]:
            tools_to_process = kwargs["tools"]
            debug_print(f"[DEBUG] 检测到独立的tools参数")
        # 如果没有独立的tools参数，检查原始请求中是否有tools字段
        elif original_request and "tools" in original_request and original_request["tools"]:
            tools_to_process = original_request["tools"]
            debug_print(f"[DEBUG] 从原始请求中检测到tools参数，包含 {len(tools_to_process)} 个工具")
        
        if tools_to_process:
            openai_messages = self._convert_tools_to_system_prompt(openai_messages, tools_to_process)
            debug_print(f"[DEBUG] 已将tools转换为system prompt")
            tools_processed = True
        
        # 6. 过滤和转换不支持的参数
        filtered_kwargs = self._filter_unsupported_params(kwargs, routing_result.platform_type)
        
        # 移除system参数（因为已经转换为system message了）
        if "system" in filtered_kwargs:
            filtered_kwargs.pop("system")
            debug_print(f"[DEBUG] 移除system参数（已转换为system message）")
        
        # 针对不同平台调整参数限制
        filtered_kwargs = self._adjust_platform_limits(filtered_kwargs, routing_result.platform_type)
        
        # 如果已经处理了 tools，移除相关参数避免冲突
        if tools_processed:
            filtered_kwargs.pop("tools", None)
            filtered_kwargs.pop("tool_choice", None)
            debug_print(f"[DEBUG] 移除了 tools 和 tool_choice 参数，避免与 system prompt 冲突")
        
        debug_print(f"[DEBUG] 发送到{routing_result.platform_type.value}的参数: {filtered_kwargs.keys()}")
        
        # 7. 调用目标API - 直接使用httpx获取完整响应信息
        try:
            # 构建API请求参数
            api_url = self._get_api_url(client, routing_result.platform_type)
            headers = self._get_api_headers(client, routing_result.platform_type)
            
            payload = {
                "model": routing_result.model_id,
                "messages": openai_messages,
                "stream": stream,
                **filtered_kwargs
            }
            
            # 保存真正发给远端大模型的完整请求内容（HOOK处理后的原样）
            self.processed_prompt = json.dumps(payload, ensure_ascii=False, indent=2)
            self.processed_headers = json.dumps(headers, ensure_ascii=False, indent=2)
            
            debug_print(f"[DEBUG] 调用API: {api_url}")
            # 只显示关键信息，避免输出过长
            debug_payload = {
                "model": payload.get("model"),
                "stream": payload.get("stream"),
                "messages_count": len(payload.get("messages", [])),
                "first_message_role": payload.get("messages", [{}])[0].get("role") if payload.get("messages") else None,
                "last_message_role": payload.get("messages", [{}])[-1].get("role") if payload.get("messages") else None,
                "other_params": [k for k in payload.keys() if k not in ["messages", "model", "stream"]]
            }
            debug_print(f"[DEBUG] 请求payload概要: {json.dumps(debug_payload, ensure_ascii=False, indent=2)}")
            
            async with httpx.AsyncClient(timeout=30.0) as http_client:
                if stream:
                    # 流式请求
                    raw_response_chunks = []
                    async with http_client.stream("POST", api_url, headers=headers, json=payload) as response:
                        # 保存响应头
                        self.model_raw_headers = json.dumps(dict(response.headers), ensure_ascii=False, indent=2)
                        debug_print(f"[DEBUG] 获取到响应头: {response.status_code}")
                        
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if line.strip():
                                    raw_response_chunks.append(line)
                                    
                                    # 转换响应格式
                                    platform_type_str = routing_result.platform_type.value
                                    if platform_type_str == "dashscope":
                                        converter_type = "qwen"
                                    elif platform_type_str == "openrouter":
                                        converter_type = "openrouter"
                                    elif platform_type_str == "ollama":
                                        converter_type = "ollama"
                                    elif platform_type_str == "lmstudio":
                                        converter_type = "lmstudio"
                                    else:
                                        converter_type = "openai"
                                    
                                    converted_chunk = await self.streaming_converter.convert_stream(line, converter_type)
                                    if converted_chunk:
                                        yield converted_chunk
                        else:
                            error_msg = await response.aread()
                            error_data = json.dumps({"error": f"API error: {response.status_code} - {error_msg.decode()}"})
                            raw_response_chunks.append(error_data)
                            yield error_data
                    
                    # 保存流式响应数据
                    self.model_raw_response = "\n".join(raw_response_chunks)
                    
                else:
                    # 非流式请求
                    response = await http_client.post(api_url, headers=headers, json=payload)
                    
                    # 保存响应头和响应体
                    self.model_raw_headers = json.dumps(dict(response.headers), ensure_ascii=False, indent=2)
                    self.model_raw_response = response.text
                    
                    debug_print(f"[DEBUG] 非流式响应: {response.status_code}, 响应长度: {len(response.text)}")
                    
                    if response.status_code == 200:
                        # 转换响应格式
                        converted_response = self.format_converter.openai_to_claude(response.text, is_stream=False, original_model=model)
                        yield converted_response
                    else:
                        yield json.dumps({"error": f"API error: {response.status_code} - {response.text}"})
                    
        except Exception as e:
            logger.error(f"Failed to call platform API: {e}")
            # 如果是流式请求且有转换器，需要发送错误格式
            if stream and self.streaming_converter:
                error_event = {
                    "type": "error",
                    "error": {
                        "type": "api_error",
                        "message": f"API call failed: {str(e)}"
                    }
                }
                yield f"event: error\ndata: {json.dumps(error_event, ensure_ascii=False)}\n\n"
            else:
                yield json.dumps({"error": f"API call failed: {str(e)}"})
    
    async def get_available_models(self, db: Session) -> List[Dict[str, Any]]:
        """获取所有可用模型"""
        logger.info("📋 [MultiPlatformService] 获取可用模型列表...")
        
        if not self.initialized:
            logger.info("🔄 [MultiPlatformService] 服务未初始化，开始初始化...")
            await self.initialize(db)
        
        # 优先从数据库获取模型列表
        logger.info("💾 [MultiPlatformService] 优先从数据库获取模型列表...")
        db_models = db.query(ModelConfig).filter(ModelConfig.enabled == True).all()
        
        if db_models:
            logger.info(f"📋 [MultiPlatformService] 从数据库获取到 {len(db_models)} 个模型")
            result_models = []
            for model in db_models:
                # 避免重复添加平台前缀
                model_id = model.model_id
                if not model_id.startswith(f"{model.platform_type}:"):
                    model_id = f"{model.platform_type}:{model.model_id}"
                
                model_dict = {
                    "id": model_id,
                    "name": model.model_name,
                    "platform": model.platform_type,
                    "description": model.description or "",
                    "enabled": model.enabled
                }
                result_models.append(model_dict)

            
            logger.info(f"✅ [MultiPlatformService] 从数据库返回 {len(result_models)} 个可用模型")
            return result_models
        else:
            # 如果数据库为空，则从API获取并保存
            logger.info("📞 [MultiPlatformService] 数据库为空，从API获取模型...")
            all_models = await self.platform_manager.get_all_models()
            
            if all_models:
                # 保存到数据库
                await self._save_models_to_db(db, all_models)
                
                # 重新从数据库读取
                return await self.get_available_models(db)
            else:
                logger.warning("⚠️ [MultiPlatformService] 未获取到任何模型")
                return []
    
    async def test_platform_connections(self, db: Session) -> Dict[str, bool]:
        """测试所有平台连接"""
        if not self.initialized:
            await self.initialize(db)
        
        results = await self.platform_manager.test_all_connections()
        
        return {
            platform_type.value: status 
            for platform_type, status in results.items()
        }
    
    async def refresh_models(self, db: Session, platform_type: str = None):
        """刷新模型列表并保存到数据库"""
        logger.info("🔄 [MultiPlatformService] 开始刷新模型列表...")
        
        if not self.initialized:
            logger.info("🔄 [MultiPlatformService] 服务未初始化，开始初始化...")
            await self.initialize(db)
        
        if platform_type:
            # 刷新特定平台的模型
            logger.info(f"🎯 [MultiPlatformService] 刷新特定平台: {platform_type}")
            try:
                platform_enum = PlatformType(platform_type)
                client = self.platform_manager.get_platform(platform_enum)
                if client:
                    logger.info(f"📞 [MultiPlatformService] 获取 {platform_type} 平台模型...")
                    models = await client.get_models()
                    logger.info(f"💾 [MultiPlatformService] 保存 {len(models)} 个模型到数据库...")
                    await self._save_models_to_db(db, models)
                else:
                    logger.warning(f"⚠️ [MultiPlatformService] 未找到 {platform_type} 平台客户端")
            except ValueError:
                logger.error(f"❌ [MultiPlatformService] 无效的平台类型: {platform_type}")
        else:
            # 刷新所有平台的模型
            logger.info("🌐 [MultiPlatformService] 刷新所有平台的模型...")
            all_models = await self.platform_manager.get_all_models()
            logger.info(f"💾 [MultiPlatformService] 保存 {len(all_models)} 个模型到数据库...")
            await self._save_models_to_db(db, all_models)
    
    async def _save_models_to_db(self, db: Session, models: List):
        """保存模型到数据库"""
        logger.info(f"💾 [MultiPlatformService] 开始保存 {len(models)} 个模型到数据库...")
        
        saved_count = 0
        updated_count = 0
        
        for model in models:
            try:
                # 检查模型是否已存在
                existing = db.query(ModelConfig).filter(
                    ModelConfig.platform_type == model.platform.value,
                    ModelConfig.model_id == model.id
                ).first()
                
                if existing:
                    # 更新现有模型
                    existing.model_name = model.name
                    existing.description = model.description
                    updated_count += 1
        
                else:
                    # 创建新模型
                    new_model = ModelConfig(
                        platform_type=model.platform.value,
                        model_id=model.id,
                        model_name=model.name,
                        description=model.description,
                        enabled=model.enabled
                    )
                    db.add(new_model)
                    saved_count += 1

                    
            except Exception as e:
                logger.error(f"❌ [MultiPlatformService] 保存模型失败 {model.platform.value}:{model.id}: {e}")
        
        try:
            db.commit()
            logger.info(f"✅ [MultiPlatformService] 数据库保存完成: 新增 {saved_count} 个，更新 {updated_count} 个模型")
        except Exception as e:
            logger.error(f"❌ [MultiPlatformService] 数据库提交失败: {e}")
            db.rollback()
    
    def get_current_routing_mode(self) -> str:
        """获取当前路由模式"""
        return self.routing_manager.get_current_mode().value
    
    def get_platform_info(self, platform_type) -> dict:
        """获取平台信息"""
        client = self.platform_manager.get_platform(platform_type)
        if client:
            # 优先使用客户端的base_url属性，如果没有则使用配置中的base_url
            base_url = getattr(client, 'base_url', None) or (client.config.base_url if hasattr(client, 'config') else None)
            return {
                "base_url": base_url or "unknown",
                "platform_name": platform_type.value
            }
        return {
            "base_url": "unknown",
            "platform_name": platform_type.value if platform_type else "unknown"
        }
    
    def _filter_unsupported_params(self, kwargs: Dict[str, Any], platform_type) -> Dict[str, Any]:
        """过滤平台不支持的参数"""
        # 只过滤会导致API调用失败的关键参数
        # 对于OpenRouter，保留OpenAI格式的所有参数，只处理特殊冲突情况
        unsupported_params = {
            "dashscope": [
                "tools", "tool_choice", "metadata", 
                "anthropic-version", "anthropic-beta", "anthropic-dangerous-direct-browser-access"
            ],
            "openrouter": [
                # 只过滤Anthropic特有的头部参数，保留OpenAI格式的参数
                "anthropic-version", "anthropic-beta", "anthropic-dangerous-direct-browser-access"
            ],
            "ollama": ["tools", "tool_choice", "metadata", "anthropic-version", "anthropic-beta"],
            "lmstudio": ["tools", "tool_choice", "metadata", "anthropic-version", "anthropic-beta"]
        }
        
        platform_name = platform_type.value
        filtered = {}
        removed_params = []
        
        for key, value in kwargs.items():
            # 通用过滤规则
            if platform_name in unsupported_params and key in unsupported_params[platform_name]:
                removed_params.append(key)
                continue
            
            # OpenRouter 特殊规则：如果没有 tools，就不能有 tool_choice
            if platform_name == "openrouter" and key == "tool_choice":
                if "tools" not in kwargs or not kwargs["tools"]:
                    removed_params.append(key)
                    debug_print(f"[DEBUG] OpenRouter: 由于没有tools参数，移除tool_choice")
                    continue
            
            filtered[key] = value
        
        if removed_params:
            debug_print(f"[DEBUG] 过滤掉{platform_name}不支持的参数: {removed_params}")
        
        return filtered
    
    def _adjust_platform_limits(self, kwargs: Dict[str, Any], platform_type) -> Dict[str, Any]:
        """根据平台限制调整参数"""
        adjusted = kwargs.copy()
        platform_name = platform_type.value
        
        # DashScope平台限制
        if platform_name == "dashscope":
            # max_tokens限制: 1-8192
            if "max_tokens" in adjusted:
                original_value = adjusted["max_tokens"]
                if original_value > 8192:
                    adjusted["max_tokens"] = 8192
                    debug_print(f"[DEBUG] DashScope: max_tokens从{original_value}调整为8192")
                elif original_value < 1:
                    adjusted["max_tokens"] = 1
                    debug_print(f"[DEBUG] DashScope: max_tokens从{original_value}调整为1")
        
        # 其他平台可以在这里添加限制逻辑
        # elif platform_name == "openrouter":
        #     # OpenRouter的限制
        #     pass
        
        return adjusted
    
    def _get_api_url(self, client, platform_type) -> str:
        """获取平台API URL"""
        platform_name = platform_type.value
        
        if platform_name == "dashscope":
            return "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        elif platform_name == "openrouter":
            return "https://openrouter.ai/api/v1/chat/completions"
        elif platform_name == "ollama":
            base_url = getattr(client, 'base_url', 'http://localhost:11434')
            return f"{base_url}/api/chat"
        elif platform_name == "lmstudio":
            base_url = getattr(client, 'base_url', 'http://localhost:1234')
            return f"{base_url}/v1/chat/completions"
        else:
            raise ValueError(f"Unsupported platform: {platform_name}")
    
    def _get_api_headers(self, client, platform_type) -> dict:
        """获取平台API请求头"""
        platform_name = platform_type.value
        headers = {"Content-Type": "application/json"}
        
        if platform_name == "dashscope":
            headers["Authorization"] = f"Bearer {client.config.api_key}"
        elif platform_name == "openrouter":
            headers["Authorization"] = f"Bearer {client.config.api_key}"
        elif platform_name == "ollama":
            # Ollama通常不需要认证
            pass
        elif platform_name == "lmstudio":
            # LMStudio通常不需要认证
            pass
        
        return headers
    
    def _convert_tools_to_system_prompt(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """将tools参数转换为system prompt，支持完整的Tool Use流程"""
        if not tools:
            return messages
        
        # 构建详细的tools描述，指导模型使用 <use_tool> 格式
        tools_description = "\n\n=== Available Tools ===\n"
        tools_description += "You have access to the following tools. You MUST follow the exact XML format specified below.\n\n"
        
        for tool in tools:
            name = tool.get("name", "Unknown")
            description = tool.get("description", "No description")
            schema = tool.get("input_schema", {})
            
            tools_description += f"**{name}**\n"
            tools_description += f"Description: {description}\n"
            
            # 添加参数信息
            if "properties" in schema:
                tools_description += "Parameters:\n"
                for param_name, param_info in schema["properties"].items():
                    param_type = param_info.get("type", "unknown")
                    param_desc = param_info.get("description", "No description")
                    required = param_name in schema.get("required", [])
                    req_mark = " (required)" if required else " (optional)"
                    tools_description += f"  - {param_name} ({param_type}){req_mark}: {param_desc}\n"
            
            tools_description += "\n"
        
        # 添加工具使用格式说明 - 更严格的约束
        tools_description += """**CRITICAL TOOL USAGE REQUIREMENTS:**

YOU MUST use tools in the EXACT format specified below. NO EXCEPTIONS.

**MANDATORY FORMAT:**
<use_tool>
<tool_name>exact_tool_name</tool_name>
<parameters>
{
  "parameter1": "value1",
  "parameter2": "value2"
}
</parameters>
</use_tool>

**STRICT RULES:**
1. NEVER use descriptive text like "UseTool: ToolName" or "Param: {...}"
2. ALWAYS use the <use_tool> XML tags exactly as shown
3. Tool names MUST match exactly what's listed above
4. Parameters MUST be valid JSON format
5. NO additional text between the XML tags
6. NO explanations inside the tool call

**CORRECT Example:**
<use_tool>
<tool_name>Bash</tool_name>
<parameters>
{
  "command": "ls -la",
  "description": "List files"
}
</parameters>
</use_tool>

**WRONG Examples (DO NOT USE):**
❌ Tool: Bash
❌ Param: {"command": "ls"}
❌ Tool call: Bash with parameters...
❌ Using tool Bash...

If you use ANY format other than the exact <use_tool> XML format, the tool call will FAIL.

**IMPORTANT REMINDERS:**
- Do NOT explain tool calls in natural language
- Do NOT use Chinese descriptive text like "Tool"
- Do NOT use any format other than <use_tool> XML tags
- The system can ONLY process the exact XML format shown above
- Multiple tools can be used by repeating the <use_tool> block
- You can only use one tool at a time

**COMPLIANCE CHECK:**
Before responding, verify that ALL tool calls use the exact format:
<use_tool><tool_name>NAME</tool_name><parameters>{JSON}</parameters></use_tool>

"""
        
        # 查找system消息并附加tools描述
        modified_messages = []
        system_found = False
        
        for message in messages:
            if message.get("role") == "system":
                # 将tools描述附加到现有system消息
                content = message.get("content", "")
                message["content"] = content + tools_description
                system_found = True
                debug_print(f"[DEBUG] 将tools描述附加到现有system消息")
            modified_messages.append(message)
        
        # 如果没有system消息，创建一个新的
        if not system_found:
            system_message = {
                "role": "system",
                "content": tools_description
            }
            modified_messages.insert(0, system_message)
            debug_print(f"[DEBUG] 创建新的system消息包含tools描述")
        
        return modified_messages
    
    def _estimate_input_tokens(self, messages: List[Dict[str, Any]]) -> int:
        """估算输入消息的token数量"""
        total_tokens = 0
        for message in messages:
            content = message.get("content", "")
            if isinstance(content, str):
                total_tokens += self._estimate_text_tokens(content)
            elif isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        total_tokens += self._estimate_text_tokens(item.get("text", ""))
        return total_tokens
    
    def _estimate_text_tokens(self, text: str) -> int:
        """估算文本的token数量（简单估算）"""
        if not text:
            return 0
        
        import re
        # 简单的token估算：中文字符约1个token，英文单词约1个token
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        # 去掉中文字符后计算英文单词
        text_without_chinese = re.sub(r'[\u4e00-\u9fff]', '', text)
        english_words = len(text_without_chinese.split())
        
        return chinese_chars + english_words
    
    def get_last_routing_result(self):
        """获取最后一次路由结果"""
        return getattr(self, 'last_routing_result', None)
    
    def get_processed_prompt(self):
        """获取HOOK处理后的提示词"""
        return getattr(self, 'processed_prompt', None)
    
    def get_processed_headers(self):
        """获取HOOK处理后发送给大模型的请求头"""
        return getattr(self, 'processed_headers', None)
    
    def get_model_raw_headers(self):
        """获取大模型返回的原始响应头"""
        return getattr(self, 'model_raw_headers', None)
    
    def get_model_raw_response(self):
        """获取大模型返回的原始响应体(HOOK处理前)"""
        return getattr(self, 'model_raw_response', None)
    
    def get_token_usage(self):
        """获取Token使用量"""
        if hasattr(self, 'streaming_converter') and self.streaming_converter:
            return {
                "input_tokens": self.streaming_converter.total_input_tokens,
                "output_tokens": self.streaming_converter.total_output_tokens,
                "total_tokens": self.streaming_converter.total_input_tokens + self.streaming_converter.total_output_tokens
            }
        return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

# 全局服务实例
multi_platform_service = MultiPlatformService()