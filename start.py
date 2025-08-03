#!/usr/bin/env python3
"""
API Hook 监控系统启动脚本
"""

import subprocess
import sys
import os
import argparse

def install_dependencies():
    """安装依赖包"""
    print("正在安装Python依赖包...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"])
        print("✅ 依赖包安装完成")
    except subprocess.CalledProcessError as e:
        print(f"❌ 依赖包安装失败: {e}")
        sys.exit(1)

def start_server(debug=False):
    """启动服务器"""
    print("正在启动API Hook监控系统...")
    print("服务地址: http://127.0.0.1:8000")
    if debug:
        print("🐛 DEBUG模式已启用 - 将显示详细调试信息")
        os.environ['DEBUG_MODE'] = 'true'
    else:
        print("📊 正常模式 - 仅显示关键信息（使用 --debug 启用调试模式）")
        os.environ['DEBUG_MODE'] = 'false'
    print("按 Ctrl+C 停止服务")
    print("-" * 50)
    
    try:
        subprocess.run([sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000", "--reload"])
    except KeyboardInterrupt:
        print("\n服务已停止")

if __name__ == "__main__":
    # 解析命令行参数
    parser = argparse.ArgumentParser(description='API Hook 监控系统启动脚本')
    parser.add_argument('--debug', action='store_true', 
                       help='启用DEBUG模式，显示详细调试信息')
    parser.add_argument('--skip-install', action='store_true',
                       help='跳过依赖安装，直接启动服务')
    args = parser.parse_args()
    
    # 检查是否在正确的目录
    if not os.path.exists("main.py"):
        print("❌ 请在项目根目录运行此脚本")
        sys.exit(1)
    
    # 安装依赖并启动服务
    if not args.skip_install:
        install_dependencies()
    start_server(debug=args.debug)