#!/bin/bash

# 设置颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 显示启动横幅
echo -e "${BLUE}"
echo "====================================================="
echo "             红狼 Claude Code 夺舍平台"
echo "====================================================="
echo -e "${NC}"

# 检查是否在正确的目录
if [ ! -f "main.py" ]; then
    echo -e "${RED}❌ 错误：请在项目根目录运行此脚本${NC}"
    echo -e "${YELLOW}当前目录：$(pwd)${NC}"
    exit 1
fi

# 检查Python3是否安装
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ 错误：未找到python3，请先安装Python 3.7+${NC}"
    echo -e "${YELLOW}Ubuntu/Debian: sudo apt install python3 python3-pip${NC}"
    echo -e "${YELLOW}CentOS/RHEL: sudo yum install python3 python3-pip${NC}"
    echo -e "${YELLOW}macOS: brew install python3${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Python环境检查通过${NC}"
echo

# 检查pip3是否安装
if ! command -v pip3 &> /dev/null; then
    echo -e "${RED}❌ 错误：未找到pip3${NC}"
    echo -e "${YELLOW}请安装pip3或使用python3 -m pip${NC}"
    exit 1
fi

# 安装依赖
echo -e "${BLUE}📦 正在安装/更新依赖包...${NC}"
python3 -m pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 依赖安装失败，请检查网络连接${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 依赖包安装完成${NC}"
echo

# 设置权限（如果需要）
chmod +x "$0" 2>/dev/null

# 启动服务
echo -e "${BLUE}🚀 正在启动红狼 Claude Code 夺舍平台...${NC}"
echo
echo -e "${GREEN}🌐 服务地址: http://127.0.0.1:8000${NC}"
echo -e "${YELLOW}📱 请在浏览器中打开上述地址访问管理界面${NC}"
echo
echo -e "${BLUE}💡 提示：${NC}"
echo -e "${YELLOW}   - 首次使用请先配置KEY和转发模式${NC}"
echo -e "${YELLOW}   - 按 Ctrl+C 可停止服务${NC}"
echo -e "${YELLOW}   - 如有问题请公众号搜索\"洛小山\"获取支持${NC}"
echo
echo "====================================================="
echo

# 捕获Ctrl+C信号
trap 'echo -e "\n${YELLOW}👋 服务已停止，感谢使用！${NC}"; exit 0' INT

# 启动服务器
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

echo -e "${YELLOW}👋 服务已停止，感谢使用！${NC}"