# 🚀 多平台AI模型转发系统

一个功能完整、安全可靠的多平台AI模型智能转发系统，支持认证、智能路由、格式转换和容错降级机制。

> 因为精力有限，产品仍存在不少 BUG，如果遇到，请提 issue，我会尽快处理，也欢迎共建产品。

## 🎯 设计理念

### 💡 核心价值
让 **Claude Code** 能够使用任何大模型，实现最大成本节约和智能化管理：

- **🧠 智能意图识别**：根据用户意图，智能分流到合适的模型
  - 简单对话 → 小模型（成本低）
  - 代码创建 → Qwen Coder（专业）
  - 逻辑修改 → Claude-4（高级推理）

- **💰 成本优化策略**：避免大材小用，节约 API 调用费用
  - Claude Code 的系统提示词 token 很多，用小模型处理简单任务更经济
  - 根据任务复杂度自动选择合适规模的模型

- **🏢 企业级私有化**：支持企业内部完全私有化部署
  - 本地部署大尺寸 Coder 模型（如480B参数）
  - 避免代码泄露给外部服务（Qwen、Kimi等）
  - 支持多用户 KEY 管理和使用统计
  - 更好掌控数据安全和成本

- **🔄 高可用保障**：模型欠费或不可达时自动降级
  - 多层备用方案确保服务连续性
  - 模型不可用时，智能切换

### 🎪 典型应用场景
1. **个人开发者**：用本地模型替代昂贵的 Claude API
2. **小团队**：混合使用本地+云端模型，平衡成本与效果  
3. **企业用户**：完全私有化部署，保护代码安全
4. **学习研究**：捕获和分析 Claude Code 的 Prompt 模式

> 💡 **了解私有化部署细节**，请关注微信公众号：**洛小山**

## 📖 目录

