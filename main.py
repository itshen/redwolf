from fastapi import FastAPI, Request, Response, Depends, WebSocket, WebSocketDisconnect, HTTPException, Cookie
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import desc
import httpx
import json
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import asyncio
import logging

# 配置统一的日志系统
import os
DEBUG_MODE = os.getenv('DEBUG_MODE', 'false').lower() == 'true'

logging.basicConfig(
    level=logging.DEBUG if DEBUG_MODE else logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

def debug_print(*args, **kwargs):
    """统一的DEBUG输出函数，只在DEBUG_MODE启用时输出"""
    if DEBUG_MODE:
        print(*args, **kwargs)

from database import (
    get_db, APIRecord, PlatformConfig, ModelConfig, RoutingConfig, RoutingScene, SystemConfig,
    UserAuth, LoginSession, hash_password, verify_password, generate_session_token
)
from multi_platform_service import multi_platform_service

app = FastAPI(title="API Hook System")

# 静态文件服务
app.mount("/static", StaticFiles(directory="."), name="static")

# 默认配置
default_config = {
    "local_path": "api/v1/claude-code",
    "target_url": "https://dashscope.aliyuncs.com/api/v2/apps/claude-code-proxy",
    "use_multi_platform": True,  # 是否使用多平台转发
    "current_work_mode": "claude_code"  # 当前工作模式: claude_code, global_direct, smart_routing
}

# 全局配置（从数据库加载）
config_data = default_config.copy()

# 系统启动时间
system_start_time = time.time()

def load_system_config():
    """从数据库加载系统配置"""
    global config_data
    logger.info("🔄 [Config] 开始从数据库加载系统配置...")
    try:
        from sqlalchemy.orm import Session
        db = next(get_db())
        
        # 加载当前工作模式
        work_mode_config = db.query(SystemConfig).filter(
            SystemConfig.config_key == "current_work_mode"
        ).first()
        
        if work_mode_config:
            old_mode = config_data["current_work_mode"]
            config_data["current_work_mode"] = work_mode_config.config_value
            logger.info(f"📂 [Config] 从数据库加载工作模式: {old_mode} -> {work_mode_config.config_value}")
        else:
            # 如果数据库中没有配置，保存默认配置
            save_system_config("current_work_mode", config_data["current_work_mode"])
            logger.info(f"💾 [Config] 数据库无配置，保存默认工作模式: {config_data['current_work_mode']}")
            
        logger.info(f"✅ [Config] 配置加载完成，当前工作模式: {config_data['current_work_mode']}")
        db.close()
    except Exception as e:
        logger.error(f"⚠️ [Config] 加载系统配置失败，使用默认配置: {e}")

def save_system_config(key: str, value: str):
    """保存系统配置到数据库"""
    logger.info(f"💾 [Config] 开始保存系统配置: {key} = {value}")
    try:
        from sqlalchemy.orm import Session
        db = next(get_db())
        
        existing_config = db.query(SystemConfig).filter(
            SystemConfig.config_key == key
        ).first()
        
        if existing_config:
            old_value = existing_config.config_value
            existing_config.config_value = value
            existing_config.updated_at = datetime.utcnow()
            logger.info(f"🔄 [Config] 更新配置: {key} = {old_value} -> {value}")
        else:
            new_config = SystemConfig(
                config_key=key,
                config_value=value,
                config_type="string",
                description=f"系统配置: {key}"
            )
            db.add(new_config)
            logger.info(f"➕ [Config] 新增配置: {key} = {value}")
        
        db.commit()
        db.close()
        logger.info(f"✅ [Config] 系统配置已保存: {key} = {value}")
    except Exception as e:
        logger.error(f"❌ [Config] 保存系统配置失败: {e}")

# 在应用启动时加载配置
load_system_config()

# WebSocket连接管理
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_text(json.dumps(message))
            except:
                # 连接已断开，移除连接
                self.active_connections.remove(connection)

manager = ConnectionManager()

# 认证相关函数
def get_current_session(request: Request, db: Session = Depends(get_db)) -> Optional[LoginSession]:
    """获取当前会话"""
    session_token = request.cookies.get("session_token")
    if not session_token:
        return None
    
    session = db.query(LoginSession).filter(
        LoginSession.session_token == session_token,
        LoginSession.expires_at > datetime.utcnow()
    ).first()
    
    return session

def require_auth(request: Request, db: Session = Depends(get_db)):
    """需要认证的依赖"""
    session = get_current_session(request, db)
    if not session:
        raise HTTPException(status_code=401, detail="未登录或会话已过期")
    return session

def check_first_login(db: Session = Depends(get_db)) -> bool:
    """检查是否首次登录"""
    user = db.query(UserAuth).first()
    return user.is_first_login if user else True

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request, db: Session = Depends(get_db)):
    # 检查是否已登录
    session = get_current_session(request, db)
    if not session:
        return RedirectResponse(url="/login", status_code=302)
    
    # 检查是否首次登录，需要修改密码
    if check_first_login(db):
        return RedirectResponse(url="/change-password?first=true", status_code=302)
    
    with open("index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.get("/login", response_class=HTMLResponse)
async def login_page():
    """登录页面"""
    login_html = """
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>登录 - Claude Code Hook</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 min-h-screen flex items-center justify-center">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-8">
            <div class="text-center mb-8">
                <h1 class="text-2xl font-bold text-gray-900 mb-2">Claude Code Hook</h1>
                <p class="text-gray-600">请输入密码登录系统</p>
            </div>
            
            <form id="login-form" class="space-y-6">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">密码</label>
                    <input type="password" id="password" required 
                           class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                           placeholder="请输入密码">
                </div>
                
                <button type="submit" 
                        class="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md transition-colors">
                    登录
                </button>
            </form>
            
            <div id="error-message" class="mt-4 text-red-600 text-sm hidden"></div>
            
            <div class="mt-8 text-center text-sm text-gray-500">
                <p>首次登录默认密码: <code class="bg-gray-100 px-1 rounded">admin</code></p>
                <p>登录后将要求修改密码</p>
            </div>
        </div>
        
        <script>
            document.getElementById('login-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const password = document.getElementById('password').value;
                const errorDiv = document.getElementById('error-message');
                
                try {
                    const response = await fetch('/_api/login', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ password })
                    });
                    
                    const result = await response.json();
                    
                    if (response.ok) {
                        // 登录成功，跳转到主页
                        window.location.href = '/';
                    } else {
                        errorDiv.textContent = result.detail || '登录失败';
                        errorDiv.classList.remove('hidden');
                    }
                } catch (error) {
                    errorDiv.textContent = '网络错误，请重试';
                    errorDiv.classList.remove('hidden');
                }
            });
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=login_html)

@app.get("/change-password", response_class=HTMLResponse)
async def change_password_page(first: Optional[str] = None):
    """修改密码页面"""
    is_first = first == "true"
    title = "首次登录 - 修改密码" if is_first else "修改密码"
    description = "首次登录需要修改默认密码" if is_first else "请输入新密码"
    
    change_password_html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - Claude Code Hook</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen flex items-center justify-center">
    <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-8">
        <div class="text-center mb-8">
            <h1 class="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
            <p class="text-gray-600">{description}</p>
        </div>
        
        <form id="change-password-form" class="space-y-6">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">当前密码</label>
                <input type="password" id="current-password" required 
                       class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                       placeholder="请输入当前密码">
            </div>
            
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">新密码</label>
                <input type="password" id="new-password" required 
                       class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                       placeholder="请输入新密码（至少6位）" minlength="6">
            </div>
            
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">确认新密码</label>
                <input type="password" id="confirm-password" required 
                       class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                       placeholder="请再次输入新密码">
            </div>
            
            <button type="submit" 
                    class="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md transition-colors">
                修改密码
            </button>
        </form>
        
        <div id="error-message" class="mt-4 text-red-600 text-sm hidden"></div>
        <div id="success-message" class="mt-4 text-green-600 text-sm hidden"></div>
    </div>
    
    <script>
        document.getElementById('change-password-form').addEventListener('submit', async function(e) {{
            e.preventDefault();
            
            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            const errorDiv = document.getElementById('error-message');
            const successDiv = document.getElementById('success-message');
            
            errorDiv.classList.add('hidden');
            successDiv.classList.add('hidden');
            
            if (newPassword !== confirmPassword) {{
                errorDiv.textContent = '两次输入的密码不一致';
                errorDiv.classList.remove('hidden');
                return;
            }}
            
            if (newPassword.length < 6) {{
                errorDiv.textContent = '新密码至少需要6位';
                errorDiv.classList.remove('hidden');
                return;
            }}
            
            try {{
                const response = await fetch('/_api/change-password', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ 
                        current_password: currentPassword,
                        new_password: newPassword
                    }})
                }});
                
                const result = await response.json();
                
                if (response.ok) {{
                    successDiv.textContent = '密码修改成功，即将跳转到主页...';
                    successDiv.classList.remove('hidden');
                    setTimeout(function() {{ window.location.href = '/'; }}, 2000);
                }} else {{
                    errorDiv.textContent = result.detail || '修改密码失败';
                    errorDiv.classList.remove('hidden');
                }}
            }} catch (error) {{
                errorDiv.textContent = '网络错误，请重试';
                errorDiv.classList.remove('hidden');
            }}
        }});
    </script>
</body>
</html>"""
    return HTMLResponse(content=change_password_html)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # 处理来自前端的消息
            message = json.loads(data)
            if message.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# 认证API端点
@app.post("/_api/login")
async def login(request: Request, db: Session = Depends(get_db)):
    """用户登录"""
    data = await request.json()
    password = data.get("password")
    
    if not password:
        raise HTTPException(status_code=400, detail="密码不能为空")
    
    # 查找用户
    user = db.query(UserAuth).first()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    
    # 验证密码
    if not verify_password(password, user.password_hash, user.salt):
        raise HTTPException(status_code=401, detail="密码错误")
    
    # 创建会话
    session_token = generate_session_token()
    expires_at = datetime.utcnow() + timedelta(days=7)  # 7天有效期
    
    session = LoginSession(
        session_token=session_token,
        expires_at=expires_at
    )
    db.add(session)
    
    # 更新最后登录时间
    user.last_login = datetime.utcnow()
    db.commit()
    
    # 设置Cookie
    response = JSONResponse({"message": "登录成功"})
    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,  # 7天
        httponly=True,
        secure=False,  # 开发环境设为False，生产环境应设为True
        samesite="lax"
    )
    
    return response

