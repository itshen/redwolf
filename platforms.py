"""
多平台API服务模块
支持阿里云百炼、OpenRouter、Ollama、LMStudio等平台
"""

import httpx
import json
import asyncio
from typing import Dict, List, Any, Optional, AsyncGenerator
from dataclasses import dataclass
from enum import Enum
import logging

# 配置日志
import os
DEBUG_MODE = os.getenv('DEBUG_MODE', 'false').lower() == 'true'

logging.basicConfig(level=logging.DEBUG if DEBUG_MODE else logging.INFO)
logger = logging.getLogger(__name__)

def debug_print(*args, **kwargs):
    """统一的DEBUG输出函数，只在DEBUG_MODE启用时输出"""
    if DEBUG_MODE:
        print(*args, **kwargs)

class PlatformType(Enum):
    """平台类型枚举"""
    DASHSCOPE = "dashscope"  # 阿里云百炼
    OPENROUTER = "openrouter"
    OLLAMA = "ollama"
    LMSTUDIO = "lmstudio"
    SILICONFLOW = "siliconflow"  # 硅基流动
    OPENAI_COMPATIBLE = "openai_compatible"  # OpenAI兼容

@dataclass
class PlatformConfig:
    """平台配置"""
    platform_type: PlatformType
    api_key: str = ""
    base_url: str = ""
    enabled: bool = True
    timeout: int = 30

@dataclass
class ModelInfo:
    """模型信息"""
    id: str
    name: str
    platform: PlatformType
    enabled: bool = True
    description: str = ""

class PlatformClient:
    """平台客户端基类"""
    
    def __init__(self, config: PlatformConfig):
        self.config = config
        self.client = None
    
    async def get_models(self) -> List[ModelInfo]:
        """获取可用模型列表"""
        raise NotImplementedError
    
    async def chat_completion(
        self, 
        model: str, 
        messages: List[Dict[str, Any]], 
        stream: bool = False,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """聊天补全接口"""
        raise NotImplementedError
    
    async def test_connection(self) -> bool:
        """测试连接"""
        try:
            models = await self.get_models()
            return len(models) > 0
        except Exception as e:
            logger.error(f"Platform {self.config.platform_type} connection test failed: {e}")
            return False

class DashScopeClient(PlatformClient):
    """阿里云百炼客户端"""
    
    def __init__(self, config: PlatformConfig):
        super().__init__(config)
        self.base_url = "https://dashscope.aliyuncs.com"
    
    async def get_models(self) -> List[ModelInfo]:
        """获取通义千问模型列表"""
        logger.info("🔍 [DashScope] 开始获取模型列表...")
        
        if not self.config.api_key:
            logger.warning("⚠️ [DashScope] API Key未配置，跳过获取模型")
            return []
        
        try:
            logger.info(f"🌐 [DashScope] 请求URL: {self.base_url}/compatible-mode/v1/models")
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/compatible-mode/v1/models",
                    headers={
                        "Authorization": f"Bearer {self.config.api_key}",
                        "Content-Type": "application/json"
                    }
                )
                
                logger.info(f"📡 [DashScope] API响应状态: {response.status_code}")
                
                if response.status_code == 200:
                    data = response.json()
                    models = []
                    
                    logger.info(f"📋 [DashScope] 响应数据: {json.dumps(data, indent=2, ensure_ascii=False)}")
                    
                    # 解析模型列表
                    if "output" in data and "models" in data["output"]:
                        for model in data["output"]["models"]:
                            model_name = model.get("model_name", "")
                            model_info = ModelInfo(
                                id=model_name,
                                name=model_name,
                                platform=PlatformType.DASHSCOPE,
                                description=f"容量: {model.get('base_capacity', 1)}"
                            )
                            models.append(model_info)
    
                    elif "data" in data:
                        # 兼容旧格式
                        for model in data["data"]:
                            model_info = ModelInfo(
                                id=model.get("id", ""),
                                name=model.get("name", model.get("id", "")),
                                platform=PlatformType.DASHSCOPE,
                                description=model.get("description", "")
                            )
                            models.append(model_info)
    
                    else:
                        # 如果API返回格式不匹配，添加一些默认的通义千问模型
                        logger.info("⚠️ [DashScope] API响应格式不匹配，使用默认模型列表")
                        default_models = [
                            {"id": "qwen-plus", "name": "qwen-plus", "description": "通义千问增强版"},
                            {"id": "qwen-turbo", "name": "qwen-turbo", "description": "通义千问快速版"},
                            {"id": "qwen-max", "name": "qwen-max", "description": "通义千问最强版"},
                            {"id": "qwen-coder", "name": "qwen-coder", "description": "专门用于代码生成和优化"},
                            {"id": "qwen3-coder-plus", "name": "qwen3-coder-plus", "description": "通义千问3代码增强版"},
                            {"id": "qwen2.5-coder-instruct", "name": "qwen2.5-coder-instruct", "description": "通义千问2.5代码指令版"},
                            {"id": "qwen2-72b-instruct", "name": "qwen2-72b-instruct", "description": "通义千问2 72B指令版"},
                        ]
                        
                        for model in default_models:
                            model_info = ModelInfo(
                                id=model["id"],
                                name=model["name"],
                                platform=PlatformType.DASHSCOPE,
                                description=model["description"]
                            )
                            models.append(model_info)
            
                    
                    logger.info(f"✅ [DashScope] 成功获取 {len(models)} 个模型")
                    return models
                else:
                    logger.error(f"❌ [DashScope] API错误: {response.status_code} - {response.text}")
                    return []
                    
        except Exception as e:
            logger.error(f"❌ [DashScope] 获取模型失败: {e}")
            return []
    
    async def chat_completion(
        self, 
        model: str, 
        messages: List[Dict[str, Any]], 
        stream: bool = False,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """通义千问聊天补全"""
        if not self.config.api_key:
            yield json.dumps({"error": "API key not configured"})
            return
        
        url = f"{self.base_url}/compatible-mode/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
            **kwargs
        }
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                if stream:
                    async with client.stream(
                        "POST", url, headers=headers, json=payload
                    ) as response:
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if line.strip():
                                    if line.startswith("data: "):
                                        data = line[6:]
                                        if data.strip() == "[DONE]":
                                            break
                                        yield data
                                    else:
                                        yield line
                        else:
                            error_msg = await response.aread()
                            yield json.dumps({"error": f"API error: {response.status_code} - {error_msg.decode()}"})
                else:
                    response = await client.post(url, headers=headers, json=payload)
                    if response.status_code == 200:
                        yield response.text
                    else:
                        yield json.dumps({"error": f"API error: {response.status_code} - {response.text}"})
                        
        except Exception as e:
            logger.error(f"DashScope chat completion error: {e}")
            yield json.dumps({"error": f"Request failed: {str(e)}"})

