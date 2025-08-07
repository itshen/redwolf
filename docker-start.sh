#!/bin/bash
# Docker 部署启动脚本

echo "🐳 RedWolf API 监控系统 - Docker 部署"
echo "================================="

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose 未安装，请先安装 Docker Compose"
    exit 1
fi

# 创建必要的目录
echo "📁 创建数据目录..."
mkdir -p data config

# 构建并启动服务
echo "🔨 构建 Docker 镜像..."
docker-compose build

echo "🚀 启动服务..."
docker-compose up -d

echo ""
echo "✅ 服务启动成功！"
echo "📊 访问地址: http://localhost:8000"
echo "🔍 查看日志: docker-compose logs -f"
echo "⏹️  停止服务: docker-compose down"
echo ""
echo "常用命令："
echo "  查看容器状态: docker-compose ps"
echo "  重启服务:     docker-compose restart"
echo "  查看实时日志: docker-compose logs -f redwolf"
echo "  进入容器:     docker-compose exec redwolf bash"