@app.post("/_api/change-password")
async def change_password(request: Request, db: Session = Depends(get_db)):
    """修改密码"""
    data = await request.json()
    current_password = data.get("current_password")
    new_password = data.get("new_password")
    
    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="当前密码和新密码不能为空")
    
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少需要6位")
    
    # 查找用户
    user = db.query(UserAuth).first()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    
    # 验证当前密码
    if not verify_password(current_password, user.password_hash, user.salt):
        raise HTTPException(status_code=401, detail="当前密码错误")
    
    # 更新密码
    new_hash, new_salt = hash_password(new_password)
    user.password_hash = new_hash
    user.salt = new_salt
    user.is_first_login = False  # 标记已不是首次登录
    user.updated_at = datetime.utcnow()
    
    db.commit()
    
    return {"message": "密码修改成功"}

@app.post("/_api/logout")
async def logout(request: Request, db: Session = Depends(get_db)):
    """用户登出"""
    session_token = request.cookies.get("session_token")
    if session_token:
        # 删除会话记录
        db.query(LoginSession).filter(
            LoginSession.session_token == session_token
        ).delete()
        db.commit()
    
    response = JSONResponse({"message": "登出成功"})
    response.delete_cookie("session_token")
    return response

@app.get("/control/config")
async def get_config(session: LoginSession = Depends(require_auth)):
    logger.info(f"📋 [Config] 前端请求获取配置，当前工作模式: {config_data.get('current_work_mode')}")
    return config_data

@app.post("/control/config")
async def update_config(request: Request, session: LoginSession = Depends(require_auth)):
    global config_data
    new_config = await request.json()
    logger.info(f"🔄 [Config] 收到配置更新请求: {json.dumps(new_config, ensure_ascii=False)}")
    
    # 如果工作模式发生变化，持久化到数据库
    if "current_work_mode" in new_config and new_config["current_work_mode"] != config_data.get("current_work_mode"):
        old_mode = config_data.get("current_work_mode")
        save_system_config("current_work_mode", new_config["current_work_mode"])
        logger.info(f"🔄 [Config] 工作模式切换: {old_mode} -> {new_config['current_work_mode']}")
    
    config_data.update(new_config)
    await manager.broadcast({"type": "config_updated", "config": config_data})
    logger.info(f"✅ [Config] 配置更新完成并广播: {json.dumps(config_data, ensure_ascii=False)}")
    return {"message": "配置已更新", "config": config_data}

@app.post("/control/clear-records")
async def clear_records(session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    try:
        db.query(APIRecord).delete()
        db.commit()
        return {"message": "记录已清空"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"清空记录失败: {str(e)}"})

@app.get("/control/debug-status")
async def get_debug_status(session: LoginSession = Depends(require_auth)):
    """获取后端DEBUG模式状态"""
    return {"debug_mode": DEBUG_MODE}

