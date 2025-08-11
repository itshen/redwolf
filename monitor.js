/**
 * API Hook 监控系统前端脚本
 * 洛小山 Claude Code Hook
 */

// DEBUG控制机制（设置为全局变量）
window.DEBUG_MODE = localStorage.getItem('DEBUG_MODE') === 'true' || 
                    new URLSearchParams(window.location.search).get('debug') === 'true';

window.debugLog = function(...args) {
    if (window.DEBUG_MODE) {
        console.log(...args);
    }
};

class APIHookMonitor {
    constructor() {
        this.ws = null;
        this.isRecording = false;
        this.selectedRecordId = null;
        this.records = [];
        this.filteredRecords = []; // 筛选后的记录
        this.currentFilter = 'all'; // 当前筛选条件
        this.globalViewStates = { // 全局视图状态
            body: 'formatted',
            response_body: 'table',
            response_headers: 'formatted',
            headers: 'formatted',
                processed_prompt: 'formatted',
    processed_headers: 'formatted',
    model_raw_headers: 'formatted',
            model_raw_response: 'formatted'
        };
        this.isRestoringSSE = false; // 标记是否正在恢复SSE视图
        this.restoringViewCount = 0; // 恢复视图计数器
        
        // 懒加载配置
        this.lazyLoading = {
            pageSize: 50,           // 每页显示的记录数
            currentPage: 0,         // 当前页数
            isLoading: false,       // 是否正在加载
            hasMore: true,          // 是否还有更多数据
            loadThreshold: 200      // 距离底部多少像素时触发加载
        };
        
        this.initializeElements();
        this.bindEvents();
        this.initializeResizer();
        this.connectWebSocket();
        this.loadInitialData();
        this.loadFilterFromCache(); // 加载缓存的筛选条件
        this.loadGlobalViewStatesFromStorage(); // 加载全局视图状态缓存
    }

    initializeElements() {
        this.configBtn = document.getElementById('config-btn');
        this.clearBtn = document.getElementById('clear-btn');
        this.logoutBtn = document.getElementById('logout-btn');
        this.recordsList = document.getElementById('records-list');
        this.detailContent = document.getElementById('detail-content');
        this.totalCount = document.getElementById('total-count');
        this.noRecords = document.getElementById('no-records');
        this.configModal = document.getElementById('config-modal');
        this.configCancel = document.getElementById('config-cancel');
        this.configSave = document.getElementById('config-save');
        this.localPathInput = document.getElementById('local-path');
        this.targetUrlInput = document.getElementById('target-url');
        this.currentWorkMode = document.getElementById('current-work-mode');
        this.currentPlatformStatus = document.getElementById('current-platform-status');
        
        // Claude Code 服务器管理相关元素
        this.addClaudeServerBtn = document.getElementById('add-claude-server-btn');
        this.claudeServersList = document.getElementById('claude-servers-list');
        this.claudeServersEmpty = document.getElementById('claude-servers-empty');
        this.claudeServerModal = document.getElementById('claude-server-modal');
        this.claudeServerModalTitle = document.getElementById('claude-server-modal-title');
        this.claudeServerForm = document.getElementById('claude-server-form');
        this.claudeServerModalCancel = document.getElementById('claude-server-modal-cancel');
        this.claudeServerModalSave = document.getElementById('claude-server-modal-save');
        
        // Claude Code 服务器表单字段
        this.claudeServerNameInput = document.getElementById('claude-server-name');
        this.claudeServerUrlInput = document.getElementById('claude-server-url');
        this.claudeServerApiKeyInput = document.getElementById('claude-server-api-key');
        this.claudeServerTimeoutInput = document.getElementById('claude-server-timeout');
        this.claudeServerEnabledInput = document.getElementById('claude-server-enabled');
        
        // 当前编辑的服务器ID（编辑模式下使用）
        this.currentEditingServerId = null;
        
        // 分割线相关元素
        this.mainContainer = document.getElementById('main-container');
        this.leftPanel = document.getElementById('left-panel');
        this.rightPanel = document.getElementById('right-panel');
        this.resizer = document.getElementById('resizer');
        
        // 全屏模态框相关元素
        this.fullscreenModal = document.getElementById('fullscreen-modal');
        this.fullscreenTitle = document.getElementById('fullscreen-title');
        this.fullscreenBody = document.getElementById('fullscreen-body');
        this.fullscreenClose = document.getElementById('fullscreen-close');
    }

    bindEvents() {
        this.configBtn.addEventListener('click', () => this.showConfigModal());
        this.clearBtn.addEventListener('click', () => this.clearRecords());
        this.logoutBtn.addEventListener('click', () => this.logout());
        this.configCancel.addEventListener('click', () => this.hideConfigModal());
        this.configSave.addEventListener('click', () => this.saveConfig());
        
        // 预设服务器地址按钮点击事件
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('preset-url-btn')) {
                const presetUrl = e.target.dataset.url;
                if (presetUrl && this.targetUrlInput) {
                    this.targetUrlInput.value = presetUrl;
                    console.log(`✅ [Frontend] 已设置预设服务器地址: ${presetUrl}`);
                }
            }
            
