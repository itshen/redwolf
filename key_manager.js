// KEY 管理额外方法

// DEBUG控制机制（检查是否已定义）
if (typeof window.DEBUG_MODE === 'undefined') {
    window.DEBUG_MODE = localStorage.getItem('DEBUG_MODE') === 'true' || 
                        new URLSearchParams(window.location.search).get('debug') === 'true';
}

if (typeof window.debugLog === 'undefined') {
    window.debugLog = function(...args) {
        if (window.DEBUG_MODE) {
            console.log(...args);
        }
    };
}

// 处理到期时间预设变化
KeyManager.prototype.handleExpiresPresetChange = function(e) {
    const customDateInput = document.getElementById('key-expires-date');
    if (customDateInput) {
        if (e.target.value === 'custom') {
            customDateInput.classList.remove('hidden');
            
            // 设置默认日期为30天后
            const defaultDate = new Date();
            defaultDate.setDate(defaultDate.getDate() + 30);
            customDateInput.value = defaultDate.toISOString().split('T')[0];
        } else {
            customDateInput.classList.add('hidden');
        }
    }
};

// 扩展 KeyManager 类的方法
KeyManager.prototype.loadKeys = async function() {
    try {
        const response = await fetch('/_api/keys');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const keys = await response.json();
        this.renderKeyList(keys);
    } catch (error) {
        console.error('加载 KEY 列表失败:', error);
        this.showMessage('加载 KEY 列表失败: ' + error.message, 'error');
    }
};