class OpenRouterClient(PlatformClient):
    """OpenRouter客户端"""
    
    def __init__(self, config: PlatformConfig):
        super().__init__(config)
        self.base_url = "https://openrouter.ai/api/v1"
    
    async def get_models(self) -> List[ModelInfo]:
        """获取OpenRouter模型列表"""
        if not self.config.api_key:
            return []
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers={
                        "Authorization": f"Bearer {self.config.api_key}",
                        "Content-Type": "application/json"
                    }
                )
                
                if response.status_code == 200:
                    data = response.json()
                    models = []
                    
                    if "data" in data:
                        for model in data["data"]:
                            models.append(ModelInfo(
                                id=model.get("id", ""),
                                name=model.get("name", model.get("id", "")),
                                platform=PlatformType.OPENROUTER,
                                description=model.get("description", "")
                            ))
                    
                    return models
                else:
                    logger.error(f"OpenRouter API error: {response.status_code} - {response.text}")
                    return []
                    
        except Exception as e:
            logger.error(f"Failed to get OpenRouter models: {e}")
            return []
    
    async def chat_completion(
        self, 
        model: str, 
        messages: List[Dict[str, Any]], 
        stream: bool = False,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """OpenRouter聊天补全"""
        if not self.config.api_key:
            yield json.dumps({"error": "API key not configured"})
            return
        
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
            **kwargs
        }
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                if stream:
                    async with client.stream(
                        "POST", url, headers=headers, json=payload
                    ) as response:
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if line.strip():
                                    # 直接 yield 原始行，让转换器处理格式
                                    yield line
                        else:
                            error_msg = await response.aread()
                            yield json.dumps({"error": f"API error: {response.status_code} - {error_msg.decode()}"})
                else:
                    response = await client.post(url, headers=headers, json=payload)
                    if response.status_code == 200:
                        yield response.text
                    else:
                        yield json.dumps({"error": f"API error: {response.status_code} - {response.text}"})
                        
        except Exception as e:
            logger.error(f"OpenRouter chat completion error: {e}")
            yield json.dumps({"error": f"Request failed: {str(e)}"})