            // Claude Code 服务器模态框中的预设服务器地址按钮
            if (e.target.classList.contains('preset-server-url-btn')) {
                const presetUrl = e.target.dataset.url;
                if (presetUrl && this.claudeServerUrlInput) {
                    this.claudeServerUrlInput.value = presetUrl;
                    console.log(`✅ [Frontend] 模态框中已设置预设服务器地址: ${presetUrl}`);
                }
            }
        });
        
        // Claude Code 服务器管理事件
        if (this.addClaudeServerBtn) {
            this.addClaudeServerBtn.addEventListener('click', () => this.showAddClaudeServerModal());
        }
        if (this.claudeServerModalCancel) {
            this.claudeServerModalCancel.addEventListener('click', () => this.hideClaudeServerModal());
        }
        if (this.claudeServerForm) {
            this.claudeServerForm.addEventListener('submit', (e) => this.saveClaudeServer(e));
        }
        
        // 模态框背景点击关闭
        if (this.claudeServerModal) {
            this.claudeServerModal.addEventListener('click', (e) => {
                if (e.target === this.claudeServerModal) {
                    this.hideClaudeServerModal();
                }
            });
        }
        
        // 复制环境变量命令事件
        document.addEventListener('click', (e) => {
            if (e.target.id === 'copy-env-commands') {
                this.copyEnvCommands();
            }
        });
        
        // 配置标签页切换
        document.getElementById('tab-platforms').addEventListener('click', () => this.showConfigTab('platforms'));
        document.getElementById('tab-claude-code').addEventListener('click', () => this.showConfigTab('claude-code'));
        document.getElementById('tab-global-direct').addEventListener('click', () => this.showConfigTab('global-direct'));
        document.getElementById('tab-smart-routing').addEventListener('click', () => this.showConfigTab('smart-routing'));
        document.getElementById('tab-system-settings').addEventListener('click', () => this.showConfigTab('system-settings'));
        document.getElementById('tab-system-status').addEventListener('click', () => this.showConfigTab('system-status'));
        document.getElementById('tab-about').addEventListener('click', () => this.showConfigTab('about'));
        
        // 系统状态刷新按钮
        document.getElementById('refresh-system-status').addEventListener('click', () => this.refreshSystemStatus());
        
        // 全局平台配置按钮
        document.getElementById('test-all-platforms').addEventListener('click', () => this.testAllPlatforms());
        document.getElementById('refresh-all-models').addEventListener('click', () => this.refreshAllModels());
        
        // 单独平台测试按钮
        document.getElementById('test-dashscope').addEventListener('click', () => this.testSinglePlatform('dashscope'));
        document.getElementById('test-openrouter').addEventListener('click', () => this.testSinglePlatform('openrouter'));
        document.getElementById('test-ollama').addEventListener('click', () => this.testSinglePlatform('ollama'));
        document.getElementById('test-lmstudio').addEventListener('click', () => this.testSinglePlatform('lmstudio'));
        document.getElementById('test-siliconflow').addEventListener('click', () => this.testSinglePlatform('siliconflow'));
        document.getElementById('test-openai_compatible').addEventListener('click', () => this.testSinglePlatform('openai_compatible'));
        
        // 路由模型选择
        const routingModelSelect = document.getElementById('routing-model');
        if (routingModelSelect) {
            routingModelSelect.addEventListener('change', (e) => {
                console.log('🧠 [Frontend] 选择路由模型:', e.target.value);
            });
        }
        
        // 工作模式选择
        const workModeRadios = document.querySelectorAll('input[name="work-mode"]');
        workModeRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.handleWorkModeChange(e.target.value);
            });
        });
        
        // 添加场景按钮
        const addSceneBtn = document.getElementById('add-scene');
        if (addSceneBtn) {
            addSceneBtn.addEventListener('click', () => this.addNewScene());
        }
        
        // 快速模板按钮
        const addSceneTemplateBtn = document.getElementById('add-scene-template');
        if (addSceneTemplateBtn) {
            addSceneTemplateBtn.addEventListener('click', () => this.toggleSceneTemplateSelector());
        }
        
        // 恢复默认场景按钮
        const restoreDefaultScenesBtn = document.getElementById('restore-default-scenes');
        if (restoreDefaultScenesBtn) {
            restoreDefaultScenesBtn.addEventListener('click', () => this.restoreDefaultScenes());
        }
        
        // 删除场景按钮（事件委托）
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-scene') || e.target.closest('.delete-scene')) {
                this.deleteScene(e.target.closest('.delete-scene') || e.target);
            }
            // 场景模板选择
            if (e.target.classList.contains('scene-template-item')) {
                this.addSceneFromTemplate(e.target.dataset.template);
            }
            // 模型选择器按钮
            if (e.target.classList.contains('model-selector-btn')) {
                this.showModelSelector(e.target);
            }
            // 场景启用/禁用切换按钮
            if (e.target.classList.contains('scene-toggle-btn') || e.target.closest('.scene-toggle-btn')) {
                this.toggleSceneEnabled(e.target.closest('.scene-toggle-btn') || e.target);
            }
        });
        
        // 添加实时验证事件监听
        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('scene-name')) {
                this.validateSceneName(e.target);
            }
            if (e.target.classList.contains('scene-description')) {
                this.validateSceneDescription(e.target);
            }
            if (e.target.classList.contains('scene-models')) {
                this.validateSceneModels(e.target);
            }
        });
        
        // 添加复选框变化监听
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('scene-enabled')) {
                this.updateSceneEnabledStatus(e.target);
            }
        });
        
        // 点击弹窗外部关闭
        this.configModal.addEventListener('click', (e) => {
            if (e.target === this.configModal) {
                this.hideConfigModal();
            }
        });
        
        // 全屏模态框事件
        this.fullscreenClose.addEventListener('click', () => this.hideFullscreen());
        this.fullscreenModal.addEventListener('click', (e) => {
            if (e.target === this.fullscreenModal) {
                this.hideFullscreen();
            }
        });
        
        // ESC键关闭全屏
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.fullscreenModal.style.display !== 'none') {
                this.hideFullscreen();
            }
        });
        
        // DEBUG模式开关事件
        document.addEventListener('change', (e) => {
            if (e.target.id === 'debug-mode-toggle') {
                this.toggleDebugMode(e.target.checked);
            }
        });
        
        // 性能监控开关事件
        document.addEventListener('change', (e) => {
            if (e.target.id === 'performance-monitor-toggle') {
                this.togglePerformanceMonitor(e.target.checked);
            }
        });

        // 添加记录列表滚动监听，实现懒加载
        if (this.recordsList) {
            this.recordsList.addEventListener('scroll', () => this.handleRecordsScroll());
        }
    }

    initializeResizer() {
        // 从localStorage恢复保存的百分比
        this.restorePanelWidth();
        
        let isResizing = false;

        this.resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            
            const startX = e.clientX;
            const containerWidth = this.mainContainer.clientWidth;
            const leftPanelWidth = this.leftPanel.clientWidth;
            
            const handleMouseMove = (e) => {
                if (!isResizing) return;
                
                const deltaX = e.clientX - startX;
                const newLeftWidth = leftPanelWidth + deltaX;
                const minWidth = 200; // 最小宽度
                const maxWidth = containerWidth - 300; // 右侧最小保留300px
                
                if (newLeftWidth >= minWidth && newLeftWidth <= maxWidth) {
                    const leftPercentage = (newLeftWidth / containerWidth) * 100;
                    this.leftPanel.style.width = `${leftPercentage}%`;
                }
            };
            
            const handleMouseUp = () => {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                
                // 保存当前的百分比到localStorage
                this.savePanelWidth();
                
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });

        // 防止拖拽时选中文本
        this.resizer.addEventListener('selectstart', (e) => {
            e.preventDefault();
        });

        // 监听窗口大小变化，自动调整面板宽度
        window.addEventListener('resize', () => {
            this.restorePanelWidth();
        });
    }

    // 保存面板宽度到localStorage
    savePanelWidth() {
        try {
            const containerWidth = this.mainContainer.clientWidth;
            const leftPanelWidth = this.leftPanel.clientWidth;
            const leftPercentage = (leftPanelWidth / containerWidth) * 100;
            
            localStorage.setItem('claude-hook-panel-width', leftPercentage.toString());
        } catch (error) {
            console.warn('无法保存面板宽度:', error);
        }
    }

    // 从localStorage恢复面板宽度
    restorePanelWidth() {
        try {
            const savedWidth = localStorage.getItem('claude-hook-panel-width');
            if (savedWidth) {
                const percentage = parseFloat(savedWidth);
                // 验证百分比是否合理（20% - 80%）
                if (percentage >= 20 && percentage <= 80) {
                    this.leftPanel.style.width = `${percentage}%`;
                    return;
                }
            }
        } catch (error) {
            console.warn('无法恢复面板宽度:', error);
        }
        
        // 如果没有保存的数据或数据无效，使用默认值
        this.leftPanel.style.width = '30%';
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket连接已建立');
        };
        
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleWebSocketMessage(message);
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket连接已关闭，5秒后重连');
            setTimeout(() => this.connectWebSocket(), 5000);
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
        };
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'new_record':
                this.addNewRecord(message.record);
                break;
            case 'config_updated':
                this.loadConfig();
                break;
        }
    }

    async loadInitialData() {
        try {
            const [configResponse, recordsResponse] = await Promise.all([
                fetch('/control/config'),
                fetch('/_api/records')
            ]);
            
            const config = await configResponse.json();
            const records = await recordsResponse.json();
            
            this.updateConfigDisplay(config);
            this.records = records;
            this.renderRecordsList();
        } catch (error) {
            console.error('加载初始数据失败:', error);
        }
    }

    // 配置管理
    showConfigModal() {
        this.loadConfig();
        this.loadPlatformConfigs();
        this.loadRoutingConfig();
        this.configModal.classList.remove('hidden');
        
        // 初始化标签页
        this.showConfigTab('platforms');
    }

    hideConfigModal() {
        this.configModal.classList.add('hidden');
    }

    showConfigTab(tabName) {
        // 隐藏所有面板
        document.querySelectorAll('.config-panel').forEach(panel => {
            panel.classList.add('hidden');
        });
        
        // 移除所有标签页的active状态
        document.querySelectorAll('.config-tab').forEach(tab => {
            tab.classList.remove('active', 'border-blue-500', 'text-blue-600');
            tab.classList.add('border-transparent', 'text-gray-500');
        });
        
        // 显示目标面板
        const targetPanel = document.getElementById(`panel-${tabName}`);
        if (targetPanel) {
            targetPanel.classList.remove('hidden');
        }
        
        // 激活目标标签页
        const targetTab = document.getElementById(`tab-${tabName}`);
        if (targetTab) {
            targetTab.classList.add('active', 'border-blue-500', 'text-blue-600');
            targetTab.classList.remove('border-transparent', 'text-gray-500');
        }
        
        // 注意：切换设置标签页不应该自动改变工作模式
        
        // 根据标签页执行特定逻辑
        if (tabName === 'platforms') {
            // 平台配置：显示平台状态并加载模型列表
            this.updatePlatformStatus();
            this.loadPlatformModels();
        } else if (tabName === 'global-direct') {
            // 多平台转发模式：加载模型列表和平台状态
            this.loadGlobalDirectModels();
            this.updateGlobalPlatformStatus();
        } else if (tabName === 'smart-routing') {
            // 小模型路由模式：加载路由模型选项和平台状态
            this.loadSmartRoutingModels();
            this.updateSmartPlatformStatus();
        } else if (tabName === 'system-settings') {
            // 系统设置：初始化DEBUG状态显示
            this.initializeSystemSettings();
        } else if (tabName === 'system-status') {
            // 系统状态：初始化状态显示但不自动刷新
            this.initializeSystemStatus();
        } else if (tabName === 'about') {
            // 关于：无需特殊处理，静态内容
            debugLog('显示关于页面');
        }
    }

    async loadConfig() {
        try {
            const response = await fetch('/control/config');
            const config = await response.json();
            this.localPathInput.value = config.local_path || 'api/v1/claude-code';
            this.targetUrlInput.value = config.target_url || 'https://dashscope.aliyuncs.com/api/v2/apps/claude-code-proxy';
            
            // 🎯 使用主配置的工作模式
            let currentMode = config.current_work_mode || 'claude_code';
            console.log(`🎛️ [Frontend] 从主配置加载工作模式: ${currentMode}`);
            
            // 加载当前工作模式
            this.loadWorkMode(currentMode);
            
            console.log('💾 [Frontend] 多平台转发设置:', config.use_multi_platform || false);
            
            this.updateConfigDisplay(config);
            
            // 加载Claude Code服务器列表
            await this.loadClaudeServers();
        } catch (error) {
            console.error('加载配置失败:', error);
        }
    }

    async loadPlatformConfigs() {
        try {
            const response = await fetch('/_api/platforms');
            const platforms = await response.json();
            
            // 设置平台配置
            platforms.forEach(platform => {
                const enabledInput = document.getElementById(`${platform.platform_type}-enabled`);
                const apiKeyInput = document.getElementById(`${platform.platform_type}-api-key`);
                const baseUrlInput = document.getElementById(`${platform.platform_type}-base-url`);
                
                if (enabledInput) enabledInput.checked = platform.enabled;
                if (apiKeyInput && platform.api_key) {
                    apiKeyInput.value = platform.api_key;  // 直接显示完整API Key
                }
                if (baseUrlInput && platform.base_url) {
                    baseUrlInput.value = platform.base_url;
                }
            });
        } catch (error) {
            console.error('加载平台配置失败:', error);
        }
    }

    async loadRoutingConfig() {
        try {
            const response = await fetch('/_api/routing');
            const config = await response.json();
            
            console.log('✅ [Frontend] 路由配置加载完成:', config);
        } catch (error) {
            console.error('❌ [Frontend] 加载路由配置失败:', error);
        }
    }

    showRoutingConfig(mode) {
        console.log('🧠 [Frontend] 显示路由配置:', mode);
        // 新的设计中，路由配置已经整合到各个标签页中，不需要单独的面板切换
    }

    async loadSmartRoutingModels() {
        console.log('🧠 [Frontend] 加载小模型路由模式...');
        try {
            // 首先从数据库加载模型
            console.log('💾 [Frontend] 优先从数据库获取路由模型...');
            const dbResponse = await fetch('/_api/models/from-db');
            const dbModels = await dbResponse.json();
            console.log(`📋 [Frontend] 数据库中获取到 ${dbModels.length} 个路由模型`);
            
            // 存储模型数据
            this.allRoutingModels = dbModels.length > 0 ? dbModels : [];
            
            // 渲染模型列表
            this.renderFilteredRoutingModels();
            
            // 后台尝试从API刷新（可选）
            try {
                const apiResponse = await fetch('/_api/models');
                const apiModels = await apiResponse.json();
                if (apiModels.length > dbModels.length) {
                    console.log('🔄 [Frontend] API路由模型更多，更新显示...');
                    this.allRoutingModels = apiModels;
                    this.renderFilteredRoutingModels();
                }
            } catch (apiError) {
                console.log('⚠️ [Frontend] API获取路由模型失败，使用数据库数据:', apiError);
            }
            
            // 设置过滤事件监听器
            const filterInput = document.getElementById('routing-model-filter');
            if (filterInput) {
                filterInput.addEventListener('input', () => {
                    this.renderFilteredRoutingModels(filterInput.value.trim());
                });
            }
            
            // 加载已保存的路由模型配置
            await this.loadSmartRoutingConfig();
            
            // 初始化路由模型的拖拽功能
            this.initRoutingDragula();
            
        } catch (error) {
            console.error('❌ [Frontend] 加载路由模型失败:', error);
        }
    }

    renderFilteredRoutingModels(filterText = '') {
        const routingAvailableContainer = document.getElementById('routing-available-models');
        const countElement = document.getElementById('routing-model-count');
        
        if (!routingAvailableContainer || !this.allRoutingModels) return;
        
        console.log('🧹 [Frontend] 清空现有路由模型容器...');
        routingAvailableContainer.innerHTML = '';
        
        // 过滤模型
        const filteredModels = this.allRoutingModels.filter(model => {
            if (!filterText) return true;
            const searchText = filterText.toLowerCase();
            return model.name.toLowerCase().includes(searchText) || 
                   model.id.toLowerCase().includes(searchText) ||
                   model.platform.toLowerCase().includes(searchText);
        });
        
        // 更新计数
        if (countElement) {
            countElement.textContent = `${filteredModels.length} 个模型`;
        }
        
        if (filteredModels.length === 0) {
            routingAvailableContainer.innerHTML = `
                <div class="text-center text-gray-500 text-sm py-8 no-drag">
                    ${filterText ? '未找到匹配的模型' : '请先配置平台并刷新模型列表'}
                </div>
            `;
            return;
        }
        
        // 优先推荐的路由模型（快速小模型）
        const preferredModels = ['qwen-plus', 'qwen-turbo', 'gpt-4o-mini', 'gpt-3.5-turbo'];
        const recommendedModels = [];
        const otherModels = [];
        
        filteredModels.forEach(model => {
            const modelItem = document.createElement('div');
            modelItem.className = 'model-item p-2 mb-2 bg-white border border-gray-200 rounded cursor-pointer hover:bg-blue-50 transition-colors';
            modelItem.dataset.modelId = model.id;
            
            const isRecommended = preferredModels.some(preferred => model.id.includes(preferred));
            
            modelItem.innerHTML = `
                <div class="flex items-center justify-between">
                    <div>
                        <div class="text-sm font-medium text-gray-900">${model.name}</div>
                        <div class="text-xs text-gray-500">${model.platform}${isRecommended ? ' - 推荐路由模型' : ''}</div>
                    </div>
                    <div class="text-xs text-blue-600">🎯</div>
                </div>
            `;
            
            // 添加点击事件
            modelItem.addEventListener('click', () => {
                this.moveModelToRoutingPriority(model.id, model.name, model.platform);
            });
            
            if (isRecommended) {
                recommendedModels.push(modelItem);
            } else {
                otherModels.push(modelItem);
            }
        });
        
        // 先添加推荐模型，再添加其他模型
        recommendedModels.forEach(item => routingAvailableContainer.appendChild(item));
        otherModels.forEach(item => routingAvailableContainer.appendChild(item));
        
        console.log(`✅ [Frontend] 加载了 ${filteredModels.length} 个模型到路由模型列表`);
    }
    
    async loadSmartRoutingConfig() {
        console.log('📂 [Frontend] 加载小模型路由配置...');
        try {
            const response = await fetch('/_api/routing');
            const config = await response.json();
            
            console.log('📋 [Frontend] 路由配置响应:', config);
            
            // 优先从all_configs中查找智能路由配置
            let configData = null;
            let routingModels = [];
            
            // 先检查all_configs中是否有智能路由配置
            if (config && config.all_configs && config.all_configs.smart_routing) {
                configData = config.all_configs.smart_routing.data;
                routingModels = configData.routing_models || [];
                console.log(`🎯 [Frontend] 从all_configs加载小模型路由配置，包含 ${routingModels.length} 个路由模型`);
            }
            // 兼容旧格式：从active_config加载
            else if (config && config.active_config && config.active_config.type === 'smart_routing' && config.active_config.data) {
                configData = config.active_config.data;
                routingModels = configData.routing_models || [];
                console.log(`🎯 [Frontend] 从active_config加载小模型路由配置，包含 ${routingModels.length} 个路由模型`);
            } 
            // 更旧的格式兼容
            else if (config && config.config_type === 'smart_routing' && config.config_data) {
                configData = typeof config.config_data === 'string' ? 
                    JSON.parse(config.config_data) : config.config_data;
                routingModels = configData.routing_models || [];
                console.log(`🎯 [Frontend] 从旧格式加载小模型路由配置，包含 ${routingModels.length} 个路由模型`);
            } else {
                console.log('ℹ️ [Frontend] 没有找到小模型路由配置');
                return;
            }
            
            console.log('📋 [Frontend] 路由模型列表:', routingModels);
            
            if (routingModels.length > 0) {
                // 获取所有可用模型信息
                const modelsResponse = await fetch('/_api/models');
                const allModels = await modelsResponse.json();
                
                // 将已配置的路由模型添加到优先级列表
                const routingPriorityContainer = document.getElementById('routing-priority-models');
                if (routingPriorityContainer) {
                    routingPriorityContainer.innerHTML = '';
                    
                    routingModels.forEach((modelSpec, index) => {
                        console.log(`🔍 [Frontend] 恢复路由模型 ${index + 1}: ${modelSpec}`);
                        
                        // 解析平台和模型ID - 使用与后端相同的逻辑
                        let platform, modelId;
                        if (modelSpec.includes(':')) {
                            const colonIndex = modelSpec.indexOf(':');
                            platform = modelSpec.substring(0, colonIndex);
                            modelId = modelSpec.substring(colonIndex + 1);
                        } else {
                            // 兼容旧格式
                            modelId = modelSpec;
                            platform = 'unknown';
                        }
                        
                        console.log(`🔍 [Frontend] 查找模型: platform="${platform}", modelId="${modelId}"`);
                        
                        // 尝试多种匹配方式
                        let modelInfo = allModels.find(m => 
                            m.platform.toLowerCase() === platform.toLowerCase() && 
                            m.id === modelId
                        );
                        
                        // 如果找不到，尝试匹配去掉平台前缀的ID
                        if (!modelInfo) {
                            modelInfo = allModels.find(m => 
                                m.platform.toLowerCase() === platform.toLowerCase() && 
                                m.id === `${platform}:${modelId}`
                            );
                        }
                        
                        // 如果还是找不到，尝试匹配包含完整spec的ID
                        if (!modelInfo) {
                            modelInfo = allModels.find(m => 
                                m.id === modelSpec || m.id === `${platform}:${modelSpec}`
                            );
                        }
                        
                        if (modelInfo) {
                            this.moveModelToRoutingPriority(modelInfo.id, modelInfo.name, modelInfo.platform);
                            console.log(`✅ [Frontend] 成功恢复路由模型: ${modelInfo.name}`);
                        } else {
                            console.warn(`⚠️ [Frontend] 未找到路由模型: ${modelSpec}`);
                            // 显示前几个模型以供调试
                            const sampleModels = allModels.slice(0, 3).map(m => `${m.platform}:${m.id}`);
                            console.log('📋 [Frontend] 可用模型样本:', sampleModels);
                            console.log(`🔍 [Frontend] 尝试匹配的条件:`, {
                                platform: platform,
                                modelId: modelId,
                                modelSpec: modelSpec,
                                expectedPattern1: `${platform}:${modelId}`,
                                expectedPattern2: modelId
                            });
                        }
                    });
                    
                    console.log(`✅ [Frontend] 已尝试加载 ${routingModels.length} 个路由模型到优先级列表`);
                } else {
                    console.error('❌ [Frontend] 未找到 routing-priority-models 容器');
                }
            }
            
            // 加载场景配置
            const scenes = configData.scenes || [];
            if (scenes.length > 0) {
                console.log(`🎭 [Frontend] 加载 ${scenes.length} 个场景配置`);
                this.loadScenesFromConfig(scenes);
            }
        } catch (error) {
            console.error('❌ [Frontend] 加载小模型路由配置失败:', error);
        }
    }
    
    // 从配置中加载场景到前端界面
    loadScenesFromConfig(scenes) {
        const routingScenesContainer = document.getElementById('routing-scenes');
        if (!routingScenesContainer) {
            console.error('❌ [Frontend] 未找到 routing-scenes 容器');
            return;
        }
        
        // 清空现有场景
        routingScenesContainer.innerHTML = '';
        
        scenes.forEach((scene, index) => {
            const isDefault = scene.is_default || scene.name === '默认对话';
            const sceneHtml = this.createSceneHtml(scene, isDefault);
            routingScenesContainer.insertAdjacentHTML('beforeend', sceneHtml);
            
            console.log(`✅ [Frontend] 已加载场景: ${scene.name}${isDefault ? ' (默认)' : ''}`);
        });
    }
    
    // 创建场景HTML
    createSceneHtml(scene, isDefault = false) {
        const defaultAttributes = isDefault ? 'data-default="true"' : '';
        const defaultIndicator = isDefault ? '<span class="inline-flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full font-medium"><svg class="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>默认场景</span>' : '';
        const deleteButtonStyle = isDefault ? 'style="opacity: 0.3; cursor: not-allowed;" disabled' : '';
        const sceneIcon = this.getSceneIcon(scene.name);
        const modelsValue = Array.isArray(scene.models) ? scene.models.join(', ') : scene.models || '';
        
        return `
        <div class="scene-item bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 hover:shadow-sm transition-all ${isDefault ? 'bg-blue-50 border-blue-200' : ''}" ${defaultAttributes}>
            <!-- 场景头部 -->
            <div class="flex items-start justify-between mb-3">
                <div class="flex items-center flex-1 space-x-3">
                    <div class="flex-shrink-0 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center ${isDefault ? 'bg-blue-100' : ''}">
                        ${sceneIcon}
                    </div>
                    <div class="flex-1">
                        <div class="flex items-center space-x-2 mb-1">
                            <input type="text" class="scene-name text-sm font-medium bg-transparent border-none p-0 focus:outline-none focus:ring-0 focus:border-none placeholder-gray-400 ${isDefault ? 'text-blue-900' : 'text-gray-900'}" 
                                   placeholder="输入场景名称..." value="${scene.name}" ${isDefault ? 'readonly' : ''} 
                                   style="box-shadow: none !important;">
                            ${defaultIndicator}
                        </div>
                        <!-- 隐藏的复选框，仅用于保存配置时读取状态 -->
                        <input type="checkbox" class="scene-enabled hidden" ${scene.enabled ? 'checked' : ''} ${isDefault ? 'disabled' : ''}>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <button class="scene-toggle-btn p-1.5 rounded-md transition-colors ${scene.enabled ? 'text-green-600 hover:bg-green-50 bg-green-100' : 'text-gray-400 hover:bg-gray-50'}" 
                            title="${scene.enabled ? '点击禁用场景' : '点击启用场景'}" ${isDefault ? 'disabled style="opacity: 0.6; cursor: not-allowed;"' : ''}>
                        ${scene.enabled ? 
                            '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>' :
                            '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clip-rule="evenodd"></path></svg>'
                        }
                    </button>
                    <button class="delete-scene p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors" 
                            title="${isDefault ? '默认场景不能删除' : '删除场景'}" ${deleteButtonStyle}>
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1H8a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>
            
            <!-- 场景描述 -->
            <div class="mb-4">
                <label class="block text-xs font-medium text-gray-700 mb-2">
                    <svg class="w-3 h-3 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"></path>
                    </svg>
                    场景描述 <span class="text-gray-500 font-normal">（用于AI意图识别）</span>
                </label>
                <textarea class="scene-description w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" 
                          rows="2" 
                          placeholder="请详细描述此场景的使用情境，包含关键词有助于提高匹配准确度..." 
                          ${isDefault ? 'readonly' : ''}>${scene.description}</textarea>
                <div class="mt-1 text-xs text-gray-500">
                    <span class="text-blue-600">💡 提示：</span>描述越详细，AI意图识别越准确
                </div>
            </div>
            
            <!-- 模型配置 -->
            <div>
                <label class="block text-xs font-medium text-gray-700 mb-2">
                    <svg class="w-3 h-3 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3z"></path>
                    </svg>
                    优选模型列表 <span class="text-gray-500 font-normal">（降级备选）</span>
                </label>
                <div class="relative">
                    <input type="text" class="scene-models w-full px-3 py-2 pr-24 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" 
                           placeholder="例如：qwen-plus, gpt-4o-mini, claude-3-haiku" 
                           value="${modelsValue}" 
                           ${isDefault ? 'readonly' : ''}>
                    <button type="button" class="model-selector-btn absolute right-2 top-1/2 transform -translate-y-1/2 px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors ${isDefault ? 'hidden' : ''}" 
                            title="选择模型">
                        选择
                    </button>
                </div>
                <div class="mt-1 flex items-center justify-between text-xs text-gray-500">
                    <span><span class="text-green-600">✓</span> 多个模型用逗号分隔，按优先级排序</span>
                    <span class="model-count">${modelsValue ? modelsValue.split(',').length : 0} 个模型</span>
                </div>
            </div>
        </div>
        `;
    }
    
    // 根据场景名称获取合适的图标
    getSceneIcon(sceneName) {
        const name = sceneName.toLowerCase();
        if (name.includes('代码') || name.includes('编程') || name.includes('开发')) {
            return '<svg class="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>';
        } else if (name.includes('聊天') || name.includes('对话') || name.includes('闲聊')) {
            return '<svg class="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clip-rule="evenodd"></path></svg>';
        } else if (name.includes('分析') || name.includes('数据')) {
            return '<svg class="w-4 h-4 text-purple-600" fill="currentColor" viewBox="0 0 20 20"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"></path></svg>';
        } else if (name.includes('写作') || name.includes('文档') || name.includes('创作')) {
            return '<svg class="w-4 h-4 text-yellow-600" fill="currentColor" viewBox="0 0 20 20"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"></path></svg>';
        } else {
            return '<svg class="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" clip-rule="evenodd"></path></svg>';
        }
    }
    
    // 恢复默认场景配置
    restoreDefaultScenes() {
        if (!confirm('确定要恢复默认场景配置吗？这将清除当前所有场景并恢复为系统默认的几个场景。')) {
            return;
        }
        
        console.log('🔄 [Frontend] 恢复默认场景配置...');
        
        // 默认场景配置
        const defaultScenes = [
            {
                name: "默认对话",
                description: "当系统无法识别具体场景时使用的默认对话模式",
                models: ["openrouter:qwen/qwen3-coder","openrouter:qwen/qwen3-235b-a22b-2507"],
                enabled: true,
                priority: 0,
                is_default: true
            },
            {
                name: "闲聊对话",
                description: "用户进行日常闲聊、提问或需要一般性对话时",
                models: ["openrouter:qwen/qwen3-coder","openrouter:qwen/qwen3-235b-a22b-2507"],
                enabled: true,
                priority: 1
            },
            {
                name: "代码修改",
                description: "用户需要修改、调试或优化现有代码时",
                models: ["openrouter:anthropic/claude-sonnet-4","openrouter:qwen/qwen3-coder"],
                enabled: true,
                priority: 2
            },
            {
                name: "新功能开发",
                description: "用户需要开发新功能、创建新项目或进行架构设计时",
                models: ["openrouter:qwen/qwen3-coder","openrouter:qwen/qwen3-235b-a22b-2507"],
                enabled: true,
                priority: 3
            }
        ];
        
        // 清空并重新加载场景
        this.loadScenesFromConfig(defaultScenes);
        
        console.log(`✅ [Frontend] 已恢复 ${defaultScenes.length} 个默认场景`);
        
        // 提示用户保存配置
        alert(`已恢复 ${defaultScenes.length} 个默认场景！请记得点击"保存配置"按钮来保存更改。`);
    }

    async loadPlatformModels() {
        console.log('🔍 [Frontend] 开始为平台配置页面加载模型列表...');
        try {
            // 从数据库获取模型列表
            const dbResponse = await fetch('/_api/models/from-db');
            const dbModels = await dbResponse.json();
            console.log(`📋 [Frontend] 为平台配置获取到 ${dbModels.length} 个模型`);
            
            // 按平台分组显示模型
            this.renderPlatformModels(dbModels);
            
        } catch (error) {
            console.error('❌ [Frontend] 加载平台模型列表失败:', error);
        }
    }

    renderPlatformModels(models) {
        const platformTypes = ['dashscope', 'openrouter', 'ollama', 'lmstudio', 'siliconflow', 'openai_compatible'];
        
        // 添加调试日志：显示所有模型的平台分布
        const platformCounts = {};
        models.forEach(model => {
            platformCounts[model.platform] = (platformCounts[model.platform] || 0) + 1;
        });
        console.log('🔍 [Frontend] 所有模型的平台分布:', platformCounts);
        
        platformTypes.forEach(platformType => {
            const modelsDiv = document.getElementById(`${platformType}-models`);
            if (modelsDiv) {
                const platformModels = models.filter(model => model.platform === platformType);
                
                console.log(`🔍 [Frontend] 平台 ${platformType}: 找到 ${platformModels.length} 个模型`);
                if (platformModels.length > 0) {
                    // 显示前几个模型名称用于调试
                    const modelNames = platformModels.slice(0, 3).map(m => m.name).join(', ');
                    console.log(`🔍 [Frontend] ${platformType} 前几个模型: ${modelNames}${platformModels.length > 3 ? '...' : ''}`);
                }
                
                if (platformModels.length > 0) {
                    modelsDiv.innerHTML = platformModels.map(model => 
                        `<span class="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded mr-1 mb-1">${model.name}</span>`
                    ).join('');
                    console.log(`✅ [Frontend] ${platformType} 显示 ${platformModels.length} 个模型`);
                } else {
                    modelsDiv.innerHTML = '<span class="text-gray-500 text-xs">暂无可用模型</span>';
                }
            } else {
                console.log(`⚠️ [Frontend] 未找到平台 ${platformType} 的模型显示容器`);
            }
        });
    }

    async loadGlobalDirectModels() {
        console.log('🔍 [Frontend] 开始加载全局直连模型列表...');
        try {
            // 首先尝试从数据库加载模型（快速显示）
            console.log('💾 [Frontend] 优先从数据库获取模型列表...');
            const dbResponse = await fetch('/_api/models/from-db');
            const dbModels = await dbResponse.json();
            console.log(`📋 [Frontend] 数据库中获取到 ${dbModels.length} 个模型`);
            
            if (dbModels.length > 0) {
                // 有数据库数据，先渲染
                this.renderAvailableModels(dbModels);
                console.log('✅ [Frontend] 数据库模型列表渲染完成');
            } else {
                console.log('⚠️ [Frontend] 数据库中无模型数据，将从API获取...');
            }
            
            // 在后台尝试从API刷新最新模型（可选）
            try {
                console.log('🔄 [Frontend] 后台从API刷新模型列表...');
                const apiResponse = await fetch('/_api/models');
                const apiModels = await apiResponse.json();
                console.log(`📡 [Frontend] API获取到 ${apiModels.length} 个模型`);
                
                // 如果API返回的模型比数据库多，更新显示
                if (apiModels.length > dbModels.length) {
                    console.log('🔄 [Frontend] API模型更多，更新显示...');
                    this.renderAvailableModels(apiModels);
                }
            } catch (apiError) {
                console.log('⚠️ [Frontend] API获取失败，使用数据库数据:', apiError);
                // API失败时，如果数据库也没有数据，才显示空状态
                if (dbModels.length === 0) {
                    this.renderAvailableModels([]);
                }
            }
            
            // 加载已保存的全局直连配置
            await this.loadGlobalDirectConfig();
        } catch (error) {
            console.error('❌ [Frontend] 加载模型列表失败:', error);
        }
    }

    renderAvailableModels(models) {
        console.log(`🎨 [Frontend] 开始渲染 ${models.length} 个可用模型...`);
        
        const availableContainer = document.getElementById('available-models');
        if (!availableContainer) {
            console.error('❌ [Frontend] 未找到 available-models 容器');
            return;
        }
        
        // 存储所有模型数据用于过滤
        this.allGlobalModels = models;
        
        // 渲染模型列表
        this.renderFilteredGlobalModels();
        
        // 设置过滤事件监听器
        const filterInput = document.getElementById('global-model-filter');
        if (filterInput) {
            filterInput.addEventListener('input', () => {
                this.renderFilteredGlobalModels(filterInput.value.trim());
            });
        }
        
        // 初始化Dragula拖拽功能
        this.initDragula();
    }

    renderFilteredGlobalModels(filterText = '') {
        const availableContainer = document.getElementById('available-models');
        const countElement = document.getElementById('global-model-count');
        
        if (!availableContainer || !this.allGlobalModels) return;
        
        console.log('🧹 [Frontend] 清空现有模型容器...');
        availableContainer.innerHTML = '';
        
        // 过滤模型
        const filteredModels = this.allGlobalModels.filter(model => {
            if (!filterText) return true;
            const searchText = filterText.toLowerCase();
            return model.name.toLowerCase().includes(searchText) || 
                   model.id.toLowerCase().includes(searchText) ||
                   model.platform.toLowerCase().includes(searchText);
        });
        
        // 更新计数
        if (countElement) {
            countElement.textContent = `${filteredModels.length} 个模型`;
        }
        
        if (filteredModels.length === 0) {
            availableContainer.innerHTML = `
                <div class="text-center text-gray-500 text-sm py-8 no-drag">
                    ${filterText ? '未找到匹配的模型' : '请先配置平台并刷新模型列表'}
                </div>
            `;
            return;
        }
        
        filteredModels.forEach((model, index) => {
            console.log(`📝 [Frontend] 渲染模型 ${index + 1}: ${model.name} (${model.id})`);
            
            const modelItem = document.createElement('div');
            modelItem.className = 'model-item p-2 mb-2 bg-white border border-gray-200 rounded cursor-pointer hover:bg-blue-50 transition-colors';
            modelItem.dataset.modelId = model.id;
            
            modelItem.innerHTML = `
                <div class="flex items-center justify-between">
                    <div>
                        <div class="text-sm font-medium text-gray-900">${model.name}</div>
                        <div class="text-xs text-gray-500">${model.platform}</div>
                    </div>
                    <div class="text-xs text-green-600">📋</div>
                </div>
            `;
            
            // 添加点击事件
            modelItem.addEventListener('click', () => {
                this.addModelToPriorityByClick(model);
            });
            
            availableContainer.appendChild(modelItem);
        });
        
        console.log('✅ [Frontend] 模型渲染完成，容器中现有模型数量:', availableContainer.children.length);
    }

    initDragula() {
        if (typeof dragula === 'undefined') {
            console.warn('⚠️ [Frontend] Dragula库未加载，跳过拖拽初始化');
            return;
        }

        const availableContainer = document.getElementById('available-models');
        const priorityContainer = document.getElementById('priority-models');
        
        if (!availableContainer || !priorityContainer) {
            console.warn('⚠️ [Frontend] 拖拽容器未找到');
            return;
        }

        // 初始化Dragula
        const drake = dragula([availableContainer, priorityContainer], {
            // 只允许从可用模型拖拽到优先级队列，以及在优先级队列内排序
            accepts: (el, target, source, sibling) => {
                // 不允许拖拽提示文字
                if (el.classList.contains('no-drag')) {
                    return false;
                }
                
                // 从可用模型拖拽到优先级队列
                if (source === availableContainer && target === priorityContainer) {
                    // 检查是否已存在，防止重复添加
                    const modelId = el.dataset.modelId;
                    const existing = priorityContainer.querySelector(`[data-model-id="${modelId}"]`);
                    if (existing) {
                        console.log('⚠️ [Frontend] 模型已存在，阻止拖拽');
                        return false;
                    }
                    return true;
                }
                
                // 在优先级队列内排序
                if (source === priorityContainer && target === priorityContainer) {
                    return true;
                }
                
                return false;
            },
            
            // 复制而不是移动（从可用模型到优先级队列）
            copy: (el, source) => {
                return source === availableContainer;
            },
            
            // 不接受复制到可用模型容器
            copySortSource: false,
            
            // 拖拽手柄
            moves: (el, source, handle, sibling) => {
                // 提示文字不能拖拽
                if (el.classList.contains('no-drag')) {
                    return false;
                }
                
                // 其他元素都可以拖拽
                return true;
            }
        });

        // 拖拽事件监听
        drake.on('drop', (el, target, source, sibling) => {
            console.log('🎯 [Frontend] Dragula drop事件', {
                element: el,
                target: target?.id,
                source: source?.id
            });
            
            // 如果是从可用模型复制到优先级队列
            if (source === availableContainer && target === priorityContainer) {
                // 清空提示文字
                const placeholder = priorityContainer.querySelector('.no-drag');
                if (placeholder) {
                    placeholder.remove();
                }
                
                // 获取模型信息
                const modelName = el.querySelector('.text-sm.font-medium')?.textContent;
                const modelPlatform = el.querySelector('.text-xs.text-gray-500')?.textContent;
                const modelId = el.dataset.modelId;
                
                if (modelName && modelPlatform && modelId) {
                    // 检查是否已存在
                    const existing = priorityContainer.querySelector(`[data-model-id="${modelId}"]`);
                    if (existing && existing !== el) {
                        // 如果已存在，移除复制的元素
                        el.remove();
                        console.log('⚠️ [Frontend] 模型已存在，跳过添加');
                        return;
                    }
                    
                    // 转换为优先级队列格式
                    this.convertToQueueItem(el, { id: modelId, name: modelName, platform: modelPlatform });
                    console.log(`✅ [Frontend] 已添加模型到优先级队列: ${modelName}`);
                }
            }
        });

        drake.on('drag', (el, source) => {
            console.log('🎯 [Frontend] 开始拖拽:', el);
        });

        drake.on('dragend', (el) => {
            console.log('🎯 [Frontend] 拖拽结束:', el);
        });

        // 保存drake实例
        this.dragulaInstance = drake;
    }

    convertToQueueItem(element, model) {
        // 更新元素样式为优先级队列格式
        element.className = 'model-item-dragula';
        element.innerHTML = `
            <div class="flex justify-between items-center">
                <div class="flex items-center">
                    <span class="dragula-handle" title="拖拽排序"></span>
                    <div>
                        <div class="text-sm font-medium text-gray-900">${model.name}</div>
                        <div class="text-xs text-gray-500">${model.platform}</div>
                    </div>
                </div>
                <button class="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors" 
                        onclick="this.closest('.model-item-dragula').remove(); console.log('🗑️ 移除模型: ${model.name}')">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                    </svg>
                </button>
            </div>
        `;
    }

    addModelToPriorityByClick(model) {
        const priorityContainer = document.getElementById('priority-models');
        if (!priorityContainer) return;
        
        // 检查是否已存在
        const existing = priorityContainer.querySelector(`[data-model-id="${model.id}"]`);
        if (existing) {
            console.log('⚠️ [Frontend] 模型已存在，跳过添加');
            return;
        }
        
        // 清空提示文字
        const placeholder = priorityContainer.querySelector('.no-drag');
        if (placeholder) {
            placeholder.remove();
        }
        
        // 创建新的队列项
        const modelItem = document.createElement('div');
        modelItem.className = 'model-item-dragula';
        modelItem.dataset.modelId = model.id;
        
        modelItem.innerHTML = `
            <div class="flex justify-between items-center">
                <div class="flex items-center">
                    <span class="dragula-handle" title="拖拽排序"></span>
                    <div>
                        <div class="text-sm font-medium text-gray-900">${model.name}</div>
                        <div class="text-xs text-gray-500">${model.platform}</div>
                    </div>
                </div>
                <button class="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors" 
                        onclick="this.closest('.model-item-dragula').remove(); console.log('🗑️ 移除模型: ${model.name}')">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                    </svg>
                </button>
            </div>
        `;
        
        priorityContainer.appendChild(modelItem);
        console.log(`✅ [Frontend] 已通过点击添加模型: ${model.name}`);
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.model-item:not(.dragging):not(.drag-placeholder), .model-item-dragula:not(.dragging):not(.drag-placeholder)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    addModelToPriority(model, insertAfter = null) {
        const priorityContainer = document.getElementById('priority-models');
        if (!priorityContainer) return;
        
        // 检查是否已存在
        const existing = priorityContainer.querySelector(`[data-model-id="${model.id}"]`);
        if (existing) return;
        
        // 清空提示文字
        const placeholder = priorityContainer.querySelector('.text-center.text-gray-400');
        if (placeholder) {
            placeholder.remove();
        }
        
        const modelItem = document.createElement('div');
        modelItem.className = 'model-item-dragula cursor-move';
        modelItem.draggable = true;
        modelItem.dataset.modelId = model.id;
        
        modelItem.innerHTML = `
            <div class="flex justify-between items-center">
                <div class="flex items-center">
                    <span class="dragula-handle" title="拖拽排序"></span>
                    <div>
                        <div class="text-sm font-medium text-gray-900">${model.name}</div>
                        <div class="text-xs text-gray-500">${model.platform}</div>
                    </div>
                </div>
                <button class="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors" 
                        onclick="this.closest('.model-item-dragula').remove(); console.log('🗑️ 移除模型: ${model.name}')">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                    </svg>
                </button>
            </div>
        `;
        
        // 添加拖拽事件
        modelItem.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', model.id);
            e.dataTransfer.effectAllowed = 'move';
            modelItem.classList.add('dragging');
            setTimeout(() => {
                modelItem.style.opacity = '0.5';
            }, 0);
        });
        
        modelItem.addEventListener('dragend', (e) => {
            modelItem.classList.remove('dragging');
            modelItem.style.opacity = '1';
        });
        
        // 在指定位置插入
        if (insertAfter == null) {
            priorityContainer.appendChild(modelItem);
        } else {
            priorityContainer.insertBefore(modelItem, insertAfter);
        }
        
        console.log(`✅ [Frontend] 已添加模型到优先级队列: ${model.name}`);
    }
    
    // 移动模型到路由模型优先级列表
    moveModelToRoutingPriority(modelId, modelName, platform) {
        const availableContainer = document.getElementById('routing-available-models');
        const priorityContainer = document.getElementById('routing-priority-models');
        
        // 从可用模型中移除
        const modelItem = availableContainer.querySelector(`[data-model-id="${modelId}"]`);
        if (modelItem) {
            modelItem.remove();
        }
        
        // 检查模型是否已存在于优先级列表
        const existingItem = priorityContainer.querySelector(`[data-model-id="${modelId}"]`);
        if (existingItem) {
            console.log(`⚠️ [Frontend] 路由模型 ${modelName} 已在优先级队列中`);
            return;
        }
        
        // 清空提示文字
        const placeholder = priorityContainer.querySelector('.text-center.text-gray-400');
        if (placeholder) {
            placeholder.remove();
        }
        
        // 添加到路由模型优先级列表
        const priorityItem = document.createElement('div');
        priorityItem.className = 'model-item-dragula cursor-move';
        priorityItem.draggable = true;
        priorityItem.dataset.modelId = modelId;
        priorityItem.innerHTML = `
            <div class="flex justify-between items-center">
                <div class="flex items-center">
                    <span class="dragula-handle" title="拖拽排序"></span>
                    <div>
                        <div class="text-sm font-medium text-gray-900">${modelName}</div>
                        <div class="text-xs text-gray-500">${platform}</div>
                    </div>
                </div>
                <button class="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors" 
                        onclick="monitor.removeModelFromRoutingPriority('${modelId}', '${modelName}', '${platform}')">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                    </svg>
                </button>
            </div>
        `;
        
        // 添加拖拽事件
        priorityItem.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', modelId);
            e.dataTransfer.effectAllowed = 'move';
            priorityItem.classList.add('dragging');
            setTimeout(() => {
                priorityItem.style.opacity = '0.5';
            }, 0);
        });
        
        priorityItem.addEventListener('dragend', (e) => {
            priorityItem.classList.remove('dragging');
            priorityItem.style.opacity = '1';
        });
        
        priorityContainer.appendChild(priorityItem);
        
        console.log(`✅ [Frontend] 已添加路由模型到优先级队列: ${modelName}`);
    }
    
    // 从路由模型优先级列表中移除模型
    removeModelFromRoutingPriority(modelId, modelName, platform) {
        const priorityContainer = document.getElementById('routing-priority-models');
        const availableContainer = document.getElementById('routing-available-models');
        
        // 从优先级列表中移除
        const priorityItem = priorityContainer.querySelector(`[data-model-id="${modelId}"]`);
        if (priorityItem) {
            priorityItem.remove();
        }
        
        // 添加回可用模型列表
        const modelItem = document.createElement('div');
        modelItem.className = 'model-item p-2 mb-2 bg-white border border-gray-200 rounded cursor-pointer hover:bg-blue-50 transition-colors';
        modelItem.dataset.modelId = modelId;
        
        const preferredModels = ['qwen-plus', 'qwen-turbo', 'gpt-4o-mini', 'gpt-3.5-turbo'];
        const isRecommended = preferredModels.some(preferred => modelId.includes(preferred));
        
        modelItem.innerHTML = `
            <div class="flex items-center justify-between">
                <div>
                    <div class="text-sm font-medium text-gray-900">${modelName}</div>
                    <div class="text-xs text-gray-500">${platform}${isRecommended ? ' - 推荐路由模型' : ''}</div>
                </div>
                <div class="text-xs text-blue-600">🎯</div>
            </div>
        `;
        
        // 添加点击事件
        modelItem.addEventListener('click', () => {
            this.moveModelToRoutingPriority(modelId, modelName, platform);
        });
        
        availableContainer.appendChild(modelItem);
        
        console.log(`✅ [Frontend] 已将路由模型移回可用列表: ${modelName}`);
    }
    
    // 初始化路由模型拖拽功能
    initRoutingDragula() {
        if (typeof dragula === 'undefined') {
            console.warn('⚠️ [Frontend] Dragula库未加载，跳过路由模型拖拽初始化');
            return;
        }

        const availableContainer = document.getElementById('routing-available-models');
        const priorityContainer = document.getElementById('routing-priority-models');
        
        if (!availableContainer || !priorityContainer) {
            console.warn('⚠️ [Frontend] 路由模型拖拽容器未找到');
            return;
        }

        // 初始化路由模型Dragula
        const routingDrake = dragula([availableContainer, priorityContainer], {
            accepts: (el, target, source, sibling) => {
                // 不允许拖拽提示文字
                if (el.classList.contains('no-drag')) {
                    return false;
                }
                
                // 从可用模型拖拽到优先级队列
                if (source === availableContainer && target === priorityContainer) {
                    // 检查是否已存在，防止重复添加
                    const modelId = el.dataset.modelId;
                    const existing = priorityContainer.querySelector(`[data-model-id="${modelId}"]`);
                    if (existing) {
                        console.log('⚠️ [Frontend] 路由模型已存在，阻止拖拽');
                        return false;
                    }
                    return true;
                }
                
                // 在优先级队列内排序
                if (source === priorityContainer && target === priorityContainer) {
                    return true;
                }
                
                return false;
            },
            
            copy: (el, source) => {
                return source === availableContainer;
            },
            
            copySortSource: false,
            
            moves: (el, source, handle, sibling) => {
                if (el.classList.contains('no-drag')) {
                    return false;
                }
                return true;
            }
        });

        // 监听拖拽事件
        routingDrake.on('drop', (el, target, source, sibling) => {
            if (source === availableContainer && target === priorityContainer) {
                // 从可用模型拖拽到优先级队列，需要转换元素格式
                const modelId = el.dataset.modelId;
                const modelName = el.querySelector('.text-sm.font-medium')?.textContent;
                const platformElement = el.querySelector('.text-xs.text-gray-500');
                let platform = platformElement ? platformElement.textContent.trim() : 'unknown';
                
                // 清理平台名称，移除额外的文本
                platform = platform.replace(/ - 推荐路由模型.*$/, '').trim();
                
                console.log(`🔄 [Frontend] 转换拖拽的路由模型: ${modelName} (${platform})`);
                
                // 检查是否已存在，防止重复添加
                const existing = priorityContainer.querySelector(`[data-model-id="${modelId}"]`);
                if (existing && existing !== el) {
                    // 如果已存在，移除复制的元素
                    el.remove();
                    console.log('⚠️ [Frontend] 路由模型已存在，跳过添加');
                    return;
                }
                
                // 清空提示文字
                const placeholder = priorityContainer.querySelector('.text-center.text-gray-400, .no-drag');
                if (placeholder) {
                    placeholder.remove();
                }
                
                // 转换为正确的优先级队列格式
                el.className = 'model-item-dragula cursor-move';
                el.draggable = true;
                el.innerHTML = `
                    <div class="flex justify-between items-center">
                        <div class="flex items-center">
                            <span class="dragula-handle" title="拖拽排序"></span>
                            <div>
                                <div class="text-sm font-medium text-gray-900">${modelName}</div>
                                <div class="text-xs text-gray-500">${platform}</div>
                            </div>
                        </div>
                        <button class="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors" 
                                onclick="monitor.removeModelFromRoutingPriority('${modelId}', '${modelName}', '${platform}')">
                            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"></path>
                            </svg>
                        </button>
                    </div>
                `;
                
                console.log(`✅ [Frontend] 路由模型拖拽并转换完成: ${modelName}`);
            } else if (target === priorityContainer) {
                console.log('✅ [Frontend] 路由模型拖拽排序完成');
            }
        });

        console.log('✅ [Frontend] 路由模型拖拽功能初始化完成');
    }

    async saveConfig() {
        try {
            // 判断当前激活的模式
            const activeTab = document.querySelector('.config-tab.active').id;
            console.log(`💾 [Frontend] 保存配置，当前模式: ${activeTab}`);
            
            // 获取选中的工作模式
            const selectedWorkMode = document.querySelector('input[name="work-mode"]:checked')?.value || 'claude_code';
            console.log(`💾 [Frontend] 准备保存配置，选中的工作模式: ${selectedWorkMode}`);
            
            let config = {
                local_path: this.localPathInput.value.trim(),
                target_url: this.targetUrlInput.value.trim(),
                current_work_mode: selectedWorkMode
            };
            console.log(`📋 [Frontend] 配置数据:`, config);

            if (!config.local_path || !config.target_url) {
                alert('请填写完整的配置信息');
                return;
            }

            // 根据不同模式设置不同的配置
            switch(selectedWorkMode) {
                case 'claude_code':
                    // Claude Code模式：禁用多平台转发
                    config.use_multi_platform = false;
                    console.log('📋 [Frontend] Claude Code模式：禁用多平台转发');
                    break;
                
                case 'global_direct':
                    // 多平台转发模式：启用多平台转发
                    config.use_multi_platform = true;
                    console.log('📋 [Frontend] 多平台转发模式：启用多平台转发');
                    await this.savePlatformConfigs();
                    await this.saveGlobalDirectConfig();
                    break;
                
                case 'smart_routing':
                    // 小模型路由模式：启用多平台转发
                    config.use_multi_platform = true;
                    console.log('📋 [Frontend] 小模型路由模式：启用多平台转发');
                    await this.savePlatformConfigs();
                    await this.saveSmartRoutingConfig();
                    break;
            }

            console.log(`🚀 [Frontend] 发送配置保存请求...`);
            const response = await fetch('/control/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(config)
            });

            if (response.ok) {
                const result = await response.json();
                console.log(`✅ [Frontend] 配置保存成功:`, result);
                this.updateConfigDisplay(config);
                this.hideConfigModal();
                alert('配置已保存');
            } else {
                console.error(`❌ [Frontend] 配置保存失败: ${response.status}`);
                alert('保存配置失败');
            }
        } catch (error) {
            console.error('保存配置失败:', error);
            alert('保存配置时出错');
        }
    }

    async savePlatformConfigs() {
        const platforms = ['dashscope', 'openrouter', 'ollama', 'lmstudio', 'siliconflow', 'openai_compatible'];
        
        for (const platform of platforms) {
            const enabled = document.getElementById(`${platform}-enabled`)?.checked || false;
            const apiKey = document.getElementById(`${platform}-api-key`)?.value || '';
            const baseUrl = document.getElementById(`${platform}-base-url`)?.value || '';
            
            const platformData = {
                platform_type: platform,
                enabled: enabled,
                api_key: apiKey,
                base_url: baseUrl
            };
            
            try {
                await fetch('/_api/platforms', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(platformData)
                });
            } catch (error) {
                console.error(`保存${platform}配置失败:`, error);
            }
        }
    }

    async saveRoutingConfig() {
        console.log('💾 [Frontend] 保存路由配置（已废弃的方法）');
        // 这个方法已经被 saveGlobalDirectConfig 和 saveSmartRoutingConfig 替代
    }

    async saveGlobalDirectConfig() {
        console.log('💾 [Frontend] 保存全局直连配置...');
        try {
            // 获取优先级模型列表
            const priorityContainer = document.getElementById('priority-models');
            const modelItems = priorityContainer.querySelectorAll('.model-item, .model-item-dragula');
            const modelPriorityList = Array.from(modelItems).map(item => {
                const modelId = item.dataset.modelId;
                const platformElement = item.querySelector('.text-xs.text-gray-500');
                const platform = platformElement ? platformElement.textContent.trim() : 'unknown';
                
                // 检查是否已经有正确的平台前缀（dashscope:, openrouter:, ollama:, lmstudio:, siliconflow:, openai_compatible:）
                const validPlatforms = ['dashscope', 'openrouter', 'ollama', 'lmstudio', 'siliconflow', 'openai_compatible'];
                const hasValidPlatformPrefix = validPlatforms.some(p => modelId.startsWith(p + ':'));
                
                if (hasValidPlatformPrefix) {
                    // 已经有正确的平台前缀，直接返回
                    return modelId;
                } else {
                    // 没有正确的平台前缀，添加平台前缀
                    return `${platform}:${modelId}`;
                }
            });
            
            const configData = {
                model_priority_list: modelPriorityList
            };
            
            await fetch('/_api/routing', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    config_name: 'global_direct_default',
                    config_type: 'global_direct',
                    config_data: configData
                })
            });
            
            console.log(`✅ [Frontend] 全局直连配置已保存，优先级模型: ${modelPriorityList.length} 个`);
        } catch (error) {
            console.error('❌ [Frontend] 保存全局直连配置失败:', error);
        }
    }

    async loadGlobalDirectConfig() {
        console.log('🔄 [Frontend] 加载全局直连配置...');
        try {
            const response = await fetch('/_api/routing');
            const routingConfig = await response.json();
            
            console.log('📋 [Frontend] 路由配置数据:', routingConfig);
            
            // 优先从all_configs中查找全局直连配置
            let configData = null;
            let modelPriorityList = [];
            
            if (routingConfig.all_configs && routingConfig.all_configs.global_direct) {
                configData = routingConfig.all_configs.global_direct.data;
                modelPriorityList = configData.model_priority_list || [];
                console.log(`🎯 [Frontend] 从all_configs加载全局直连配置，包含 ${modelPriorityList.length} 个模型`);
            }
            // 兼容旧格式：从active_config加载
            else if (routingConfig.active_config && 
                routingConfig.active_config.type === 'global_direct' && 
                routingConfig.active_config.data) {
                
                configData = routingConfig.active_config.data;
                modelPriorityList = configData.model_priority_list || [];
                console.log(`🎯 [Frontend] 从active_config加载全局直连配置，包含 ${modelPriorityList.length} 个模型`);
            }
            
            if (modelPriorityList.length > 0) {
                
                console.log(`🎯 [Frontend] 恢复优先级队列，包含 ${modelPriorityList.length} 个模型`);
                
                // 恢复优先级队列显示
                await this.restorePriorityQueue(modelPriorityList);
            } else {
                console.log('ℹ️ [Frontend] 没有找到全局直连配置，优先级队列保持空');
            }
        } catch (error) {
            console.error('❌ [Frontend] 加载全局直连配置失败:', error);
        }
    }

    async restorePriorityQueue(modelPriorityList) {
        console.log('🔧 [Frontend] 开始恢复优先级队列...');
        
        const priorityContainer = document.getElementById('priority-models');
        if (!priorityContainer) {
            console.error('❌ [Frontend] 未找到 priority-models 容器');
            return;
        }
        
        // 清空现有内容
        priorityContainer.innerHTML = '';
        
        if (!modelPriorityList || modelPriorityList.length === 0) {
            // 显示空状态提示
            priorityContainer.innerHTML = `
                <div class="text-center text-gray-500 text-sm py-8 no-drag">
                    将模型从左侧拖拽到这里设置优先级
                </div>
            `;
            return;
        }
        
        // 恢复每个模型（异步处理）
        for (const [index, modelSpec] of modelPriorityList.entries()) {
            try {
                // 使用与后端相同的解析逻辑：只分割第一个冒号
                const colonIndex = modelSpec.indexOf(':');
                if (colonIndex === -1) {
                    throw new Error(`Invalid model spec format: ${modelSpec}`);
                }
                const platform = modelSpec.substring(0, colonIndex);
                const modelId = modelSpec.substring(colonIndex + 1);
                
                // 从可用模型或数据库中查找匹配的模型信息
                const modelInfo = await this.findModelInfo(platform, modelId);
                if (modelInfo) {
                    const queueItem = this.createPriorityQueueItem(modelInfo, index + 1, false);
                    priorityContainer.appendChild(queueItem);
                    console.log(`✅ [Frontend] 恢复模型: ${modelInfo.name} (${modelSpec})`);
                } else {
                    // 创建缺失模型的标红项
                    const missingModelInfo = {
                        id: modelSpec,  // 保持完整的模型规格
                        name: modelId,
                        platform: platform
                    };
                    const queueItem = this.createPriorityQueueItem(missingModelInfo, index + 1, true);
                    priorityContainer.appendChild(queueItem);
                    console.warn(`⚠️ [Frontend] 恢复缺失模型（标红显示）: ${modelSpec}`);
                }
            } catch (error) {
                console.error(`❌ [Frontend] 恢复模型失败: ${modelSpec}`, error);
            }
        }
        
        console.log(`✅ [Frontend] 优先级队列恢复完成，包含 ${modelPriorityList.length} 个模型`);
    }

    async findModelInfo(platform, modelId) {
        console.log(`🔍 [Frontend] 查找模型: platform="${platform}", modelId="${modelId}"`);
        
        // 优先从当前可用模型中查找
        if (this.allGlobalModels) {
            console.log(`📋 [Frontend] 在 ${this.allGlobalModels.length} 个全局模型中查找...`);
            
            // 尝试多种匹配方式
            let found = this.allGlobalModels.find(model => 
                model.platform.toLowerCase() === platform.toLowerCase() && 
                model.id === modelId
            );
            
            // 如果找不到，尝试匹配带平台前缀的ID
            if (!found) {
                found = this.allGlobalModels.find(model => 
                    model.platform.toLowerCase() === platform.toLowerCase() && 
                    model.id === `${platform}:${modelId}`
                );
            }
            
            // 如果还找不到，尝试去掉重复前缀
            if (!found) {
                const cleanId = modelId.replace(new RegExp(`^${platform}:`), '');
                found = this.allGlobalModels.find(model => 
                    model.platform.toLowerCase() === platform.toLowerCase() && 
                    model.id.replace(new RegExp(`^${platform}:`), '') === cleanId
                );
            }
            
            if (found) {
                console.log(`✅ [Frontend] 在全局模型中找到: ${found.name}`);
                return found;
            } else {
                console.log(`⚠️ [Frontend] 在全局模型中未找到 ${platform}:${modelId}`);
            }
        }
        
        // 如果在当前可用模型中找不到，从数据库查找
        try {
            if (!this.dbModels) {
                console.log('📋 [Frontend] 从数据库获取模型信息...');
                const response = await fetch('/_api/models/from-db');
                this.dbModels = await response.json();
                console.log(`💾 [Frontend] 数据库中有 ${this.dbModels.length} 个模型`);
            }
            
            // 尝试多种匹配方式
            let found = this.dbModels.find(model => 
                model.platform.toLowerCase() === platform.toLowerCase() && 
                model.id === modelId
            );
            
            // 如果找不到，尝试匹配带平台前缀的ID
            if (!found) {
                found = this.dbModels.find(model => 
                    model.platform.toLowerCase() === platform.toLowerCase() && 
                    model.id === `${platform}:${modelId}`
                );
            }
            
            // 如果还找不到，尝试去掉重复前缀
            if (!found) {
                const cleanId = modelId.replace(new RegExp(`^${platform}:`), '');
                found = this.dbModels.find(model => 
                    model.platform.toLowerCase() === platform.toLowerCase() && 
                    model.id.replace(new RegExp(`^${platform}:`), '') === cleanId
                );
            }
            
            if (found) {
                console.log(`✅ [Frontend] 在数据库中找到: ${found.name}`);
                return found;
            } else {
                console.log(`❌ [Frontend] 在数据库中也未找到 ${platform}:${modelId}`);
                // 显示前几个数据库模型以供调试
                const sampleModels = this.dbModels.slice(0, 3);
                console.log('📋 [Frontend] 数据库模型样本:', sampleModels);
                return null;
            }
        } catch (error) {
            console.error('❌ [Frontend] 从数据库获取模型信息失败:', error);
            return null;
        }
    }

    createPriorityQueueItem(model, priority, isMissing = false) {
        const queueItem = document.createElement('div');
        
        // 根据是否缺失设置不同的样式
        if (isMissing) {
            queueItem.className = 'model-item-dragula p-3 mb-2 bg-red-50 border border-red-300 rounded cursor-move';
        } else {
            queueItem.className = 'model-item-dragula p-3 mb-2 bg-blue-50 border border-blue-200 rounded cursor-move';
        }
        
        queueItem.dataset.modelId = model.id;
        queueItem.draggable = true;
        
        const statusIcon = isMissing ? 
            `<svg class="w-4 h-4 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
            </svg>` : '';
        
        const statusText = isMissing ? 
            `<span class="text-xs text-red-600 font-medium">⚠️ 模型不可用</span>` : 
            `<span class="text-xs text-blue-600 font-medium">优先级 ${priority}</span>`;
        
        const textColor = isMissing ? 'text-red-700' : 'text-gray-900';
        const platformColor = isMissing ? 'text-red-500' : 'text-gray-500';
        
        queueItem.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center">
                    ${statusIcon}
                    <div>
                        <div class="text-sm font-medium ${textColor}">${model.name}</div>
                        <div class="text-xs ${platformColor}">${model.platform}</div>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    ${statusText}
                    <button class="remove-btn text-red-500 hover:text-red-700" onclick="this.parentElement.parentElement.parentElement.remove()">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
        
        // 如果是缺失模型，添加提示信息
        if (isMissing) {
            const tooltip = document.createElement('div');
            tooltip.className = 'text-xs text-red-600 mt-1 px-2 py-1 bg-red-100 rounded';
            tooltip.innerHTML = `此模型在当前平台配置中不可用，请检查平台连接或模型ID`;
            queueItem.appendChild(tooltip);
        }
        
        return queueItem;
    }

    async saveSmartRoutingConfig() {
        console.log('💾 [Frontend] 保存小模型路由配置...');
        
        // 验证所有场景配置
        if (!this.validateAllScenes()) {
            console.warn('⚠️ [Frontend] 场景配置验证失败，请检查错误提示');
            alert('场景配置验证失败，请检查错误提示后重试');
            return;
        }
        
        try {
            // 获取路由模型优先级列表
            const routingModels = [];
            const routingPriorityContainer = document.getElementById('routing-priority-models');
            if (routingPriorityContainer) {
                const priorityItems = routingPriorityContainer.querySelectorAll('.model-item-dragula');
                console.log(`🔍 [Frontend] 找到 ${priorityItems.length} 个优先级模型项`);
                
                priorityItems.forEach((item, index) => {
                    const modelId = item.dataset.modelId;
                    if (modelId) {
                        const platformElement = item.querySelector('.text-xs.text-gray-500');
                        let platform = platformElement ? platformElement.textContent.trim() : 'unknown';
                        
                        // 清理平台名称，移除额外的文本
                        platform = platform.replace(/ - 推荐路由模型.*$/, '').trim();
                        
                        // 如果已经包含平台前缀，直接返回；否则添加平台前缀
                        const fullModelId = modelId.includes(':') ? modelId : `${platform}:${modelId}`;
                        routingModels.push(fullModelId);
                        console.log(`📝 [Frontend] 路由模型 ${index + 1}: ${fullModelId} (原始: ${modelId}, 平台: ${platform})`);
                    }
                });
            } else {
                console.error('❌ [Frontend] 未找到 routing-priority-models 容器');
            }
            
            // 获取所有场景配置
            const scenes = [];
            const sceneItems = document.querySelectorAll('.scene-item');
            
            sceneItems.forEach((item, index) => {
                const sceneName = item.querySelector('.scene-name').value;
                const sceneDescription = item.querySelector('.scene-description').value;
                const sceneModels = item.querySelector('.scene-models').value;
                const sceneEnabled = item.querySelector('.scene-enabled').checked;
                const isDefault = item.hasAttribute('data-default');
                
                if (sceneName && sceneDescription && sceneModels) {
                    const sceneConfig = {
                        name: sceneName,
                        description: sceneDescription,
                        models: sceneModels.split(',').map(m => m.trim()),
                        enabled: sceneEnabled,
                        priority: index
                    };
                    
                    // 如果是默认场景，添加 is_default 标记
                    if (isDefault) {
                        sceneConfig.is_default = true;
                    }
                    
                    scenes.push(sceneConfig);
                }
            });
            
            const configData = {
                routing_models: routingModels,
                scenes: scenes
            };
            
            await fetch('/_api/routing', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    config_name: 'smart_routing_default',
                    config_type: 'smart_routing',
                    config_data: configData
                })
            });
            
            console.log(`✅ [Frontend] 小模型路由配置已保存，路由模型数: ${routingModels.length}，场景数: ${scenes.length}`);
            console.log(`📋 [Frontend] 保存的路由模型列表: `, routingModels);
        } catch (error) {
            console.error('❌ [Frontend] 保存小模型路由配置失败:', error);
        }
    }
    
    // 添加新场景
    addNewScene() {
        const routingScenesContainer = document.getElementById('routing-scenes');
        if (!routingScenesContainer) return;
        
        const newScene = {
            name: '',
            description: '',
            models: '',
            enabled: true
        };
        
        const newSceneHtml = this.createSceneHtml(newScene, false);
        routingScenesContainer.insertAdjacentHTML('beforeend', newSceneHtml);
        
        // 聚焦到新添加的场景名称输入框
        const newSceneItem = routingScenesContainer.lastElementChild;
        const nameInput = newSceneItem.querySelector('.scene-name');
        if (nameInput) {
            nameInput.focus();
        }
        
        console.log('✅ [Frontend] 已添加新场景');
    }
    
    // 删除场景
    deleteScene(deleteButton) {
        const sceneItem = deleteButton.closest('.scene-item');
        if (!sceneItem) return;
        
        const sceneName = sceneItem.querySelector('.scene-name').value.trim() || '未命名场景';
        
        // 检查是否为默认场景（不允许删除）
        if (sceneItem.hasAttribute('data-default') || sceneName === '默认对话') {
            alert('默认场景不能删除！');
            console.log(`❌ [Frontend] 尝试删除默认场景被阻止: ${sceneName}`);
            return;
        }
        
        // 添加确认对话框
        if (!confirm(`确定要删除场景"${sceneName}"吗？\n\n删除后将无法恢复。`)) {
            console.log(`❌ [Frontend] 用户取消删除场景: ${sceneName}`);
            return;
        }
        
        sceneItem.remove();
        console.log(`✅ [Frontend] 已删除场景: ${sceneName}`);
        
        // 可选：显示删除成功的提示
        // 创建临时提示消息
        const toast = document.createElement('div');
        toast.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-md shadow-lg z-50 transition-opacity';
        toast.textContent = `场景"${sceneName}"已删除`;
        document.body.appendChild(toast);
        
        // 3秒后自动消失
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }, 3000);
    }
    
    // 切换场景模板选择器
    toggleSceneTemplateSelector() {
        const selector = document.getElementById('scene-template-selector');
        if (selector) {
            selector.classList.toggle('hidden');
        }
    }
    
    // 从模板添加场景
    addSceneFromTemplate(templateType) {
        console.log(`📋 [Frontend] 从模板添加场景: ${templateType}`);
        
        const templates = {
            coding: {
                name: "代码开发",
                description: "用于编程、调试、代码审查、技术问题解答等开发相关任务",
                models: "openrouter:anthropic/claude-sonnet-4, openrouter:qwen/qwen3-coder, openrouter:gpt-4o-latest"
            },
            chat: {
                name: "日常对话",
                description: "用于日常闲聊、一般性问答、知识咨询等通用交流场景",
                models: "openrouter:qwen/qwen3-235b-a22b-2507, openrouter:gpt-4o-mini"
            },
            analysis: {
                name: "数据分析",
                description: "用于数据处理、统计分析、图表生成、报表制作等数据相关任务",
                models: "openrouter:anthropic/claude-sonnet-4, openrouter:gpt-4o-latest, openrouter:qwen/qwen3-235b-a22b-2507"
            },
            writing: {
                name: "文档写作",
                description: "用于文档编写、报告撰写、文案创作、内容生成等写作任务",
                models: "openrouter:anthropic/claude-sonnet-4, openrouter:gpt-4o-latest, openrouter:qwen/qwen3-235b-a22b-2507"
            }
        };
        
        const template = templates[templateType];
        if (template) {
            const routingScenesContainer = document.getElementById('routing-scenes');
            if (routingScenesContainer) {
                const newSceneHtml = this.createSceneHtml(template, false);
                routingScenesContainer.insertAdjacentHTML('beforeend', newSceneHtml);
                
                // 聚焦到新添加的场景
                const newSceneItem = routingScenesContainer.lastElementChild;
                const nameInput = newSceneItem.querySelector('.scene-name');
                if (nameInput) {
                    nameInput.focus();
                    nameInput.select();
                }
                
                console.log(`✅ [Frontend] 已从模板添加场景: ${template.name}`);
            }
        }
        
        // 隐藏模板选择器
        this.toggleSceneTemplateSelector();
    }
    
    // 显示模型选择器
    showModelSelector(button) {
        console.log('🎯 [Frontend] 显示模型选择器');
        
        // 找到对应的输入框
        const sceneItem = button.closest('.scene-item');
        const modelsInput = sceneItem.querySelector('.scene-models');
        
        if (!modelsInput) return;
        
        // 获取当前已选择的模型
        const currentModels = modelsInput.value.split(',').map(m => m.trim()).filter(m => m);
        
        // 创建模型选择弹窗
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden">
                <div class="p-4 border-b border-gray-200">
                    <div class="flex items-center justify-between mb-3">
                        <h3 class="text-lg font-semibold text-gray-900">选择模型</h3>
                        <button class="close-modal text-gray-400 hover:text-gray-600 p-1">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                    <!-- 搜索过滤框 -->
                    <div class="relative">
                        <input type="text" id="model-search-input" class="w-full px-3 py-2 pl-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" 
                               placeholder="搜索模型名称、平台或描述...">
                        <svg class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                        </svg>
                    </div>
                    <!-- 已选择的模型数量提示 -->
                    <div class="mt-2 text-sm text-gray-600">
                        <span id="selected-count-display">已选择 ${currentModels.length} 个模型</span>
                        ${currentModels.length > 0 ? `<span class="ml-2 text-blue-600">· 当前: ${currentModels.slice(0, 2).join(', ')}${currentModels.length > 2 ? '...' : ''}</span>` : ''}
                    </div>
                </div>
                <div class="p-4 max-h-96 overflow-y-auto">
                    <div class="grid grid-cols-1 gap-2" id="model-selector-list">
                        <div class="text-center text-gray-500 py-8">正在加载模型列表...</div>
                    </div>
                </div>
                <div class="p-4 border-t border-gray-200 flex justify-between items-center">
                    <div class="text-sm text-gray-500">
                        <span id="filtered-count-display">显示所有模型</span>
                    </div>
                    <div class="flex space-x-3">
                        <button class="close-modal px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-md">
                            取消
                        </button>
                        <button class="confirm-selection px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md">
                            <span id="confirm-btn-text">确认选择 (${currentModels.length})</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 绑定事件
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.closest('.close-modal')) {
                modal.remove();
            }
            // 修复确认按钮点击事件 - 使用closest查找按钮元素
            if (e.target.closest('.confirm-selection')) {
                this.confirmModelSelection(modal, modelsInput);
            }
            if (e.target.classList.contains('model-item-checkbox')) {
                this.updateModelSelectorCount(modal);
            }
        });
        
        // 绑定搜索框事件
        const searchInput = modal.querySelector('#model-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterModelSelectorList(modal, e.target.value.trim());
            });
        }
        
        // 加载模型列表
        this.loadModelSelectorList(modal, currentModels);
    }
    
    // 加载模型选择器列表
    async loadModelSelectorList(modal, selectedModels = []) {
        try {
            const response = await fetch('/_api/models/from-db');
            const models = await response.json();
            
            const listContainer = modal.querySelector('#model-selector-list');
            if (models.length === 0) {
                listContainer.innerHTML = '<div class="text-center text-gray-500 py-8">暂无可用模型</div>';
                return;
            }
            
            // 存储原始模型数据供过滤使用
            modal._allModels = models;
            modal._selectedModels = selectedModels;
            
            // 渲染模型列表
            this.renderModelSelectorList(modal, models, selectedModels);
            
        } catch (error) {
            console.error('❌ [Frontend] 加载模型选择器列表失败:', error);
            modal.querySelector('#model-selector-list').innerHTML = 
                '<div class="text-center text-red-500 py-8">加载模型列表失败</div>';
        }
    }
    
    // 渲染模型选择器列表
    renderModelSelectorList(modal, models, selectedModels = []) {
        const listContainer = modal.querySelector('#model-selector-list');
        
        // 按平台分组
        const modelsByPlatform = {};
        models.forEach(model => {
            if (!modelsByPlatform[model.platform]) {
                modelsByPlatform[model.platform] = [];
            }
            modelsByPlatform[model.platform].push(model);
        });
        
        let html = '';
        Object.entries(modelsByPlatform).forEach(([platform, platformModels]) => {
            html += `
                <div class="mb-4 platform-group" data-platform="${platform}">
                    <h4 class="text-sm font-medium text-gray-900 mb-2 capitalize flex items-center">
                        <span class="w-2 h-2 rounded-full mr-2 ${this.getPlatformColor(platform)}"></span>
                        ${platform} <span class="ml-1 text-xs text-gray-500">(${platformModels.length})</span>
                    </h4>
                    <div class="space-y-1">
            `;
            
            platformModels.forEach(model => {
                // 生成完整的模型标识符（考虑Ollama的特殊格式）
                const fullModelId = this.generateFullModelId(model);
                const isSelected = selectedModels.includes(fullModelId);
                
                html += `
                    <label class="flex items-center p-2 rounded cursor-pointer transition-colors model-item ${isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'}" 
                           data-model-id="${fullModelId}" data-platform="${platform}" data-model-name="${model.name}">
                        <input type="checkbox" class="model-item-checkbox w-4 h-4 text-blue-600 border-gray-300 rounded" 
                               value="${fullModelId}" ${isSelected ? 'checked' : ''}>
                        <div class="ml-3 flex-1">
                            <div class="text-sm font-medium ${isSelected ? 'text-blue-900' : 'text-gray-900'}">${model.name}</div>
                            <div class="text-xs ${isSelected ? 'text-blue-600' : 'text-gray-500'}">${fullModelId}</div>
                        </div>
                    </label>
                `;
            });
            
            html += `
                    </div>
                </div>
            `;
        });
        
        listContainer.innerHTML = html;
        
        // 更新计数显示
        this.updateModelSelectorCount(modal);
    }
    
    // 生成完整的模型标识符
    generateFullModelId(model) {
        const platform = model.platform.toLowerCase();
        const modelId = model.id;
        
        // 如果模型ID已经包含平台前缀，直接返回
        if (modelId.startsWith(platform + ':')) {
            return modelId;
        }
        
        // 为不同平台生成正确的格式
        return `${platform}:${modelId}`;
    }
    
    // 获取平台颜色
    getPlatformColor(platform) {
        const colors = {
            'dashscope': 'bg-blue-500',
            'openrouter': 'bg-purple-500',
            'ollama': 'bg-green-500',
            'lmstudio': 'bg-orange-500'
        };
        return colors[platform.toLowerCase()] || 'bg-gray-500';
    }
    
    // 过滤模型列表
    filterModelSelectorList(modal, searchText) {
        if (!modal._allModels) return;
        
        let filteredModels = modal._allModels;
        
        if (searchText) {
            const searchLower = searchText.toLowerCase();
            filteredModels = modal._allModels.filter(model => {
                const fullModelId = this.generateFullModelId(model);
                return model.name.toLowerCase().includes(searchLower) ||
                       model.id.toLowerCase().includes(searchLower) ||
                       model.platform.toLowerCase().includes(searchLower) ||
                       fullModelId.toLowerCase().includes(searchLower);
            });
        }
        
        // 重新渲染过滤后的列表
        this.renderModelSelectorList(modal, filteredModels, modal._selectedModels);
        
        // 更新过滤结果显示
        const filteredCountDisplay = modal.querySelector('#filtered-count-display');
        if (filteredCountDisplay) {
            if (searchText) {
                filteredCountDisplay.textContent = `显示 ${filteredModels.length} 个匹配结果`;
            } else {
                filteredCountDisplay.textContent = `显示所有 ${modal._allModels.length} 个模型`;
            }
        }
    }
    
    // 更新模型选择器的计数显示
    updateModelSelectorCount(modal) {
        const checkboxes = modal.querySelectorAll('.model-item-checkbox:checked');
        const selectedCount = checkboxes.length;
        
        // 更新确认按钮文字
        const confirmBtnText = modal.querySelector('#confirm-btn-text');
        if (confirmBtnText) {
            confirmBtnText.textContent = `确认选择 (${selectedCount})`;
        }
        
        // 更新已选择数量显示
        const selectedCountDisplay = modal.querySelector('#selected-count-display');
        if (selectedCountDisplay) {
            selectedCountDisplay.textContent = `已选择 ${selectedCount} 个模型`;
        }
        
        // 更新选中模型的样式
        modal.querySelectorAll('.model-item').forEach(item => {
            const checkbox = item.querySelector('.model-item-checkbox');
            const isChecked = checkbox.checked;
            
            if (isChecked) {
                item.classList.add('bg-blue-50', 'border-blue-200');
                item.classList.remove('border-transparent');
                
                // 更新文字颜色
                const nameElement = item.querySelector('.text-sm.font-medium');
                const idElement = item.querySelector('.text-xs');
                if (nameElement) {
                    nameElement.classList.remove('text-gray-900');
                    nameElement.classList.add('text-blue-900');
                }
                if (idElement) {
                    idElement.classList.remove('text-gray-500');
                    idElement.classList.add('text-blue-600');
                }
            } else {
                item.classList.remove('bg-blue-50', 'border-blue-200');
                item.classList.add('border-transparent');
                
                // 恢复文字颜色
                const nameElement = item.querySelector('.text-sm.font-medium');
                const idElement = item.querySelector('.text-xs');
                if (nameElement) {
                    nameElement.classList.remove('text-blue-900');
                    nameElement.classList.add('text-gray-900');
                }
                if (idElement) {
                    idElement.classList.remove('text-blue-600');
                    idElement.classList.add('text-gray-500');
                }
            }
        });
    }
    
    // 确认模型选择
    confirmModelSelection(modal, modelsInput) {
        const checkboxes = modal.querySelectorAll('.model-item-checkbox:checked');
        const selectedModels = Array.from(checkboxes).map(cb => cb.value);
        
        if (selectedModels.length > 0) {
            modelsInput.value = selectedModels.join(', ');
            
            // 更新模型计数
            const sceneItem = modelsInput.closest('.scene-item');
            const countSpan = sceneItem.querySelector('.model-count');
            if (countSpan) {
                countSpan.textContent = `${selectedModels.length} 个模型`;
            }
            
            console.log(`✅ [Frontend] 已选择 ${selectedModels.length} 个模型`);
        }
        
        modal.remove();
    }
    
    // 切换场景启用状态
    toggleSceneEnabled(button) {
        // 如果是默认场景，不允许切换
        const sceneItem = button.closest('.scene-item');
        if (sceneItem.hasAttribute('data-default')) {
            console.log('⚠️ [Frontend] 默认场景无法禁用');
            return;
        }
        
        const checkbox = sceneItem.querySelector('.scene-enabled');
        if (!checkbox) return;
        
        // 切换状态
        checkbox.checked = !checkbox.checked;
        
        // 触发change事件来更新显示
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        
        // 更新按钮样式和图标
        this.updateToggleButton(button, checkbox.checked);
        
        console.log(`🔄 [Frontend] 场景启用状态已切换为: ${checkbox.checked ? '启用' : '禁用'}`);
    }
    
    // 更新切换按钮的样式和图标
    updateToggleButton(button, enabled) {
        if (enabled) {
            button.className = 'scene-toggle-btn p-1.5 rounded-md transition-colors text-green-600 hover:bg-green-50 bg-green-100';
            button.title = '点击禁用场景';
            button.innerHTML = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>';
        } else {
            button.className = 'scene-toggle-btn p-1.5 rounded-md transition-colors text-gray-400 hover:bg-gray-50';
            button.title = '点击启用场景';
            button.innerHTML = '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clip-rule="evenodd"></path></svg>';
        }
    }
    
    // 验证场景名称
    validateSceneName(input) {
        const sceneItem = input.closest('.scene-item');
        const value = input.value.trim();
        
        // 移除之前的错误提示
        this.removeValidationError(input);
        
        if (!value) {
            this.showValidationError(input, '场景名称不能为空');
            return false;
        }
        
        if (value.length < 2) {
            this.showValidationError(input, '场景名称至少需要2个字符');
            return false;
        }
        
        if (value.length > 50) {
            this.showValidationError(input, '场景名称不能超过50个字符');
            return false;
        }
        
        // 检查重复名称（排除自身）
        const allScenes = document.querySelectorAll('.scene-item');
        for (const scene of allScenes) {
            if (scene !== sceneItem) {
                const otherInput = scene.querySelector('.scene-name');
                if (otherInput && otherInput.value.trim() === value) {
                    this.showValidationError(input, '场景名称不能重复');
                    return false;
                }
            }
        }
        
        this.showValidationSuccess(input);
        return true;
    }
    
    // 验证场景描述
    validateSceneDescription(textarea) {
        const value = textarea.value.trim();
        
        // 移除之前的错误提示
        this.removeValidationError(textarea);
        
        if (!value) {
            this.showValidationError(textarea, '场景描述不能为空，用于AI意图识别');
            return false;
        }
        
        if (value.length < 10) {
            this.showValidationError(textarea, '场景描述建议至少10个字符，描述越详细越准确');
            return false;
        }
        
        if (value.length > 500) {
            this.showValidationError(textarea, '场景描述不能超过500个字符');
            return false;
        }
        
        this.showValidationSuccess(textarea);
        return true;
    }
    
    // 验证场景模型
    validateSceneModels(input) {
        const value = input.value.trim();
        
        // 移除之前的错误提示
        this.removeValidationError(input);
        
        if (!value) {
            this.showValidationError(input, '请至少配置一个模型');
            return false;
        }
        
        // 检查模型格式
        const models = value.split(',').map(m => m.trim()).filter(m => m);
        if (models.length === 0) {
            this.showValidationError(input, '请至少配置一个有效的模型');
            return false;
        }
        
        // 检查模型名称是否合法
        const invalidModels = models.filter(model => {
            // 基本格式检查：不能包含特殊字符，长度合理
            return !/^[a-zA-Z0-9_:\/\-\.]+$/.test(model) || model.length < 2 || model.length > 100;
        });
        
        if (invalidModels.length > 0) {
            this.showValidationError(input, `模型名称格式不正确: ${invalidModels[0]}`);
            return false;
        }
        
        // 更新模型计数
        const sceneItem = input.closest('.scene-item');
        const countSpan = sceneItem.querySelector('.model-count');
        if (countSpan) {
            countSpan.textContent = `${models.length} 个模型`;
        }
        
        this.showValidationSuccess(input);
        return true;
    }
    
    // 更新场景启用状态
    updateSceneEnabledStatus(checkbox) {
        const sceneItem = checkbox.closest('.scene-item');
        const toggleButton = sceneItem.querySelector('.scene-toggle-btn');
        
        // 更新切换按钮的样式
        if (toggleButton) {
            this.updateToggleButton(toggleButton, checkbox.checked);
        }
    }
    
    // 显示验证错误
    showValidationError(element, message) {
        // 更新元素样式
        element.classList.add('border-red-300', 'bg-red-50');
        element.classList.remove('border-green-300', 'bg-green-50', 'border-gray-300');
        
        // 创建或更新错误提示
        let errorDiv = element.parentNode.querySelector('.validation-error');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'validation-error mt-1 text-xs text-red-600 flex items-center';
            element.parentNode.appendChild(errorDiv);
        }
        
        errorDiv.innerHTML = `
            <svg class="w-3 h-3 mr-1 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
            </svg>
            ${message}
        `;
    }
    
    // 显示验证成功
    showValidationSuccess(element) {
        // 更新元素样式
        element.classList.add('border-green-300', 'bg-green-50');
        element.classList.remove('border-red-300', 'bg-red-50', 'border-gray-300');
        
        // 移除错误提示
        this.removeValidationError(element);
        
        // 可选：显示成功图标
        let successIcon = element.parentNode.querySelector('.validation-success');
        if (!successIcon) {
            successIcon = document.createElement('div');
            successIcon.className = 'validation-success absolute right-2 top-1/2 transform -translate-y-1/2';
            successIcon.innerHTML = `
                <svg class="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
                </svg>
            `;
            
            // 只在输入框元素上添加成功图标
            if (element.tagName === 'INPUT' && element.parentNode.style.position !== 'relative') {
                element.parentNode.style.position = 'relative';
                element.parentNode.appendChild(successIcon);
            }
        }
        
        // 3秒后移除成功样式
        setTimeout(() => {
            element.classList.remove('border-green-300', 'bg-green-50');
            element.classList.add('border-gray-300');
            if (successIcon && successIcon.parentNode) {
                successIcon.remove();
            }
        }, 3000);
    }
    
    // 移除验证错误
    removeValidationError(element) {
        const errorDiv = element.parentNode.querySelector('.validation-error');
        if (errorDiv) {
            errorDiv.remove();
        }
        
        const successIcon = element.parentNode.querySelector('.validation-success');
        if (successIcon) {
            successIcon.remove();
        }
    }
    
    // 验证所有场景配置
    validateAllScenes() {
        const sceneItems = document.querySelectorAll('.scene-item');
        let allValid = true;
        
        for (const sceneItem of sceneItems) {
            const nameInput = sceneItem.querySelector('.scene-name');
            const descriptionTextarea = sceneItem.querySelector('.scene-description');
            const modelsInput = sceneItem.querySelector('.scene-models');
            
            if (nameInput && !this.validateSceneName(nameInput)) {
                allValid = false;
            }
            
            if (descriptionTextarea && !this.validateSceneDescription(descriptionTextarea)) {
                allValid = false;
            }
            
            if (modelsInput && !this.validateSceneModels(modelsInput)) {
                allValid = false;
            }
        }
        
        return allValid;
    }

    async testPlatformConnections() {
        try {
            const response = await fetch('/_api/platforms/test');
            const results = await response.json();
            
            // 显示测试结果
            Object.entries(results).forEach(([platform, success]) => {
                const statusIcon = success ? '✅' : '❌';
                const statusText = success ? '连接成功' : '连接失败';
                console.log(`${platform}: ${statusIcon} ${statusText}`);
            });
            
            alert('连接测试完成，请查看控制台输出');
        } catch (error) {
            console.error('测试连接失败:', error);
            alert('测试连接时出错');
        }
    }

    async testSinglePlatform(platformType) {
        console.log(`🧪 [Frontend] 测试单个平台: ${platformType}`);
        
        const button = document.getElementById(`test-${platformType}`);
        const modelsDiv = document.getElementById(`${platformType}-models`);
        const originalText = button.textContent;
        
        // 更新按钮状态
        button.textContent = '测试中...';
        button.disabled = true;
        modelsDiv.textContent = '正在测试连接...';
        
        try {
            // 先保存当前平台配置
            await this.saveSinglePlatformConfig(platformType);
            
            // 发送"你好"测试连接
            const testMessage = {
                platform_type: platformType,
                test_message: '你好'
            };
            
            const testResponse = await fetch('/_api/platforms/test-single', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testMessage)
            });
            
            const testResult = await testResponse.json();
            
            if (testResult.success) {
                // 连接成功，获取模型列表
                const modelsResponse = await fetch(`/_api/models/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ platform_type: platformType })
                });
                
                if (modelsResponse.ok) {
                    // 获取该平台的模型
                    const allModelsResponse = await fetch('/_api/models');
                    const allModels = await allModelsResponse.json();
                    const platformModels = allModels.filter(model => model.platform === platformType);
                    
                    if (platformModels.length > 0) {
                        modelsDiv.innerHTML = platformModels.map(model => 
                            `<span class="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded mr-1 mb-1">${model.name}</span>`
                        ).join('');
                        console.log(`✅ [Frontend] ${platformType} 测试成功，获取到 ${platformModels.length} 个模型`);
                    } else {
                        modelsDiv.innerHTML = '<span class="text-orange-600">连接成功，但未获取到模型</span>';
                    }
                } else {
                    modelsDiv.innerHTML = '<span class="text-orange-600">连接成功，但获取模型失败</span>';
                }
            } else {
                modelsDiv.innerHTML = `<span class="text-red-600">连接失败: ${testResult.error || '未知错误'}</span>`;
                console.error(`❌ [Frontend] ${platformType} 测试失败:`, testResult.error);
            }
        } catch (error) {
            modelsDiv.innerHTML = `<span class="text-red-600">测试出错: ${error.message}</span>`;
            console.error(`❌ [Frontend] ${platformType} 测试出错:`, error);
        } finally {
            // 恢复按钮状态
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    async saveSinglePlatformConfig(platformType) {
        console.log(`💾 [Frontend] 保存单个平台配置: ${platformType}`);
        
        const enabled = document.getElementById(`${platformType}-enabled`)?.checked || false;
        const apiKey = document.getElementById(`${platformType}-api-key`)?.value || '';
        const baseUrl = document.getElementById(`${platformType}-base-url`)?.value || '';
        
        const platformData = {
            platform_type: platformType,
            enabled: enabled,
            api_key: apiKey,
            base_url: baseUrl
        };
        
        try {
            await fetch('/_api/platforms', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(platformData)
            });
            console.log(`✅ [Frontend] ${platformType} 配置已保存`);
        } catch (error) {
            console.error(`❌ [Frontend] 保存${platformType}配置失败:`, error);
        }
    }

    async testAllPlatforms() {
        console.log('🧪 [Frontend] 测试所有平台...');
        try {
            await this.savePlatformConfigs();
            const response = await fetch('/_api/platforms/test');
            const results = await response.json();
            
            // 显示测试结果
            Object.entries(results).forEach(([platform, success]) => {
                const status = success ? '✅ 连接成功' : '❌ 连接失败';
                console.log(`${platform}: ${status}`);
            });
            
            alert('连接测试完成，请查看控制台输出');
        } catch (error) {
            console.error('❌ [Frontend] 测试所有平台失败:', error);
            alert('测试连接时出错');
        }
    }

    async refreshAllModels() {
        console.log('🔄 [Frontend] 刷新所有模型...');
        try {
            await this.savePlatformConfigs();
            const response = await fetch('/_api/models/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            
            if (response.ok) {
                console.log('✅ [Frontend] 所有模型刷新成功');
                alert('所有模型列表已刷新');
            } else {
                console.error('❌ [Frontend] 刷新模型失败');
                alert('刷新模型列表失败');
            }
        } catch (error) {
            console.error('❌ [Frontend] 刷新所有模型出错:', error);
            alert('刷新模型列表时出错');
        }
    }

    async refreshModels() {
        console.log('🔄 [Frontend] 开始刷新模型列表...');
        try {
            console.log('📞 [Frontend] 调用 /_api/models/refresh 接口...');
            const response = await fetch('/_api/models/refresh', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });
            
            console.log(`📡 [Frontend] 刷新接口响应状态: ${response.status}`);
            
            if (response.ok) {
                console.log('✅ [Frontend] 模型刷新接口调用成功，重新加载模型列表...');
                // 重新加载模型列表
                await this.loadGlobalDirectModels();
                alert('模型列表已刷新');
            } else {
                const errorText = await response.text();
                console.error('❌ [Frontend] 刷新接口返回错误:', errorText);
                alert('刷新模型列表失败');
            }
        } catch (error) {
            console.error('❌ [Frontend] 刷新模型列表失败:', error);
            alert('刷新模型列表时出错');
        }
    }

    async logout() {
        console.log('🚪 [Frontend] 开始用户登出...');
        try {
            const response = await fetch('/_api/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            console.log(`📡 [Frontend] 登出接口响应状态: ${response.status}`);
            
            if (response.ok) {
                console.log('✅ [Frontend] 登出成功，跳转到登录页...');
                window.location.href = '/login';
            } else {
                console.error('❌ [Frontend] 登出失败');
                alert('登出失败');
            }
        } catch (error) {
            console.error('❌ [Frontend] 登出时出错:', error);
            alert('登出时出错');
        }
    }

    updatePlatformStatus() {
        console.log('📊 [Frontend] 更新平台状态显示');
        // 这里可以显示平台配置的总体状态
    }

    updateGlobalPlatformStatus() {
        console.log('📊 [Frontend] 更新多平台转发模式的平台状态');
        // 平台状态显示已删除
    }

    updateSmartPlatformStatus() {
        console.log('📊 [Frontend] 更新小模型路由模式的平台状态');
        // 平台状态显示已删除
    }

    handleWorkModeChange(selectedMode) {
        console.log(`🎛️ [Frontend] 工作模式切换到: ${selectedMode}`);
        console.log(`📝 [Frontend] 切换前当前模式: ${this.currentWorkMode}`);
        
        // 更新所有模式的状态显示
        this.updateModeStatus(selectedMode);
        
        // 更新顶部状态显示
        this.updateTopStatusDisplay(selectedMode);
        
        // 自动切换到对应的标签页
        this.showConfigTab(selectedMode.replace('_', '-'));
        
        // 更新当前选中的模式
        this.currentWorkMode = selectedMode;
        console.log(`✅ [Frontend] 工作模式切换完成: ${selectedMode}`);
    }

    updateModeStatus(activeMode) {
        const modes = {
            'claude_code': {
                statusId: 'claude-code-status',
                activeClass: 'bg-blue-500 text-white',
                inactiveClass: 'bg-gray-200 text-gray-600'
            },
            'global_direct': {
                statusId: 'global-direct-status',
                activeClass: 'bg-green-500 text-white',
                inactiveClass: 'bg-gray-200 text-gray-600'
            },
            'smart_routing': {
                statusId: 'smart-routing-status',
                activeClass: 'bg-purple-500 text-white',
                inactiveClass: 'bg-gray-200 text-gray-600'
            }
        };

        // 更新所有模式的状态
        Object.entries(modes).forEach(([mode, config]) => {
            const statusElement = document.getElementById(config.statusId);
            if (statusElement) {
                statusElement.className = `px-2 py-1 text-xs rounded-full ${mode === activeMode ? config.activeClass : config.inactiveClass}`;
                statusElement.textContent = mode === activeMode ? '已启用' : '未启用';
            }
        });

        console.log(`✅ [Frontend] 模式状态已更新，当前启用: ${activeMode}`);
    }

    updateTopStatusDisplay(selectedMode) {
        const modeNames = {
            'claude_code': 'Claude Code模式',
            'global_direct': '多平台转发模式',
            'smart_routing': '小模型路由模式'
        };
        
        const modeColors = {
            'claude_code': 'bg-blue-100 text-blue-800',
            'global_direct': 'bg-green-100 text-green-800',
            'smart_routing': 'bg-purple-100 text-purple-800'
        };
        
        // 更新首页右上角工作模式显示
        const currentModeElement = document.getElementById('current-work-mode');
        console.log(`🔍 [Frontend] 尝试更新右上角状态，模式: ${selectedMode}, 元素存在: ${!!currentModeElement}`);
        
        if (currentModeElement) {
            const newText = modeNames[selectedMode] || selectedMode;
            const newClassName = `ml-1 px-2 py-1 ${modeColors[selectedMode] || 'bg-gray-100 text-gray-800'} text-xs font-medium rounded`;
            
            currentModeElement.textContent = newText;
            currentModeElement.className = newClassName;
            
            console.log(`✅ [Frontend] 右上角状态已更新: ${newText}, 样式: ${newClassName}`);
        } else {
            console.error(`❌ [Frontend] 找不到 current-work-mode 元素！`);
        }
        
        console.log(`📊 [Frontend] 首页状态条更新完成: ${modeNames[selectedMode]}`);
    }

    loadWorkMode(currentMode) {
        console.log(`📂 [Frontend] 加载工作模式: ${currentMode}`);
        
        // 设置单选按钮状态
        const modeRadio = document.getElementById(`mode-${currentMode.replace('_', '-')}`);
        if (modeRadio) {
            modeRadio.checked = true;
        }
        
        // 更新状态显示
        this.updateModeStatus(currentMode);
        
        // 更新顶部状态显示
        this.updateTopStatusDisplay(currentMode);
        
        // 🔄 切换到对应的标签页
        this.showConfigTab(currentMode.replace('_', '-'));
        
        // 保存当前模式
        this.currentWorkMode = currentMode;
    }

    updateConfigDisplay(config) {
        if (config) {
            // 🔄 更新右上角的工作模式显示
            const currentMode = config.current_work_mode || 'claude_code';
            this.updateTopStatusDisplay(currentMode);
            
            // 更新平台状态
            const currentStatusElement = document.getElementById('current-platform-status');
            if (currentStatusElement) {
                currentStatusElement.textContent = '正常运行';
                currentStatusElement.className = 'ml-1 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded';
            }
            
            console.log(`✅ [Frontend] 页面初始化：更新右上角状态显示，工作模式: ${currentMode}`);
        }
    }

    addNewRecord(record) {
        this.records.unshift(record);
        
        // 优化性能：只有当新记录符合当前筛选条件时才更新显示
        if (this.currentFilter === 'all' || record.method === this.currentFilter) {
            // 检查是否应该直接添加到列表顶部而不是重新渲染
            if (this.lazyLoading.currentPage > 0) {
                // 已经显示了多页，直接在顶部插入新记录
                this.insertNewRecordToTop(record);
            } else {
                // 还在第一页，重新渲染以确保正确的显示顺序
                this.renderRecordsList(true);
            }
        }
        
        // 更新记录计数显示
        this.updateRecordCount();
    }

    // 在列表顶部插入新记录（性能优化）
    insertNewRecordToTop(record) {
        const timestamp = new Date(record.timestamp).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const statusColor = record.response_status >= 400 ? 'text-red-600' : 
                          record.response_status >= 300 ? 'text-yellow-600' : 'text-green-600';
        
        const recordHtml = `
            <div class="record-item p-4 border-b cursor-pointer" 
                 data-id="${record.id}" onclick="monitor.selectRecord(${record.id})">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <div class="flex items-center space-x-2 mb-1">
                            <span class="text-xs font-medium px-2 py-1 rounded bg-blue-100 text-blue-800">
                                ${record.method}
                            </span>
                            <span class="text-sm font-medium text-gray-900 truncate">
                                ${this.getDisplayPath(record.path)}
                            </span>
                        </div>
                        <div class="text-xs text-gray-500">${timestamp}</div>
                    </div>
                    <div class="text-right ml-4">
                        <div class="text-sm font-medium ${statusColor}">
                            ${record.response_status}
                        </div>
                        <div class="text-xs text-gray-500">
                            ${record.duration_ms}ms
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // 在列表开头插入新记录
        this.recordsList.insertAdjacentHTML('afterbegin', recordHtml);
        
        // 添加高亮动画效果
        const newElement = this.recordsList.firstElementChild;
        if (newElement) {
            newElement.style.backgroundColor = '#dbeafe';
            setTimeout(() => {
                newElement.style.transition = 'background-color 1s ease';
                newElement.style.backgroundColor = '';
            }, 100);
        }
    }

    // 更新记录计数显示
    updateRecordCount() {
        this.applyFilter(); // 重新计算筛选结果
        
        if (this.currentFilter === 'all') {
            this.totalCount.textContent = this.records.length;
        } else {
            this.totalCount.textContent = `${this.filteredRecords.length} / ${this.records.length}`;
        }
    }

    async clearRecords() {
        if (confirm('确定要清空所有记录吗？')) {
            try {
                // 调用后端API清空记录
                const response = await fetch('/control/clear-records', {
                    method: 'POST'
                });
                
                if (response.ok) {
                    this.records = [];
                    this.filteredRecords = [];
                    this.selectedRecordId = null;
                    this.renderRecordsList();
                    this.renderDetailView();
                    console.log('记录已清空');
                } else {
                    console.error('清空记录失败');
                }
            } catch (error) {
                console.error('清空记录时出错:', error);
                // 即使后端失败，也清空前端显示
                this.records = [];
                this.filteredRecords = [];
                this.selectedRecordId = null;
                this.renderRecordsList();
                this.renderDetailView();
            }
        }
    }

    renderRecordsList(reset = true) {
        // 应用筛选
        this.applyFilter();
        
        // 更新记录数显示
        if (this.currentFilter === 'all') {
            this.totalCount.textContent = this.records.length;
        } else {
            this.totalCount.textContent = `${this.filteredRecords.length} / ${this.records.length}`;
        }
        
        if (this.filteredRecords.length === 0) {
            this.noRecords.style.display = 'block';
            this.noRecords.textContent = this.records.length === 0 ? '暂无API调用记录' : '没有符合筛选条件的记录';
            // 清空记录列表显示
            this.recordsList.innerHTML = '';
            this.resetLazyLoading();
            return;
        } else {
            this.noRecords.style.display = 'none';
        }

        // 如果是重置操作，清空现有内容并重置懒加载状态
        if (reset) {
            this.resetLazyLoading();
            this.recordsList.innerHTML = '';
        }

        // 计算要渲染的记录范围
        const startIndex = this.lazyLoading.currentPage * this.lazyLoading.pageSize;
        const endIndex = Math.min(startIndex + this.lazyLoading.pageSize, this.filteredRecords.length);
        const recordsToRender = this.filteredRecords.slice(startIndex, endIndex);

        // 生成HTML
        const recordsHtml = recordsToRender.map(record => {
            const timestamp = new Date(record.timestamp).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const statusColor = record.response_status >= 400 ? 'text-red-600' : 
                              record.response_status >= 300 ? 'text-yellow-600' : 'text-green-600';
            
            return `
                <div class="record-item p-4 border-b cursor-pointer ${this.selectedRecordId === record.id ? 'selected' : ''}" 
                     data-id="${record.id}" onclick="monitor.selectRecord(${record.id})">
                    <div class="flex justify-between items-start">
                        <div class="flex-1">
                            <div class="flex items-center space-x-2 mb-1">
                                <span class="text-xs font-medium px-2 py-1 rounded bg-blue-100 text-blue-800">
                                    ${record.method}
                                </span>
                                <span class="text-sm font-medium text-gray-900 truncate">
                                    ${this.getDisplayPath(record.path)}
                                </span>
                            </div>
                            <div class="text-xs text-gray-500">${timestamp}</div>
                        </div>
                        <div class="text-right ml-4">
                            <div class="text-sm font-medium ${statusColor}">
                                ${record.response_status}
                            </div>
                            <div class="text-xs text-gray-500">
                                ${record.duration_ms}ms
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 追加HTML到列表
        if (reset) {
            this.recordsList.innerHTML = recordsHtml;
        } else {
            this.recordsList.insertAdjacentHTML('beforeend', recordsHtml);
        }

        // 更新懒加载状态
        this.lazyLoading.currentPage++;
        this.lazyLoading.hasMore = endIndex < this.filteredRecords.length;
        
        // 添加加载更多指示器
        this.updateLoadMoreIndicator();
    }

    // 重置懒加载状态
    resetLazyLoading() {
        this.lazyLoading.currentPage = 0;
        this.lazyLoading.isLoading = false;
        this.lazyLoading.hasMore = true;
    }

    // 加载更多记录
    loadMoreRecords() {
        if (!this.lazyLoading.hasMore || this.lazyLoading.isLoading) {
            return;
        }

        this.lazyLoading.isLoading = true;
        this.updateLoadMoreIndicator();

        // 使用 setTimeout 来避免阻塞 UI
        setTimeout(() => {
            this.renderRecordsList(false);
            this.lazyLoading.isLoading = false;
            this.updateLoadMoreIndicator();
        }, 100);
    }

    // 更新"加载更多"指示器
    updateLoadMoreIndicator() {
        let indicator = document.getElementById('load-more-indicator');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'load-more-indicator';
            indicator.className = 'p-4 text-center text-sm text-gray-500 border-t';
        }

        if (this.lazyLoading.isLoading) {
            indicator.innerHTML = `
                <div class="flex items-center justify-center space-x-2">
                    <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                    <span>加载中...</span>
                </div>
            `;
            if (!indicator.parentNode) {
                this.recordsList.appendChild(indicator);
            }
        } else if (this.lazyLoading.hasMore) {
            indicator.innerHTML = `
                <button onclick="monitor.loadMoreRecords()" class="text-blue-500 hover:text-blue-600 font-medium">
                    点击加载更多记录
                </button>
            `;
            if (!indicator.parentNode) {
                this.recordsList.appendChild(indicator);
            }
        } else {
            // 移除指示器
            if (indicator.parentNode) {
                indicator.parentNode.removeChild(indicator);
            }
        }
    }

    // 处理记录列表滚动事件
    handleRecordsScroll() {
        if (!this.recordsList || !this.lazyLoading.hasMore || this.lazyLoading.isLoading) {
            return;
        }

        const scrollTop = this.recordsList.scrollTop;
        const scrollHeight = this.recordsList.scrollHeight;
        const clientHeight = this.recordsList.clientHeight;

        // 当滚动到距离底部指定阈值内时，触发加载更多
        if (scrollTop + clientHeight >= scrollHeight - this.lazyLoading.loadThreshold) {
            console.log('🔄 [懒加载] 触发自动加载更多记录');
            this.loadMoreRecords();
        }
    }

    async selectRecord(recordId) {
        this.selectedRecordId = recordId;
        this.renderRecordsList(); // 重新渲染以更新选中状态
        
        try {
            const response = await fetch(`/_api/records/${recordId}`);
            const record = await response.json();
            
            // 渲染新记录的详细视图（使用默认视图状态）
            this.renderDetailView(record);
        } catch (error) {
            console.error('获取记录详情失败:', error);
        }
    }

    renderDetailView(record = null) {
        if (!record) {
            this.detailContent.innerHTML = `
                <div class="text-center text-gray-500 mt-20">
                    <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p class="mt-2">选择一个API调用查看详细信息</p>
                </div>
            `;
            return;
        }

        const timestamp = new Date(record.timestamp).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const statusColor = record.response_status >= 400 ? 'text-red-600' : 
                          record.response_status >= 300 ? 'text-yellow-600' : 'text-green-600';

        // 安全地处理可能包含HTML的数据
        const safeRecord = {
            ...record,
            path: this.escapeHtml(record.path),
            headers: record.headers,
            body: record.body,
            response_headers: record.response_headers,
            response_body: record.response_body
        };

        this.detailContent.innerHTML = `
            <div class="space-y-6">
                <!-- 基本信息 -->
                <div>
                    <div class="flex justify-between items-center mb-2">
                        <h3 class="text-base font-semibold text-gray-900">基本信息</h3>
                        <button onclick="monitor.copyCurl(${record.id}, this)" class="bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded text-xs font-medium transition-colors flex items-center">
                            <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                            </svg>
                            复制cURL
                        </button>
                    </div>
                    <div class="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <!-- API信息行 -->
                        <div class="flex flex-wrap items-center gap-2 mb-2">
                            <span class="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-medium">${record.method}</span>
                            <span class="font-medium text-gray-900 text-sm">${this.getCleanPath(safeRecord.path)}</span>
                            ${this.getRouteTypeDisplay(record)}
                            <span class="ml-auto font-medium ${statusColor} text-sm">${record.response_status}</span>
                            <span class="text-gray-500 text-xs">${record.duration_ms}ms</span>
                        </div>
                        
                        <!-- URL映射信息 - 更紧凑的设计 -->
                        <div class="flex flex-wrap text-xs gap-x-1 mb-2">
                            <span class="text-gray-500">来源:</span>
                            <span class="font-mono text-blue-700">http://127.0.0.1:8000${this.getCleanPath(safeRecord.path)}</span>
                            <span class="mx-1">→</span>
                            <span class="text-gray-500">目标:</span>
                            <span class="font-mono text-green-700 break-all">${this.escapeHtml(this.getTargetUrl(record))}</span>
                        </div>
                        
                        <!-- 核心信息行 -->
                        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs pb-1">
                            <div class="flex items-center">
                                <span class="text-gray-500 mr-1">时间:</span>
                                <span>${timestamp}</span>
                            </div>
                            
                            ${record.target_platform ? `
                            <div class="flex items-center">
                                <span class="text-gray-500 mr-1">平台:</span>
                                <span class="text-blue-600">${record.target_platform}</span>
                            </div>
                            ` : ''}
                            
                            ${record.target_model ? `
                            <div class="flex items-center">
                                <span class="text-gray-500 mr-1">模型:</span>
                                <span class="text-purple-600 font-mono">${record.target_model}</span>
                            </div>
                            ` : ''}
                            
                            ${record.key_info ? `
                            <div class="flex items-center">
                                <span class="text-gray-500 mr-1">KEY:</span>
                                <span class="text-indigo-600">${record.key_info.key_name}</span>
                                <span class="text-xs text-gray-400 font-mono ml-1">(${record.key_info.api_key})</span>
                            </div>
                            ` : ''}
                        </div>
                        
                        <!-- Token使用量 - 更紧凑水平布局 -->
                        ${record.token_usage && record.token_usage.total_tokens > 0 ? `
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 pt-1 border-t border-gray-200 text-xs">
                            <span class="font-medium text-green-700">Token使用:</span>
                            <div>
                                <span class="text-gray-500">输入</span>
                                <span class="font-medium text-green-700">${record.token_usage.input_tokens.toLocaleString()}</span>
                            </div>
                            <div>
                                <span class="text-gray-500">输出</span>
                                <span class="font-medium text-green-700">${record.token_usage.output_tokens.toLocaleString()}</span>
                            </div>
                            <div>
                                <span class="text-gray-500">总计</span>
                                <span class="font-medium text-green-700">${record.token_usage.total_tokens.toLocaleString()}</span>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>

                <!-- 数据流处理阶段 -->
                
                <!-- 阶段1: 原始请求 -->
                <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div class="flex items-center mb-2">
                        <h2 class="text-base font-semibold text-blue-800">📥 原始请求</h2>
                        <span class="ml-2 text-xs text-blue-600">(客户端发送)</span>
                    </div>
                    
                    <div class="grid grid-cols-10 gap-3">
                        <div class="col-span-4">
                            <div class="flex items-center mb-1">
                                <h3 class="text-sm font-medium text-gray-700">请求头</h3>
                            </div>
                            <div class="json-data-container" data-content-type="headers"></div>
                        </div>
                        <div class="col-span-6">
                            <div class="flex items-center mb-1">
                                <h3 class="text-sm font-medium text-gray-700">请求体</h3>
                            </div>
                            <div class="json-data-container" data-content-type="body"></div>
                        </div>
                    </div>
                </div>

                <!-- 阶段2: HOOK处理 -->
                <div class="bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <div class="flex items-center mb-2">
                        <h2 class="text-base font-semibold text-purple-800">🔄 HOOK处理</h2>
                        <span class="ml-2 text-xs text-purple-600">(格式转换处理)</span>
                    </div>
                    
                    <div class="space-y-3">
                        <div class="grid grid-cols-10 gap-3">
                            <div class="col-span-4">
                                <div class="flex items-center mb-1">
                                    <h3 class="text-sm font-medium text-gray-700">转换后的请求头</h3>
                                    <span class="ml-2 text-xs text-gray-500">(发送给大模型的实际请求头)</span>
                                </div>
                                <div class="json-data-container" data-content-type="processed_headers"></div>
                            </div>
                            <div class="col-span-6">
                                <div class="flex items-center mb-1">
                                    <h3 class="text-sm font-medium text-gray-700">转换后的提示词</h3>
                                    <span class="ml-2 text-xs text-gray-500">(发送给大模型的实际内容)</span>
                                </div>
                                <div class="json-data-container" data-content-type="processed_prompt"></div>
                            </div>
                        </div>
                        
                        ${record.target_platform ? `
                        <div class="bg-white rounded border border-purple-100 p-2 mt-2">
                            <div class="flex items-center mb-1">
                                <h4 class="text-xs font-semibold text-gray-700">🎯 路由信息</h4>
                            </div>
                            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                ${record.routing_scene ? `
                                <div class="flex items-center">
                                    <span class="text-gray-500 mr-1">路由场景:</span>
                                    <span class="font-medium text-blue-700 bg-blue-50 px-1 py-0.5 rounded text-xs">
                                        🎭 ${record.routing_scene}
                                    </span>
                                </div>
                                ` : ''}
                                <div class="flex items-center">
                                    <span class="text-gray-500 mr-1">目标平台:</span>
                                    <span class="font-medium text-purple-700">${record.target_platform}</span>
                                </div>
                                <div class="flex items-center">
                                    <span class="text-gray-500 mr-1">目标模型:</span>
                                    <span class="font-medium text-purple-700">${record.target_model || 'N/A'}</span>
                                </div>
                                <div class="w-full mt-1">
                                    <span class="text-gray-500 mr-1">平台URL:</span>
                                    <span class="font-medium text-purple-700 break-all">${record.platform_base_url || 'N/A'}</span>
                                </div>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>

                <!-- 阶段3: 大模型响应 -->
                <div class="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div class="flex items-center mb-2">
                        <h2 class="text-base font-semibold text-green-800">🤖 大模型响应</h2>
                        <span class="ml-2 text-xs text-green-600">(HOOK处理前的原始响应)</span>
                    </div>
                    
                    <div class="grid grid-cols-10 gap-3">
                        <div class="col-span-4">
                            <div class="flex items-center mb-1">
                                <h3 class="text-sm font-medium text-gray-700">响应头</h3>
                                <span class="ml-2 text-xs text-gray-500">(大模型API返回)</span>
                            </div>
                            <div class="json-data-container" data-content-type="model_raw_headers"></div>
                        </div>
                        <div class="col-span-6">
                            <div class="flex items-center mb-1">
                                <h3 class="text-sm font-medium text-gray-700">响应体</h3>
                                <span class="ml-2 text-xs text-gray-500">(大模型API返回)</span>
                            </div>
                            <div class="json-data-container" data-content-type="model_raw_response"></div>
                        </div>
                    </div>
                </div>

                <!-- 阶段4: 最终响应 -->
                <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div class="flex items-center mb-2">
                        <h2 class="text-base font-semibold text-amber-800">📤 最终响应</h2>
                        <span class="ml-2 text-xs text-amber-600">(返回给客户端)</span>
                    </div>
                    
                    <div class="grid grid-cols-10 gap-3">
                        <div class="col-span-4">
                            <div class="flex items-center mb-1">
                                <h3 class="text-sm font-medium text-gray-700">响应头</h3>
                            </div>
                            <div class="json-data-container" data-content-type="response_headers"></div>
                        </div>
                        <div class="col-span-6">
                            <div class="flex items-center mb-1">
                                <h3 class="text-sm font-medium text-gray-700">响应体</h3>
                            </div>
                            <div class="json-data-container" data-content-type="response_body"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // 安全地设置JSON内容，避免HTML注入
        this.setJsonContent('headers', record.headers, '请求头信息');
        this.setJsonContent('body', record.body, '请求体内容');
                    this.setJsonContent('processed_prompt', record.processed_prompt, 'HOOK处理后的提示词');
            this.setJsonContent('processed_headers', record.processed_headers, 'HOOK处理后的请求头');
            this.setJsonContent('model_raw_headers', record.model_raw_headers, '大模型原始响应头');
        this.setJsonContent('model_raw_response', record.model_raw_response, '大模型原始响应体');
        this.setJsonContent('response_headers', record.response_headers, '响应头信息');
        this.setJsonContent('response_body', record.response_body, '响应体内容');
    }

    // 安全地设置JSON内容到指定容器，避免HTML注入
    setJsonContent(type, data, title) {
        const container = this.detailContent.querySelector(`[data-content-type="${type}"]`);
        if (!container) return;
        
        // 生成JSON格式的HTML内容
        const jsonHtml = this.formatJsonWithHighlight(data, title);
        
        // 使用安全的方式设置内容
        container.innerHTML = jsonHtml;
        
        // 应用保存的视图状态，保持不同记录间的视图一致性
        // 注意：对于SSE格式数据，需要特殊处理，不要强制覆盖默认视图
        if (this.selectedRecordId) {
            // 检查是否是SSE格式，如果是则跳过强制恢复到非SSE视图
            const isSSE = this.isSSEFormat(data);
            if (!isSSE) {
                this.restoreViewState(type);
            } else {
                console.log(`跳过SSE数据的视图状态恢复: ${type}`);
            }
        }
    }

    getCleanPath(path) {
        // 移除路径中的路由信息标识（如 → openrouter:anthropic/claude-sonnet-4, (🔄 流式响应) 等）
        return path.replace(/\s*[\(（].*?[\)）]\s*$/, '').replace(/\s*→.*$/, '');
    }

    getDisplayPath(path) {
        // 为左侧列表生成简化的显示路径：emoji + 路径
        const cleanPath = this.getCleanPath(path);
        
        // 根据路径内容确定emoji - 按优先级检查
        if (path.includes('(❇️')) {
            return `❇️ ${cleanPath}`;
        } else if (path.includes('(🆎')) {
            return `🆎 ${cleanPath}`;
        } else if (path.includes('(🔄')) {
            return `🔄 ${cleanPath}`;
        } else if (path.includes('→')) {
            // 有路由信息但没有emoji，默认为多平台转发
            return `🔄 ${cleanPath}`;
        } else {
            // 没有路由信息，可能是旧记录
            return cleanPath;
        }
    }

    getRouteTypeDisplay(record) {
        // 为详情页面生成路由类型显示标签
        const path = record.path;
        
        if (path.includes('(❇️') || record.target_model === 'claude-code-proxy') {
            return '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">❇️ Claude Code</span>';
        } else if (path.includes('(🆎') || record.routing_scene) {
            // 优先检查小模型分发：有🆎标识符或有routing_scene字段
            return '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">🆎 小模型路由</span>';
        } else if (path.includes('(🔄') || path.includes('→')) {
            return '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">🔄 多平台转发</span>';
        }
        return '';
    }

    getTargetUrl(record) {
        // 如果是传入的字符串路径（旧版本兼容）
        if (typeof record === 'string') {
            const path = record;
            if (path.startsWith('/api/v1/claude-code')) {
                const remainingPath = path.substring('/api/v1/claude-code'.length);
                return `https://dashscope.aliyuncs.com/api/v2/apps/claude-code-proxy${remainingPath}`;
            } else {
                return `https://dashscope.aliyuncs.com${path}`;
            }
        }
        
        // 新版本：根据记录中的平台信息构造URL
        if (record.platform_base_url && record.target_model) {
            // 根据平台构造完整URL
            const basePath = record.path.replace(/\s*[\(（].*?[\)）]\s*$/, '').replace(/\s*→.*$/, ''); // 移除标识信息
            
            if (record.target_platform === 'openrouter') {
                return `${record.platform_base_url}/chat/completions`;
            } else if (record.target_platform === 'dashscope') {
                if (record.target_model === 'claude-code-proxy') {
                    // Claude Code 模式
                    const remainingPath = basePath.substring('/api/v1/claude-code'.length);
                    return `${record.platform_base_url}/api/v2/apps/claude-code-proxy${remainingPath}`;
                } else {
                    // 其他DashScope模型
                    return `${record.platform_base_url}/compatible-mode/v1/chat/completions`;
                }
            } else if (record.target_platform === 'ollama') {
                return `${record.platform_base_url}/api/chat`;
            } else if (record.target_platform === 'lmstudio') {
                return `${record.platform_base_url}/v1/chat/completions`;
            } else if (record.target_platform === 'siliconflow') {
                return `${record.platform_base_url}/v1/chat/completions`;
            } else if (record.target_platform === 'openai_compatible') {
                return `${record.platform_base_url}/chat/completions`;
            } else {
                return `${record.platform_base_url || 'unknown'}${basePath}`;
            }
        }
        
        // 降级处理：使用旧的方式
        const path = record.path || '';
        if (path.startsWith('/api/v1/claude-code')) {
            const remainingPath = path.substring('/api/v1/claude-code'.length);
            return `https://dashscope.aliyuncs.com/api/v2/apps/claude-code-proxy${remainingPath}`;
        } else {
            return `https://dashscope.aliyuncs.com${path}`;
        }
    }

    // JSON语法高亮和平铺显示
    formatJsonWithHighlight(data, title = 'JSON') {
        if (!data) return this.createJsonContainer('(空)', title);
        
        // 检测是否是SSE格式
        if (typeof data === 'string' && this.isSSEFormat(data)) {
            return this.formatSSEContent(data, title);
        }
        
        let parsedData;
        let originalDataString = '';
        try {
            if (typeof data === 'string') {
                originalDataString = data;
                parsedData = JSON.parse(data);
            } else {
                originalDataString = JSON.stringify(data, null, 2);
                parsedData = data;
            }
        } catch {
            // 对于无法解析为JSON的数据，直接转义并显示
            return this.createJsonContainer(this.escapeHtml(data), title);
        }
        
        const jsonString = JSON.stringify(parsedData, null, 2);
        const highlighted = this.highlightJson(jsonString);
        const treeView = this.renderJsonTree(parsedData);
        
        // 对原始JSON字符串进行HTML转义，防止HTML内容被渲染
        const escapedJsonString = this.escapeHtml(jsonString);
        
        return this.createJsonContainer(highlighted, title, escapedJsonString, treeView, parsedData);
    }

    // 检测是否是SSE格式或JSON流格式
    isSSEFormat(data) {
        if (typeof data !== 'string') return false;
        
        // 检查标准SSE格式
        const ssePatterns = /^(id:|event:|data:|:HTTP_STATUS)/m;
        const hasSSEFields = ssePatterns.test(data);
        
        // 检查是否有多行SSE数据
        const lines = data.split('\n').filter(line => line.trim());
        const sseLineCount = lines.filter(line => 
            line.startsWith('data:') || 
            line.startsWith('event:') || 
            line.startsWith('id:') || 
            line.startsWith(': ')
        ).length;
        
        // 如果有SSE字段且有多行SSE数据，认为是SSE格式
        if (hasSSEFields && sseLineCount >= 2) {
            return true;
        }
        
        // 检查JSON流格式 (JSONL/NDJSON)
        return this.isJSONStream(data);
    }
    
    // 检测JSON流格式
    isJSONStream(data) {
        // 确保data是字符串类型
        if (typeof data !== 'string') {
            return false;
        }
        
        const lines = data.split('\n').filter(line => line.trim());
        
        // 至少要有2行才考虑为流式数据
        if (lines.length < 2) return false;
        
        // 检查每行是否都是有效的JSON
        let validJsonCount = 0;
        for (const line of lines) {
            try {
                JSON.parse(line);
                validJsonCount++;
            } catch {
                // 忽略解析失败的行
            }
        }
        
        // 如果80%以上的行都是有效JSON，认为是JSON流
        return validJsonCount >= lines.length * 0.8 && validJsonCount >= 2;
    }

    // 平铺显示SSE内容
    formatSSEContent(data, title) {
        // 确保data是字符串类型
        if (typeof data !== 'string') {
            if (data === null || data === undefined) {
                return this.createJsonContainer('(空)', title);
            }
            // 如果不是字符串，尝试转换为JSON字符串
            try {
                data = JSON.stringify(data, null, 2);
            } catch {
                data = String(data);
            }
        }
        
        // 如果是空字符串或只有空白字符，显示空内容
        if (!data || !data.trim()) {
            return this.createJsonContainer('(空)', title);
        }
        
        const rawContent = this.escapeHtml(data);
        
        // 解析SSE数据为结构化events
        const lines = data.split('\n').filter(line => line.trim());
        const events = this.parseSSEEvents(lines);
        
        // 处理标准SSE格式
        const lineHighlighted = this.highlightSSELines(data);
        const jsonMode = this.extractSSEDataAsJson(data);
        
        // 创建表格视图
        const tableView = this.createSSETableFromEvents(events);
        
        // 提取合并的文本内容
        const mergedText = this.extractMergedTextFromSSE(data);
        
        // 重构完整的非流式响应
        const reconstructedResponse = this.reconstructClaudeResponse(data);
        
        return this.createSSEContainer(lineHighlighted, jsonMode, title, data, tableView, mergedText, reconstructedResponse);
    }

    // 从SSE数据中提取并合并文本内容（支持Claude、OpenRouter和Ollama格式）
    extractMergedTextFromSSE(data) {
        if (!data || typeof data !== 'string') return null;
        
        const lines = data.split('\n').filter(line => line.trim());
        const textBlocks = new Map(); // 用Map来按index分组文本块
        let hasTextContent = false;
        let allTexts = []; // 收集所有文本内容
        
        // 检测Ollama格式：直接的JSON对象序列，没有SSE前缀
        const isOllamaFormat = lines.length > 0 && lines[0].startsWith('{"model"');
        
        debugLog('[DEBUG] extractMergedTextFromSSE:', {
            totalLines: lines.length,
            firstLine: lines[0]?.substring(0, 100),
            isOllamaFormat: isOllamaFormat
        });
        
        if (isOllamaFormat) {
            debugLog('[DEBUG] 处理Ollama格式，总行数:', lines.length);
            // 处理Ollama格式
            for (const line of lines) {
                try {
                    const jsonData = JSON.parse(line);
                    debugLog('[DEBUG] Ollama JSON解析成功:', {
                        model: jsonData.model,
                        hasMessage: !!jsonData.message,
                        content: jsonData.message?.content,
                        done: jsonData.done
                    });
                    
                    if (jsonData.message && jsonData.message.content) {
                        allTexts.push(jsonData.message.content);
                        hasTextContent = true;
                        debugLog('[DEBUG] 添加Ollama内容:', jsonData.message.content);
                    }
                } catch (e) {
                    debugLog('[DEBUG] Ollama JSON解析失败:', line.substring(0, 100), e);
                    continue;
                }
            }
            debugLog('[DEBUG] Ollama处理完成，收集到的文本片段数:', allTexts.length);
        } else {
            // 解析SSE格式的数据
            let currentEvent = {};
        
            for (const line of lines) {
                if (line.startsWith('id:')) {
                    currentEvent.id = line.substring(3).trim();
                } else if (line.startsWith('event:')) {
                    currentEvent.event = line.substring(6).trim();
                } else if (line.startsWith('data:')) {
                    const dataContent = line.substring(5).trim();
                    try {
                        currentEvent.data = JSON.parse(dataContent);
                    } catch (e) {
                        currentEvent.data = dataContent;
                    }
                    
                    // 处理当前数据
                    if (currentEvent.data && typeof currentEvent.data === 'object') {
                        // Claude格式：content_block_delta事件
                        if (currentEvent.data.type === 'content_block_delta' && 
                            currentEvent.data.delta && 
                            currentEvent.data.delta.type === 'text_delta' &&
                            currentEvent.data.delta.text) {
                            
                            const index = currentEvent.data.index || 0;
                            if (!textBlocks.has(index)) {
                                textBlocks.set(index, []);
                            }
                            textBlocks.get(index).push(currentEvent.data.delta.text);
                            allTexts.push(currentEvent.data.delta.text);
                            hasTextContent = true;
                        }
                        // OpenRouter/OpenAI格式：choices[].delta.content
                        else if (currentEvent.data.choices && Array.isArray(currentEvent.data.choices)) {
                            for (const choice of currentEvent.data.choices) {
                                if (choice.delta && choice.delta.content) {
                                    const index = choice.index || 0;
                                    if (!textBlocks.has(index)) {
                                        textBlocks.set(index, []);
                                    }
                                    textBlocks.get(index).push(choice.delta.content);
                                    allTexts.push(choice.delta.content);
                                    hasTextContent = true;
                                }
                            }
                        }
                    }
                    
                    // 重置当前事件
                    currentEvent = {};
                } else if (line === '' || line.startsWith(':')) {
                    // 空行或注释行，重置当前事件
                    currentEvent = {};
                }
            }
        }
        
        if (!hasTextContent) return null;
        
        // 如果有文本块分组，使用分组逻辑
        if (textBlocks.size > 0) {
            const mergedBlocks = [];
            for (const [index, texts] of textBlocks.entries()) {
                const mergedText = texts.join('');
                if (mergedText.trim()) {
                    mergedBlocks.push({
                        index: index,
                        text: mergedText,
                        blockCount: texts.length
                    });
                }
            }
            
            if (mergedBlocks.length === 0) return null;
            
            // 如果只有一个文本块，直接返回文本
            if (mergedBlocks.length === 1) {
                return {
                    content: mergedBlocks[0].text,
                    blockCount: mergedBlocks[0].blockCount,
                    summary: `合并了 ${mergedBlocks[0].blockCount} 个文本片段`
                };
            }
            
            // 如果有多个文本块，按index排序并组合
            mergedBlocks.sort((a, b) => a.index - b.index);
            const combinedText = mergedBlocks.map(block => 
                `[文本块 ${block.index}]:\n${block.text}`
            ).join('\n\n');
            
            const totalFragments = mergedBlocks.reduce((sum, block) => sum + block.blockCount, 0);
            
            return {
                content: combinedText,
                blockCount: totalFragments,
                summary: `合并了 ${mergedBlocks.length} 个文本块，共 ${totalFragments} 个文本片段`
            };
        }
        
        // 如果没有分组，直接合并所有文本
        if (allTexts.length > 0) {
            return {
                content: allTexts.join(''),
                blockCount: allTexts.length,
                summary: `合并了 ${allTexts.length} 个文本片段`
            };
        }
        
        return null;
    }

    // 重构完整的响应（支持Claude、OpenRouter和Ollama格式）
    reconstructClaudeResponse(data) {
        if (!data || typeof data !== 'string') return null;
        
        // 先尝试提取文本内容
        const mergedText = this.extractMergedTextFromSSE(data);
        if (!mergedText) return null;
        
        // 构建标准的Chat Completion响应格式
        const lines = data.split('\n').filter(line => line.trim());
        let model = 'unknown';
        let id = 'unknown';
        let usage = null;
        
        // 检测Ollama格式
        const isOllamaFormat = lines.length > 0 && lines[0].startsWith('{"model"');
        
        debugLog('[DEBUG] reconstructClaudeResponse:', {
            totalLines: lines.length,
            firstLine: lines[0]?.substring(0, 100),
            isOllamaFormat: isOllamaFormat
        });
        
        if (isOllamaFormat) {
            debugLog('[DEBUG] 重构Ollama响应格式');
            // 处理Ollama格式
            for (const line of lines) {
                try {
                    const jsonData = JSON.parse(line);
                    debugLog('[DEBUG] Ollama重构JSON解析:', {
                        model: jsonData.model,
                        done: jsonData.done,
                        prompt_eval_count: jsonData.prompt_eval_count,
                        eval_count: jsonData.eval_count
                    });
                    
                    if (jsonData.model) model = jsonData.model;
                    if (jsonData.done && jsonData.prompt_eval_count !== undefined && jsonData.eval_count !== undefined) {
                        usage = {
                            prompt_tokens: jsonData.prompt_eval_count || 0,
                            completion_tokens: jsonData.eval_count || 0,
                            total_tokens: (jsonData.prompt_eval_count || 0) + (jsonData.eval_count || 0)
                        };
                        debugLog('[DEBUG] Ollama usage统计:', usage);
                    }
                    // 生成Ollama格式的ID
                    if (!id || id === 'unknown') {
                        id = `ollama_${model}_${Date.now()}`;
                        debugLog('[DEBUG] 生成Ollama ID:', id);
                    }
                } catch (e) {
                    debugLog('[DEBUG] Ollama重构JSON解析失败:', line.substring(0, 100), e);
                    continue;
                }
            }
            debugLog('[DEBUG] Ollama重构完成:', { model, id, usage });
        } else {
            // 从SSE格式的data行中提取基本信息
            for (const line of lines) {
                if (line.startsWith('data:')) {
                    try {
                        const data = JSON.parse(line.substring(5).trim());
                        if (data.model) model = data.model;
                        if (data.id) id = data.id;
                        if (data.usage) usage = data.usage;
                        break;
                    } catch (e) {
                        continue;
                    }
                }
            }
        }
        
        // 构建完整响应
        const reconstructed = {
            id: id,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: mergedText.content
                },
                finish_reason: 'stop'
            }],
            usage: usage || {
                prompt_tokens: 0,
                completion_tokens: mergedText.blockCount || 0,
                total_tokens: mergedText.blockCount || 0
            }
        };
        
        return {
            content: JSON.stringify(reconstructed, null, 2),
            summary: `重构的完整响应 (${mergedText.blockCount} 个文本片段)`
        };
    }

    // 处理单个Claude事件
    processClaudeEvent(eventData, handlers) {
        switch (eventData.type) {
            case 'message_start':
                handlers.messageStart?.(eventData);
                break;
            case 'content_block_start':
                handlers.contentBlockStart?.(eventData);
                break;
            case 'content_block_delta':
                handlers.contentBlockDelta?.(eventData);
                break;
            case 'message_delta':
                handlers.messageDelta?.(eventData);
                break;
        }
    }
    
    // 平铺显示JSON流
    formatJSONStream(data, title) {
        // 确保data是字符串类型
        if (typeof data !== 'string') {
            if (data === null || data === undefined) {
                return this.createJsonContainer('(空)', title);
            }
            // 如果不是字符串，尝试转换为JSON字符串
            try {
                data = JSON.stringify(data, null, 2);
            } catch {
                data = String(data);
            }
        }
        
        // 如果是空字符串或只有空白字符，显示空内容
        if (!data || !data.trim()) {
            return this.createJsonContainer('(空)', title);
        }
        
        const lines = data.split('\n').filter(line => line.trim());
        const lineHighlighted = this.highlightJSONStreamLines(lines);
        const tableView = this.createJSONStreamTable(lines);
        const jsonMode = this.extractJSONStreamAsArray(lines);
        
        // 提取合并的文本内容
        const mergedText = this.extractMergedTextFromSSE(data);
        
        // 重构完整的非流式响应
        const reconstructedResponse = this.reconstructClaudeResponse(data);
        
        return this.createSSEContainer(lineHighlighted, jsonMode, title, data, tableView, mergedText, reconstructedResponse);
    }
    
    // 创建JSON按行表格
    createJSONStreamTable(lines) {
        // 检测是否是SSE格式的数据
        const isSSEData = lines.some(line => 
            line.trim().startsWith('id:') || 
            line.trim().startsWith('event:') || 
            line.trim().startsWith(':HTTP_STATUS/') || 
            line.trim().startsWith('data:')
        );
        
        // 检测是否是Ollama格式的数据
        const isOllamaFormat = lines.length > 0 && lines[0].startsWith('{"model"');
        
        if (isSSEData) {
            // 如果是SSE格式，使用SSE解析逻辑
            return this.createSSETable(lines);
        }
        
        let tableHtml = `
            <div style="max-height: 500px; overflow-y: auto; overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; font-family: 'JetBrains Mono', monospace;">
                    <thead>
                        <tr style="border-bottom: 2px solid #e9ecef;">
                            <th style="padding: 8px 12px; text-align: left; border: 1px solid #e9ecef; font-weight: 600; color: #495057; position: sticky; top: 0; background: white; z-index: 10;">ID</th>
                            <th style="padding: 8px 12px; text-align: left; border: 1px solid #e9ecef; font-weight: 600; color: #495057; position: sticky; top: 0; background: white; z-index: 10;">方向</th>
                            <th style="padding: 8px 12px; text-align: left; border: 1px solid #e9ecef; font-weight: 600; color: #495057; position: sticky; top: 0; background: white; z-index: 10;">状态</th>
                            <th style="padding: 8px 12px; text-align: left; border: 1px solid #e9ecef; font-weight: 600; color: #495057; position: sticky; top: 0; background: white; z-index: 10;">类型</th>
                            <th style="padding: 8px 12px; text-align: left; border: 1px solid #e9ecef; font-weight: 600; color: #495057; min-width: 200px; position: sticky; top: 0; background: white; z-index: 10;">值</th>
                        </tr>
                    </thead>
                    <tbody>`;
        
        lines.forEach((line, index) => {
            line = line.trim();
            if (!line) return;
            
            let id = '', status = '', type = '', value = '', direction = '↓';
            
            try {
                const parsed = JSON.parse(line);
                
                if (isOllamaFormat) {
                    // Ollama格式处理
                    id = index + 1;
                    type = 'ollama';
                    
                    if (parsed.model) {
                        if (parsed.message && parsed.message.content !== undefined) {
                            status = parsed.done ? '完成' : '内容';
                            const content = parsed.message.content;
                            const contentPreview = content.length > 50 ? content.substring(0, 50) + '...' : content;
                            value = `模型: ${parsed.model} | 内容: "${contentPreview}"`;
                            if (parsed.done) {
                                if (parsed.prompt_eval_count !== undefined && parsed.eval_count !== undefined) {
                                    value += ` | 输入tokens: ${parsed.prompt_eval_count} | 输出tokens: ${parsed.eval_count}`;
                                }
                            }
                        } else {
                            status = '元数据';
                            value = `模型: ${parsed.model}`;
                        }
                    } else {
                        status = '其他';
                        value = JSON.stringify(parsed).substring(0, 100) + '...';
                    }
                } else {
                    // 原有的Claude/OpenAI格式处理
                    // 提取字段
                    id = parsed.id || parsed.message?.id || (index + 1);
                    type = parsed.type || '';
                    
                    // 根据类型确定状态和值
                    if (parsed.type === 'message_start') {
                        status = '开始';
                        value = `模型: ${parsed.message?.model || ''}, 角色: ${parsed.message?.role || ''}`;
                    } else if (parsed.type === 'message_delta') {
                        status = '数据';
                        if (parsed.usage) {
                            value = `用量 - 输入: ${parsed.usage.input_tokens || 0}, 输出: ${parsed.usage.output_tokens || 0}`;
                        } else {
                            value = 'Delta 更新';
                        }
                    } else if (parsed.type === 'message_stop') {
                        status = '结束';
                        value = parsed.delta?.stop_reason || '会话结束';
                    } else if (parsed.type === 'content_block_start') {
                        status = '内容开始';
                        value = `内容块 - 类型: ${parsed.content_block?.type || ''}, 索引: ${parsed.index || 0}`;
                    } else if (parsed.type === 'content_block_delta') {
                        status = '内容数据';
                        if (parsed.delta?.text) {
                            const text = parsed.delta.text.length > 100 ? parsed.delta.text.substring(0, 100) + '...' : parsed.delta.text;
                            value = `文本: "${text}"`;
                        } else {
                            value = 'Delta 内容';
                        }
                    } else if (parsed.type === 'content_block_stop') {
                        status = '内容结束';
                        value = `索引: ${parsed.index || 0}`;
                    } else {
                        status = '其他';
                        value = JSON.stringify(parsed).substring(0, 100) + '...';
                    }
                }
                
            } catch {
                type = 'invalid';
                status = '错误';
                value = line.substring(0, 100) + '...';
            }
            
            // 获取类型颜色
            const typeColor = this.getMessageTypeColor(type);
            const statusColor = this.getStatusColor(status);
            
            tableHtml += `
                <tr style="border-bottom: 1px solid #e9ecef;">
                    <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: #495057; font-weight: 500;">${this.escapeHtml(String(id))}</td>
                    <td style="padding: 8px 12px; border: 1px solid #e9ecef; text-align: center; font-size: 14px;">${direction}</td>
                    <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: ${statusColor}; font-weight: 500;">${status}</td>
                    <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: ${typeColor}; font-weight: 500;">${type}</td>
                    <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: #495057; word-break: break-word;">${this.escapeHtml(value)}</td>
                </tr>`;
        });
        
        tableHtml += `
                    </tbody>
                </table>
            </div>`;
        
        return tableHtml;
    }
    
    // 基于events数组创建SSE表格
    createSSETableFromEvents(events) {
        
        let tableHtml = `
            <div style="border: 1px solid #e9ecef; border-radius: 6px; background: white;">
                <div style="background: #f8f9fa; border-bottom: 1px solid #e9ecef; padding: 0; position: sticky; top: 0; z-index: 10;">
                    <div style="display: grid; grid-template-columns: 80px 60px 100px 150px 1fr; gap: 0; padding: 8px 0; font-size: 12px; font-weight: 600; color: #495057;">
                        <div style="padding: 8px 12px; border-right: 1px solid #e9ecef;">ID</div>
                        <div style="padding: 8px 12px; border-right: 1px solid #e9ecef; text-align: center;">方向</div>
                        <div style="padding: 8px 12px; border-right: 1px solid #e9ecef;">状态码</div>
                        <div style="padding: 8px 12px; border-right: 1px solid #e9ecef;">事件</div>
                        <div style="padding: 8px 12px;">内容</div>
                    </div>
                </div>
                <div style="height: 350px; overflow-y: auto; font-size: 12px; font-family: 'JetBrains Mono', monospace;">`;
        
        // 如果没有事件，显示空行
        if (events.length === 0) {
            tableHtml += `
                <div style="padding: 40px; text-align: center; color: #6c757d; font-style: italic;">暂无数据</div>`;
        } else {
            events.forEach((event, index) => {
                const statusColor = this.getStatusColor(event.status);
                
                // 修复状态码显示问题：如果status包含:HTTP_STATUS/，提取数字部分
                let displayStatus = event.status;
                if (displayStatus && displayStatus.includes(':HTTP_STATUS/')) {
                    displayStatus = displayStatus.replace(':HTTP_STATUS/', '');
                }
                
                tableHtml += `
                    <div style="display: grid; grid-template-columns: 80px 60px 100px 150px 1fr; gap: 0; border-bottom: 1px solid #e9ecef; hover:background: #f9fafb;">
                        <div style="padding: 8px 12px; color: #495057; font-weight: 500; border-right: 1px solid #e9ecef; overflow: hidden;">${this.escapeHtml(event.id || '-')}</div>
                        <div style="padding: 8px 12px; text-align: center; font-size: 14px; border-right: 1px solid #e9ecef;">↓</div>
                        <div style="padding: 8px 12px; color: ${statusColor}; font-weight: 500; border-right: 1px solid #e9ecef; overflow: hidden;">${this.escapeHtml(displayStatus || '-')}</div>
                        <div style="padding: 8px 12px; color: #7c3aed; font-weight: 500; border-right: 1px solid #e9ecef; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">${this.escapeHtml(event.eventType || '-')}</div>
                        <div style="padding: 8px 12px; color: #495057; word-break: break-word; font-family: monospace; line-height: 1.4; max-height: 100px; overflow-y: auto;">${this.escapeHtml(event.content || '-')}</div>
                    </div>`;
            });
        }
        
        tableHtml += `
                </div>
            </div>`;
        

        return tableHtml;
    }

    // 创建普通SSE表格
    createSSETable(lines) {
        // 确保lines是数组类型
        if (!Array.isArray(lines)) {
            if (typeof lines === 'string') {
                lines = lines.split('\n').filter(line => line.trim());
            } else {
                lines = [];
            }
        }
        
        let tableHtml = `
            <div style="max-height: 500px; overflow-y: auto; overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; font-family: 'JetBrains Mono', monospace;">
                    <thead>
                        <tr style="border-bottom: 2px solid #e9ecef;">
                            <th style="padding: 8px 12px; text-align: left; border: 1px solid #e9ecef; font-weight: 600; color: #495057; position: sticky; top: 0; background: white; z-index: 10;">ID</th>
                            <th style="padding: 8px 12px; text-align: left; border: 1px solid #e9ecef; font-weight: 600; color: #495057; position: sticky; top: 0; background: white; z-index: 10;">方向</th>
                            <th style="padding: 8px 12px; text-align: left; border: 1px solid #e9ecef; font-weight: 600; color: #495057; position: sticky; top: 0; background: white; z-index: 10;">状态码</th>
                            <th style="padding: 8px 12px; text-align: left; border: 1px solid #e9ecef; font-weight: 600; color: #495057; position: sticky; top: 0; background: white; z-index: 10;">事件</th>
                            <th style="padding: 8px 12px; text-align: left; border: 1px solid #e9ecef; font-weight: 600; color: #495057; min-width: 300px; position: sticky; top: 0; background: white; z-index: 10;">内容</th>
                        </tr>
                    </thead>
                    <tbody>`;
        
        // 如果没有数据，显示空行
        if (lines.length === 0) {
            tableHtml += `
                <tr style="border-bottom: 1px solid #e9ecef;">
                    <td colspan="5" style="padding: 16px 12px; border: 1px solid #e9ecef; color: #6c757d; text-align: center; font-style: italic;">暂无数据</td>
                </tr>`;
        } else if (lines.length === 1) {
            const line = lines[0].trim();
            tableHtml += `
                <tr style="border-bottom: 1px solid #e9ecef;">
                    <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: #495057;">-</td>
                    <td style="padding: 8px 12px; border: 1px solid #e9ecef; text-align: center; font-size: 14px;">↓</td>
                    <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: #495057;">-</td>
                    <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: #495057;">-</td>
                    <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: #495057; word-break: break-word; font-family: monospace;">${this.escapeHtml(line)}</td>
                </tr>`;
        } else {
            // 多行时按SSE事件组合解析
            const events = this.parseSSEEvents(lines);
            
            events.forEach((event, index) => {
                const eventColor = this.getStatusColor(event.status);
                
                tableHtml += `
                    <tr style="border-bottom: 1px solid #e9ecef;">
                        <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: #495057; font-weight: 500;">${this.escapeHtml(event.id || '-')}</td>
                        <td style="padding: 8px 12px; border: 1px solid #e9ecef; text-align: center; font-size: 14px;">↓</td>
                        <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: ${eventColor}; font-weight: 500;">${this.escapeHtml(event.status || '-')}</td>
                        <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: #7c3aed; font-weight: 500;">${this.escapeHtml(event.eventType || '-')}</td>
                        <td style="padding: 8px 12px; border: 1px solid #e9ecef; color: #495057; word-break: break-word; font-family: monospace; white-space: pre-wrap;">${this.escapeHtml(event.content || '-')}</td>
                    </tr>`;
            });
        }
        
        tableHtml += `
                    </tbody>
                </table>
            </div>`;
        
        return tableHtml;
    }

        // 解析SSE事件
    parseSSEEvents(lines) {
        // 确保lines是数组类型
        if (!Array.isArray(lines)) {
            if (typeof lines === 'string') {
                lines = lines.split('\n');
            } else {
                return [];
            }
        }
        
        const events = [];
        let currentEvent = null;
        let eventCounter = 0; // 为没有ID的data行自动生成ID
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue; // 跳过空行
            
            if (line.startsWith('id:')) {
                // 遇到新ID，保存上一个事件并开始新事件
                if (currentEvent) {
                    events.push(currentEvent);
                }
                currentEvent = {
                    id: line.substring(3).trim(),
                    httpStatus: '',
                    eventType: '',
                    content: '',
                    status: ''
                };
            } else if (line.startsWith('event:')) {
                if (currentEvent) {
                    currentEvent.eventType = line.substring(6).trim();
                }
            } else if (line.startsWith(':HTTP_STATUS/')) {
                if (currentEvent) {
                    const statusCode = line.substring(13).trim();
                    currentEvent.httpStatus = statusCode;
                    currentEvent.status = statusCode;
                }
            } else if (line.startsWith('data:')) {
                // 如果没有当前事件，为data行创建一个新事件
                if (!currentEvent) {
                    eventCounter++;
                    currentEvent = {
                        id: `${eventCounter}`,
                        httpStatus: '200',
                        eventType: 'data',
                        content: '',
                        status: '200'
                    };
                }
                
                const dataContent = line.substring(5).trim();
                if (dataContent) {
                    try {
                        const parsed = JSON.parse(dataContent);
                        currentEvent.content = JSON.stringify(parsed, null, 2);
                    } catch {
                        currentEvent.content = dataContent;
                    }
                }
                
                // 对于data-only格式，每一行data都是一个独立的事件
                events.push(currentEvent);
                currentEvent = null;
            } else if (line.startsWith(': ')) {
                // 处理注释行（如": OPENROUTER PROCESSING"）
                eventCounter++;
                events.push({
                    id: `${eventCounter}`,
                    httpStatus: '200',
                    eventType: 'comment',
                    content: line.substring(2).trim(),
                    status: '200'
                });
            }
        }
        
        // 添加最后一个事件
        if (currentEvent) {
            events.push(currentEvent);
        }
        
        return events;
    }

    // 筛选功能
    applyFilter() {
        if (this.currentFilter === 'all') {
            this.filteredRecords = [...this.records];
        } else {
            this.filteredRecords = this.records.filter(record => record.method === this.currentFilter);
        }
    }

    filterByMethod(method) {
        this.currentFilter = method;
        this.saveFilterToCache();
        this.updateFilterButtons();
        this.renderRecordsList();
        
        // 如果当前选中的记录不在筛选结果中，清空详情面板
        if (this.selectedRecordId) {
            const isSelectedInFiltered = this.filteredRecords.some(record => record.id === this.selectedRecordId);
            if (!isSelectedInFiltered) {
                this.selectedRecordId = null;
                this.renderDetailView();
            }
        }
    }

    updateFilterButtons() {
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            const method = btn.getAttribute('data-method');
            if (method === this.currentFilter) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    saveFilterToCache() {
        localStorage.setItem('api_monitor_filter', this.currentFilter);
    }

    loadFilterFromCache() {
        const savedFilter = localStorage.getItem('api_monitor_filter');
        if (savedFilter) {
            this.currentFilter = savedFilter;
            // 延迟更新按钮，确保DOM已加载
            setTimeout(() => {
                this.updateFilterButtons();
            }, 100);
        }
    }

    // 保存全局视图状态到本地存储
    saveGlobalViewStatesToStorage() {
        localStorage.setItem('api_monitor_global_view_states', JSON.stringify(this.globalViewStates));
    }

    // 从本地存储加载全局视图状态
    loadGlobalViewStatesFromStorage() {
        try {
            const savedStates = localStorage.getItem('api_monitor_global_view_states');
            if (savedStates) {
                this.globalViewStates = { ...this.globalViewStates, ...JSON.parse(savedStates) };
            }
        } catch (error) {
            console.warn('加载全局视图状态失败:', error);
        }
        console.log('加载的全局视图状态:', this.globalViewStates);
    }

    // 保存全局视图状态
    saveGlobalViewState(viewType, mode, subMode = null) {
        this.globalViewStates[viewType] = mode;
        // 对于响应体的子模式，保存完整的状态
        if (viewType === 'response_body' && mode === 'response' && subMode) {
            this.globalViewStates.response_body_sub = subMode;
        }
        this.saveGlobalViewStatesToStorage();
        console.log(`保存全局视图状态 - 类型: ${viewType}, 模式: ${mode}, 子模式: ${subMode}`);
    }

    // 获取全局视图状态
    getGlobalViewState(viewType) {
        return this.globalViewStates[viewType] || 'formatted';
    }

    // 恢复指定类型的视图状态
    restoreViewState(type) {
        const savedMode = this.getGlobalViewState(type);
        console.log(`恢复全局视图状态 - 类型: ${type}, 模式: ${savedMode}`);
        
        // 延迟恢复状态，确保DOM已完全渲染
        setTimeout(() => {
            if (type === 'response_body') {
                this.restoreResponseBodyViewState({ mode: savedMode, subMode: this.globalViewStates.response_body_sub });
            } else {
                this.restoreJsonViewState(type, { mode: savedMode });
            }
        }, 100);
    }

    // 恢复响应体视图状态（包括SSE和JSON两种情况）
    restoreResponseBodyViewState(savedState) {
        const container = this.detailContent.querySelector(`[data-content-type="response_body"]`);
        if (!container) {
            console.log('未找到响应体容器');
            return;
        }
        
        // 检查是否有SSE容器 - 通过查找SSE特有的按钮来判断
        const sseContainer = container.querySelector('[id*="container"]');
        const hasSSEButtons = sseContainer && sseContainer.querySelectorAll('.json-mode-btn').length > 2;
        

        
        if (sseContainer && hasSSEButtons) {
            console.log(`找到SSE容器: ${sseContainer.id}, 恢复模式: ${savedState.mode}`);
            // 恢复SSE视图状态
            const containerId = sseContainer.id;
            if (savedState.mode) {
                // 延迟恢复，确保DOM完全渲染
                setTimeout(() => {
                    console.log(`开始恢复SSE容器视图状态: ${containerId} -> ${savedState.mode}`);
                    this.switchSSEMode(containerId, savedState.mode, true); // 传入true表示这是恢复操作
                }, 150);
                
                // 如果是response模式且有子模式，恢复子模式状态
                if (savedState.mode === 'response' && savedState.subMode) {
                    setTimeout(() => {
                        console.log(`恢复完整响应子模式: ${savedState.subMode}`);
                        // 查找完整响应容器
                        const responseView = sseContainer.querySelector('.sse-response-view');
                        if (responseView) {
                            const responseContainer = responseView.querySelector('[data-container-id]');
                            if (responseContainer) {
                                const responseContainerId = responseContainer.getAttribute('data-container-id');
                                this.switchResponseMode(responseContainerId, savedState.subMode, true);
                            }
                        }
                    }, 200); // 确保SSE模式切换完成后再恢复子模式
                }
            }
        } else {
            console.log('未找到SSE容器，尝试恢复普通JSON视图');
            // 恢复普通JSON视图状态
            this.restoreJsonViewState('response_body', savedState);
        }
    }

    // 恢复JSON视图状态
    restoreJsonViewState(type, savedState) {
        const container = this.detailContent.querySelector(`[data-content-type="${type}"]`);
        if (!container) {
            console.log(`未找到${type}容器`);
            return;
        }
        
        const jsonContainer = container.querySelector('.json-container') || container.querySelector('[id^="container_"]');
        
        if (jsonContainer && savedState.mode) {
            const buttonsCount = jsonContainer.querySelectorAll('.json-mode-btn').length;
            
            // 检查是否是SSE容器（有超过2个按钮说明是SSE容器）
            const isSSEContainer = buttonsCount > 2;
            
            if (buttonsCount >= 2 && !isSSEContainer) {
                // 只对普通JSON容器进行恢复，SSE容器由restoreResponseBodyViewState处理
                const containerId = jsonContainer.id;
                console.log(`恢复普通JSON容器视图状态: ${containerId}, 模式: ${savedState.mode}`);
                this.switchJsonMode(containerId, savedState.mode, true); // 传入true表示这是恢复操作
            } else if (isSSEContainer) {
                console.log(`跳过SSE容器的JSON视图恢复: ${jsonContainer.id}`);
            }
        }
    }

    // 获取HTTP状态码对应的文本
    getHTTPStatusText(status) {
        if (!status) return '-';
        
        // 如果status是完整格式如":HTTP_STATUS/200"，提取数字部分
        let statusCode = status;
        if (status.includes('/')) {
            statusCode = status.split('/')[1];
        }
        
        const statusMap = {
            '200': '200 OK',
            '201': '201 Created', 
            '202': '202 Accepted',
            '400': '400 Bad Request',
            '401': '401 Unauthorized',
            '403': '403 Forbidden',
            '404': '404 Not Found',
            '500': '500 Internal Server Error',
            '502': '502 Bad Gateway',
            '503': '503 Service Unavailable'
        };
        
        return statusMap[statusCode] || `${statusCode}` || '-';
    }
    
    // 获取状态对应的颜色
    getStatusColor(status) {
        const colorMap = {
            '开始': '#10b981',
            '数据': '#3b82f6', 
            '结束': '#ef4444',
            '内容开始': '#8b5cf6',
            '内容数据': '#f59e0b',
            '内容结束': '#6b7280',
            '错误': '#dc2626',
            '其他': '#6c757d',
            '完成': '#059669',
            '内容': '#0ea5e9',
            '事件': '#7c3aed',
            '标识': '#2563eb',
            '重试': '#ea580c',
            '文本': '#64748b',
            '200 OK': '#10b981',
            '201 Created': '#10b981',
            '400 Bad Request': '#f59e0b',
            '401 Unauthorized': '#ef4444',
            '403 Forbidden': '#ef4444',
            '404 Not Found': '#ef4444',
            '500 Internal Server Error': '#dc2626',
            '200': '#10b981',
            '201': '#10b981',
            '400': '#f59e0b',
            '401': '#ef4444',
            '403': '#ef4444',
            '404': '#ef4444',
            '500': '#dc2626'
        };
        return colorMap[status] || '#6c757d';
    }
    
    // 高亮JSON流的每一行
    highlightJSONStreamLines(lines) {
        return lines.map((line, index) => {
            line = line.trim();
            if (!line) return '';
            
            let html = '<div style="margin: 4px 0; padding: 8px; border: 1px solid #e5e7eb; border-radius: 4px; background: #f9fafb;">';
            html += `<div style="color: #6b7280; font-size: 11px; margin-bottom: 4px;">Stream ${index + 1}</div>`;
            
            try {
                const parsed = JSON.parse(line);
                const formatted = JSON.stringify(parsed, null, 2);
                const highlighted = this.highlightJson(formatted);
                html += `<div style="margin: 4px 0; padding: 8px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 4px;">${highlighted}</div>`;
                
                // 显示关键信息摘要
                if (parsed.type) {
                    const typeColor = this.getMessageTypeColor(parsed.type);
                    html += `<div style="margin-top: 4px; font-size: 11px;"><span style="color: ${typeColor}; font-weight: 600;">类型:</span> ${parsed.type}</div>`;
                }
                
                if (parsed.delta && parsed.delta.text) {
                    const text = parsed.delta.text.length > 50 ? parsed.delta.text.substring(0, 50) + '...' : parsed.delta.text;
                    html += `<div style="margin-top: 2px; font-size: 11px;"><span style="color: #059669; font-weight: 600;">文本:</span> "${this.escapeHtml(text)}"</div>`;
                }
                
                if (parsed.usage) {
                    html += `<div style="margin-top: 2px; font-size: 11px;"><span style="color: #dc2626; font-weight: 600;">用量:</span> 输入:${parsed.usage.input_tokens || 0} 输出:${parsed.usage.output_tokens || 0}</div>`;
                }
                
            } catch {
                html += `<div style="color: #dc2626; font-style: italic;">无效JSON: ${this.escapeHtml(line)}</div>`;
            }
            
            html += '</div>';
            return html;
        }).join('');
    }
    
    // 获取消息类型对应的颜色
    getMessageTypeColor(type) {
        const colorMap = {
            'message_start': '#10b981',
            'message_delta': '#3b82f6',
            'message_stop': '#ef4444',
            'content_block_start': '#8b5cf6',
            'content_block_delta': '#f59e0b',
            'content_block_stop': '#6b7280',
            'data': '#0ea5e9',
            'event': '#7c3aed',
            'id': '#2563eb',
            'retry': '#ea580c',
            'json': '#059669',
            'text': '#64748b',
            'invalid': '#dc2626'
        };
        return colorMap[type] || '#374151';
    }
    
    // 提取JSON流数据并合并为数组
    extractJSONStreamAsArray(lines) {
        const validJson = [];
        
        lines.forEach(line => {
            line = line.trim();
            if (!line) return;
            
            try {
                const parsed = JSON.parse(line);
                validJson.push(parsed);
            } catch {
                // 忽略无效JSON行
            }
        });
        
        if (validJson.length === 0) return null;
        
        try {
            const combined = validJson;
            const jsonString = JSON.stringify(combined, null, 2);
            const highlighted = this.highlightJson(jsonString);
            const treeView = this.renderJsonTree(combined);
            
            return { 
                highlighted, 
                treeView, 
                jsonString 
            };
        } catch {
            return null;
        }
    }

    // 按行高亮SSE内容 - 重新设计为事件块视图
    highlightSSELines(data) {
        // 解析SSE事件
        const events = this.parseSSEEvents(data.split('\n').filter(line => line.trim()));
        
        return events.map((event, index) => {
            let html = `<div style="margin: 12px 0; padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafbfc; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">`;
            
            // 事件标题
            html += `<div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb;">`;
            html += `<span style="font-size: 14px; font-weight: 600; color: #1f2937;">事件 ${event.id || index + 1}</span>`;
            if (event.eventType) {
                html += `<span style="margin-left: 12px; padding: 2px 8px; background: #ddd6fe; color: #5b21b6; border-radius: 12px; font-size: 11px; font-weight: 500;">${event.eventType}</span>`;
            }
            if (event.status) {
                const displayStatus = event.status.includes(':HTTP_STATUS/') ? event.status.replace(':HTTP_STATUS/', '') : event.status;
                const statusColor = this.getStatusColor(displayStatus);
                html += `<span style="margin-left: 8px; padding: 2px 8px; background: #dcfce7; color: ${statusColor}; border-radius: 12px; font-size: 11px; font-weight: 500;">${displayStatus}</span>`;
            }
            html += `</div>`;
            
            // 事件详细信息
            html += `<div style="display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-family: 'JetBrains Mono', monospace; font-size: 13px;">`;
            
            if (event.id) {
                html += `<div style="color: #8b5cf6; font-weight: 600;">ID:</div>`;
                html += `<div style="color: #059669; font-weight: 500;">${this.escapeHtml(event.id)}</div>`;
            }
            
            if (event.eventType) {
                html += `<div style="color: #3b82f6; font-weight: 600;">类型:</div>`;
                html += `<div style="color: #dc2626; font-weight: 500;">${this.escapeHtml(event.eventType)}</div>`;
            }
            
            if (event.status) {
                html += `<div style="color: #6b7280; font-weight: 600;">状态:</div>`;
                html += `<div style="color: #6b7280; font-style: italic;">${this.escapeHtml(event.status)}</div>`;
            }
            
            if (event.content) {
                html += `<div style="color: #059669; font-weight: 600; align-self: start;">数据:</div>`;
                html += `<div style="background: white; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px; overflow-x: auto; max-height: 200px; overflow-y: auto;">`;
                try {
                    const parsed = JSON.parse(event.content);
                    const formatted = JSON.stringify(parsed, null, 2);
                    const highlighted = this.highlightJson(formatted);
                    html += highlighted;
                } catch {
                    html += `<span style="color: #374151;">${this.escapeHtml(event.content)}</span>`;
                }
                html += `</div>`;
            }
            
            html += `</div>`;
            html += `</div>`;
            
            return html;
        }).join('');
    }

    // 旧版本删除，使用新版本parseSSEEvents

    // 提取SSE数据为JSON数组
    extractSSEDataAsJson(data) {
        const dataEntries = [];
        const events = this.parseSSEEvents(data);
        
        events.forEach(event => {
            if (event.content) {
                try {
                    const parsed = JSON.parse(event.content);
                    dataEntries.push(parsed);
                } catch {
                    // 如果不是有效JSON，跳过
                }
            }
        });
        
        if (dataEntries.length > 0) {
            const jsonString = JSON.stringify(dataEntries, null, 2);
            const highlighted = this.highlightJson(jsonString);
            const treeView = this.renderJsonTree(dataEntries);
            return { highlighted, treeView, jsonString, originalData: dataEntries };
        }
        
        return null;
    }

    // 创建SSE容器
    createSSEContainer(lineContent, jsonMode, title, rawData, tableView = null, mergedText = null, reconstructedResponse = null) {
        const copyId = 'copy_' + Math.random().toString(36).substr(2, 9);
        const contentId = 'content_' + Math.random().toString(36).substr(2, 9);
        const containerId = 'container_' + Math.random().toString(36).substr(2, 9);
        
        // 检测是否是JSON流格式
        const isJsonStream = this.isJSONStream(rawData);
        const buttonLabels = isJsonStream ? 
            { lines: '按行', table: '表格', json: '合并', tree: '树状', text: '文本', response: '完整' } : 
            { lines: '按行', table: '表格', json: 'JSON', tree: '树状', text: '文本', response: '完整' };
        
        // 生成合并文本的HTML
        const mergedTextHtml = mergedText ? this.createMergedTextView(mergedText) : '';
        
        // 生成重构响应的HTML
        const reconstructedHtml = reconstructedResponse ? this.createReconstructedResponseView(reconstructedResponse) : '';
        
        return `
            <div class="json-container" id="${containerId}">
                <div class="json-header">
                    <span>${this.escapeHtml(title)}</span>
                    <div class="flex items-center gap-1">
                        <div class="json-mode-toggle">
                            <button class="json-mode-btn active" onclick="monitor.switchSSEMode('${containerId}', 'table')" data-mode="table">${buttonLabels.table}</button>
                            <button class="json-mode-btn" onclick="monitor.switchSSEMode('${containerId}', 'lines')" data-mode="lines">${buttonLabels.lines}</button>
                            ${jsonMode ? `<button class="json-mode-btn" onclick="monitor.switchSSEMode('${containerId}', 'json')" data-mode="json">${buttonLabels.json}</button>` : ''}
                            ${jsonMode && jsonMode.treeView ? `<button class="json-mode-btn" onclick="monitor.switchSSEMode('${containerId}', 'tree')" data-mode="tree">${buttonLabels.tree}</button>` : ''}
                            ${mergedText ? `<button class="json-mode-btn" onclick="monitor.switchSSEMode('${containerId}', 'text')" data-mode="text">${buttonLabels.text}</button>` : ''}
                            ${reconstructedResponse ? `<button class="json-mode-btn" onclick="monitor.switchSSEMode('${containerId}', 'response')" data-mode="response">${buttonLabels.response}</button>` : ''}
                        </div>
                        <button class="copy-btn" onclick="monitor.showFullscreen('${this.escapeJsString(title)}', '${containerId}')" title="全屏查看">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2 2H5M2 2V5M2 2L5 5M10 10H7M10 10V7M10 10L7 7M10 2H7M10 2V5M10 2L7 5M2 10H5M2 10V7M2 10L5 7" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button class="copy-btn" onclick="monitor.copyToClipboard('${copyId}', '${contentId}')" id="${copyId}" title="复制内容">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M8 3H9.5C10.3 3 11 3.7 11 4.5V9.5C11 10.3 10.3 11 9.5 11H4.5C3.7 11 3 10.3 3 9.5V8M2.5 1H7.5C8.3 1 9 1.7 9 2.5V7.5C9 8.3 8.3 9 7.5 9H2.5C1.7 9 1 8.3 1 7.5V2.5C1 1.7 1.7 1 2.5 1Z" stroke="currentColor" stroke-width="1" fill="none"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="json-content" id="${contentId}">
                    <div class="sse-table-view">${tableView}</div>
                    <div class="sse-lines-view" style="display: none;">${lineContent}</div>
                    ${jsonMode ? `<div class="sse-json-view" style="display: none;">${jsonMode.highlighted}</div>` : ''}
                    ${jsonMode && jsonMode.treeView ? `<div class="sse-tree-view" style="display: none;">${jsonMode.treeView}</div>` : ''}
                    ${mergedText ? `<div class="sse-text-view" style="display: none;">${mergedTextHtml}</div>` : ''}
                    ${reconstructedResponse ? `<div class="sse-response-view" style="display: none;">${reconstructedHtml}</div>` : ''}
                </div>
                <textarea style="position: absolute; left: -9999px;" id="${contentId}_raw">${this.escapeHtml(rawData)}</textarea>
                ${jsonMode ? `<script type="application/json" id="${contentId}_data">${this.escapeHtml(jsonMode.jsonString)}</script>` : ''}
            </div>
        `;
    }

    // 创建合并文本视图
    createMergedTextView(mergedText) {
        if (!mergedText || !mergedText.content) return '';
        
        const escapedContent = this.escapeHtml(mergedText.content);
        const escapedSummary = this.escapeHtml(mergedText.summary || '合并文本');
        
        return `
            <div style="padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                <div style="display: flex; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0;">
                    <svg style="width: 16px; height: 16px; margin-right: 8px; color: #059669;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                    <span style="font-weight: 600; color: #059669; font-size: 14px;">${escapedSummary}</span>
                </div>
                <div style="background: white; padding: 16px; border-radius: 6px; border: 1px solid #e2e8f0; font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; color: #374151; max-height: 400px; overflow-y: auto;">
                    ${escapedContent}
                </div>
            </div>
        `;
    }

    // 创建重构响应视图
    createReconstructedResponseView(reconstructedResponse) {
        if (!reconstructedResponse) return '';
        
        // 如果传入的是包装对象，提取content字段
        let actualResponse = reconstructedResponse;
        if (reconstructedResponse.content && typeof reconstructedResponse.content === 'string') {
            try {
                actualResponse = JSON.parse(reconstructedResponse.content);
            } catch (e) {
                // 如果解析失败，使用原始对象
                actualResponse = reconstructedResponse;
            }
        }
        
        const jsonString = JSON.stringify(actualResponse, null, 2);
        const highlighted = this.highlightJson(jsonString);
        const treeView = this.renderJsonTree(actualResponse);
        
        // 生成唯一ID
        const containerId = 'response_' + Math.random().toString(36).substr(2, 9);
        const contentId = 'content_' + Math.random().toString(36).substr(2, 9);
        
        return `
            <div style="padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0;">
                    <div style="display: flex; align-items: center;">
                        <svg style="width: 16px; height: 16px; margin-right: 8px; color: #3b82f6;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                        </svg>
                        <span style="font-weight: 600; color: #3b82f6; font-size: 14px;">完整响应 (非按行格式)</span>
                        <span style="margin-left: 8px; font-size: 12px; color: #6b7280;">包含合并后的内容块和完整用法统计</span>
                    </div>
                    <div class="json-mode-toggle" style="display: flex; gap: 2px;">
                        <button class="json-mode-btn active" onclick="monitor.switchResponseMode('${containerId}', 'formatted')" data-mode="formatted" style="padding: 4px 8px; font-size: 11px; font-weight: 500; border: 1px solid #d1d5db; background: #3b82f6; color: white; border-radius: 4px; cursor: pointer; transition: all 0.2s;">平铺</button>
                        <button class="json-mode-btn" onclick="monitor.switchResponseMode('${containerId}', 'tree')" data-mode="tree" style="padding: 4px 8px; font-size: 11px; font-weight: 500; border: 1px solid #d1d5db; background: white; color: #6b7280; border-radius: 4px; cursor: pointer; transition: all 0.2s;">树状</button>
                    </div>
                </div>
                <div class="json-content" id="${contentId}" style="background: white; padding: 16px; border-radius: 6px; border: 1px solid #e2e8f0; font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 13px; line-height: 1.6; max-height: 500px; overflow-y: auto;" data-container-id="${containerId}">
                    <div class="json-formatted-view">${highlighted}</div>
                    <div class="json-tree-view" style="display: none;">${treeView}</div>
                </div>
            </div>
        `;
    }

    // 切换SSE显示模式
    switchSSEMode(containerId, mode, isRestore = false) {
        // 设置全局恢复标记
        if (isRestore) {
            this.isRestoringSSE = true;
            // 1秒后自动清除标记
            setTimeout(() => {
                this.isRestoringSSE = false;
            }, 1000);
        }
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const linesView = container.querySelector('.sse-lines-view');
        const tableView = container.querySelector('.sse-table-view');
        const jsonView = container.querySelector('.sse-json-view');
        const treeView = container.querySelector('.sse-tree-view');
        const textView = container.querySelector('.sse-text-view');
        const responseView = container.querySelector('.sse-response-view');
        const buttons = container.querySelectorAll('.json-mode-btn');
        
        // 更新按钮状态 - 在恢复过程中临时禁用事件以避免意外触发
        if (isRestore) {
            buttons.forEach(btn => {
                const originalOnclick = btn.onclick;
                btn.onclick = null; // 临时禁用点击事件
                btn.classList.remove('active');
                if (btn.getAttribute('data-mode') === mode) {
                    btn.classList.add('active');
                }
                // 延迟恢复事件监听器
                setTimeout(() => {
                    btn.onclick = originalOnclick;
                }, 100);
            });
        } else {
            buttons.forEach(btn => {
                btn.classList.remove('active');
                if (btn.getAttribute('data-mode') === mode) {
                    btn.classList.add('active');
                }
            });
        }
        
        // 隐藏所有视图
        if (linesView) linesView.style.display = 'none';
        if (tableView) tableView.style.display = 'none';
        if (jsonView) jsonView.style.display = 'none';
        if (treeView) treeView.style.display = 'none';
        if (textView) textView.style.display = 'none';
        if (responseView) responseView.style.display = 'none';
        
        // 显示选中的视图
        switch (mode) {
            case 'lines':
                if (linesView) linesView.style.display = 'block';
                break;
            case 'table':
                if (tableView) tableView.style.display = 'block';
                break;
            case 'json':
                if (jsonView) jsonView.style.display = 'block';
                break;
            case 'tree':
                if (treeView) {
                    treeView.style.display = 'block';
                    // 如果是恢复操作，需要同步内部JSON容器的视图状态
                    if (isRestore) {
                        // SSE容器的树状视图结构不同，查找内部的json-container
                        const jsonContainers = treeView.querySelectorAll('.json-container');
                        console.log(`找到树状视图内的JSON容器数量: ${jsonContainers.length}`);
                        
                        if (jsonContainers.length > 0) {
                            // 对每个容器都应用树状视图
                            jsonContainers.forEach(container => {
                                // 立即执行，避免被其他事件抢先
                                if (container.id) {
                                    console.log(`主动切换JSON容器到树状: ${container.id}`);
                                    this.switchJsonMode(container.id, 'tree', true);
                                }
                            });
                        } else {
                            // 如果没有找到json-container，说明这是SSE树状视图
                            // 直接更新按钮状态即可，因为树状视图已经显示
                            console.log('SSE树状视图已显示，无需额外处理');
                        }
                    }
                }
                break;
            case 'text':
                if (textView) textView.style.display = 'block';
                break;
            case 'response':
                if (responseView) responseView.style.display = 'block';
                break;
        }
        
        // 只在用户手动点击时保存全局视图状态，恢复时不保存
        console.log(`switchSSEMode - isRestore: ${isRestore}, mode: ${mode}`);
        if (!isRestore) {
            this.saveGlobalViewState('response_body', mode);
        }
    }

    // 切换完整响应显示模式（平铺/树状）
    switchResponseMode(containerId, mode, isRestore = false) {
        // 通过data-container-id属性找到对应的容器
        const container = document.querySelector(`[data-container-id="${containerId}"]`);
        if (!container) return;
        
        const formattedView = container.querySelector('.json-formatted-view');
        const treeView = container.querySelector('.json-tree-view');
        
        // 找到对应的按钮容器（向上查找父元素中的按钮）
        const buttonContainer = container.parentElement.querySelector('.json-mode-toggle');
        const buttons = buttonContainer ? buttonContainer.querySelectorAll('.json-mode-btn') : [];
        
        // 更新按钮状态和样式
        buttons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.getAttribute('data-mode') === mode) {
                btn.classList.add('active');
                btn.style.background = '#3b82f6';
                btn.style.color = 'white';
            } else {
                btn.style.background = 'white';
                btn.style.color = '#6b7280';
            }
        });
        
        // 隐藏所有视图
        if (formattedView) formattedView.style.display = 'none';
        if (treeView) treeView.style.display = 'none';
        
        // 显示选中的视图
        switch (mode) {
            case 'formatted':
                if (formattedView) formattedView.style.display = 'block';
                break;
            case 'tree':
                if (treeView) treeView.style.display = 'block';
                break;
        }
        
        // 只在用户手动点击时保存全局视图状态，恢复时不保存
        console.log(`switchResponseMode - isRestore: ${isRestore}, mode: ${mode}`);
        if (!isRestore) {
            this.saveGlobalViewState('response_body', 'response', mode);
        }
    }

    // 创建JSON容器
    createJsonContainer(content, title, rawJson = null, treeView = null, originalData = null) {
        const copyId = 'copy_' + Math.random().toString(36).substr(2, 9);
        const contentId = 'content_' + Math.random().toString(36).substr(2, 9);
        const containerId = 'container_' + Math.random().toString(36).substr(2, 9);
        
        return `
            <div class="json-container" id="${containerId}">
                <div class="json-header">
                    <span>${this.escapeHtml(title)}</span>
                    <div class="flex items-center gap-1">
                        ${treeView ? `
                            <div class="json-mode-toggle">
                                <button class="json-mode-btn active" onclick="monitor.switchJsonMode('${containerId}', 'formatted', false)" data-mode="formatted">平铺</button>
                                <button class="json-mode-btn" onclick="monitor.switchJsonMode('${containerId}', 'tree', false)" data-mode="tree">树状</button>
                            </div>
                        ` : ''}
                        <button class="copy-btn" onclick="monitor.showFullscreen('${this.escapeJsString(title)}', '${containerId}')" title="全屏查看">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2 2H5M2 2V5M2 2L5 5M10 10H7M10 10V7M10 10L7 7M10 2H7M10 2V5M10 2L7 5M2 10H5M2 10V7M2 10L5 7" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        ${rawJson ? `<button class="copy-btn" onclick="monitor.copyToClipboard('${copyId}', '${contentId}')" id="${copyId}" title="复制内容"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8 3H9.5C10.3 3 11 3.7 11 4.5V9.5C11 10.3 10.3 11 9.5 11H4.5C3.7 11 3 10.3 3 9.5V8M2.5 1H7.5C8.3 1 9 1.7 9 2.5V7.5C9 8.3 8.3 9 7.5 9H2.5C1.7 9 1 8.3 1 7.5V2.5C1 1.7 1.7 1 2.5 1Z" stroke="currentColor" stroke-width="1" fill="none"/></svg></button>` : ''}
                    </div>
                </div>
                <div class="json-content" id="${contentId}">
                    <div class="json-formatted-view">${content}</div>
                    ${treeView ? `<div class="json-tree-view" style="display: none;">${treeView}</div>` : ''}
                </div>
                ${rawJson ? `<textarea style="position: absolute; left: -9999px;" id="${contentId}_raw">${rawJson}</textarea>` : ''}
                ${originalData ? `<script type="application/json" id="${contentId}_data">${this.escapeHtml(JSON.stringify(originalData))}</script>` : ''}
            </div>
        `;
    }

    // HTML转义 - 增强版本，彻底防止HTML注入
    escapeHtml(text) {
        if (!text) return '';
        
        // 如果是字符串，进行标准HTML转义
        if (typeof text === 'string') {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#x27;')
                .replace(/\//g, '&#x2F;');
        }
        
        // 对于其他类型，转换为字符串后再转义
        const str = String(text);
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');
    }

    // JavaScript字符串转义，用于onclick等属性
    escapeJsString(text) {
        if (!text) return '';
        const str = String(text);
        return str
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    // JSON语法高亮 - 增强版本，安全处理HTML内容
    highlightJson(jsonString) {
        // 先进行HTML转义
        const escaped = this.escapeHtml(jsonString);
        
        return escaped
            // 键名高亮
            .replace(/("([^"\\]|\\.)*")(\s*:\s*)/g, '<span class="json-key">$1</span><span class="json-punctuation">$3</span>')
            // 字符串值高亮
            .replace(/:\s*("([^"\\]|\\.)*")/g, ': <span class="json-string">$1</span>')
            // 数组中的字符串
            .replace(/(\[|\,)\s*("([^"\\]|\\.)*")/g, '$1<span class="json-string">$2</span>')
            // 数字高亮
            .replace(/:\s*(-?\d+\.?\d*([eE][+-]?\d+)?)/g, ': <span class="json-number">$1</span>')
            .replace(/(\[|\,)\s*(-?\d+\.?\d*([eE][+-]?\d+)?)/g, '$1<span class="json-number">$2</span>')
            // 布尔值高亮
            .replace(/:\s*(true|false)/g, ': <span class="json-boolean">$1</span>')
            .replace(/(\[|\,)\s*(true|false)/g, '$1<span class="json-boolean">$2</span>')
            // null值高亮
            .replace(/:\s*(null)/g, ': <span class="json-null">$1</span>')
            .replace(/(\[|\,)\s*(null)/g, '$1<span class="json-null">$2</span>')
            // 标点符号高亮
            .replace(/([{}\[\],])/g, '<span class="json-punctuation">$1</span>');
    }

    // 渲染JSON树状视图
    renderJsonTree(data, depth = 0, key = '') {
        const escapedKey = key ? this.escapeHtml(key) : '';
        
        if (data === null) {
            return `<div class="json-tree-leaf">${key ? `<span class="json-key key-null">"${escapedKey}"</span><span class="json-punctuation">: </span>` : ''}<span class="json-null json-tree-value" data-copy-value="null" onclick="monitor.copyJsonValueFromData(this)" title="点击复制值">null</span></div>`;
        }
        
        if (typeof data === 'boolean') {
            return `<div class="json-tree-leaf">${key ? `<span class="json-key key-boolean">"${escapedKey}"</span><span class="json-punctuation">: </span>` : ''}<span class="json-boolean json-tree-value" data-copy-value="${data}" onclick="monitor.copyJsonValueFromData(this)" title="点击复制值">${data}</span></div>`;
        }
        
        if (typeof data === 'number') {
            return `<div class="json-tree-leaf">${key ? `<span class="json-key key-number">"${escapedKey}"</span><span class="json-punctuation">: </span>` : ''}<span class="json-number json-tree-value" data-copy-value="${data}" onclick="monitor.copyJsonValueFromData(this)" title="点击复制值">${data}</span></div>`;
        }
        
        if (typeof data === 'string') {
            const escapedData = this.escapeHtml(data);
            // 对于data-copy-value属性，使用原始字符串，只需要转义引号
            const escapedForAttr = data.replace(/"/g, '&quot;');
            return `<div class="json-tree-leaf">${key ? `<span class="json-key key-string">"${escapedKey}"</span><span class="json-punctuation">: </span>` : ''}<span class="json-string json-tree-value" data-copy-value="${escapedForAttr}" onclick="monitor.copyJsonValueFromData(this)" title="点击复制值">"${escapedData}"</span></div>`;
        }
        
        if (Array.isArray(data)) {
            if (data.length === 0) {
                return `<div class="json-tree-leaf">${key ? `<span class="json-key key-array">"${escapedKey}"</span><span class="json-punctuation">: </span>` : ''}<span class="json-punctuation">[]</span></div>`;
            }
            
            const toggleId = 'toggle_' + Math.random().toString(36).substr(2, 9);
            const childrenId = 'children_' + Math.random().toString(36).substr(2, 9);
            
            let html = `<div class="json-tree-item">`;
            html += `<div class="json-tree-toggle json-tree-expanded" onclick="monitor.toggleJsonTreeNode('${toggleId}', '${childrenId}')">`;
            html += `<svg class="json-tree-icon" id="${toggleId}" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            if (key) html += `<span class="json-key key-array">"${escapedKey}"</span><span class="json-punctuation">: </span>`;
            html += `<span class="json-punctuation">[</span> <span style="color: #666; font-size: 11px;">${data.length} items</span> <span class="json-punctuation">]</span>`;
            html += `</div>`;
            
            html += `<div class="json-tree-children" id="${childrenId}">`;
            data.forEach((item, index) => {
                html += this.renderJsonTree(item, depth + 1, `[${index}]`);
            });
            html += `</div></div>`;
            
            return html;
        }
        
        if (typeof data === 'object') {
            const keys = Object.keys(data);
            if (keys.length === 0) {
                return `<div class="json-tree-leaf">${key ? `<span class="json-key key-object">"${escapedKey}"</span><span class="json-punctuation">: </span>` : ''}<span class="json-punctuation">{}</span></div>`;
            }
            
            const toggleId = 'toggle_' + Math.random().toString(36).substr(2, 9);
            const childrenId = 'children_' + Math.random().toString(36).substr(2, 9);
            
            let html = `<div class="json-tree-item">`;
            html += `<div class="json-tree-toggle json-tree-expanded" onclick="monitor.toggleJsonTreeNode('${toggleId}', '${childrenId}')">`;
            html += `<svg class="json-tree-icon" id="${toggleId}" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            if (key) html += `<span class="json-key key-object">"${escapedKey}"</span><span class="json-punctuation">: </span>`;
            html += `<span class="json-punctuation">{</span> <span style="color: #666; font-size: 11px;">${keys.length} keys</span> <span class="json-punctuation">}</span>`;
            html += `</div>`;
            
            html += `<div class="json-tree-children" id="${childrenId}">`;
            keys.forEach(objKey => {
                html += this.renderJsonTree(data[objKey], depth + 1, objKey);
            });
            html += `</div></div>`;
            
            return html;
        }
        
        return `<div class="json-tree-leaf">${this.escapeHtml(String(data))}</div>`;
    }

    // 切换JSON显示模式
    switchJsonMode(containerId, mode, isRestore = false) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.log(`switchJsonMode: 未找到容器 ${containerId}`);
            return;
        }
        
        const formattedView = container.querySelector('.json-formatted-view');
        const treeView = container.querySelector('.json-tree-view');
        const buttons = container.querySelectorAll('.json-mode-btn');
        
        // 更新按钮状态 - 在恢复过程中临时禁用事件以避免意外触发
        if (isRestore || this.isRestoringSSE) {
            buttons.forEach(btn => {
                const originalOnclick = btn.onclick;
                btn.onclick = null; // 临时禁用点击事件
                btn.classList.remove('active');
                if (btn.getAttribute('data-mode') === mode) {
                    btn.classList.add('active');
                }
                // 延迟恢复事件监听器
                setTimeout(() => {
                    btn.onclick = originalOnclick;
                }, 100);
            });
        } else {
            buttons.forEach(btn => {
                btn.classList.remove('active');
                if (btn.getAttribute('data-mode') === mode) {
                    btn.classList.add('active');
                }
            });
        }
        
        // 切换视图
        if (mode === 'tree') {
            if (formattedView) formattedView.style.display = 'none';
            if (treeView) treeView.style.display = 'block';
        } else {
            if (formattedView) formattedView.style.display = 'block';
            if (treeView) treeView.style.display = 'none';
        }
        
        // 只在用户手动点击时保存全局视图状态，恢复时不保存
        console.log(`switchJsonMode - isRestore: ${isRestore}, isRestoringSSE: ${this.isRestoringSSE}, mode: ${mode}`);
        
        // 如果是恢复操作或者正在恢复SSE视图，都不保存状态
        // 同时检查容器是否在SSE容器内部，避免对SSE子容器保存状态
        const isInSSEContainer = container.closest('.json-container')?.querySelectorAll('.json-mode-btn').length > 2;
        if (!isRestore && !this.isRestoringSSE && !isInSSEContainer) {
            // 通过容器的data-content-type属性确定视图类型
            const contentContainer = container.closest('[data-content-type]');
            let viewType = 'response_body'; // 默认值
            
            if (contentContainer) {
                const contentType = contentContainer.getAttribute('data-content-type');
                viewType = contentType; // 直接使用data-content-type作为viewType
            } else {
                // 兼容旧逻辑，通过容器ID判断
                const isRequestBody = containerId.includes('request') || container.closest('[data-content-type="body"]');
                viewType = isRequestBody ? 'body' : 'response_body';
            }
            
            console.log(`保存视图状态 - 容器: ${containerId}, 类型: ${viewType}, 模式: ${mode}`);
            this.saveGlobalViewState(viewType, mode);
        }
    }

    // 切换JSON树节点展开/折叠
    toggleJsonTreeNode(toggleId, childrenId) {
        const toggle = document.getElementById(toggleId);
        const children = document.getElementById(childrenId);
        const toggleParent = toggle.parentElement;
        
        if (toggleParent.classList.contains('json-tree-collapsed')) {
            // 展开
            children.style.display = 'block';
            toggleParent.classList.remove('json-tree-collapsed');
            toggleParent.classList.add('json-tree-expanded');
        } else {
            // 折叠
            children.style.display = 'none';
            toggleParent.classList.remove('json-tree-expanded');
            toggleParent.classList.add('json-tree-collapsed');
        }
    }

    // 复制到剪贴板
    copyToClipboard(buttonId, contentId) {
        const rawTextarea = document.getElementById(contentId + '_raw');
        const button = document.getElementById(buttonId);
        
        if (rawTextarea) {
            rawTextarea.select();
            document.execCommand('copy');
        } else {
            const content = document.getElementById(contentId);
            const text = content.textContent || content.innerText;
            navigator.clipboard.writeText(text).catch(() => {
                // 兼容性处理
                const textarea = document.createElement('textarea');
                textarea.value = text;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            });
        }
        
        // 保存原始内容
        const originalContent = button.innerHTML;
        const originalTitle = button.title;
        
        // 显示复制成功状态
        button.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        button.title = '已复制';
        button.classList.add('copied');
        
        setTimeout(() => {
            button.innerHTML = originalContent;
            button.title = originalTitle;
            button.classList.remove('copied');
        }, 2000);
    }

    // 复制JSON树状视图中的值
    copyJsonValue(element, value) {
        // 获取要复制的文本
        let textToCopy;
        
        if (value === null) {
            textToCopy = 'null';
        } else if (typeof value === 'string') {
            textToCopy = value; // 复制原始字符串，不包含引号
        } else {
            textToCopy = String(value);
        }
        
        // 复制到剪贴板
        navigator.clipboard.writeText(textToCopy).then(() => {
            this.showValueCopyFeedback(element, true);
        }).catch(() => {
            // 兼容性处理
            const textarea = document.createElement('textarea');
            textarea.value = textToCopy;
            document.body.appendChild(textarea);
            textarea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            this.showValueCopyFeedback(element, success);
        });
    }

    // 从data属性复制JSON值
    copyJsonValueFromData(element) {
        const rawValue = element.getAttribute('data-copy-value');
        
        let actualValue;
        if (rawValue === 'null') {
            actualValue = null;
        } else if (rawValue === 'true') {
            actualValue = true;
        } else if (rawValue === 'false') {
            actualValue = false;
        } else if (rawValue.match(/^-?\d+(\.\d+)?$/)) {
            actualValue = parseFloat(rawValue);
        } else {
            // 字符串类型，只需要解码引号，因为data-copy-value中存储的是原始字符串
            actualValue = rawValue.replace(/&quot;/g, '"');
        }
        
        this.copyJsonValue(element, actualValue);
    }
    
    // 显示值复制反馈
    showValueCopyFeedback(element, success) {
        const originalTitle = element.title;
        
        if (success) {
            element.classList.add('copied');
            element.title = '已复制';
            
            setTimeout(() => {
                element.classList.remove('copied');
                element.title = originalTitle;
            }, 1500);
        } else {
            element.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
            element.title = '复制失败';
            
            setTimeout(() => {
                element.style.backgroundColor = '';
                element.title = originalTitle;
            }, 1500);
        }
    }

    // 复制cURL命令
    async copyCurl(recordId, buttonElement) {
        try {
            const response = await fetch(`/_api/records/${recordId}`);
            const record = await response.json();
            
            const curlCommand = this.generateCurlCommand(record);
            
            try {
                await navigator.clipboard.writeText(curlCommand);
            } catch (err) {
                // 兼容性处理
                const textarea = document.createElement('textarea');
                textarea.value = curlCommand;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            
            // 显示成功提示
            const button = buttonElement || document.querySelector(`[onclick*="copyCurl(${recordId})"]`);
            if (button) {
                const originalText = button.innerHTML;
                const originalStyle = button.style.backgroundColor;
                
                button.innerHTML = '<svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>已复制';
                button.style.backgroundColor = '#16a34a'; // green-600
                
                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.style.backgroundColor = originalStyle || '#22c55e'; // green-500
                }, 2000);
            }
            
        } catch (error) {
            console.error('复制cURL命令失败:', error);
            alert('复制失败，请重试');
        }
    }

    // 生成cURL命令
    generateCurlCommand(record) {
        let curl = `curl -X ${record.method}`;
        
        // 添加URL（使用原始传入URL）
        const url = `http://127.0.0.1:8000${record.path}`;
        curl += ` "${url}"`;
        
        // 添加请求头
        const headers = record.headers || {};
        const importantHeaders = ['authorization', 'content-type', 'user-agent', 'accept', 'x-api-key'];
        
        // 先添加重要的头部
        importantHeaders.forEach(headerName => {
            const headerValue = headers[headerName] || headers[headerName.charAt(0).toUpperCase() + headerName.slice(1)] || 
                              headers[headerName.toLowerCase()] || headers[headerName.toUpperCase()];
            if (headerValue) {
                curl += ` \\\n  -H "${headerName}: ${headerValue}"`;
            }
        });
        
        // 添加其他头部（排除已经添加的和hop-by-hop头部）
        const excludeHeaders = [...importantHeaders, 'host', 'connection', 'content-length', 'accept-encoding'];
        Object.keys(headers).forEach(key => {
            const lowerKey = key.toLowerCase();
            if (!excludeHeaders.includes(lowerKey) && !excludeHeaders.some(h => lowerKey.includes(h))) {
                curl += ` \\\n  -H "${key}: ${headers[key]}"`;
            }
        });
        
        // 添加请求体
        if (record.body && record.body.trim() && ['POST', 'PUT', 'PATCH'].includes(record.method)) {
            // 检查是否是JSON格式
            try {
                JSON.parse(record.body);
                const escapedBody = record.body.replace(/'/g, "'\\''");
                curl += ` \\\n  -d '${escapedBody}'`;
                // 只有在没有Content-Type头部时才添加
                const hasContentType = Object.keys(headers).some(key => key.toLowerCase() === 'content-type');
                if (!hasContentType) {
                    curl += ' \\\n  -H "Content-Type: application/json"';
                }
            } catch {
                // 如果不是JSON，直接添加
                const escapedBody = record.body.replace(/'/g, "'\\''");
                curl += ` \\\n  -d '${escapedBody}'`;
            }
        }
        
        // 添加常用选项
        curl += ' \\\n  --compressed \\\n  --location \\\n  --max-time 30';
        
        return curl;
    }

    // 显示全屏查看
    showFullscreen(title, containerId) {
        const containerElement = document.getElementById(containerId);
        if (!containerElement) return;
        
        // 克隆整个容器（包括头部操作按钮）
        const clonedContainer = containerElement.cloneNode(true);
        
        // 生成全屏专用的ID
        const fullscreenContainerId = containerId + '_fullscreen_' + Date.now();
        clonedContainer.id = fullscreenContainerId;
        
        // 为克隆的容器添加特殊类标记
        clonedContainer.classList.add('fullscreen-clone');
        clonedContainer.setAttribute('data-original-id', containerId);
        
        // 提取按钮到全屏标题栏
        this.moveButtonsToFullscreenHeader(clonedContainer, fullscreenContainerId);
        
        // 简化全屏界面：移除json-header
        this.simplifyFullscreenInterface(clonedContainer);
        
        // 更新所有子元素ID，避免冲突
        this.updateElementIds(clonedContainer, fullscreenContainerId);
        
        // 重新绑定所有按钮的事件
        this.rebindEvents(clonedContainer, fullscreenContainerId);
        
        // 设置标题和内容
        this.fullscreenTitle.textContent = title;
        this.fullscreenBody.innerHTML = '';
        this.fullscreenBody.appendChild(clonedContainer);
        
        // 显示模态框
        this.fullscreenModal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        
        // 聚焦关闭按钮（便于键盘操作）
        this.fullscreenClose.focus();
    }
    
    // 将按钮移动到全屏标题栏
    moveButtonsToFullscreenHeader(container, containerId) {
        const header = container.querySelector('.json-header');
        const fullscreenButtonsContainer = document.getElementById('fullscreen-buttons');
        
        if (header && fullscreenButtonsContainer) {
            // 清空之前的按钮
            fullscreenButtonsContainer.innerHTML = '';
            
            // 提取所有按钮（除了全屏按钮）
            const buttonsContainer = header.querySelector('.flex.items-center');
            if (buttonsContainer) {
                // 克隆按钮容器
                const clonedButtons = buttonsContainer.cloneNode(true);
                
                // 移除全屏按钮
                const fullscreenBtn = clonedButtons.querySelector('button[title="全屏查看"]');
                if (fullscreenBtn) {
                    fullscreenBtn.remove();
                }
                
                // 更新按钮ID以避免冲突
                const buttons = clonedButtons.querySelectorAll('button, [id]');
                buttons.forEach(btn => {
                    if (btn.id) {
                        btn.id = btn.id.replace(/container_[^_]+/, containerId);
                    }
                });
                
                // 添加到全屏标题栏
                fullscreenButtonsContainer.appendChild(clonedButtons);
            }
        }
    }
    
    // 简化全屏界面
    simplifyFullscreenInterface(container) {
        // 完全移除json-header
        const header = container.querySelector('.json-header');
        if (header) {
            header.remove();
        }
    }
    
    // 更新元素ID避免冲突
    updateElementIds(container, baseId) {
        // 更新内容区域ID
        const contentElement = container.querySelector('.json-content');
        if (contentElement) {
            contentElement.id = baseId + '_content';
        }
        
        // 更新所有带ID的子元素
        const elementsWithId = container.querySelectorAll('[id]');
        elementsWithId.forEach((element, index) => {
            if (element.id && element.id !== container.id) {
                element.id = baseId + '_' + element.id.split('_').pop() + '_' + index;
            }
        });
    }
    
    // 重新绑定克隆容器中的事件
    rebindEvents(clonedContainer, clonedContainerId) {
        // 绑定模式切换按钮（包括全屏标题栏中的按钮）
        const fullscreenButtonsContainer = document.getElementById('fullscreen-buttons');
        const allModeButtons = [
            ...clonedContainer.querySelectorAll('.json-mode-btn'),
            ...(fullscreenButtonsContainer ? fullscreenButtonsContainer.querySelectorAll('.json-mode-btn') : [])
        ];
        allModeButtons.forEach(btn => {
            const mode = btn.getAttribute('data-mode');
            const onclickStr = btn.getAttribute('onclick');
            
            // 清除原有事件并重新绑定
            btn.onclick = null;
            btn.removeAttribute('onclick');
            
            if (onclickStr && onclickStr.includes('switchSSEMode')) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.switchSSEMode(clonedContainerId, mode);
                });
            } else if (onclickStr && onclickStr.includes('switchJsonMode')) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.switchJsonMode(clonedContainerId, mode, false);
                });
            } else if (onclickStr && onclickStr.includes('switchResponseMode')) {
                // 提取containerId参数
                const match = onclickStr.match(/switchResponseMode\('([^']+)'/);
                const responseContainerId = match ? match[1] : null;
                if (responseContainerId) {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.switchResponseMode(responseContainerId, mode);
                    });
                }
            }
        });
        
        // 绑定树状展开/收起按钮
        const toggleButtons = clonedContainer.querySelectorAll('.json-tree-toggle');
        toggleButtons.forEach(toggle => {
            const svg = toggle.querySelector('svg');
            const childrenDiv = toggle.parentElement.querySelector('.json-tree-children');
            if (svg && childrenDiv) {
                toggle.onclick = null;
                toggle.removeAttribute('onclick');
                toggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleJsonTreeNode(svg.id, childrenDiv.id);
                });
            }
        });
        
        // 绑定复制按钮（包括全屏标题栏中的按钮）
        const allCopyButtons = [
            ...clonedContainer.querySelectorAll('.copy-btn[id]'),
            ...(fullscreenButtonsContainer ? fullscreenButtonsContainer.querySelectorAll('.copy-btn[id]') : [])
        ];
        allCopyButtons.forEach(btn => {
            const onclickStr = btn.getAttribute('onclick');
            if (btn.id && onclickStr && onclickStr.includes('copyToClipboard')) {
                const contentId = clonedContainer.querySelector('.json-content').id;
                btn.onclick = null;
                btn.removeAttribute('onclick');
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.copyToClipboard(btn.id, contentId);
                });
            }
        });
        
        // 绑定JSON树状值的点击复制功能
        const jsonTreeValues = clonedContainer.querySelectorAll('.json-tree-value');
        jsonTreeValues.forEach(valueElement => {
            const onclickStr = valueElement.getAttribute('onclick');
            if (onclickStr && onclickStr.includes('copyJsonValueFromData')) {
                // 清除原有事件并重新绑定
                valueElement.onclick = null;
                valueElement.removeAttribute('onclick');
                
                valueElement.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.copyJsonValueFromData(valueElement);
                });
            }
        });
    }

    // 隐藏全屏查看
    hideFullscreen() {
        this.fullscreenModal.style.display = 'none';
        document.body.style.overflow = '';
        
        // 清空全屏标题栏的按钮
        const fullscreenButtonsContainer = document.getElementById('fullscreen-buttons');
        if (fullscreenButtonsContainer) {
            fullscreenButtonsContainer.innerHTML = '';
        }
    }
    
    // ==================== 系统设置相关方法 ====================
    
    // 初始化系统设置
    initializeSystemSettings() {
        this.updateDebugStatusDisplay();
        this.loadDebugModeFromStorage();
        this.loadPerformanceMonitorFromStorage();
    }
    
    // 切换DEBUG模式
    toggleDebugMode(enabled) {
        localStorage.setItem('DEBUG_MODE', enabled ? 'true' : 'false');
        this.updateDebugStatusDisplay();
        
        if (enabled) {
            console.log('🐛 DEBUG模式已启用');
            this.showNotification('DEBUG模式已启用，将显示详细调试信息', 'info');
        } else {
            console.log('📊 DEBUG模式已禁用');
            this.showNotification('DEBUG模式已禁用，调试信息将被隐藏', 'info');
        }
        
        // 重新定义全局DEBUG控制变量
        window.DEBUG_MODE = enabled;
    }
    
    // 切换性能监控
    togglePerformanceMonitor(enabled) {
        localStorage.setItem('PERFORMANCE_MONITOR', enabled ? 'true' : 'false');
        this.showNotification(enabled ? '性能监控已启用' : '性能监控已禁用', 'info');
    }
    
    // 从存储加载DEBUG模式状态
    loadDebugModeFromStorage() {
        const debugModeToggle = document.getElementById('debug-mode-toggle');
        const isDebugMode = localStorage.getItem('DEBUG_MODE') === 'true' || 
                           new URLSearchParams(window.location.search).get('debug') === 'true';
        
        if (debugModeToggle) {
            debugModeToggle.checked = isDebugMode;
        }
        
        // 更新全局DEBUG控制变量
        window.DEBUG_MODE = isDebugMode;
    }
    
    // 从存储加载性能监控状态
    loadPerformanceMonitorFromStorage() {
        const performanceToggle = document.getElementById('performance-monitor-toggle');
        const isPerformanceMonitor = localStorage.getItem('PERFORMANCE_MONITOR') !== 'false'; // 默认启用
        
        if (performanceToggle) {
            performanceToggle.checked = isPerformanceMonitor;
        }
    }
    
    // 更新DEBUG状态显示
    updateDebugStatusDisplay() {
        const frontendStatus = document.getElementById('frontend-debug-status');
        const backendStatus = document.getElementById('backend-debug-status');
        
        const isDebugMode = localStorage.getItem('DEBUG_MODE') === 'true' || 
                           new URLSearchParams(window.location.search).get('debug') === 'true';
        
        if (frontendStatus) {
            frontendStatus.textContent = isDebugMode ? '启用' : '关闭';
            frontendStatus.className = isDebugMode ? 
                'font-medium text-green-900' : 'font-medium text-blue-900';
        }
        
        if (backendStatus) {
            // 后端DEBUG状态需要从服务器获取
            this.checkBackendDebugStatus().then(status => {
                backendStatus.textContent = status ? '启用' : '关闭';
                backendStatus.className = status ? 
                    'font-medium text-green-900' : 'font-medium text-blue-900';
            });
        }
    }
    
    // 检查后端DEBUG状态
    async checkBackendDebugStatus() {
        try {
            const response = await fetch('/control/debug-status');
            if (response.ok) {
                const data = await response.json();
                return data.debug_mode === true;
            }
        } catch (error) {
            debugLog('检查后端DEBUG状态失败:', error);
        }
        return false;
    }
    
    // ==================== 系统状态相关方法 ====================
    
    // 初始化系统状态面板
    initializeSystemStatus() {
        debugLog('初始化系统状态面板');
        // 初始显示提示信息，但不自动刷新
        const statusContent = document.getElementById('system-status-content');
        const loadingDiv = document.getElementById('system-status-loading');
        
        if (statusContent && loadingDiv) {
            statusContent.style.display = 'block';
            loadingDiv.style.display = 'none';
        }
    }
    
    // 手动刷新系统状态
    async refreshSystemStatus() {
        debugLog('手动刷新系统状态');
        
        const loadingDiv = document.getElementById('system-status-loading');
        const contentDiv = document.getElementById('system-status-content');
        const refreshBtn = document.getElementById('refresh-system-status');
        
        // 显示加载状态
        if (loadingDiv && contentDiv && refreshBtn) {
            loadingDiv.style.display = 'block';
            contentDiv.style.display = 'none';
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = `
                <svg class="w-4 h-4 mr-1 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                刷新中...
            `;
        }
        
        try {
            // 获取系统状态数据
            const response = await fetch('/about');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const aboutText = await response.text();
            this.parseAndDisplaySystemStatus(aboutText);
            
            // 更新最后刷新时间
            this.updateLastRefreshTime();
            
            this.showNotification('系统状态已刷新', 'success');
            
        } catch (error) {
            console.error('获取系统状态失败:', error);
            this.showNotification('获取系统状态失败: ' + error.message, 'error');
            
            // 显示错误信息
            this.displaySystemStatusError(error.message);
        } finally {
            // 恢复按钮状态
            if (loadingDiv && contentDiv && refreshBtn) {
                loadingDiv.style.display = 'none';
                contentDiv.style.display = 'block';
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = `
                    <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                    </svg>
                    手动刷新
                `;
            }
        }
    }
    
    // 解析并显示系统状态
    parseAndDisplaySystemStatus(aboutText) {
        const lines = aboutText.split('\n');
        const statusData = {};
        
        // 解析系统信息
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // 基础状态
            if (line.includes('工作模式:')) {
                statusData.workMode = this.extractValue(line);
            } else if (line.includes('多平台转发:')) {
                statusData.multiPlatform = this.extractValue(line);
            } else if (line.includes('WebSocket连接:')) {
                statusData.websocket = this.extractValue(line);
            } else if (line.includes('系统运行时间:')) {
                statusData.uptime = this.extractValue(line);
            }
            
            // 系统资源
            else if (line.includes('CPU使用率:')) {
                statusData.cpu = this.extractValue(line);
            } else if (line.includes('内存使用:')) {
                statusData.memory = this.extractValue(line);
            } else if (line.includes('进程ID:')) {
                statusData.pid = this.extractValue(line);
            } else if (line.includes('Python版本:')) {
                statusData.python = this.extractValue(line);
            } else if (line.includes('线程数:')) {
                statusData.threads = this.extractValue(line);
            } else if (line.includes('打开文件数:')) {
                statusData.files = this.extractValue(line);
            }
            
            // 网络信息
            else if (line.includes('主机名:')) {
                statusData.hostname = this.extractValue(line);
            } else if (line.includes('本地IP:')) {
                statusData.localIp = this.extractValue(line);
            } else if (line.includes('工作目录:')) {
                statusData.workdir = this.extractValue(line);
            }
            
            // 数据库状态
            else if (line.includes('连接状态:')) {
                statusData.dbConnection = this.extractValue(line);
            } else if (line.includes('API记录数:')) {
                statusData.apiRecords = this.extractValue(line);
            } else if (line.includes('平台配置数:')) {
                statusData.platformConfigs = this.extractValue(line);
            } else if (line.includes('模型配置数:')) {
                statusData.modelConfigs = this.extractValue(line);
            }
            
            // API统计
            else if (line.includes('总调用次数:')) {
                statusData.totalCalls = this.extractValue(line);
            } else if (line.includes('成功调用:')) {
                statusData.successCalls = this.extractValue(line);
            } else if (line.includes('错误调用:')) {
                statusData.errorCalls = this.extractValue(line);
            } else if (line.includes('成功率:')) {
                statusData.successRate = this.extractValue(line);
            }
        }
        
        // 更新UI显示
        this.updateSystemStatusDisplay(statusData);
    }
    
    // 提取值辅助函数
    extractValue(line) {
        const parts = line.split(':');
        if (parts.length >= 2) {
            return parts.slice(1).join(':').trim();
        }
        return 'N/A';
    }
    
    // 更新系统状态显示
    updateSystemStatusDisplay(statusData) {
        // 基础状态 - 将英文工作模式转换为中文显示
        const modeNames = {
            'claude_code': 'Claude Code模式',
            'global_direct': '多平台转发模式',
            'smart_routing': '小模型路由模式'
        };
        const workModeDisplay = modeNames[statusData.workMode] || statusData.workMode || '--';
        this.updateElementText('status-work-mode', workModeDisplay);
        this.updateElementText('status-multi-platform', statusData.multiPlatform || '--');
        this.updateElementText('status-websocket', statusData.websocket || '--');
        this.updateElementText('status-uptime', statusData.uptime || '--');
        
        // 系统资源
        this.updateElementText('status-cpu', statusData.cpu || '--');
        this.updateElementText('status-memory', statusData.memory || '--');
        this.updateElementText('status-pid', statusData.pid || '--');
        this.updateElementText('status-python', statusData.python || '--');
        this.updateElementText('status-threads', statusData.threads || '--');
        this.updateElementText('status-files', statusData.files || '--');
        
        // 网络信息
        this.updateElementText('status-hostname', statusData.hostname || '--');
        this.updateElementText('status-local-ip', statusData.localIp || '--');
        this.updateElementText('status-workdir', this.truncateString(statusData.workdir || '--', 30));
        
        // 数据库状态
        this.updateElementText('status-db-connection', statusData.dbConnection || '--');
        this.updateElementText('status-api-records', statusData.apiRecords || '--');
        this.updateElementText('status-platform-configs', statusData.platformConfigs || '--');
        this.updateElementText('status-model-configs', statusData.modelConfigs || '--');
        
        // API统计
        this.updateElementText('status-total-calls', statusData.totalCalls || '--');
        this.updateElementText('status-success-calls', statusData.successCalls || '--');
        this.updateElementText('status-error-calls', statusData.errorCalls || '--');
        this.updateElementText('status-success-rate', statusData.successRate || '--');
        
        debugLog('系统状态显示已更新', statusData);
    }
    
    // 更新元素文本内容辅助函数
    updateElementText(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text;
            
            // 为工作目录添加完整路径的title属性
            if (elementId === 'status-workdir' && text !== '--') {
                element.title = text;
            }
        }
    }
    
    // 截断字符串辅助函数
    truncateString(str, maxLength) {
        if (str.length <= maxLength) return str;
        return str.substring(0, maxLength) + '...';
    }
    
    // 更新最后刷新时间
    updateLastRefreshTime() {
        const now = new Date();
        const timeString = now.toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai'
        });
        this.updateElementText('status-last-update', timeString);
    }
    
    // 显示系统状态错误
    displaySystemStatusError(errorMessage) {
        const statusElements = [
            'status-work-mode', 'status-multi-platform', 'status-websocket', 'status-uptime',
            'status-cpu', 'status-memory', 'status-pid', 'status-python', 'status-threads', 'status-files',
            'status-hostname', 'status-local-ip', 'status-workdir',
            'status-db-connection', 'status-api-records', 'status-platform-configs', 'status-model-configs',
            'status-total-calls', 'status-success-calls', 'status-error-calls', 'status-success-rate'
        ];
        
        statusElements.forEach(elementId => {
            this.updateElementText(elementId, '获取失败');
        });
        
        this.updateElementText('status-last-update', '获取失败: ' + errorMessage);
    }
    
    // 显示通知
    showNotification(message, type = 'info') {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 transition-all duration-300 transform translate-x-full`;
        
        const bgColor = type === 'error' ? 'bg-red-500' : 
                       type === 'success' ? 'bg-green-500' : 'bg-blue-500';
        notification.className += ` ${bgColor} text-white`;
        
        notification.innerHTML = `
            <div class="flex items-center">
                <span class="mr-2">${type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️'}</span>
                <span>${message}</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // 显示动画
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);
        
        // 自动隐藏
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // 获取当前配置
    getCurrentConfig() {
        return {
            local_path: this.localPathInput?.value || 'api/v1/claude-code',
            target_url: this.targetUrlInput?.value || ''
        };
    }

    // ==================== Claude Code 服务器管理方法 ====================
    
    async loadClaudeServers() {
        try {
            const response = await fetch('/_api/claude-code-servers');
            if (response.ok) {
                const servers = await response.json();
                console.log('✅ [Frontend] Claude Code服务器列表加载成功:', servers);
                this.renderClaudeServers(servers);
            } else {
                console.error('❌ [Frontend] Claude Code服务器列表加载失败:', response.statusText);
            }
        } catch (error) {
            console.error('❌ [Frontend] Claude Code服务器列表加载出错:', error);
        }
    }
    
    renderClaudeServers(servers) {
        if (!this.claudeServersList || !this.claudeServersEmpty) return;
        
        // 清空现有列表
        this.claudeServersList.innerHTML = '';
        
        if (servers.length === 0) {
            // 显示空状态
            this.claudeServersList.appendChild(this.claudeServersEmpty);
            return;
        }
        
        // 渲染服务器卡片
        servers.forEach((server, index) => {
            const serverCard = this.createServerCard(server, index);
            this.claudeServersList.appendChild(serverCard);
        });
        
        // 初始化拖拽排序
        this.initServerDragSort();
    }
    
    createServerCard(server, index) {
        const card = document.createElement('div');
        card.className = 'bg-white border border-gray-200 rounded-lg p-4 cursor-move';
        card.dataset.serverId = server.id;
        card.dataset.priority = server.priority;
        
        const statusColor = server.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600';
        const statusText = server.enabled ? '启用' : '禁用';
        
        card.innerHTML = `
            <div class="flex items-start justify-between">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center mb-2">
                        <div class="w-2 h-2 bg-blue-500 rounded-full mr-2"></div>
                        <h4 class="text-sm font-medium text-gray-900 truncate">${this.escapeHtml(server.name)}</h4>
                        <div class="ml-2 px-2 py-1 text-xs rounded-full ${statusColor}">
                            ${statusText}
                        </div>
                        <div class="ml-2 px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                            #${index + 1}
                        </div>
                    </div>
                    <div class="text-xs text-gray-500 mb-1">
                        <span class="font-mono">${this.escapeHtml(server.url)}</span>
                    </div>
                    <div class="text-xs text-gray-400 space-x-4">
                        <span>超时: ${server.timeout}秒</span>
                        ${server.api_key ? '<span>🔑 已配置API Key</span>' : '<span>🔓 无API Key</span>'}
                    </div>
                </div>
                <div class="flex items-center space-x-2 ml-4">
                    <button type="button" class="edit-server-btn text-xs text-blue-600 hover:text-blue-800 p-1" 
                            data-server-id="${server.id}" title="编辑">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    <button type="button" class="delete-server-btn text-xs text-red-600 hover:text-red-800 p-1" 
                            data-server-id="${server.id}" title="删除">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                    <div class="drag-handle cursor-move p-1" title="拖拽排序">
                        <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"></path>
                        </svg>
                    </div>
                </div>
            </div>
        `;
        
        // 绑定编辑和删除事件
        const editBtn = card.querySelector('.edit-server-btn');
        const deleteBtn = card.querySelector('.delete-server-btn');
        
        editBtn.addEventListener('click', () => this.showEditClaudeServerModal(server));
        deleteBtn.addEventListener('click', () => this.deleteClaudeServer(server.id, server.name));
        
        return card;
    }
    
    initServerDragSort() {
        // 简单的拖拽排序实现
        let draggedElement = null;
        
        const serverCards = this.claudeServersList.querySelectorAll('[data-server-id]');
        
        serverCards.forEach(card => {
            card.draggable = true;
            
            card.addEventListener('dragstart', (e) => {
                draggedElement = card;
                card.style.opacity = '0.5';
            });
            
            card.addEventListener('dragend', (e) => {
                card.style.opacity = '';
                draggedElement = null;
            });
            
            card.addEventListener('dragover', (e) => {
                e.preventDefault();
            });
            
            card.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedElement && draggedElement !== card) {
                    const draggedAfter = this.shouldInsertAfter(card, e.clientY);
                    if (draggedAfter) {
                        card.parentNode.insertBefore(draggedElement, card.nextSibling);
                    } else {
                        card.parentNode.insertBefore(draggedElement, card);
                    }
                    
                    // 更新服务器排序
                    this.updateServerOrder();
                }
            });
        });
    }
    
    shouldInsertAfter(element, y) {
        const rect = element.getBoundingClientRect();
        return y > rect.top + rect.height / 2;
    }
    
    async updateServerOrder() {
        try {
            const serverCards = this.claudeServersList.querySelectorAll('[data-server-id]');
            const serverOrders = Array.from(serverCards).map((card, index) => ({
                id: parseInt(card.dataset.serverId),
                priority: index
            }));
            
            const response = await fetch('/_api/claude-code-servers/reorder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ server_orders: serverOrders })
            });
            
            if (response.ok) {
                console.log('✅ [Frontend] 服务器排序更新成功');
                // 重新加载列表以更新显示
                await this.loadClaudeServers();
            } else {
                console.error('❌ [Frontend] 服务器排序更新失败');
            }
        } catch (error) {
            console.error('❌ [Frontend] 服务器排序更新出错:', error);
        }
    }
    
    showAddClaudeServerModal() {
        this.currentEditingServerId = null;
        this.claudeServerModalTitle.textContent = '添加服务器';
        this.resetClaudeServerForm();
        this.showClaudeServerModal();
    }
    
    showEditClaudeServerModal(server) {
        this.currentEditingServerId = server.id;
        this.claudeServerModalTitle.textContent = '编辑服务器';
        this.fillClaudeServerForm(server);
        this.showClaudeServerModal();
    }
    
    showClaudeServerModal() {
        if (this.claudeServerModal) {
            this.claudeServerModal.classList.remove('hidden');
            // 聚焦第一个输入框
            if (this.claudeServerNameInput) {
                setTimeout(() => this.claudeServerNameInput.focus(), 100);
            }
        }
    }
    
    hideClaudeServerModal() {
        if (this.claudeServerModal) {
            this.claudeServerModal.classList.add('hidden');
            this.resetClaudeServerForm();
            this.currentEditingServerId = null;
        }
    }
    
    resetClaudeServerForm() {
        if (this.claudeServerForm) {
            this.claudeServerForm.reset();
            this.claudeServerTimeoutInput.value = 600;
            this.claudeServerEnabledInput.checked = true;
        }
    }
    
    fillClaudeServerForm(server) {
        if (this.claudeServerNameInput) this.claudeServerNameInput.value = server.name;
        if (this.claudeServerUrlInput) this.claudeServerUrlInput.value = server.url;
        if (this.claudeServerApiKeyInput) this.claudeServerApiKeyInput.value = server.api_key || '';
        if (this.claudeServerTimeoutInput) this.claudeServerTimeoutInput.value = server.timeout;
        if (this.claudeServerEnabledInput) this.claudeServerEnabledInput.checked = server.enabled;
    }
    
    async saveClaudeServer(e) {
        e.preventDefault();
        
        const formData = {
            name: this.claudeServerNameInput.value.trim(),
            url: this.claudeServerUrlInput.value.trim(),
            api_key: this.claudeServerApiKeyInput.value.trim(),
            timeout: parseInt(this.claudeServerTimeoutInput.value),
            enabled: this.claudeServerEnabledInput.checked
        };
        
        // 基本验证
        if (!formData.name) {
            alert('请输入服务器名称');
            return;
        }
        if (!formData.url) {
            alert('请输入服务器地址');
            return;
        }
        
        try {
            let response;
            if (this.currentEditingServerId) {
                // 编辑模式
                response = await fetch(`/_api/claude-code-servers/${this.currentEditingServerId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            } else {
                // 添加模式
                response = await fetch('/_api/claude-code-servers', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
            }
            
            if (response.ok) {
                console.log('✅ [Frontend] 服务器保存成功');
                this.hideClaudeServerModal();
                await this.loadClaudeServers();
            } else {
                const error = await response.json();
                alert(`保存失败: ${error.error || response.statusText}`);
            }
        } catch (error) {
            console.error('❌ [Frontend] 服务器保存出错:', error);
            alert('保存失败，请重试');
        }
    }
    
    async deleteClaudeServer(serverId, serverName) {
        if (!confirm(`确定要删除服务器"${serverName}"吗？此操作不可撤销。`)) {
            return;
        }
        
        try {
            const response = await fetch(`/_api/claude-code-servers/${serverId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                console.log('✅ [Frontend] 服务器删除成功');
                await this.loadClaudeServers();
            } else {
                const error = await response.json();
                alert(`删除失败: ${error.error || response.statusText}`);
            }
        } catch (error) {
            console.error('❌ [Frontend] 服务器删除出错:', error);
            alert('删除失败，请重试');
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 页面加载完成后初始化监控系统
document.addEventListener('DOMContentLoaded', function() {
    // 确保全局可访问
    window.monitor = new APIHookMonitor();
    
    // 初始化KEY管理功能
    window.keyManager = new KeyManager();
});

// ==================== KEY 管理类 ====================

class KeyManager {
    constructor() {
        this.currentEditingKey = null;
        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        // KEY 管理按钮
        const keyManagementBtn = document.getElementById('key-management-btn');
        if (keyManagementBtn) {
            keyManagementBtn.addEventListener('click', () => this.openKeyManagement());
        }

        // 关闭按钮
        const closeButtons = ['key-management-close', 'key-management-cancel'];
        closeButtons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', () => this.closeKeyManagement());
            }
        });

        // KEY 详细统计弹窗关闭按钮
        const detailCloseButtons = ['key-detail-close', 'key-detail-cancel'];
        detailCloseButtons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', () => this.closeKeyDetail());
            }
        });

        // 标签页切换
        document.getElementById('key-tab-management')?.addEventListener('click', () => this.switchTab('management'));
        document.getElementById('key-tab-statistics')?.addEventListener('click', () => this.switchTab('statistics'));

        // 添加 KEY 按钮
        document.getElementById('add-key-btn')?.addEventListener('click', () => this.openKeyForm());

        // KEY 表单相关
        document.getElementById('key-form-cancel')?.addEventListener('click', () => this.closeKeyForm());
        document.getElementById('key-form-save')?.addEventListener('click', () => this.saveKey());
        // 延迟绑定事件，确保在弹窗打开时绑定
        this.bindExpiresPresetEvent();


        // 统计相关
        document.getElementById('stats-time-range')?.addEventListener('change', (e) => this.handleTimeRangeChange(e));
        document.getElementById('refresh-stats-btn')?.addEventListener('click', () => this.refreshStatistics());

        // 点击模态框外部关闭
        document.getElementById('key-management-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'key-management-modal') {
                this.closeKeyManagement();
            }
        });

        // 点击详细统计弹窗外部关闭
        document.getElementById('key-detail-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'key-detail-modal') {
                this.closeKeyDetail();
            }
        });

        document.getElementById('key-form-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'key-form-modal') {
                this.closeKeyForm();
            }
        });
    }

    async openKeyManagement() {
        const modal = document.getElementById('key-management-modal');
        if (modal) {
            modal.classList.remove('hidden');
            await this.loadKeys();
            await this.loadStatistics();
        }
    }

    closeKeyManagement() {
        const modal = document.getElementById('key-management-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    closeKeyDetail() {
        const modal = document.getElementById('key-detail-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    switchTab(tab) {
        // 更新标签页样式
        document.querySelectorAll('.key-tab').forEach(t => {
            t.classList.remove('active', 'border-purple-500', 'text-purple-600');
            t.classList.add('border-transparent', 'text-gray-500');
        });

        const activeTab = document.getElementById(`key-tab-${tab}`);
        if (activeTab) {
            activeTab.classList.add('active', 'border-purple-500', 'text-purple-600');
            activeTab.classList.remove('border-transparent', 'text-gray-500');
        }

        // 显示对应面板
        document.querySelectorAll('.key-panel').forEach(p => p.classList.add('hidden'));
        const activePanel = document.getElementById(`key-panel-${tab}`);
        if (activePanel) {
            activePanel.classList.remove('hidden');
        }

        // 如果切换到统计面板，刷新数据
        if (tab === 'statistics') {
            this.refreshStatistics();
        }
    }

    bindExpiresPresetEvent() {
        // 使用定时器确保DOM元素已存在
        setTimeout(() => {
            const expiresPresetSelect = document.getElementById('key-expires-preset');
            if (expiresPresetSelect) {
                expiresPresetSelect.addEventListener('change', (e) => this.handleExpiresPresetChange(e));
            }
        }, 100);
    }

    handleExpiresPresetChange(e) {
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
    }

    showMessage(message, type = 'info') {
        // 创建消息提示
        const messageDiv = document.createElement('div');
        messageDiv.className = `fixed top-4 right-4 z-50 px-4 py-2 rounded-md text-white text-sm max-w-sm ${
            type === 'success' ? 'bg-green-500' :
            type === 'error' ? 'bg-red-500' :
            type === 'warning' ? 'bg-yellow-500' :
            'bg-blue-500'
        }`;
        messageDiv.textContent = message;
        
        document.body.appendChild(messageDiv);
        
        // 自动移除
        setTimeout(() => {
            if (messageDiv.parentNode) {
                messageDiv.parentNode.removeChild(messageDiv);
            }
        }, 3000);
    }

    // 复制环境变量命令
    async copyEnvCommands() {
        const baseUrl = this.getBaseUrl();
        
        try {
            const commands = [
                'cd 对应目录',
                `export ANTHROPIC_BASE_URL=${baseUrl}`,
                'export ANTHROPIC_AUTH_TOKEN=your_key_here',
                'claude'
            ].join('\n');
            
            // 复制到剪贴板
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(commands);
                this.showMessage('命令已复制到剪贴板', 'success');
            } else {
                // 兼容性回退方案
                const textarea = document.createElement('textarea');
                textarea.value = commands;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                this.showMessage('命令已复制到剪贴板', 'success');
            }
            
            console.log('✅ [Frontend] 环境变量命令已复制:', commands);
        } catch (error) {
            console.error('❌ [Frontend] 复制失败:', error);
            this.showMessage('复制失败，请手动复制', 'error');
        }
    }

    // 获取基础URL
    getBaseUrl() {
        const config = this.getCurrentConfig();
        const localPath = config?.local_path || 'api/v1/claude-code';
        return `http://127.0.0.1:8000/${localPath}`;
    }

    // 获取当前配置
    getCurrentConfig() {
        return {
            local_path: window.monitor?.localPathInput?.value || 'api/v1/claude-code',
            target_url: window.monitor?.targetUrlInput?.value || ''
        };
    }
}
