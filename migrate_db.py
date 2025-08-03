#!/usr/bin/env python3
"""
数据库迁移脚本
添加token统计字段到APIRecord表
"""

import sqlite3
import os
import sys

def migrate_database():
    """迁移数据库，添加token相关字段"""
    db_path = "api_records.db"
    
    if not os.path.exists(db_path):
        print("❌ 数据库文件不存在，无需迁移")
        return False
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # 检查是否已经有token字段
        cursor.execute("PRAGMA table_info(api_records)")
        columns = [col[1] for col in cursor.fetchall()]
        
        fields_to_add = []
        if 'input_tokens' not in columns:
            fields_to_add.append('input_tokens INTEGER DEFAULT 0')
        if 'output_tokens' not in columns:
            fields_to_add.append('output_tokens INTEGER DEFAULT 0')
        if 'total_tokens' not in columns:
            fields_to_add.append('total_tokens INTEGER DEFAULT 0')
        if 'processed_headers' not in columns:
            fields_to_add.append('processed_headers TEXT')
        
        if not fields_to_add:
            print("✅ 数据库已经包含所有必要字段，无需迁移")
            return True
        
        # 添加新字段
        for field in fields_to_add:
            sql = f"ALTER TABLE api_records ADD COLUMN {field}"
            print(f"🔄 执行: {sql}")
            cursor.execute(sql)
        
        conn.commit()
        conn.close()
        
        print(f"✅ 数据库迁移完成，添加了 {len(fields_to_add)} 个字段")
        return True
        
    except Exception as e:
        print(f"❌ 数据库迁移失败: {e}")
        return False

if __name__ == "__main__":
    print("🚀 开始数据库迁移...")
    success = migrate_database()
    if success:
        print("✅ 迁移完成")
        sys.exit(0)
    else:
        print("❌ 迁移失败")
        sys.exit(1)