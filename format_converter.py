"""
Claude格式与OpenAI格式的转换模块
支持双向转换，包括tool use处理
"""

import json
import re
from typing import Dict, List, Any, Optional
import logging
import os
import secrets
import string

DEBUG_MODE = os.getenv('DEBUG_MODE', 'false').lower() == 'true'
logger = logging.getLogger(__name__)

def debug_print(*args, **kwargs):
    """统一的DEBUG输出函数，只在DEBUG_MODE启用时输出"""
    if DEBUG_MODE:
        print(*args, **kwargs)

def generate_claude_message_id() -> str:
    """生成Claude风格的消息ID"""
    # 生成类似 msg_013Zva2CMHLNnXjNJJKqJ2EF 的ID
    # 使用安全随机字符串，包含数字和大小写字母
    random_part = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(20))
    return f"msg_{random_part}"

class FormatConverter:
    """格式转换器"""
    
    @staticmethod
    def claude_to_openai(claude_messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        将Claude格式的消息转换为OpenAI格式
        主要处理tool use，将其压到prompt中
        """
        openai_messages = []
        
        for message in claude_messages:
            role = message.get("role", "user")
            content = message.get("content", "")
            
            # 处理不同的content格式
            if isinstance(content, list):
                # Claude的content可能是数组格式
                text_content = ""
                tool_content = []
                
                for item in content:
                    if isinstance(item, dict):
                        if item.get("type") == "text":
                            text_content += item.get("text", "")
                        elif item.get("type") == "tool_use":
                            tool_content.append(item)
                        elif item.get("type") == "image":
                            # 处理图片内容（如果需要）
                            text_content += f"[Image: {item.get('source', {}).get('media_type', 'image')}]"
                
                # 如果有tool use，将其压到prompt中
                if tool_content:
                    tool_text = FormatConverter._tools_to_text(tool_content)
                    text_content = f"{text_content}\n\n{tool_text}".strip()
                
                content = text_content
            
            # 检查是否有tool_calls（Claude格式的工具调用）
            if "tool_calls" in message:
                tool_text = FormatConverter._tool_calls_to_text(message["tool_calls"])
                content = f"{content}\n\n{tool_text}".strip()
            
            openai_message = {
                "role": role,
                "content": content
            }
            
            openai_messages.append(openai_message)
        
        return openai_messages
    
    @staticmethod
    def _tools_to_text(tools: List[Dict[str, Any]]) -> str:
        """将工具使用转换为文本描述"""
        tool_descriptions = []
        
        for tool in tools:
            tool_name = tool.get("name", "unknown_tool")
            tool_input = tool.get("input", {})
            
            # 格式化工具调用 - 真实记录调用情况
            tool_desc = f"调用工具: {tool_name}"
            if tool_input:
                tool_desc += f"\n参数: {json.dumps(tool_input, ensure_ascii=False, indent=2)}"
            
            tool_descriptions.append(tool_desc)
        
        return "\n\n".join(tool_descriptions)
    
    @staticmethod
    def _tool_calls_to_text(tool_calls: List[Dict[str, Any]]) -> str:
        """将tool_calls转换为文本描述"""
        tool_descriptions = []
        
        for tool_call in tool_calls:
            function = tool_call.get("function", {})
            function_name = function.get("name", "unknown_function")
            arguments = function.get("arguments", "{}")
            
            # 尝试解析参数
            try:
                args_dict = json.loads(arguments) if isinstance(arguments, str) else arguments
                args_text = json.dumps(args_dict, ensure_ascii=False, indent=2)
            except json.JSONDecodeError:
                args_text = str(arguments)
            
            tool_desc = f"调用函数: {function_name}"
            if args_text and args_text != "{}":
                tool_desc += f"\n参数: {args_text}"
            
            tool_descriptions.append(tool_desc)
        
        return "\n\n".join(tool_descriptions)
    
    @staticmethod
    def openai_to_claude(openai_response: str, is_stream: bool = False, original_model: Optional[str] = None) -> str:
        """
        将OpenAI格式的响应转换为Claude格式
        """
        try:
            if is_stream:
                return FormatConverter._convert_stream_chunk(openai_response, original_model)
            else:
                return FormatConverter._convert_complete_response(openai_response, original_model)
        except Exception as e:
            logger.error(f"Failed to convert OpenAI response to Claude format: {e}")
            return openai_response
    
    @staticmethod
    def _convert_stream_chunk(openai_chunk: str, original_model: Optional[str] = None) -> str:
        """转换流式响应块 - 简单包装，建议使用StreamingConverter"""
        # 为了保持向后兼容，创建一个临时的StreamingConverter
        converter = StreamingConverter(original_model=original_model or "unknown")
        # 简单处理，假设是OpenAI格式
        result = converter._convert_openai_chunk(openai_chunk)
        return result if result else openai_chunk
    
    @staticmethod
    def _convert_complete_response(openai_response: str, original_model: Optional[str] = None) -> str:
        """转换完整响应，支持工具调用"""
        try:
            data = json.loads(openai_response)
            
            # 检查是否是OpenAI格式的完整响应
            if "choices" in data and len(data["choices"]) > 0:
                choice = data["choices"][0]
                message = choice.get("message", {})
                content = message.get("content", "") or ""
                tool_calls = message.get("tool_calls", [])
                finish_reason = choice.get("finish_reason", "stop")
                
                # 优先使用原始模型名称，如果没有则使用响应中的model
                model_to_use = original_model if original_model else data.get("model", "unknown")
                
                # 构造Claude格式的content数组
                claude_content = []
                
                # 处理文本内容，检测其中的<use_tool>标签
                if content and content.strip():
                    # 检测并处理<use_tool>标签
                    processed_content, extracted_tools = FormatConverter._extract_tool_use_from_text(content)
                    
                    # 添加处理后的文本内容（如果有）
                    if processed_content and processed_content.strip():
                        claude_content.append({
                            "type": "text",
                            "text": processed_content
                        })
                    
                    # 添加从文本中提取的工具调用
                    claude_content.extend(extracted_tools)
                
                # 添加工具调用（如果有）
                if tool_calls:
                    for tool_call in tool_calls:
                        function = tool_call.get("function", {})
                        tool_name = function.get("name", "unknown")
                        try:
                            arguments = json.loads(function.get("arguments", "{}"))
                        except json.JSONDecodeError:
                            arguments = {}
                        
                        claude_content.append({
                            "type": "tool_use",
                            "id": tool_call.get("id", f"call_{len(claude_content):012d}f"),
                            "name": tool_name,
                            "input": arguments
                        })
                
                # 如果没有任何内容，添加空文本
                if not claude_content:
                    claude_content.append({
                        "type": "text",
                        "text": ""
                    })
                
                # 根据工具调用情况设置stop_reason
                has_any_tools = bool(tool_calls) or any(item.get("type") == "tool_use" for item in claude_content)
                stop_reason = "tool_use" if has_any_tools else "end_turn"
                if finish_reason == "tool_calls":
                    stop_reason = "tool_use"
                
                # 生成Claude风格的消息ID
                original_id = data.get("id", "")
                if original_id and not original_id.startswith("msg_"):
                    # 如果有原始ID但不是Claude格式，转换为Claude格式
                    claude_id = f"msg_{original_id.replace('chatcmpl-', '').replace('-', '')}"
                elif not original_id:
                    # 如果没有原始ID，生成新的Claude风格ID
                    claude_id = generate_claude_message_id()
                else:
                    # 已经是Claude格式的ID
                    claude_id = original_id
                
                # 构造Claude格式的响应
                claude_response = {
                    "id": claude_id,
                    "type": "message",
                    "role": "assistant",
                    "content": claude_content,
                    "model": model_to_use,
                    "stop_reason": stop_reason,
                    "stop_sequence": None,
                    "usage": {
                        "input_tokens": data.get("usage", {}).get("prompt_tokens", 0),
                        "output_tokens": data.get("usage", {}).get("completion_tokens", 0)
                    }
                }
                
                return json.dumps(claude_response, ensure_ascii=False)
            
            # 如果不是标准格式，直接返回
            return openai_response
            
        except json.JSONDecodeError:
            return openai_response
    
    @staticmethod
    def _extract_tool_use_from_text(text: str) -> tuple[str, list]:
        """
        从文本中提取 <use_tool> 标签并转换为Claude格式的tool_use blocks
        返回: (处理后的文本, 工具调用列表)
        """
        import re
        import json
        
        extracted_tools = []
        remaining_text = text
        
        # 查找所有 <use_tool> 标签
        pattern = r'<use_tool>(.*?)</use_tool>'
        matches = re.finditer(pattern, text, re.DOTALL)
        
        # 从后往前处理，避免索引变化
        for match in reversed(list(matches)):
            tool_content = match.group(1)
            
            try:
                # 提取工具名称
                tool_name_match = re.search(r'<tool_name>(.*?)</tool_name>', tool_content, re.DOTALL)
                if not tool_name_match:
                    continue
                
                tool_name = tool_name_match.group(1).strip()
                
                # 提取参数
                params_match = re.search(r'<parameters>(.*?)</parameters>', tool_content, re.DOTALL)
                if not params_match:
                    continue
                
                params_str = params_match.group(1).strip()
                
                # 解析 JSON 参数
                try:
                    params = json.loads(params_str)
                except json.JSONDecodeError:
                    continue
                
                # 生成工具调用ID
                tool_id = f"call_{len(extracted_tools):012d}f"
                
                # 创建工具调用对象
                tool_use = {
                    "type": "tool_use",
                    "id": tool_id,
                    "name": tool_name,
                    "input": params
                }
                
                extracted_tools.insert(0, tool_use)  # 插入到开头保持顺序
                
                # 从文本中移除这个工具调用标签
                remaining_text = remaining_text[:match.start()] + remaining_text[match.end():]
                
            except Exception as e:
                debug_print(f"[DEBUG] 解析工具调用失败: {e}")
                continue
        
        return remaining_text.strip(), extracted_tools
    
    @staticmethod
    def extract_last_user_message(messages: List[Dict[str, Any]]) -> str:
        """提取最后一条用户消息，用于路由判断"""
        for message in reversed(messages):
            if message.get("role") == "user":
                content = message.get("content", "")
                
                # 处理不同的content格式
                if isinstance(content, list):
                    text_parts = []
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            text_parts.append(item.get("text", ""))
                    content = " ".join(text_parts)
                
                return content
        
        return ""
    
    @staticmethod
    def clean_tool_use_from_prompt(prompt: str) -> str:
        """从prompt中清理工具使用相关的文本，保持对话自然"""
        # 移除工具调用描述
        patterns = [
            r"调用工具:.*?(?=\n\n|\n(?=[^参数])|$)",
            r"调用函数:.*?(?=\n\n|\n(?=[^参数])|$)",
            r"参数:\s*\{.*?\}",
            r"\[Tool Call:.*?\]",
            r"\[Function Call:.*?\]"
        ]
        
        cleaned = prompt
        for pattern in patterns:
            cleaned = re.sub(pattern, "", cleaned, flags=re.DOTALL | re.MULTILINE)
        
        # 清理多余的空行
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        cleaned = cleaned.strip()
        
        return cleaned

class StreamingConverter:
    """流式响应转换器 - 支持完整的Claude SSE格式"""
    
    def __init__(self, original_model: str = "unknown"):
        self.buffer = ""
        self.event_id = 0
        self.message_started = False
        self.content_block_started = False
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.message_id = generate_claude_message_id()
        self.model_name = "unknown"
        self.original_model = original_model  # 用户请求的原始模型名称
        self.current_content = ""  # 累积当前输出内容
        self.tool_use_buffer = ""  # 累积工具调用内容
        self.in_tool_use = False  # 是否正在工具调用中
        self.tool_use_count = 0  # 工具调用计数
        self.has_tool_use = False  # 是否使用了工具
    
    def _normalize_message_id(self, message_id: str) -> str:
        """将各种格式的message_id转换为Claude格式"""
        if not message_id:
            debug_print(f"[DEBUG] _normalize_message_id: 收到空message_id")
            return "msg_unknown"
        
        debug_print(f"[DEBUG] _normalize_message_id: 处理message_id: {repr(message_id)}, type: {type(message_id)}")
        
        if message_id.startswith("msg_"):
            return message_id
        elif message_id.startswith("chatcmpl-"):
            # 将OpenAI格式转换为Claude格式
            return f"msg_{message_id[9:]}"  # 去掉chatcmpl-前缀
        else:
            # 其他格式，添加msg_前缀
            return f"msg_{message_id}"
    
    def _estimate_tokens(self, text: str) -> int:
        """估算文本的token数量"""
        if not text:
            return 0
        
        # 更准确的token估算
        # 中文字符通常是1个token
        chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
        
        # 英文单词和标点，去掉中文字符后计算
        text_without_chinese = re.sub(r'[\u4e00-\u9fff]', '', text)
        
        # 特殊处理：代码、JSON等结构化文本token密度更高
        if '{' in text or '[' in text or '<' in text or 'def ' in text or 'function' in text:
            # 结构化文本，按字符估算（约3-4字符1个token）
            other_tokens = max(1, len(text_without_chinese) // 3.5)
        else:
            # 普通文本，按单词估算
            english_words = len(text_without_chinese.split())
            other_tokens = english_words
        
        return int(chinese_chars + other_tokens)
    
    def _process_tool_use_content(self, text: str) -> tuple[str, str]:
        """
        处理文本内容，检测并转换工具调用
        返回: (处理后的文本, 工具调用事件)
        """
        import re
        import json
        
        # 将新文本添加到缓冲区
        self.tool_use_buffer += text
        
        tool_events = ""
        remaining_text = ""
        
        # 检测 <use_tool> 标签开始
        if "<use_tool>" in self.tool_use_buffer and not self.in_tool_use:
            self.in_tool_use = True
            debug_print(f"[DEBUG] 检测到工具调用开始")
            
            # 提取工具调用前的文本
            tool_start = self.tool_use_buffer.find("<use_tool>")
            if tool_start > 0:
                remaining_text = self.tool_use_buffer[:tool_start]
                self.tool_use_buffer = self.tool_use_buffer[tool_start:]
        
        # 检测完整的工具调用
        if self.in_tool_use and "</use_tool>" in self.tool_use_buffer:
            # 找到完整的工具调用
            pattern = r'<use_tool>(.*?)</use_tool>'
            match = re.search(pattern, self.tool_use_buffer, re.DOTALL)
            
            if match:
                tool_content = match.group(1)
                tool_events = self._convert_tool_use_to_claude_format(tool_content)
                debug_print(f"[DEBUG] 转换了工具调用: {tool_content[:100]}")
                
                # 标记使用了工具
                self.has_tool_use = True
                
                # 移除已处理的工具调用
                self.tool_use_buffer = self.tool_use_buffer[match.end():]
                self.in_tool_use = False
        elif not self.in_tool_use:
            # 不在工具调用中，直接返回文本
            remaining_text = text
            self.tool_use_buffer = ""
        # 在工具调用中但还没结束，不返回文本，等待更多内容
        
        return remaining_text, tool_events
    
    def _convert_tool_use_to_claude_format(self, tool_content: str) -> str:
        """
        将 <use_tool> 格式转换为 Claude 的 tool_use content block 序列
        """
        import re
        import json
        
        try:
            # 提取工具名称
            tool_name_match = re.search(r'<tool_name>(.*?)</tool_name>', tool_content, re.DOTALL)
            if not tool_name_match:
                debug_print(f"[ERROR] 无法找到工具名称: {tool_content[:100]}")
                return ""
            
            tool_name = tool_name_match.group(1).strip()
            
            # 提取参数
            params_match = re.search(r'<parameters>(.*?)</parameters>', tool_content, re.DOTALL)
            if not params_match:
                debug_print(f"[ERROR] 无法找到工具参数: {tool_content[:100]}")
                return ""
            
            params_str = params_match.group(1).strip()
            
            # 解析 JSON 参数
            try:
                params = json.loads(params_str)
            except json.JSONDecodeError as e:
                debug_print(f"[ERROR] 工具参数 JSON 解析失败: {e}, params_str: {params_str}")
                return ""
            
            # 生成工具调用 ID
            self.tool_use_count += 1
            tool_use_id = f"call_{self.tool_use_count:012d}f"  # 使用类似Claude的ID格式
            
            debug_print(f"[DEBUG] 生成工具调用: {tool_name}, id: {tool_use_id}, params: {params}")
            
            # 创建 tool_use content block 序列
            result = ""
            
            # 1. 发送 content_block_start 事件（tool_use 类型）
            content_block_start_data = {
                "type": "content_block_start",
                "content_block": {
                    "name": tool_name,
                    "input": {},
                    "id": tool_use_id,
                    "type": "tool_use"
                },
                "index": 1  # 工具调用通常是第二个 content block
            }
            result += self._create_sse_event("content_block_start", content_block_start_data)
            
            # 2. 发送 content_block_delta 事件（只在有参数时发送）
            if params:  # 只有当参数非空时才发送delta事件
                params_json = json.dumps(params, ensure_ascii=False)
                content_block_delta_data = {
                    "delta": {
                        "partial_json": params_json,
                        "type": "input_json_delta"
                    },
                    "type": "content_block_delta",
                    "index": 1
                }
                result += self._create_sse_event("content_block_delta", content_block_delta_data)
            
            return result
            
        except Exception as e:
            debug_print(f"[ERROR] 工具调用转换失败: {e}")
            return ""
    
    def _get_next_event_id(self) -> int:
        """获取下一个事件ID"""
        self.event_id += 1
        return self.event_id
    
    def _create_sse_event(self, event_type: str, data: dict) -> str:
        """创建SSE格式的事件，匹配Claude官方格式"""
        event_id = self._get_next_event_id()
        return f"id:{event_id}\nevent:{event_type}\n:HTTP_STATUS/200\ndata:{json.dumps(data, ensure_ascii=False)}\n\n"
    
    def _create_message_start_event(self, message_id: str, model: Optional[str] = None) -> str:
        """创建message_start事件"""
        # 优先使用原始模型名称，如果没有则使用传入的model
        model_to_use = self.original_model if self.original_model != "unknown" else (model or self.model_name or "unknown")
        
        debug_print(f"[DEBUG] _create_message_start_event: original_model={self.original_model}, model={model}, model_name={self.model_name}, 最终使用={model_to_use}")
        
        data = {
            "type": "message_start",
            "message": {
                "model": model_to_use,
                "role": "assistant", 
                "id": message_id,
                "type": "message",
                "content": [],
                "usage": {
                    "input_tokens": 0,
                    "output_tokens": 0
                }
            }
        }
        return self._create_sse_event("message_start", data)
    
    def _create_content_block_start_event(self) -> str:
        """创建content_block_start事件"""
        data = {
            "type": "content_block_start",
            "content_block": {
                "type": "text",
                "text": ""
            },
            "index": 0
        }
        return self._create_sse_event("content_block_start", data)
    
    def _create_ping_event(self) -> str:
        """创建ping事件"""
        data = {"type": "ping"}
        return self._create_sse_event("ping", data)
    
    def _create_content_delta_event(self, text: str) -> str:
        """创建content_block_delta事件，支持工具调用检测"""
        # 检测和处理工具调用
        processed_text, tool_events = self._process_tool_use_content(text)
        
        result = ""
        
        # 先发送工具调用事件（如果有）
        result += tool_events
        
        # 再发送文本内容（即使为空也发送，保持流连续性）
        if processed_text is not None:
            data = {
                "delta": {
                    "type": "text_delta",
                    "text": processed_text
                },
                "type": "content_block_delta",
                "index": 0
            }
            result += self._create_sse_event("content_block_delta", data)
        
        return result
    
    def _create_content_stop_event(self) -> str:
        """创建content_block_stop事件"""
        data = {
            "type": "content_block_stop",
            "index": 0
        }
        return self._create_sse_event("content_block_stop", data)
    
    def _create_message_delta_event(self, stop_reason: str = "end_turn") -> str:
        """创建message_delta事件"""
        data = {
            "delta": {
                "stop_reason": stop_reason
            },
            "type": "message_delta",
            "usage": {
                "input_tokens": self.total_input_tokens,
                "output_tokens": self.total_output_tokens,
                "cache_read_input_tokens": 0
            }
        }
        return self._create_sse_event("message_delta", data)
    
    def _create_message_stop_event(self) -> str:
        """创建message_stop事件"""
        data = {"type": "message_stop"}
        return self._create_sse_event("message_stop", data)
    
    async def convert_stream(self, chunk: str, platform_type: str = "openai") -> str:
        """转换流式响应块 - 根据平台类型进行不同的转换"""
        try:
            # 检查chunk是否为空
            if chunk is None:
                debug_print(f"[DEBUG] convert_stream: 收到None chunk, platform_type={platform_type}")
                return ""
            
            debug_print(f"[DEBUG] convert_stream: platform_type={platform_type}, chunk长度={len(chunk)}, chunk前50字符={repr(chunk[:50])}")
            
            # 处理不同平台的数据格式
            if platform_type == "qwen":
                result = self._convert_qwen_chunk(chunk)
            elif platform_type == "openrouter":
                result = self._convert_openrouter_chunk(chunk)
            elif platform_type == "ollama":
                result = self._convert_ollama_chunk(chunk)
            elif platform_type == "lmstudio":
                result = self._convert_lmstudio_chunk(chunk)
            else:
                result = self._convert_openai_chunk(chunk)
            
            if result:
                debug_print(f"[DEBUG] convert_stream: 转换成功, 输出长度={len(result)}")
            
            return result
        except Exception as e:
            print(f"[ERROR] convert_stream: 转换失败: {e}")
            logger.error(f"转换流式响应失败: {e}")
            return ""
    
    def _convert_qwen_chunk(self, chunk: str) -> str:
        """转换通义千问的chunk格式"""
        try:
            # 检查chunk是否为空或None
            if not chunk:
                debug_print(f"[DEBUG] _convert_qwen_chunk: 收到空chunk")
                return ""
            
            debug_print(f"[DEBUG] _convert_qwen_chunk: 处理chunk: {repr(chunk[:100])}")
            
            # 去掉"data: "前缀
            if chunk.startswith("data: "):
                json_str = chunk[6:].strip()
                if json_str == "[DONE]":
                    return self._handle_stream_end()
                
                data = json.loads(json_str)
            else:
                data = json.loads(chunk)
            
            # 检查data是否有效
            if not data or not isinstance(data, dict):
                debug_print(f"[DEBUG] _convert_qwen_chunk: data无效或为空: {data}")
                return ""
            
            debug_print(f"[DEBUG] _convert_qwen_chunk: 解析成功的数据结构: {list(data.keys()) if data else 'None'}")
            debug_print(f"[DEBUG] _convert_qwen_chunk: 完整数据内容: {data}")
            
            # 提取基本信息
            if "id" in data:
                debug_print(f"[DEBUG] _convert_qwen_chunk: 提取到id: {data['id']}")
                self.message_id = self._normalize_message_id(data["id"])
                debug_print(f"[DEBUG] _convert_qwen_chunk: 标准化后的message_id: {self.message_id}")
            elif self.message_id == "msg_unknown":
                # 为通义千问生成一个默认ID
                self.message_id = generate_claude_message_id()
                debug_print(f"[DEBUG] _convert_qwen_chunk: 生成默认message_id: {self.message_id}")
            
            if "model" in data:
                debug_print(f"[DEBUG] _convert_qwen_chunk: 提取到model: {data['model']}")
                self.model_name = data["model"]
                debug_print(f"[DEBUG] _convert_qwen_chunk: 设置model_name: {self.model_name}")
            elif self.model_name == "unknown":
                # 使用默认的模型名
                self.model_name = "qwen-turbo"
                debug_print(f"[DEBUG] _convert_qwen_chunk: 使用默认model_name: {self.model_name}")
            
            # 提取usage信息（如果有）
            if "usage" in data and data["usage"]:
                usage = data["usage"]
                if "prompt_tokens" in usage and usage["prompt_tokens"] > 0:
                    # 如果API提供了准确的prompt_tokens，使用API值
                    self.total_input_tokens = usage["prompt_tokens"]
                    debug_print(f"[DEBUG] _convert_qwen_chunk: 使用API提供的input_tokens: {self.total_input_tokens}")
                if "completion_tokens" in usage:
                    self.total_output_tokens = usage["completion_tokens"]
                    debug_print(f"[DEBUG] _convert_qwen_chunk: 使用API提供的output_tokens: {self.total_output_tokens}")
            
            # 处理选择
            if "choices" in data and len(data["choices"]) > 0:
                choice = data["choices"][0]
                delta = choice.get("delta", {})
                content = delta.get("content", "")
                finish_reason = choice.get("finish_reason")
                
                result = ""
                
                # 发送初始事件
                if not self.message_started:
                    result += self._create_message_start_event(self.message_id)
                    result += self._create_content_block_start_event()
                    result += self._create_ping_event()
                    # 发送一个空的content_block_delta事件（Claude格式特征）
                    result += self._create_content_delta_event("")
                    self.message_started = True
                    self.content_block_started = True
                
                # 发送内容增量
                if content:
                    result += self._create_content_delta_event(content)
                    self.current_content += content
                    # 更精确的token计算：中文字符按字计算，英文按单词计算
                    self.total_output_tokens = self._estimate_tokens(self.current_content)
                
                # 处理结束
                if finish_reason == "stop":
                    result += self._handle_stream_end()
                
                return result
            
            return ""
            
        except json.JSONDecodeError:
            return ""
    
    def _convert_openrouter_chunk(self, chunk: str) -> str:
        """转换OpenRouter的chunk格式"""
        try:
            # 检查chunk是否为空或None
            if not chunk:
                return ""
            
            debug_print(f"[DEBUG] _convert_openrouter_chunk: 处理chunk: {repr(chunk[:100])}")
            
            # 处理OpenRouter的特殊前缀
            if chunk.startswith(": OPENROUTER PROCESSING"):
                debug_print(f"[DEBUG] _convert_openrouter_chunk: 忽略处理状态消息")
                return ""  # 忽略处理状态消息
            
            # 去掉"data: "前缀
            if chunk.startswith("data: "):
                json_str = chunk[6:].strip()
                if json_str == "[DONE]":
                    debug_print(f"[DEBUG] _convert_openrouter_chunk: 收到[DONE]信号")
                    return self._handle_stream_end()
                
                data = json.loads(json_str)
            else:
                # 尝试直接解析JSON
                data = json.loads(chunk)
            
            debug_print(f"[DEBUG] _convert_openrouter_chunk: 解析成功的数据结构: {list(data.keys())}")
            debug_print(f"[DEBUG] _convert_openrouter_chunk: 完整数据内容: {data}")
            
            # 提取基本信息
            if "id" in data:
                self.message_id = self._normalize_message_id(data["id"])
                debug_print(f"[DEBUG] _convert_openrouter_chunk: 提取到id: {data['id']}")
                debug_print(f"[DEBUG] _convert_openrouter_chunk: 标准化后的message_id: {self.message_id}")
            if "model" in data:
                self.model_name = data["model"]
                debug_print(f"[DEBUG] _convert_openrouter_chunk: 提取到model: {data['model']}")
                debug_print(f"[DEBUG] _convert_openrouter_chunk: 设置model_name: {self.model_name}")
            
            # 提取usage信息（如果有）
            if "usage" in data and data["usage"]:
                usage = data["usage"]
                if "prompt_tokens" in usage:
                    self.total_input_tokens = usage["prompt_tokens"]
                if "completion_tokens" in usage:
                    self.total_output_tokens = usage["completion_tokens"]
                debug_print(f"[DEBUG] _convert_openrouter_chunk: 提取到usage信息: input={self.total_input_tokens}, output={self.total_output_tokens}")
            
            # 处理选择
            if "choices" in data and len(data["choices"]) > 0:
                choice = data["choices"][0]
                delta = choice.get("delta", {})
                content = delta.get("content", "")
                finish_reason = choice.get("finish_reason")
                
                debug_print(f"[DEBUG] _convert_openrouter_chunk: choice={choice}")
                debug_print(f"[DEBUG] _convert_openrouter_chunk: content='{content}', finish_reason={finish_reason}")
                
                result = ""
                
                # 发送初始事件
                if not self.message_started:
                    result += self._create_message_start_event(self.message_id)
                    result += self._create_content_block_start_event()
                    result += self._create_ping_event()
                    # 发送一个空的content_block_delta事件（Claude格式特征）
                    result += self._create_content_delta_event("")
                    self.message_started = True
                    self.content_block_started = True
                    debug_print(f"[DEBUG] _convert_openrouter_chunk: 发送了初始事件")
                
                # 发送内容增量
                if content:
                    result += self._create_content_delta_event(content)
                    self.current_content += content
                    # 更精确的token计算：中文字符按字计算，英文按单词计算
                    self.total_output_tokens = self._estimate_tokens(self.current_content)
                    debug_print(f"[DEBUG] _convert_openrouter_chunk: 发送内容增量: '{content}'")
                
                # 处理使用统计（覆盖之前的估算）
                if "usage" in data and data["usage"]:
                    usage = data["usage"]
                    if "prompt_tokens" in usage and usage.get("prompt_tokens", 0) > 0:
                        # 如果API提供了准确的prompt_tokens，使用API值
                        self.total_input_tokens = usage.get("prompt_tokens", 0)
                        debug_print(f"[DEBUG] _convert_openrouter_chunk: 使用API提供的input_tokens: {self.total_input_tokens}")
                    if "completion_tokens" in usage:
                        self.total_output_tokens = usage.get("completion_tokens", 0)
                        debug_print(f"[DEBUG] _convert_openrouter_chunk: 使用API提供的output_tokens: {self.total_output_tokens}")
                
                # 处理结束
                if finish_reason == "stop":
                    result += self._handle_stream_end()
                    debug_print(f"[DEBUG] _convert_openrouter_chunk: 处理流结束")
                
                return result
            else:
                # 如果没有choices但有usage，可能是最后的统计信息
                if "usage" in data and data["usage"]:
                    debug_print(f"[DEBUG] _convert_openrouter_chunk: 只有usage信息的chunk")
                    return ""  # 不输出任何内容，只更新统计
            
            return ""
            
        except json.JSONDecodeError as e:
            debug_print(f"[DEBUG] _convert_openrouter_chunk: JSON解析失败: {e}")
            return ""
        except Exception as e:
            print(f"[ERROR] _convert_openrouter_chunk: 处理失败: {e}")
            return ""
    
    def _convert_openai_chunk(self, chunk: str) -> str:
        """转换标准OpenAI格式的chunk"""
        try:
            # 检查chunk是否为空或None
            if not chunk:
                return ""
            
            # 去掉"data: "前缀
            if chunk.startswith("data: "):
                json_str = chunk[6:].strip()
                if json_str == "[DONE]":
                    return self._handle_stream_end()
                
                data = json.loads(json_str)
            else:
                data = json.loads(chunk)
            
            # 提取基本信息
            if "id" in data:
                self.message_id = self._normalize_message_id(data["id"])
            if "model" in data:
                self.model_name = data["model"]
            
            # 提取usage信息（如果有）
            if "usage" in data and data["usage"]:
                usage = data["usage"]
                if "prompt_tokens" in usage and usage.get("prompt_tokens", 0) > 0:
                    # 如果API提供了准确的prompt_tokens，使用API值
                    self.total_input_tokens = usage.get("prompt_tokens", 0)
                    debug_print(f"[DEBUG] _convert_openai_chunk: 使用API提供的input_tokens: {self.total_input_tokens}")
                if "completion_tokens" in usage:
                    self.total_output_tokens = usage.get("completion_tokens", 0)
                    debug_print(f"[DEBUG] _convert_openai_chunk: 使用API提供的output_tokens: {self.total_output_tokens}")
            
            # 处理选择
            if "choices" in data and len(data["choices"]) > 0:
                choice = data["choices"][0]
                delta = choice.get("delta", {})
                content = delta.get("content", "")
                finish_reason = choice.get("finish_reason")
                
                result = ""
                
                # 发送初始事件
                if not self.message_started:
                    result += self._create_message_start_event(self.message_id)
                    result += self._create_content_block_start_event()
                    result += self._create_ping_event()
                    # 发送一个空的content_block_delta事件（Claude格式特征）
                    result += self._create_content_delta_event("")
                    self.message_started = True
                    self.content_block_started = True
                
                # 发送内容增量
                if content:
                    result += self._create_content_delta_event(content)
                    self.current_content += content
                    # 更精确的token计算：中文字符按字计算，英文按单词计算
                    self.total_output_tokens = self._estimate_tokens(self.current_content)
                
                # 处理结束
                if finish_reason == "stop":
                    result += self._handle_stream_end()
                
                return result
            
            return ""
            
        except json.JSONDecodeError:
            return ""
    
    def _convert_ollama_chunk(self, chunk: str) -> str:
        """转换Ollama的chunk格式"""
        try:
            # 检查chunk是否为空或None
            if not chunk:
                return ""
            
            # Ollama直接返回JSON对象，不使用"data: "前缀
            data = json.loads(chunk.strip())
            
            # 提取基本信息
            if "model" in data:
                self.model_name = data["model"]
                # 为Ollama生成一个伪ID
                if self.message_id == "msg_unknown":
                    self.message_id = f"msg_ollama_{hash(self.model_name) % 100000}"
            
            # 处理消息内容
            if "message" in data:
                message = data["message"]
                content = message.get("content", "")
                done = data.get("done", False)
                
                result = ""
                
                # 发送初始事件
                if not self.message_started:
                    result += self._create_message_start_event(self.message_id)
                    result += self._create_content_block_start_event()
                    result += self._create_ping_event()
                    # 发送一个空的content_block_delta事件（Claude格式特征）
                    result += self._create_content_delta_event("")
                    self.message_started = True
                    self.content_block_started = True
                
                # 发送内容增量（即使为空也要发送，保持流的连续性）
                if content is not None:  # 只要content字段存在就发送
                    result += self._create_content_delta_event(content)
                    if content:  # 只有非空内容才累加和计算token
                        self.current_content += content
                        # 更精确的token计算：中文字符按字计算，英文按单词计算
                        self.total_output_tokens = self._estimate_tokens(self.current_content)
                
                # 处理使用统计（从Ollama的详细信息中提取）
                if done and "prompt_eval_count" in data and data.get("prompt_eval_count", 0) > 0:
                    # 如果Ollama提供了准确的prompt_eval_count，使用API值
                    self.total_input_tokens = data.get("prompt_eval_count", 0)
                    debug_print(f"[DEBUG] _convert_ollama_chunk: 使用API提供的input_tokens: {self.total_input_tokens}")
                if done and "eval_count" in data:
                    self.total_output_tokens = data.get("eval_count", 0)
                    debug_print(f"[DEBUG] _convert_ollama_chunk: 使用API提供的output_tokens: {self.total_output_tokens}")
                
                # 处理结束
                if done:
                    result += self._handle_stream_end()
                
                return result
            
            return ""
            
        except json.JSONDecodeError:
            return ""
    
    def _convert_lmstudio_chunk(self, chunk: str) -> str:
        """转换LMStudio的chunk格式（类似OpenAI格式）"""
        try:
            # 检查chunk是否为空或None
            if not chunk:
                return ""
            
            # 去掉"data: "前缀
            if chunk.startswith("data: "):
                json_str = chunk[6:].strip()
                if json_str == "[DONE]":
                    return self._handle_stream_end()
                
                data = json.loads(json_str)
            else:
                data = json.loads(chunk)
            
            # 提取基本信息
            if "id" in data:
                self.message_id = self._normalize_message_id(data["id"])
            if "model" in data:
                self.model_name = data["model"]
            
            # 提取usage信息（如果有）
            if "usage" in data and data["usage"]:
                usage = data["usage"]
                if "prompt_tokens" in usage and usage.get("prompt_tokens", 0) > 0:
                    # 如果LMStudio提供了准确的prompt_tokens，使用API值
                    self.total_input_tokens = usage.get("prompt_tokens", 0)
                    debug_print(f"[DEBUG] _convert_lmstudio_chunk: 使用API提供的input_tokens: {self.total_input_tokens}")
                if "completion_tokens" in usage:
                    self.total_output_tokens = usage.get("completion_tokens", 0)
                    debug_print(f"[DEBUG] _convert_lmstudio_chunk: 使用API提供的output_tokens: {self.total_output_tokens}")
            
            # 处理选择
            if "choices" in data and len(data["choices"]) > 0:
                choice = data["choices"][0]
                delta = choice.get("delta", {})
                content = delta.get("content", "")
                finish_reason = choice.get("finish_reason")
                
                result = ""
                
                # 发送初始事件
                if not self.message_started:
                    result += self._create_message_start_event(self.message_id)
                    result += self._create_content_block_start_event()
                    result += self._create_ping_event()
                    # 发送一个空的content_block_delta事件（Claude格式特征）
                    result += self._create_content_delta_event("")
                    self.message_started = True
                    self.content_block_started = True
                
                # 发送内容增量
                if content:
                    result += self._create_content_delta_event(content)
                    self.current_content += content
                    # 更精确的token计算：中文字符按字计算，英文按单词计算
                    self.total_output_tokens = self._estimate_tokens(self.current_content)
                
                # 处理结束
                if finish_reason == "stop":
                    result += self._handle_stream_end()
                
                return result
            
            return ""
            
        except json.JSONDecodeError:
            return ""
    
    def _handle_stream_end(self) -> str:
        """处理流结束"""
        result = ""
        if self.content_block_started:
            result += self._create_content_stop_event()
            
            # 如果有工具调用，需要添加工具调用的content_block_stop
            if self.has_tool_use:
                # 为工具调用添加 content_block_stop
                tool_stop_data = {
                    "type": "content_block_stop",
                    "index": 1
                }
                result += self._create_sse_event("content_block_stop", tool_stop_data)
                
                # 设置stop_reason为tool_use
                result += self._create_message_delta_event("tool_use")
            else:
                result += self._create_message_delta_event("end_turn")
                
            result += self._create_message_stop_event()
        return result
    
    def get_complete_response(self) -> dict:
        """获取完整的Claude格式响应"""
        return {
            "id": self.message_id,
            "type": "message",
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": self.current_content
                }
            ],
            "model": self.original_model,
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {
                "input_tokens": self.total_input_tokens,
                "output_tokens": self.total_output_tokens
            }
        }
    
    def reset(self):
        """重置转换器状态"""
        self.buffer = ""
        self.event_id = 0
        self.message_started = False
        self.content_block_started = False
        self.total_input_tokens = 0
        self.total_output_tokens = 0
        self.message_id = generate_claude_message_id()
        self.model_name = "unknown"
        self.current_content = ""
        self.tool_use_buffer = ""
        self.in_tool_use = False
        self.tool_use_count = 0
        self.has_tool_use = False