# 多平台API端点
@app.get("/_api/platforms")
async def get_platforms(session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """获取所有平台配置"""
    platforms = db.query(PlatformConfig).all()
    return [
        {
            "id": platform.id,
            "platform_type": platform.platform_type,
            "api_key": platform.api_key or "",  # 不再隐藏，直接显示完整API Key
            "base_url": platform.base_url,
            "enabled": platform.enabled,
            "timeout": platform.timeout
        }
        for platform in platforms
    ]

@app.post("/_api/platforms")
async def create_or_update_platform(request: Request, session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """创建或更新平台配置"""
    try:
        data = await request.json()
        platform_type = data.get("platform_type")
        
        # 查找已存在的配置
        existing = db.query(PlatformConfig).filter(
            PlatformConfig.platform_type == platform_type
        ).first()
        
        if existing:
            # 更新现有配置
            if data.get("api_key"):
                existing.api_key = data["api_key"]
            if data.get("base_url"):
                existing.base_url = data["base_url"]
            if "enabled" in data:
                existing.enabled = data["enabled"]
            if data.get("timeout"):
                existing.timeout = data["timeout"]
        else:
            # 创建新配置
            new_platform = PlatformConfig(
                platform_type=platform_type,
                api_key=data.get("api_key", ""),
                base_url=data.get("base_url", ""),
                enabled=data.get("enabled", True),
                timeout=data.get("timeout", 30)
            )
            db.add(new_platform)
        
        db.commit()
        
        # 重新初始化多平台服务
        await multi_platform_service.initialize(db)
        
        return {"message": "平台配置已保存"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"保存平台配置失败: {str(e)}"})

@app.get("/_api/models")
async def get_models(session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """获取所有可用模型"""
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info("🔍 [API] 收到获取模型列表请求")
    try:
        models = await multi_platform_service.get_available_models(db)
        logger.info(f"✅ [API] 成功返回 {len(models)} 个模型")
        return models
    except Exception as e:
        logger.error(f"❌ [API] 获取模型列表失败: {e}")
        return JSONResponse(status_code=500, content={"error": f"获取模型列表失败: {str(e)}"})

@app.get("/_api/models/from-db")
async def get_models_from_db(session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """从数据库获取模型信息（用于配置恢复）"""
    try:
        model_configs = db.query(ModelConfig).filter(ModelConfig.enabled == True).all()
        
        models = []
        for config in model_configs:
            models.append({
                "id": config.model_id,
                "name": config.model_name or config.model_id,
                "platform": config.platform_type,
                "description": config.description or "",
                "enabled": config.enabled
            })
        
        return models
    except Exception as e:
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"获取数据库模型列表失败: {e}")
        return JSONResponse(status_code=500, content={"error": f"获取数据库模型列表失败: {str(e)}"})

@app.post("/_api/models/refresh")
async def refresh_models(request: Request, session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """刷新模型列表"""
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info("🔄 [API] 收到刷新模型列表请求")
    try:
        data = await request.json()
        platform_type = data.get("platform_type")
        logger.info(f"🎯 [API] 刷新平台: {platform_type if platform_type else '所有平台'}")
        
        await multi_platform_service.refresh_models(db, platform_type)
        logger.info("✅ [API] 模型列表刷新完成")
        return {"message": "模型列表已刷新"}
    except Exception as e:
        logger.error(f"❌ [API] 刷新模型列表失败: {e}")
        return JSONResponse(status_code=500, content={"error": f"刷新模型列表失败: {str(e)}"})

@app.get("/_api/platforms/test")
async def test_platform_connections(session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """测试平台连接"""
    try:
        results = await multi_platform_service.test_platform_connections(db)
        return results
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"测试连接失败: {str(e)}"})

@app.post("/_api/platforms/test-single")
async def test_single_platform(request: Request, session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """测试单个平台连接"""
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        data = await request.json()
        platform_type = data.get("platform_type")
        test_message = data.get("test_message", "你好")
        
        logger.info(f"🧪 [API] 测试单个平台: {platform_type}")
        
        if not platform_type:
            return JSONResponse(status_code=400, content={"error": "缺少platform_type参数"})
        
        # 重新初始化服务以加载最新配置
        await multi_platform_service.initialize(db)
        
        # 测试连接
        results = await multi_platform_service.test_platform_connections(db)
        platform_success = results.get(platform_type, False)
        
        if platform_success:
            # 如果连接成功，尝试发送测试消息
            try:
                # 这里可以进一步测试实际的API调用
                logger.info(f"✅ [API] {platform_type} 连接测试成功")
                return {"success": True, "message": f"{platform_type} 连接成功"}
            except Exception as test_error:
                logger.error(f"❌ [API] {platform_type} 测试消息发送失败: {test_error}")
                return {"success": False, "error": f"连接成功但测试消息失败: {str(test_error)}"}
        else:
            logger.error(f"❌ [API] {platform_type} 连接失败")
            return {"success": False, "error": f"{platform_type} 连接失败"}
            
    except Exception as e:
        logger.error(f"❌ [API] 测试单个平台出错: {e}")
        return JSONResponse(status_code=500, content={"error": f"测试失败: {str(e)}"})

@app.get("/_api/routing")
async def get_routing_config(session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """获取路由配置"""
    try:
        # 确保多平台服务已初始化
        if not multi_platform_service.initialized:
            await multi_platform_service.initialize(db)
        
        # 获取当前激活的配置
        active_config = db.query(RoutingConfig).filter(
            RoutingConfig.is_active == True
        ).first()
        
        # 获取所有配置类型
        all_configs = db.query(RoutingConfig).all()
        configs_by_type = {}
        
        for config in all_configs:
            config_data = {}
            if config.config_data:
                try:
                    config_data = json.loads(config.config_data)
                except json.JSONDecodeError:
                    continue
            
            # 如果是智能路由配置，从RoutingScene表中获取最新的场景配置
            if config.config_type == "smart_routing":
                scenes = db.query(RoutingScene).filter(
                    RoutingScene.routing_config_id == config.id
                ).order_by(RoutingScene.priority).all()
                
                scene_list = []
                for scene in scenes:
                    try:
                        models = json.loads(scene.models) if scene.models else []
                        scene_data = {
                            "name": scene.scene_name,
                            "description": scene.scene_description,
                            "models": models,
                            "enabled": scene.enabled,
                            "priority": scene.priority
                        }
                        # 标记默认场景
                        if scene.scene_name == "默认对话":
                            scene_data["is_default"] = True
                        scene_list.append(scene_data)
                    except json.JSONDecodeError:
                        continue
                
                config_data["scenes"] = scene_list
            
            configs_by_type[config.config_type] = {
                "id": config.id,
                "name": config.config_name,
                "type": config.config_type,
                "data": config_data,
                "is_active": config.is_active
            }
        
        # 使用主配置系统的工作模式，而不是路由管理器的模式
        current_mode = config_data.get("current_work_mode", "claude_code")
        logger.info(f"📋 [Config] 路由配置API返回当前工作模式: {current_mode}")
        
        return {
            "current_mode": current_mode,
            "active_config": configs_by_type.get(active_config.config_type) if active_config else None,
            "all_configs": configs_by_type
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"获取路由配置失败: {str(e)}"})

@app.post("/_api/routing")
async def update_routing_config(request: Request, session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """更新路由配置"""
    try:
        data = await request.json()
        config_name = data.get("config_name")
        config_type = data.get("config_type")
        config_data = data.get("config_data", {})
        
        # 查找现有配置
        existing = db.query(RoutingConfig).filter(
            RoutingConfig.config_name == config_name
        ).first()
        
        # 只有在保存成功后才将其他配置设为非激活状态
        
        if existing:
            existing.config_type = config_type
            existing.config_data = json.dumps(config_data)
            existing.is_active = True
            config_id = existing.id
        else:
            new_config = RoutingConfig(
                config_name=config_name,
                config_type=config_type,
                config_data=json.dumps(config_data),
                is_active=True
            )
            db.add(new_config)
            db.flush()  # 获取生成的ID
            config_id = new_config.id
        
        # 如果是智能路由配置，保存场景到数据库
        if config_type == "smart_routing" and "scenes" in config_data:
            print(f"🔧 [Backend] 开始处理智能路由场景配置，config_id: {config_id}")
            
            # 删除现有场景
            deleted_count = db.query(RoutingScene).filter(
                RoutingScene.routing_config_id == config_id
            ).delete()
            print(f"🗑️ [Backend] 删除了 {deleted_count} 个现有场景")
            
            # 添加默认场景（如果不存在）
            scenes = config_data.get("scenes", [])
            print(f"📋 [Backend] 收到 {len(scenes)} 个场景配置")
            default_scene_exists = any(scene.get("name") == "默认对话" and scene.get("is_default") for scene in scenes)
            print(f"🔍 [Backend] 默认场景是否存在: {default_scene_exists}")
            
            if not default_scene_exists:
                # 在列表开头插入默认场景
                default_scene = {
                    "name": "默认对话",
                    "description": "当系统无法识别具体场景时使用的默认对话模式",
                    "models": ["qwen-plus"],
                    "enabled": True,
                    "priority": 0,
                    "is_default": True
                }
                scenes.insert(0, default_scene)
                # 调整其他场景的优先级
                for i, scene in enumerate(scenes[1:], 1):
                    scene["priority"] = i
                # 更新config_data
                config_data["scenes"] = scenes
                if existing:
                    existing.config_data = json.dumps(config_data)
                else:
                    new_config.config_data = json.dumps(config_data)
            
            # 保存场景到RoutingScene表
            print(f"💾 [Backend] 开始保存 {len(scenes)} 个场景到数据库")
            for i, scene in enumerate(scenes):
                scene_record = RoutingScene(
                    routing_config_id=config_id,
                    scene_name=scene["name"],
                    scene_description=scene["description"],
                    models=json.dumps(scene["models"]),
                    priority=scene.get("priority", 0),
                    enabled=scene.get("enabled", True)
                )
                db.add(scene_record)
                print(f"✅ [Backend] 添加场景 {i+1}: {scene['name']}")
        else:
            print(f"⏭️ [Backend] 跳过场景保存，config_type: {config_type}, has_scenes: {'scenes' in config_data if config_data else False}")
        
        # 先提交当前配置的更改
        db.commit()
        
        # 成功保存后，将其他配置设为非激活状态
        db.query(RoutingConfig).filter(
            RoutingConfig.id != config_id
        ).update({"is_active": False})
        db.commit()
        
        # 重新初始化多平台服务
        await multi_platform_service.initialize(db)
        
        return {"message": "路由配置已保存"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"保存路由配置失败: {str(e)}"})

@app.get("/_api/records")
async def get_records(limit: int = 100, session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    records = db.query(APIRecord).order_by(desc(APIRecord.timestamp)).limit(limit).all()
    return [
        {
            "id": record.id,
            "method": record.method,
            "path": record.path,
            "timestamp": record.timestamp.isoformat(),
            "response_status": record.response_status,
            "duration_ms": record.duration_ms,
            "user_key_id": record.user_key_id,
            "target_platform": record.target_platform,
            "target_model": record.target_model,
            "token_usage": {
                "input_tokens": record.input_tokens or 0,
                "output_tokens": record.output_tokens or 0,
                "total_tokens": record.total_tokens or 0
            } if (record.input_tokens or 0) + (record.output_tokens or 0) > 0 else None
        }
        for record in records
    ]

@app.get("/_api/records/{record_id}")
async def get_record_detail(record_id: int, session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    from database import UserKey
    
    record = db.query(APIRecord).filter(APIRecord.id == record_id).first()
    if not record:
        return JSONResponse(status_code=404, content={"message": "记录未找到"})
    
    # 获取Token使用量（优先使用数据库字段，fallback到解析）
    if record.input_tokens is not None or record.output_tokens is not None or record.total_tokens is not None:
        token_info = {
            "input_tokens": record.input_tokens or 0,
            "output_tokens": record.output_tokens or 0,
            "total_tokens": record.total_tokens or 0
        }
    else:
        # 如果数据库字段为空，回退到解析response_body
        token_info = parse_token_usage(record.response_body)
    
    # 获取关联的KEY信息
    key_info = None
    if record.user_key_id:
        user_key = db.query(UserKey).filter(UserKey.id == record.user_key_id).first()
        if user_key:
            key_info = {
                "id": user_key.id,
                "key_name": user_key.key_name,
                "api_key": user_key.api_key[-8:] + "..." if len(user_key.api_key) > 8 else user_key.api_key  # 只显示后8位
            }
    
    return {
        "id": record.id,
        "method": record.method,
        "path": record.path,
        "headers": json.loads(record.headers) if record.headers else {},
        "body": record.body,
        "response_status": record.response_status,
        "response_headers": json.loads(record.response_headers) if record.response_headers else {},
        "response_body": record.response_body,
        "timestamp": record.timestamp.isoformat(),
        "duration_ms": record.duration_ms,
        "target_platform": record.target_platform,
        "target_model": record.target_model,
        "platform_base_url": record.platform_base_url,
        "processed_prompt": record.processed_prompt,
        "processed_headers": record.processed_headers,
        "model_raw_headers": record.model_raw_headers,
        "model_raw_response": record.model_raw_response,
        "routing_scene": record.routing_scene,
        "user_key_id": record.user_key_id,
        "key_info": key_info,
        "token_usage": token_info
    }

# ==================== KEY 管理 API ====================

@app.get("/_api/keys")
async def get_user_keys(session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """获取所有用户 KEY"""
    from database import UserKey
    
    keys = db.query(UserKey).order_by(UserKey.created_at.desc()).all()
    return [
        {
            "id": key.id,
            "key_name": key.key_name,
            "api_key": key.api_key,
            "max_tokens": key.max_tokens,
            "used_tokens": key.used_tokens,
            "expires_at": key.expires_at.isoformat() if key.expires_at else None,
            "is_active": key.is_active,
            "created_at": key.created_at.isoformat(),
            "updated_at": key.updated_at.isoformat()
        }
        for key in keys
    ]

@app.post("/_api/keys")
async def create_user_key(request: Request, session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """创建新的用户 KEY"""
    from database import UserKey, generate_api_key
    from datetime import datetime, timedelta
    
    try:
        data = await request.json()
        key_name = data.get("key_name", "").strip()
        max_tokens = data.get("max_tokens", 0)
        expires_at_str = data.get("expires_at")  # 直接接收绝对时间
        
        if not key_name:
            return JSONResponse(status_code=400, content={"error": "KEY 名称不能为空"})
        
        # 检查名称是否重复
        existing_key = db.query(UserKey).filter(UserKey.key_name == key_name).first()
        if existing_key:
            return JSONResponse(status_code=400, content={"error": "KEY 名称已存在"})
        
        # 生成新的 API KEY
        api_key = generate_api_key()
        
        # 处理到期时间
        expires_at = None
        if expires_at_str:
            try:
                expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                # 转换为UTC时间
                if expires_at.tzinfo is not None:
                    expires_at = expires_at.utctimetuple()
                    expires_at = datetime(*expires_at[:6])
                else:
                    # 假设是本地时间，转换为UTC
                    expires_at = expires_at
            except ValueError:
                return JSONResponse(status_code=400, content={"error": "无效的到期时间格式"})
        
        # 创建新 KEY
        new_key = UserKey(
            key_name=key_name,
            api_key=api_key,
            max_tokens=max_tokens,
            expires_at=expires_at
        )
        
        db.add(new_key)
        db.commit()
        db.refresh(new_key)
        
        return {
            "id": new_key.id,
            "key_name": new_key.key_name,
            "api_key": new_key.api_key,
            "max_tokens": new_key.max_tokens,
            "used_tokens": new_key.used_tokens,
            "expires_at": new_key.expires_at.isoformat() if new_key.expires_at else None,
            "is_active": new_key.is_active,
            "created_at": new_key.created_at.isoformat(),
            "updated_at": new_key.updated_at.isoformat()
        }
        
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"创建 KEY 失败: {str(e)}"})

@app.put("/_api/keys/{key_id}")
async def update_user_key(key_id: int, request: Request, session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """更新用户 KEY"""
    from database import UserKey
    from datetime import datetime, timedelta
    
    try:
        key = db.query(UserKey).filter(UserKey.id == key_id).first()
        if not key:
            return JSONResponse(status_code=404, content={"error": "KEY 不存在"})
        
        data = await request.json()
        
        # 更新字段
        if "key_name" in data:
            key_name = data["key_name"].strip()
            if not key_name:
                return JSONResponse(status_code=400, content={"error": "KEY 名称不能为空"})
            # 检查名称是否重复（排除自己）
            existing_key = db.query(UserKey).filter(UserKey.key_name == key_name, UserKey.id != key_id).first()
            if existing_key:
                return JSONResponse(status_code=400, content={"error": "KEY 名称已存在"})
            key.key_name = key_name
        
        if "max_tokens" in data:
            key.max_tokens = data["max_tokens"]
        
        if "expires_at" in data:
            expires_at_str = data["expires_at"]
            if expires_at_str:
                try:
                    expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                    # 转换为UTC时间
                    if expires_at.tzinfo is not None:
                        expires_at = expires_at.utctimetuple()
                        expires_at = datetime(*expires_at[:6])
                    key.expires_at = expires_at
                except ValueError:
                    return JSONResponse(status_code=400, content={"error": "无效的到期时间格式"})
            else:
                key.expires_at = None
        
        if "is_active" in data:
            key.is_active = data["is_active"]
        
        key.updated_at = datetime.utcnow()
        db.commit()
        
        return {
            "id": key.id,
            "key_name": key.key_name,
            "api_key": key.api_key,
            "max_tokens": key.max_tokens,
            "used_tokens": key.used_tokens,
            "expires_at": key.expires_at.isoformat() if key.expires_at else None,
            "is_active": key.is_active,
            "created_at": key.created_at.isoformat(),
            "updated_at": key.updated_at.isoformat()
        }
        
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"更新 KEY 失败: {str(e)}"})

@app.delete("/_api/keys/{key_id}")
async def delete_user_key(key_id: int, session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """删除用户 KEY"""
    from database import UserKey, KeyUsageLog
    
    try:
        key = db.query(UserKey).filter(UserKey.id == key_id).first()
        if not key:
            return JSONResponse(status_code=404, content={"error": "KEY 不存在"})
        
        # 同时删除相关的使用记录
        db.query(KeyUsageLog).filter(KeyUsageLog.user_key_id == key_id).delete()
        
        # 删除 KEY
        db.delete(key)
        db.commit()
        
        return {"message": "KEY 删除成功"}
        
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"删除 KEY 失败: {str(e)}"})

@app.get("/_api/keys/{key_id}/statistics")
async def get_key_statistics(
    key_id: int, 
    start_date: str = None, 
    end_date: str = None,
    session: LoginSession = Depends(require_auth), 
    db: Session = Depends(get_db)
):
    """获取 KEY 使用统计"""
    from database import UserKey, KeyUsageLog
    from datetime import datetime, timedelta
    from sqlalchemy import func
    
    try:
        key = db.query(UserKey).filter(UserKey.id == key_id).first()
        if not key:
            return JSONResponse(status_code=404, content={"error": "KEY 不存在"})
        
        # 解析时间范围
        try:
            if start_date:
                # 处理ISO格式的时间字符串
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                # 转换为UTC时间（去掉时区信息）
                if start_dt.tzinfo is not None:
                    start_dt = start_dt.replace(tzinfo=None)
            else:
                start_dt = datetime.utcnow() - timedelta(days=30)  # 默认30天
                
            if end_date:
                # 处理ISO格式的时间字符串
                end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                # 转换为UTC时间（去掉时区信息）
                if end_dt.tzinfo is not None:
                    end_dt = end_dt.replace(tzinfo=None)
            else:
                end_dt = datetime.utcnow()
                
        except ValueError as date_error:
            return JSONResponse(status_code=400, content={"error": f"日期格式错误: {str(date_error)}"})
        
        # 基础查询
        query = db.query(KeyUsageLog).filter(
            KeyUsageLog.user_key_id == key_id,
            KeyUsageLog.timestamp >= start_dt,
            KeyUsageLog.timestamp <= end_dt
        )
        
        # 总统计
        total_calls = query.count()
        total_tokens = query.with_entities(func.sum(KeyUsageLog.total_tokens)).scalar() or 0
        total_input_tokens = query.with_entities(func.sum(KeyUsageLog.input_tokens)).scalar() or 0
        total_output_tokens = query.with_entities(func.sum(KeyUsageLog.output_tokens)).scalar() or 0
        
        # 按模型统计
        model_stats = db.query(
            KeyUsageLog.model_name,
            func.count(KeyUsageLog.id).label('call_count'),
            func.sum(KeyUsageLog.total_tokens).label('total_tokens'),
            func.sum(KeyUsageLog.input_tokens).label('input_tokens'),
            func.sum(KeyUsageLog.output_tokens).label('output_tokens')
        ).filter(
            KeyUsageLog.user_key_id == key_id,
            KeyUsageLog.timestamp >= start_dt,
            KeyUsageLog.timestamp <= end_dt
        ).group_by(KeyUsageLog.model_name).all()
        
        # 按平台统计
        platform_stats = db.query(
            KeyUsageLog.platform_type,
            func.count(KeyUsageLog.id).label('call_count'),
            func.sum(KeyUsageLog.total_tokens).label('total_tokens')
        ).filter(
            KeyUsageLog.user_key_id == key_id,
            KeyUsageLog.timestamp >= start_dt,
            KeyUsageLog.timestamp <= end_dt
        ).group_by(KeyUsageLog.platform_type).all()
        
        # 按日期统计（最近7天）
        daily_stats = db.query(
            func.date(KeyUsageLog.timestamp).label('date'),
            func.count(KeyUsageLog.id).label('call_count'),
            func.sum(KeyUsageLog.total_tokens).label('total_tokens')
        ).filter(
            KeyUsageLog.user_key_id == key_id,
            KeyUsageLog.timestamp >= datetime.utcnow() - timedelta(days=7)
        ).group_by(func.date(KeyUsageLog.timestamp)).order_by(func.date(KeyUsageLog.timestamp)).all()
        
        return {
            "key_info": {
                "id": key.id,
                "key_name": key.key_name,
                "max_tokens": key.max_tokens,
                "used_tokens": key.used_tokens
            },
            "period": {
                "start_date": start_dt.isoformat(),
                "end_date": end_dt.isoformat()
            },
            "summary": {
                "total_calls": total_calls,
                "total_tokens": total_tokens,
                "total_input_tokens": total_input_tokens,
                "total_output_tokens": total_output_tokens
            },
            "by_model": [
                {
                    "model_name": stat.model_name,
                    "call_count": stat.call_count,
                    "total_tokens": stat.total_tokens or 0,
                    "input_tokens": stat.input_tokens or 0,
                    "output_tokens": stat.output_tokens or 0
                }
                for stat in model_stats
            ],
            "by_platform": [
                {
                    "platform_type": stat.platform_type,
                    "call_count": stat.call_count,
                    "total_tokens": stat.total_tokens or 0
                }
                for stat in platform_stats
            ],
            "daily_usage": [
                {
                    "date": stat.date.isoformat() if hasattr(stat.date, 'isoformat') else str(stat.date),
                    "call_count": stat.call_count,
                    "total_tokens": stat.total_tokens or 0
                }
                for stat in daily_stats
            ]
        }
        
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"获取统计数据失败: {str(e)}"})

@app.get("/_api/keys/statistics/overview")
async def get_all_keys_statistics(
    start_date: str = None, 
    end_date: str = None,
    session: LoginSession = Depends(require_auth), 
    db: Session = Depends(get_db)
):
    """获取所有 KEY 的概览统计"""
    from database import UserKey, KeyUsageLog
    from datetime import datetime, timedelta
    from sqlalchemy import func
    
    try:
        # 解析时间范围
        try:
            if start_date:
                # 处理ISO格式的时间字符串
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                # 转换为UTC时间（去掉时区信息）
                if start_dt.tzinfo is not None:
                    start_dt = start_dt.replace(tzinfo=None)
            else:
                start_dt = datetime.utcnow() - timedelta(days=30)  # 默认30天
                
            if end_date:
                # 处理ISO格式的时间字符串
                end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                # 转换为UTC时间（去掉时区信息）
                if end_dt.tzinfo is not None:
                    end_dt = end_dt.replace(tzinfo=None)
            else:
                end_dt = datetime.utcnow()
                
        except ValueError as date_error:
            return JSONResponse(status_code=400, content={"error": f"日期格式错误: {str(date_error)}"})
        
        # 获取所有 KEY 的使用统计
        key_stats = db.query(
            UserKey.id,
            UserKey.key_name,
            UserKey.max_tokens,
            UserKey.used_tokens,
            UserKey.is_active,
            func.count(KeyUsageLog.id).label('call_count'),
            func.sum(KeyUsageLog.total_tokens).label('period_tokens'),
            func.sum(KeyUsageLog.input_tokens).label('period_input_tokens'),
            func.sum(KeyUsageLog.output_tokens).label('period_output_tokens')
        ).outerjoin(
            KeyUsageLog, 
            (UserKey.id == KeyUsageLog.user_key_id) & 
            (KeyUsageLog.timestamp >= start_dt) & 
            (KeyUsageLog.timestamp <= end_dt)
        ).group_by(UserKey.id).order_by(UserKey.created_at.desc()).all()
        
        return {
            "period": {
                "start_date": start_dt.isoformat(),
                "end_date": end_dt.isoformat()
            },
            "keys": [
                {
                    "id": stat.id,
                    "key_name": stat.key_name,
                    "max_tokens": stat.max_tokens,
                    "used_tokens": stat.used_tokens,
                    "is_active": stat.is_active,
                    "period_stats": {
                        "call_count": stat.call_count or 0,
                        "total_tokens": stat.period_tokens or 0,
                        "input_tokens": stat.period_input_tokens or 0,
                        "output_tokens": stat.period_output_tokens or 0
                    }
                }
                for stat in key_stats
            ]
        }
        
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"获取概览统计失败: {str(e)}"})

