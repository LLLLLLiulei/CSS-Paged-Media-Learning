/**
 * QR Sidebar Plugin (预处理版)
 *
 * 适用场景：HTML 文档已在外部完成预处理，媒体元素已替换为 QR 码结构
 *
 * 核心功能：
 * 1. 支持 CSS Running Elements 模式（累积容器）的优化显示
 * 2. 支持直接侧边栏注入模式（非 CSS running）
 * 3. 响应 CoreViewer 的 loaded/nav 事件进行动态更新
 *
 * 预期的 HTML 结构（外部预处理生成）：
 * - 媒体引用标记：<sup class="qr-ref-mark" data-qr-id="xxx">[1]</sup>
 * - QR 码容器：<div class="side-note-resource" data-qr-id="xxx">...</div>
 *
 * 两种工作模式：
 * A) CSS Running Mode：使用 position:running() 和 element()，插件优化显示
 * B) Direct Inject Mode：插件直接将 QR 码注入页面侧边栏
 */
(function() {
  'use strict';

  // ==================== 配置 ====================
  const CONFIG = {
    // 工作模式：'css-running' | 'direct-inject'
    mode: 'auto', // auto = 自动检测

    sidebar: {
      width: '2.5cm',
      position: 'right',
      paddingTop: '20px',
      backgroundColor: 'transparent'
    },

    // 选择器配置
    selectors: {
      // QR 容器选择器（外部预处理生成的）
      qrContainer: '.side-note-resource, .qr-container, [data-qr-container]',
      // 引用标记选择器
      refMark: '.qr-ref-mark, [data-qr-ref]',
      // 页面容器选择器
      pageContainer: '[data-vivliostyle-page-container], .pagedjs_page, [class*="page-container"]'
    },

    colors: {
      video: '#1976d2',
      audio: '#ff9800'
    },

    debug: false
  };

  // 存储检测到的 QR 信息
  const qrRegistry = new Map(); // qrId → { element, type, pageIndex }

  function log(...args) {
    if (CONFIG.debug) {
      console.log('[QR Plugin Preprocessed]', ...args);
    }
  }

  // ==================== 初始化 ====================
  function init(viewer, options = {}) {
    Object.assign(CONFIG, options);
    log('插件初始化（预处理版）');

    // 绑定 CoreViewer 事件
    attachCoreViewerListeners(viewer);

    return {
      getConfig: () => ({ ...CONFIG }),
      setConfig: (newConfig) => Object.assign(CONFIG, newConfig),
      getQRRegistry: () => new Map(qrRegistry),
      reprocess: processPages,
      enableDebug: () => { CONFIG.debug = true; },
      disableDebug: () => { CONFIG.debug = false; }
    };
  }

  // ==================== CoreViewer 事件绑定 ====================
  function attachCoreViewerListeners(viewer) {
    const coreViewer =
      viewer ||
      (typeof window !== 'undefined' && (window.coreViewer || window.top?.coreViewer));

    if (!coreViewer || !coreViewer.addListener) {
      log('未获取到 coreViewer，使用回退机制');
      // 回退：直接处理
      setTimeout(processPages, 500);
      return false;
    }

    if (coreViewer.__qrPreprocessedBound) {
      log('coreViewer 事件已绑定，跳过重复绑定');
      return true;
    }

    const rebuild = (reason) => {
      log(`coreViewer 事件触发: ${reason}`);
      setTimeout(processPages, 0);
    };

    coreViewer.addListener('loaded', () => rebuild('loaded'));
    coreViewer.addListener('nav', () => rebuild('nav'));
    coreViewer.__qrPreprocessedBound = true;
    log('已绑定 coreViewer loaded/nav 事件');
    return true;
  }

  // ==================== 主处理逻辑 ====================
  function processPages() {
    log('开始处理页面...');

    // 检测工作模式
    const detectedMode = detectMode();
    const mode = CONFIG.mode === 'auto' ? detectedMode : CONFIG.mode;
    log(`工作模式: ${mode}`);

    if (mode === 'css-running') {
      processCSSRunningMode();
    } else {
      processDirectInjectMode();
    }
  }

  // 检测应使用哪种模式
  function detectMode() {
    // 检查是否存在使用 position: running 的元素
    const runningElements = document.querySelectorAll(CONFIG.selectors.qrContainer);
    for (const el of runningElements) {
      const style = getComputedStyle(el);
      if (style.position === 'running' || el.style.position?.includes('running')) {
        return 'css-running';
      }
    }
    return 'direct-inject';
  }

  // ==================== CSS Running 模式 ====================
  // 在这种模式下，QR 码已经通过 CSS running elements 显示在 margin box 中
  // 插件的作用是优化显示（如处理累积容器）
  function processCSSRunningMode() {
    log('CSS Running 模式处理...');

    const viewport = document.querySelector('[data-vivliostyle-viewer-viewport]');
    const root = viewport || document;

    const pageContainers = root.querySelectorAll(CONFIG.selectors.pageContainer);
    if (pageContainers.length === 0) {
      log('未找到页面容器');
      return;
    }

    log(`找到 ${pageContainers.length} 个页面容器`);

    // 在 CSS Running 模式下，主要工作是：
    // 1. 分析每页包含的 QR 引用
    // 2. 可选：隐藏不属于当前页的 QR 码（如果用户选择非累积显示）

    pageContainers.forEach((pageContainer, pageIndex) => {
      analyzePageQRReferences(pageContainer, pageIndex);
    });

    log('CSS Running 模式处理完成');
  }

  // 分析页面中的 QR 引用
  function analyzePageQRReferences(pageContainer, pageIndex) {
    const refMarks = pageContainer.querySelectorAll(CONFIG.selectors.refMark);
    const qrIds = [];

    refMarks.forEach((mark) => {
      const qrId = mark.dataset.qrId || mark.getAttribute('data-qr-id');
      if (qrId) {
        qrIds.push(qrId);
        qrRegistry.set(qrId, {
          element: mark,
          pageIndex: pageIndex
        });
      }
    });

    log(`第 ${pageIndex + 1} 页包含 ${qrIds.length} 个 QR 引用: ${qrIds.join(', ')}`);
  }

  // ==================== Direct Inject 模式 ====================
  // 在这种模式下，插件直接将 QR 码注入到页面侧边栏
  function processDirectInjectMode() {
    log('Direct Inject 模式处理...');

    const viewport = document.querySelector('[data-vivliostyle-viewer-viewport]');
    const root = viewport || document;

    const pageContainers = root.querySelectorAll(CONFIG.selectors.pageContainer);
    if (pageContainers.length === 0) {
      log('未找到页面容器，进入预览模式');
      processPreviewMode(root);
      return;
    }

    log(`找到 ${pageContainers.length} 个页面容器`);

    // 收集所有预处理的 QR 容器
    const allQRContainers = collectQRContainers(root);
    log(`找到 ${allQRContainers.length} 个预处理的 QR 容器`);

    // 为每个页面创建侧边栏
    pageContainers.forEach((pageContainer, pageIndex) => {
      processPageDirectInject(pageContainer, pageIndex, allQRContainers);
    });

    log('Direct Inject 模式处理完成');
  }

  // 收集所有预处理的 QR 容器
  function collectQRContainers(root) {
    const containers = [];
    const qrElements = root.querySelectorAll(CONFIG.selectors.qrContainer);

    qrElements.forEach((el, index) => {
      const qrId = el.dataset.qrId || el.getAttribute('data-qr-id') || `qr-pre-${index}`;
      containers.push({
        qrId: qrId,
        element: el,
        html: el.innerHTML
      });
    });

    return containers;
  }

  // Direct Inject 模式下处理单个页面
  function processPageDirectInject(pageContainer, pageIndex, allQRContainers) {
    // 查找该页面中的引用标记
    const refMarks = pageContainer.querySelectorAll(CONFIG.selectors.refMark);
    const pageQRIds = new Set();

    refMarks.forEach((mark) => {
      const qrId = mark.dataset.qrId || mark.getAttribute('data-qr-id');
      if (qrId) {
        pageQRIds.add(qrId);
      }
    });

    if (pageQRIds.size === 0) {
      log(`第 ${pageIndex + 1} 页无 QR 引用`);
      // 移除已存在的侧边栏
      const oldSidebar = pageContainer.querySelector('.qr-sidebar-injected');
      if (oldSidebar) oldSidebar.remove();
      return;
    }

    // 找到对应的 QR 容器
    const pageQRContainers = allQRContainers.filter(c => pageQRIds.has(c.qrId));

    if (pageQRContainers.length === 0) {
      log(`第 ${pageIndex + 1} 页找不到对应的 QR 容器`);
      return;
    }

    // 创建侧边栏
    createInjectSidebar(pageContainer, pageQRContainers, pageIndex);
  }

  // 创建注入式侧边栏
  function createInjectSidebar(pageContainer, qrContainers, pageIndex) {
    let sidebar = pageContainer.querySelector('.qr-sidebar-injected');

    if (!sidebar) {
      sidebar = document.createElement('div');
      sidebar.className = 'qr-sidebar-injected';
      applyStyles(sidebar, {
        position: 'absolute',
        [CONFIG.sidebar.position]: '0',
        top: '0',
        width: CONFIG.sidebar.width,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: CONFIG.sidebar.paddingTop,
        boxSizing: 'border-box',
        overflow: 'hidden',
        pointerEvents: 'none',
        backgroundColor: CONFIG.sidebar.backgroundColor,
        zIndex: '100'
      });

      // 确保页面容器是定位上下文
      if (getComputedStyle(pageContainer).position === 'static') {
        pageContainer.style.position = 'relative';
      }

      pageContainer.appendChild(sidebar);
    }

    // 填充 QR 内容
    sidebar.innerHTML = qrContainers.map(c => `
      <div class="qr-item-injected" style="
        margin-bottom: 8px;
        text-align: center;
        padding: 5px;
        background: rgba(255,255,255,0.9);
        border-radius: 4px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      ">
        ${c.html}
      </div>
    `).join('');

    log(`第 ${pageIndex + 1} 页侧边栏已创建，包含 ${qrContainers.length} 个 QR 码`);
  }

  // ==================== 预览模式（无分页） ====================
  function processPreviewMode(root) {
    const qrContainers = collectQRContainers(root);
    if (qrContainers.length === 0) {
      log('预览模式：无 QR 容器');
      return;
    }

    let sidebar = document.querySelector('.qr-sidebar-preview-preprocessed');
    if (!sidebar) {
      sidebar = document.createElement('div');
      sidebar.className = 'qr-sidebar-preview-preprocessed';
      applyStyles(sidebar, {
        position: 'fixed',
        [CONFIG.sidebar.position]: '10px',
        top: '10px',
        width: CONFIG.sidebar.width,
        maxHeight: '90vh',
        overflowY: 'auto',
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
        padding: '10px',
        zIndex: '9999'
      });
      document.body.appendChild(sidebar);
    }

    sidebar.innerHTML = `
      <div style="
        font-size: 10pt;
        font-weight: bold;
        color: #333;
        margin-bottom: 10px;
        text-align: center;
        border-bottom: 1px solid #eee;
        padding-bottom: 8px;
      ">
        媒体资源 (${qrContainers.length})
      </div>
      ${qrContainers.map(c => `
        <div style="
          margin-bottom: 8px;
          text-align: center;
          padding: 5px;
          background: rgba(255,255,255,0.9);
          border-radius: 4px;
        ">
          ${c.html}
        </div>
      `).join('')}
    `;

    log(`预览模式侧边栏已创建，包含 ${qrContainers.length} 个 QR 码`);
  }

  // ==================== 工具函数 ====================
  function applyStyles(element, styles) {
    Object.assign(element.style, styles);
  }

  // ==================== 导出 API ====================
  window.QRSidebarPluginPreprocessed = {
    init: init,
    process: processPages,
    getConfig: () => ({ ...CONFIG }),
    setConfig: (newConfig) => Object.assign(CONFIG, newConfig),
    getQRRegistry: () => new Map(qrRegistry),
    reprocess: processPages,
    enableDebug: () => { CONFIG.debug = true; },
    disableDebug: () => { CONFIG.debug = false; }
  };

  // ==================== 自动入口 ====================
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      log('DOM 加载完成，尝试自动绑定');

      const attached = attachCoreViewerListeners();
      if (!attached) {
        log('coreViewer 不可用，使用延迟处理');
        setTimeout(processPages, 500);
      }
    });
  }

})();
