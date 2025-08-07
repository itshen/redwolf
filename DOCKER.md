# Docker 部署指南

## 🐳 快速开始

### 前置要求
- Docker 20.10+ 
- Docker Compose 2.0+

### 一键启动
```bash
# 克隆项目
git clone <your-repo-url>
cd redwolf

# 执行 Docker 启动脚本
./docker-start.sh
```

## 📋 手动部署步骤

### 1. 构建镜像
```bash
docker-compose build
```

### 2. 启动服务
```bash
# 后台运行
docker-compose up -d

# 前台运行（查看日志）
docker-compose up
```

### 3. 访问服务
- **API 地址**: http://localhost:8000
- **健康检查**: http://localhost:8000/health （如果有的话）

## 🛠️ 管理命令

### 查看服务状态
```bash
docker-compose ps
```

### 查看日志
```bash
# 查看所有日志
docker-compose logs

# 查看实时日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f redwolf
```

### 重启服务
```bash
# 重启所有服务
docker-compose restart

# 重启特定服务
docker-compose restart redwolf
```

### 停止服务
```bash
# 停止服务（保留容器）
docker-compose stop

# 停止并删除容器
docker-compose down

# 停止并删除容器和网络
docker-compose down --volumes
```

### 进入容器
```bash
# 进入运行中的容器
docker-compose exec redwolf bash

# 如果容器没有 bash，使用 sh
docker-compose exec redwolf sh
```

## ⚙️ 配置说明

### 环境变量
在 `docker-compose.yml` 中可以配置以下环境变量：

```yaml
environment:
  - DEBUG_MODE=false          # 调试模式开关
  - PORT=8000                 # 服务端口（可选）
  - HOST=0.0.0.0             # 监听地址（可选）
```

### 数据持久化
项目默认挂载以下目录：
- `./data:/app/data` - 数据文件存储
- `./config:/app/config` - 配置文件存储

### 端口映射
- **8000:8000** - API 服务端口

## 🔧 自定义配置

### 修改端口
如果需要修改端口，编辑 `docker-compose.yml`：
```yaml
ports:
  - "9000:8000"  # 将本地 9000 端口映射到容器 8000 端口
```

### 添加数据库服务
取消注释 `docker-compose.yml` 中的数据库配置：
```yaml
# 取消这些行的注释
database:
  image: postgres:15-alpine
  # ... 其他配置
```

### 生产环境配置
创建 `docker-compose.prod.yml` 用于生产环境：
```yaml
version: '3.8'
services:
  redwolf:
    environment:
      - DEBUG_MODE=false
    restart: always
    # 添加其他生产环境配置
```

使用生产配置启动：
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## 🚨 故障排查

### 常见问题

1. **端口被占用**
   ```bash
   # 查看端口占用
   lsof -i :8000
   
   # 修改 docker-compose.yml 中的端口映射
   ports:
     - "8001:8000"
   ```

2. **权限问题**
   ```bash
   # 确保数据目录权限正确
   chmod -R 755 data config
   ```

3. **镜像构建失败**
   ```bash
   # 清理缓存重新构建
   docker-compose build --no-cache
   ```

4. **容器无法启动**
   ```bash
   # 查看详细错误信息
   docker-compose logs redwolf
   ```

### 清理环境
```bash
# 停止并删除所有容器、网络
docker-compose down

# 删除镜像
docker rmi redwolf_redwolf

# 清理未使用的 Docker 资源
docker system prune
```

## 📊 监控和日志

### 健康检查
Docker Compose 配置包含健康检查，可以通过以下方式查看：
```bash
docker-compose ps
```

### 日志配置
可以在 `docker-compose.yml` 中添加日志配置：
```yaml
services:
  redwolf:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## 🔐 安全建议

1. **生产环境**：
   - 使用 secrets 管理敏感信息
   - 启用 SSL/TLS
   - 配置防火墙规则

2. **网络安全**：
   - 不要暴露不必要的端口
   - 使用内部网络通信

3. **数据安全**：
   - 定期备份数据卷
   - 设置适当的文件权限