@app.post("/_api/keys/{key_id}/reset")
async def reset_key_usage(key_id: int, session: LoginSession = Depends(require_auth), db: Session = Depends(get_db)):
    """清零用户 KEY 的使用量"""
    from database import UserKey, KeyUsageLog
    from datetime import datetime
    
    try:
        key = db.query(UserKey).filter(UserKey.id == key_id).first()
        if not key:
            return JSONResponse(status_code=404, content={"error": "KEY 不存在"})
        
        # 清零使用量
        key.used_tokens = 0
        key.updated_at = datetime.utcnow()
        
        # 删除相关的使用记录
        db.query(KeyUsageLog).filter(KeyUsageLog.user_key_id == key_id).delete()
        
        db.commit()
        
        return {"message": "KEY 使用量已清零"}
        
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"清零失败: {str(e)}"})

async def save_api_record(
    method: str,
    path: str,
    headers: Dict[str, Any],
    body: str,
    response_status: int,
    response_headers: Dict[str, Any],
    response_body: str,
    duration_ms: int,
    db: Session,
    target_platform: Optional[str] = None,
    target_model: Optional[str] = None,
    routing_info: Optional[str] = None,
    platform_base_url: Optional[str] = None,
    processed_prompt: Optional[str] = None,
    processed_headers: Optional[str] = None,
    model_raw_headers: Optional[str] = None,
    model_raw_response: Optional[str] = None,
    routing_scene: Optional[str] = None,
    user_key_id: Optional[int] = None,
    token_usage: Optional[Dict[str, int]] = None
):
    """保存API调用记录"""
    # 如果有夺舍信息，添加到path中显示
    enhanced_path = path
    if target_platform or target_model:
        route_info = f" → {target_platform}:{target_model}" if target_platform and target_model else f" → {target_platform or target_model}"
        enhanced_path = f"{path}{route_info}"
        # 如果同时有routing_info（包含emoji），则添加到末尾
        if routing_info:
            enhanced_path = f"{enhanced_path} ({routing_info})"
    elif routing_info:
        enhanced_path = f"{path} ({routing_info})"
    
    # 保持响应体的原始格式，不添加前缀（避免破坏JSON解析）
    enhanced_response_body = response_body
    
    # 路由信息将显示在路径中，不修改响应体
    
    # 解析token使用量（优先使用传入的token_usage）
    if token_usage is None:
        token_usage = parse_token_usage(response_body)
    
    api_record = APIRecord(
        method=method,
        path=enhanced_path,
        headers=json.dumps(dict(headers)),
        body=body,
        response_status=response_status,
        response_headers=json.dumps(dict(response_headers)),
        response_body=enhanced_response_body,
        duration_ms=duration_ms,
        target_platform=target_platform,
        target_model=target_model,
        platform_base_url=platform_base_url,
        processed_prompt=processed_prompt,
        processed_headers=processed_headers,
        model_raw_headers=model_raw_headers,
        model_raw_response=model_raw_response,
        routing_scene=routing_scene,
        user_key_id=user_key_id,
        input_tokens=token_usage["input_tokens"],
        output_tokens=token_usage["output_tokens"],
        total_tokens=token_usage["total_tokens"]
    )
    db.add(api_record)
    db.commit()
    db.refresh(api_record)
    
    # 如果有用户KEY，记录token使用量并更新KEY的统计
    if user_key_id and target_model and response_status < 400:
        print(f"🔑 [KEY统计] 开始记录KEY使用：KEY_ID={user_key_id}, 模型={target_model}, 状态={response_status}")
        print(f"🔑 [KEY统计] Token信息：{token_usage}")
        await save_key_usage_log(
            db=db,
            user_key_id=user_key_id,
            api_record_id=api_record.id,
            model_name=target_model,
            platform_type=target_platform,
            response_body=response_body,
            token_usage=token_usage
        )
    else:
        if not user_key_id:
            print(f"🔑 [KEY统计] 跳过：无user_key_id")
        elif not target_model:
            print(f"🔑 [KEY统计] 跳过：无target_model")
        elif response_status >= 400:
            print(f"🔑 [KEY统计] 跳过：响应错误status={response_status}")
    
    # 发送实时更新到前端
    await manager.broadcast({
        "type": "new_record",
        "record": {
            "id": api_record.id,
            "method": method,
            "path": enhanced_path,  # 使用增强后的路径，显示夺舍信息
            "timestamp": api_record.timestamp.isoformat(),
            "response_status": response_status,
            "duration_ms": duration_ms,
            "token_usage": token_usage if token_usage["total_tokens"] > 0 else None
        }
    })
    
    return api_record