class OllamaClient(PlatformClient):
    """Ollama客户端"""
    
    def __init__(self, config: PlatformConfig):
        super().__init__(config)
        self.base_url = config.base_url or "http://localhost:11434"
    
    async def get_models(self) -> List[ModelInfo]:
        """获取Ollama模型列表"""
        logger.info("🔍 [Ollama] 开始获取模型列表...")
        logger.info(f"🌐 [Ollama] 请求URL: {self.base_url}/api/tags")
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                
                logger.info(f"📡 [Ollama] API响应状态: {response.status_code}")
                
                if response.status_code == 200:
                    data = response.json()
                    models = []
                    
                    logger.info(f"📋 [Ollama] 响应数据: {json.dumps(data, indent=2, ensure_ascii=False)}")
                    
                    if "models" in data:
                        for model in data["models"]:
                            model_info = ModelInfo(
                                id=model.get("name", ""),
                                name=model.get("name", ""),
                                platform=PlatformType.OLLAMA,
                                description=f"Size: {model.get('size', 'Unknown')}"
                            )
                            models.append(model_info)
            
                    
                    logger.info(f"✅ [Ollama] 成功获取 {len(models)} 个模型")
                    return models
                else:
                    logger.error(f"❌ [Ollama] API错误: {response.status_code} - {response.text}")
                    return []
                    
        except Exception as e:
            logger.error(f"❌ [Ollama] 获取模型失败: {e}")
            return []
    
    async def chat_completion(
        self, 
        model: str, 
        messages: List[Dict[str, Any]], 
        stream: bool = True,  # Ollama默认使用流式
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """Ollama聊天补全"""
        url = f"{self.base_url}/api/chat"
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream
        }
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                if stream:
                    async with client.stream(
                        "POST", url, json=payload
                    ) as response:
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if line.strip():
                                    try:
                                        data = json.loads(line)
                                        # 转换Ollama格式到OpenAI格式
                                        openai_chunk = self._convert_ollama_to_openai(data)
                                        yield json.dumps(openai_chunk)
                                        
                                        if data.get("done", False):
                                            break
                                    except json.JSONDecodeError:
                                        continue
                        else:
                            error_msg = await response.aread()
                            yield json.dumps({"error": f"API error: {response.status_code} - {error_msg.decode()}"})
                else:
                    # 非流式模式需要手动收集所有响应
                    full_response = ""
                    async with client.stream("POST", url, json=payload) as response:
                        async for line in response.aiter_lines():
                            if line.strip():
                                try:
                                    data = json.loads(line)
                                    if "message" in data and "content" in data["message"]:
                                        full_response += data["message"]["content"]
                                    if data.get("done", False):
                                        break
                                except json.JSONDecodeError:
                                    continue
                    
                    openai_response = {
                        "id": "chatcmpl-ollama",
                        "object": "chat.completion",
                        "created": int(asyncio.get_event_loop().time()),
                        "model": model,
                        "choices": [{
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": full_response
                            },
                            "finish_reason": "stop"
                        }]
                    }
                    yield json.dumps(openai_response)
                        
        except Exception as e:
            logger.error(f"Ollama chat completion error: {e}")
            yield json.dumps({"error": f"Request failed: {str(e)}"})
    
    def _convert_ollama_to_openai(self, ollama_data: Dict[str, Any]) -> Dict[str, Any]:
        """将Ollama响应格式转换为OpenAI格式"""
        content = ""
        if "message" in ollama_data and "content" in ollama_data["message"]:
            content = ollama_data["message"]["content"]
        
        return {
            "id": "chatcmpl-ollama",
            "object": "chat.completion.chunk",
            "created": int(asyncio.get_event_loop().time()),
            "model": ollama_data.get("model", "unknown"),
            "choices": [{
                "index": 0,
                "delta": {
                    "content": content
                } if content else {},
                "finish_reason": "stop" if ollama_data.get("done", False) else None
            }]
        }