KeyManager.prototype.renderKeyList = function(keys) {
    const keyList = document.getElementById('key-list');
    if (!keyList) return;

    if (keys.length === 0) {
        keyList.innerHTML = `
            <div class="px-6 py-4 text-center text-gray-500">
                暂无 KEY，点击上方按钮添加
            </div>
        `;
        return;
    }

    keyList.innerHTML = keys.map(key => {
        const expiresAt = key.expires_at ? new Date(key.expires_at).toLocaleDateString() : '永不过期';
        const statusColor = key.is_active ? 'text-green-600' : 'text-red-600';
        const statusText = key.is_active ? '激活' : '禁用';
        const displayKey = key.api_key; // 显示完整KEY
        const maxTokensDisplay = key.max_tokens > 0 ? (key.max_tokens / 10000).toFixed(2) : '无限制';
        const usedTokensDisplay = (key.used_tokens / 10000).toFixed(2);

        return `
            <div class="px-6 py-4">
                <div class="grid grid-cols-12 gap-4 items-center text-sm">
                    <div class="col-span-2 font-medium">${key.key_name}</div>
                    <div class="col-span-3 font-mono text-xs bg-gray-100 px-2 py-1 rounded break-all">${displayKey}</div>
                    <div class="col-span-1">${maxTokensDisplay}</div>
                    <div class="col-span-1">${usedTokensDisplay}</div>
                    <div class="col-span-2">${expiresAt}</div>
                    <div class="col-span-1 ${statusColor} font-medium">${statusText}</div>
                    <div class="col-span-2 flex space-x-2">
                        <button onclick="keyManager.resetKeyUsage(${key.id})" class="text-red-600 hover:text-red-800 text-xs">清零</button>
                        <button onclick="keyManager.editKey(${key.id})" class="text-purple-600 hover:text-purple-800 text-xs">编辑</button>
                        <button onclick="keyManager.toggleKeyStatus(${key.id}, ${!key.is_active})" class="text-orange-600 hover:text-orange-800 text-xs">
                            ${key.is_active ? '禁用' : '启用'}
                        </button>
                        <button onclick="keyManager.deleteKey(${key.id})" class="text-red-600 hover:text-red-800 text-xs">删除</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
};

KeyManager.prototype.maskApiKey = function(apiKey) {
    if (!apiKey || apiKey.length < 8) return apiKey;
    return apiKey.substring(0, 4) + '****' + apiKey.substring(apiKey.length - 4);
};

KeyManager.prototype.openKeyForm = function(keyData = null) {
    this.currentEditingKey = keyData;
    const modal = document.getElementById('key-form-modal');
    const title = document.getElementById('key-form-title');
    
    if (modal && title) {
        title.textContent = keyData ? '编辑 KEY' : '添加 KEY';
        modal.classList.remove('hidden');
        
        // 填充表单数据
        if (keyData) {
            document.getElementById('key-name').value = keyData.key_name || '';
            document.getElementById('key-max-tokens').value = keyData.max_tokens > 0 ? (keyData.max_tokens / 10000) : 0;
            
            // 处理到期时间
            if (keyData.expires_at) {
                const expiresDate = new Date(keyData.expires_at);
                
                // 设置自定义日期并显示日期选择器
                document.getElementById('key-expires-preset').value = 'custom';
                document.getElementById('key-expires-date').value = expiresDate.toISOString().split('T')[0];
                document.getElementById('key-expires-date').classList.remove('hidden');
            } else {
                // 永不过期
                document.getElementById('key-expires-preset').value = '0';
                document.getElementById('key-expires-date').classList.add('hidden');
            }
        } else {
            // 清空表单
            document.getElementById('key-form').reset();
            // 重置到期时间选择器
            document.getElementById('key-expires-preset').value = '30';
            document.getElementById('key-expires-date').classList.add('hidden');
        }
    }
};

KeyManager.prototype.closeKeyForm = function() {
    const modal = document.getElementById('key-form-modal');
    if (modal) {
        modal.classList.add('hidden');
        this.currentEditingKey = null;
    }
};

KeyManager.prototype.saveKey = async function() {
    try {
        const keyName = document.getElementById('key-name').value.trim();
        const maxTokens = parseFloat(document.getElementById('key-max-tokens').value) || 0;
        const expiresPreset = document.getElementById('key-expires-preset').value;
        const customDate = document.getElementById('key-expires-date').value;

        if (!keyName) {
            this.showMessage('请输入 KEY 名称', 'error');
            return;
        }

        // 处理到期时间
        let expiresAt = null;
        if (expiresPreset === 'custom') {
            if (customDate) {
                expiresAt = customDate + 'T23:59:59'; // 设置为当天的最后一秒
            }
        } else if (expiresPreset !== '0') {
            // 使用预设天数
            const days = parseInt(expiresPreset);
            const expireDate = new Date();
            expireDate.setDate(expireDate.getDate() + days);
            expiresAt = expireDate.toISOString();
        }

        const data = {
            key_name: keyName,
            max_tokens: Math.round(maxTokens * 10000), // 转换为实际token数量
            expires_at: expiresAt
        };

        let response;
        if (this.currentEditingKey) {
            // 编辑模式
            response = await fetch(`/_api/keys/${this.currentEditingKey.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
        } else {
            // 新增模式
            response = await fetch('/_api/keys', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'API 请求失败');
        }

        const result = await response.json();
        
        if (!this.currentEditingKey && result.api_key) {
            // 新增成功，直接关闭弹窗
            this.showMessage('KEY 创建成功！您可以在管理界面中查看完整的 API KEY', 'success');
            this.closeKeyForm();
        } else {
            // 编辑成功
            this.showMessage('KEY 更新成功', 'success');
            this.closeKeyForm();
        }

        // 刷新列表
        await this.loadKeys();

    } catch (error) {
        console.error('保存 KEY 失败:', error);
        this.showMessage('保存失败: ' + error.message, 'error');
    }
};

KeyManager.prototype.editKey = async function(keyId) {
    try {
        const response = await fetch('/_api/keys');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const keys = await response.json();
        const keyData = keys.find(k => k.id === keyId);
        
        if (keyData) {
            this.openKeyForm(keyData);
        } else {
            this.showMessage('KEY 不存在', 'error');
        }
    } catch (error) {
        console.error('获取 KEY 信息失败:', error);
        this.showMessage('获取 KEY 信息失败: ' + error.message, 'error');
    }
};

KeyManager.prototype.toggleKeyStatus = async function(keyId, isActive) {
    try {
        const response = await fetch(`/_api/keys/${keyId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ is_active: isActive })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'API 请求失败');
        }

        this.showMessage(`KEY ${isActive ? '启用' : '禁用'}成功`, 'success');
        await this.loadKeys();

    } catch (error) {
        console.error('更新 KEY 状态失败:', error);
        this.showMessage('更新状态失败: ' + error.message, 'error');
    }
};

KeyManager.prototype.deleteKey = async function(keyId) {
    if (!confirm('确定要删除这个 KEY 吗？删除后将无法恢复，所有相关的使用记录也会被删除。')) {
        return;
    }

    try {
        const response = await fetch(`/_api/keys/${keyId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'API 请求失败');
        }

        this.showMessage('KEY 删除成功', 'success');
        await this.loadKeys();

    } catch (error) {
        console.error('删除 KEY 失败:', error);
        this.showMessage('删除失败: ' + error.message, 'error');
    }
};



KeyManager.prototype.resetKeyUsage = async function(keyId) {
    if (!confirm('确定要清零这个 KEY 的使用量吗？此操作将删除所有相关的使用记录。')) {
        return;
    }

    try {
        const response = await fetch(`/_api/keys/${keyId}/reset`, {
            method: 'POST'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'API 请求失败');
        }

        this.showMessage('KEY 使用量已清零', 'success');
        await this.loadKeys();

    } catch (error) {
        console.error('清零 KEY 使用量失败:', error);
        this.showMessage('清零失败: ' + error.message, 'error');
    }
};

KeyManager.prototype.viewKeyDetails = async function(keyId) {
    try {
        const timeRange = document.getElementById('stats-time-range')?.value || '30';
        let url = `/_api/keys/${keyId}/statistics`;
        
        if (timeRange !== 'custom') {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - parseInt(timeRange));
            url += `?start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`;
            window.debugLog(`[DEBUG] viewKeyDetails 查询时间范围: ${startDate.toISOString()} 到 ${endDate.toISOString()}`);
        } else {
            const startDate = document.getElementById('stats-start-date')?.value;
            const endDate = document.getElementById('stats-end-date')?.value;
            if (startDate && endDate) {
                url += `?start_date=${startDate}T00:00:00Z&end_date=${endDate}T23:59:59Z`;
            }
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // 显示详细统计弹窗
        const modal = document.getElementById('key-detail-modal');
        const title = document.getElementById('key-detail-title');
        const content = document.getElementById('key-detail-content');
        
        // 更新弹窗标题
        title.textContent = `${data.key_info.key_name} - 详细统计`;
        
        // 渲染详细统计数据
        this.renderKeyDetailStatistics(data, content);
        
        // 显示弹窗
        modal.classList.remove('hidden');

    } catch (error) {
        console.error('加载 KEY 详细统计失败:', error);
        this.showMessage('加载详细统计失败: ' + error.message, 'error');
    }
};

KeyManager.prototype.renderKeyDetailStatistics = function(data, container) {
    if (!container) return;

    container.innerHTML = `
        <div class="p-6">
            <div class="mb-6">
                <h5 class="text-lg font-medium text-gray-900 mb-4">${data.key_info.key_name} - 详细统计</h5>
                <div class="grid grid-cols-4 gap-4 mb-6">
                    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div class="text-sm text-blue-600">总调用次数</div>
                        <div class="text-xl font-bold text-blue-800">${data.summary.total_calls.toLocaleString()}</div>
                    </div>
                    <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
                        <div class="text-sm text-purple-600">总Token消耗</div>
                        <div class="text-xl font-bold text-purple-800">${(data.summary.total_tokens / 10000).toFixed(2)}万</div>
                    </div>
                    <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                        <div class="text-sm text-green-600">输入Token</div>
                        <div class="text-xl font-bold text-green-800">${(data.summary.total_input_tokens / 10000).toFixed(2)}万</div>
                    </div>
                    <div class="bg-orange-50 border border-orange-200 rounded-lg p-4">
                        <div class="text-sm text-orange-600">输出Token</div>
                        <div class="text-xl font-bold text-orange-800">${(data.summary.total_output_tokens / 10000).toFixed(2)}万</div>
                    </div>
                </div>
            </div>

            ${data.by_model.length > 0 ? `
            <div class="mb-6">
                <h6 class="text-md font-medium text-gray-900 mb-3">按模型统计</h6>
                <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">模型</th>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">调用次数</th>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Token消耗(万)</th>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">输入Token(万)</th>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">输出Token(万)</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                            ${data.by_model.map(model => `
                                <tr>
                                    <td class="px-4 py-2 text-sm text-gray-900">${model.model_name}</td>
                                    <td class="px-4 py-2 text-sm text-gray-900">${model.call_count.toLocaleString()}</td>
                                    <td class="px-4 py-2 text-sm text-gray-900">${(model.total_tokens / 10000).toFixed(2)}</td>
                                    <td class="px-4 py-2 text-sm text-gray-900">${(model.input_tokens / 10000).toFixed(2)}</td>
                                    <td class="px-4 py-2 text-sm text-gray-900">${(model.output_tokens / 10000).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            ` : ''}

            ${data.by_platform.length > 0 ? `
            <div class="mb-6">
                <h6 class="text-md font-medium text-gray-900 mb-3">按平台统计</h6>
                <div class="grid grid-cols-2 gap-4">
                    ${data.by_platform.map(platform => `
                        <div class="bg-gray-50 border border-gray-200 rounded-lg p-4">
                            <div class="text-sm text-gray-600">${platform.platform_type}</div>
                            <div class="text-lg font-bold text-gray-900">${platform.call_count.toLocaleString()} 次调用</div>
                            <div class="text-sm text-gray-600">${(platform.total_tokens / 10000).toFixed(2)}万 Token</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}


        </div>
    `;
};

KeyManager.prototype.loadStatistics = async function() {
    await this.loadOverviewStatistics();
};

KeyManager.prototype.loadOverviewStatistics = async function() {
    try {
        const timeRange = document.getElementById('stats-time-range')?.value || '30';
        let url = '/_api/keys/statistics/overview';
        
        if (timeRange !== 'custom') {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - parseInt(timeRange));
            url += `?start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`;
        } else {
            const startDate = document.getElementById('stats-start-date')?.value;
            const endDate = document.getElementById('stats-end-date')?.value;
            if (startDate && endDate) {
                url += `?start_date=${startDate}T00:00:00Z&end_date=${endDate}T23:59:59Z`;
            }
        }

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        this.renderOverviewStatistics(data);
        this.renderKeyStatisticsTable(data.keys);

    } catch (error) {
        console.error('加载统计数据失败:', error);
        this.showMessage('加载统计数据失败: ' + error.message, 'error');
    }
};

KeyManager.prototype.renderOverviewStatistics = function(data) {
    const overview = document.getElementById('stats-overview');
    if (!overview) return;

    // 计算总计数据
    const totals = data.keys.reduce((acc, key) => {
        acc.totalCalls += key.period_stats.call_count;
        acc.totalTokens += key.period_stats.total_tokens;
        acc.totalInputTokens += key.period_stats.input_tokens;
        acc.totalOutputTokens += key.period_stats.output_tokens;
        return acc;
    }, { totalCalls: 0, totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0 });

    overview.innerHTML = `
        <div class="bg-white border border-gray-200 rounded-lg p-4">
            <div class="text-sm text-gray-600">总调用次数</div>
            <div class="text-2xl font-bold text-blue-600">${totals.totalCalls.toLocaleString()}</div>
        </div>
        <div class="bg-white border border-gray-200 rounded-lg p-4">
            <div class="text-sm text-gray-600">总Token消耗</div>
            <div class="text-2xl font-bold text-purple-600">${(totals.totalTokens / 10000).toFixed(2)}万</div>
        </div>
        <div class="bg-white border border-gray-200 rounded-lg p-4">
            <div class="text-sm text-gray-600">输入Token</div>
            <div class="text-2xl font-bold text-green-600">${(totals.totalInputTokens / 10000).toFixed(2)}万</div>
        </div>
        <div class="bg-white border border-gray-200 rounded-lg p-4">
            <div class="text-sm text-gray-600">输出Token</div>
            <div class="text-2xl font-bold text-orange-600">${(totals.totalOutputTokens / 10000).toFixed(2)}万</div>
        </div>
    `;
};

KeyManager.prototype.renderKeyStatisticsTable = function(keys) {
    const table = document.getElementById('key-statistics-table');
    if (!table) return;

    if (keys.length === 0) {
        table.innerHTML = `
            <div class="px-6 py-4 text-center text-gray-500">
                暂无统计数据
            </div>
        `;
        return;
    }

    table.innerHTML = `
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">KEY 名称</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">调用次数</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Token消耗(万)</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">输入Token(万)</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">输出Token(万)</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">使用率</th>
                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
                ${keys.map(key => {
                    const usageRate = key.max_tokens > 0 ? ((key.used_tokens / key.max_tokens) * 100).toFixed(1) + '%' : '-';
                    const statusColor = key.is_active ? 'text-green-600' : 'text-red-600';
                    const statusText = key.is_active ? '激活' : '禁用';
                    
                    return `
                        <tr>
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${key.key_name}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm ${statusColor}">${statusText}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${key.period_stats.call_count.toLocaleString()}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${(key.period_stats.total_tokens / 10000).toFixed(2)}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${(key.period_stats.input_tokens / 10000).toFixed(2)}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${(key.period_stats.output_tokens / 10000).toFixed(2)}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${usageRate}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm">
                                <button onclick="keyManager.viewKeyDetails(${key.id})" class="text-blue-600 hover:text-blue-800">详细统计</button>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
};

KeyManager.prototype.handleTimeRangeChange = function(e) {
    const customRange = document.getElementById('custom-date-range');
    if (customRange) {
        if (e.target.value === 'custom') {
            customRange.classList.remove('hidden');
            
            // 设置默认日期范围
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
            
            document.getElementById('stats-start-date').value = startDate.toISOString().split('T')[0];
            document.getElementById('stats-end-date').value = endDate.toISOString().split('T')[0];
        } else {
            customRange.classList.add('hidden');
        }
    }
};

KeyManager.prototype.refreshStatistics = async function() {
    await this.loadOverviewStatistics();
};