def parse_token_usage(response_body: str) -> dict:
    """解析响应体中的Token使用量"""
    if not response_body:
        return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    
    try:
        response_data = json.loads(response_body)
        
        # 支持不同格式的token统计
        if "usage" in response_data:
            usage = response_data["usage"]
            # Claude格式
            if "input_tokens" in usage and "output_tokens" in usage:
                input_tokens = usage.get("input_tokens", 0)
                output_tokens = usage.get("output_tokens", 0)
            # OpenRouter/OpenAI格式
            elif "prompt_tokens" in usage and "completion_tokens" in usage:
                input_tokens = usage.get("prompt_tokens", 0)
                output_tokens = usage.get("completion_tokens", 0)
            else:
                input_tokens = 0
                output_tokens = 0
            
            total_tokens = usage.get("total_tokens", input_tokens + output_tokens)
            
            return {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens
            }
        
        # Ollama格式直接在根级别
        elif "prompt_eval_count" in response_data and "eval_count" in response_data:
            input_tokens = response_data.get("prompt_eval_count", 0)
            output_tokens = response_data.get("eval_count", 0)
            total_tokens = input_tokens + output_tokens
            
            return {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens
            }
            
    except json.JSONDecodeError:
        # 如果解析失败，尝试从流式响应中提取最后的usage信息
        pass
    
    return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}