class SiliconFlowClient(PlatformClient):
    """硅基流动客户端"""
    
    def __init__(self, config: PlatformConfig):
        super().__init__(config)
        self.base_url = "https://api.siliconflow.cn"
    
    async def get_models(self) -> List[ModelInfo]:
        """获取硅基流动模型列表"""
        logger.info("🔍 [SiliconFlow] 开始获取模型列表...")
        
        if not self.config.api_key:
            logger.warning("⚠️ [SiliconFlow] API Key未配置，跳过获取模型")
            return []
        
        try:
            logger.info(f"🌐 [SiliconFlow] 请求URL: {self.base_url}/v1/models")
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/v1/models",
                    headers={
                        "Authorization": f"Bearer {self.config.api_key}",
                        "Content-Type": "application/json"
                    }
                )
                
                logger.info(f"📡 [SiliconFlow] API响应状态: {response.status_code}")
                
                if response.status_code == 200:
                    data = response.json()
                    models = []
                    
                    logger.info(f"📋 [SiliconFlow] 响应数据: {json.dumps(data, indent=2, ensure_ascii=False)}")
                    
                    # 解析模型列表
                    if "data" in data:
                        for model in data["data"]:
                            model_id = model.get("id", "")
                            model_name = model.get("name", model_id)
                            
                            model_info = ModelInfo(
                                id=model_id,
                                name=model_name,
                                platform=PlatformType.SILICONFLOW,
                                description=model.get("description", f"硅基流动模型: {model_id}")
                            )
                            models.append(model_info)
                    else:
                        # 如果API返回格式不匹配，添加一些默认的硅基流动模型
                        logger.info("⚠️ [SiliconFlow] API响应格式不匹配，使用默认模型列表")
                        default_models = [
                            {"id": "Qwen/QwQ-32B", "name": "QwQ-32B", "description": "千问推理模型32B版本"},
                            {"id": "Qwen/Qwen2.5-72B-Instruct", "name": "Qwen2.5-72B-Instruct", "description": "千问2.5 72B指令版"},
                            {"id": "Qwen/Qwen2.5-32B-Instruct", "name": "Qwen2.5-32B-Instruct", "description": "千问2.5 32B指令版"},
                            {"id": "Qwen/Qwen2.5-14B-Instruct", "name": "Qwen2.5-14B-Instruct", "description": "千问2.5 14B指令版"},
                            {"id": "Qwen/Qwen2.5-7B-Instruct", "name": "Qwen2.5-7B-Instruct", "description": "千问2.5 7B指令版"},
                            {"id": "meta-llama/Llama-3.1-70B-Instruct", "name": "Llama-3.1-70B-Instruct", "description": "Llama 3.1 70B指令版"},
                            {"id": "meta-llama/Llama-3.1-8B-Instruct", "name": "Llama-3.1-8B-Instruct", "description": "Llama 3.1 8B指令版"},
                            {"id": "deepseek-ai/DeepSeek-V2.5", "name": "DeepSeek-V2.5", "description": "深度求索V2.5模型"},
                        ]
                        
                        for model in default_models:
                            model_info = ModelInfo(
                                id=model["id"],
                                name=model["name"],
                                platform=PlatformType.SILICONFLOW,
                                description=model["description"]
                            )
                            models.append(model_info)
                    
                    logger.info(f"✅ [SiliconFlow] 成功获取 {len(models)} 个模型")
                    return models
                else:
                    logger.error(f"❌ [SiliconFlow] API错误: {response.status_code} - {response.text}")
                    return []
                    
        except Exception as e:
            logger.error(f"❌ [SiliconFlow] 获取模型失败: {e}")
            return []
    
    async def chat_completion(
        self, 
        model: str, 
        messages: List[Dict[str, Any]], 
        stream: bool = False,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """硅基流动聊天补全"""
        if not self.config.api_key:
            yield json.dumps({"error": "API key not configured"})
            return
        
        url = f"{self.base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
            **kwargs
        }
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                if stream:
                    async with client.stream(
                        "POST", url, headers=headers, json=payload
                    ) as response:
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if line.strip():
                                    if line.startswith("data: "):
                                        data = line[6:]
                                        if data.strip() == "[DONE]":
                                            break
                                        yield data
                                    else:
                                        yield line
                        else:
                            error_msg = await response.aread()
                            yield json.dumps({"error": f"API error: {response.status_code} - {error_msg.decode()}"})
                else:
                    response = await client.post(url, headers=headers, json=payload)
                    if response.status_code == 200:
                        yield response.text
                    else:
                        yield json.dumps({"error": f"API error: {response.status_code} - {response.text}"})
                        
        except Exception as e:
            logger.error(f"SiliconFlow chat completion error: {e}")
            yield json.dumps({"error": f"Request failed: {str(e)}"})