- [🚀 快速开始](#-快速开始)
- [✨ 核心特性](#-核心特性)
- [📝 API使用](#-api使用)
- [⚙️ 配置说明](#-配置说明)
- [🔧 技术架构](#-技术架构)
- [🎨 界面功能](#-界面功能)
- [🔍 故障排除](#-故障排除)
- [🛠️ 开发扩展](#-开发扩展)
- [📊 项目信息](#-项目信息)

## 🚀 快速开始

只需**4步**即可体验多平台AI模型转发：

### 📦 步骤1：启动服务
```bash
# 自动安装依赖并启动
python3.11 start.py

# 或开启调试模式
python3.11 start.py --debug
```

### 🌐 步骤2：登录系统
1. 访问：http://127.0.0.1:8000
2. 初始密码：`admin`
3. 按提示修改密码（至少6位）

### ⚙️ 步骤3：配置平台
点击「配置」→「平台配置」，至少启用一个平台：

| 平台 | 配置要求 | 说明 |
|------|----------|------|
| 🌟 **阿里云百炼** | API Key | 支持通义千问系列 |
| 🌐 **OpenRouter** | API Key | 访问多种商业模型 |
| 🔥 **硅基流动** | API Key | 高性价比开源模型聚合 |
| ⚙️ **OpenAI兼容** | API Key + Base URL | 任何兼容OpenAI API的服务 |
| 🐋 **Ollama** | 本地服务 | 需启动 `ollama serve` |
| 🖥️ **LMStudio** | 本地服务 | 需启动本地服务器 |

### 🎯 步骤4：选择模式
选择适合的工作模式：

- **🔵 Claude Code模式**：简单代理（适合已有Claude服务）
- **🟢 全局直连模式**：手动优先级排序（推荐新手）
- **🟣 智能路由模式**：AI自动选择模型（高级功能）

> 💡 **提示**：配置完成后点击「刷新模型列表」，即可开始使用！

### 🎯 Claude Code 快速使用

#### 配置环境变量
在您的项目目录中执行以下命令：

```bash
# 设置代理地址
export ANTHROPIC_BASE_URL=http://127.0.0.1:8000/api/v1/claude-code

# 设置认证Token（根据模式选择，分发和路由模式需要填本平台的 KEY，ClaudeCode 模式填第三方 KEY）
export ANTHROPIC_AUTH_TOKEN=your_key_here

# 启动 Claude Code
claude
```

#### KEY 配置说明
根据您选择的工作模式，使用不同的 KEY：

| 工作模式 | KEY 来源 | 用途 |
|----------|----------|------|
| **🔵 Claude Code模式** | 第三方服务的 KEY | 代理转发，可捕获 Prompt |
| **🟢 全局直连模式** | 各平台官方申请的 KEY | 直连各大模型平台 |
| **🟣 智能路由模式** | 各平台官方申请的 KEY | 智能选择最佳模型 |

#### ✨ 特殊优势
- **📝 Prompt 捕获**：在 Claude Code 模式下，可以捕获所有用户提示词，用于学习分析
- **💰 成本优化**：通过智能路由避免使用昂贵模型处理简单任务
- **🔄 自动降级**：模型不可用时自动切换到备用模型
- **📊 使用统计**：详细记录所有 API 调用，便于成本分析

---

### 🛠️ 本地服务准备（可选）

如需使用本地模型，请提前准备：

**Ollama 设置：**
```bash
# 安装并启动服务
ollama serve

# 验证：curl http://localhost:11434/api/tags
```

**LMStudio 设置：**
1. 启动 LMStudio 应用
2. 加载任意模型
3. 启动本地服务器（默认端口1234）


## ✨ 核心特性

### 🔐 安全认证系统
- **密码认证**：初始密码 `admin`，首次登录强制修改密码
- **会话管理**：基于Cookie的会话认证，有效期7天
- **密码安全**：SHA256 + 随机盐哈希存储
- **API保护**：所有管理接口都需要认证

### 🔌 多平台支持
- **阿里云百炼 (DashScope)** - 通义千问系列模型
- **OpenRouter** - 访问多种开源和商业模型
- **硅基流动 (SiliconFlow)** - 高性价比开源模型聚合服务
- **OpenAI兼容** - 任何兼容OpenAI API格式的第三方服务
- **Ollama** - 本地部署的开源模型
- **LMStudio** - 本地GPU加速的模型服务

### 🧠 智能路由系统
- **小模型路由模式**: 使用小模型分析用户意图，智能选择最适合的大模型
- **全局直连模式**: 按优先级顺序使用模型，支持自动降级
- **Claude Code API模式**: 保持原有的代理转发逻辑

### 🔄 格式转换
- **Claude ⟷ OpenAI**: 自动转换不同平台的API格式
- **Tool Use 处理**: 智能将工具调用转换为自然语言描述
- **流式响应**: 支持实时流式输出转换

### 🛡️ 容错机制
- **自动降级**: 主模型不可用时自动切换到备用模型
- **连接测试**: 实时检测各平台连接状态
- **错误处理**: 详细的错误信息和恢复机制

### 🎨 现代化界面
- **响应式设计**: 适配各种屏幕尺寸
- **拖拽排序**: 支持模型优先级的拖拽设置
- **实时监控**: 自动记录所有API调用，实时更新列表
- **JSON美化**: 语法高亮、格式化显示、一键复制

## 📝 API使用

### 📡 接口地址
```
POST http://127.0.0.1:8000/api/v1/claude-code/messages
```

### 💬 基础聊天
```bash
curl -X POST http://127.0.0.1:8000/api/v1/claude-code/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-haiku",
    "messages": [
      {"role": "user", "content": "你好，请介绍一下你自己"}
    ],
    "stream": false
  }'
```

### 📊 流式响应
```bash
curl -X POST http://127.0.0.1:8000/api/v1/claude-code/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-haiku",
    "messages": [
      {"role": "user", "content": "写一首关于春天的诗"}
    ],
    "stream": true
  }'
```

### 🔧 工具调用示例
```bash
curl -X POST http://127.0.0.1:8000/api/v1/claude-code/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-sonnet",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "帮我分析一下这个数据"
          },
          {
            "type": "tool_use", 
            "name": "data_analyzer",
            "input": {"data": [1,2,3,4,5]}
          }
        ]
      }
    ]
  }'
```

### 📋 支持的模型
| 平台 | 可用模型 |
|------|----------|
| 阿里云百炼 | `qwen-plus`, `qwen-max`, `qwen-coder` |
| OpenRouter | `claude-3-opus`, `gpt-4o`, `llama-3.1-405b` |
| 硅基流动 | `Qwen/QwQ-32B`, `Qwen/Qwen2.5-72B-Instruct`, `deepseek-ai/DeepSeek-V2.5` |
| OpenAI兼容 | 根据具体服务提供的模型 |
| Ollama | 本地下载的所有模型 |
| LMStudio | 已加载的模型 |

> 💡 **提示**：完整模型列表可通过「刷新模型列表」功能获取

## ⚙️ 配置说明

### 🔧 平台配置
所有配置都通过Web界面完成，支持实时保存和验证：

| 配置项 | 阿里云百炼 | OpenRouter | 硅基流动 | OpenAI兼容 | Ollama | LMStudio |
|--------|------------|------------|----------|------------|--------|----------|
| **API Key** | ✅ 必需 | ✅ 必需 | ✅ 必需 | ✅ 必需 | ❌ 不需要 | ❌ 不需要 |
| **服务地址** | 默认 | 默认 | 默认 | ✅ 必需配置 | localhost:11434 | localhost:1234 |
| **超时设置** | 30秒 | 30秒 | 30秒 | 30秒 | 30秒 | 30秒 |

### 🎯 路由模式配置

#### 🟣 智能路由模式
**AI驱动的成本优化方案** - 专为 Claude Code 优化设计

使用小模型分析用户意图，智能选择最合适的模型，最大化节约成本：

##### 🎯 路由策略
考虑到 Claude Code 系统提示词 token 很多的特点，通过智能路由避免大材小用：

```
用户输入分析 → 意图识别 → 模型选择 → 成本优化
├─ "你好" → 简单对话 → 本地小模型 → 💰 节约90%成本
├─ "写一个函数" → 代码创建 → Qwen Coder → 🎯 专业能力
├─ "修改这个逻辑" → 代码优化 → Claude-4 → 🧠 高级推理
└─ "解释这段代码" → 代码理解 → 中等模型 → ⚖️ 平衡成本效果
```

##### ⚙️ 配置示例
```json
{
  "config_type": "smart_routing",
  "routing_models": ["qwen-plus"],  // 用于意图识别的小模型
  "scenes": [
    {
      "name": "简单对话",
      "description": "日常问候、简单问答",
      "models": ["ollama:qwen-7b", "qwen-plus"]
    },
    {
      "name": "代码创建", 
      "description": "编写新函数、创建项目",
      "models": ["qwen-coder", "claude-3-sonnet"]
    },
    {
      "name": "逻辑修改",
      "description": "修改复杂逻辑、重构代码", 
      "models": ["claude-4", "gpt-4o"]
    }
  ]
}
```

##### 💡 智能路由优势
- **成本节约**：简单任务不浪费昂贵模型资源
- **专业匹配**：代码任务路由到代码专业模型
- **自动降级**：主模型不可用时自动切换备用方案
- **学习优化**：可捕获并分析路由决策，持续优化

#### 🟢 全局直连模式
按优先级顺序使用模型，支持拖拽排序：

```json
{
  "config_type": "global_direct",
  "model_priority_list": [
    "claude-3-opus",
    "qwen-max", 
    "qwen-plus",
    "llama3.2"
  ]
}
```

> 💡 **提示**：所有配置都可在Web界面进行可视化管理

## 🔧 技术架构

### 🗂️ 核心组件

| 模块 | 文件 | 功能描述 |
|------|------|----------|
| **平台接入** | `platforms.py` | 多平台API客户端实现 |
| **智能路由** | `routing_system.py` | 意图识别和模型选择 |
| **格式转换** | `format_converter.py` | Claude⟷OpenAI格式互转 |
| **统一服务** | `multi_platform_service.py` | 整合所有组件的入口 |
| **数据存储** | `database.py` | 配置和会话数据管理 |
| **Web接口** | `main.py` | FastAPI路由和认证 |

### 🏗️ 系统架构

```
[客户端请求] → [认证中间件] → [路由选择] → [格式转换] → [平台API] → [响应转换] → [返回结果]
```

### 💾 技术栈
- **后端**：FastAPI + SQLAlchemy + httpx
- **前端**：HTML + Tailwind CSS + JavaScript + Dragula.js  
- **数据库**：SQLite
- **异步**：asyncio + async/await

### 📊 数据存储
系统使用SQLite存储以下数据：
- 平台配置（API Keys、服务地址）
- 模型配置（可用模型、优先级）
- 路由配置（工作模式、场景设置）
- 用户认证（密码哈希、会话token）
- API记录（调用历史、性能数据）


## 📊 API接口说明

### 🔐 认证相关
- `POST /login` - 用户登录
- `POST /logout` - 用户登出  
- `POST /change-password` - 修改密码

### ⚙️ 配置管理
- `GET/POST /api/platforms` - 平台配置管理
- `GET /api/models` + `POST /api/models/refresh` - 模型管理
- `GET/POST /api/routing` - 路由配置管理
- `GET /api/platforms/test` - 连接测试

### 📋 数据查询
- `GET /api/records` - API调用记录
- `GET /api/records/{id}` - 单条记录详情
- `POST /control/clear-records` - 清空记录

### 🚀 核心转发
- `POST /{path:path}` - 统一API转发入口



## 🔍 故障排除

### 🚨 常见问题解决

#### ❌ 看不到任何模型
**症状**：刷新模型列表后仍然为空

**解决步骤**：
1. 检查至少启用了一个平台 ✅
2. 验证API Key或本地服务配置 ✅  
3. 查看终端错误日志 ✅
4. 测试网络连接：`curl http://localhost:8000/api/models` ✅

#### 🔐 登录异常
**症状**：无法登录或登录后跳转异常

**解决方案**：
- 使用初始密码：`admin`
- 确保新密码至少6位
- 清除浏览器Cookie后重试
- 检查是否有多个窗口同时登录

#### 🌐 平台连接失败
**症状**：特定平台显示连接错误

**排查清单**：
- **网络问题**：检查互联网连接
- **服务状态**：确认本地服务已启动（Ollama/LMStudio）
- **配置错误**：验证API Key和服务地址
- **防火墙**：检查端口是否被阻止

#### 🐛 启动失败
**症状**：服务无法正常启动

**解决方案**：
```bash
# 1. 更新依赖
pip install -r requirements.txt

# 2. 检查端口占用
lsof -i :8000

# 3. 使用DEBUG模式启动
python3.11 start.py --debug
```

### 🔧 调试工具

#### 📊 日志解读
主要日志标识符：
- `🚀 [MultiPlatformService]` - 多平台服务
- `📞 [DashScope]` - 阿里云百炼
- `🐋 [Ollama]` - Ollama本地服务
- `🔐 [API]` - 认证相关

#### 🧪 快速验证
```bash
# 检查服务状态
curl http://localhost:8000/api/models

# 测试平台连接
curl http://localhost:8000/api/platforms/test

# 查看配置信息
curl http://localhost:8000/control/config
```

### 💡 调试技巧

#### 启用DEBUG模式
```bash
# 方法1：启动时启用
python3.11 start.py --debug

# 方法2：Web界面控制
配置 → 系统设置 → 开启DEBUG模式

# 方法3：浏览器控制台
localStorage.setItem('DEBUG_MODE', 'true');
```

#### 重置配置
如果配置错乱，可以：
1. 停止服务
2. 删除 `api_records.db` 文件
3. 重新启动服务
4. 重新配置平台

## 🛠️ 开发扩展

### 🔌 添加新平台
在 `platforms.py` 中继承 `PlatformClient` 基类：

```python
class NewPlatformClient(PlatformClient):
    async def get_models(self):
        # 实现获取模型列表
        pass
    
    async def chat_completion(self, model, messages, stream=False, **kwargs):
        # 实现聊天补全
        pass
```

### 🏢 企业级特性

#### 🔒 私有化部署优势
- **代码安全**：完全本地部署，避免代码泄露给 Qwen、Kimi 等外部服务
- **成本可控**：使用本地大模型（如30B Coder），无需按 token 付费
- **多用户管理**：支持为公司同事分配多个 KEY，统一管理
- **详细统计**：记录每个用户的使用情况，便于成本分析和管理

#### 🎯 典型企业应用
1. **软件公司**：开发团队使用本地 Coder 模型，保护代码机密
2. **金融机构**：严格的数据安全要求，完全私有化部署
3. **研发团队**：混合本地+云端模型，平衡安全与效果
4. **创业公司**：成本敏感，通过智能路由最大化节约 API 费用

### 🤝 贡献指南
欢迎提交Issue和Pull Request！
1. Fork项目
2. 创建特性分支  
3. 提交更改
4. 发起Pull Request

### 📄 许可协议
- **协议**：MIT License
- **用途**：仅供学习交流使用
- **免责**：请遵守相关法律法规