async def save_key_usage_log(
    db: Session,
    user_key_id: int,
    api_record_id: int,
    model_name: str,
    platform_type: str,
    response_body: str,
    token_usage: Optional[Dict[str, int]] = None
):
    """保存KEY使用记录并更新KEY统计"""
    from database import UserKey, KeyUsageLog
    from datetime import datetime
    import json
    
    try:
        # 优先使用传入的token_usage，如果没有则从响应体解析
        if token_usage:
            input_tokens = token_usage.get("input_tokens", 0)
            output_tokens = token_usage.get("output_tokens", 0)
            total_tokens = token_usage.get("total_tokens", 0)
        else:
            # 从响应体中提取token使用量
            input_tokens = 0
            output_tokens = 0
            total_tokens = 0
            
            if response_body:
                try:
                    response_data = json.loads(response_body)
                    
                    # 支持不同格式的token统计
                    if "usage" in response_data:
                        usage = response_data["usage"]
                        # Claude格式
                        if "input_tokens" in usage and "output_tokens" in usage:
                            input_tokens = usage.get("input_tokens", 0)
                            output_tokens = usage.get("output_tokens", 0)
                        # OpenRouter/OpenAI格式
                        elif "prompt_tokens" in usage and "completion_tokens" in usage:
                            input_tokens = usage.get("prompt_tokens", 0)
                            output_tokens = usage.get("completion_tokens", 0)
                        
                        total_tokens = usage.get("total_tokens", input_tokens + output_tokens)
                    
                    # Ollama格式直接在根级别
                    elif "prompt_eval_count" in response_data and "eval_count" in response_data:
                        input_tokens = response_data.get("prompt_eval_count", 0)
                        output_tokens = response_data.get("eval_count", 0)
                        total_tokens = input_tokens + output_tokens
                        
                except json.JSONDecodeError:
                    # 如果解析失败，尝试从流式响应中提取
                    pass
        
        # 创建使用记录
        usage_log = KeyUsageLog(
            user_key_id=user_key_id,
            api_record_id=api_record_id,
            model_name=model_name,
            platform_type=platform_type or "unknown",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens
        )
        
        db.add(usage_log)
        
        # 更新KEY的使用统计
        if total_tokens > 0:
            user_key = db.query(UserKey).filter(UserKey.id == user_key_id).first()
            if user_key:
                old_used_tokens = user_key.used_tokens
                user_key.used_tokens += total_tokens
                user_key.updated_at = datetime.utcnow()
                print(f"✅ [KEY统计] KEY ID {user_key_id} 更新：{old_used_tokens} → {user_key.used_tokens} (+{total_tokens})")
            else:
                print(f"❌ [KEY统计] 未找到KEY ID {user_key_id}")
        else:
            print(f"⚠️ [KEY统计] token数量为0，不更新KEY统计。input_tokens={input_tokens}, output_tokens={output_tokens}")
        
        print(f"📝 [KEY统计] 保存使用记录：KEY={user_key_id}, 模型={model_name}, tokens={total_tokens}")
        db.commit()
        
    except Exception as e:
        print(f"❌ [KEY统计] 保存KEY使用记录失败: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()


async def validate_user_key(api_key: str, db: Session) -> Optional[int]:
    """验证用户KEY并检查限制，返回KEY ID，如果验证失败返回None"""
    from database import UserKey
    from datetime import datetime
    
    if not api_key or not api_key.startswith('lxs_'):
        return None
    
    try:
        # 查找KEY
        user_key = db.query(UserKey).filter(
            UserKey.api_key == api_key,
            UserKey.is_active == True
        ).first()
        
        if not user_key:
            return None
        
        # 检查是否过期
        if user_key.expires_at and user_key.expires_at < datetime.utcnow():
            return None
        
        # 检查token限制
        if user_key.max_tokens > 0 and user_key.used_tokens >= user_key.max_tokens:
            return None
        
        return user_key.id
        
    except Exception as e:
        print(f"验证KEY失败: {e}")
        return None


@app.get("/about")
async def about_luoxiaoshan():
    """洛小山介绍页面 - 包含详细系统调试信息"""
    try:
        import psutil
        import os
        import sys
        import socket
        
        # 获取详细系统信息
        uptime_seconds = int(time.time() - system_start_time)
        uptime_str = f"{uptime_seconds // 3600}h {(uptime_seconds % 3600) // 60}m {uptime_seconds % 60}s"
        
        # 系统资源信息
        process = psutil.Process()
        cpu_percent = psutil.cpu_percent(interval=0.1)
        memory_usage_mb = round(process.memory_info().rss / 1024 / 1024, 2)
        memory_percent = round(process.memory_percent(), 2)
        
        # 网络信息
        hostname = socket.gethostname()
        try:
            local_ip = socket.gethostbyname(hostname)
        except:
            local_ip = "localhost"
        
        # 数据库统计
        db_stats = {"error": "无法获取"}
        platform_info = {}
        api_stats = {}
        
        try:
            from database import get_db, APIRecord, PlatformConfig, ModelConfig
            db = next(get_db())
            
            # 数据库统计
            api_records_count = db.query(APIRecord).count()
            platform_configs_count = db.query(PlatformConfig).count()
            model_configs_count = db.query(ModelConfig).count()
            
            db_stats = {
                "api_records": api_records_count,
                "platform_configs": platform_configs_count,
                "model_configs": model_configs_count,
                "status": "✅ 连接正常"
            }
            
            # 平台配置信息
            platforms = db.query(PlatformConfig).all()
            for platform in platforms:
                # 从ModelConfig表中获取该平台的模型数量
                models_count = db.query(ModelConfig).filter(
                    ModelConfig.platform_type == platform.platform_type,
                    ModelConfig.enabled == True
                ).count()
                
                # 判断是否需要API密钥
                local_platforms = ['lmstudio', 'ollama']
                platform_type_lower = platform.platform_type.lower()
                
                if platform_type_lower in local_platforms:
                    api_key_status = "🏠 无需密钥"
                else:
                    api_key_status = "✅ 已配置" if platform.api_key else "❌ 未配置"
                
                platform_info[platform.platform_type] = {
                    "enabled": "✅ 启用" if platform.enabled else "❌ 禁用",
                    "models_count": models_count,
                    "has_api_key": api_key_status,
                    "base_url": platform.base_url or "默认"
                }
            
            # 今日API统计
            from sqlalchemy import func
            today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            
            today_calls = db.query(APIRecord).filter(APIRecord.timestamp >= today_start).count()
            success_calls = db.query(APIRecord).filter(
                APIRecord.timestamp >= today_start,
                APIRecord.response_status < 400
            ).count()
            
            recent_records = db.query(APIRecord).order_by(APIRecord.timestamp.desc()).limit(3).all()
            
            api_stats = {
                "today_calls": today_calls,
                "success_calls": success_calls,
                "error_calls": today_calls - success_calls,
                "success_rate": f"{round(success_calls / today_calls * 100, 1)}%" if today_calls > 0 else "0%",
                "last_call": recent_records[0].timestamp.strftime('%H:%M:%S') if recent_records else "无"
            }
            
            db.close()
            
        except Exception as e:
            db_stats["error"] = str(e)[:50] + "..."
        
        ascii_art = """
    ██╗     ██╗   ██╗ ██████╗ ██╗  ██╗██╗ █████╗  ██████╗ ███████╗██╗  ██╗ █████╗ ███╗   ██╗
    ██║     ██║   ██║██╔═══██╗╚██╗██╔╝██║██╔══██╗██╔═══██╗██╔════╝██║  ██║██╔══██╗████╗  ██║
    ██║     ██║   ██║██║   ██║ ╚███╔╝ ██║███████║██║   ██║███████╗███████║███████║██╔██╗ ██║
    ██║     ██║   ██║██║   ██║ ██╔██╗ ██║██╔══██║██║   ██║╚════██║██╔══██║██╔══██║██║╚██╗██║
    ███████╗╚██████╔╝╚██████╔╝██╔╝ ██╗██║██║  ██║╚██████╔╝███████║██║  ██║██║  ██║██║ ╚████║
    ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝
        """
        
        about_content = f"""{ascii_art}
    
    👋 嗨，我是洛小山
    白天是个爱折腾的 AI 产品经理，晚上是个快乐的小开发~
    
    🎯 关于这个工具
    这是我根据用户需求开发的智能API Hook和多平台转发系统，希望能帮你省下宝贵的时间！
    
    ✨ 系统特性：
    • 🔄 智能多平台API转发        • 📊 实时请求监控和统计
    • 🎛️ 灵活的路由配置系统        • 🔐 安全的认证和授权
    • 📈 详细的调用记录和分析      • 🚀 高性能异步处理
    
    🚀 更多好玩的
    我还在捣鼓更多有趣的 AI 小工具，会在公众号【洛小山】和大家分享：
    
    • 各种实用的 AI 工具          • 有趣的技术教程  
    • AI 技术到产品的实践        • AI 产品拆解
    
    💡 期待你的想法
    在日常工作或生活中，有没有觉得"要是有个 AI 工具能帮我做这个就好了"？
    欢迎扫码和我聊聊，说不定你的小需求就能变成下一个实用工具！
    
    🐛 遇到问题？
    开发不易，难免有 bug ~ 如果你发现了什么问题，欢迎来和我说说，
    我会及时修复的！你的反馈就是对我最好的支持 😊
    
    🏠 联系方式
    • 个人网站: luoxiaoshan.cn
    • 微信公众号: 洛小山
    • GitHub项目: https://github.com/itshen/redwolf
    
    感谢使用！如果觉得好用，记得给个⭐️哦~
    
    ════════════════════════════════════════════════════════════════════════════════════════
    
    🔧 **详细系统调试信息**
    
    📋 **基础状态**
    • 工作模式: {config_data.get('current_work_mode', 'unknown')}
    • 多平台转发: {'✅ 已启用' if config_data.get('use_multi_platform', False) else '❌ 未启用'}
    • WebSocket连接: {len(manager.active_connections)} 个活跃连接
    • 系统运行时间: {uptime_str}
    • 当前时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
    
    💻 **系统资源**
    • CPU使用率: {cpu_percent}%
    • 内存使用: {memory_usage_mb}MB ({memory_percent}%)
    • 进程ID: {os.getpid()}
    • Python版本: {sys.version.split()[0]}
    • 线程数: {process.num_threads()}
    • 打开文件数: {len(process.open_files())}
    
    🌐 **网络信息**
    • 主机名: {hostname}
    • 本地IP: {local_ip}
    • 服务端口: 8000
    • 服务地址: http://{local_ip}:8000
    • 工作目录: {os.getcwd()}
    
    💾 **数据库状态**
    • 连接状态: {db_stats.get('status', db_stats.get('error', '未知'))}
    • API记录数: {db_stats.get('api_records', 'N/A')}
    • 平台配置数: {db_stats.get('platform_configs', 'N/A')}
    • 模型配置数: {db_stats.get('model_configs', 'N/A')}
    
    🔌 **平台配置详情**"""
        
        if platform_info:
            for platform_type, info in platform_info.items():
                about_content += f"""
    • {platform_type.upper()}:
      - 状态: {info['enabled']}
      - 模型数量: {info['models_count']}
      - API密钥: {info['has_api_key']}
      - 基础URL: {info['base_url']}"""
        else:
            about_content += "\n    • 暂无平台配置或无法获取配置信息"
        
        about_content += f"""
    
    📊 **今日API统计**
    • 总调用次数: {api_stats.get('today_calls', 'N/A')}
    • 成功调用: {api_stats.get('success_calls', 'N/A')}
    • 错误调用: {api_stats.get('error_calls', 'N/A')}
    • 成功率: {api_stats.get('success_rate', 'N/A')}
    • 最后调用: {api_stats.get('last_call', 'N/A')}
    
    ⚙️ **配置参数**
    • 本地路径: {config_data.get('local_path', 'N/A')}
    • 目标URL: {config_data.get('target_url', 'N/A')}
    • 所有配置键: {', '.join(config_data.keys())}
    

    """
        
        return Response(
            content=about_content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Type": "text/plain; charset=utf-8"}
        )
        
    except Exception as e:
        import traceback
        error_content = f"""
    ⚠️ 系统信息获取失败
    
    错误信息: {str(e)}
    
    📋 基础信息:
    • 作者: 洛小山 (luoxiaoshan.cn)
    • 微信公众号: 洛小山
    • 时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
    
    🐛 调试信息:
    {traceback.format_exc()}
    """
        
        return Response(
            content=error_content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Type": "text/plain; charset=utf-8"}
        )

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy_request(request: Request, path: str, db: Session = Depends(get_db)):
    """代理所有请求到目标API"""
    
    # 如果是我们内部的控制接口，不进行代理，让FastAPI路由系统处理
    internal_paths = ["control/", "_api/", "ws", "about"]
    if any(path.startswith(internal_path) for internal_path in internal_paths):
        # 让FastAPI的其他路由处理器接管
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not Found")
    
    start_time = time.time()
    
    # 🎯 通用夺舍过程开始 - 记录所有通过系统的API
    logger.info("🎯 [夺舍] ============ 开始API夺舍过程 ============")
    logger.info(f"📥 [夺舍] 收到请求: {request.method} {request.url}")
    logger.info(f"🌐 [夺舍] 请求路径: /{path}")
    logger.info(f"📋 [夺舍] 请求头数量: {len(request.headers)}")
    
    # 获取请求体信息（用于日志）
    try:
        body = await request.body()
        body_str = body.decode('utf-8') if body else ""
        body_size = len(body_str)
        logger.info(f"📊 [夺舍] 请求体大小: {body_size} 字符")
        
        # 如果是JSON请求，解析一些基本信息
        if body_str and request.headers.get("content-type", "").startswith("application/json"):
            try:
                request_data = json.loads(body_str)
                if "model" in request_data:
                    logger.info(f"🤖 [夺舍] 请求模型: {request_data.get('model')}")
                if "messages" in request_data:
                    logger.info(f"💬 [夺舍] 消息数量: {len(request_data.get('messages', []))}")
                if "stream" in request_data:
                    logger.info(f"🌊 [夺舍] 流式响应: {'是' if request_data.get('stream') else '否'}")
            except:
                logger.info("📄 [夺舍] 请求体: JSON格式但解析失败")
    except:
        body_str = ""
        logger.info("📄 [夺舍] 无法读取请求体")
    
    # 显示当前工作模式
    current_mode = config_data.get("current_work_mode", "unknown")
    use_multi_platform = config_data.get("use_multi_platform", False)
    
    logger.info(f"⚙️ [夺舍] 当前工作模式: {current_mode}")
    logger.info(f"🔄 [夺舍] 多平台转发: {'启用' if use_multi_platform else '禁用'}")
    
    # KEY验证逻辑 - 只对多平台模式下的全局直连和小模型路由进行KEY验证
    user_key_id = None
    if use_multi_platform and current_mode in ["global_direct", "smart_routing"]:
        # 从Authorization头或api-key头中获取KEY
        auth_header = request.headers.get("authorization", "")
        api_key_header = request.headers.get("api-key", "")
        
        api_key = ""
        if auth_header.startswith("Bearer "):
            api_key = auth_header[7:]  # 移除 "Bearer " 前缀
        elif api_key_header:
            api_key = api_key_header
        
        if api_key:
            logger.info(f"🔑 [夺舍] 检测到用户KEY: {api_key[:8]}****")
            user_key_id = await validate_user_key(api_key, db)
            
            if user_key_id is None:
                logger.warning(f"❌ [夺舍] KEY验证失败: {api_key[:8]}****")
                # 返回401错误
                error_response = {
                    "error": {
                        "type": "authentication_error",
                        "message": "Invalid API key or key has expired/exceeded limits"
                    }
                }
                return JSONResponse(status_code=401, content=error_response)
            else:
                logger.info(f"✅ [夺舍] KEY验证成功，KEY ID: {user_key_id}")
        else:
            logger.warning("🔑 [夺舍] 多平台模式下未提供KEY，将拒绝请求")
            error_response = {
                "error": {
                    "type": "authentication_error", 
                    "message": "API key required for this mode"
                }
            }
            return JSONResponse(status_code=401, content=error_response)
    
    # 选择处理模式
    if use_multi_platform:
        logger.info("🎯 [夺舍] 选择处理方式: 多平台智能转发")
        return await handle_multi_platform_request(request, path, db, start_time, body_str, user_key_id)
    else:
        logger.info("🎯 [夺舍] 选择处理方式: 原始代理转发")
        return await handle_original_proxy_request(request, path, db, start_time, body_str)

async def handle_multi_platform_request(request: Request, path: str, db: Session, start_time: float, body_str: str = "", user_key_id: Optional[int] = None):
    """处理多平台转发请求"""
    try:
        logger.info("🚀 [夺舍] 开始多平台智能转发处理...")
        
        # 解析请求数据（假设是Claude API格式）
        if body_str and request.method == "POST":
            try:
                request_data = json.loads(body_str)
                
                messages = request_data.get("messages", [])
                model = request_data.get("model", "")
                stream = request_data.get("stream", False)
                
                # 显示简化的消息内容（用于调试）
                if messages:
                    last_msg = messages[-1] if messages else {}
                    content_preview = str(last_msg.get('content', ''))[:100] + "..." if len(str(last_msg.get('content', ''))) > 100 else str(last_msg.get('content', ''))
                    logger.info(f"💭 [夺舍] 最后消息预览: {content_preview}")
                
                logger.info("🔄 [夺舍] 开始多平台智能路由处理...")
                
                # 使用多平台服务处理请求
                if stream:
                    # 流式响应
                    streaming_converter = None  # 保存StreamingConverter实例的引用
                    sse_chunks = []  # 收集原始SSE数据
                    
                    async def generate_response():
                        nonlocal streaming_converter, sse_chunks
                        try:
                            async for chunk in multi_platform_service.handle_request(
                                messages=messages,
                                model=model,
                                stream=stream,
                                db=db,
                                original_request=request_data,
                                **{k: v for k, v in request_data.items() if k not in ["messages", "model", "stream"]}
                            ):
                                # 获取streaming_converter的引用（第一次调用时）
                                if streaming_converter is None and hasattr(multi_platform_service, 'streaming_converter'):
                                    streaming_converter = multi_platform_service.streaming_converter
                                
                                # chunk已经是完整的SSE格式，直接输出
                                if chunk.strip():  # 只有非空内容才输出
                                    # 收集原始SSE数据用于数据库记录
                                    sse_chunks.append(chunk.strip())
                                    yield chunk
                        finally:
                            # 流式响应结束后保存记录
                            if sse_chunks:
                                try:
                                    # 将所有SSE chunks合并为完整的SSE格式数据
                                    sse_data = "\n".join(sse_chunks)
                                    
                                    # 获取路由信息
                                    routing_result = getattr(multi_platform_service, 'last_routing_result', None)
                                    target_platform = None
                                    target_model = None
                                    platform_info = None
                                    routing_mode = multi_platform_service.get_current_routing_mode()
                                    
                                    if routing_result and routing_result.success:
                                        target_platform = routing_result.platform_type.value
                                        target_model = routing_result.model_id
                                        platform_info = multi_platform_service.get_platform_info(routing_result.platform_type)
                                    
                                    # 确定路由标识符
                                    mode_emoji = "🔄"  # 默认多平台转发
                                    if routing_mode == "global_direct":
                                        mode_emoji = "🔄"  # 多平台转发
                                    elif routing_mode == "smart_routing":
                                        mode_emoji = "🆎"  # 小模型分发
                                    
                                    end_time = time.time()
                                    duration_ms = int((end_time - start_time) * 1000)
                                    
                                    # 获取token使用量
                                    token_usage = multi_platform_service.get_token_usage()
                                    
                                    await save_api_record(
                                        method=request.method,
                                        path=f"/{path}",
                                        headers=dict(request.headers),
                                        body=body_str,
                                        response_status=200,
                                        response_headers={"Content-Type": "text/event-stream"},
                                        response_body=sse_data,
                                        duration_ms=duration_ms,
                                        db=db,
                                        target_platform=target_platform,
                                        target_model=target_model,
                                        routing_info=f"{mode_emoji} 流式响应",
                                        platform_base_url=platform_info.get("base_url") if platform_info else None,
                                        processed_prompt=getattr(multi_platform_service, 'processed_prompt', None),
                                        processed_headers=getattr(multi_platform_service, 'processed_headers', None),
                                        model_raw_headers=getattr(multi_platform_service, 'model_raw_headers', None),
                                        model_raw_response=getattr(multi_platform_service, 'model_raw_response', None),
                                        routing_scene=routing_result.scene_name if routing_result and hasattr(routing_result, 'scene_name') else None,
                                        user_key_id=user_key_id,
                                        token_usage=token_usage
                                    )
                                    
                                    # 从SSE数据中提取实际内容长度用于日志
                                    content_length = 0
                                    if streaming_converter and hasattr(streaming_converter, 'current_content'):
                                        content_length = len(streaming_converter.current_content)
                                    
                                    logger.info(f"✅ [夺舍] 流式响应记录已保存，平台: {target_platform}, 模型: {target_model}, SSE数据长度: {len(sse_data)} 字符")
                                except Exception as e:
                                    logger.error(f"❌ [夺舍] 保存流式响应记录失败: {e}")
                            else:
                                logger.warning(f"⚠️ [夺舍] 流式响应完成但没有收集到SSE数据")
                    
                    headers = {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive"
                    }
                    
                    return StreamingResponse(generate_response(), headers=headers)
                else:
                    # 非流式响应
                    response_text = ""
                    async for chunk in multi_platform_service.handle_request(
                        messages=messages,
                        model=model,
                        stream=stream,
                        db=db,
                        original_request=request_data,
                        **{k: v for k, v in request_data.items() if k not in ["messages", "model", "stream"]}
                    ):
                        response_text = chunk
                        break
                    
                    # 保存记录
                    end_time = time.time()
                    duration_ms = int((end_time - start_time) * 1000)
                    
                    # 获取路由信息
                    routing_result = getattr(multi_platform_service, 'last_routing_result', None)
                    target_platform = None
                    target_model = None
                    platform_info = None
                    routing_mode = multi_platform_service.get_current_routing_mode()
                    
                    if routing_result and routing_result.success:
                        target_platform = routing_result.platform_type.value
                        target_model = routing_result.model_id
                        platform_info = multi_platform_service.get_platform_info(routing_result.platform_type)
                    
                    # 确定路由标识符
                    mode_emoji = "🔄"  # 默认多平台转发
                    if routing_mode == "global_direct":
                        mode_emoji = "🔄"  # 多平台转发
                    elif routing_mode == "smart_routing":
                        mode_emoji = "🆎"  # 小模型分发
                    
                    # 获取token使用量
                    token_usage = multi_platform_service.get_token_usage()
                    
                    await save_api_record(
                        method=request.method,
                        path=f"/{path}",
                        headers=dict(request.headers),
                        body=body_str,
                        response_status=200,
                        response_headers={"Content-Type": "application/json"},
                        response_body=response_text,
                        duration_ms=duration_ms,
                        db=db,
                        target_platform=target_platform,
                        target_model=target_model,
                        routing_info=f"{mode_emoji} 非流式响应",
                        platform_base_url=platform_info.get("base_url") if platform_info else None,
                        processed_prompt=getattr(multi_platform_service, 'processed_prompt', None),
                        processed_headers=getattr(multi_platform_service, 'processed_headers', None),
                        model_raw_headers=getattr(multi_platform_service, 'model_raw_headers', None),
                        model_raw_response=getattr(multi_platform_service, 'model_raw_response', None),
                        routing_scene=routing_result.scene_name if routing_result and hasattr(routing_result, 'scene_name') else None,
                        user_key_id=user_key_id,
                        token_usage=token_usage
                    )
                    
                    return Response(
                        content=response_text,
                        media_type="application/json"
                    )
                    
            except json.JSONDecodeError:
                return JSONResponse(
                    status_code=400,
                    content={"error": "Invalid JSON in request body"}
                )
        else:
            return JSONResponse(
                status_code=400,
                content={"error": "Only POST requests with JSON body are supported in multi-platform mode"}
            )
            
    except Exception as e:
        end_time = time.time()
        duration_ms = int((end_time - start_time) * 1000)
        
        await save_api_record(
            method=request.method,
            path=f"/{path}",
            headers=dict(request.headers),
            body=body_str if 'body_str' in locals() else "",
            response_status=500,
            response_headers={},
            response_body=f"Multi-platform error: {str(e)}",
            duration_ms=duration_ms,
            db=db,
            routing_info="❌ 多平台转发失败",
            user_key_id=user_key_id if 'user_key_id' in locals() else None
        )
        
        return JSONResponse(
            status_code=500,
            content={"error": f"多平台转发失败: {str(e)}"}
        )

async def handle_original_proxy_request(request: Request, path: str, db: Session, start_time: float, body_str: str = ""):
    """处理原有的代理请求逻辑"""
    logger.info("🎯 [夺舍] 开始原始代理转发处理...")
    # 构建目标URL - 使用配置中的映射
    local_path = config_data["local_path"]
    target_base = config_data["target_url"]
    
    if path.startswith(local_path):
        # 自定义映射
        remaining_path = path[len(local_path):]  # 获取剩余路径
        target_url = f"{target_base}{remaining_path}"
    else:
        # 默认保持完整路径映射
        target_url = f"https://dashscope.aliyuncs.com/{path}"
    
    # 获取请求数据
    headers = dict(request.headers)
    # 只移除真正的hop-by-hop headers，保留所有认证和业务相关headers
    hop_by_hop_headers = ['connection', 'keep-alive', 'te', 'trailers', 'transfer-encoding', 'upgrade']
    headers = {k: v for k, v in headers.items() if k.lower() not in hop_by_hop_headers}
    
    # 移除host header，让httpx自动设置正确的目标host
    headers.pop('host', None)
    
    # 请求体已在上层函数中获取
    body = body_str.encode('utf-8') if body_str else b""
    
    logger.info(f"🎯 [夺舍] 目标URL: {target_url}")
    logger.info(f"🔄 [夺舍] 转发模式: {'自定义映射' if path.startswith(local_path) else '完整路径映射'}")
    
    try:
        # 发送请求到目标服务器
        async with httpx.AsyncClient(timeout=30.0, verify=True) as client:
            response = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
                params=request.query_params,
                follow_redirects=True
            )
            
        end_time = time.time()
        duration_ms = int((end_time - start_time) * 1000)
        
        # 记录转发成功信息
        logger.info(f"✅ [夺舍] 转发成功! 状态码: {response.status_code}, 耗时: {duration_ms}ms")
        logger.info(f"📤 [夺舍] 响应大小: {len(response.text)} 字符")
        logger.info("🎯 [夺舍] ============ 夺舍过程完成 ============")
        
        # 始终保存记录
        await save_api_record(
            method=request.method,
            path=f"/{path}",
            headers=headers,
            body=body_str,
            response_status=response.status_code,
            response_headers=dict(response.headers),
            response_body=response.text,
            duration_ms=duration_ms,
            db=db,
            target_platform="DashScope",
            target_model="claude-code-proxy",
            routing_info="❇️ Claude Code",
            platform_base_url="https://dashscope.aliyuncs.com"
        )
        
        # 返回响应，只移除真正会导致冲突的响应头
        response_headers = dict(response.headers)
        # 只移除可能导致FastAPI冲突的hop-by-hop响应头
        response_headers_to_remove = ['connection', 'transfer-encoding']
        response_headers = {k: v for k, v in response_headers.items() if k.lower() not in response_headers_to_remove}
        
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=response_headers
        )
        
    except Exception as e:
        end_time = time.time()
        duration_ms = int((end_time - start_time) * 1000)
        
        # 记录转发失败信息
        logger.error(f"❌ [夺舍] 转发失败! 错误: {str(e)}, 耗时: {duration_ms}ms")
        logger.error("🎯 [夺舍] ============ 夺舍过程失败 ============")
        
        # 始终保存错误记录
        await save_api_record(
            method=request.method,
            path=f"/{path}",
            headers=headers,
            body=body_str,
            response_status=500,
            response_headers={},
            response_body=f"Error: {str(e)}",
            duration_ms=duration_ms,
            db=db,
            routing_info="❌ 原始代理模式失败"
        )
        
        return JSONResponse(
            status_code=500,
            content={"error": f"代理请求失败: {str(e)}"}
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)