class OpenAICompatibleClient(PlatformClient):
    """OpenAI兼容客户端"""
    
    def __init__(self, config: PlatformConfig):
        super().__init__(config)
        # base_url 必须由用户配置，没有默认值
        self.base_url = config.base_url
        if not self.base_url:
            logger.warning("⚠️ [OpenAI Compatible] Base URL未配置")
    
    async def get_models(self) -> List[ModelInfo]:
        """获取OpenAI兼容API模型列表"""
        logger.info("🔍 [OpenAI Compatible] 开始获取模型列表...")
        
        if not self.base_url:
            logger.warning("⚠️ [OpenAI Compatible] Base URL未配置，跳过获取模型")
            return []
        
        if not self.config.api_key:
            logger.warning("⚠️ [OpenAI Compatible] API Key未配置，跳过获取模型")
            return []
        
        try:
            # 确保URL以/结尾
            base_url = self.base_url.rstrip('/')
            url = f"{base_url}/v1/models"
            
            logger.info(f"🌐 [OpenAI Compatible] 请求URL: {url}")
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.get(
                    url,
                    headers={
                        "Authorization": f"Bearer {self.config.api_key}",
                        "Content-Type": "application/json"
                    }
                )
                
                logger.info(f"📡 [OpenAI Compatible] API响应状态: {response.status_code}")
                
                if response.status_code == 200:
                    data = response.json()
                    models = []
                    
                    logger.info(f"📋 [OpenAI Compatible] 响应数据: {json.dumps(data, indent=2, ensure_ascii=False)}")
                    
                    # 解析模型列表
                    if "data" in data:
                        for model in data["data"]:
                            model_id = model.get("id", "")
                            model_name = model.get("name", model_id)
                            
                            model_info = ModelInfo(
                                id=model_id,
                                name=model_name,
                                platform=PlatformType.OPENAI_COMPATIBLE,
                                description=model.get("description", f"OpenAI兼容模型: {model_id}")
                            )
                            models.append(model_info)
                    else:
                        # 如果API返回格式不匹配，尝试直接使用响应数据
                        logger.info("⚠️ [OpenAI Compatible] API响应格式不匹配，尝试直接解析")
                        if isinstance(data, list):
                            for model in data:
                                if isinstance(model, dict):
                                    model_id = model.get("id", str(model))
                                    model_info = ModelInfo(
                                        id=model_id,
                                        name=model.get("name", model_id),
                                        platform=PlatformType.OPENAI_COMPATIBLE,
                                        description=model.get("description", f"OpenAI兼容模型: {model_id}")
                                    )
                                    models.append(model_info)
                        else:
                            logger.warning("⚠️ [OpenAI Compatible] 无法解析模型数据，请检查API响应格式")
                    
                    logger.info(f"✅ [OpenAI Compatible] 成功获取 {len(models)} 个模型")
                    return models
                else:
                    logger.error(f"❌ [OpenAI Compatible] API错误: {response.status_code} - {response.text}")
                    return []
                    
        except Exception as e:
            logger.error(f"❌ [OpenAI Compatible] 获取模型失败: {e}")
            return []
    
    async def chat_completion(
        self, 
        model: str, 
        messages: List[Dict[str, Any]], 
        stream: bool = False,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """OpenAI兼容聊天补全"""
        if not self.base_url:
            yield json.dumps({"error": "Base URL not configured"})
            return
        
        if not self.config.api_key:
            yield json.dumps({"error": "API key not configured"})
            return
        
        # 确保URL以/结尾
        base_url = self.base_url.rstrip('/')
        url = f"{base_url}/chat/completions"
        
        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
            **kwargs
        }
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                if stream:
                    async with client.stream(
                        "POST", url, headers=headers, json=payload
                    ) as response:
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if line.strip():
                                    if line.startswith("data: "):
                                        data = line[6:]
                                        if data.strip() == "[DONE]":
                                            break
                                        yield data
                                    else:
                                        yield line
                        else:
                            error_msg = await response.aread()
                            yield json.dumps({"error": f"API error: {response.status_code} - {error_msg.decode()}"})
                else:
                    response = await client.post(url, headers=headers, json=payload)
                    if response.status_code == 200:
                        yield response.text
                    else:
                        yield json.dumps({"error": f"API error: {response.status_code} - {response.text}"})
                        
        except Exception as e:
            logger.error(f"OpenAI Compatible chat completion error: {e}")
            yield json.dumps({"error": f"Request failed: {str(e)}"})

