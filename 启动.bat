@echo off
chcp 65001 >nul
title 红狼 Claude Code 夺舍平台
echo.
echo =====================================================
echo             红狼 Claude Code 夺舍平台
echo =====================================================
echo.

:: 检查是否在正确的目录
if not exist "main.py" (
    echo ❌ 错误：请在项目根目录运行此脚本
    echo 当前目录：%CD%
    pause
    exit /b 1
)

:: 检查Python是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 错误：未找到Python，请先安装Python 3.7+
    echo 下载地址：https://www.python.org/downloads/
    pause
    exit /b 1
)

echo ✅ Python环境检查通过
echo.

:: 安装依赖
echo 📦 正在安装/更新依赖包...
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo ❌ 依赖安装失败，请检查网络连接
    pause
    exit /b 1
)

echo ✅ 依赖包安装完成
echo.

:: 启动服务
echo 🚀 正在启动红狼 Claude Code 夺舍平台...
echo.
echo 🌐 服务地址: http://127.0.0.1:8000
echo 📱 请在浏览器中打开上述地址访问管理界面
echo.
echo 💡 提示：
echo    - 首次使用请先配置KEY和转发模式
echo    - 按 Ctrl+C 可停止服务
echo    - 如有问题请公众号搜索"洛小山"获取支持
echo.
echo =====================================================
echo.

:: 启动服务器
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload

echo.
echo 👋 服务已停止，感谢使用！
pause