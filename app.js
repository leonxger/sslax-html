
(function () {
  'use strict';

  const STORAGE_KEYS = {
    CODE: 'sslaxhtml_code',
    SETTINGS: 'sslaxhtml_settings',
    LAYOUT: 'sslaxhtml_layout',
    RATIO: 'sslaxhtml_ratio',
    HINT: 'sslaxhtml_hint_seen'
  };

  const DATA_PATHS = {
    templates: 'data/templates.json',
    themes: 'data/themes.json',
    monacoBase: 'vendor/monaco/vs'
  };

  let templates = [];
  let templateIndex = {};
  let themes = [];

  let state = {
    code: '',
    settings: {
      lineNumbers: true,
      fontSize: 14,
      tabSize: 2,
      syncMode: 'realtime',
      pauseDelay: 1000,
      validation: true,
      theme: 'midnight-forge',
      minimapEnabled: true,
      minimapWidth: 100
    },
    layout: 'horizontal',
    ratio: 55,
    consoleExpanded: false,
    consoleLogs: [],
    urlValidations: {},
    isOnline: navigator.onLine,
    lastSaved: null,
    searchVisible: false,
    searchQuery: '',
    searchMatches: [],
    replaceValue: '',
    searchCurrentIndex: 0,
    mobilePane: 'editor',
    advancedSearch: {
      open: false,
      results: [],
      activeIndex: -1,
      options: {
        regex: false,
        caseSensitive: false,
        wholeWord: true,
        range: 120,
        mode: 'all',
        selectionOnly: false
      },
      lastQuery: '',
      terms: []
    }
  };

  const els = {};

  let editor = null;
  let monacoLoaderPromise = null;
  let searchDecorations = [];
  let linkDecorations = [];
  let previewTimer = null;
  let validationTimer = null;
  const templateCache = {};
  let keyboardHintTimeout = null;
  let isApplyingTemplate = false;
  let autoSaveTimer = null;
  const mobileQuery = window.matchMedia('(max-width: 768px)');
  const THEME_TRANSITION_CLASS = 'theme-transition';
  const MIN_MOBILE_FONT_SIZE = 16;
  const TOAST_ICONS = {
    success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />',
    error: '<circle cx="12" cy="12" r="10" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />'
  };
  let toolbarScrollHintSeen = false;
  let toastTimer = null;

  function getEl(id) {
    if (els[id]) return els[id];
    const found = document.getElementById(id);
    if (found) {
      els[id] = found;
    }
    return found;
  }

  function bindClick(id, handler) {
    const el = getEl(id);
    if (el) {
      el.addEventListener('click', handler);
    }
    return el;
  }

  async function loadStaticData() {
    const [templatesRes, themesRes] = await Promise.all([
      fetch(DATA_PATHS.templates),
      fetch(DATA_PATHS.themes)
    ]);
    if (!templatesRes.ok || !themesRes.ok) {
      throw new Error('Failed to load local data assets');
    }
    templates = await templatesRes.json();
    themes = await themesRes.json();
    templateIndex = templates.reduce((acc, template) => {
      acc[template.id] = template;
      return acc;
    }, {});
  }

  function getDefaultThemeId() {
    return (themes[0] && themes[0].id) ? themes[0].id : 'midnight-forge';
  }

  function logWelcomeMessage() {
    const baseFont = 'font-family:"Inter Tight","SF Pro Text",system-ui,-apple-system,sans-serif';
    const titleStyle = `${baseFont};color:#38bdf8;font-weight:800;font-size:14px`;
    const textStyle = `${baseFont};color:#e5edff;font-weight:600;font-size:13px`;
    const linkStyle = `${baseFont};color:#7dd3fc;font-weight:700;font-size:13px;text-decoration:underline`;
    const loveStyle = `${baseFont};color:#f87171;font-weight:800;font-size:13px`;

    console.log(
      '%cSSLAX HTML%c - made for you.\n%cFeel free to check out my GitHub: %chttps://github.com/leonxger\n%cEaster Egg: I also make music. If you like dnb check out my links: %chttps://linktr.ee/sslax\n%cLove, Leon',
      titleStyle,
      textStyle,
      textStyle,
      linkStyle,
      textStyle,
      linkStyle,
      loveStyle
    );
  }

  async function init() {
    cacheElements();
    logWelcomeMessage();
    try {
      await loadStaticData();
    } catch (e) {
      console.error(e);
      showToast('Local assets failed to load', 'error');
    }
    renderTemplateGrid();
    loadState();
    renderThemeControls();
    applyTheme(state.settings.theme, { skipEditor: true, skipAnimation: true, persist: false });
    setupEventListeners();
    applyLayout();
    setupTooltips();
    setupToolbarScrollHint();
    setupResponsiveLayoutWatcher();
    if (els.previewIframe) {
      els.previewIframe.addEventListener('load', applyPreviewScrollbarTheme);
    }
    initEditor().then(() => {
      applySettings();
      updateSyncDisplay();
      updateLineAndCursor();
      updatePreview(true);
      scheduleValidation();
      hideLoadingScreen();
      startAutoSave();
    }).catch(err => {
      console.error('Failed to initialize editor', err);
      hideLoadingScreen();
    });
    updateOnlineStatus();
    showKeyboardHintOnce();
  }

  function cacheElements() {
    const ids = [
      'app', 'workspace', 'editorPanel', 'previewPanel', 'previewContainer',
      'dividerHandle', 'previewIframe', 'previewFrameWrapper', 'previewRefreshLine',
      'consoleDrawer', 'consoleContent', 'consoleBadge', 'consoleHeader', 'consoleClearBtn',
      'settingsModal', 'templatesModal', 'templatesGrid', 'clearModal', 'toast', 'toastMessage', 'toastIcon',
      'syncDot', 'syncLabel', 'lineCount', 'cursorPos', 'validCount', 'invalidCount', 'pendingCount',
      'connectionDot', 'connectionStatus', 'offlineIndicator', 'lastSaved', 'loadingScreen',
      'viewportSelect', 'searchBar', 'searchInput', 'replaceInput', 'searchCount', 'searchClose',
      'keyboardHint', 'monacoEditor', 'replaceNextBtn', 'replaceAllBtn', 'resetCodeBtn',
      'settingsClearCache', 'editorPlaceholder', 'emptyPreview', 'emptyTemplates', 'fullscreenBtn',
      'themeSelect', 'themeGrid', 'advancedSearchModal', 'advancedSearchInput', 'advancedRegexToggle',
      'advancedCaseToggle', 'advancedWholeToggle', 'advancedRange', 'advancedRangeValue',
      'advancedResults', 'advancedResultDetail', 'advancedSearchRun', 'advancedSearchReset',
      'advancedMatchMode', 'advancedSelectionToggle', 'advancedSearchBtn', 'advancedSearchClose',
      'clearCurrentBtn', 'clearCacheBtn', 'clearCancelBtn', 'clearCancelFooter', 'minimapToggle',
      'minimapWidthSlider', 'minimapWidthValue', 'mobilePaneToggle', 'selectAllBtn', 'undoBtn',
      'redoBtn', 'saveBtn', 'toolbar', 'toolbarScrollHint', 'lineNumbersToggle', 'validationToggle',
      'syncModeSelect', 'pauseDelaySlider', 'pauseDelayValue', 'pauseDelayRow', 'fontSizeSelect',
      'tabSizeSelect', 'copyBtn', 'formatBtn', 'templatesBtn', 'downloadBtn', 'settingsBtn',
      'fullTabBtn', 'refreshBtn', 'consoleToggleBtn', 'syncToggle', 'searchBtn'
    ];
    ids.forEach(id => { els[id] = document.getElementById(id); });
  }

  function loadState() {
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        state.settings = { ...state.settings, ...parsed };
      }
      state.settings.theme = getThemeById(state.settings.theme).id;
      const savedLayout = localStorage.getItem(STORAGE_KEYS.LAYOUT);
      if (savedLayout) state.layout = savedLayout;
      const savedRatio = localStorage.getItem(STORAGE_KEYS.RATIO);
      if (savedRatio) state.ratio = parseFloat(savedRatio);
    } catch (e) { console.warn('Could not load state from localStorage'); }
  }

  function hideLoadingScreen() {
    setTimeout(() => {
      els.loadingScreen.classList.add('hidden');
      if (editor) editor.focus();
    }, 2200);
  }

  async function getInitialCode() {
    try {
      const savedCode = localStorage.getItem(STORAGE_KEYS.CODE);
      return stripLiveServerInjected(savedCode || '');
    } catch (e) {
      return '';
    }
  }

  function loadMonaco() {
    if (monacoLoaderPromise) return monacoLoaderPromise;
    monacoLoaderPromise = new Promise((resolve, reject) => {
      if (window.monaco) {
        resolve(window.monaco);
        return;
      }
      if (!window.require) {
        reject(new Error('Monaco loader not available'));
        return;
      }
      window.require.config({ paths: { 'vs': DATA_PATHS.monacoBase } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    });
    return monacoLoaderPromise;
  }

  function getThemeById(id) {
    if (themes && themes.length > 0) {
      const found = themes.find(t => t.id === id);
      return found || themes[0];
    }
    return {
      id: 'sslaxhtml-fallback',
      name: 'SSLAX HTML',
      tone: 'dark',
      swatch: ['#58a6ff', '#3fb950', '#f85149'],
      cssVars: {
        '--void': '#0d1117',
        '--surface': '#161b22',
        '--elevated': '#1c2128',
        '--divider': '#30363d',
        '--subtle-border': '#21262d',
        '--text-primary': '#e6edf3',
        '--text-secondary': '#8b949e',
        '--text-tertiary': '#6e7681',
        '--accent': '#58a6ff',
        '--success': '#3fb950',
        '--warning': '#d29922',
        '--danger': '#f85149',
        '--neutral': '#6e7681',
        '--shadow-elevated': '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(48, 54, 61, 0.8)',
        '--shadow-hover': '0 4px 12px rgba(0, 0, 0, 0.4)'
      },
      monaco: {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#0f172a',
          'editor.foreground': '#e2e8f0',
          'editor.lineHighlightBackground': '#1e293b80',
          'editorCursor.foreground': '#0ea5e9',
          'editorIndentGuide.background': '#263140',
          'editorLineNumber.foreground': '#475569'
        }
      }
    };
  }

  function registerThemes(monaco) {
    const themeList = (themes && themes.length > 0) ? themes : [getThemeById(getDefaultThemeId())];
    themeList.forEach(theme => {
      monaco.editor.defineTheme(theme.id, theme.monaco);
    });
  }

  function applyTheme(themeId, options = {}) {
    const theme = getThemeById(themeId);
    const { skipEditor = false, skipAnimation = false, persist = true } = options;
    state.settings.theme = theme.id;
    document.documentElement.setAttribute('data-theme', theme.id);
    Object.entries(theme.cssVars).forEach(([key, val]) => {
      document.documentElement.style.setProperty(key, val);
    });
    const [sw1, sw2, sw3] = theme.swatch || [];
    const accent = theme.cssVars['--accent'];
    const success = theme.cssVars['--success'] || accent;
    const danger = theme.cssVars['--danger'] || accent;
    document.documentElement.style.setProperty('--swatch-1', sw1 || accent);
    document.documentElement.style.setProperty('--swatch-2', sw2 || success);
    document.documentElement.style.setProperty('--swatch-3', sw3 || danger);
    updateThemeUI(theme.id);
    if (!skipAnimation) animateThemeSwitch();
    if (!skipEditor && window.monaco && editor) {
      window.monaco.editor.setTheme(theme.id);
    }
    applyPreviewScrollbarTheme();
    if (persist) persistSettings();
  }

  function animateThemeSwitch() {
    document.documentElement.classList.add(THEME_TRANSITION_CLASS);
    setTimeout(() => document.documentElement.classList.remove(THEME_TRANSITION_CLASS), 360);
  }

  function renderThemeControls() {
    if (!themes || themes.length === 0) return;
    const currentTheme = getThemeById(state.settings.theme).id;
    if (els.themeSelect) {
      els.themeSelect.innerHTML = themes.map(theme => `<option value="${theme.id}">${theme.name}${theme.tone === 'light' ? ' · Light' : ''}</option>`).join('');
      els.themeSelect.value = currentTheme;
    }
    if (els.themeGrid) {
      els.themeGrid.innerHTML = themes.map(theme => `
<button class="theme-card" data-theme="${theme.id}">
  <div class="theme-card-head">
    <span class="theme-card-name">${theme.name}</span>
    <span class="theme-card-pill">${theme.tone === 'light' ? 'Light' : 'Dark'}</span>
  </div>
  <div class="theme-card-swatches">
    ${theme.swatch.map(color => `<span style="background:${color}"></span>`).join('')}
  </div>
</button>`).join('');
      els.themeGrid.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => applyTheme(card.dataset.theme));
      });
      updateThemeUI(currentTheme);
    }
  }

  function updateThemeUI(themeId) {
    if (els.themeSelect) {
      els.themeSelect.value = themeId;
    }
    if (els.themeGrid) {
      els.themeGrid.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === themeId);
      });
    }
  }

  function stripLiveServerInjected(content) {
    if (!content) return content;
    let cleaned = content.replace(/<!--\s*Code injected by live-server\s*-->/gi, '');
    cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?live-server[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?Live reload enabled[\s\S]*?<\/script>/gi, '');
    return cleaned;
  }

  async function loadTemplate(name) {
    if (templateCache[name]) return templateCache[name];
    const template = templateIndex[name];
    if (!template) throw new Error('Template not found');
    const res = await fetch(template.path);
    if (!res.ok) throw new Error('Failed to load template');
    const text = stripLiveServerInjected(await res.text());
    templateCache[name] = text;
    return text;
  }

  function renderTemplateGrid() {
    if ((!els.templatesGrid && !els.emptyTemplates) || templates.length === 0) return;
    const markup = templates.map(template => `
      <div class="template-card" data-template="${template.id}">
        <div class="template-card-title">${template.name}</div>
        <div class="template-card-desc">${template.description}</div>
      </div>
    `).join('');
    [els.templatesGrid, els.emptyTemplates].forEach(container => {
      if (!container) return;
      container.innerHTML = markup;
      bindTemplateCards(container);
    });
  }

  async function initEditor() {
    const monaco = await loadMonaco();
    registerThemes(monaco);
    const initialCode = await getInitialCode();
    const activeTheme = getThemeById(state.settings.theme).id;
    const minimapOptions = buildMinimapOptions();

    editor = monaco.editor.create(els.monacoEditor, {
      value: initialCode,
      language: 'html',
      theme: activeTheme,
      fontSize: getEditorFontSize(),
      fontFamily: "'Fira Code','JetBrains Mono','SF Mono','Cascadia Code','Consolas',monospace",
      fontLigatures: true,
      minimap: minimapOptions,
      wordWrap: 'on',
      padding: { top: 12 },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: state.settings.tabSize,
      lineNumbers: state.settings.lineNumbers ? 'on' : 'off',
      renderWhitespace: 'none'
    });

    state.code = initialCode;
    updateEmptyStates();

    editor.onDidChangeModelContent(() => {
      state.code = editor.getValue();
      updateLineAndCursor();
      if (isApplyingTemplate) return;
      schedulePreviewUpdate();
      scheduleValidation();
      if (state.searchVisible && state.searchQuery) {
        performSearch();
      } else {
        clearSearchDecorations();
      }
      updateEmptyStates();
    });

    editor.onDidChangeCursorPosition(updateLineAndCursor);

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveToStorage();
      showToast('Code saved');
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
      toggleSearch();
    });

    editor.onDidFocusEditorWidget(() => {
      els.editorPanel.classList.add('focused');
    });
    editor.onDidBlurEditorWidget(() => {
      els.editorPanel.classList.remove('focused');
    });

    return editor;
  }

  function showKeyboardHintOnce() {
    const hasSeenHint = localStorage.getItem(STORAGE_KEYS.HINT);
    if (!hasSeenHint) {
      setTimeout(() => {
        els.keyboardHint.classList.add('visible');
        keyboardHintTimeout = setTimeout(() => {
          els.keyboardHint.classList.remove('visible');
          localStorage.setItem(STORAGE_KEYS.HINT, '1');
        }, 5000);
      }, 2000);
    }
  }

  function setupEventListeners() {
    document.querySelectorAll('.layout-btn').forEach(btn => {
      btn.addEventListener('click', () => setLayout(btn.dataset.layout));
    });

    bindClick('syncToggle', cycleSyncMode);
    bindClick('searchBtn', toggleSearch);
    bindClick('formatBtn', formatCode);
    if (els.selectAllBtn) els.selectAllBtn.addEventListener('click', selectAllCode);
    if (els.undoBtn) els.undoBtn.addEventListener('click', undoEdit);
    if (els.redoBtn) els.redoBtn.addEventListener('click', redoEdit);
    bindClick('templatesBtn', () => openModal('templates'));
    bindClick('downloadBtn', downloadHTML);
    if (els.saveBtn) els.saveBtn.addEventListener('click', () => { saveToStorage(); showToast('Code saved'); });
    bindClick('resetCodeBtn', openClearModal);
    bindClick('copyBtn', copyToClipboard);
    bindClick('settingsBtn', () => openModal('settings'));
    bindClick('fullTabBtn', openFullTab);
    if (els.themeSelect) {
      els.themeSelect.addEventListener('change', e => applyTheme(e.target.value));
    }
    if (els.advancedSearchBtn) {
      els.advancedSearchBtn.addEventListener('click', openAdvancedSearchModal);
    }
    bindClick('fullscreenBtn', toggleFullscreen);
    bindClick('refreshBtn', () => updatePreview(true));
    bindClick('consoleToggleBtn', toggleConsole);
    if (els.consoleHeader) {
      els.consoleHeader.addEventListener('click', toggleConsole);
    }
    if (els.consoleClearBtn) {
      els.consoleClearBtn.addEventListener('click', e => { e.stopPropagation(); clearConsoleLogs(); });
    }

    if (els.viewportSelect) {
      els.viewportSelect.addEventListener('change', handleViewportChange);
    }

    els.searchInput.addEventListener('input', handleSearchInput);
    els.searchInput.addEventListener('keydown', handleSearchKeydown);
    els.searchClose.addEventListener('click', closeSearch);
    els.replaceInput.addEventListener('input', handleReplaceInput);
    els.replaceNextBtn.addEventListener('click', replaceCurrentMatch);
    els.replaceAllBtn.addEventListener('click', replaceAllMatches);
    if (els.advancedRange) els.advancedRange.addEventListener('input', e => updateAdvancedRangeValue(e.target.value));
    if (els.advancedSearchRun) els.advancedSearchRun.addEventListener('click', () => runAdvancedSearch());
    if (els.advancedSearchReset) els.advancedSearchReset.addEventListener('click', resetAdvancedSearch);
    if (els.advancedRegexToggle) els.advancedRegexToggle.addEventListener('change', syncAdvancedOptionsFromUI);
    if (els.advancedCaseToggle) els.advancedCaseToggle.addEventListener('change', syncAdvancedOptionsFromUI);
    if (els.advancedWholeToggle) els.advancedWholeToggle.addEventListener('change', syncAdvancedOptionsFromUI);
    if (els.advancedSelectionToggle) els.advancedSelectionToggle.addEventListener('change', syncAdvancedOptionsFromUI);
    if (els.advancedMatchMode) els.advancedMatchMode.addEventListener('change', syncAdvancedOptionsFromUI);
    if (els.advancedSearchInput) {
      els.advancedSearchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          runAdvancedSearch();
        }
      });
    }
    if (els.advancedSearchClose) {
      els.advancedSearchClose.addEventListener('click', closeAdvancedSearchModal);
    }

    setupDragAndDrop();

    setupDividerDrag();

    setupMobilePaneControls();

    bindClick('settingsClose', () => closeModal('settings'));
    bindClick('settingsCancel', () => closeModal('settings'));
    bindClick('settingsSave', saveSettings);
    bindClick('settingsClearCache', clearCache);

    bindClick('templatesClose', () => closeModal('templates'));

    if (els.clearCurrentBtn) els.clearCurrentBtn.addEventListener('click', () => clearEditor(false));
    if (els.clearCacheBtn) els.clearCacheBtn.addEventListener('click', () => clearEditor(true));
    if (els.clearCancelBtn) els.clearCancelBtn.addEventListener('click', closeClearModal);
    if (els.clearCancelFooter) els.clearCancelFooter.addEventListener('click', closeClearModal);

    document.querySelectorAll('.toggle-switch').forEach(toggle => {
      toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        if (toggle.id === 'minimapToggle') {
          syncMinimapControls();
        }
      });
    });

    window.addEventListener('online', () => { state.isOnline = true; updateOnlineStatus(); });
    window.addEventListener('offline', () => { state.isOnline = false; updateOnlineStatus(); });

    document.addEventListener('keydown', handleGlobalKeydown);

    const syncModeSelect = getEl('syncModeSelect');
    if (syncModeSelect) {
      syncModeSelect.addEventListener('change', e => updatePauseDelayVisibility(e.target.value));
    }
    const pauseDelaySlider = getEl('pauseDelaySlider');
    if (pauseDelaySlider) {
      pauseDelaySlider.addEventListener('input', e => updatePauseDelayValueDisplay(e.target.value));
    }
    const minimapWidthSlider = getEl('minimapWidthSlider');
    if (minimapWidthSlider) {
      minimapWidthSlider.addEventListener('input', e => updateMinimapWidthValueDisplay(e.target.value));
    }
  }

  function setupResponsiveLayoutWatcher() {
    const handler = () => {
      applyLayout();
      refreshEditorForViewport();
      refreshToolbarScrollHint();
    };
    if (mobileQuery.addEventListener) {
      mobileQuery.addEventListener('change', handler);
    } else {
      mobileQuery.addListener(handler);
    }
  }

  function setupTooltips() {
    let tooltip = document.querySelector('.js-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'js-tooltip';
      document.body.appendChild(tooltip);
    }

    let activeTarget = null;

    const updatePosition = () => {
      if (!activeTarget || !tooltip.classList.contains('visible')) return;
      const rect = activeTarget.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();

      let top = rect.top - tooltipRect.height - 8;
      let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

      if (activeTarget.classList.contains('tooltip-left')) {
        top = rect.top + (rect.height / 2) - (tooltipRect.height / 2);
        left = rect.left - tooltipRect.width - 8;
      }

      if (left < 4) left = 4;
      if (left + tooltipRect.width > window.innerWidth - 4) left = window.innerWidth - tooltipRect.width - 4;
      if (top < 4) top = rect.bottom + 8;

      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    };

    document.addEventListener('mouseover', e => {
      const target = e.target.closest('[data-tooltip]');
      if (target && target !== activeTarget) {
        activeTarget = target;
        const text = target.getAttribute('data-tooltip');
        if (text) {
          tooltip.textContent = text;
          tooltip.classList.add('visible');
          updatePosition();
        }
      }
    });

    document.addEventListener('mouseout', e => {
      const target = e.target.closest('[data-tooltip]');
      if (target && target === activeTarget) {
        if (e.relatedTarget && target.contains(e.relatedTarget)) return;

        activeTarget = null;
        tooltip.classList.remove('visible');
      }
    });

    window.addEventListener('scroll', () => {
      if (activeTarget && tooltip.classList.contains('visible')) updatePosition();
    }, { capture: true, passive: true });

    window.addEventListener('resize', () => {
      if (activeTarget && tooltip.classList.contains('visible')) updatePosition();
    }, { passive: true });
  }

  function setupToolbarScrollHint() {
    const bar = els.toolbar;
    const hint = els.toolbarScrollHint;
    if (!bar || !hint) return;

    const hideHint = () => {
      toolbarScrollHintSeen = true;
      hint.classList.remove('visible');
    };

    const updateVisibility = () => {
      const overflow = bar.scrollWidth - bar.clientWidth > 6;
      hint.classList.toggle('visible', overflow && !toolbarScrollHintSeen);
    };

    hint.addEventListener('click', () => {
      bar.scrollBy({ left: bar.clientWidth * 0.6, behavior: 'smooth' });
      hideHint();
    });

    bar.addEventListener('scroll', () => {
      if (bar.scrollLeft > 2) {
        hideHint();
      }
    });

    window.addEventListener('resize', updateVisibility);
    updateVisibility();
  }

  function refreshToolbarScrollHint() {
    const bar = els.toolbar;
    const hint = els.toolbarScrollHint;
    if (!bar || !hint) return;
    const overflow = bar.scrollWidth - bar.clientWidth > 6;
    hint.classList.toggle('visible', overflow && !toolbarScrollHintSeen);
  }

  function setupMobilePaneControls() {
    const container = els.mobilePaneToggle;
    if (!container) return;
    container.addEventListener('click', e => {
      const btn = e.target.closest('.mobile-pane-btn');
      if (!btn) return;
      const pane = btn.dataset.pane === 'preview' ? 'preview' : 'editor';
      setMobilePane(pane);
    });
  }

  function handleGlobalKeydown(e) {
    if (e.key === 'Escape') {
      closeSearch();
      closeModal('settings');
      closeModal('templates');
      closeAdvancedSearchModal();
      closeClearModal();
      if (els.keyboardHint.classList.contains('visible')) {
        els.keyboardHint.classList.remove('visible');
        clearTimeout(keyboardHintTimeout);
        localStorage.setItem(STORAGE_KEYS.HINT, '1');
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      toggleSearch();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openAdvancedSearchModal();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      if (!state.searchVisible) {
        toggleSearch();
      }
      els.replaceInput.focus();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveToStorage();
      showToast('Code saved');
    }
    if (e.shiftKey && e.altKey && e.key === 'F') {
      e.preventDefault();
      formatCode();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      updatePreview(true);
    }
  }

  function setupDividerDrag() {
    let dragState = null;
    let rafId = null;

    const clampRatio = r => Math.max(15, Math.min(85, r));

    const updateRatio = () => {
      rafId = null;
      if (!dragState) return;
      const { startX, startY, startRatio, isVertical, rect, lastX, lastY } = dragState;
      const deltaPercent = isVertical
        ? ((lastY - startY) / rect.height) * 100
        : ((lastX - startX) / rect.width) * 100;
      let newRatio = clampRatio(startRatio + deltaPercent);
      const snapPoints = [30, 50, 70];
      for (const snap of snapPoints) {
        if (Math.abs(newRatio - snap) < 2) {
          newRatio = snap;
          break;
        }
      }
      state.ratio = newRatio;
      applyRatio();
      if (editor) editor.layout();
    };

    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(updateRatio);
    };

    const onPointerMove = e => {
      if (!dragState) return;
      dragState.lastX = e.clientX;
      dragState.lastY = e.clientY;
      e.preventDefault();
      scheduleUpdate();
    };

    const onPointerUp = e => {
      if (!dragState) return;
      els.dividerHandle.classList.remove('active');
      els.dividerHandle.releasePointerCapture(dragState.pointerId);
      dragState = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveRatio();
    };

    els.dividerHandle.addEventListener('pointerdown', e => {
      const rect = els.workspace.getBoundingClientRect();
      dragState = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        startRatio: state.ratio,
        isVertical: getEffectiveLayout() === 'vertical',
        rect
      };
      els.dividerHandle.setPointerCapture(e.pointerId);
      els.dividerHandle.classList.add('active');
      document.body.style.cursor = dragState.isVertical ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    els.dividerHandle.addEventListener('dblclick', () => {
      state.ratio = 50;
      applyRatio();
      saveRatio();
      if (editor) editor.layout();
    });
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateLineAndCursor() {
    const model = editor ? editor.getModel() : null;
    if (!model) return;
    const lineCount = model.getLineCount() || 1;
    const pos = editor.getPosition();
    els.lineCount.textContent = `${lineCount} line${lineCount === 1 ? '' : 's'}`;
    if (pos) {
      els.cursorPos.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
    }
  }

  function getCode() {
    if (editor) {
      return editor.getValue();
    }
    return state.code || '';
  }

  function setEditorValue(value) {
    state.code = value;
    if (editor) {
      editor.setValue(value);
    }
    updateEmptyStates();
  }

  function schedulePreviewUpdate() {
    const syncMode = state.settings.syncMode;
    if (syncMode === 'manual') return;
    clearTimeout(previewTimer);
    const delay = syncMode === 'realtime' ? 150 : clampPauseDelay(state.settings.pauseDelay || 1000);
    previewTimer = setTimeout(() => updatePreview(), delay);
  }

  function updatePreview(force = false) {
    updateEmptyStates();
    showRefreshAnimation();
    const code = getCode();
    state.code = code;
    const wrappedCode = wrapCodeForPreview(code);
    els.previewIframe.srcdoc = wrappedCode;
  }

  function getPreviewScrollbarCss() {
    const root = getComputedStyle(document.documentElement);
    const getVar = (name, fallback) => (root.getPropertyValue(name) || fallback).trim() || fallback;
    const track = getVar('--scrollbar-track', '#161b22');
    const thumb = getVar('--scrollbar-thumb', '#58a6ff');
    const thumbHover = getVar('--scrollbar-thumb-hover', thumb);
    const outline = getVar('--scrollbar-outline', 'rgba(255,255,255,0.08)');
    const size = getVar('--scrollbar-size', '12px');
    const radius = getVar('--scrollbar-radius', '999px');
    return `
* { scrollbar-width: thin; scrollbar-color: ${thumb} ${track}; }
::-webkit-scrollbar { width: ${size}; height: ${size}; }
::-webkit-scrollbar-track { background: ${track}; border-radius: ${radius}; }
::-webkit-scrollbar-thumb {
  background: ${thumb};
  border-radius: ${radius};
  border: 3px solid transparent;
  background-clip: padding-box;
  box-shadow: inset 0 0 0 1px ${outline};
  transition: background 140ms ease, box-shadow 140ms ease;
}
::-webkit-scrollbar-thumb:hover { background: ${thumbHover}; box-shadow: inset 0 0 0 1px ${outline}; }
::-webkit-scrollbar-thumb:active { background: ${thumbHover}; box-shadow: inset 0 0 0 1px ${outline}; }
::-webkit-scrollbar-corner { background: ${track}; }
html, body { scrollbar-gutter: stable; }
`;
  }

  function getConsoleCaptureScript() {
    return `
<script>
(function(){
const originalConsole={log:console.log,warn:console.warn,error:console.error,info:console.info};
function sendToParent(type,args){
try{
parent.postMessage({type:'console',logType:type,args:Array.from(args).map(a=>{
try{return typeof a==='object'?JSON.stringify(a):String(a)}catch(e){return String(a)}
})},'*');
}catch(e){}
}
console.log=function(){originalConsole.log.apply(console,arguments);sendToParent('log',arguments);};
console.warn=function(){originalConsole.warn.apply(console,arguments);sendToParent('warn',arguments);};
console.error=function(){originalConsole.error.apply(console,arguments);sendToParent('error',arguments);};
console.info=function(){originalConsole.info.apply(console,arguments);sendToParent('log',arguments);};
window.onerror=function(msg,url,line,col,error){sendToParent('error',['Error: '+msg+' at line '+line]);return false;};
window.onunhandledrejection=function(e){sendToParent('error',['Unhandled Promise Rejection: '+e.reason]);};
})();
<\/script>`;
  }

  function buildPreviewChrome() {
    const scrollbarStyle = `<style id="preview-scrollbar-style">${getPreviewScrollbarCss()}</style>`;
    return `${scrollbarStyle}${getConsoleCaptureScript()}`;
  }

  function wrapCodeForPreview(code) {
    const chrome = buildPreviewChrome();
    if (code.includes('</head>')) {
      return code.replace('</head>', chrome + '</head>');
    } else if (code.includes('<body')) {
      return code.replace(/<body/i, chrome + '<body');
    }
    return chrome + code;
  }

  function applyPreviewScrollbarTheme() {
    if (!els.previewIframe || !els.previewIframe.contentDocument) return;
    const doc = els.previewIframe.contentDocument;
    const css = getPreviewScrollbarCss();
    let styleEl = doc.getElementById('preview-scrollbar-style');
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = 'preview-scrollbar-style';
      (doc.head || doc.body || doc.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = css;
  }

  function clampMinimapWidth(value) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return 100;
    return Math.max(80, Math.min(240, n));
  }

  function buildMinimapOptions() {
    const width = clampMinimapWidth(state.settings.minimapWidth || 100);
    state.settings.minimapWidth = width;
    return {
      enabled: !!state.settings.minimapEnabled,
      renderCharacters: false,
      showSlider: 'always',
      size: 'fit',
      maxColumn: width
    };
  }

  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'console') {
      addConsoleLog(e.data.logType, e.data.args.join(' '));
    }
  });

  function addConsoleLog(type, message) {
    const log = { type, message, time: new Date().toLocaleTimeString() };
    state.consoleLogs.push(log);
    if (state.consoleLogs.length > 100) state.consoleLogs.shift();
    renderConsoleLogs();
  }

  function renderConsoleLogs() {
    let errorCount = 0;
    let warnCount = 0;
    const total = state.consoleLogs.length;

    const markup = state.consoleLogs.map(log => {
      if (log.type === 'error') errorCount++;
      else if (log.type === 'warn') warnCount++;
      return `
<div class="console-entry ${log.type}">
<svg class="console-entry-icon ${log.type}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
${log.type === 'error' ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' :
          log.type === 'warn' ? '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' :
            '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'}
</svg>
<span class="console-entry-time">${log.time}</span>
<span class="console-entry-msg">${escapeHtml(log.message)}</span>
</div>
`;
    }).join('');

    if (total === 0) {
      els.consoleBadge.classList.remove('visible', 'warn', 'info');
      els.consoleContent.innerHTML = '<div class="console-empty">No console output yet</div>';
      return;
    }

    els.consoleBadge.textContent = total;
    els.consoleBadge.classList.add('visible');
    els.consoleBadge.classList.remove('warn', 'info');
    const statusClass = errorCount > 0 ? '' : warnCount > 0 ? 'warn' : 'info';
    if (statusClass) els.consoleBadge.classList.add(statusClass);

    els.consoleContent.innerHTML = markup;
  }

  function clearConsoleLogs() {
    state.consoleLogs = [];
    renderConsoleLogs();
  }

  function toggleConsole() {
    state.consoleExpanded = !state.consoleExpanded;
    els.consoleDrawer.classList.toggle('expanded', state.consoleExpanded);
  }

  function showRefreshAnimation() {
    els.previewRefreshLine.classList.remove('animating');
    void els.previewRefreshLine.offsetWidth;
    els.previewRefreshLine.classList.add('animating');
    setTimeout(() => els.previewRefreshLine.classList.remove('animating'), 450);
  }

  function handleViewportChange() {
    const value = els.viewportSelect.value;
    els.previewFrameWrapper.classList.remove('device-tablet', 'device-mobile');
    if (value === 'tablet') {
      els.previewFrameWrapper.classList.add('device-tablet');
    } else if (value === 'mobile') {
      els.previewFrameWrapper.classList.add('device-mobile');
    }
  }

  function toggleSearch() {
    if (state.searchVisible) {
      closeSearch();
      return;
    }
    state.searchVisible = true;
    els.searchBar.classList.add('visible');
    els.searchInput.focus();
    els.searchInput.select();
    els.replaceInput.value = state.replaceValue || '';
    updateEmptyStates();
  }

  function closeSearch() {
    state.searchVisible = false;
    els.searchBar.classList.remove('visible');
    state.searchQuery = '';
    state.searchMatches = [];
    state.searchCurrentIndex = 0;
    els.searchInput.value = '';
    els.replaceInput.value = '';
    state.replaceValue = '';
    els.searchCount.textContent = '';
    clearSearchDecorations();
    updateEmptyStates();
  }

  function handleSearchInput(e) {
    state.searchQuery = e.target.value;
    performSearch();
  }

  function handleSearchKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        navigateSearchResult(-1);
      } else {
        navigateSearchResult(1);
      }
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  }

  function handleReplaceInput(e) {
    state.replaceValue = e.target.value;
  }

  function performSearch() {
    if (!editor) return;
    const query = state.searchQuery;
    const model = editor.getModel();
    if (!model) return;
    if (!query) {
      state.searchMatches = [];
      state.searchCurrentIndex = 0;
      els.searchCount.textContent = '';
      clearSearchDecorations();
      return;
    }

    const matches = model.findMatches(query, true, false, false, null, true);
    state.searchMatches = matches.map(m => m.range);
    state.searchCurrentIndex = matches.length > 0 ? 0 : -1;

    if (matches.length > 0) {
      els.searchCount.textContent = `${state.searchCurrentIndex + 1} of ${matches.length}`;
    } else {
      els.searchCount.textContent = 'No results';
    }
    applySearchDecorations();
  }

  function navigateSearchResult(dir) {
    if (state.searchMatches.length === 0) return;
    state.searchCurrentIndex = (state.searchCurrentIndex + dir + state.searchMatches.length) % state.searchMatches.length;
    els.searchCount.textContent = `${state.searchCurrentIndex + 1} of ${state.searchMatches.length}`;

    applySearchDecorations();
  }

  function applySearchDecorations() {
    if (!editor) return;
    const monaco = window.monaco;
    const decorations = state.searchMatches.map((range, idx) => ({
      range,
      options: { inlineClassName: idx === state.searchCurrentIndex ? 'highlight-current' : 'highlight-match' }
    }));
    searchDecorations = editor.deltaDecorations(searchDecorations, decorations);
    const active = state.searchMatches[state.searchCurrentIndex];
    if (active && monaco) {
      editor.setSelection(active);
      editor.revealRangeInCenter(active, monaco.editor.ScrollType.Smooth);
    }
  }

  function clearSearchDecorations() {
    if (!editor) return;
    searchDecorations = editor.deltaDecorations(searchDecorations, []);
  }

  function openAdvancedSearchModal() {
    if (!els.advancedSearchModal) return;
    state.advancedSearch.open = true;
    syncAdvancedControlsFromState();
    els.advancedSearchModal.classList.add('visible');
    if (els.advancedSearchInput) {
      els.advancedSearchInput.focus();
      els.advancedSearchInput.select();
    }
  }

  function closeAdvancedSearchModal() {
    state.advancedSearch.open = false;
    if (els.advancedSearchModal) {
      els.advancedSearchModal.classList.remove('visible');
    }
  }

  function updateAdvancedRangeValue(value) {
    const val = clampAdvancedRange(value);
    if (els.advancedRangeValue) {
      els.advancedRangeValue.textContent = `${val} words window`;
    }
    state.advancedSearch.options.range = val;
  }

  function clampAdvancedRange(value) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return state.advancedSearch.options.range || 120;
    return Math.max(10, Math.min(1000, n));
  }

  function syncAdvancedControlsFromState() {
    const opts = state.advancedSearch.options;
    if (els.advancedRegexToggle) els.advancedRegexToggle.checked = opts.regex;
    if (els.advancedCaseToggle) els.advancedCaseToggle.checked = opts.caseSensitive;
    if (els.advancedWholeToggle) els.advancedWholeToggle.checked = opts.wholeWord;
    if (els.advancedSelectionToggle) els.advancedSelectionToggle.checked = opts.selectionOnly;
    if (els.advancedMatchMode) els.advancedMatchMode.value = opts.mode;
    if (els.advancedRange) {
      els.advancedRange.value = opts.range;
      updateAdvancedRangeValue(opts.range);
    }
    if (els.advancedSearchInput) {
      els.advancedSearchInput.value = state.advancedSearch.lastQuery || '';
    }
    renderAdvancedResults();
    renderAdvancedDetail(state.advancedSearch.results[state.advancedSearch.activeIndex]);
  }

  function syncAdvancedOptionsFromUI() {
    const opts = state.advancedSearch.options;
    opts.regex = !!(els.advancedRegexToggle && els.advancedRegexToggle.checked);
    opts.caseSensitive = !!(els.advancedCaseToggle && els.advancedCaseToggle.checked);
    opts.wholeWord = !!(els.advancedWholeToggle && els.advancedWholeToggle.checked);
    opts.selectionOnly = !!(els.advancedSelectionToggle && els.advancedSelectionToggle.checked);
    opts.mode = els.advancedMatchMode ? els.advancedMatchMode.value : 'all';
    if (els.advancedRange) {
      opts.range = clampAdvancedRange(els.advancedRange.value);
      updateAdvancedRangeValue(opts.range);
    }
    return opts;
  }

  function resetAdvancedSearch() {
    state.advancedSearch.results = [];
    state.advancedSearch.activeIndex = -1;
    state.advancedSearch.lastQuery = '';
    state.advancedSearch.terms = [];
    state.advancedSearch.options = { regex: false, caseSensitive: false, wholeWord: true, range: 120, mode: 'all', selectionOnly: false };
    if (els.advancedSearchInput) els.advancedSearchInput.value = '';
    syncAdvancedControlsFromState();
    renderAdvancedResults();
    renderAdvancedDetail(null);
  }

  function getAdvancedSearchScope() {
    if (state.advancedSearch.options.selectionOnly && editor) {
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        const model = editor.getModel();
        if (model) {
          const startOffset = model.getOffsetAt(selection.getStartPosition());
          const endOffset = model.getOffsetAt(selection.getEndPosition());
          return { text: model.getValueInRange(selection), offset: startOffset, endOffset };
        }
      }
    }
    const full = getCode();
    return { text: full, offset: 0, endOffset: full.length };
  }

  function parseAdvancedTerms(input) {
    return input.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);
  }

  function buildWordTokens(text, offset) {
    const tokens = [];
    let idx = 0;
    const regex = /\S+/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      tokens.push({
        word: match[0],
        start: offset + match.index,
        end: offset + match.index + match[0].length,
        wordIndex: idx++
      });
    }
    return tokens;
  }

  function runAdvancedSearch() {
    if (!els.advancedSearchInput) return;
    const opts = syncAdvancedOptionsFromUI();
    const rawInput = (els.advancedSearchInput.value || '').trim();
    state.advancedSearch.lastQuery = rawInput;
    const scope = getAdvancedSearchScope();
    const fullText = getCode();
    try {
      let results = [];
      if (opts.regex) {
        if (!rawInput) {
          showToast('Add a regex pattern');
          return;
        }
        state.advancedSearch.terms = [rawInput];
        results = runRegexSearch(rawInput, scope, fullText, opts);
      } else {
        const terms = parseAdvancedTerms(rawInput);
        if (terms.length === 0) {
          showToast('Add at least one search term');
          return;
        }
        state.advancedSearch.terms = terms;
        results = runMultiTermSearch(terms, scope, fullText, opts);
      }
      state.advancedSearch.results = results;
      state.advancedSearch.activeIndex = results.length ? 0 : -1;
      renderAdvancedResults();
      if (results.length) {
        selectAdvancedResult(0, { focusEditor: false });
      } else {
        renderAdvancedDetail(null);
      }
    } catch (err) {
      console.error('Advanced search failed', err);
      showToast('Advanced search failed', 'error');
    }
  }

  function runRegexSearch(pattern, scope, fullText, opts) {
    const flags = `g${opts.caseSensitive ? '' : 'i'}`;
    let regex;
    try {
      regex = new RegExp(pattern, flags);
    } catch (e) {
      showToast('Invalid regex pattern', 'error');
      return [];
    }
    const results = [];
    let match;
    let safety = 0;
    while ((match = regex.exec(scope.text)) !== null && safety < 5000) {
      const start = scope.offset + match.index;
      const end = start + match[0].length;
      results.push(buildResultEntry([{ term: pattern, start, end }], fullText, { fallbackWindow: Math.max(1, countWords(match[0])) }));
      if (match[0].length === 0) regex.lastIndex++;
      if (results.length >= 75) break;
      safety++;
    }
    return dedupeResults(results);
  }

  function runMultiTermSearch(terms, scope, fullText, opts) {
    const tokens = buildWordTokens(scope.text, scope.offset);
    const normalizedTerms = opts.caseSensitive ? terms : terms.map(t => t.toLowerCase());
    const occurrences = [];
    tokens.forEach(token => {
      const hay = opts.caseSensitive ? token.word : token.word.toLowerCase();
      normalizedTerms.forEach((term, idx) => {
        const matches = opts.wholeWord ? hay === term : hay.includes(term);
        if (matches) {
          occurrences.push({
            term: terms[idx],
            wordIndex: token.wordIndex,
            start: token.start,
            end: token.end
          });
        }
      });
    });
    if (occurrences.length === 0) return [];
    occurrences.sort((a, b) => a.wordIndex - b.wordIndex);
    const results = [];
    for (let i = 0; i < occurrences.length; i++) {
      const windowStart = occurrences[i].wordIndex;
      const windowHits = [];
      const seen = new Set();
      for (let j = i; j < occurrences.length; j++) {
        const occ = occurrences[j];
        const windowSize = occ.wordIndex - windowStart + 1;
        if (windowSize > opts.range) break;
        windowHits.push(occ);
        if (opts.mode === 'any') continue;
        seen.add(occ.term.toLowerCase());
        if (seen.size === terms.length) {
          results.push(buildResultEntry([...windowHits], fullText, { windowWords: windowSize }));
          break;
        }
      }
      if (opts.mode === 'any' && windowHits.length) {
        results.push(buildResultEntry([...windowHits], fullText, { windowWords: windowHits[windowHits.length - 1].wordIndex - windowHits[0].wordIndex + 1 }));
      }
      if (results.length >= 75) break;
    }
    return dedupeResults(results);
  }

  function buildResultEntry(matches, fullText, meta = {}) {
    if (!matches || matches.length === 0) return null;
    const sorted = [...matches].sort((a, b) => a.start - b.start);
    const start = sorted[0].start;
    const end = sorted[sorted.length - 1].end;
    const snippetStart = Math.max(0, start - 90);
    const snippetEnd = Math.min(fullText.length, end + 140);
    const snippetText = fullText.slice(snippetStart, snippetEnd);
    const snippet = highlightSnippet(snippetText, sorted, snippetStart);
    const windowFromWords = typeof sorted[0].wordIndex === 'number' && typeof sorted[sorted.length - 1].wordIndex === 'number'
      ? Math.max(1, sorted[sorted.length - 1].wordIndex - sorted[0].wordIndex + 1)
      : null;
    return {
      matches: sorted,
      start,
      end,
      windowWords: meta.windowWords || windowFromWords || Math.max(1, countWords(fullText.slice(start, end))),
      snippet
    };
  }

  function highlightSnippet(snippetText, matches, snippetStart) {
    if (!matches || matches.length === 0) return escapeHtml(snippetText);
    const sorted = [...matches].sort((a, b) => a.start - b.start);
    let html = '';
    let cursor = 0;
    sorted.forEach(match => {
      const relStart = Math.max(0, match.start - snippetStart);
      const relEnd = Math.max(relStart, match.end - snippetStart);
      html += escapeHtml(snippetText.slice(cursor, relStart));
      html += `<mark>${escapeHtml(snippetText.slice(relStart, relEnd))}</mark>`;
      cursor = relEnd;
    });
    html += escapeHtml(snippetText.slice(cursor));
    return html;
  }

  function renderAdvancedResults() {
    if (!els.advancedResults) return;
    const results = state.advancedSearch.results;
    if (!results || results.length === 0) {
      els.advancedResults.innerHTML = '<div class="advanced-empty">Run an advanced search to see grouped hits.</div>';
      return;
    }
    const model = editor ? editor.getModel() : null;
    els.advancedResults.innerHTML = results.map((res, idx) => {
      const lines = model ? res.matches.map(m => model.getPositionAt(m.start).lineNumber) : [];
      const lineLabel = lines.length ? `Line ${Math.min(...lines)}${Math.min(...lines) !== Math.max(...lines) ? '–' + Math.max(...lines) : ''}` : '';
      return `
      <div class="advanced-result ${idx === state.advancedSearch.activeIndex ? 'active' : ''}" data-index="${idx}">
        <div class="advanced-result-meta">
          <span class="advanced-pill">${res.windowWords} words</span>
          <span class="advanced-pill subtle">${lineLabel || 'Preview'}</span>
          <span class="advanced-pill subtle">${res.matches.length} match${res.matches.length === 1 ? '' : 'es'}</span>
        </div>
        <div class="advanced-snippet">${res.snippet}</div>
      </div>`;
    }).join('');
    els.advancedResults.querySelectorAll('.advanced-result').forEach(node => {
      const idx = parseInt(node.dataset.index, 10);
      node.addEventListener('click', () => selectAdvancedResult(idx));
    });
  }

  function selectAdvancedResult(index, options = {}) {
    const results = state.advancedSearch.results;
    if (!results || !results[index]) return;
    state.advancedSearch.activeIndex = index;
    renderAdvancedResults();
    renderAdvancedDetail(results[index]);
    if (options.focusEditor !== false) {
      highlightEditorForResult(results[index]);
    }
  }

  function renderAdvancedDetail(result) {
    if (!els.advancedResultDetail) return;
    if (!result) {
      els.advancedResultDetail.innerHTML = '<div class="advanced-empty muted">Select a result to see line level highlights.</div>';
      return;
    }
    const model = editor ? editor.getModel() : null;
    if (!model) {
      els.advancedResultDetail.innerHTML = '<div class="advanced-empty">Editor not ready.</div>';
      return;
    }
    const grouped = {};
    result.matches.forEach(match => {
      const startPos = model.getPositionAt(match.start);
      const endPos = model.getPositionAt(match.end);
      const lineNumber = startPos.lineNumber;
      const lineText = model.getLineContent(lineNumber);
      const lineOffset = model.getOffsetAt({ lineNumber, column: 1 });
      const relStart = Math.max(0, match.start - lineOffset);
      const relEnd = Math.max(relStart, match.end - lineOffset);
      if (!grouped[lineNumber]) {
        grouped[lineNumber] = { lineNumber, text: lineText, matches: [] };
      }
      grouped[lineNumber].matches.push({ start: relStart, end: relEnd });
    });
    const lines = Object.values(grouped).sort((a, b) => a.lineNumber - b.lineNumber);
    els.advancedResultDetail.innerHTML = lines.map(line => `
      <div class="advanced-line">
        <div class="advanced-line-meta">Line ${line.lineNumber}</div>
        <pre class="advanced-line-code">${highlightSnippet(line.text, line.matches, 0)}</pre>
      </div>
    `).join('');
  }

  function highlightEditorForResult(result) {
    if (!editor || !window.monaco || !result || !result.matches || result.matches.length === 0) return;
    const model = editor.getModel();
    if (!model) return;
    const first = result.matches[0];
    const startPos = model.getPositionAt(first.start);
    const endPos = model.getPositionAt(first.end);
    const selection = new window.monaco.Selection(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
    editor.setSelection(selection);
    editor.revealRangeInCenter(selection, window.monaco.editor.ScrollType.Smooth);
  }

  function dedupeResults(results) {
    const seen = new Set();
    const deduped = [];
    results.forEach(res => {
      if (!res) return;
      const key = `${res.start}-${res.end}`;
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(res);
    });
    return deduped;
  }

  function countWords(str) {
    if (!str) return 0;
    return (str.match(/\S+/g) || []).length;
  }

  function bindTemplateCards(root = document) {
    root.querySelectorAll('.template-card').forEach(card => {
      if (card.dataset.bound === '1') return;
      card.dataset.bound = '1';
      card.addEventListener('click', () => applyTemplate(card.dataset.template));
    });
  }

  function updateEmptyStates() {
    const hasCode = !!getCode().trim();
    if (els.editorPlaceholder) {
      els.editorPlaceholder.classList.toggle('visible', !hasCode);
    }
    if (els.emptyPreview && els.previewFrameWrapper && els.previewContainer) {
      els.previewContainer.classList.toggle('empty', !hasCode);
      els.emptyPreview.classList.toggle('visible', !hasCode);
      els.previewFrameWrapper.classList.toggle('hidden', !hasCode);
      els.previewRefreshLine.classList.toggle('hidden', !hasCode);
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => { });
    } else {
      document.exitFullscreen().catch(() => { });
    }
  }

  function setupDragAndDrop() {
    const target = els.monacoEditor;
    if (!target) return;
    const addDrag = () => target.classList.add('dragging');
    const removeDrag = () => target.classList.remove('dragging');
    ['dragenter', 'dragover'].forEach(evt => {
      target.addEventListener(evt, e => {
        e.preventDefault();
        addDrag();
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      target.addEventListener(evt, e => {
        e.preventDefault();
        removeDrag();
      });
    });
    target.addEventListener('drop', e => {
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        setEditorValue(ev.target.result || '');
        updatePreview(true);
        scheduleValidation();
      };
      reader.readAsText(file);
    });
  }

  function deriveFilenameFromTitle(code) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(code, 'text/html');
      const title = doc.querySelector('title');
      const raw = title ? title.textContent.trim() : '';
      const safe = raw.replace(/[\\\/:*?"<>|]/g, '_') || 'index';
      return `${safe}.html`;
    } catch (e) {
      return 'index.html';
    }
  }

  function replaceCurrentMatch() {
    if (!editor || !state.searchQuery) {
      showToast('Nothing to replace');
      return;
    }
    if (state.searchMatches.length === 0) {
      performSearch();
      if (state.searchMatches.length === 0) return;
    }
    const model = editor.getModel();
    if (!model) return;
    const range = state.searchMatches[state.searchCurrentIndex];
    model.pushEditOperations([], [{ range, text: state.replaceValue }], () => null);
    performSearch();
  }

  function replaceAllMatches() {
    if (!editor || !state.searchQuery) {
      showToast('Nothing to replace');
      return;
    }
    const model = editor.getModel();
    if (!model) return;
    const matches = model.findMatches(state.searchQuery, true, false, false, null, true);
    if (matches.length === 0) {
      showToast('No matches found');
      return;
    }
    const edits = matches.map(m => ({ range: m.range, text: state.replaceValue }));
    model.pushEditOperations([], edits, () => null);
    performSearch();
  }

  function clearValidationDecorations() {
    state.urlValidations = {};
    if (editor) {
      linkDecorations = editor.deltaDecorations(linkDecorations, []);
    }
    updateValidationDisplay(0, 0, 0);
  }

  function scheduleValidation() {
    if (!state.settings.validation || !state.isOnline) {
      clearTimeout(validationTimer);
      clearValidationDecorations();
      return;
    }
    clearTimeout(validationTimer);
    validationTimer = setTimeout(() => validateURLs(getCode()), 400);
  }

  async function validateURLs(code) {
    if (!editor || !state.settings.validation) return;
    const monaco = window.monaco;
    const model = editor.getModel();
    if (!monaco || !model) return;
    if (!state.isOnline) {
      clearValidationDecorations();
      return;
    }

    const regex = /https?:\/\/[^\s"'<>)]+/g;
    const entries = [];
    let match;
    while ((match = regex.exec(code)) !== null) {
      const startPos = model.getPositionAt(match.index);
      const endPos = model.getPositionAt(match.index + match[0].length);
      const range = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
      entries.push({ url: match[0], range });
    }

    const uniqueUrls = Array.from(new Set(entries.map(e => e.url)));
    const results = {};
    await Promise.all(uniqueUrls.map(async url => {
      results[url] = await validateURL(url);
    }));
    state.urlValidations = results;

    applyUrlDecorations(entries);
    updateValidationCounts();
  }

  async function validateURL(url) {
    if (!state.isOnline) {
      return { status: 'inconclusive', time: null };
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const startTime = Date.now();
      const res = await fetch(url, { method: 'HEAD', mode: 'cors', cache: 'no-cache', signal: controller.signal });
      clearTimeout(timeoutId);
      const time = Date.now() - startTime;
      if (res.ok || res.type === 'opaque') {
        return { status: 'valid', time };
      }
      return { status: 'invalid', time };
    } catch (e) {
      return { status: 'warn', time: null };
    }
  }

  function applyUrlDecorations(entries) {
    if (!editor || !window.monaco) return;
    const decorations = entries.map(entry => {
      const statusObj = state.urlValidations[entry.url] || { status: 'pending' };
      let inlineClassName = 'deco-link-warn';
      let hover = 'Pending validation';
      if (statusObj.status === 'valid') {
        inlineClassName = 'deco-link-valid';
        hover = 'Link active';
      } else if (statusObj.status === 'invalid') {
        inlineClassName = 'deco-link-error';
        hover = 'Broken link';
      } else if (statusObj.status === 'warn' || statusObj.status === 'inconclusive') {
        inlineClassName = 'deco-link-warn';
        hover = 'Unverified';
      }
      return { range: entry.range, options: { inlineClassName, hoverMessage: { value: hover } } };
    });
    linkDecorations = editor.deltaDecorations(linkDecorations, decorations);
  }

  function updateValidationCounts() {
    let valid = 0, invalid = 0, pending = 0;
    Object.values(state.urlValidations).forEach(v => {
      if (v.status === 'valid') valid++;
      else if (v.status === 'invalid') invalid++;
      else pending++;
    });
    updateValidationDisplay(valid, invalid, pending);
  }

  function updateValidationDisplay(valid, invalid, pending) {
    if (!els.validCount || !els.invalidCount || !els.pendingCount) return;
    els.validCount.querySelector('span').textContent = valid;
    els.invalidCount.querySelector('span').textContent = invalid;
    els.pendingCount.querySelector('span').textContent = pending;

    els.validCount.classList.toggle('hidden', valid === 0);
    els.invalidCount.classList.toggle('hidden', invalid === 0);
    els.pendingCount.classList.toggle('hidden', pending === 0);
  }

  function getEditorFontSize() {
    if (mobileQuery.matches) {
      return Math.max(state.settings.fontSize, MIN_MOBILE_FONT_SIZE);
    }
    return state.settings.fontSize;
  }

  function getEffectiveLayout() {
    if (mobileQuery.matches && state.layout === 'horizontal') {
      return 'vertical';
    }
    return state.layout;
  }

  function syncLayoutButtons(layout) {
    document.querySelectorAll('.layout-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`[data-layout="${layout}"]`);
    if (activeBtn) activeBtn.classList.add('active');
  }

  function setLayout(layout) {
    state.layout = layout;
    if (mobileQuery.matches && (layout === 'editor' || layout === 'preview')) {
      state.mobilePane = layout;
    }
    applyLayout();
    try { localStorage.setItem(STORAGE_KEYS.LAYOUT, state.layout); } catch (e) { }
  }

  function setMobilePane(pane) {
    state.mobilePane = pane === 'preview' ? 'preview' : 'editor';
    applyMobilePane();
  }

  function applyMobilePane() {
    els.workspace.classList.toggle('mobile-pane-editor', state.mobilePane === 'editor');
    els.workspace.classList.toggle('mobile-pane-preview', state.mobilePane === 'preview');
    if (mobileQuery.matches) {
      syncLayoutButtons(state.mobilePane);
    }
    document.querySelectorAll('.mobile-pane-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pane === state.mobilePane);
    });
    if (!mobileQuery.matches) return;
    els.editorPanel.style.display = state.mobilePane === 'editor' ? 'flex' : 'none';
    els.previewPanel.style.display = state.mobilePane === 'preview' ? 'flex' : 'none';
    els.dividerHandle.style.display = 'none';
    if (state.mobilePane === 'preview') {
      updatePreview(true);
    } else {
      refreshEditorForViewport();
    }
  }

  function applyLayout() {
    const layout = getEffectiveLayout();
    const isMobile = mobileQuery.matches;
    const layoutForButtons = isMobile ? state.mobilePane : layout;
    syncLayoutButtons(layoutForButtons);
    els.workspace.classList.remove('vertical', 'mobile-pane-editor', 'mobile-pane-preview');
    els.editorPanel.style.display = 'flex';
    els.previewPanel.style.display = 'flex';
    els.dividerHandle.style.display = 'flex';
    if (isMobile) {
      els.editorPanel.style.flex = '1';
      els.previewPanel.style.flex = '1';
      els.dividerHandle.style.display = 'none';
      applyMobilePane();
      return;
    }
    switch (layout) {
      case 'horizontal':
        applyRatio();
        break;
      case 'vertical':
        els.workspace.classList.add('vertical');
        applyRatio();
        break;
      case 'editor':
        els.previewPanel.style.display = 'none';
        els.dividerHandle.style.display = 'none';
        els.editorPanel.style.flex = '1';
        break;
      case 'preview':
        els.editorPanel.style.display = 'none';
        els.dividerHandle.style.display = 'none';
        els.previewPanel.style.flex = '1';
        break;
    }
  }

  function refreshEditorForViewport() {
    if (!editor) return;
    editor.updateOptions({ fontSize: getEditorFontSize() });
    editor.layout();
  }

  function applyRatio() {
    els.editorPanel.style.flex = `0 0 ${state.ratio}%`;
    els.previewPanel.style.flex = `0 0 ${100 - state.ratio}%`;
  }

  function saveRatio() {
    try { localStorage.setItem(STORAGE_KEYS.RATIO, state.ratio.toString()); } catch (e) { }
  }

  function cycleSyncMode() {
    const modes = ['realtime', 'paused', 'manual'];
    const currentIndex = modes.indexOf(state.settings.syncMode);
    state.settings.syncMode = modes[(currentIndex + 1) % modes.length];
    updateSyncDisplay();
    persistSettings();
  }

  function updateSyncDisplay() {
    const pauseLabel = formatDelayLabel(state.settings.pauseDelay || 1000);
    const mode = state.settings.syncMode;
    const modeLabel = mode === 'realtime' ? 'Realtime' : mode === 'paused' ? `On Pause (${pauseLabel})` : 'Manual';
    els.syncLabel.textContent = modeLabel;
    els.syncDot.className = 'sync-dot';
    if (mode === 'paused') els.syncDot.classList.add('paused');
    if (mode === 'manual') els.syncDot.classList.add('manual');
  }

  async function formatCode() {
    const code = getCode();
    if (!code.trim()) {
      showToast('Nothing to format');
      return;
    }
    if (editor && editor.getAction) {
      const action = editor.getAction('editor.action.formatDocument');
      if (action) {
        await action.run();
        showToast('Code formatted');
        return;
      }
    }

    // Fallback formatter
    let formatted = '';
    let indent = 0;
    const tabStr = ' '.repeat(state.settings.tabSize);
    const tokens = code.replace(/>\s+</g, '><').trim().split(/(<\/?[^>]+>)/g).filter(t => t.trim());
    const selfClosing = ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr', '!doctype'];

    tokens.forEach(token => {
      if (token.startsWith('</')) {
        indent = Math.max(0, indent - 1);
        formatted += tabStr.repeat(indent) + token + '\n';
      } else if (token.startsWith('<')) {
        const tagMatch = token.match(/<[!]?(\w+)/i);
        const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';
        const isSelfClose = selfClosing.includes(tagName) || token.endsWith('/>');
        formatted += tabStr.repeat(indent) + token + '\n';
        if (!isSelfClose && !token.includes('</') && tagName !== '!doctype') {
          indent++;
        }
      } else {
        const text = token.trim();
        if (text) {
          formatted += tabStr.repeat(indent) + text + '\n';
        }
      }
    });

    setEditorValue(formatted.trim());
    showToast('Code formatted');
  }

  function selectAllCode() {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    editor.setSelection(model.getFullModelRange());
    editor.focus();
  }

  function undoEdit() {
    if (!editor) return;
    editor.trigger('toolbar', 'undo');
  }

  function redoEdit() {
    if (!editor) return;
    editor.trigger('toolbar', 'redo');
  }

  function downloadHTML() {
    const code = getCode();
    if (!code.trim()) {
      showToast('Nothing to download');
      return;
    }
    const filename = deriveFilenameFromTitle(code);
    const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('HTML downloaded');
  }

  function copyToClipboard() {
    const code = getCode();
    if (!code.trim()) {
      showToast('Nothing to copy');
      return;
    }
    const performSuccess = () => {
      showToast('Copied to clipboard');
      const btn = getEl('copyBtn');
      if (!btn) return;
      const originalSvg = btn.innerHTML;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
      setTimeout(() => { btn.innerHTML = originalSvg; }, 1500);
    };

    if (navigator.clipboard && window.isSecureContext !== false) {
      navigator.clipboard.writeText(code).then(performSuccess).catch(() => fallbackCopy(code, performSuccess));
    } else {
      fallbackCopy(code, performSuccess);
    }
  }

  function fallbackCopy(text, onSuccess) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
      if (onSuccess) onSuccess();
    } catch (e) {
      showToast('Failed to copy', 'error');
    }
    document.body.removeChild(textarea);
  }

  function openFullTab() {
    const code = getCode();
    if (!code.trim()) {
      showToast('Nothing to preview');
      return;
    }
    els.previewFrameWrapper.style.transform = 'scale(0.95)';
    els.previewFrameWrapper.style.opacity = '0.8';
    setTimeout(() => {
      els.previewFrameWrapper.style.transform = '';
      els.previewFrameWrapper.style.opacity = '';
    }, 300);
    const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  function openModal(type) {
    if (type === 'settings') {
      els.settingsModal.classList.add('visible');
      loadSettingsUI();
    } else if (type === 'templates') {
      els.templatesModal.classList.add('visible');
    }
  }

  function closeModal(type) {
    if (type === 'settings') {
      els.settingsModal.classList.remove('visible');
    } else if (type === 'templates') {
      els.templatesModal.classList.remove('visible');
    }
  }

  function clampPauseDelay(value) {
    const n = parseInt(value, 10);
    if (Number.isNaN(n)) return 1000;
    return Math.max(300, Math.min(5000, n));
  }

  function formatDelayLabel(ms) {
    if (ms >= 1000) {
      const seconds = ms / 1000;
      return `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
    }
    return `${ms}ms`;
  }

  function updatePauseDelayVisibility(mode) {
    const row = getEl('pauseDelayRow');
    if (!row) return;
    row.classList.toggle('visible', mode === 'paused');
  }

  function updatePauseDelayValueDisplay(value) {
    const label = getEl('pauseDelayValue');
    if (!label) return;
    const parsed = clampPauseDelay(value);
    label.textContent = formatDelayLabel(parsed);
  }

  function updateMinimapWidthValueDisplay(value) {
    const label = getEl('minimapWidthValue');
    if (!label) return;
    const parsed = clampMinimapWidth(value);
    label.textContent = `${parsed}px`;
  }

  function syncMinimapControls() {
    const toggle = getEl('minimapToggle');
    const slider = getEl('minimapWidthSlider');
    const valueLabel = getEl('minimapWidthValue');
    const enabled = toggle ? toggle.classList.contains('active') : true;
    if (slider) {
      slider.disabled = !enabled;
      slider.classList.toggle('disabled', !enabled);
    }
    if (valueLabel) {
      valueLabel.style.opacity = enabled ? '1' : '0.5';
    }
  }

  function loadSettingsUI() {
    const lineNumbersToggle = getEl('lineNumbersToggle');
    if (lineNumbersToggle) {
      lineNumbersToggle.classList.toggle('active', state.settings.lineNumbers);
    }
    if (els.minimapToggle) {
      els.minimapToggle.classList.toggle('active', state.settings.minimapEnabled);
    }
    const fontSizeSelect = getEl('fontSizeSelect');
    if (fontSizeSelect) fontSizeSelect.value = state.settings.fontSize;
    const tabSizeSelect = getEl('tabSizeSelect');
    if (tabSizeSelect) tabSizeSelect.value = state.settings.tabSize;
    const syncModeSelect = getEl('syncModeSelect');
    if (syncModeSelect) syncModeSelect.value = state.settings.syncMode;
    const validationToggle = getEl('validationToggle');
    if (validationToggle) {
      validationToggle.classList.toggle('active', state.settings.validation);
    }
    const pauseDelay = clampPauseDelay(state.settings.pauseDelay || 1000);
    const slider = getEl('pauseDelaySlider');
    if (slider) slider.value = pauseDelay;
    updatePauseDelayValueDisplay(pauseDelay);
    updatePauseDelayVisibility(state.settings.syncMode);
    const minimapWidth = clampMinimapWidth(state.settings.minimapWidth || 100);
    const minimapSlider = getEl('minimapWidthSlider');
    if (minimapSlider) minimapSlider.value = minimapWidth;
    updateMinimapWidthValueDisplay(minimapWidth);
    syncMinimapControls();
    updateThemeUI(state.settings.theme);
  }

  function persistSettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
    } catch (e) { }
  }

  function saveSettings() {
    const lineNumbersToggle = getEl('lineNumbersToggle');
    if (lineNumbersToggle) {
      state.settings.lineNumbers = lineNumbersToggle.classList.contains('active');
    }
    const minimapToggle = getEl('minimapToggle');
    if (minimapToggle) {
      state.settings.minimapEnabled = minimapToggle.classList.contains('active');
    }
    const fontSizeSelect = getEl('fontSizeSelect');
    if (fontSizeSelect) {
      state.settings.fontSize = parseInt(fontSizeSelect.value, 10);
    }
    const tabSizeSelect = getEl('tabSizeSelect');
    if (tabSizeSelect) {
      state.settings.tabSize = parseInt(tabSizeSelect.value, 10);
    }
    const syncModeSelect = getEl('syncModeSelect');
    if (syncModeSelect) {
      state.settings.syncMode = syncModeSelect.value;
    }
    const pauseDelaySlider = getEl('pauseDelaySlider');
    if (pauseDelaySlider) {
      state.settings.pauseDelay = clampPauseDelay(pauseDelaySlider.value);
    }
    const validationToggle = getEl('validationToggle');
    if (validationToggle) {
      state.settings.validation = validationToggle.classList.contains('active');
    }
    const minimapWidthSlider = getEl('minimapWidthSlider');
    if (minimapWidthSlider) {
      state.settings.minimapWidth = clampMinimapWidth(minimapWidthSlider.value);
    }
    if (els.themeSelect) {
      state.settings.theme = getThemeById(els.themeSelect.value).id;
    }
    applySettings();
    persistSettings();
    closeModal('settings');
    showToast('Settings saved');
  }

  function applySettings() {
    if (editor) {
      editor.updateOptions({
        fontSize: getEditorFontSize(),
        tabSize: state.settings.tabSize,
        lineNumbers: state.settings.lineNumbers ? 'on' : 'off',
        minimap: buildMinimapOptions()
      });
    }
    state.settings.pauseDelay = clampPauseDelay(state.settings.pauseDelay || 1000);
    state.settings.minimapWidth = clampMinimapWidth(state.settings.minimapWidth || 140);
    syncMinimapControls();
    updateSyncDisplay();
    applyTheme(state.settings.theme, { skipAnimation: true, persist: false });
    if (!state.settings.validation || !state.isOnline) {
      clearValidationDecorations();
    } else if (state.settings.validation) {
      scheduleValidation();
    }
  }

  async function applyTemplate(templateName) {
    isApplyingTemplate = true;
    try {
      // this is just a workaround for the basic template to ensure the script is present. Fix later.
      let template = await loadTemplate(templateName);
      if (templateName === 'basic' && !template.includes("I'm working!")) {
        const scriptBlock = "\n  <script>\n    // Basic template sanity check\n    console.log(\"I'm working!\");\n  </script>\n";
        if (template.includes('</body>')) {
          template = template.replace('</body>', `${scriptBlock}</body>`);
        } else {
          template += `${scriptBlock}</body>`;
        }
      }
      setEditorValue(template);
      state.code = template;
      clearTimeout(previewTimer);
      clearTimeout(validationTimer);
      updatePreview(true);
      scheduleValidation();
      closeModal('templates');
      showToast('Template applied');
    } catch (e) {
      showToast('Could not load template', 'error');
      console.error(e);
    } finally {
      isApplyingTemplate = false;
    }
  }

  function openClearModal() {
    if (els.clearModal) els.clearModal.classList.add('visible');
  }

  function closeClearModal() {
    if (els.clearModal) els.clearModal.classList.remove('visible');
  }

  function clearEditor(clearCache = false) {
    setEditorValue('');
    clearValidationDecorations();
    updatePreview(true);
    scheduleValidation();
    clearConsoleLogs();
    if (clearCache) {
      try { localStorage.removeItem(STORAGE_KEYS.CODE); } catch (e) { }
      if (els.lastSaved) els.lastSaved.textContent = 'Not saved';
      showToast('Editor and cache cleared');
    } else {
      showToast('Editor cleared');
    }
    closeClearModal();
  }

  function clearCache() {
    try {
      localStorage.clear();
      state.urlValidations = {};
      state.lastSaved = null;
      state.settings = { lineNumbers: true, fontSize: 14, tabSize: 2, syncMode: 'realtime', pauseDelay: 1000, validation: true, theme: getDefaultThemeId(), minimapEnabled: true, minimapWidth: 100 };
      state.layout = 'horizontal';
      state.ratio = 55;
      applySettings();
      applyLayout();
      if (els.lastSaved) els.lastSaved.textContent = 'Not saved';
      linkDecorations = editor ? editor.deltaDecorations(linkDecorations, []) : [];
      clearConsoleLogs();
      showToast('Cache cleared');
    } catch (e) {
      showToast('Could not clear cache', 'error');
    }
  }

  function startAutoSave() {
    clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(() => {
      const currentCode = getCode();
      if (currentCode) {
        state.code = currentCode;
        saveToStorage();
      }
    }, 15000);
  }

  function saveToStorage() {
    try {
      const code = getCode();
      state.code = code;
      localStorage.setItem(STORAGE_KEYS.CODE, code);
      state.lastSaved = new Date();
      els.lastSaved.textContent = 'Saved ' + state.lastSaved.toLocaleTimeString();
    } catch (e) {
      els.lastSaved.textContent = 'Save failed';
    }
  }

  function showToast(message, type = 'success') {
    if (!els.toast || !els.toastMessage) return;
    const variant = TOAST_ICONS[type] ? type : 'success';
    els.toastMessage.textContent = message;
    els.toast.dataset.type = variant;
    const icon = els.toastIcon || els.toast.querySelector('.toast-icon');
    if (icon) {
      icon.innerHTML = TOAST_ICONS[variant];
    }
    els.toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('visible'), 3000);
  }

  function updateOnlineStatus() {
    if (state.isOnline) {
      els.connectionDot.classList.remove('offline');
      els.connectionDot.classList.add('online');
      els.connectionStatus.textContent = 'Online';
      els.offlineIndicator.classList.remove('visible');
      if (state.settings.validation) {
        scheduleValidation();
      }
    } else {
      els.connectionDot.classList.remove('online');
      els.connectionDot.classList.add('offline');
      els.connectionStatus.textContent = 'Offline';
      els.offlineIndicator.classList.add('visible');
      clearValidationDecorations();
    }
  }

  const startApp = () => init().catch(err => console.error('Failed to start sslaxhtml', err));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }
})();
