from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import json
import hashlib
import secrets

DATABASE_URL = "sqlite:///./api_records.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class APIRecord(Base):
    __tablename__ = "api_records"
    
    id = Column(Integer, primary_key=True, index=True)
    method = Column(String, index=True)
    path = Column(String, index=True)
    headers = Column(Text)
    body = Column(Text)
    response_status = Column(Integer)
    response_headers = Column(Text)
    response_body = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    duration_ms = Column(Integer)
    # 新增字段
    target_platform = Column(String, index=True)  # 目标平台
    target_model = Column(String, index=True)     # 目标模型
    platform_base_url = Column(String)           # 平台基础URL
    # HOOK处理数据字段
    processed_prompt = Column(Text)              # HOOK处理后发送给大模型的提示词
    processed_headers = Column(Text)             # HOOK处理后发送给大模型的请求头
    model_raw_headers = Column(Text)             # 大模型返回的原始响应头
    model_raw_response = Column(Text)            # 大模型返回的原始响应体(HOOK处理前)
    # 路由信息字段
    routing_scene = Column(String)               # 小模型路由模式下的场景名称
    # KEY关联字段
    user_key_id = Column(Integer, index=True)    # 关联的用户KEY ID
    # Token使用量字段
    input_tokens = Column(Integer, default=0)    # 输入token数量
    output_tokens = Column(Integer, default=0)   # 输出token数量
    total_tokens = Column(Integer, default=0)    # 总token数量

class PlatformConfig(Base):
    """平台配置表"""
    __tablename__ = "platform_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    platform_type = Column(String, unique=True, index=True)  # dashscope, openrouter, ollama, lmstudio
    api_key = Column(String)
    base_url = Column(String)
    enabled = Column(Boolean, default=True)
    timeout = Column(Integer, default=30)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ModelConfig(Base):
    """模型配置表"""
    __tablename__ = "model_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    platform_type = Column(String, index=True)
    model_id = Column(String, index=True)
    model_name = Column(String)
    enabled = Column(Boolean, default=True)
    priority = Column(Integer, default=0)  # 优先级，数字越小优先级越高
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class RoutingConfig(Base):
    """路由配置表"""
    __tablename__ = "routing_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    config_name = Column(String, unique=True, index=True)
    config_type = Column(String)  # 'global_direct' 或 'smart_routing'
    is_active = Column(Boolean, default=False)
    config_data = Column(Text)  # JSON格式存储具体配置
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class RoutingScene(Base):
    """路由场景表（用于小模型路由模式）"""
    __tablename__ = "routing_scenes"
    
    id = Column(Integer, primary_key=True, index=True)
    routing_config_id = Column(Integer, index=True)
    scene_name = Column(String)
    scene_description = Column(Text)
    models = Column(Text)  # JSON格式存储模型列表
    priority = Column(Integer, default=0)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class ClaudeCodeServer(Base):
    """Claude Code 服务器配置表"""
    __tablename__ = "claude_code_servers"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)  # 服务器名称
    url = Column(String)  # 服务器地址
    api_key = Column(String)  # API密钥
    timeout = Column(Integer, default=600)  # 超时时间，默认600秒
    priority = Column(Integer, default=0)  # 优先级，数字越小优先级越高
    enabled = Column(Boolean, default=True)  # 是否启用
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class SystemConfig(Base):
    """系统配置表"""
    __tablename__ = "system_configs"
    
    id = Column(Integer, primary_key=True, index=True)
    config_key = Column(String, unique=True, index=True)
    config_value = Column(Text)
    config_type = Column(String)  # 'string', 'boolean', 'integer', 'json'
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class UserAuth(Base):
    """用户认证表"""
    __tablename__ = "user_auth"
    
    id = Column(Integer, primary_key=True, index=True)
    password_hash = Column(String, nullable=False)
    salt = Column(String, nullable=False)
    is_first_login = Column(Boolean, default=True)
    last_login = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class LoginSession(Base):
    """登录会话表"""
    __tablename__ = "login_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    session_token = Column(String, unique=True, index=True)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

class UserKey(Base):
    """用户 KEY 管理表"""
    __tablename__ = "user_keys"
    
    id = Column(Integer, primary_key=True, index=True)
    key_name = Column(String, nullable=False)  # KEY 名称
    api_key = Column(String, unique=True, index=True, nullable=False)  # 生成的 API KEY
    max_tokens = Column(Integer, default=0)  # 最大 token 限制，0表示无限制
    used_tokens = Column(Integer, default=0)  # 已使用的 token 数量
    expires_at = Column(DateTime)  # 到期时间
    is_active = Column(Boolean, default=True)  # 是否激活
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class KeyUsageLog(Base):
    """KEY 使用记录表"""
    __tablename__ = "key_usage_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_key_id = Column(Integer, index=True)  # 关联的 user_key ID
    api_record_id = Column(Integer, index=True)  # 关联的 api_record ID
    model_name = Column(String, index=True)  # 使用的模型
    platform_type = Column(String, index=True)  # 平台类型
    input_tokens = Column(Integer, default=0)  # 输入 token 数量
    output_tokens = Column(Integer, default=0)  # 输出 token 数量
    total_tokens = Column(Integer, default=0)  # 总 token 数量
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)

# 创建所有表
Base.metadata.create_all(bind=engine)

# 初始化默认管理员密码
def init_default_admin():
    """初始化默认管理员密码"""
    db = SessionLocal()
    try:
        # 检查是否已有用户
        existing_user = db.query(UserAuth).first()
        if not existing_user:
            # 创建默认管理员用户，密码为 admin
            salt = secrets.token_hex(16)
            password_hash = hashlib.sha256(("admin" + salt).encode()).hexdigest()
            
            admin_user = UserAuth(
                password_hash=password_hash,
                salt=salt,
                is_first_login=True
            )
            db.add(admin_user)
            db.commit()
            print("✅ 已创建默认管理员用户，初始密码: admin")
    except Exception as e:
        print(f"❌ 初始化管理员用户失败: {e}")
        db.rollback()
    finally:
        db.close()

# 密码工具函数
def hash_password(password: str, salt: str = None) -> tuple:
    """哈希密码"""
    if salt is None:
        salt = secrets.token_hex(16)
    password_hash = hashlib.sha256((password + salt).encode()).hexdigest()
    return password_hash, salt

def verify_password(password: str, hash_value: str, salt: str) -> bool:
    """验证密码"""
    return hash_password(password, salt)[0] == hash_value

def generate_session_token() -> str:
    """生成会话令牌"""
    return secrets.token_urlsafe(32)

def generate_api_key() -> str:
    """生成 API KEY"""
    # 生成格式: lxs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (总长度36位)
    random_part = secrets.token_urlsafe(24)  # 生成32个字符的随机字符串
    return f"lxs_{random_part}"

# 在模块加载时初始化默认管理员
init_default_admin()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()