class LMStudioClient(PlatformClient):
    """LMStudio客户端"""
    
    def __init__(self, config: PlatformConfig):
        super().__init__(config)
        self.base_url = config.base_url or "http://localhost:1234"
    
    async def get_models(self) -> List[ModelInfo]:
        """获取LMStudio模型列表"""
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                response = await client.get(f"{self.base_url}/v1/models")
                
                if response.status_code == 200:
                    data = response.json()
                    models = []
                    
                    if "data" in data:
                        for model in data["data"]:
                            models.append(ModelInfo(
                                id=model.get("id", ""),
                                name=model.get("id", ""),
                                platform=PlatformType.LMSTUDIO,
                                description="LMStudio local model"
                            ))
                    
                    return models
                else:
                    logger.error(f"LMStudio API error: {response.status_code} - {response.text}")
                    return []
                    
        except Exception as e:
            logger.error(f"Failed to get LMStudio models: {e}")
            return []
    
    async def chat_completion(
        self, 
        model: str, 
        messages: List[Dict[str, Any]], 
        stream: bool = False,
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """LMStudio聊天补全"""
        url = f"{self.base_url}/v1/chat/completions"
        headers = {
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream,
            **kwargs
        }
        
        try:
            async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                if stream:
                    async with client.stream(
                        "POST", url, headers=headers, json=payload
                    ) as response:
                        if response.status_code == 200:
                            async for line in response.aiter_lines():
                                if line.strip():
                                    if line.startswith("data: "):
                                        data = line[6:]
                                        if data.strip() == "[DONE]":
                                            break
                                        yield data
                                    else:
                                        yield line
                        else:
                            error_msg = await response.aread()
                            yield json.dumps({"error": f"API error: {response.status_code} - {error_msg.decode()}"})
                else:
                    response = await client.post(url, headers=headers, json=payload)
                    if response.status_code == 200:
                        yield response.text
                    else:
                        yield json.dumps({"error": f"API error: {response.status_code} - {response.text}"})
                        
        except Exception as e:
            logger.error(f"LMStudio chat completion error: {e}")
            yield json.dumps({"error": f"Request failed: {str(e)}"})

class PlatformManager:
    """平台管理器"""
    
    def __init__(self):
        self.platforms: Dict[PlatformType, PlatformClient] = {}
    
    def add_platform(self, config: PlatformConfig):
        """添加平台"""
        if config.platform_type == PlatformType.DASHSCOPE:
            client = DashScopeClient(config)
        elif config.platform_type == PlatformType.OPENROUTER:
            client = OpenRouterClient(config)
        elif config.platform_type == PlatformType.OLLAMA:
            client = OllamaClient(config)
        elif config.platform_type == PlatformType.LMSTUDIO:
            client = LMStudioClient(config)
        elif config.platform_type == PlatformType.SILICONFLOW:
            client = SiliconFlowClient(config)
        elif config.platform_type == PlatformType.OPENAI_COMPATIBLE:
            client = OpenAICompatibleClient(config)
        else:
            raise ValueError(f"Unsupported platform type: {config.platform_type}")
        
        self.platforms[config.platform_type] = client
    
    def get_platform(self, platform_type: PlatformType) -> Optional[PlatformClient]:
        """获取平台客户端"""
        return self.platforms.get(platform_type)
    
    async def get_all_models(self) -> List[ModelInfo]:
        """获取所有平台的模型列表"""
        logger.info("🚀 [PlatformManager] 开始获取所有平台模型列表...")
        
        all_models = []
        for platform_type, platform in self.platforms.items():
            try:
                logger.info(f"📞 [PlatformManager] 调用 {platform_type.value} 平台...")
                models = await platform.get_models()
                logger.info(f"📦 [PlatformManager] {platform_type.value} 返回 {len(models)} 个模型")
                all_models.extend(models)
            except Exception as e:
                logger.error(f"❌ [PlatformManager] {platform_type.value} 平台获取模型失败: {e}")
        
        logger.info(f"🎯 [PlatformManager] 总共获取到 {len(all_models)} 个模型")
        return all_models
    
    async def test_all_connections(self) -> Dict[PlatformType, bool]:
        """测试所有平台连接"""
        results = {}
        for platform_type, client in self.platforms.items():
            results[platform_type] = await client.test_connection()
        
        return results