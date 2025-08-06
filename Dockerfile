# 构建阶段
FROM python:3.11 as builder

WORKDIR /app

# 安装构建依赖
RUN apt-get update && apt-get install -y \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装依赖到系统路径
RUN pip install -r requirements.txt

# 生产阶段
FROM python:3.11-slim

WORKDIR /app

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    gcc \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# 复制已安装的Python包
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# 设置PATH以包含新复制的bin目录
ENV PATH=/usr/local/bin:$PATH

# 复制项目文件
COPY . .

# 创建必要的目录
RUN mkdir -p logs

# 暴露端口
EXPOSE 8000

# 设置非root用户
RUN useradd --create-home --shell /bin/bash app && chown -R app:app /app
USER app

# 初始化数据库
RUN python -c "from database import engine, Base; Base.metadata.create_all(bind=engine); print('✅ 数据库初始化完成')"

# 启动命令
CMD ["python", "start.py", "--skip-install"]