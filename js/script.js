function generateHighResIconMeta(urlString) {
    try {
        const urlObj = typeof urlString === 'string' ? new URL(urlString) : urlString;
        const hostname = urlObj.hostname;
        const encodedHostname = encodeURIComponent(hostname);
        const origin = urlObj.origin;
        const encodedOrigin = encodeURIComponent(origin);

        // Fallback static candidates used for default bookmark creation
        // (synchronous — no network). The async fetchIconCandidates will
        // produce a much richer list when the user edits a bookmark.
        const candidates = [
            `${origin}/apple-touch-icon.png`,
            `${origin}/apple-touch-icon-precomposed.png`,
            `https://www.google.com/s2/favicons?domain=${encodedHostname}&sz=256`,
            `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodedOrigin}&size=256`,
            `https://www.google.com/s2/favicons?domain=${encodedHostname}&sz=128`,
            `${origin}/android-chrome-192x192.png`,
            `${origin}/android-chrome-512x512.png`,
            `${origin}/favicon.png`,
            `${origin}/favicon.ico`,
            `${origin}/favicon.svg`,
            `https://icons.duckduckgo.com/ip3/${hostname}.ico`
        ];

        return {
            icon: candidates[0],
            iconFallbacks: candidates.slice(1)
        };
    } catch (error) {
        return {
            icon: 'icons/default.svg',
            iconFallbacks: []
        };
    }
}

function createDefaultBookmark(id, title, url) {
    const iconMeta = generateHighResIconMeta(url);
    return {
        id,
        title,
        url,
        iconType: 'favicon',
        icon: iconMeta.icon,
        iconFallbacks: iconMeta.iconFallbacks
    };
}

const LOCAL_ONLY_MODE = true;

const STORAGE_MODES = {
    BROWSER: 'browser'
};

const STORAGE_KEYS = {
    DATA: 'MyLocalNewTabData',
    SETTINGS: 'MyLocalNewTabSettings',
    // 兼容历史版本：旧版本可能把背景图拆分到单独 key 中
    BACKGROUND_IMAGE: 'MyLocalNewTabBgImage'
};

const DEFAULT_BACKGROUND = {
    image: '',
    source: '',
    opacity: 0.7
};

const DEFAULT_SETTINGS = {
    storageMode: STORAGE_MODES.BROWSER,
    searchEngine: 'google',
    background: JSON.parse(JSON.stringify(DEFAULT_BACKGROUND)),
    uiOpacity: 1,
    customDomain: ''
};

const DEFAULT_SWATCH_COLOR = '#4ac55c';
const NETWORK_FETCH_TIMEOUT = 12000;
const LEGACY_BG_PLACEHOLDER = 'Check_STORAGE_KEYS_BACKGROUND_IMAGE';

const IMPORT_SOURCES = {
    EDGE_TAB: 'MyLocalNewTab',
    WETAB: 'wetab',
    EDGE_BOOKMARK: 'edge_bookmark',
    SAFARI_BOOKMARK: 'safari_bookmark'
};

const IMPORT_MODES = {
    MERGE: 'merge',
    OVERWRITE: 'overwrite'
};

const CACHE_KEYS = {
    ICONS: 'MyLocalNewTabIconCache'
};

const MAX_CACHED_ICON_BYTES = 500 * 1024;
const DEFAULT_EXTERNAL_FETCH_MAX_BYTES = 30 * 1024 * 1024;
const DEFAULT_EXTERNAL_TEXT_FETCH_MAX_BYTES = 1024 * 1024;
const LOCAL_ASSET_PATH_PATTERN = /^\/assets\/[0-9a-f]{32}(?:\.[a-z0-9]{1,8})?$/i;

/**
 * 获取 API 基础 URL。
 * 如果设置了自定义域名则使用该域名，否则返回空字符串（使用当前 origin）。
 */
function getApiBaseUrl() {
    const domain = (typeof appSettings !== 'undefined' && appSettings && appSettings.customDomain) || '';
    if (!domain) return '';
    // 去除末尾斜杠
    return domain.replace(/\/+$/, '');
}

/**
 * 将相对路径 API 地址解析为完整 URL。
 * 如果设置了自定义域名则拼接完整地址，否则保留相对路径。
 */
function resolveApiUrl(path) {
    const base = getApiBaseUrl();
    if (!base) return path;
    // 确保 path 以 / 开头
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    return base + normalizedPath;
}

/**
 * 将 /assets/ 相对路径解析为完整 URL（用于资源展示）。
 * 仅当设置了自定义域名且路径是本地资源路径时才拼接。
 */
function resolveAssetDisplayUrl(path) {
    if (!path || typeof path !== 'string') return path;
    const normalized = normalizePersistedAssetUrl(path);
    if (isPersistedAssetPath(normalized)) {
        return resolveApiUrl(normalized);
    }
    return normalized;
}

function clamp01(value, fallback = 0) {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (!Number.isFinite(num)) return fallback;
    if (num > 1) return 1;
    if (num < 0) return 0;
    return num;
}

function isPersistedAssetPath(path = '') {
    if (!path || typeof path !== 'string') return false;
    const plainPath = path.split('?')[0].split('#')[0];
    return LOCAL_ASSET_PATH_PATTERN.test(plainPath);
}

function isPersistedAssetReference(value = '') {
    if (!value || typeof value !== 'string') return false;
    if (isPersistedAssetPath(value)) return true;
    try {
        const parsed = new URL(value);
        return isPersistedAssetPath(`${parsed.pathname}${parsed.search}`);
    } catch (error) {
        return false;
    }
}

function normalizePersistedAssetUrl(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';

    if (isPersistedAssetPath(trimmed)) {
        return trimmed.split('#')[0];
    }

    try {
        const parsed = new URL(trimmed);
        if (isPersistedAssetPath(parsed.pathname)) {
            // Keep persisted local assets host-agnostic for cross-device sync.
            return `${parsed.pathname}${parsed.search}`;
        }
    } catch (error) {
        // Keep non-URL strings as-is.
    }

    return trimmed;
}

function normalizeBackgroundSettings(raw = {}) {
    const merged = { ...DEFAULT_BACKGROUND, ...(raw || {}) };
    const imageRaw = typeof merged.image === 'string' ? merged.image : '';
    const image = normalizePersistedAssetUrl(imageRaw);
    const source = typeof merged.source === 'string'
        ? merged.source.trim()
        : (typeof merged.sourceUrl === 'string' ? merged.sourceUrl.trim() : '');
    const normalizedSource = source || (
        image && !isPersistedAssetReference(image) && !image.startsWith('data:')
            ? image
            : ''
    );
    return {
        image: image === LEGACY_BG_PLACEHOLDER ? '' : image,
        source: normalizedSource,
        opacity: clamp01(merged.opacity, DEFAULT_BACKGROUND.opacity)
    };
}

function normalizeUiOpacity(value) {
    return clamp01(value ?? DEFAULT_SETTINGS.uiOpacity, DEFAULT_SETTINGS.uiOpacity);
}

function getUiOpacity(value = appSettings.uiOpacity) {
    return normalizeUiOpacity(value);
}

function applyUiOpacity(value = appSettings.uiOpacity) {
    const opacity = normalizeUiOpacity(value);
    appSettings.uiOpacity = opacity;
    const root = document.documentElement;
    if (root) {
        root.style.setProperty('--ui-opacity', opacity);
    }
    return opacity;
}

function mergeSettingsWithDefaults(raw = {}) {
    const base = raw && typeof raw === 'object' ? raw : {};
    const background = normalizeBackgroundSettings(base.background);
    const merged = {
        ...DEFAULT_SETTINGS,
        ...base,
        uiOpacity: normalizeUiOpacity(base.uiOpacity),
        background,
        customDomain: typeof base.customDomain === 'string' ? base.customDomain.trim() : ''
    };
    merged.storageMode = STORAGE_MODES.BROWSER;
    return merged;
}

function isRemoteMode(mode) {
    return false;
}

function getEffectiveStorageMode() {
    return STORAGE_MODES.BROWSER;
}

function isRemoteBackgroundReady() {
    return false;
}

// 默认数据
// 优化深拷贝函数
function deepClone(obj) {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(obj);
        } catch (e) {
            // 某些对象无法被 structuredClone，回退到 JSON 方式
        }
    }
    return JSON.parse(JSON.stringify(obj));
}

const DEFAULT_DATA = {
    categories: [
        { 
            id: 'cat_default', 
            name: '常用', 
            bookmarks: [
                createDefaultBookmark('bm_1', 'Google', 'https://www.google.com'),
                createDefaultBookmark('bm_2', 'Bilibili', 'https://www.bilibili.com'),
                createDefaultBookmark('bm_3', 'GitHub', 'https://github.com')
            ] 
        }
    ],
    activeCategory: 'cat_default',
    background: normalizeBackgroundSettings(DEFAULT_BACKGROUND),
    uiOpacity: DEFAULT_SETTINGS.uiOpacity
};

let appData = deepClone(DEFAULT_DATA);
let appSettings = { ...DEFAULT_SETTINGS };
let iconCache = {};
let autoIconCandidates = [];
let selectedAutoIcon = null;
let selectedCustomIconSrc = '';
let customIconMode = 'upload';
let pendingAutoIconSelectionSrc = null;
let lastAutoIconUrl = '';
let isFetchingAutoIcons = false;
const DRAG_LONG_PRESS_MS = 90; // 调优为 90ms，提供更灵敏的选中体验
const TOUCH_LONGPRESS_MS = 500; // 触屏长按阈值（弹出操作菜单）
let isFormSubmitting = false; // 表单提交锁，防止重复提交
const dragState = {
    timerId: null,
    draggingId: null,
    sourceCategoryId: null,
    sourceFolderId: null,
    placeholder: null,
    activeContainer: null,
    hoverTargetId: null,
    hoverStartTs: 0,
    mergeIntent: false,
    dropHandled: false,
    lastPlaceholderTargetId: null,
    lastPlaceholderBefore: null,
    lastPlaceholderContainer: null,
    lastPlaceholderMoveTs: 0,
    mergeLockTargetId: null,
    mergeLockUntil: 0,
    lastPosition: { x: 0, y: 0 }
};
const categoryDragState = {
    timerId: null,
    draggingId: null,
    placeholder: null,
    dropHandled: false
};
const modalState = {
    editingId: null,
    type: 'link',
    originCategoryId: null,
    originFolderId: null,
    originIndex: -1,
    targetCategoryId: null,
    targetFolderId: null,
    lockType: false
};
let openFolderId = null;
let openFolderCategoryId = null;
const modalAnimations = new WeakMap();
const modalAnchors = new WeakMap();
let folderAnchorSnapshot = {
    folderId: null,
    rect: null,
    element: null
};

// 批量选择相关状态
const batchSelectState = {
    enabled: false,
    selectedIds: new Set(),
    categoryId: null,
    folderId: null
};

// ======================== 自定义确认弹窗 ========================
function showConfirmDialog(message, { title = '确认', confirmText = '确定', cancelText = '取消', danger = false } = {}) {
    return new Promise((resolve) => {
        // 移除可能存在的旧弹窗
        const old = document.getElementById('customConfirmOverlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'customConfirmOverlay';
        overlay.className = 'confirm-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';

        const titleEl = document.createElement('div');
        titleEl.className = 'confirm-title';
        titleEl.textContent = title;

        const msgEl = document.createElement('div');
        msgEl.className = 'confirm-message';
        msgEl.textContent = message;

        const actions = document.createElement('div');
        actions.className = 'confirm-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn-secondary';
        cancelBtn.textContent = cancelText;

        const confirmBtn = document.createElement('button');
        confirmBtn.className = danger ? 'btn-primary btn-danger' : 'btn-primary';
        confirmBtn.textContent = confirmText;

        const cleanup = (result) => {
            overlay.classList.add('closing');
            dialog.classList.add('closing');
            const onEnd = () => { overlay.remove(); resolve(result); };
            overlay.addEventListener('animationend', onEnd, { once: true });
            // fallback if animationend doesn't fire
            setTimeout(onEnd, 250);
        };

        cancelBtn.onclick = () => cleanup(false);
        confirmBtn.onclick = () => cleanup(true);
        overlay.addEventListener('pointerdown', (e) => {
            if (e.target === overlay) cleanup(false);
        });
        document.addEventListener('keydown', function handler(e) {
            if (e.key === 'Escape') { document.removeEventListener('keydown', handler); cleanup(false); }
            if (e.key === 'Enter') { document.removeEventListener('keydown', handler); cleanup(true); }
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        dialog.appendChild(titleEl);
        dialog.appendChild(msgEl);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // 自动聚焦确认按钮
        requestAnimationFrame(() => confirmBtn.focus());
    });
}

function syncThemeWithSystem() {
    if (!window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
        document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
    };
    applyTheme();
    if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', applyTheme);
    } else if (typeof media.addListener === 'function') {
        media.addListener(applyTheme);
    }
}

function escapeForSelector(value) {
    if (window.CSS && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return value ? value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') : '';
}

function findBookmarkCardElement(bookmarkId) {
    if (!bookmarkId) return null;
    try {
        const safeId = escapeForSelector(bookmarkId);
        return document.querySelector(`.bookmark-card[data-id="${safeId}"]`);
    } catch (error) {
        return null;
    }
}

function walkBookmarkNode(node, visitor) {
    if (!node) return;
    visitor(node);
    if (node.type === 'folder' && Array.isArray(node.children)) {
        node.children.forEach(child => walkBookmarkNode(child, visitor));
    }
}

function walkCategoryBookmarks(category, visitor) {
    if (!category || !Array.isArray(category.bookmarks)) return;
    category.bookmarks.forEach(bm => walkBookmarkNode(bm, visitor));
}

function normalizeFolderChildTitles(folderTitle, children, { clone = false } = {}) {
    if (!Array.isArray(children)) {
        return clone ? [] : false;
    }
    const prefix = folderTitle ? `${folderTitle} / ` : '';
    let changed = false;
    const target = clone ? children.map(child => child ? { ...child } : child) : children;
    if (prefix) {
        target.forEach(child => {
            if (!child || !child.title) return;
            if (child.title.startsWith(prefix)) {
                child.title = child.title.slice(prefix.length);
                changed = true;
            }
        });
    }
    return clone ? target : changed;
}

function measureOverlapRect(rectA, rectB) {
    const x1 = Math.max(rectA.left, rectB.left);
    const y1 = Math.max(rectA.top, rectB.top);
    const x2 = Math.min(rectA.right, rectB.right);
    const y2 = Math.min(rectA.bottom, rectB.bottom);
    const width = Math.max(0, x2 - x1);
    const height = Math.max(0, y2 - y1);
    return { width, height, area: width * height };
}

function shrinkRect(rect, ratio = 0.7) {
    const w = rect.width * ratio;
    const h = rect.height * ratio;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return {
        left: cx - w / 2,
        right: cx + w / 2,
        top: cy - h / 2,
        bottom: cy + h / 2,
        width: w,
        height: h
    };
}

function isPointInsideRect(point, rect) {
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

function getCategoryById(categoryId) {
    if (!appData || !Array.isArray(appData.categories)) return null;
    return appData.categories.find(cat => cat.id === categoryId);
}

function getActiveCategory() {
    return getCategoryById(appData.activeCategory);
}

function findBookmarkLocation(bookmarkId, data = appData) {
    if (!bookmarkId || !data || !Array.isArray(data.categories)) return null;
    for (const cat of data.categories) {
        const result = findInList(cat.bookmarks, bookmarkId, null);
        if (result) {
            return { ...result, category: cat, categoryId: cat.id };
        }
    }
    return null;

    function findInList(list, id, parentFolder) {
        if (!Array.isArray(list)) return null;
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (!item) continue;
            if (item.id === id) {
                return {
                    bookmark: item,
                    index: i,
                    listRef: list,
                    parentFolder,
                    parentFolderId: parentFolder ? parentFolder.id : null
                };
            }
            if (item.type === 'folder') {
                const nested = findInList(item.children, id, item);
                if (nested) return nested;
            }
        }
        return null;
    }
}

function getFolderDepth(folderId) {
    if (!folderId) return 0;
    let depth = 1;
    let loc = findBookmarkLocation(folderId);
    while (loc && loc.parentFolderId) {
        depth++;
        loc = findBookmarkLocation(loc.parentFolderId);
    }
    return depth;
}

function getBookmarkList(categoryId, folderId = null) {
    const cat = getCategoryById(categoryId);
    if (!cat) return null;
    if (!folderId) return cat.bookmarks;
    const folderLoc = findBookmarkLocation(folderId);
    if (folderLoc && folderLoc.categoryId === categoryId && folderLoc.bookmark.type === 'folder') {
        folderLoc.bookmark.children = Array.isArray(folderLoc.bookmark.children) ? folderLoc.bookmark.children : [];
        return folderLoc.bookmark.children;
    }
    return null;
}

function removeBookmarkAtLocation(location) {
    if (!location || !Array.isArray(location.listRef)) return null;
    const idx = location.listRef.findIndex(item => item && item.id === location.bookmark.id);
    if (idx === -1) return null;
    const [removed] = location.listRef.splice(idx, 1);
    return removed;
}

function removeBookmarkById(bookmarkId) {
    const loc = findBookmarkLocation(bookmarkId);
    if (!loc) return null;
    const removed = removeBookmarkAtLocation(loc);
    if (!removed) return null;
    return {
        bookmark: removed,
        categoryId: loc.categoryId,
        parentFolderId: loc.parentFolderId
    };
}

function checkAndRemoveEmptyFolder(folderId, categoryId) {
    if (!folderId) return;
    const folderLoc = findBookmarkLocation(folderId);
    if (!folderLoc || folderLoc.bookmark.type !== 'folder') return;
    
    const list = folderLoc.bookmark.children;
    if (!Array.isArray(list)) return;

    if (list.length === 0) {
        removeBookmarkById(folderId);
        if (openFolderId === folderId) {
            closeFolderModal();
        }
    } else if (list.length === 1) {
        const remainingBookmark = list[0];
        // 保留仅包含子文件夹的层级，避免拖入子文件夹后父级被解散导致视图闪退
        if (remainingBookmark && remainingBookmark.type === 'folder') {
            return;
        }
        // 文件夹仅剩一个图标时，自动解散文件夹
        if (folderLoc && Array.isArray(folderLoc.listRef)) {
            // 移除文件夹
            folderLoc.listRef.splice(folderLoc.index, 1);
            // 将剩余图标插入到原文件夹位置
            folderLoc.listRef.splice(folderLoc.index, 0, remainingBookmark);
            
            if (openFolderId === folderId) {
                closeFolderModal();
            }
        }
    }
}

function insertBookmarkToList(list, index, bookmark) {
    if (!Array.isArray(list) || !bookmark) return false;
    const safeIndex = Math.max(0, Math.min(index ?? list.length, list.length));
    list.splice(safeIndex, 0, bookmark);
    return true;
}

function moveBookmarkTo(bookmarkId, targetCategoryId, targetFolderId = null, targetIndex = null) {
    const removed = removeBookmarkById(bookmarkId);
    if (!removed) return false;
    const targetList = getBookmarkList(targetCategoryId, targetFolderId);
    if (!targetList) return false;
    const insertIndex = targetIndex === null || targetIndex === undefined ? targetList.length : targetIndex;
    insertBookmarkToList(targetList, insertIndex, removed.bookmark);
    
    if (removed.parentFolderId && (removed.parentFolderId !== targetFolderId || removed.categoryId !== targetCategoryId)) {
        checkAndRemoveEmptyFolder(removed.parentFolderId, removed.categoryId);
    }

    // 拖拽操作完成后立即保存，避免用户快速切换标签页时数据丢失
    saveData({ immediate: true });
    // 拖拽操作统一跳过全局刷新动画，仅在同列表时尝试 DOM 重用
    const isSameList = removed.categoryId === targetCategoryId && removed.parentFolderId === targetFolderId;
    
    const updateDOM = () => {
        renderApp({ skipAnimation: true, reorder: isSameList });
        refreshOpenFolderView({ skipAnimation: true, reorder: isSameList });
    };

    if (document.startViewTransition) {
        document.startViewTransition(updateDOM);
    } else {
        updateDOM();
    }
    
    return true;
}

let pendingStorageMode = STORAGE_MODES.BROWSER;
let pointerDownOutsideModal = false;
let pointerDownOnContextMenu = false;
const MOBILE_LAYOUT_BREAKPOINT = 768;
let isMobileSidebarOpen = false;
let responsiveLayoutFrame = null;

// DOM 元素
const els = {
    header: document.querySelector('header'),
    sidebar: document.getElementById('sidebarNav'),
    sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    searchInput: document.getElementById('searchInput'),
    searchEngineSelect: document.getElementById('searchEngineSelect'),
    categoryList: document.getElementById('categoryList'),
    addCategoryBtn: document.getElementById('addCategoryBtn'),
    bookmarkGrid: document.getElementById('bookmarkGrid'),
    
    // Modals
    bookmarkModal: document.getElementById('bookmarkModal'),
    categoryModal: document.getElementById('categoryModal'),
    settingsModal: document.getElementById('settingsModal'),
    
    // Forms
    bookmarkForm: document.getElementById('bookmarkForm'),
    categoryForm: document.getElementById('categoryForm'),
    
    // Form Inputs
    bookmarkTypeSwitch: document.getElementById('bookmarkTypeSwitch'),
    bookmarkTypeButtons: document.querySelectorAll('#bookmarkTypeSwitch .type-chip'),
    typeSections: document.querySelectorAll('.type-section'),
    bookmarkUrl: document.getElementById('bookmarkUrl'),
    bookmarkTitle: document.getElementById('bookmarkTitle'),
    bookmarkCategory: document.getElementById('bookmarkCategory'),
    categoryFormGroup: document.getElementById('categoryFormGroup'),
    iconPreview: document.getElementById('iconPreview'),
    customIconInput: document.getElementById('customIconInput'),
    customIconControls: document.getElementById('customIconControls'),
    customIconTabs: document.querySelectorAll('.custom-icon-tab'),
    customIconPanels: document.querySelectorAll('.custom-icon-panel'),
    swatchColor: document.getElementById('swatchColor'),
    swatchText: document.getElementById('swatchText'),
    swatchApplyBtn: document.getElementById('swatchApplyBtn'),
    toggleBgSettingsBtn: document.getElementById('toggleBgSettingsBtn'),
    bgSettingsPanel: document.getElementById('bgSettingsPanel'),
    bgLocalSection: document.getElementById('bgLocalSection'),
    bgModeTabs: document.querySelectorAll('.bg-mode-tab'),
    bgModePanels: document.querySelectorAll('.bg-mode-panel'),
    bgStatusTag: document.getElementById('bgStatusTag'),
    bgSourceTip: document.getElementById('bgSourceTip'),
    backgroundImageInput: document.getElementById('backgroundImageInput'),
    backgroundUrlInput: document.getElementById('backgroundUrlInput'),
    backgroundOpacity: document.getElementById('backgroundOpacity'),
    backgroundOpacityValue: document.getElementById('backgroundOpacityValue'),
    uiOpacity: document.getElementById('uiOpacity'),
    uiOpacityValue: document.getElementById('uiOpacityValue'),
    backgroundPreview: document.getElementById('backgroundPreview'),
    folderModal: document.getElementById('folderModal'),
    folderModalTitle: document.getElementById('folderModalTitle'),
    folderContent: document.getElementById('folderContent'),
    folderAddBtn: document.getElementById('folderAddBtn'),
    folderRenameBtn: document.getElementById('folderRenameBtn'),
    folderExitZone: document.getElementById('folderExitZone'),
    closeFolderBtn: document.getElementById('closeFolderBtn'),
    autoIconResults: document.getElementById('autoIconResults'),
    iconResultsGrid: document.getElementById('iconResultsGrid'),
    refreshIconsBtn: document.getElementById('refreshIconsBtn'),
    autoIconControls: document.getElementById('autoIconControls'),
    categoryName: document.getElementById('categoryName'),
    modalTitle: document.getElementById('modalTitle'),
    
    // Buttons
    cancelBookmarkBtn: document.getElementById('cancelBookmarkBtn'),
    cancelCategoryBtn: document.getElementById('cancelCategoryBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    applySettingsBtn: document.getElementById('applySettingsBtn'),
    exportDataBtn: document.getElementById('exportDataBtn'),
    clearBackgroundBtn: document.getElementById('clearBackgroundBtn'),
    
    // Radio
    iconTypeRadios: document.getElementsByName('iconType'),
    storageModeRadios: document.getElementsByName('storageMode'),

    // Inputs
    importDataInput: document.getElementById('importDataInput'),
    importSourceSelect: document.getElementById('importSource'),
    importModeSelect: document.getElementById('importMode'),

    // Info blocks
    browserStorageInfo: document.getElementById('browserStorageInfo'),

    // 自定义域名
    customDomainInput: document.getElementById('customDomainInput'),
    
    // 书签搜索
    bookmarkSearchInput: document.getElementById('bookmarkSearchInput'),
    clearBookmarkSearch: document.getElementById('clearBookmarkSearch'),
    searchResultsPanel: document.getElementById('searchResultsPanel'),
    searchResultsGrid: document.getElementById('searchResultsGrid'),
    searchResultsCount: document.getElementById('searchResultsCount'),

    // 图标缓存诊断
    iconCacheStatusText: document.getElementById('iconCacheStatusText'),
    retryUncachedIconsBtn: document.getElementById('retryUncachedIconsBtn'),
    uncachedIconList: document.getElementById('uncachedIconList')
};

function isMobileLayout() {
    return window.innerWidth < MOBILE_LAYOUT_BREAKPOINT;
}

function shouldEnableDragByPointerType(pointerType) {
    // iOS/iPadOS Safari 在 touch 指针下对 draggable 支持不稳定，
    // 会影响点击与滚动，触摸场景关闭拖拽激活，仅保留鼠标/触控笔。
    return pointerType === 'mouse' || pointerType === 'pen';
}

function updateMobileSidebarTopOffset() {
    const root = document.documentElement;
    if (!root) return;
    const defaultTop = 94;
    if (!els.header) {
        root.style.setProperty('--mobile-sidebar-top', `${defaultTop}px`);
        return;
    }
    const rect = els.header.getBoundingClientRect();
    const calculatedTop = Number.isFinite(rect.bottom)
        ? Math.max(defaultTop, Math.round(rect.bottom + 8))
        : defaultTop;
    root.style.setProperty('--mobile-sidebar-top', `${calculatedTop}px`);
}

function updateSidebarToggleButton() {
    if (!els.sidebarToggleBtn) return;
    const expanded = isMobileLayout() && isMobileSidebarOpen;
    els.sidebarToggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    els.sidebarToggleBtn.setAttribute('aria-label', expanded ? '收起分类栏' : '显示分类栏');
    els.sidebarToggleBtn.textContent = expanded ? '✕ 收起' : '☰ 分类';
}

function applyResponsiveSidebarState() {
    const mobile = isMobileLayout();
    if (!mobile) {
        isMobileSidebarOpen = false;
        document.body.classList.remove('sidebar-open');
    } else {
        document.body.classList.toggle('sidebar-open', isMobileSidebarOpen);
    }
    updateSidebarToggleButton();
}

function syncResponsiveLayout() {
    updateMobileSidebarTopOffset();
    applyResponsiveSidebarState();
}

function scheduleResponsiveLayoutSync() {
    if (responsiveLayoutFrame) return;
    responsiveLayoutFrame = requestAnimationFrame(() => {
        responsiveLayoutFrame = null;
        syncResponsiveLayout();
    });
}

function openMobileSidebar() {
    if (!isMobileLayout()) return;
    isMobileSidebarOpen = true;
    applyResponsiveSidebarState();
}

function closeMobileSidebar(options = {}) {
    const { focusToggle = false } = options;
    isMobileSidebarOpen = false;
    applyResponsiveSidebarState();
    if (focusToggle && els.sidebarToggleBtn) {
        els.sidebarToggleBtn.focus();
    }
}

function toggleMobileSidebar(forceOpen) {
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !isMobileSidebarOpen;
    if (nextOpen) {
        openMobileSidebar();
    } else {
        closeMobileSidebar();
    }
}

function setupLocalOnlyUi() {
    appSettings.storageMode = STORAGE_MODES.BROWSER;
    appSettings.background = normalizeBackgroundSettings(appSettings.background);

    const browserRadio = Array.from(els.storageModeRadios || []).find(r => r.value === STORAGE_MODES.BROWSER);
    if (browserRadio) {
        browserRadio.checked = true;
        browserRadio.disabled = false;
    }

    toggleSettingsSection(els.browserStorageInfo, true);

    if (els.bgSourceTip) {
        els.bgSourceTip.textContent = '本地模式：所有数据保存在当前网站的数据库中，可通过导出 JSON 迁移。';
    }
    if (els.applySettingsBtn) {
        els.applySettingsBtn.textContent = '保存';
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
});

async function initializeApp() {
    syncThemeWithSystem();
    
    // 并行加载所有本地数据（设置、历史背景图、缓存、数据）
    const localDataPromise = new Promise(resolve => {
        chrome.storage.local.get([
            STORAGE_KEYS.SETTINGS,
            STORAGE_KEYS.BACKGROUND_IMAGE,
            CACHE_KEYS.ICONS,
            STORAGE_KEYS.DATA
        ], resolve);
    });

    // 1. 等待本地数据加载
    const localResult = await localDataPromise;

    // 2. 初始化设置
    if (localResult[STORAGE_KEYS.SETTINGS]) {
        appSettings = mergeSettingsWithDefaults(localResult[STORAGE_KEYS.SETTINGS]);
    } else {
        appSettings = mergeSettingsWithDefaults();
    }
    appSettings = restoreLegacyBackgroundImage(appSettings, localResult[STORAGE_KEYS.BACKGROUND_IMAGE]);

    setupLocalOnlyUi();
    saveSettings();
    applyUiOpacity(appSettings.uiOpacity);
    
    pendingStorageMode = STORAGE_MODES.BROWSER;
    
    // 3. 初始化图标缓存
    const { cache: normalizedCache, changed: iconCacheChanged } = normalizeIconCacheMap(
        localResult[CACHE_KEYS.ICONS] || {}
    );
    iconCache = normalizedCache;
    if (iconCacheChanged) {
        saveIconCache();
    }

    // 4. 先用本地数据准备界面（但不渲染）
    const localSnapshot = localResult[STORAGE_KEYS.DATA];
    if (localSnapshot && Array.isArray(localSnapshot.categories)) {
        appData = localSnapshot;
        ensureActiveCategory();
    }

    // 每次新建标签页都重置到第一个分类
    if (appData.categories && appData.categories.length > 0) {
        appData.activeCategory = appData.categories[0].id;
    }

    // 5. 并行准备背景和渲染界面
    // 先渲染 DOM（但容器仍然透明）
    renderApp();
    if (els.searchEngineSelect) {
        els.searchEngineSelect.value = appSettings.searchEngine || 'google';
        updateSearchPlaceholder(appSettings.searchEngine || 'google');
    }
    setupEventListeners();
    syncResponsiveLayout();
    updateBackgroundControlsUI();

    // 6. 等待背景图准备完成
    await applyBackgroundFromSettings();

    // 7. 背景和内容同时淡入
    const container = document.querySelector('.container');
    if (container) {
        // 使用 requestAnimationFrame 确保浏览器已完成布局
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                container.classList.add('visible');
                // 同时为 body 添加背景淡入标记
                document.body.classList.add('bg-ready');
            });
        });
    }

    // 8. 图标缓存已在编辑时按需获取，无需批量预热
    if (LOCAL_ONLY_MODE) {
        setTimeout(() => {
            warmIconCacheForBookmarks().then(() => {
                // 预热完成后执行审计，检测仍未缓存的图标
                auditIconCacheStatus();
            });
        }, 600);
        // 启动时也做一次快速审计（预热之前），输出日志
        setTimeout(() => {
            auditIconCacheStatus();
        }, 100);
    }
}

// 静默同步背景，不重复加载已显示的背景
function maybeSyncBackgroundFromDataQuiet(data) {
    const bg = extractBackgroundFromData(data);
    if (!bg) return false;
    const current = normalizeBackgroundSettings(appSettings.background);
    const isSameBackground =
        current.image === bg.image &&
        current.source === bg.source &&
        current.opacity === bg.opacity;
    
    if (isSameBackground) {
        appSettings.background = normalizeBackgroundSettings({ ...current, ...bg });
        saveSettings();
        return false;
    }
    return maybeSyncBackgroundFromData(data, { saveSettingsFlag: true });
}

// 检查并同步最新数据（页面重新可见时调用）
async function checkAndSyncLatestData() {
    try {
        // 从本地存储读取最新数据
        const localSnapshot = await readLocalDataSnapshot();
        if (!localSnapshot || !Array.isArray(localSnapshot.categories)) {
            return;
        }
        
        // 比较数据是否有变化（使用更精确的比较）
        const currentDataHash = computeDataHash(appData);
        const localDataHash = computeDataHash(localSnapshot);
        
        if (currentDataHash !== localDataHash) {
            // 保留用户当前选择的分类（如果在新数据中仍然存在）
            const userSelectedCategory = appData.activeCategory;
            
            // 本地存储有更新的数据，更新内存并重新渲染
            appData = localSnapshot;
            ensureActiveCategory();
            // 保持当前活动分类，如果存在的话
            const currentActiveExists = appData.categories.some(c => c.id === userSelectedCategory);
            if (currentActiveExists) {
                appData.activeCategory = userSelectedCategory;
            } else if (appData.categories.length > 0) {
                appData.activeCategory = appData.categories[0].id;
            }
            renderApp({ skipAnimation: true });
            
            // 同步背景和 UI 透明度
            maybeSyncBackgroundFromDataQuiet(localSnapshot);
            maybeSyncUiOpacityFromData(localSnapshot, { saveSettingsFlag: true });
        }
        
    } catch (error) {
        console.warn('检查数据更新失败', error);
    }
}

// 计算数据哈希值用于快速比较
function computeDataHash(data) {
    if (!data) return '';
    try {
        // 只比较关键字段，忽略运行时状态
        const keyData = {
            categories: data.categories,
            activeCategory: data.activeCategory,
            // 包含背景相关字段，确保跨设备仅背景变更时也能被检测到
            background: normalizeBackgroundSettings(data.background),
            uiOpacity: normalizeUiOpacity(data.uiOpacity)
        };
        return JSON.stringify(keyData);
    } catch (e) {
        return '';
    }
}

function updateSearchPlaceholder(engine) {
    if (!els.searchInput) return;
    const names = {
        google: 'Google',
        bing: 'Bing',
        baidu: '百度',
        yahoo: 'Yahoo'
    };
    els.searchInput.placeholder = `搜索 ${names[engine] || '...'}`;
}

// --- 数据操作 ---

function restoreLegacyBackgroundImage(settings, legacyImage) {
    const mergedSettings = mergeSettingsWithDefaults(settings);
    const legacy = typeof legacyImage === 'string' ? legacyImage : '';
    if (!legacy) return mergedSettings;

    const background = normalizeBackgroundSettings(mergedSettings.background);
    const needsRestore = !background.image || background.image === LEGACY_BG_PLACEHOLDER;
    if (!needsRestore) {
        return mergedSettings;
    }

    return {
        ...mergedSettings,
        background: normalizeBackgroundSettings({
            ...background,
            image: legacy
        })
    };
}

async function loadSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.BACKGROUND_IMAGE], (result) => {
            if (result[STORAGE_KEYS.SETTINGS]) {
                appSettings = restoreLegacyBackgroundImage(result[STORAGE_KEYS.SETTINGS], result[STORAGE_KEYS.BACKGROUND_IMAGE]);
            } else {
                appSettings = mergeSettingsWithDefaults();
                saveSettings();
            }
            // 确保 customDomain 同步到 localStorage
            syncCustomDomainToLocalStorage(appSettings.customDomain);
            applyUiOpacity(appSettings.uiOpacity);
            applyBackgroundFromSettings();
            updateBackgroundControlsUI();
            resolve();
        });
    });
}

function saveSettings() {
    const settingsToSave = mergeSettingsWithDefaults(deepClone(appSettings));
    // 同步 customDomain 到 localStorage，以便 chrome-adapter.js 启动时能同步读取
    syncCustomDomainToLocalStorage(settingsToSave.customDomain);
    chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settingsToSave }, () => {
        if (chrome.runtime.lastError) {
            console.warn('保存设置失败:', chrome.runtime.lastError);
            return;
        }
        // 清理历史拆分字段，避免再次回退到旧逻辑
        chrome.storage.local.remove([STORAGE_KEYS.BACKGROUND_IMAGE], () => {});
    });
}

/**
 * 将 customDomain 同步到 localStorage，用于 chrome-adapter.js 启动时同步读取。
 */
function syncCustomDomainToLocalStorage(domain) {
    try {
        if (domain) {
            localStorage.setItem('WebNav_customDomain', domain.trim());
        } else {
            localStorage.removeItem('WebNav_customDomain');
        }
    } catch (_) {}
}

async function loadIconCache() {
    return new Promise((resolve) => {
        chrome.storage.local.get([CACHE_KEYS.ICONS], (result) => {
            const { cache: normalizedCache, changed } = normalizeIconCacheMap(
                result[CACHE_KEYS.ICONS] || {}
            );
            iconCache = normalizedCache;
            if (changed) {
                saveIconCache();
            }
            resolve();
        });
    });
}

function normalizeIconCacheMap(rawCache) {
    if (!rawCache || typeof rawCache !== 'object') {
        return { cache: {}, changed: false };
    }
    const cache = {};
    let changed = false;
    Object.entries(rawCache).forEach(([key, value]) => {
        if (!key || typeof key !== 'string') {
            changed = true;
            return;
        }
        if (!value || typeof value !== 'string') {
            changed = true;
            return;
        }
        const normalizedValue = normalizePersistedAssetUrl(value);
        if (normalizedValue !== value) {
            changed = true;
        }
        cache[key] = normalizedValue;
    });
    return { cache, changed };
}

let saveIconCacheTimer = null;
function saveIconCache() {
    // 防抖保存，避免频繁写入存储
    if (saveIconCacheTimer) {
        clearTimeout(saveIconCacheTimer);
    }
    saveIconCacheTimer = setTimeout(() => {
        saveIconCacheTimer = null;
        try {
            chrome.storage.local.set({ [CACHE_KEYS.ICONS]: iconCache }, () => {
                if (chrome.runtime.lastError) {
                    console.warn('保存图标缓存失败 (可能是配额已满):', chrome.runtime.lastError);
                    // 简单的清理策略：如果保存失败，尝试清理一半的缓存（这里简单地清空，实际应用可以更智能）
                    // 为了防止无限循环，这里只做一次尝试或者仅仅是警告
                    // 考虑到用户体验，如果满了，我们可能需要提示用户或者自动清理旧的
                }
            });
        } catch (e) {
            console.error('保存图标缓存异常:', e);
        }
    }, 500);
}

async function loadData(options = {}) {
    const localSnapshot = options.localSnapshot !== undefined
        ? options.localSnapshot
        : await readLocalDataSnapshot();
    const fallback = localSnapshot || deepClone(DEFAULT_DATA);

    appData = fallback;
    if (!localSnapshot) {
        await persistDataToArea(chrome.storage.local, appData);
    }

    maybeSyncBackgroundFromData(appData, { saveSettingsFlag: true });
    maybeSyncUiOpacityFromData(appData, { saveSettingsFlag: true });
    attachBackgroundToData(appData);
    ensureActiveCategory();
    const normalized = normalizeDataStructure();
    if (normalized) {
        await persistAppData(appData, { notifyOnError: false });
    }
    purgeUnusedCachedIcons();
}

async function readLocalDataSnapshot() {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEYS.DATA], (result) => {
            resolve(result[STORAGE_KEYS.DATA] || null);
        });
    });
}

async function loadFolderFromLocalSnapshot(folderId) {
    if (!folderId) return null;
    try {
        const snapshot = await readLocalDataSnapshot();
        if (!snapshot || !Array.isArray(snapshot.categories)) return null;
        const loc = findBookmarkLocation(folderId, snapshot);
        if (!loc || loc.bookmark.type !== 'folder') return null;
        return { bookmark: loc.bookmark, categoryId: loc.categoryId, fullData: snapshot };
    } catch (error) {
        console.warn('读取本地快照时出错', error);
        return null;
    }
}

let saveDataDebounceTimer = null;
let pendingSavePromise = null;
let pendingSaveResolvers = [];

// 刷新待保存的数据（用于页面卸载时确保数据已保存）
async function flushSaveData() {
    if (saveDataDebounceTimer) {
        clearTimeout(saveDataDebounceTimer);
        saveDataDebounceTimer = null;
        try {
            await persistAppData(appData, {});
            // 解析所有等待的 Promise
            pendingSaveResolvers.forEach(r => r.resolve());
        } catch (error) {
            pendingSaveResolvers.forEach(r => r.reject(error));
        }
        pendingSaveResolvers = [];
        pendingSavePromise = null;
    }
    return pendingSavePromise;
}

async function saveData(options = {}) {
    const { immediate = false, ...restOptions } = options;
    
    // 如果要求立即保存，直接执行
    if (immediate) {
        if (saveDataDebounceTimer) {
            clearTimeout(saveDataDebounceTimer);
            saveDataDebounceTimer = null;
            // 解析之前等待的 Promise
            pendingSaveResolvers.forEach(r => r.resolve());
            pendingSaveResolvers = [];
        }
        try {
            await persistAppData(appData, restOptions);
        } catch (error) {
            console.error('保存数据失败:', error);
            if (restOptions.notifyOnError) {
                alert(`保存数据失败: ${error.message}`);
            }
            throw error;
        }
        return;
    }
    
    // 防抖保存，避免频繁写入（缩短到 50ms）
    if (saveDataDebounceTimer) {
        clearTimeout(saveDataDebounceTimer);
    }
    
    return new Promise((resolve, reject) => {
        pendingSaveResolvers.push({ resolve, reject });
        
        saveDataDebounceTimer = setTimeout(async () => {
            saveDataDebounceTimer = null;
            const resolvers = pendingSaveResolvers;
            pendingSaveResolvers = [];
            
            try {
                await persistAppData(appData, restOptions);
                resolvers.forEach(r => r.resolve());
            } catch (error) {
                console.error('保存数据失败:', error);
                if (restOptions.notifyOnError) {
                    alert(`保存数据失败: ${error.message}`);
                }
                resolvers.forEach(r => r.reject(error));
            }
        }, 50); // 缩短防抖时间到 50ms
    });
}

async function persistAppData(data, { mode = appSettings.storageMode, notifyOnError = false } = {}) {
    const dataWithBackground = attachBackgroundToData(data);
    await persistDataToArea(chrome.storage.local, dataWithBackground);
}

function persistDataToArea(area, data) {
    return new Promise((resolve, reject) => {
        if (!area || typeof area.set !== 'function') {
            resolve();
            return;
        }
        area.set({ [STORAGE_KEYS.DATA]: data }, () => {
            if (chrome.runtime.lastError) {
                console.warn('保存数据失败:', chrome.runtime.lastError.message);
                // 不 reject，只警告，避免中断后续操作
            }
            resolve();
        });
    });
}

function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function ensureActiveCategory() {
    if (!appData || !Array.isArray(appData.categories)) return;
    const exists = appData.categories.find(c => c.id === appData.activeCategory);
    if (!exists && appData.categories.length > 0) {
        appData.activeCategory = appData.categories[0].id;
    }
}

// 判断是否为网络相关错误（离线、超时、连接失败等）
function isNetworkError(error) {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    return (
        error.name === 'AbortError' ||
        error.name === 'TypeError' && msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('timeout') ||
        msg.includes('超时') ||
        msg.includes('failed to fetch') ||
        msg.includes('net::') ||
        msg.includes('offline')
    );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = NETWORK_FETCH_TIMEOUT) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return response;
    } catch (error) {
        clearTimeout(timer);
        if (error.name === 'AbortError') {
            throw new Error(`请求超时 (${timeoutMs}ms)`);
        }
        throw error;
    }
}

async function persistBlobAsset(blob, { fileName = '', sourceUrl = '' } = {}) {
    if (!blob || !(blob instanceof Blob) || blob.size <= 0) return '';
    const query = new URLSearchParams();
    if (fileName) query.set('filename', fileName);
    if (sourceUrl) query.set('source_url', sourceUrl);
    const response = await fetchWithTimeout(resolveApiUrl(`/api/assets?${query.toString()}`), {
        method: 'POST',
        headers: {
            'Content-Type': blob.type || 'application/octet-stream'
        },
        body: blob
    }, NETWORK_FETCH_TIMEOUT);
    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const err = await response.json();
            if (err?.error) message = err.error;
        } catch (error) {
            // ignore parse failure
        }
        throw new Error(message);
    }
    const data = await response.json();
    return normalizePersistedAssetUrl(data?.path || data?.url || '');
}

async function persistDataUrlAsset(dataUrl, options = {}) {
    const blob = dataUrlToBlob(dataUrl);
    if (!blob) return '';
    return persistBlobAsset(blob, options);
}

async function fetchExternalAssetToLocal(sourceUrl, { maxBytes = DEFAULT_EXTERNAL_FETCH_MAX_BYTES } = {}) {
    const response = await fetchWithTimeout(resolveApiUrl('/api/assets/fetch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: sourceUrl,
            maxBytes
        })
    }, NETWORK_FETCH_TIMEOUT);
    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const err = await response.json();
            if (err?.error) message = err.error;
        } catch (error) {
            // ignore parse failure
        }
        throw new Error(message);
    }
    const data = await response.json();
    return normalizePersistedAssetUrl(data?.path || data?.url || '');
}

async function fetchExternalTextViaProxy(sourceUrl, { maxBytes = DEFAULT_EXTERNAL_TEXT_FETCH_MAX_BYTES } = {}) {
    try {
        const response = await fetchWithTimeout(resolveApiUrl('/api/fetch/text'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: sourceUrl,
                maxBytes
            })
        }, NETWORK_FETCH_TIMEOUT);
        if (!response.ok) {
            return null;
        }
        const data = await response.json();
        const text = typeof data?.text === 'string' ? data.text : '';
        if (!text) return null;
        return {
            text,
            finalUrl: data?.finalUrl || sourceUrl,
            contentType: data?.contentType || ''
        };
    } catch (error) {
        return null;
    }
}

function normalizeDataStructure() {
    if (!appData || !Array.isArray(appData.categories)) return false;
    let changed = false;
    appData.categories.forEach(cat => {
        walkCategoryBookmarks(cat, (bm) => {
            if (bm.type === 'folder') {
                bm.children = Array.isArray(bm.children) ? bm.children : [];
                if (normalizeFolderChildTitles(bm.title, bm.children)) {
                    changed = true;
                }
            }
            const normalizedIcon = normalizePersistedAssetUrl(bm.icon || '');
            if ((bm.icon || '') !== normalizedIcon) {
                bm.icon = normalizedIcon;
                changed = true;
            }
            if (!Array.isArray(bm.iconFallbacks)) {
                bm.iconFallbacks = [];
                changed = true;
            } else {
                const normalizedFallbacks = bm.iconFallbacks
                    .map(item => (typeof item === 'string' ? normalizePersistedAssetUrl(item) : ''))
                    .filter(Boolean);
                const fallbackChanged = normalizedFallbacks.length !== bm.iconFallbacks.length ||
                    normalizedFallbacks.some((item, index) => item !== bm.iconFallbacks[index]);
                if (fallbackChanged) {
                    bm.iconFallbacks = normalizedFallbacks;
                    changed = true;
                }
            }
            // Only fill missing favicon data; do not overwrite user-chosen icon/fallbacks.
            if (bm.iconType === 'favicon' && (!bm.icon || bm.iconFallbacks.length === 0)) {
                const meta = generateHighResIconMeta(bm.url);
                bm.icon = bm.icon || meta.icon;
                bm.iconFallbacks = bm.iconFallbacks.length ? bm.iconFallbacks : meta.iconFallbacks;
                changed = true;
            }
        });
    });
    const normalizedBg = normalizeBackgroundSettings(appData.background);
    const currentBg = appData.background || {};
    const bgChanged =
        !currentBg ||
        currentBg.image !== normalizedBg.image ||
        currentBg.opacity !== normalizedBg.opacity ||
        (currentBg.source || currentBg.sourceUrl || '') !== normalizedBg.source;
    if (bgChanged) {
        appData.background = normalizedBg;
        changed = true;
    }
    return changed;
}

function resolveCachedIconSrc(src) {
    if (!src) return '';
    const normalizedSrc = normalizePersistedAssetUrl(src);
    const cached = (iconCache && (iconCache[src] || iconCache[normalizedSrc])) || '';
    const resolved = normalizePersistedAssetUrl(cached || normalizedSrc || src);
    // 如果结果是本地资源路径，使用自定义域名拼接完整 URL
    return resolveAssetDisplayUrl(resolved);
}

function dedupeIconList(primary, list) {
    const result = [];
    const seen = new Set();
    list.forEach(item => {
        if (!item || item === primary || seen.has(item)) return;
        seen.add(item);
        result.push(item);
    });
    return result;
}

function resolveBookmarkIconSource(bookmark) {
    const primarySrc = resolveCachedIconSrc(bookmark.icon) || 'icons/default.svg';
    const fallbackList = dedupeIconList(
        primarySrc,
        (bookmark.iconFallbacks || []).map(resolveCachedIconSrc)
    );
    return { primarySrc, fallbackList };
}

async function cacheIconIfNeeded(src) {
    const normalizedSrc = normalizePersistedAssetUrl(src);
    const targetSrc = normalizedSrc || src;
    const isPersistedLocalAsset = isPersistedAssetReference(targetSrc);
    const isLocalAsset = targetSrc.startsWith('icons/') ||
        targetSrc.startsWith('chrome-extension://') ||
        targetSrc.startsWith('moz-extension://') ||
        targetSrc.startsWith('/') ||
        isPersistedLocalAsset;
    if (!targetSrc || targetSrc.startsWith('data:') || isLocalAsset || (iconCache && (iconCache[targetSrc] || iconCache[src]))) {
        return false;
    }

    try {
        const persistedUrl = await fetchExternalAssetToLocal(targetSrc, { maxBytes: MAX_CACHED_ICON_BYTES });
        if (persistedUrl) {
            iconCache[targetSrc] = normalizePersistedAssetUrl(persistedUrl);
            saveIconCache();
            return true;
        }
    } catch (error) {
        // 失败后回退到浏览器直接拉取（受 CORS 影响）
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时
    try {
        const response = await fetch(targetSrc, { 
            mode: 'cors', 
            cache: 'force-cache',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok || response.type === 'opaque') {
            // 不抛出错误，只是返回 false
            return false;
        }
        const blob = await response.blob();
        if (!blob || blob.size > MAX_CACHED_ICON_BYTES) {
            return false;
        }
        const persistedUrl = await persistBlobAsset(blob, { fileName: '', sourceUrl: targetSrc });
        if (persistedUrl) {
            iconCache[targetSrc] = normalizePersistedAssetUrl(persistedUrl);
            saveIconCache();
            return true;
        }
    } catch (error) {
        // 如果是主动中止则静默处理，否则打印警告
        if (error.name !== 'AbortError') {
            console.warn('缓存图标失败', targetSrc, error);
        }
    } finally {
        clearTimeout(timeoutId);
    }
    return false;
}

async function cacheBookmarkIcons(primary, fallbacks = []) {
    const targets = Array.from(new Set([primary, ...fallbacks].filter(Boolean)));
    // 并发处理
    const results = await Promise.all(targets.map(target => cacheIconIfNeeded(target)));
    return results.some(Boolean);
}

function purgeUnusedCachedIcons() {
    if (!iconCache || typeof iconCache !== 'object') return;
    const used = new Set();
    const usedAssetIds = new Set();
    if (appData && Array.isArray(appData.categories)) {
        appData.categories.forEach(cat => {
            walkCategoryBookmarks(cat, (bm) => {
                [bm.icon, ...(bm.iconFallbacks || [])].forEach(url => {
                    if (url) used.add(url);
                    // 收集所有被引用的本地资产 ID
                    const assetMatch = (url || '').match(/\/assets\/([0-9a-f]{32})/i);
                    if (assetMatch) usedAssetIds.add(assetMatch[1]);
                });
            });
        });
    }
    // 也收集缓存映射中指向的本地资产 ID
    Object.values(iconCache).forEach(val => {
        const m = (val || '').match(/\/assets\/([0-9a-f]{32})/i);
        if (m) usedAssetIds.add(m[1]);
    });
    // 收集背景图资产
    if (appData && appData.background && appData.background.image) {
        const bgMatch = appData.background.image.match(/\/assets\/([0-9a-f]{32})/i);
        if (bgMatch) usedAssetIds.add(bgMatch[1]);
    }
    let changed = false;
    Object.keys(iconCache).forEach(key => {
        if (!used.has(key)) {
            delete iconCache[key];
            changed = true;
        }
    });
    if (changed) {
        saveIconCache();
    }
    // 调用后端清理孤立资产
    _requestBackendAssetCleanup(Array.from(usedAssetIds));
}

/**
 * 请求后端清理不再被引用的资产 BLOB
 */
async function _requestBackendAssetCleanup(activeAssetIds) {
    try {
        await fetchWithTimeout(resolveApiUrl('/api/assets/cleanup'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activeIds: activeAssetIds })
        }, NETWORK_FETCH_TIMEOUT);
    } catch (error) {
        // 清理失败不影响正常使用
        console.warn('资产清理请求失败:', error);
    }
}

let isWarmingIconCache = false;
/**
 * 预热书签图标缓存
 * 只缓存每个书签的主图标（bm.icon），如果主图标已缓存则跳过该书签
 * 不会缓存备选图标（iconFallbacks），备选图标仅在编辑时按需获取
 */
async function warmIconCacheForBookmarks() {
    if (isWarmingIconCache) return;
    if (!appData || !Array.isArray(appData.categories)) return;
    isWarmingIconCache = true;
    
    try {
        const targets = new Set();
        appData.categories.forEach(cat => {
            walkCategoryBookmarks(cat, (bm) => {
                const primaryIcon = bm.icon;
                // 只缓存主图标，且仅当主图标未缓存时才添加到队列
                if (primaryIcon && 
                    !primaryIcon.startsWith('data:') && 
                    !(iconCache && iconCache[primaryIcon])) {
                    targets.add(primaryIcon);
                }
            });
        });
        if (!targets.size) return;
        
        // 并发预热，限制并发数以防浏览器限制
        const urls = Array.from(targets);
        const BATCH_SIZE = 5;
        let cachedAny = false;

        for (let i = 0; i < urls.length; i += BATCH_SIZE) {
            const batch = urls.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(url => cacheIconIfNeeded(url)));
            if (results.some(Boolean)) {
                cachedAny = true;
            }
        }

        if (cachedAny) {
            renderBookmarks();
            refreshOpenFolderView();
        }
    } finally {
        isWarmingIconCache = false;
    }
}

/**
 * 后台异步缓存 favicon 图标（不阻塞保存流程）。
 * 缓存完成后自动更新书签数据并刷新UI。
 */
async function _backgroundCacheIcons(bookmarkId, originalIconUrl, originalFallbacks) {
    try {
        const cached = await cacheBookmarkIcons(originalIconUrl, originalFallbacks);
        if (cached) {
            // 缓存成功，更新书签数据中的图标路径为本地路径
            const loc = findBookmarkLocation(bookmarkId);
            if (loc && loc.bookmark) {
                const newIcon = resolveCachedIconSrc(originalIconUrl) || loc.bookmark.icon;
                const newFallbacks = (originalFallbacks || []).map(item => resolveCachedIconSrc(item) || item);
                if (newIcon !== loc.bookmark.icon || JSON.stringify(newFallbacks) !== JSON.stringify(loc.bookmark.iconFallbacks)) {
                    loc.bookmark.icon = newIcon;
                    loc.bookmark.iconFallbacks = newFallbacks;
                    saveData({ immediate: true });
                    renderBookmarks();
                    refreshOpenFolderView();
                }
            }
        }
    } catch (error) {
        console.warn('后台图标缓存失败（将在下次预热时重试）:', error);
    }
}

// ===== 图标缓存诊断 =====
let uncachedIconReport = []; // { bookmarkId, title, url, icon, uncachedUrls[], status:'pending'|'ok'|'fail' }
let isRetryingUncachedIcons = false;

/**
 * 判断某个图标 URL 是否已成功缓存到本地。
 * 返回 true 表示已缓存（本地路径、data URL、或 iconCache 中有映射）。
 */
function isIconCachedLocally(src) {
    if (!src || typeof src !== 'string') return true; // 空值视为无需缓存
    if (src === 'icons/default.svg') return true;
    if (src.startsWith('data:')) return true;
    if (src.startsWith('icons/')) return true;
    if (src.startsWith('chrome-extension://') || src.startsWith('moz-extension://')) return true;
    const normalized = normalizePersistedAssetUrl(src);
    if (isPersistedAssetReference(normalized) || isPersistedAssetReference(src)) return true;
    if (iconCache && (iconCache[src] || iconCache[normalized])) return true;
    return false;
}

/**
 * 审计所有书签的图标缓存状态。
 * 收集未缓存到本地的图标列表，输出控制台日志，更新 uncachedIconReport。
 */
function auditIconCacheStatus() {
    if (!appData || !Array.isArray(appData.categories)) return;

    const report = [];
    let totalBookmarks = 0;
    let cachedBookmarks = 0;

    appData.categories.forEach(cat => {
        walkCategoryBookmarks(cat, (bm) => {
            if (bm.type === 'folder') return; // 文件夹本身没有图标
            totalBookmarks++;

            const uncachedUrls = [];
            // 检查主图标
            if (!isIconCachedLocally(bm.icon)) {
                uncachedUrls.push(bm.icon);
            }
            // 检查备选图标
            (bm.iconFallbacks || []).forEach(fb => {
                if (!isIconCachedLocally(fb)) {
                    uncachedUrls.push(fb);
                }
            });

            if (uncachedUrls.length > 0) {
                report.push({
                    bookmarkId: bm.id,
                    title: bm.title || '(无标题)',
                    url: bm.url || '',
                    icon: bm.icon,
                    uncachedUrls,
                    status: 'pending' // pending | ok | fail
                });
            } else {
                cachedBookmarks++;
            }
        });
    });

    uncachedIconReport = report;

    // 控制台日志输出
    if (report.length === 0) {
        console.log(`%c✅ 图标缓存状态：全部 ${totalBookmarks} 个书签的图标已缓存到本地`, 'color: #4caf50; font-weight: bold;');
    } else {
        console.group(`%c⚠️ 图标缓存状态：${report.length}/${totalBookmarks} 个书签的图标未缓存`, 'color: #ff9800; font-weight: bold;');
        report.forEach(entry => {
            console.warn(
                `📌 ${entry.title} (${entry.url})\n` +
                `   未缓存图标 (${entry.uncachedUrls.length}):`,
                entry.uncachedUrls
            );
        });
        console.groupEnd();
    }

    // 更新 UI（如果设置面板打开中）
    updateIconCacheStatusUI();
}

/**
 * 更新图标缓存诊断 UI 的显示状态。
 */
function updateIconCacheStatusUI() {
    if (!els.iconCacheStatusText) return;

    let totalBookmarks = 0;
    if (appData && Array.isArray(appData.categories)) {
        appData.categories.forEach(cat => {
            walkCategoryBookmarks(cat, (bm) => {
                if (bm.type !== 'folder') totalBookmarks++;
            });
        });
    }

    const uncachedCount = uncachedIconReport.length;
    const cachedCount = totalBookmarks - uncachedCount;

    if (uncachedCount === 0) {
        els.iconCacheStatusText.textContent = `✅ 全部 ${totalBookmarks} 个图标已缓存`;
        els.iconCacheStatusText.className = 'icon-cache-status-text all-cached';
        if (els.retryUncachedIconsBtn) {
            els.retryUncachedIconsBtn.textContent = '检查并重试';
            els.retryUncachedIconsBtn.disabled = isRetryingUncachedIcons;
        }
    } else {
        els.iconCacheStatusText.textContent = `⚠️ ${uncachedCount} 个图标未缓存（共 ${totalBookmarks} 个）`;
        els.iconCacheStatusText.className = 'icon-cache-status-text has-uncached';
        if (els.retryUncachedIconsBtn) {
            els.retryUncachedIconsBtn.textContent = `重试未缓存 (${uncachedCount})`;
            els.retryUncachedIconsBtn.disabled = isRetryingUncachedIcons;
        }
    }

    // 渲染未缓存列表
    renderUncachedIconList();
}

/**
 * 渲染未缓存图标列表 UI。
 */
function renderUncachedIconList() {
    if (!els.uncachedIconList) return;

    if (uncachedIconReport.length === 0) {
        els.uncachedIconList.classList.add('hidden');
        els.uncachedIconList.innerHTML = '';
        return;
    }

    els.uncachedIconList.classList.remove('hidden');
    els.uncachedIconList.innerHTML = '';

    uncachedIconReport.forEach((entry, idx) => {
        const item = document.createElement('div');
        item.className = 'uncached-icon-item';
        item.dataset.index = idx;

        // 图标预览
        const img = document.createElement('img');
        const resolvedSrc = resolveCachedIconSrc(entry.icon) || entry.icon || 'icons/default.svg';
        img.src = resolvedSrc;
        img.onerror = () => { img.src = 'icons/default.svg'; img.onerror = null; };
        item.appendChild(img);

        // 信息区
        const info = document.createElement('div');
        info.className = 'uncached-bm-info';
        const titleEl = document.createElement('div');
        titleEl.className = 'uncached-bm-title';
        titleEl.textContent = entry.title;
        titleEl.title = entry.title;
        info.appendChild(titleEl);
        const urlEl = document.createElement('div');
        urlEl.className = 'uncached-bm-url';
        urlEl.textContent = entry.url;
        urlEl.title = entry.url;
        info.appendChild(urlEl);
        item.appendChild(info);

        // 状态标签
        const statusEl = document.createElement('span');
        statusEl.className = 'uncached-bm-status status-' + entry.status;
        if (entry.status === 'ok') {
            statusEl.textContent = '已缓存';
        } else if (entry.status === 'fail') {
            statusEl.textContent = '失败';
        } else {
            statusEl.textContent = `${entry.uncachedUrls.length} 个未缓存`;
        }
        item.appendChild(statusEl);

        // 单个重试按钮
        const retryBtn = document.createElement('button');
        retryBtn.className = 'retry-single-btn';
        retryBtn.textContent = '↻';
        retryBtn.title = '重试缓存此图标';
        retryBtn.disabled = entry.status === 'ok' || isRetryingUncachedIcons;
        retryBtn.addEventListener('click', () => retrySingleBookmarkIcon(idx));
        item.appendChild(retryBtn);

        els.uncachedIconList.appendChild(item);
    });
}

/**
 * 重试单个书签的图标缓存。
 */
async function retrySingleBookmarkIcon(reportIndex) {
    const entry = uncachedIconReport[reportIndex];
    if (!entry || entry.status === 'ok') return;

    const loc = findBookmarkLocation(entry.bookmarkId);
    if (!loc || !loc.bookmark) {
        entry.status = 'fail';
        renderUncachedIconList();
        return;
    }

    const bm = loc.bookmark;
    entry.status = 'pending';
    renderUncachedIconList();

    try {
        // 尝试缓存主图标和所有备选
        const allTargets = [bm.icon, ...(bm.iconFallbacks || [])].filter(Boolean);
        const cached = await cacheBookmarkIcons(bm.icon, bm.iconFallbacks);

        if (cached) {
            // 更新书签数据中的图标路径为本地路径
            const newIcon = resolveCachedIconSrc(bm.icon) || bm.icon;
            const newFallbacks = (bm.iconFallbacks || []).map(item => resolveCachedIconSrc(item) || item);
            if (newIcon !== bm.icon || JSON.stringify(newFallbacks) !== JSON.stringify(bm.iconFallbacks)) {
                bm.icon = newIcon;
                bm.iconFallbacks = newFallbacks;
                saveData({ immediate: true });
            }
        }

        // 重新检查此书签是否全部缓存
        const stillUncached = [];
        if (!isIconCachedLocally(bm.icon)) stillUncached.push(bm.icon);
        (bm.iconFallbacks || []).forEach(fb => {
            if (!isIconCachedLocally(fb)) stillUncached.push(fb);
        });

        if (stillUncached.length === 0) {
            entry.status = 'ok';
            entry.uncachedUrls = [];
        } else {
            entry.status = 'fail';
            entry.uncachedUrls = stillUncached;
        }
    } catch (error) {
        console.warn(`重试缓存图标失败 [${entry.title}]:`, error);
        entry.status = 'fail';
    }

    renderUncachedIconList();
    updateIconCacheStatusUI();
    renderBookmarks();
    refreshOpenFolderView();
}

/**
 * 批量重试所有未缓存的图标。
 * 不阻塞 UI，分批并发执行。
 */
async function retryUncachedIcons() {
    if (isRetryingUncachedIcons) return;

    // 先刷新审计
    auditIconCacheStatus();
    if (uncachedIconReport.length === 0) return;

    isRetryingUncachedIcons = true;
    const total = uncachedIconReport.length;
    let completed = 0;

    if (els.retryUncachedIconsBtn) {
        els.retryUncachedIconsBtn.disabled = true;
        els.retryUncachedIconsBtn.textContent = `重试中 0/${total}...`;
    }

    const BATCH_SIZE = 3;
    let anyChanged = false;

    for (let i = 0; i < uncachedIconReport.length; i += BATCH_SIZE) {
        const batch = uncachedIconReport.slice(i, i + BATCH_SIZE);
        const tasks = batch.map(async (entry) => {
            if (entry.status === 'ok') return;

            const loc = findBookmarkLocation(entry.bookmarkId);
            if (!loc || !loc.bookmark) {
                entry.status = 'fail';
                return;
            }

            const bm = loc.bookmark;
            try {
                const cached = await cacheBookmarkIcons(bm.icon, bm.iconFallbacks);
                if (cached) {
                    const newIcon = resolveCachedIconSrc(bm.icon) || bm.icon;
                    const newFallbacks = (bm.iconFallbacks || []).map(item => resolveCachedIconSrc(item) || item);
                    if (newIcon !== bm.icon || JSON.stringify(newFallbacks) !== JSON.stringify(bm.iconFallbacks)) {
                        bm.icon = newIcon;
                        bm.iconFallbacks = newFallbacks;
                        anyChanged = true;
                    }
                }

                // 重新检查
                const stillUncached = [];
                if (!isIconCachedLocally(bm.icon)) stillUncached.push(bm.icon);
                (bm.iconFallbacks || []).forEach(fb => {
                    if (!isIconCachedLocally(fb)) stillUncached.push(fb);
                });

                if (stillUncached.length === 0) {
                    entry.status = 'ok';
                    entry.uncachedUrls = [];
                } else {
                    entry.status = 'fail';
                    entry.uncachedUrls = stillUncached;
                }
            } catch (error) {
                console.warn(`批量重试缓存图标失败 [${entry.title}]:`, error);
                entry.status = 'fail';
            }
        });

        await Promise.all(tasks);
        completed += batch.length;

        // 更新进度
        if (els.retryUncachedIconsBtn) {
            els.retryUncachedIconsBtn.textContent = `重试中 ${completed}/${total}...`;
        }
        renderUncachedIconList();
    }

    if (anyChanged) {
        saveData({ immediate: true });
        renderBookmarks();
        refreshOpenFolderView();
    }

    isRetryingUncachedIcons = false;

    // 最终审计刷新
    auditIconCacheStatus();
}

/**
 * 后台异步持久化 data: URL 自定义图标（不阻塞保存流程）。
 */
async function _backgroundPersistCustomIcon(bookmarkId, dataUrl, title) {
    try {
        const persistedUrl = await persistDataUrlAsset(dataUrl, {
            fileName: 'custom-icon.png',
            sourceUrl: `custom-icon:${title}`
        });
        if (persistedUrl) {
            const loc = findBookmarkLocation(bookmarkId);
            if (loc && loc.bookmark && loc.bookmark.icon === dataUrl) {
                loc.bookmark.icon = persistedUrl;
                saveData({ immediate: true });
                renderBookmarks();
                refreshOpenFolderView();
            }
        }
    } catch (error) {
        console.warn('后台自定义图标持久化失败，已保留 data URL。', error);
    }
}

// --- 渲染逻辑 ---

function renderApp(options = {}) {
    renderCategories(options);
    renderBookmarks(options);
    refreshOpenFolderView();
}

function getCategoryDragPlaceholder() {
    if (!categoryDragState.placeholder) {
        const ph = document.createElement('li');
        ph.className = 'category-placeholder';
        categoryDragState.placeholder = ph;
    }
    return categoryDragState.placeholder;
}

function removeCategoryDragPlaceholder() {
    if (categoryDragState.placeholder && categoryDragState.placeholder.parentNode) {
        categoryDragState.placeholder.parentNode.removeChild(categoryDragState.placeholder);
    }
    categoryDragState.placeholder = null;
}

function positionCategoryPlaceholder(targetLi, dropBefore = true) {
    if (!targetLi || targetLi.classList.contains('category-placeholder')) return;
    const parent = targetLi.parentNode;
    if (!parent) return;
    const placeholder = getCategoryDragPlaceholder();
    const referenceNode = dropBefore ? targetLi : targetLi.nextSibling;
    if (referenceNode === placeholder) return;
    parent.insertBefore(placeholder, referenceNode);
}

function positionCategoryPlaceholderAtEnd(listEl) {
    const placeholder = getCategoryDragPlaceholder();
    if (!listEl) return;
    if (placeholder.parentNode !== listEl || placeholder.nextSibling) {
        listEl.appendChild(placeholder);
    }
}

function computeCategoryInsertIndex(listEl) {
    if (!listEl) return -1;
    let index = 0;
    const children = Array.from(listEl.children);
    for (const child of children) {
        if (child === categoryDragState.placeholder) {
            return index;
        }
        if (child.dataset && child.dataset.id === categoryDragState.draggingId) {
            continue;
        }
        index += 1;
    }
    return index;
}

function resetCategoryDragState() {
    if (categoryDragState.timerId) {
        clearTimeout(categoryDragState.timerId);
        categoryDragState.timerId = null;
    }
    if (categoryDragState.draggingId && els.categoryList) {
        const draggingEl = els.categoryList.querySelector(`li[data-id="${categoryDragState.draggingId}"]`);
        if (draggingEl) {
            draggingEl.dataset.dragActive = '0';
            draggingEl.classList.remove('dragging', 'drag-ready', 'invisible-drag-source');
            draggingEl.draggable = false;
        }
    }
    categoryDragState.draggingId = null;
    categoryDragState.dropHandled = false;
    removeCategoryDragPlaceholder();
}

function moveCategoryToIndex(categoryId, targetIndex) {
    const fromIndex = appData.categories.findIndex(c => c.id === categoryId);
    if (fromIndex === -1) return;
    const clampedTarget = Math.max(0, Math.min(targetIndex, appData.categories.length - 1));
    if (fromIndex === clampedTarget) return;
    const [cat] = appData.categories.splice(fromIndex, 1);
    appData.categories.splice(clampedTarget, 0, cat);
    // 分类顺序调整是用户主动操作，立即保存
    saveData({ immediate: true });
    renderCategories({ skipAnimation: true });
}

function handleCategoryListDrop(e) {
    if (!categoryDragState.draggingId) return;
    e.preventDefault();
    if (categoryDragState.dropHandled) {
        resetCategoryDragState();
        return;
    }
    categoryDragState.dropHandled = true;
    const targetIndex = computeCategoryInsertIndex(els.categoryList);
    if (targetIndex >= 0) {
        moveCategoryToIndex(categoryDragState.draggingId, targetIndex);
    }
    resetCategoryDragState();
}

function setupCategoryListDropzone() {
    if (!els.categoryList || els.categoryList.dataset.catDropSetup === '1') return;
    const listEl = els.categoryList;
    listEl.addEventListener('dragover', (e) => {
        if (!categoryDragState.draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetItem = e.target.closest('li');
        if (targetItem && targetItem.parentNode === listEl) {
            const rect = targetItem.getBoundingClientRect();
            const dropBefore = e.clientY < rect.top + rect.height / 2;
            positionCategoryPlaceholder(targetItem, dropBefore);
        } else {
            positionCategoryPlaceholderAtEnd(listEl);
        }
    });
    listEl.addEventListener('drop', handleCategoryListDrop);
    listEl.dataset.catDropSetup = '1';
}

function setupCategoryDragHandlers(li, categoryId) {
    li.dataset.dragActive = '0';
    li.draggable = false;
    const clearLongPress = () => {
        if (categoryDragState.timerId) {
            clearTimeout(categoryDragState.timerId);
            categoryDragState.timerId = null;
        }
        li.classList.remove('drag-ready');
        li.draggable = false;
    };
    const startLongPress = (event) => {
        if (!shouldEnableDragByPointerType(event.pointerType)) {
            return;
        }
        if (appData.categories.length <= 1) return;
        if ((event.pointerType === 'mouse' && event.button !== 0) || event.target.closest('.delete-cat')) {
            return;
        }
        clearLongPress();
        categoryDragState.timerId = setTimeout(() => {
            li.draggable = true;
            li.classList.add('drag-ready');
        }, DRAG_LONG_PRESS_MS);
    };
    li.addEventListener('pointerdown', startLongPress);
    li.addEventListener('pointerup', clearLongPress);
    li.addEventListener('pointerleave', clearLongPress);
    li.addEventListener('pointercancel', clearLongPress);

    li.addEventListener('dragstart', (e) => {
        if (!li.draggable) {
            e.preventDefault();
            return;
        }
        categoryDragState.draggingId = categoryId;
        categoryDragState.dropHandled = false;
        li.dataset.dragActive = '1';
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', categoryId);
        const placeholder = getCategoryDragPlaceholder();
        if (li.parentNode) {
            li.parentNode.insertBefore(placeholder, li.nextSibling);
        }
        requestAnimationFrame(() => {
            li.classList.add('invisible-drag-source');
        });
    });

    li.addEventListener('dragover', (e) => {
        if (!categoryDragState.draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = li.getBoundingClientRect();
        const dropBefore = e.clientY < rect.top + rect.height / 2;
        positionCategoryPlaceholder(li, dropBefore);
    });

    li.addEventListener('dragend', () => {
        resetCategoryDragState();
    });
}

function renderCategories(options = {}) {
    // 检查分类是否已经渲染过（通过检查是否有子元素）
    const isFirstRender = els.categoryList.children.length === 0;
    if (!categoryDragState.draggingId) {
        removeCategoryDragPlaceholder();
    }
    setupCategoryListDropzone();
    
    els.categoryList.innerHTML = '';
    
    // 填充书签模态框中的分类选择
    els.bookmarkCategory.innerHTML = '';

    appData.categories.forEach((cat, index) => {
        // 侧边栏列表
        const li = document.createElement('li');
        li.textContent = cat.name;
        li.dataset.id = cat.id;
        // 只在首次渲染且未跳过动画时播放动画
        if (!options.skipAnimation && isFirstRender) {
            li.style.animation = `slideInRight 0.4s ease-out ${index * 0.05 + 0.2}s backwards`; // Staggered animation
        } else {
            li.classList.add('no-animation');
        }
        
        if (cat.id === appData.activeCategory) {
            li.classList.add('active');
        }
        
        // 删除按钮 (只有当分类多于1个时才显示)
        if (appData.categories.length > 1) {
            const delBtn = document.createElement('span');
            delBtn.className = 'delete-cat';
            delBtn.textContent = '×';
            delBtn.title = '删除分类';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteCategory(cat.id);
            };
            li.appendChild(delBtn);
        }

        li.onclick = () => {
            if (li.dataset.dragActive === '1') {
                li.dataset.dragActive = '0';
                return;
            }
            // 切换分类时退出批量选择模式
            if (batchSelectState.enabled) {
                toggleBatchSelectMode(false);
            }
            // 切换分类时清除搜索
            if (bookmarkSearchState.isSearching) {
                els.bookmarkSearchInput.value = '';
                els.clearBookmarkSearch?.classList.add('hidden');
                clearBookmarkSearch();
            }
            appData.activeCategory = cat.id;
            saveData();
            if (openFolderCategoryId && openFolderCategoryId !== cat.id) {
                closeFolderModal();
            }
            renderApp();
            if (isMobileLayout()) {
                closeMobileSidebar();
            }
        };
        // 右键菜单
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showCategoryContextMenu(cat.id, e.clientX, e.clientY);
        });
        setupCategoryDragHandlers(li, cat.id);
        els.categoryList.appendChild(li);

        // 模态框下拉选项
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        els.bookmarkCategory.appendChild(option);
    });
}

function renderBookmarks(options = {}) {
    const currentCat = getActiveCategory();
    els.bookmarkGrid.innerHTML = '';
    if (!currentCat) return;
    ensureGridDropzone(els.bookmarkGrid, { categoryId: currentCat.id, folderId: null });
    renderBookmarkCollection(currentCat.bookmarks, els.bookmarkGrid, { categoryId: currentCat.id, folderId: null, skipAnimation: options.skipAnimation });
}

function renderBookmarkCollection(bookmarks, container, context = {}) {
    if (!container) return;
    const items = Array.isArray(bookmarks) ? bookmarks : [];

    // 尝试重用 DOM 节点进行排序，避免重新加载图标
    if (context.reorder) {
        const existingCards = Array.from(container.children).filter(el => el.classList.contains('bookmark-card'));
        const cardMap = new Map();
        existingCards.forEach(card => {
            if (card.dataset.id) cardMap.set(card.dataset.id, card);
        });

        // 检查是否所有新列表中的 ID 都在当前 DOM 中存在（且数量一致，忽略占位符）
        // 如果有新增或删除，则回退到全量渲染
        const allExist = items.every(bm => cardMap.has(bm.id));
        if (allExist && existingCards.length === items.length) {
            // 执行重排序
            items.forEach(bm => {
                const card = cardMap.get(bm.id);
                if (card) {
                    container.appendChild(card); // 移动到末尾，实现排序
                    if (context.skipAnimation) {
                        card.classList.add('no-animation');
                        // 强制重绘后移除类，以便下次动画生效？不，这里保持 no-animation 即可，下次交互会重置
                    }
                }
            });
            // 确保添加按钮在最后
            const addCard = container.querySelector('.add-bookmark-card');
            if (addCard) {
                container.appendChild(addCard);
            }
            return;
        }
    }

    container.innerHTML = '';
    
    // 如果正在拖拽的元素在容器内，将其暂时移到 body 以免被销毁，从而保持拖拽状态
    const draggingEl = document.querySelector('.bookmark-card.dragging');
    if (draggingEl && container.contains(draggingEl)) {
        document.body.appendChild(draggingEl);
    }

    items.forEach((bm, index) => {
        const card = createBookmarkCard(bm, { ...context, container });
        if (context.skipAnimation) {
            card.classList.add('no-animation');
        } else if (context.scope === 'folder') {
            // 仅在文件夹内保留波浪式动画
            card.style.animationDelay = `${index * 0.04}s`;
        }
        container.appendChild(card);
    });
    
    const addCard = createAddCard(context);
    if (context.skipAnimation) {
        addCard.classList.add('no-animation');
    } else if (context.scope === 'folder') {
        addCard.style.animationDelay = `${items.length * 0.04}s`;
    }
    container.appendChild(addCard);
}

function createAddCard(context = {}) {
    const addCard = document.createElement('div');
    addCard.className = 'add-bookmark-card';
    const inner = document.createElement('div');
    inner.className = 'add-card-inner';
    const label = document.createElement('span');
    label.textContent = '添加';
    const plus = document.createElement('span');
    plus.className = 'plus';
    plus.textContent = '+';
    inner.appendChild(plus);
    inner.appendChild(label);
    addCard.appendChild(inner);
    addCard.onclick = () => {
        openAddBookmarkModal({
            type: context.folderId ? 'link' : 'link',
            categoryId: context.categoryId || appData.activeCategory,
            folderId: context.folderId || null
        });
    };
    return addCard;
}

function createBookmarkCard(bm, context = {}) {
    const isFolder = bm.type === 'folder';
    const card = document.createElement('a');
    card.className = isFolder ? 'bookmark-card folder-card' : 'bookmark-card';
    card.dataset.id = bm.id;
    card.dataset.categoryId = context.categoryId || '';
    card.dataset.folderId = context.folderId || '';
    card.href = isFolder ? '#' : bm.url;
    
    // 为 View Transitions API 设置唯一名称
    if (bm.id) {
        // 确保 ID 格式合法
        const safeId = bm.id.replace(/[^a-zA-Z0-9-_]/g, '');
        card.style.viewTransitionName = `bm-${safeId}`;
    }

    if (isFolder) {
        const grid = createFolderIconGrid(bm);
        card.appendChild(grid);
    } else {
        const img = document.createElement('img');
        img.className = 'bookmark-icon';
        const resolvedIcon = resolveBookmarkIconSource(bm);
        img.src = resolvedIcon.primarySrc || 'icons/default.svg';
        attachIconFallback(img, { iconFallbacks: resolvedIcon.fallbackList });
        card.appendChild(img);
    }

    const title = document.createElement('div');
    title.className = 'bookmark-title';
    title.textContent = bm.title;

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn edit';
    editBtn.innerHTML = '✎';
    editBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openEditBookmarkModal(bm, context);
    };

    const delBtn = document.createElement('button');
    delBtn.className = 'action-btn delete';
    delBtn.innerHTML = '×';
    delBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteBookmark(bm.id);
    };

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(title);
    card.appendChild(actions);

    if (isFolder) {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            // 批量选择模式下的点击处理
            if (batchSelectState.enabled) {
                toggleBookmarkSelection(bm.id, card);
                return;
            }
            const anchorOptions = { anchorElement: card };
            if (openFolderId && document.startViewTransition) {
                document.startViewTransition(() => {
                    openFolderModal(bm.id, anchorOptions);
                });
            } else {
                openFolderModal(bm.id, anchorOptions);
            }
        });
    } else {
        // 普通书签的批量选择点击处理
        card.addEventListener('click', (e) => {
            if (batchSelectState.enabled) {
                e.preventDefault();
                toggleBookmarkSelection(bm.id, card);
            }
        });
    }

    setupBookmarkCardDrag(card, bm.id, {
        container: context.container || card.parentNode,
        categoryId: context.categoryId || appData.activeCategory,
        folderId: context.folderId || null
    });
    card.addEventListener('dragenter', () => {
        if (dragState.draggingId && isFolder) {
            card.classList.add('folder-drop-ready');
        }
    });
    card.addEventListener('dragleave', () => card.classList.remove('folder-drop-ready'));
    
    // 书签卡片右键菜单
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showBookmarkContextMenu(bm, context, e.clientX, e.clientY, card);
    });

    // 触屏长按弹出操作菜单（替代 hover 显示的编辑/删除按钮）
    let touchLongPressTimer = null;
    let touchDidLongPress = false;
    let touchStartPos = null;

    card.addEventListener('touchstart', (e) => {
        touchDidLongPress = false;
        const touch = e.touches[0];
        touchStartPos = { x: touch.clientX, y: touch.clientY };
        touchLongPressTimer = setTimeout(() => {
            touchDidLongPress = true;
            touchLongPressTimer = null;
            // 触发震动反馈（如果支持）
            if (navigator.vibrate) navigator.vibrate(30);
            showBookmarkContextMenu(bm, context, touch.clientX, touch.clientY, card);
        }, TOUCH_LONGPRESS_MS);
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
        if (touchLongPressTimer && touchStartPos) {
            const touch = e.touches[0];
            const dx = touch.clientX - touchStartPos.x;
            const dy = touch.clientY - touchStartPos.y;
            // 移动超过 10px 取消长按
            if (Math.sqrt(dx * dx + dy * dy) > 10) {
                clearTimeout(touchLongPressTimer);
                touchLongPressTimer = null;
            }
        }
    }, { passive: true });

    card.addEventListener('touchend', (e) => {
        if (touchLongPressTimer) {
            clearTimeout(touchLongPressTimer);
            touchLongPressTimer = null;
        }
        // 如果刚执行了长按操作，阻止后续 click 事件触发导航
        if (touchDidLongPress) {
            e.preventDefault();
            touchDidLongPress = false;
        }
    });

    card.addEventListener('touchcancel', () => {
        if (touchLongPressTimer) {
            clearTimeout(touchLongPressTimer);
            touchLongPressTimer = null;
        }
        touchDidLongPress = false;
    });
    
    return card;
}

async function openFolderModal(folderBookmark, options = {}) {
    if (!els.folderModal || !els.folderContent) return;
    const folderId = typeof folderBookmark === 'string' ? folderBookmark : folderBookmark?.id;
    if (!folderId) return;
    
    // 打开文件夹时，如果在不同层级则退出批量选择模式
    if (batchSelectState.enabled && batchSelectState.folderId !== folderId) {
        toggleBatchSelectMode(false);
    }
    
    try {
        const loc = findBookmarkLocation(folderId);
        if (!loc || loc.bookmark.type !== 'folder') {
            console.warn('找不到文件夹或类型不匹配:', folderId);
            return;
        }
        const anchorElement = options.anchorElement || findBookmarkCardElement(folderId);
        const anchorRect = options.anchorRect || anchorElement?.getBoundingClientRect() || resolveFolderAnchorRect(folderId);
        rememberFolderAnchor(folderId, anchorElement, anchorRect);
        openFolderId = loc.bookmark.id;
        openFolderCategoryId = loc.categoryId;
        els.folderModalTitle.textContent = loc.bookmark.title || '文件夹';
        updateFolderModalButton(loc);
        renderFolderContent(loc.bookmark.id, loc.categoryId);
        await animateModalVisibility(els.folderModal, { open: true, anchorRect });
    } catch (error) {
        console.error('打开文件夹失败', error);
        // 确保在出错时清理状态
        openFolderId = null;
        openFolderCategoryId = null;
    }
}

function renderFolderContent(folderId, fallbackCategoryId, options = {}) {
    if (!els.folderContent || !folderId) return;
    const loc = findBookmarkLocation(folderId);
    if (!loc || loc.bookmark.type !== 'folder') return;
    const categoryId = loc.categoryId || fallbackCategoryId || appData.activeCategory;
    const folderBookmark = loc.bookmark;
    ensureGridDropzone(els.folderContent, { categoryId, folderId: folderBookmark.id });
    renderBookmarkCollection(folderBookmark.children || [], els.folderContent, {
        categoryId,
        folderId: folderBookmark.id,
        scope: 'folder',
        ...options
    });
}

function refreshOpenFolderView(options = {}) {
    if (!openFolderId || !els.folderModal || els.folderModal.classList.contains('hidden')) return;
    const loc = findBookmarkLocation(openFolderId);
    if (!loc || loc.bookmark.type !== 'folder') {
        closeFolderModal();
        return;
    }
    openFolderCategoryId = loc.categoryId;
    els.folderModalTitle.textContent = loc.bookmark.title || '文件夹';
    updateFolderModalButton(loc);
    renderFolderContent(loc.bookmark.id, loc.categoryId, options);
}

function updateFolderModalButton(loc) {
    if (!els.closeFolderBtn) return;
    if (loc && loc.parentFolderId) {
        els.closeFolderBtn.textContent = '返回';
    } else {
        els.closeFolderBtn.textContent = '关闭';
    }
}

function closeFolderModal() {
    if (!els.folderModal || els.folderModal.classList.contains('hidden')) {
        // 已经关闭，直接返回 resolved Promise
        openFolderId = null;
        openFolderCategoryId = null;
        return Promise.resolve();
    }
    const anchorRect = resolveFolderAnchorRect(openFolderId);
    return animateModalVisibility(els.folderModal, {
        open: false,
        anchorRect,
        onHidden: () => {
            openFolderId = null;
            openFolderCategoryId = null;
            if (els.folderExitZone) {
                els.folderExitZone.classList.remove('dragover');
            }
        }
    });
}

function attachIconFallback(imgElement, bookmark) {
    const fallbackQueue = Array.isArray(bookmark.iconFallbacks) ? [...bookmark.iconFallbacks] : [];
    imgElement.onerror = () => {
        if (fallbackQueue.length) {
            const nextSrc = fallbackQueue.shift();
            imgElement.src = nextSrc;
        } else {
            imgElement.onerror = null;
            imgElement.src = 'icons/default.svg';
        }
    };
}

function createFolderIconGrid(folderBookmark) {
    const grid = document.createElement('div');
    grid.className = 'folder-icon-grid';
    const children = Array.isArray(folderBookmark.children) ? folderBookmark.children.slice(0, 4) : [];
    if (!children.length) {
        const placeholder = document.createElement('div');
        placeholder.className = 'folder-icon-placeholder';
        placeholder.textContent = '📂';
        grid.appendChild(placeholder);
        return grid;
    }
    children.forEach(child => {
        const cell = document.createElement('div');
        cell.className = 'folder-icon-cell';
        const img = document.createElement('img');
        const resolved = resolveBookmarkIconSource(child);
        img.src = resolved.primarySrc || 'icons/default.svg';
        attachIconFallback(img, { iconFallbacks: resolved.fallbackList });
        cell.appendChild(img);
        grid.appendChild(cell);
    });
    return grid;
}

function getDragPlaceholder() {
    if (!dragState.placeholder) {
        const ph = document.createElement('div');
        ph.className = 'bookmark-placeholder';
        dragState.placeholder = ph;
    }
    return dragState.placeholder;
}

function removeDragPlaceholder() {
    if (dragState.placeholder && dragState.placeholder.parentNode) {
        dragState.placeholder.parentNode.removeChild(dragState.placeholder);
    }
    dragState.lastPlaceholderTargetId = null;
    dragState.lastPlaceholderBefore = null;
    dragState.lastPlaceholderContainer = null;
    dragState.lastPlaceholderMoveTs = 0;
    dragState.mergeLockTargetId = null;
    dragState.mergeLockUntil = 0;
}

function positionPlaceholderNearCard(card, dropBefore = true) {
    if (dragState.mergeIntent || (dragState.mergeLockTargetId && performance.now() < dragState.mergeLockUntil)) return;
    const placeholder = getDragPlaceholder();
    const parent = card.parentNode;
    if (!parent) return;
    const now = performance.now();
    if (now - dragState.lastPlaceholderMoveTs < 80) return;
    if (
        dragState.lastPlaceholderContainer === parent &&
        dragState.lastPlaceholderTargetId === card.dataset.id &&
        dragState.lastPlaceholderBefore === dropBefore
    ) {
        return;
    }
    const referenceNode = dropBefore ? card : card.nextSibling;
    if (referenceNode === placeholder) return;
    const beforeRects = captureGridPositions(parent);
    parent.insertBefore(placeholder, referenceNode);
    animateGridShift(parent, beforeRects);
    dragState.lastPlaceholderContainer = parent;
    dragState.lastPlaceholderTargetId = card.dataset.id || null;
    dragState.lastPlaceholderBefore = dropBefore;
    dragState.lastPlaceholderMoveTs = now;
}

function positionPlaceholderAtEnd(container) {
    if (dragState.mergeIntent || (dragState.mergeLockTargetId && performance.now() < dragState.mergeLockUntil)) return;
    const placeholder = getDragPlaceholder();
    if (!container) return;
    const now = performance.now();
    if (now - dragState.lastPlaceholderMoveTs < 80) return;
    if (
        dragState.lastPlaceholderContainer === container &&
        dragState.lastPlaceholderTargetId === '__end' &&
        dragState.lastPlaceholderBefore === false
    ) {
        return;
    }
    const addBtn = container.querySelector('.add-bookmark-card');
    if (addBtn) {
        if (placeholder.nextSibling === addBtn && placeholder.parentNode === container) return;
        const beforeRects = captureGridPositions(container);
        container.insertBefore(placeholder, addBtn);
        animateGridShift(container, beforeRects);
    } else {
        if (placeholder.parentNode === container && placeholder.nextSibling === null) return;
        const beforeRects = captureGridPositions(container);
        container.appendChild(placeholder);
        animateGridShift(container, beforeRects);
    }
    dragState.lastPlaceholderContainer = container;
    dragState.lastPlaceholderTargetId = '__end';
    dragState.lastPlaceholderBefore = false;
    dragState.lastPlaceholderMoveTs = now;
}

function computeInsertIndexFromPlaceholder(container) {
    if (!container || !dragState.placeholder || !dragState.placeholder.parentNode) return -1;
    let index = 0;
    const children = Array.from(container.children);
    for (const child of children) {
        if (child === dragState.placeholder) {
            return index;
        }
        // 忽略正在拖拽的元素，因为它即将被移除，不应占用索引位置
        if (child.classList.contains('bookmark-card') && !child.classList.contains('dragging')) {
            index += 1;
        }
    }
    return -1;
}

function computeDropSide(rect, clientX, targetId) {
    const mid = rect.left + rect.width / 2;
    const hysteresis = rect.width * 0.2; // 加大滞后，避免中心附近抖动
    if (dragState.lastPlaceholderTargetId === targetId) {
        if (dragState.lastPlaceholderBefore) {
            return clientX < mid + hysteresis;
        }
        return clientX < mid - hysteresis;
    }
    return clientX < mid;
}

function captureGridPositions(container) {
    if (!container) return null;
    const map = new Map();
    Array.from(container.children).forEach(child => {
        const isCard = child.classList && (child.classList.contains('bookmark-card') || child.classList.contains('add-bookmark-card'));
        const isPlaceholder = child.classList && child.classList.contains('bookmark-placeholder');
        if (!isCard || isPlaceholder || child.classList.contains('dragging')) return;
        map.set(child, child.getBoundingClientRect());
    });
    return map;
}

// 使用轻量级 FLIP 动画，让占位符移动时邻居看起来被“挤开”
function animateGridShift(container, beforeRects) {
    if (!container || !beforeRects) return;
    const animated = [];
    beforeRects.forEach((prev, el) => {
        if (!el || !el.isConnected) return;
        const now = el.getBoundingClientRect();
        const dx = prev.left - now.left;
        const dy = prev.top - now.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        animated.push(el);
        requestAnimationFrame(() => {
            el.style.transition = 'transform 260ms cubic-bezier(0.25, 0.8, 0.25, 1)';
            el.style.transform = 'translate(0, 0)';
        });
    });
    if (!animated.length) return;
    setTimeout(() => {
        animated.forEach(el => {
            if (!el || !el.isConnected) return;
            if (el.style.transition === 'transform 260ms cubic-bezier(0.25, 0.8, 0.25, 1)') {
                el.style.transition = '';
            }
            if (el.style.transform === 'translate(0, 0)') {
                el.style.transform = '';
            }
        });
    }, 330);
}

function findClosestCardInGrid(container, x, y) {
    const cards = Array.from(container.querySelectorAll('.bookmark-card:not(.dragging)'));
    if (!cards.length) return null;

    let closest = null;
    let minDistance = Infinity;

    for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.hypot(x - cx, y - cy);
        
        if (dist < minDistance) {
            minDistance = dist;
            closest = card;
        }
    }

    if (closest) {
        const rect = closest.getBoundingClientRect();
        const dropBefore = computeDropSide(rect, x, closest.dataset.id || null);
        return { card: closest, dropBefore };
    }
    return null;
}

function ensureGridDropzone(container, context = {}) {
    if (!container) return;
    container.dataset.categoryId = context.categoryId || '';
    container.dataset.folderId = context.folderId || '';
    if (container.dataset.dropSetup === '1') return;
    container.addEventListener('dragover', (e) => {
        if (!dragState.draggingId) return;
        dragState.activeContainer = container;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragState.mergeLockTargetId && performance.now() < dragState.mergeLockUntil) return;
        
        if (dragState.placeholder && (e.target === dragState.placeholder || dragState.placeholder.contains(e.target))) return;

        const targetCard = e.target.closest('.bookmark-card');
        if (targetCard && targetCard.parentNode === container) {
            const rect = targetCard.getBoundingClientRect();
            // Grid 布局中，基于 X 轴中点判断插入位置更符合直觉
            const dropBefore = computeDropSide(rect, e.clientX, targetCard.dataset.id || null);
            positionPlaceholderNearCard(targetCard, dropBefore);
        } else {
            const closest = findClosestCardInGrid(container, e.clientX, e.clientY);
            if (closest) {
                positionPlaceholderNearCard(closest.card, closest.dropBefore);
            } else {
                positionPlaceholderAtEnd(container);
            }
        }
    });
    container.addEventListener('drop', (e) => handleGridDrop(e, container));
    container.dataset.dropSetup = '1';
}

function handleGridDrop(event, container) {
    event.preventDefault();
    if (!dragState.draggingId) return;
    if (dragState.dropHandled) {
        removeDragPlaceholder();
        return;
    }
    dragState.dropHandled = true;
    const targetCategoryId = (container && container.dataset.categoryId) || appData.activeCategory;
    const targetFolderId = (container && container.dataset.folderId) || null;
    const draggingLoc = findBookmarkLocation(dragState.draggingId);
    
    // 移除对文件夹内排序文件夹的限制
    /*
    if (draggingLoc && draggingLoc.bookmark && draggingLoc.bookmark.type === 'folder' && targetFolderId) {
        removeDragPlaceholder();
        return;
    }
    */

    const insertIndex = computeInsertIndexFromPlaceholder(container);
    if (insertIndex >= 0) {
        moveBookmarkTo(dragState.draggingId, targetCategoryId, targetFolderId || null, insertIndex);
    }
    removeDragPlaceholder();
}

function setupBookmarkCardDrag(card, bookmarkId, context = {}) {
    let longPressTimerId = null;
    
    const clearLongPress = () => {
        if (longPressTimerId) {
            clearTimeout(longPressTimerId);
            longPressTimerId = null;
        }
        card.classList.remove('drag-ready');
        if (!card.classList.contains('dragging')) {
            card.draggable = false;
        }
    };

    const startLongPress = (event) => {
        if (!shouldEnableDragByPointerType(event.pointerType)) {
            return;
        }
        // 批量选择模式下禁用拖拽
        if (batchSelectState.enabled) {
            return;
        }
        if ((event.pointerType === 'mouse' && event.button !== 0) || event.target.closest('.action-btn')) {
            return;
        }
        clearLongPress();
        longPressTimerId = setTimeout(() => {
            card.draggable = true;
            card.classList.add('drag-ready');
        }, DRAG_LONG_PRESS_MS);
    };

    card.addEventListener('pointerdown', startLongPress);
    card.addEventListener('pointerup', clearLongPress);
    card.addEventListener('pointerleave', clearLongPress);
    card.addEventListener('pointercancel', clearLongPress);

    card.addEventListener('dragstart', (e) => {
        if (!card.draggable) {
            e.preventDefault();
            return;
        }
        dragState.draggingId = bookmarkId;
        dragState.sourceCategoryId = context.categoryId || appData.activeCategory;
        dragState.sourceFolderId = context.folderId || null;
        dragState.activeContainer = context.container || card.parentNode;
        dragState.hoverTargetId = null;
        dragState.hoverStartTs = 0;
        dragState.mergeIntent = false;
        dragState.dropHandled = false;
        dragState.lastPlaceholderTargetId = null;
        dragState.lastPlaceholderBefore = null;
        dragState.lastPlaceholderContainer = null;
        dragState.mergeLockTargetId = null;
        dragState.mergeLockUntil = 0;
        dragState.lastPosition = { x: e.clientX, y: e.clientY };
        card.dataset.dragActive = '1';
        card.classList.add('dragging');
        
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', bookmarkId);

        // Move DOM manipulation to setTimeout to avoid interfering with drag start / drag image
        setTimeout(() => {
            card.classList.add('invisible-drag-source');
            // place a placeholder right after the dragged card to avoid layout jump
            if (card.parentNode) {
                const placeholder = getDragPlaceholder();
                card.parentNode.insertBefore(placeholder, card.nextSibling);
            }
        }, 0);
    });

    card.addEventListener('dragover', (e) => {
        if (!dragState.draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dragState.activeContainer = card.parentNode;
        updateHoverState(e, card);
        if (!dragState.mergeIntent) {
            const rect = card.getBoundingClientRect();
            // Grid 布局中，基于 X 轴中点判断插入位置更符合直觉
            const dropBefore = computeDropSide(rect, e.clientX, card.dataset.id || null);
            positionPlaceholderNearCard(card, dropBefore);
        }
    });

    card.addEventListener('drop', (e) => handleBookmarkDrop(e, bookmarkId, card, context));

    card.addEventListener('dragleave', () => {
        card.classList.remove('folder-drop-ready');
        if (card.dataset.id === dragState.hoverTargetId) {
            dragState.hoverTargetId = null;
            dragState.hoverStartTs = 0;
            dragState.mergeIntent = false;
            dragState.mergeLockTargetId = null;
            dragState.mergeLockUntil = 0;
        }
    });

    card.addEventListener('dragend', () => {
        dragState.draggingId = null;
        dragState.sourceCategoryId = null;
        dragState.sourceFolderId = null;
        dragState.activeContainer = null;
        dragState.hoverTargetId = null;
        dragState.hoverStartTs = 0;
        dragState.mergeIntent = false;
        dragState.dropHandled = false;
        dragState.lastPlaceholderTargetId = null;
        dragState.lastPlaceholderBefore = null;
        dragState.lastPlaceholderContainer = null;
        dragState.mergeLockTargetId = null;
        dragState.mergeLockUntil = 0;
        card.dataset.dragActive = '0';
        card.classList.remove('dragging', 'drag-ready', 'invisible-drag-source');
        card.draggable = false;
        document.querySelectorAll('.folder-drop-ready').forEach(el => el.classList.remove('folder-drop-ready'));
        if (els.folderExitZone) {
            els.folderExitZone.classList.remove('dragover');
        }
        removeDragPlaceholder();
        
        // 清理可能被移到 body 的拖拽元素
        if (card.parentNode === document.body) {
            // 不直接移除，让下一次渲染自然清理
            card.style.display = 'none';
        }
    });

    card.addEventListener('click', (e) => {
        if (card.dataset.dragActive === '1') {
            e.preventDefault();
            card.dataset.dragActive = '0';
        }
    });
}

function isDescendant(ancestorId, descendantId) {
    if (ancestorId === descendantId) return true;
    const loc = findBookmarkLocation(descendantId);
    if (!loc) return false;
    let current = loc.parentFolderId;
    while (current) {
        if (current === ancestorId) return true;
        const parentLoc = findBookmarkLocation(current);
        current = parentLoc ? parentLoc.parentFolderId : null;
    }
    return false;
}

function handleBookmarkDrop(event, targetBookmarkId, card, context = {}) {
    event.preventDefault();
    event.stopPropagation();
    const draggingId = dragState.draggingId;
    if (!draggingId || draggingId === targetBookmarkId) return;
    if (dragState.dropHandled) return;
    dragState.dropHandled = true;
    const targetLoc = findBookmarkLocation(targetBookmarkId);
    const draggingLoc = findBookmarkLocation(draggingId);
    if (!targetLoc || !draggingLoc) return;
    const targetBookmark = targetLoc.bookmark;
    const container = context.container || card?.parentNode || dragState.activeContainer;
    const dropCategoryId = (container && container.dataset.categoryId) || context.categoryId || targetLoc.categoryId || appData.activeCategory;
    const dropFolderId = (container && container.dataset.folderId) || context.folderId || targetLoc.parentFolderId || null;
    const canCreateFolderHere = true;

    if (dragState.mergeIntent && targetBookmark.id !== draggingId && targetBookmark.type !== 'folder' && canCreateFolderHere) {
        const newFolder = createFolderFromPair(targetLoc, draggingLoc);
        removeDragPlaceholder();
        if (newFolder) {
            openFolderModal(newFolder.id);
        }
        return;
    }

    if (targetBookmark.type === 'folder' && targetBookmark.id !== draggingId) {
        if (isDescendant(draggingId, targetBookmark.id)) {
            removeDragPlaceholder();
            return;
        }
        const moved = moveBookmarkIntoFolder(draggingId, targetBookmark.id);
        removeDragPlaceholder();
        if (moved) {
            openFolderModal(targetBookmark.id);
        }
        return;
    }

    if (canCreateFolderHere && shouldCreateFolder(event, card) && targetBookmark.type !== 'folder') {
        const newFolder = createFolderFromPair(targetLoc, draggingLoc);
        removeDragPlaceholder();
        if (newFolder) {
            openFolderModal(newFolder.id);
        }
        return;
    }

    if (dropFolderId && draggingLoc.bookmark.type === 'folder') {
        // Allow nesting, but check for circular dependency
        if (isDescendant(draggingId, dropFolderId)) {
            removeDragPlaceholder();
            return;
        }
    }

    const placeholderIndex = computeInsertIndexFromPlaceholder(container);
    if (placeholderIndex >= 0) {
        moveBookmarkTo(draggingId, dropCategoryId, dropFolderId || null, placeholderIndex);
    } else {
        // 如果找不到占位符（例如快速拖动导致），默认添加到列表末尾
        // 修复了此前引用不存在的 'card' 变量导致的崩溃问题
        const targetList = getBookmarkList(dropCategoryId, dropFolderId);
        const insertIndex = targetList ? targetList.length : 0;
        moveBookmarkTo(draggingId, dropCategoryId, dropFolderId || null, insertIndex);
    }
    removeDragPlaceholder();
}

function isFolderHoverZone(event, card, paddingRatio = 0.28) {
    if (!card || !event) return false;
    const rect = card.getBoundingClientRect();
    const padX = rect.width * paddingRatio;
    const padY = rect.height * paddingRatio;
    const insideX = event.clientX > rect.left + padX && event.clientX < rect.right - padX;
    const insideY = event.clientY > rect.top + padY && event.clientY < rect.bottom - padY;
    return insideX && insideY;
}

function updateHoverState(event, card) {
    if (!card || !dragState.draggingId) return;
    const targetId = card.dataset.id;
    if (!targetId || targetId === dragState.draggingId) {
        dragState.mergeIntent = false;
        card.classList.remove('folder-drop-ready');
        dragState.hoverTargetId = null;
        dragState.hoverStartTs = 0;
        dragState.mergeLockTargetId = null;
        dragState.mergeLockUntil = 0;
        return;
    }
    const now = performance.now();
    const lockActive = dragState.mergeLockTargetId === targetId && now < dragState.mergeLockUntil;
    if (lockActive) {
        dragState.mergeIntent = true;
        card.classList.add('folder-drop-ready');
        removeDragPlaceholder();
        return;
    }
    const isCenter = isFolderHoverZone(event, card, 0.34);
    if (dragState.hoverTargetId !== targetId) {
        dragState.hoverTargetId = targetId;
        dragState.hoverStartTs = now;
        dragState.mergeIntent = false;
        dragState.mergeLockTargetId = null;
        dragState.mergeLockUntil = 0;
        dragState.lastPlaceholderMoveTs = 0; // 重新计时，避免在新目标上立即抖动
    }
    const dwellMs = now - dragState.hoverStartTs;
    dragState.mergeIntent = isCenter && dwellMs >= 120;
    if (dragState.mergeIntent) {
        card.classList.add('folder-drop-ready');
        removeDragPlaceholder();
        dragState.mergeLockTargetId = targetId;
        dragState.mergeLockUntil = now + 220;
    } else {
        card.classList.remove('folder-drop-ready');
    }
}

function shouldCreateFolder(event, card) {
    if (!card) return false;
    return isFolderHoverZone(event, card, 0.28);
}

function createFolderFromPair(targetLoc, draggingLoc) {
    if (!targetLoc || !draggingLoc) return null;
    
    // 检查文件夹深度限制
    if (getFolderDepth(targetLoc.parentFolderId) >= 3) {
        return null;
    }

    const targetList = getBookmarkList(targetLoc.categoryId, targetLoc.parentFolderId);
    if (!targetList) return null;
    let insertIndex = targetLoc.index;
    if (draggingLoc.categoryId === targetLoc.categoryId && draggingLoc.parentFolderId === targetLoc.parentFolderId && draggingLoc.index < targetLoc.index) {
        insertIndex -= 1;
    }
    const removedTarget = removeBookmarkById(targetLoc.bookmark.id);
    const removedDragging = removeBookmarkById(draggingLoc.bookmark.id);
    const children = [];
    if (removedTarget?.bookmark) children.push(removedTarget.bookmark);
    if (removedDragging?.bookmark) children.push(removedDragging.bookmark);
    if (children.length < 2) return null;
    const folderTitle = targetLoc.bookmark.title || '新建文件夹';
    const folderBookmark = {
        id: generateId('folder'),
        title: folderTitle,
        type: 'folder',
        url: '#',
        iconType: 'custom',
        icon: targetLoc.bookmark.icon || 'icons/default.svg',
        iconFallbacks: [],
        children
    };
    normalizeFolderChildTitles(folderTitle, folderBookmark.children);
    insertBookmarkToList(targetList, Math.max(0, insertIndex), folderBookmark);
    // 拖拽创建文件夹是重要操作，立即保存
    saveData({ immediate: true });
    renderApp({ skipAnimation: true });
    refreshOpenFolderView({ skipAnimation: true });
    return folderBookmark;
}

function moveBookmarkIntoFolder(bookmarkId, folderId) {
    if (isDescendant(bookmarkId, folderId)) return false;
    const folderLoc = findBookmarkLocation(folderId);
    if (!folderLoc || folderLoc.bookmark.type !== 'folder') return false;

    // 检查文件夹深度限制
    const sourceLoc = findBookmarkLocation(bookmarkId);
    if (sourceLoc && sourceLoc.bookmark.type === 'folder') {
        if (getFolderDepth(folderId) >= 3) {
            return false;
        }
    }

    const removal = removeBookmarkById(bookmarkId);
    if (!removal || removal.bookmark.id === folderId) return false;
    if (removal.parentFolderId === folderId) return false;
    // Removed restriction: if (removal.bookmark.type === 'folder') return false;
    folderLoc.bookmark.children = Array.isArray(folderLoc.bookmark.children) ? folderLoc.bookmark.children : [];
    insertBookmarkToList(folderLoc.bookmark.children, folderLoc.bookmark.children.length, removal.bookmark);
    
    if (removal.parentFolderId && removal.parentFolderId !== folderId) {
        checkAndRemoveEmptyFolder(removal.parentFolderId, removal.categoryId);
    }

    normalizeFolderChildTitles(folderLoc.bookmark.title, folderLoc.bookmark.children);
    // 移动书签到文件夹是重要操作，立即保存
    saveData({ immediate: true });
    renderApp({ skipAnimation: true });
    refreshOpenFolderView({ skipAnimation: true });
    return true;
}

function bindFolderExitDropzone() {
    if (els.folderModal) {
        const contentEl = els.folderModal.querySelector('.modal-content');
        els.folderModal.addEventListener('dragover', (e) => {
            if (!dragState.draggingId) return;
            if (contentEl && contentEl.contains(e.target)) return;
            e.preventDefault();
        });
        els.folderModal.addEventListener('drop', (e) => {
            if (!dragState.draggingId) return;
            if (contentEl && contentEl.contains(e.target)) return;
            e.preventDefault();
            // 暂时禁用拖拽到遮罩层移出文件夹的功能，防止误触导致图标“掉出去”
            /*
            if (openFolderCategoryId) {
                moveBookmarkTo(dragState.draggingId, openFolderCategoryId, null);
                removeDragPlaceholder();
            }
            */
        });
    }
}
// --- 业务逻辑 ---

// --- 右键菜单 ---
function showCategoryContextMenu(categoryId, x, y) {
    // 移除已有的所有右键菜单
    hideCategoryContextMenu();
    hideBookmarkContextMenu();
    hideGridContextMenu();
    hideBatchMoveMenu();
    
    const cat = getCategoryById(categoryId);
    if (!cat) return;
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'categoryContextMenu';
    
    // 重命名选项
    const renameItem = document.createElement('div');
    renameItem.className = 'context-menu-item';
    renameItem.innerHTML = '<span class="context-menu-icon">✎</span>重命名';
    renameItem.onclick = () => {
        hideCategoryContextMenu();
        enableCategoryRename(categoryId);
    };
    menu.appendChild(renameItem);
    
    // 删除选项（只有多于一个分类时才显示）
    if (appData.categories.length > 1) {
        const deleteItem = document.createElement('div');
        deleteItem.className = 'context-menu-item danger';
        deleteItem.innerHTML = '<span class="context-menu-icon">×</span>删除分类';
        deleteItem.onclick = () => {
            hideCategoryContextMenu();
            deleteCategory(categoryId);
        };
        menu.appendChild(deleteItem);
    }
    
    document.body.appendChild(menu);
    
    // 调整菜单位置，确保不超出屏幕
    adjustMenuPosition(menu, x, y);
    
    // 点击其他位置关闭菜单
    setTimeout(() => {
        addCategoryContextMenuListeners();
    }, 0);
}

// 分类右键菜单事件监听器管理
let categoryContextMenuClickHandler = null;
let categoryContextMenuContextHandler = null;

function addCategoryContextMenuListeners() {
    removeCategoryContextMenuListeners();
    categoryContextMenuClickHandler = (e) => {
        const menu = document.getElementById('categoryContextMenu');
        if (menu && !menu.contains(e.target)) {
            hideCategoryContextMenu();
        }
    };
    categoryContextMenuContextHandler = (e) => {
        const menu = document.getElementById('categoryContextMenu');
        if (menu && !menu.contains(e.target)) {
            hideCategoryContextMenu();
        }
    };
    document.addEventListener('click', categoryContextMenuClickHandler);
    document.addEventListener('contextmenu', categoryContextMenuContextHandler);
}

function removeCategoryContextMenuListeners() {
    if (categoryContextMenuClickHandler) {
        document.removeEventListener('click', categoryContextMenuClickHandler);
        categoryContextMenuClickHandler = null;
    }
    if (categoryContextMenuContextHandler) {
        document.removeEventListener('contextmenu', categoryContextMenuContextHandler);
        categoryContextMenuContextHandler = null;
    }
}

function hideCategoryContextMenu() {
    removeCategoryContextMenuListeners();
    const menu = document.getElementById('categoryContextMenu');
    if (menu) {
        menu.remove();
    }
}

function enableCategoryRename(categoryId) {
    const cat = getCategoryById(categoryId);
    if (!cat) return;
    
    const li = els.categoryList.querySelector(`li[data-id="${categoryId}"]`);
    if (!li) return;
    
    const currentName = cat.name;
    const delBtn = li.querySelector('.delete-cat');
    
    // 隐藏删除按钮
    if (delBtn) {
        delBtn.style.display = 'none';
    }
    
    // 清空 li 内容，创建输入框
    li.textContent = '';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'category-rename-input';
    li.appendChild(input);
    
    // 恢复删除按钮节点（隐藏状态）
    if (delBtn) {
        li.appendChild(delBtn);
    }
    
    input.focus();
    input.select();
    
    const save = () => {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
            cat.name = newName;
            // 重命名是用户主动操作，立即保存
            saveData({ immediate: true });
        }
        cleanup();
        renderCategories({ skipAnimation: true });
    };
    
    const cleanup = () => {
        input.removeEventListener('blur', save);
        input.removeEventListener('keydown', handleKeydown);
    };
    
    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            cleanup();
            renderCategories({ skipAnimation: true });
        }
    };
    
    input.addEventListener('blur', save);
    input.addEventListener('keydown', handleKeydown);
}

// 通用菜单位置调整函数，确保菜单不超出屏幕边界
// 智能决定菜单的展开方向：优先向右下展开，空间不足时向反方向展开
function adjustMenuPosition(menu, x, y) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 8;
    
    // 先临时设置位置以获取真实尺寸（不要立即限制maxHeight，让它先按自然高度渲染）
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.visibility = 'hidden';
    
    // 强制重排以获取准确尺寸
    const menuRect = menu.getBoundingClientRect();
    let menuWidth = menuRect.width;
    let menuHeight = menuRect.height;
    
    menu.style.visibility = '';
    
    // 计算可用的最大尺寸
    const maxWidth = viewportWidth - padding * 2;
    const maxHeight = viewportHeight - padding * 2;
    
    // 如果菜单超出视口，则限制其尺寸
    if (menuWidth > maxWidth) {
        menu.style.maxWidth = `${maxWidth}px`;
        menuWidth = maxWidth;
    }
    if (menuHeight > maxHeight) {
        menu.style.maxHeight = `${maxHeight}px`;
        menu.style.overflowY = 'auto';
        menuHeight = maxHeight;
    }
    
    let finalX, finalY;
    
    // 水平方向：计算右侧和左侧的可用空间
    const spaceRight = viewportWidth - x - padding;
    const spaceLeft = x - padding;
    
    if (menuWidth <= spaceRight) {
        // 右侧空间足够，向右展开
        finalX = x;
    } else if (menuWidth <= spaceLeft) {
        // 右侧不够但左侧够，向左展开
        finalX = x - menuWidth;
    } else {
        // 两侧都不够，靠近空间大的一侧并贴边
        if (spaceRight >= spaceLeft) {
            finalX = viewportWidth - menuWidth - padding;
        } else {
            finalX = padding;
        }
    }
    
    // 垂直方向：计算下方和上方的可用空间
    const spaceBottom = viewportHeight - y - padding;
    const spaceTop = y - padding;
    
    if (menuHeight <= spaceBottom) {
        // 下方空间足够，向下展开
        finalY = y;
    } else if (menuHeight <= spaceTop) {
        // 下方不够但上方够，向上展开
        finalY = y - menuHeight;
    } else {
        // 上下空间都不够放置完整菜单
        // 将菜单放在空间较大的一侧，并确保不超出边界
        if (spaceBottom >= spaceTop) {
            // 下方空间更大，从点击位置向下展开，但限制高度
            finalY = y;
            const availableHeight = viewportHeight - y - padding;
            if (menuHeight > availableHeight) {
                menu.style.maxHeight = `${availableHeight}px`;
                menu.style.overflowY = 'auto';
            }
        } else {
            // 上方空间更大，从顶部开始，向下延伸到点击位置
            finalY = padding;
            const availableHeight = y - padding;
            if (menuHeight > availableHeight) {
                menu.style.maxHeight = `${availableHeight}px`;
                menu.style.overflowY = 'auto';
            }
        }
    }
    
    // 最终边界检查，确保不会出现负值或超出视口
    finalX = Math.max(padding, finalX);
    finalY = Math.max(padding, finalY);
    
    // 确保菜单右边和下边不超出
    if (finalX + menuWidth > viewportWidth - padding) {
        finalX = viewportWidth - menuWidth - padding;
    }
    if (finalY + menuHeight > viewportHeight - padding) {
        finalY = viewportHeight - menuHeight - padding;
    }
    
    // 再次确保不为负
    finalX = Math.max(padding, finalX);
    finalY = Math.max(padding, finalY);
    
    menu.style.left = `${finalX}px`;
    menu.style.top = `${finalY}px`;
}

// --- 批量选择相关函数 ---
function toggleBatchSelectMode(enable = !batchSelectState.enabled) {
    batchSelectState.enabled = enable;
    if (!enable) {
        clearBatchSelection();
    }
    updateBatchSelectUI();
}

function clearBatchSelection() {
    batchSelectState.selectedIds.clear();
    batchSelectState.categoryId = null;
    batchSelectState.folderId = null;
    document.querySelectorAll('.bookmark-card.batch-selected').forEach(card => {
        card.classList.remove('batch-selected');
    });
    updateBatchStatusBar();
}

function toggleBookmarkSelection(bookmarkId, card) {
    if (!batchSelectState.enabled) return;
    
    const loc = findBookmarkLocation(bookmarkId);
    if (!loc) return;
    
    // 确保只能选择同一层级的书签
    if (batchSelectState.selectedIds.size > 0) {
        if (batchSelectState.categoryId !== loc.categoryId || 
            batchSelectState.folderId !== loc.parentFolderId) {
            // 不同层级，先清除之前的选择
            clearBatchSelection();
        }
    }
    
    if (batchSelectState.selectedIds.has(bookmarkId)) {
        batchSelectState.selectedIds.delete(bookmarkId);
        card.classList.remove('batch-selected');
    } else {
        batchSelectState.selectedIds.add(bookmarkId);
        batchSelectState.categoryId = loc.categoryId;
        batchSelectState.folderId = loc.parentFolderId;
        card.classList.add('batch-selected');
    }
    
    updateBatchStatusBar();
}

function updateBatchSelectUI() {
    const container = document.querySelector('.container');
    if (batchSelectState.enabled) {
        container.classList.add('batch-select-mode');
        document.body.classList.add('batch-select-active');
        showBatchStatusBar();
    } else {
        container.classList.remove('batch-select-mode');
        document.body.classList.remove('batch-select-active');
        hideBatchStatusBar();
    }
    
    // 更新所有卡片的选择状态（包括文件夹模态框内的）
    document.querySelectorAll('.bookmark-card').forEach(card => {
        if (batchSelectState.enabled) {
            card.classList.add('batch-selectable');
        } else {
            card.classList.remove('batch-selectable', 'batch-selected');
        }
    });
}

function showBatchStatusBar() {
    let bar = document.getElementById('batchStatusBar');
    if (!bar) {
        bar = createBatchStatusBar();
        document.body.appendChild(bar);
    }
    bar.classList.remove('hidden');
    updateBatchStatusBar();
}

function hideBatchStatusBar() {
    const bar = document.getElementById('batchStatusBar');
    if (bar) {
        bar.classList.add('hidden');
    }
}

function createBatchStatusBar() {
    const bar = document.createElement('div');
    bar.id = 'batchStatusBar';
    bar.className = 'batch-status-bar';
    
    const countSpan = document.createElement('span');
    countSpan.className = 'batch-count';
    countSpan.textContent = '已选择 0 项';
    
    const selectAllBtn = document.createElement('button');
    selectAllBtn.className = 'batch-action-btn';
    selectAllBtn.textContent = '全选';
    selectAllBtn.onclick = () => batchSelectAll();
    
    const tipSpan = document.createElement('span');
    tipSpan.className = 'batch-tip';
    tipSpan.textContent = '右键选中项进行操作';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'batch-cancel-btn';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => toggleBatchSelectMode(false);
    
    bar.appendChild(countSpan);
    bar.appendChild(selectAllBtn);
    bar.appendChild(tipSpan);
    bar.appendChild(cancelBtn);
    
    return bar;
}

function updateBatchStatusBar() {
    const bar = document.getElementById('batchStatusBar');
    if (!bar) return;
    
    const count = batchSelectState.selectedIds.size;
    const countSpan = bar.querySelector('.batch-count');
    if (countSpan) {
        countSpan.textContent = `已选择 ${count} 项`;
    }
    
    // 更新全选按钮状态
    const selectAllBtn = bar.querySelector('.batch-action-btn');
    if (selectAllBtn) {
        const totalCount = getCurrentViewBookmarkCount();
        const allSelected = count > 0 && count === totalCount;
        selectAllBtn.textContent = allSelected ? '取消全选' : '全选';
        selectAllBtn.onclick = allSelected ? () => clearBatchSelection() : () => batchSelectAll();
    }
}

// 获取当前视图中的书签数量
function getCurrentViewBookmarkCount() {
    // 如果在文件夹内
    if (openFolderId && els.folderModal && !els.folderModal.classList.contains('hidden')) {
        const loc = findBookmarkLocation(openFolderId);
        if (loc && loc.bookmark.type === 'folder') {
            return (loc.bookmark.children || []).length;
        }
    }
    // 否则是根分类
    const currentCat = getActiveCategory();
    return currentCat ? (currentCat.bookmarks || []).length : 0;
}

// 全选当前视图中的所有书签
function batchSelectAll() {
    if (!batchSelectState.enabled) return;
    
    let bookmarks = [];
    let categoryId = appData.activeCategory;
    let folderId = null;
    
    // 如果在文件夹内
    if (openFolderId && els.folderModal && !els.folderModal.classList.contains('hidden')) {
        const loc = findBookmarkLocation(openFolderId);
        if (loc && loc.bookmark.type === 'folder') {
            bookmarks = loc.bookmark.children || [];
            categoryId = loc.categoryId;
            folderId = openFolderId;
        }
    } else {
        // 根分类
        const currentCat = getActiveCategory();
        if (currentCat) {
            bookmarks = currentCat.bookmarks || [];
            categoryId = currentCat.id;
        }
    }
    
    // 清除之前的选择
    batchSelectState.selectedIds.clear();
    batchSelectState.categoryId = categoryId;
    batchSelectState.folderId = folderId;
    
    // 选中所有书签
    bookmarks.forEach(bm => {
        if (bm && bm.id) {
            batchSelectState.selectedIds.add(bm.id);
        }
    });
    
    // 更新UI
    document.querySelectorAll('.bookmark-card').forEach(card => {
        const id = card.dataset.id;
        if (batchSelectState.selectedIds.has(id)) {
            card.classList.add('batch-selected');
        } else {
            card.classList.remove('batch-selected');
        }
    });
    
    updateBatchStatusBar();
}

// 书签右键菜单
function showBookmarkContextMenu(bm, context, x, y, card) {
    hideBookmarkContextMenu();
    hideGridContextMenu();
    hideBatchMoveMenu();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'bookmarkContextMenu';
    
    // 保存原始右键位置，供子菜单使用
    const originalX = x;
    const originalY = y;
    
    const isFolder = bm.type === 'folder';
    
    // 批量选择模式下的菜单
    if (batchSelectState.enabled && batchSelectState.selectedIds.size > 0) {
        const count = batchSelectState.selectedIds.size;
        
        // 创建文件夹（至少2个）
        if (count >= 2) {
            const createFolderItem = document.createElement('div');
            createFolderItem.className = 'context-menu-item';
            createFolderItem.innerHTML = '<span class="context-menu-icon">📁</span>创建文件夹';
            createFolderItem.onclick = () => {
                hideBookmarkContextMenu();
                batchCreateFolder();
            };
            menu.appendChild(createFolderItem);
        }
        
        // 移动到分类/文件夹
        const moveItem = document.createElement('div');
        moveItem.className = 'context-menu-item';
        moveItem.innerHTML = '<span class="context-menu-icon">📂</span>移动到...';
        moveItem.onclick = (e) => {
            // 先移除当前菜单的事件监听器，防止影响下一个菜单
            removeBookmarkContextMenuListeners();
            hideBookmarkContextMenu();
            // 使用setTimeout确保当前菜单完全关闭后再打开新菜单
            // 使用原始右键位置而不是点击菜单项的位置
            setTimeout(() => {
                showBatchMoveMenuAt(originalX, originalY);
            }, 0);
        };
        menu.appendChild(moveItem);
        
        // 分隔线
        const divider1 = document.createElement('div');
        divider1.className = 'context-menu-divider';
        menu.appendChild(divider1);
        
        // 批量删除
        const deleteItem = document.createElement('div');
        deleteItem.className = 'context-menu-item danger';
        deleteItem.innerHTML = '<span class="context-menu-icon">×</span>删除所选项';
        deleteItem.onclick = () => {
            hideBookmarkContextMenu();
            batchDeleteSelected();
        };
        menu.appendChild(deleteItem);
        
        // 分隔线
        const divider2 = document.createElement('div');
        divider2.className = 'context-menu-divider';
        menu.appendChild(divider2);
        
        // 取消选择
        const cancelItem = document.createElement('div');
        cancelItem.className = 'context-menu-item';
        cancelItem.innerHTML = '<span class="context-menu-icon">✕</span>取消选择';
        cancelItem.onclick = () => {
            hideBookmarkContextMenu();
            toggleBatchSelectMode(false);
        };
        menu.appendChild(cancelItem);
    } else {
        // 普通模式下的菜单
        // 编辑
        const editItem = document.createElement('div');
        editItem.className = 'context-menu-item';
        editItem.innerHTML = '<span class="context-menu-icon">✎</span>编辑';
        editItem.onclick = () => {
            hideBookmarkContextMenu();
            openEditBookmarkModal(bm, context);
        };
        menu.appendChild(editItem);
        
        // 批量选择
        const batchItem = document.createElement('div');
        batchItem.className = 'context-menu-item';
        batchItem.innerHTML = '<span class="context-menu-icon">☑</span>批量选择';
        batchItem.onclick = () => {
            hideBookmarkContextMenu();
            toggleBatchSelectMode(true);
            toggleBookmarkSelection(bm.id, card);
        };
        menu.appendChild(batchItem);
        
        // 分隔线
        const divider = document.createElement('div');
        divider.className = 'context-menu-divider';
        menu.appendChild(divider);
        
        // 删除
        const deleteItem = document.createElement('div');
        deleteItem.className = 'context-menu-item danger';
        deleteItem.innerHTML = '<span class="context-menu-icon">×</span>删除';
        deleteItem.onclick = () => {
            hideBookmarkContextMenu();
            deleteBookmark(bm.id);
        };
        menu.appendChild(deleteItem);
    }
    
    document.body.appendChild(menu);
    
    // 调整菜单位置
    adjustMenuPosition(menu, x, y);
    
    // 使用命名函数以便后续移除
    setTimeout(() => {
        addBookmarkContextMenuListeners();
    }, 0);
}

// 书签右键菜单事件监听器管理
let bookmarkContextMenuClickHandler = null;
let bookmarkContextMenuContextHandler = null;

function addBookmarkContextMenuListeners() {
    removeBookmarkContextMenuListeners();
    bookmarkContextMenuClickHandler = (e) => {
        const menu = document.getElementById('bookmarkContextMenu');
        if (menu && !menu.contains(e.target)) {
            hideBookmarkContextMenu();
        }
    };
    bookmarkContextMenuContextHandler = (e) => {
        const menu = document.getElementById('bookmarkContextMenu');
        if (menu && !menu.contains(e.target)) {
            hideBookmarkContextMenu();
        }
    };
    document.addEventListener('click', bookmarkContextMenuClickHandler);
    document.addEventListener('contextmenu', bookmarkContextMenuContextHandler);
}

function removeBookmarkContextMenuListeners() {
    if (bookmarkContextMenuClickHandler) {
        document.removeEventListener('click', bookmarkContextMenuClickHandler);
        bookmarkContextMenuClickHandler = null;
    }
    if (bookmarkContextMenuContextHandler) {
        document.removeEventListener('contextmenu', bookmarkContextMenuContextHandler);
        bookmarkContextMenuContextHandler = null;
    }
}

function hideBookmarkContextMenu() {
    removeBookmarkContextMenuListeners();
    const menu = document.getElementById('bookmarkContextMenu');
    if (menu) {
        menu.remove();
    }
}

function hideBookmarkContextMenuOnOutside(e) {
    const menu = document.getElementById('bookmarkContextMenu');
    if (menu && !menu.contains(e.target)) {
        hideBookmarkContextMenu();
    }
}

// 空白区域右键菜单
function showGridContextMenu(x, y, context = {}) {
    hideGridContextMenu();
    hideBookmarkContextMenu();
    hideCategoryContextMenu();
    hideBatchMoveMenu();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'gridContextMenu';
    
    const categoryId = context.categoryId || appData.activeCategory;
    const folderId = context.folderId || null;
    
    // 添加书签
    const addBookmarkItem = document.createElement('div');
    addBookmarkItem.className = 'context-menu-item';
    addBookmarkItem.innerHTML = '<span class="context-menu-icon">➕</span>添加书签';
    addBookmarkItem.onclick = () => {
        hideGridContextMenu();
        openAddBookmarkModal({
            type: 'link',
            categoryId,
            folderId
        });
    };
    menu.appendChild(addBookmarkItem);
    
    // 新建文件夹（不在文件夹内时才显示）
    if (!folderId) {
        const addFolderItem = document.createElement('div');
        addFolderItem.className = 'context-menu-item';
        addFolderItem.innerHTML = '<span class="context-menu-icon">📁</span>新建文件夹';
        addFolderItem.onclick = () => {
            hideGridContextMenu();
            openAddBookmarkModal({
                type: 'folder',
                categoryId,
                folderId: null
            });
        };
        menu.appendChild(addFolderItem);
    }
    
    // 分隔线
    const divider = document.createElement('div');
    divider.className = 'context-menu-divider';
    menu.appendChild(divider);
    
    // 打开设置
    const settingsItem = document.createElement('div');
    settingsItem.className = 'context-menu-item';
    settingsItem.innerHTML = '<span class="context-menu-icon">⚙️</span>设置';
    settingsItem.onclick = () => {
        hideGridContextMenu();
        openSettingsModal();
    };
    menu.appendChild(settingsItem);
    
    document.body.appendChild(menu);
    
    // 调整菜单位置
    adjustMenuPosition(menu, x, y);
    
    setTimeout(() => {
        addGridContextMenuListeners();
    }, 0);
}

// 空白区域右键菜单事件监听器管理
let gridContextMenuClickHandler = null;
let gridContextMenuContextHandler = null;

function addGridContextMenuListeners() {
    removeGridContextMenuListeners();
    gridContextMenuClickHandler = (e) => {
        const menu = document.getElementById('gridContextMenu');
        if (menu && !menu.contains(e.target)) {
            hideGridContextMenu();
        }
    };
    gridContextMenuContextHandler = (e) => {
        const menu = document.getElementById('gridContextMenu');
        if (menu && !menu.contains(e.target)) {
            hideGridContextMenu();
        }
    };
    document.addEventListener('click', gridContextMenuClickHandler);
    document.addEventListener('contextmenu', gridContextMenuContextHandler);
}

function removeGridContextMenuListeners() {
    if (gridContextMenuClickHandler) {
        document.removeEventListener('click', gridContextMenuClickHandler);
        gridContextMenuClickHandler = null;
    }
    if (gridContextMenuContextHandler) {
        document.removeEventListener('contextmenu', gridContextMenuContextHandler);
        gridContextMenuContextHandler = null;
    }
}

function hideGridContextMenu() {
    removeGridContextMenuListeners();
    const menu = document.getElementById('gridContextMenu');
    if (menu) {
        menu.remove();
    }
}

function hideGridContextMenuOnOutside(e) {
    const menu = document.getElementById('gridContextMenu');
    if (menu && !menu.contains(e.target)) {
        hideGridContextMenu();
    }
}

function showBatchMoveMenuAt(x, y) {
    const selectedIds = Array.from(batchSelectState.selectedIds);
    if (selectedIds.length === 0) return;
    
    // 先关闭所有其他菜单
    hideBatchMoveMenu();
    hideBookmarkContextMenu();
    hideGridContextMenu();
    hideCategoryContextMenu();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu batch-move-menu';
    menu.id = 'batchMoveMenu';
    
    // 收集所有选中的书签ID，用于排除不能作为目标的文件夹
    const selectedIdSet = new Set(selectedIds);
    
    appData.categories.forEach(cat => {
        // 分类标题
        const catItem = document.createElement('div');
        catItem.className = 'context-menu-item category-item';
        const isCurrent = cat.id === batchSelectState.categoryId && !batchSelectState.folderId;
        if (isCurrent) {
            catItem.classList.add('current');
            catItem.innerHTML = `<span class="context-menu-icon">✓</span>${cat.name}`;
        } else {
            catItem.innerHTML = `<span class="context-menu-icon">📂</span>${cat.name}`;
            catItem.onclick = () => {
                hideBatchMoveMenu();
                batchMoveToTarget(cat.id, null);
            };
        }
        menu.appendChild(catItem);
        
        // 该分类下的文件夹
        const folders = (cat.bookmarks || []).filter(b => b.type === 'folder');
        folders.forEach(folder => {
            // 排除被选中的文件夹和当前所在的文件夹
            if (selectedIdSet.has(folder.id)) return;
            const isFolderCurrent = cat.id === batchSelectState.categoryId && folder.id === batchSelectState.folderId;
            
            const folderItem = document.createElement('div');
            folderItem.className = 'context-menu-item folder-item';
            if (isFolderCurrent) {
                folderItem.classList.add('current');
                folderItem.innerHTML = `<span class="context-menu-icon">✓</span><span class="folder-indent"></span>📁 ${folder.title}`;
            } else {
                folderItem.innerHTML = `<span class="context-menu-icon"></span><span class="folder-indent"></span>📁 ${folder.title}`;
                folderItem.onclick = () => {
                    hideBatchMoveMenu();
                    batchMoveToTarget(cat.id, folder.id);
                };
            }
            menu.appendChild(folderItem);
        });
    });
    
    document.body.appendChild(menu);
    
    // 调整菜单位置
    adjustMenuPosition(menu, x, y);
    
    setTimeout(() => {
        addBatchMoveMenuListeners();
    }, 0);
}

// 批量移动菜单事件监听器管理
let batchMoveMenuClickHandler = null;
let batchMoveMenuContextHandler = null;

function addBatchMoveMenuListeners() {
    removeBatchMoveMenuListeners();
    batchMoveMenuClickHandler = (e) => {
        const menu = document.getElementById('batchMoveMenu');
        if (menu && !menu.contains(e.target)) {
            hideBatchMoveMenu();
        }
    };
    batchMoveMenuContextHandler = (e) => {
        const menu = document.getElementById('batchMoveMenu');
        if (menu && !menu.contains(e.target)) {
            hideBatchMoveMenu();
        }
    };
    document.addEventListener('click', batchMoveMenuClickHandler);
    document.addEventListener('contextmenu', batchMoveMenuContextHandler);
}

function removeBatchMoveMenuListeners() {
    if (batchMoveMenuClickHandler) {
        document.removeEventListener('click', batchMoveMenuClickHandler);
        batchMoveMenuClickHandler = null;
    }
    if (batchMoveMenuContextHandler) {
        document.removeEventListener('contextmenu', batchMoveMenuContextHandler);
        batchMoveMenuContextHandler = null;
    }
}

function batchCreateFolder() {
    const selectedIds = Array.from(batchSelectState.selectedIds);
    if (selectedIds.length < 2) {
        alert('请至少选择 2 个书签来创建文件夹');
        return;
    }
    
    const folderName = prompt('请输入文件夹名称：', '新文件夹');
    if (!folderName || !folderName.trim()) return;
    
    const categoryId = batchSelectState.categoryId;
    const parentFolderId = batchSelectState.folderId;
    
    // 检查文件夹深度
    const currentDepth = parentFolderId ? getFolderDepth(parentFolderId) : 0;
    if (currentDepth >= 3) {
        alert('文件夹最多只能嵌套 3 级');
        return;
    }
    
    // 获取第一个选中项的位置作为新文件夹的位置
    const firstLoc = findBookmarkLocation(selectedIds[0]);
    if (!firstLoc) return;
    
    // 收集所有选中的书签
    const bookmarksToMove = [];
    for (const id of selectedIds) {
        const loc = findBookmarkLocation(id);
        if (loc) {
            bookmarksToMove.push({ ...loc.bookmark });
        }
    }
    
    // 从原位置移除书签
    for (const id of selectedIds) {
        removeBookmarkById(id);
    }
    
    // 创建新文件夹
    const newFolder = {
        id: generateId('folder'),
        type: 'folder',
        title: folderName.trim(),
        children: bookmarksToMove
    };
    
    // 获取目标列表
    const targetList = getBookmarkList(categoryId, parentFolderId);
    if (targetList) {
        targetList.splice(Math.min(firstLoc.index, targetList.length), 0, newFolder);
    }
    
    // 批量操作是重要操作，立即保存
    saveData({ immediate: true });
    toggleBatchSelectMode(false);
    renderApp({ skipAnimation: true });
    refreshOpenFolderView({ skipAnimation: true });
}

// 批量删除选中的书签
async function batchDeleteSelected() {
    const selectedIds = Array.from(batchSelectState.selectedIds);
    if (selectedIds.length === 0) return;
    
    const count = selectedIds.length;
    const confirmMsg = count === 1 
        ? '确定删除所选书签吗？' 
        : `确定删除所选的 ${count} 个书签吗？`;
    
    const confirmed = await showConfirmDialog(confirmMsg, { danger: true, confirmText: '删除' });
    if (!confirmed) return;
    
    const sourceFolderId = batchSelectState.folderId;
    const sourceCategoryId = batchSelectState.categoryId;
    
    // 删除所有选中的书签
    for (const id of selectedIds) {
        removeBookmarkById(id);
    }
    
    // 检查源文件夹是否需要清理（变空或只剩一个）
    if (sourceFolderId) {
        checkAndRemoveEmptyFolder(sourceFolderId, sourceCategoryId);
    }
    
    // 批量操作是重要操作，立即保存
    saveData({ immediate: true });
    toggleBatchSelectMode(false);
    renderApp({ skipAnimation: true });
    refreshOpenFolderView({ skipAnimation: true });
}

function hideBatchMoveMenu() {
    removeBatchMoveMenuListeners();
    const menu = document.getElementById('batchMoveMenu');
    if (menu) {
        menu.remove();
    }
}

function batchMoveToCategory(targetCategoryId) {
    batchMoveToTarget(targetCategoryId, null);
}

function batchMoveToTarget(targetCategoryId, targetFolderId) {
    const selectedIds = Array.from(batchSelectState.selectedIds);
    if (selectedIds.length === 0) return;
    
    const sourceFolderId = batchSelectState.folderId;
    const sourceCategoryId = batchSelectState.categoryId;
    
    // 移动所有选中的书签
    for (const id of selectedIds) {
        const loc = findBookmarkLocation(id);
        if (loc) {
            const bookmark = removeBookmarkAtLocation(loc);
            if (bookmark) {
                const targetList = getBookmarkList(targetCategoryId, targetFolderId);
                if (targetList) {
                    targetList.push(bookmark);
                }
            }
        }
    }
    
    // 检查源文件夹是否需要清理（变空或只剩一个）
    if (sourceFolderId) {
        checkAndRemoveEmptyFolder(sourceFolderId, sourceCategoryId);
    }
    
    // 批量操作是重要操作，立即保存
    saveData({ immediate: true });
    toggleBatchSelectMode(false);
    
    // 如果移动到了其他分类，切换到该分类
    if (targetCategoryId !== appData.activeCategory) {
        appData.activeCategory = targetCategoryId;
        saveData({ immediate: true });
    }
    
    // 如果移动到了文件夹，打开该文件夹
    if (targetFolderId) {
        renderApp({ skipAnimation: true });
        openFolderModal(targetFolderId);
    } else {
        // 如果当前在文件夹视图中，关闭它
        if (openFolderId) {
            closeFolderModal();
        }
        renderApp({ skipAnimation: true });
    }
}

// ===== 书签搜索功能 =====
const bookmarkSearchState = {
    query: '',
    results: [],
    isSearching: false
};

function bindBookmarkSearchEvents() {
    if (!els.bookmarkSearchInput) return;
    
    let searchDebounceTimer = null;
    
    els.bookmarkSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // 显示/隐藏清除按钮
        if (els.clearBookmarkSearch) {
            els.clearBookmarkSearch.classList.toggle('hidden', !query);
        }
        
        // 防抖搜索
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        
        searchDebounceTimer = setTimeout(() => {
            performBookmarkSearch(query);
        }, 150);
    });
    
    // 清除搜索
    if (els.clearBookmarkSearch) {
        els.clearBookmarkSearch.addEventListener('click', () => {
            els.bookmarkSearchInput.value = '';
            els.clearBookmarkSearch.classList.add('hidden');
            clearBookmarkSearch();
        });
    }
    
    // ESC 键清除搜索
    els.bookmarkSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (els.bookmarkSearchInput.value) {
                els.bookmarkSearchInput.value = '';
                els.clearBookmarkSearch?.classList.add('hidden');
                clearBookmarkSearch();
                e.stopPropagation();
            }
        }
    });
}

function performBookmarkSearch(query) {
    bookmarkSearchState.query = query;
    
    if (!query) {
        clearBookmarkSearch();
        return;
    }
    
    // 搜索所有分类中的书签（包括文件夹内的）
    const results = [];
    const queryLower = query.toLowerCase();
    
    appData.categories.forEach(category => {
        searchInBookmarkList(category.bookmarks, category, null, queryLower, results);
    });
    
    bookmarkSearchState.results = results;
    bookmarkSearchState.isSearching = true;
    
    renderSearchResults(results, query);
}

function searchInBookmarkList(bookmarks, category, parentFolder, queryLower, results) {
    if (!Array.isArray(bookmarks)) return;
    
    bookmarks.forEach(bm => {
        const titleMatch = bm.title?.toLowerCase().includes(queryLower);
        const urlMatch = bm.url?.toLowerCase().includes(queryLower);
        
        if (titleMatch || urlMatch) {
            results.push({
                bookmark: bm,
                category: category,
                parentFolder: parentFolder,
                matchType: titleMatch ? 'title' : 'url'
            });
        }
        
        // 递归搜索文件夹内容
        if (bm.type === 'folder' && Array.isArray(bm.children)) {
            searchInBookmarkList(bm.children, category, bm, queryLower, results);
        }
    });
}

function renderSearchResults(results, query) {
    if (!els.searchResultsPanel || !els.searchResultsGrid) return;
    
    const content = document.querySelector('.content');
    content?.classList.add('searching');
    
    els.searchResultsPanel.classList.remove('hidden');
    els.searchResultsGrid.innerHTML = '';
    
    // 更新结果计数
    if (els.searchResultsCount) {
        els.searchResultsCount.textContent = `找到 ${results.length} 个结果`;
    }
    
    if (results.length === 0) {
        els.searchResultsGrid.innerHTML = `
            <div class="search-empty">
                <div class="empty-icon">🔍</div>
                <div class="empty-text">未找到匹配的书签</div>
                <div class="empty-hint">尝试使用其他关键词搜索</div>
            </div>
        `;
        return;
    }
    
    // 渲染搜索结果
    results.forEach((result, index) => {
        const card = createSearchResultCard(result, query, index);
        els.searchResultsGrid.appendChild(card);
    });
}

function createSearchResultCard(result, query, index) {
    const { bookmark: bm, category, parentFolder } = result;
    const isFolder = bm.type === 'folder';
    
    const card = document.createElement(isFolder ? 'div' : 'a');
    card.className = 'bookmark-card search-result-card';
    if (!isFolder && bm.url) {
        card.href = bm.url;
        card.target = '_self';
    }
    card.style.animationDelay = `${Math.min(index * 0.03, 0.3)}s`;
    
    // 图标
    const { primarySrc, fallbackList } = resolveBookmarkIconSource(bm);
    const icon = document.createElement('img');
    icon.className = 'bookmark-icon';
    icon.src = primarySrc;
    icon.alt = '';
    icon.loading = 'lazy';
    attachIconFallback(icon, { iconFallbacks: fallbackList });
    
    if (isFolder) {
        const grid = createFolderIconGrid(bm);
        card.appendChild(grid);
    } else {
        card.appendChild(icon);
    }
    
    // 标题（带高亮）
    const title = document.createElement('span');
    title.className = 'bookmark-title';
    title.innerHTML = highlightText(bm.title || '', query);
    card.appendChild(title);
    
    // 分类标签
    const categoryTag = document.createElement('span');
    categoryTag.className = 'category-tag';
    let tagText = category.name;
    if (parentFolder) {
        tagText += ` / ${parentFolder.title}`;
    }
    categoryTag.textContent = tagText;
    categoryTag.title = tagText;
    card.appendChild(categoryTag);
    
    // 点击事件
    if (isFolder) {
        card.addEventListener('click', (e) => {
            e.preventDefault();
            // 切换到对应分类并打开文件夹
            if (category.id !== appData.activeCategory) {
                appData.activeCategory = category.id;
                renderCategories({ skipAnimation: true });
            }
            clearBookmarkSearch();
            renderApp({ skipAnimation: true });
            setTimeout(() => {
                openFolderModal(bm.id, {});
            }, 100);
        });
    } else {
        // 普通书签点击时，如果有中键或修饰键则新标签打开
        card.addEventListener('click', (e) => {
            // 如果是左键无修饰键，直接跳转（默认行为）
            // 不阻止默认行为
        });
        card.addEventListener('auxclick', (e) => {
            if (e.button === 1) {
                // 中键点击，新标签打开
                e.preventDefault();
                window.open(bm.url, '_blank');
            }
        });
    }
    
    // 右键菜单
    card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showSearchResultContextMenu(result, e.clientX, e.clientY, card);
    });
    
    return card;
}

function highlightText(text, query) {
    if (!query || !text) return escapeHtml(text);
    
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    return escapeHtml(text).replace(regex, '<span class="search-highlight">$1</span>');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearBookmarkSearch() {
    bookmarkSearchState.query = '';
    bookmarkSearchState.results = [];
    bookmarkSearchState.isSearching = false;
    
    const content = document.querySelector('.content');
    content?.classList.remove('searching');
    
    if (els.searchResultsPanel) {
        els.searchResultsPanel.classList.add('hidden');
    }
    if (els.searchResultsGrid) {
        els.searchResultsGrid.innerHTML = '';
    }
}

function showSearchResultContextMenu(result, x, y, card) {
    hideBookmarkContextMenu();
    hideCategoryContextMenu();
    hideGridContextMenu();
    hideBatchMoveMenu();
    
    const { bookmark: bm, category, parentFolder } = result;
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'bookmarkContextMenu';
    
    // 跳转到位置
    const gotoItem = document.createElement('div');
    gotoItem.className = 'context-menu-item';
    gotoItem.innerHTML = '<span class="context-menu-icon">📍</span>跳转到位置';
    gotoItem.onclick = () => {
        hideBookmarkContextMenu();
        // 切换到对应分类
        if (category.id !== appData.activeCategory) {
            appData.activeCategory = category.id;
        }
        clearBookmarkSearch();
        renderApp({ skipAnimation: true });
        
        // 如果在文件夹内，打开文件夹
        if (parentFolder) {
            setTimeout(() => {
                openFolderModal(parentFolder.id, {});
            }, 100);
        }
    };
    menu.appendChild(gotoItem);
    
    // 编辑
    const editItem = document.createElement('div');
    editItem.className = 'context-menu-item';
    editItem.innerHTML = '<span class="context-menu-icon">✎</span>编辑';
    editItem.onclick = () => {
        hideBookmarkContextMenu();
        clearBookmarkSearch();
        openEditBookmarkModal(bm, {
            categoryId: category.id,
            folderId: parentFolder?.id || null
        });
    };
    menu.appendChild(editItem);
    
    // 分隔线
    const divider = document.createElement('div');
    divider.className = 'context-menu-divider';
    menu.appendChild(divider);
    
    // 删除
    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item danger';
    deleteItem.innerHTML = '<span class="context-menu-icon">×</span>删除';
    deleteItem.onclick = () => {
        hideBookmarkContextMenu();
        const name = bm.title || '此项目';
        if (confirm(`确定删除"${name}"？`)) {
            removeBookmarkById(bm.id);
            saveData({ immediate: true });
            // 重新搜索
            performBookmarkSearch(bookmarkSearchState.query);
        }
    };
    menu.appendChild(deleteItem);
    
    document.body.appendChild(menu);
    
    // 调整菜单位置
    adjustMenuPosition(menu, x, y);
    
    setTimeout(() => {
        addBookmarkContextMenuListeners();
    }, 0);
}

async function deleteCategory(id) {
    const confirmed = await showConfirmDialog('确定要删除这个分类及其所有书签吗？', { danger: true, confirmText: '删除' });
    if (!confirmed) return;
    
    appData.categories = appData.categories.filter(c => c.id !== id);
    // 如果删除了当前激活的分类，切换到第一个
    if (appData.activeCategory === id) {
        appData.activeCategory = appData.categories[0].id;
    }
    if (openFolderCategoryId === id) {
        closeFolderModal();
    }
    // 删除是重要操作，立即保存
    saveData({ immediate: true });
    renderApp();
}

async function deleteBookmark(id) {
    const loc = findBookmarkLocation(id);
    if (!loc) return;
    const name = loc.bookmark.title || '此项目';
    const confirmed = await showConfirmDialog(`确定删除“${name}”？`, { danger: true, confirmText: '删除' });
    if (!confirmed) return;
    removeBookmarkById(id);
    // 删除是重要操作，立即保存
    saveData({ immediate: true });
    renderApp({ skipAnimation: true });
    refreshOpenFolderView({ skipAnimation: true });
}

// --- 模态框与表单 ---

function resetModalState() {
    modalState.editingId = null;
    modalState.type = 'link';
    modalState.originCategoryId = null;
    modalState.originFolderId = null;
    modalState.originIndex = -1;
    modalState.targetCategoryId = appData.activeCategory;
    modalState.targetFolderId = null;
    modalState.lockType = false;
}

function setModalType(type, { lock = false, disableFolder = false } = {}) {
    const nextType = type === 'folder' ? 'folder' : 'link';
    modalState.type = nextType;
    modalState.lockType = lock;
    Array.from(els.bookmarkTypeButtons || []).forEach(btn => {
        const isFolderBtn = btn.dataset.type === 'folder';
        const isActive = btn.dataset.type === nextType;
        btn.classList.toggle('active', isActive);
        
        if (isFolderBtn && disableFolder) {
            btn.disabled = true;
            btn.title = '文件夹最多只能创建三级';
        } else {
            btn.disabled = lock && !isActive;
            btn.title = '';
        }
    });
    Array.from(els.typeSections || []).forEach(section => {
        const isLinkSection = section.classList.contains('type-link');
        const isFolderSection = section.classList.contains('type-folder');
        const shouldShow = nextType === 'link' ? isLinkSection : isFolderSection;
        section.classList.toggle('hidden', !shouldShow);
    });
    if (els.bookmarkUrl) {
        els.bookmarkUrl.required = nextType === 'link';
        if (nextType === 'folder') {
            els.bookmarkUrl.value = '';
        }
    }
    if (nextType === 'folder') {
        resetAutoIconSelection({ hideContainers: true });
        showCustomIconControls(false);
        setIconPreviewSource('');
    } else {
        ensureAutoIconContainersVisible();
        const activeIconType = document.querySelector('input[name="iconType"]:checked');
        toggleIconInput(activeIconType ? activeIconType.value : 'favicon');
    }
    updateModalTitle();
}

function updateModalTitle() {
    if (!els.modalTitle) return;
    const isEdit = !!modalState.editingId;
    if (modalState.type === 'folder') {
        els.modalTitle.textContent = isEdit ? '编辑文件夹' : '新建文件夹';
    } else {
        els.modalTitle.textContent = isEdit ? '编辑网址' : '添加网址';
    }
}

function updateCategoryFieldVisibility(isInsideFolder) {
    if (els.categoryFormGroup) {
        els.categoryFormGroup.classList.toggle('hidden', isInsideFolder);
    }
}

function openAddBookmarkModal(options = {}) {
    // 打开模态框时退出批量选择模式
    if (batchSelectState.enabled) {
        toggleBatchSelectMode(false);
    }
    
    resetModalState();
    modalState.type = options.type === 'folder' ? 'folder' : 'link';
    modalState.targetCategoryId = options.categoryId || appData.activeCategory;
    modalState.targetFolderId = options.folderId || null;
    pendingAutoIconSelectionSrc = null;
    lastAutoIconUrl = '';
    resetAutoIconSelection({ hideContainers: modalState.type !== 'link' });
    resetCustomIconState();
    els.bookmarkForm.reset();
    els.bookmarkCategory.value = modalState.targetCategoryId;
    
    const depth = getFolderDepth(modalState.targetFolderId);
    const disableFolder = depth >= 3;
    if (modalState.type === 'folder' && disableFolder) {
        modalState.type = 'link';
    }

    setModalType(modalState.type, { lock: false, disableFolder });
    updateModalTitle();
    updateCategoryFieldVisibility(!!modalState.targetFolderId);
    if (modalState.type === 'link') {
        setIconPreviewSource('');
    }
    animateModalVisibility(els.bookmarkModal, { open: true });
}

function openEditBookmarkModal(bm, context = {}) {
    // 打开模态框时退出批量选择模式
    if (batchSelectState.enabled) {
        toggleBatchSelectMode(false);
    }
    
    resetModalState();
    modalState.editingId = bm.id;
    modalState.type = bm.type === 'folder' ? 'folder' : 'link';
    modalState.lockType = true;
    const loc = findBookmarkLocation(bm.id);
    modalState.originCategoryId = loc?.categoryId || context.categoryId || appData.activeCategory;
    modalState.originFolderId = loc?.parentFolderId || context.folderId || null;
    modalState.originIndex = loc?.index ?? -1;
    modalState.targetCategoryId = modalState.originCategoryId;
    modalState.targetFolderId = modalState.originFolderId;
    pendingAutoIconSelectionSrc = bm.iconType === 'favicon' ? bm.icon : null;
    lastAutoIconUrl = '';
    resetAutoIconSelection({ hideContainers: modalState.type !== 'link' });
    resetCustomIconState();
    els.bookmarkTitle.value = bm.title || '';
    els.bookmarkCategory.value = modalState.targetCategoryId;
    
    const depth = getFolderDepth(modalState.targetFolderId);
    const disableFolder = depth >= 3;
    setModalType(modalState.type, { lock: modalState.lockType, disableFolder });

    updateCategoryFieldVisibility(!!modalState.targetFolderId);
    if (modalState.type === 'link') {
        els.bookmarkUrl.value = bm.url;
        // 设置图标状态
        if (bm.iconType === 'custom') {
            document.querySelector('input[name="iconType"][value="custom"]').checked = true;
            toggleIconInput('custom');
            selectedCustomIconSrc = bm.icon || '';
            customIconMode = inferCustomIconMode(bm.icon);
            activateCustomIconTab(customIconMode);
            setIconPreviewSource(bm.icon);
        } else {
            document.querySelector('input[name="iconType"][value="favicon"]').checked = true;
            toggleIconInput('favicon');
            loadAutoIconsForUrl(bm.url, { desiredSrc: bm.icon, force: true });
        }
    }

    updateModalTitle();
    animateModalVisibility(els.bookmarkModal, { open: true });
}

function checkModalOpenState() {
    const modals = [els.bookmarkModal, els.categoryModal, els.settingsModal, els.folderModal];
    const anyOpen = modals.some(m => m && !m.classList.contains('hidden'));
    document.body.classList.toggle('modal-open', anyOpen);
}

function computeTransformFromRect(sourceRect, targetRect) {
    if (!sourceRect || !targetRect) return null;
    const sourceCenterX = sourceRect.left + sourceRect.width / 2;
    const sourceCenterY = sourceRect.top + sourceRect.height / 2;
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const translateX = sourceCenterX - targetCenterX;
    const translateY = sourceCenterY - targetCenterY;
    const scaleX = Math.max(0.35, Math.min(1.1, sourceRect.width / targetRect.width));
    const scaleY = Math.max(0.35, Math.min(1.1, sourceRect.height / targetRect.height));
    return `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`;
}

function rememberFolderAnchor(folderId, anchorElement, fallbackRect) {
    const rect = anchorElement?.getBoundingClientRect() || fallbackRect || null;
    folderAnchorSnapshot = { folderId, rect, element: anchorElement || null };
    if (els.folderModal && rect) {
        modalAnchors.set(els.folderModal, rect);
    }
}

function resolveFolderAnchorRect(folderId) {
    if (folderAnchorSnapshot.folderId && folderId && folderAnchorSnapshot.folderId === folderId) {
        const liveRect = folderAnchorSnapshot.element?.getBoundingClientRect();
        if (liveRect) return liveRect;
        if (folderAnchorSnapshot.rect) return folderAnchorSnapshot.rect;
    }
    const anchorEl = findBookmarkCardElement(folderId);
    return anchorEl?.getBoundingClientRect() || null;
}

function animateModalVisibility(modal, { open, anchorRect, onHidden } = {}) {
    if (!modal) {
        if (!open && onHidden) onHidden();
        return Promise.resolve();
    }
    const content = modal.querySelector('.modal-content');
    const alreadyClosed = !open && modal.classList.contains('hidden');
    if (alreadyClosed) {
        if (onHidden) onHidden();
        return Promise.resolve();
    }
    if (!content || typeof modal.animate !== 'function') {
        modal.classList.toggle('hidden', !open);
        modal.style.opacity = open ? '1' : '';
        modal.style.visibility = open ? 'visible' : 'hidden';
        checkModalOpenState();
        if (open) document.body.classList.add('modal-open');
        if (!open && onHidden) onHidden();
        return Promise.resolve();
    }

    const wasHidden = modal.classList.contains('hidden');
    if (open) {
        if (anchorRect) {
            modalAnchors.set(modal, anchorRect);
        } else {
            modalAnchors.delete(modal);
        }
    }
    const effectiveAnchor = open ? (anchorRect || null) : (anchorRect || modalAnchors.get(modal) || null);

    const modalStyle = getComputedStyle(modal);
    const contentStyle = getComputedStyle(content);
    const snapshot = {
        modalOpacity: parseFloat(modalStyle.opacity) || 0,
        contentOpacity: parseFloat(contentStyle.opacity) || 0,
        contentTransform: contentStyle.transform === 'none' ? 'translate3d(0,0,0)' : contentStyle.transform
    };

    const existingAnimations = modalAnimations.get(modal);
    if (existingAnimations) {
        existingAnimations.forEach(anim => anim.cancel());
        modalAnimations.delete(modal);
    }

    if (wasHidden) {
        modal.style.opacity = '0';
        modal.style.visibility = 'hidden';
        modal.classList.remove('hidden');
        // Force reflow so we measure the post-layout size before animating
        modal.getBoundingClientRect();
    }

    const targetRect = content.getBoundingClientRect();
    const anchorTransform = computeTransformFromRect(effectiveAnchor, targetRect);
    const fallbackClosedTransform = 'translateY(14px) scale(0.94)';

    const backdropFromOpacity = Number.isFinite(snapshot.modalOpacity) ? Math.min(1, Math.max(0, snapshot.modalOpacity)) : 0;
    const contentFromOpacity = Number.isFinite(snapshot.contentOpacity) ? Math.min(1, Math.max(0, snapshot.contentOpacity)) : 0;

    const fromTransform = open
        ? (wasHidden ? (anchorTransform || fallbackClosedTransform) : snapshot.contentTransform)
        : snapshot.contentTransform;
    const toTransform = open ? 'translate3d(0,0,0) scale(1)' : (anchorTransform || fallbackClosedTransform);
    const startBackdropOpacity = wasHidden ? 0 : backdropFromOpacity;
    const startContentOpacity = wasHidden ? 0 : contentFromOpacity;
    const targetUiOpacity = getUiOpacity();
    const contentToOpacity = open ? targetUiOpacity : 0;

    modal.style.visibility = 'visible';
    document.body.classList.add('modal-open');

    const easingOpen = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const easingClose = 'cubic-bezier(0.4, 0, 0.2, 1)';

    const backdropAnimation = modal.animate(
        [
            { opacity: startBackdropOpacity },
            { opacity: open ? 1 : 0 }
        ],
        { duration: open ? 260 : 220, easing: open ? easingOpen : easingClose, fill: 'forwards' }
    );

    const contentAnimation = content.animate(
        [
            { opacity: startContentOpacity, transform: fromTransform },
            { opacity: contentToOpacity, transform: toTransform }
        ],
        { duration: open ? 320 : 260, easing: open ? easingOpen : easingClose, fill: 'forwards' }
    );

    modalAnimations.set(modal, [backdropAnimation, contentAnimation]);

    const finish = () => {
        modalAnimations.delete(modal);
        if (open) {
            modal.style.opacity = '1';
            modal.style.visibility = 'visible';
        } else {
            modal.style.opacity = '';
            modal.style.visibility = 'hidden';
            modal.classList.add('hidden');
        }
        content.style.transform = '';
        content.style.opacity = '';
        checkModalOpenState();
        if (!open && onHidden) onHidden();
    };

    return Promise.all([
        backdropAnimation.finished.catch(() => {}),
        contentAnimation.finished.catch(() => {})
    ]).then(finish, finish);
}

function closeModalWithAnimation(modal, onHidden) {
    return animateModalVisibility(modal, { open: false }).then(() => {
        if (onHidden) onHidden();
    });
}

function closeModals(options = {}) {
    const keepFolderOpen = options.keepFolderOpen === true;
    
    const cleanup = () => {
        resetAutoIconSelection({ hideContainers: true });
        resetCustomIconState();
        resetModalState();
        pendingAutoIconSelectionSrc = null;
        selectedAutoIcon = null;
        setIconPreviewSource('');
        if (!keepFolderOpen && els.folderExitZone) {
            els.folderExitZone.classList.remove('dragover');
        }
    };

    const closers = [];
    if (els.bookmarkModal && !els.bookmarkModal.classList.contains('hidden')) {
        closers.push(closeModalWithAnimation(els.bookmarkModal));
    }
    if (els.categoryModal && !els.categoryModal.classList.contains('hidden')) {
        closers.push(closeModalWithAnimation(els.categoryModal));
    }
    if (els.settingsModal && !els.settingsModal.classList.contains('hidden')) {
        closers.push(closeSettingsModal());
    }
    if (!keepFolderOpen && els.folderModal && !els.folderModal.classList.contains('hidden')) {
        closers.push(closeFolderModal());
    }

    if (closers.length === 0) {
        cleanup();
        return;
    }

    Promise.all(closers).then(cleanup);
}

function toggleIconInput(type) {
    if (modalState.type === 'folder') return;
    if (type === 'custom') {
        showCustomIconControls(true);
        resetAutoIconSelection({ hideContainers: true });
        if (selectedCustomIconSrc) {
            setIconPreviewSource(selectedCustomIconSrc);
        } else if (customIconMode === 'swatch') {
            applySwatchIcon();
        } else {
            setIconPreviewSource('');
        }
    } else {
        showCustomIconControls(false);
        ensureAutoIconContainersVisible();
        if (els.bookmarkUrl.value.trim()) {
            loadAutoIconsForUrl(els.bookmarkUrl.value.trim(), {
                desiredSrc: pendingAutoIconSelectionSrc,
                force: true
            });
        } else {
            setIconPreviewSource('');
            setAutoIconStatus('请输入网址以获取图标。');
        }
    }
}

function persistFolderFromForm(title, categoryId, targetFolderId, options = {}) {
    const keepFolderOpen = options.keepFolderOpen === true;
    
    // 检查文件夹深度限制
    if (getFolderDepth(targetFolderId) >= 3) {
        return;
    }

    const targetList = getBookmarkList(categoryId, targetFolderId);
    if (!targetList) {
        alert('未找到目标分类，保存失败');
        return;
    }
    let folderBookmark = null;
    let insertIndex = targetList.length;
    if (modalState.editingId) {
        const existingLoc = findBookmarkLocation(modalState.editingId);
        if (existingLoc && existingLoc.bookmark.type === 'folder') {
            folderBookmark = {
                ...existingLoc.bookmark,
                title,
                type: 'folder',
                url: '#',
                iconType: existingLoc.bookmark.iconType || 'custom',
                icon: existingLoc.bookmark.icon || 'icons/default.svg',
                iconFallbacks: existingLoc.bookmark.iconFallbacks || [],
                children: Array.isArray(existingLoc.bookmark.children) ? existingLoc.bookmark.children : []
            };
            const sameContainer = existingLoc.categoryId === categoryId && (existingLoc.parentFolderId || null) === targetFolderId;
            if (sameContainer) {
                insertIndex = Math.min(existingLoc.index, targetList.length);
            }
            removeBookmarkAtLocation(existingLoc);
        }
    }
    if (!folderBookmark) {
        folderBookmark = {
            id: modalState.editingId || generateId('folder'),
            title,
            type: 'folder',
            url: '#',
            iconType: 'custom',
            icon: 'icons/default.svg',
            iconFallbacks: [],
            children: []
        };
    }
    normalizeFolderChildTitles(folderBookmark.title, folderBookmark.children);
    insertBookmarkToList(targetList, insertIndex, folderBookmark);
    // 文件夹创建/编辑是重要操作，立即保存
    saveData({ immediate: true });
    renderApp();
    refreshOpenFolderView();
    closeModals({ keepFolderOpen });
}

function setIconPreviewSource(src, { enableAutoFallbacks = false } = {}) {
    if (!els.iconPreview) return;
    // reset previous error handler to avoid stale fallbacks
    els.iconPreview.onerror = null;
    const resolvedSrc = resolveCachedIconSrc(src);
    if (resolvedSrc) {
        // When previewing auto-fetched icons (especially SVG), reuse the same fallback chain
        // as bookmark cards so broken candidates gracefully downgrade instead of showing a
        // broken image placeholder in the modal.
        if (enableAutoFallbacks) {
            const fallbacks = autoIconCandidates
                .filter(candidate => candidate && candidate.src && candidate.src !== src)
                .map(candidate => resolveCachedIconSrc(candidate.src));
            attachIconFallback(els.iconPreview, { iconFallbacks: dedupeIconList(resolvedSrc, fallbacks) });
        }
        els.iconPreview.src = resolvedSrc;
        els.iconPreview.classList.remove('hidden');
    } else {
        els.iconPreview.src = '';
        els.iconPreview.classList.add('hidden');
    }
}

function showCustomIconControls(show) {
    if (!els.customIconControls) return;
    if (show) {
        els.customIconControls.classList.remove('hidden');
        activateCustomIconTab(customIconMode || 'upload');
    } else {
        els.customIconControls.classList.add('hidden');
    }
}

function activateCustomIconTab(mode) {
    customIconMode = mode === 'swatch' ? 'swatch' : 'upload';
    Array.from(els.customIconTabs || []).forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === customIconMode);
    });
    Array.from(els.customIconPanels || []).forEach(panel => {
        const isActive = panel.dataset.mode === customIconMode;
        panel.classList.toggle('hidden', !isActive);
    });
}

function bindCustomSwatchEvents() {
    Array.from(els.customIconTabs || []).forEach(tab => {
        tab.addEventListener('click', () => {
            activateCustomIconTab(tab.dataset.mode);
            if (customIconMode === 'swatch' && !selectedCustomIconSrc) {
                applySwatchIcon();
            }
        });
    });
    if (els.swatchApplyBtn) {
        els.swatchApplyBtn.addEventListener('click', () => {
            applySwatchIcon();
        });
    }
}

function applySwatchIcon() {
    const color = (els.swatchColor && els.swatchColor.value) || DEFAULT_SWATCH_COLOR;
    let text = deriveSwatchText();
    const icon = buildColorSwatchDataUrl(color, text);
    selectedCustomIconSrc = icon;
    customIconMode = 'swatch';
    activateCustomIconTab('swatch');
    setIconPreviewSource(icon);
}

function deriveSwatchText() {
    const manual = (els.swatchText && els.swatchText.value || '').trim();
    if (manual) return manual.slice(0, 4);
    const title = (els.bookmarkTitle && els.bookmarkTitle.value || '').trim();
    if (title) return title.slice(0, 2);
    const urlVal = (els.bookmarkUrl && els.bookmarkUrl.value || '').trim();
    if (urlVal) {
        try {
            const host = new URL(normalizeUrlInput(urlVal)).hostname.replace(/^www\./, '');
            if (host) return host.slice(0, 2);
        } catch (e) {
            // ignore
        }
    }
    return '';
}

function resetCustomIconState() {
    selectedCustomIconSrc = '';
    customIconMode = 'upload';
    if (els.customIconInput) {
        els.customIconInput.value = '';
    }
    if (els.swatchColor) {
        els.swatchColor.value = DEFAULT_SWATCH_COLOR;
    }
    if (els.swatchText) {
        els.swatchText.value = '';
    }
    activateCustomIconTab('upload');
}

function inferCustomIconMode(src) {
    if (src && src.startsWith('data:image/svg+xml')) {
        return 'swatch';
    }
    return 'upload';
}

function resetAutoIconSelection({ hideContainers = false } = {}) {
    autoIconCandidates = [];
    selectedAutoIcon = null;
    if (els.iconResultsGrid) {
        els.iconResultsGrid.innerHTML = '';
    }
    if (hideContainers) {
        if (els.autoIconResults) {
            els.autoIconResults.classList.add('hidden');
        }
        if (els.autoIconControls) {
            els.autoIconControls.classList.add('hidden');
        }
    }
}

function ensureAutoIconContainersVisible() {
    if (els.autoIconResults) {
        els.autoIconResults.classList.remove('hidden');
    }
    if (els.autoIconControls) {
        els.autoIconControls.classList.remove('hidden');
    }
}

function setAutoIconStatus(message) {
    if (!els.iconResultsGrid) return;
    els.iconResultsGrid.innerHTML = `<div class="icon-result-placeholder">${message}</div>`;
}

function renderAutoIconCandidates() {
    if (!els.iconResultsGrid) return;
    if (!autoIconCandidates.length) {
        setAutoIconStatus('暂时没有可用的图标。');
        return;
    }
    els.iconResultsGrid.innerHTML = '';
    autoIconCandidates.forEach((candidate, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'icon-result-item';
        if (selectedAutoIcon && selectedAutoIcon.src === candidate.src) {
            button.classList.add('selected');
        }

        const img = document.createElement('img');
        img.alt = candidate.label || 'icon candidate';
        // Use a fallback chain for thumbnails too, so broken SVGs auto-downgrade instead of showing a broken icon.
        const thumbnailFallbacks = autoIconCandidates
            .filter(c => c && c.src && c.src !== candidate.src)
            .map(c => resolveCachedIconSrc(c.src));
        const resolvedThumbSrc = resolveCachedIconSrc(candidate.src);
        attachIconFallback(img, { iconFallbacks: dedupeIconList(resolvedThumbSrc, thumbnailFallbacks) });
        img.src = resolvedThumbSrc;

        const meta = document.createElement('div');
        meta.className = 'meta';

        const label = document.createElement('span');
        label.textContent = candidate.label || '候选图标';

        const source = document.createElement('span');
        source.className = 'source';
        const sourceLabel = candidate.source || '未知来源';
        source.textContent = `${candidate.isSvg ? 'SVG · ' : ''}${sourceLabel}`;

        meta.appendChild(label);
        meta.appendChild(source);

        button.appendChild(img);
        button.appendChild(meta);
        button.onclick = () => selectAutoIcon(candidate.src);
        els.iconResultsGrid.appendChild(button);
    });
}

function selectAutoIcon(identifier) {
    if (!autoIconCandidates.length) return;
    let candidate = null;
    if (typeof identifier === 'number') {
        candidate = autoIconCandidates[identifier];
    } else if (typeof identifier === 'string') {
        candidate = autoIconCandidates.find(c => c.src === identifier);
    }
    if (!candidate) {
        candidate = autoIconCandidates[0];
    }
    selectedAutoIcon = candidate;
    pendingAutoIconSelectionSrc = candidate.src;
    setIconPreviewSource(candidate.src, { enableAutoFallbacks: true });
    cacheIconIfNeeded(candidate.src);
    renderAutoIconCandidates();
}

let autoIconLoadId = 0;
async function loadAutoIconsForUrl(inputUrl, { desiredSrc = null, force = false } = {}) {
    const normalizedUrl = normalizeUrlInput(inputUrl);
    if (!normalizedUrl) {
        setAutoIconStatus('网址无效，无法获取图标。');
        return;
    }
    if (isFetchingAutoIcons && !force) {
        return;
    }
    if (!force && normalizedUrl === lastAutoIconUrl && autoIconCandidates.length) {
        if (desiredSrc) {
            selectAutoIcon(desiredSrc);
        }
        return;
    }
    
    const currentLoadId = ++autoIconLoadId;
    lastAutoIconUrl = normalizedUrl;
    isFetchingAutoIcons = true;
    ensureAutoIconContainersVisible();
    setAutoIconStatus('正在获取图标...');
    try {
        const urlObj = new URL(normalizedUrl);
        const candidates = await fetchIconCandidates(urlObj);
        
        // 检查是否有更新的请求覆盖了当前请求
        if (currentLoadId !== autoIconLoadId) {
            return; // 这个请求已过时
        }
        
        if (!candidates.length) {
            autoIconCandidates = [];
            selectedAutoIcon = null;
            setIconPreviewSource('');
            setAutoIconStatus('未找到图标，请尝试自定义上传。');
            return;
        }
        autoIconCandidates = prioritizeIconCandidates(candidates);
        renderAutoIconCandidates();
        if (desiredSrc && autoIconCandidates.some(c => c.src === desiredSrc)) {
            selectAutoIcon(desiredSrc);
        } else {
            selectAutoIcon(0);
        }
    } catch (error) {
        // 检查是否有更新的请求覆盖了当前请求
        if (currentLoadId !== autoIconLoadId) {
            return;
        }
        console.error('获取图标失败', error);
        autoIconCandidates = [];
        selectedAutoIcon = null;
        setIconPreviewSource('');
        setAutoIconStatus('获取图标失败，请稍后重试或改用自定义图片。');
    } finally {
        if (currentLoadId === autoIconLoadId) {
            isFetchingAutoIcons = false;
        }
    }
}

function normalizeUrlInput(input) {
    if (!input) return '';
    try {
        return new URL(input).href;
    } catch (error) {
        try {
            return new URL(`https://${input}`).href;
        } catch (err) {
            return '';
        }
    }
}

// ======================== Comprehensive Favicon Fetching ========================

/**
 * Parse the "sizes" attribute from <link> tags.
 * e.g. "32x32", "48x48 64x64", "any" → returns the largest dimension or null.
 */
function _parseSizesAttr(s) {
    if (!s) return null;
    s = s.trim().toLowerCase();
    if (s === 'any') return null;
    let best = null;
    for (const part of s.split(/\s+/)) {
        const m = part.match(/^(\d+)[xX](\d+)$/);
        if (m) {
            const side = Math.max(parseInt(m[1], 10), parseInt(m[2], 10));
            best = best === null ? side : Math.max(best, side);
        }
    }
    return best;
}

/**
 * Guess file extension from Content-Type header.
 */
function _guessExtFromContentType(ct) {
    ct = (ct || '').split(';')[0].trim().toLowerCase();
    const map = {
        'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico',
        'image/ico': '.ico', 'image/icon': '.ico',
        'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
        'image/svg+xml': '.svg', 'image/webp': '.webp', 'image/gif': '.gif',
    };
    return map[ct] || '';
}

/**
 * Determine if a Content-Type looks like HTML.
 */
function _isProbablyHtml(ct) {
    ct = (ct || '').toLowerCase();
    return ct.includes('text/html') || ct.includes('application/xhtml');
}

/**
 * Safe fetch helper — returns null on failure instead of throwing.
 */
async function _safeFetch(url, options = {}) {
    try {
        const controller = new AbortController();
        const timeout = options.timeout || 10000;
        const timerId = setTimeout(() => controller.abort(), timeout);
        const resp = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            ...options,
        });
        clearTimeout(timerId);
        return resp;
    } catch (_) {
        return null;
    }
}

/**
 * Fetch text content from URL; returns { text, finalUrl, contentType } or null.
 */
async function _fetchText(url) {
    const resp = await _safeFetch(url);
    if (resp && resp.ok) {
        const ct = resp.headers.get('Content-Type') || '';
        const text = await resp.text();
        return { text, finalUrl: resp.url, contentType: ct };
    }
    // Fallback: use backend proxy to bypass CORS and preserve redirect final URL.
    return fetchExternalTextViaProxy(url, { maxBytes: DEFAULT_EXTERNAL_TEXT_FETCH_MAX_BYTES });
}

// ----- HTML <link> / <meta> parsing -----

function _collectFromHtml(baseUrl, html) {
    const candidates = [];
    let manifestUrl = null;
    let browserconfigUrl = null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 1) <link rel="..." href="...">
    for (const link of doc.querySelectorAll('link[href]')) {
        const rel = (link.getAttribute('rel') || '').toLowerCase();
        const href = link.getAttribute('href');
        if (!href) continue;

        // manifest
        if (rel.includes('manifest') && !manifestUrl) {
            try { manifestUrl = new URL(href, baseUrl).href; } catch (_) {}
            continue;
        }

        // icon-related rels
        const isIcon = /icon|shortcut|apple-touch|mask-icon|fluid-icon/.test(rel);
        if (!isIcon) continue;

        const sizesHint = _parseSizesAttr(link.getAttribute('sizes'));
        let fullUrl;
        try { fullUrl = new URL(href, baseUrl).href; } catch (_) { continue; }

        let priority = 50;
        if (rel.includes('apple-touch')) priority = 55; // apple-touch-icon 通常是高分辨率 PNG
        else if (rel.includes('mask-icon')) priority = 40;
        else if (rel.includes('shortcut')) priority = 48;

        const isSvg = /\.svg(\?|$)/i.test(fullUrl) || rel.includes('mask-icon');
        const ext = _urlExt(fullUrl);
        candidates.push({
            src: fullUrl,
            label: `${rel} ${sizesHint ? sizesHint + 'px' : ''}`.trim(),
            source: 'HTML',
            rel,
            sizesHint,
            priority,
            isSvg,
            ext,
        });
    }

    // 2) <meta name="msapplication-TileImage" content="...">
    for (const meta of doc.querySelectorAll('meta[name]')) {
        const name = (meta.getAttribute('name') || '').toLowerCase();
        const content = meta.getAttribute('content');
        if (!content) continue;
        if (name === 'msapplication-tileimage') {
            let fullUrl;
            try { fullUrl = new URL(content, baseUrl).href; } catch (_) { continue; }
            candidates.push({
                src: fullUrl,
                label: 'msapplication-TileImage',
                source: 'HTML meta',
                rel: 'msapplication-tileimage',
                sizesHint: null,
                priority: 35,
                ext: _urlExt(fullUrl),
            });
        }
        if (name === 'msapplication-config') {
            try { browserconfigUrl = new URL(content, baseUrl).href; } catch (_) {}
        }
    }

    return { candidates, manifestUrl, browserconfigUrl };
}

// ----- manifest.json / site.webmanifest -----

function _collectFromManifest(manifestUrl, manifestText) {
    const out = [];
    let data;
    try { data = JSON.parse(manifestText); } catch (_) { return out; }

    const icons = data.icons || [];
    for (const ic of icons) {
        if (!ic.src) continue;
        let fullUrl;
        try { fullUrl = new URL(ic.src, manifestUrl).href; } catch (_) { continue; }
        const sizesHint = _parseSizesAttr(ic.sizes);
        const purpose = (ic.purpose || '').toLowerCase();
        let priority = 52;
        if (purpose.includes('maskable')) priority = 51;
        const ext = _urlExt(fullUrl);
        out.push({
            src: fullUrl,
            label: `manifest ${sizesHint ? sizesHint + 'px' : ''}`.trim(),
            source: 'Manifest',
            rel: 'manifest-icon',
            sizesHint,
            priority,
            isSvg: ext === '.svg',
            ext,
        });
    }
    return out;
}

// ----- browserconfig.xml -----

function _collectFromBrowserconfig(baseUrl, xmlText) {
    const out = [];
    let doc;
    try {
        doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    } catch (_) { return out; }
    if (!doc || doc.querySelector('parsererror')) return out;

    // Match elements like square150x150logo, TileImage, etc.
    const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
        const el = walker.currentNode;
        const tag = el.localName.toLowerCase();
        if (!tag.endsWith('logo') && !tag.includes('tileimage')) continue;
        const src = el.getAttribute('src') || el.textContent;
        if (!src) continue;
        let fullUrl;
        try { fullUrl = new URL(src.trim(), baseUrl).href; } catch (_) { continue; }
        const m = tag.match(/(\d{2,4})x\1/);
        const sizesHint = m ? parseInt(m[1], 10) : null;
        const ext = _urlExt(fullUrl);
        out.push({
            src: fullUrl,
            label: `browserconfig ${tag}`,
            source: 'Browserconfig',
            rel: 'browserconfig',
            sizesHint,
            priority: 30,
            isSvg: ext === '.svg',
            ext,
        });
    }
    return out;
}

// ----- Common well-known paths -----

const _COMMON_ICON_PATHS = [
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
    '/android-chrome-512x512.png',
    '/android-chrome-192x192.png',
    '/favicon.png',
    '/favicon-32x32.png',
    '/favicon-16x16.png',
    '/favicon.ico',
    '/favicon.svg',
];

function _collectCommonPaths(origin) {
    return _COMMON_ICON_PATHS.map(p => {
        const fullUrl = origin + p;
        const ext = _urlExt(fullUrl);
        return {
            src: fullUrl,
            label: p.slice(1),
            source: '常见路径',
            rel: 'common',
            sizesHint: null,
            priority: 10,
            isSvg: ext === '.svg',
            ext,
        };
    });
}

// ----- 3rd-party favicon services (as low-priority fallback) -----

function _collectThirdPartyFallbacks(hostname, origin) {
    const enc = encodeURIComponent(hostname);
    const encOrigin = encodeURIComponent(origin);
    return [
        {
            src: `https://www.google.com/s2/favicons?domain=${enc}&sz=256`,
            label: 'Google S2 256px',
            source: 'Google',
            rel: 'third-party',
            sizesHint: 256,
            priority: 5,
            ext: '.png',
        },
        {
            src: `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encOrigin}&size=256`,
            label: 'GStatic 256px',
            source: 'Google',
            rel: 'third-party',
            sizesHint: 256,
            priority: 4,
            ext: '.png',
        },
        {
            src: `https://www.google.com/s2/favicons?domain=${enc}&sz=128`,
            label: 'Google S2 128px',
            source: 'Google',
            rel: 'third-party',
            sizesHint: 128,
            priority: 3,
            ext: '.png',
        },
        {
            src: `https://icons.duckduckgo.com/ip3/${hostname}.ico`,
            label: 'DuckDuckGo ICO',
            source: 'DuckDuckGo',
            rel: 'third-party',
            sizesHint: null,
            priority: 2,
            ext: '.ico',
        },
    ];
}

// ----- Utility: extract extension from URL -----

function _urlExt(url) {
    try {
        const pathname = new URL(url).pathname;
        const dot = pathname.lastIndexOf('.');
        if (dot === -1) return '';
        return pathname.slice(dot).toLowerCase().split('?')[0];
    } catch (_) {
        return '';
    }
}

// ----- Probe image dimensions by loading it -----

function _probeImageSize(url) {
    return new Promise(resolve => {
        const img = new Image();
        const timer = setTimeout(() => {
            img.onload = img.onerror = null;
            resolve(null);
        }, 6000);
        img.onload = () => {
            clearTimeout(timer);
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
            clearTimeout(timer);
            resolve(null);
        };
        img.src = url;
    });
}

// ======================== Main entry: fetchIconCandidates ========================

/**
 * Comprehensive favicon/icon fetching.
 * 1. Fetch the page HTML, parse <link> / <meta> for icons, manifest, browserconfig.
 * 2. If a manifest URL is found, fetch & parse it.
 * 3. If a browserconfig URL is found, fetch & parse it.
 * 4. Append well-known common paths.
 * 5. Append third-party services as low-priority fallback.
 * 6. Deduplicate, then probe image sizes in parallel.
 * 7. Return unified candidate list with sizesHint populated.
 */
async function fetchIconCandidates(urlObj) {
    const inputOrigin = urlObj.origin;
    const inputHostname = urlObj.hostname;
    const pageUrl = urlObj.href;

    let allCandidates = [];
    let resolvedOrigin = inputOrigin;
    let resolvedHostname = inputHostname;

    // Step 1: try to fetch page HTML
    let manifestUrl = null;
    let browserconfigUrl = null;

    const pageResult = await _fetchText(pageUrl);
    if (pageResult && pageResult.text) {
        const baseUrl = pageResult.finalUrl || pageUrl;
        try {
            const resolvedUrl = new URL(baseUrl);
            resolvedOrigin = resolvedUrl.origin;
            resolvedHostname = resolvedUrl.hostname;
        } catch (error) {
            // keep input origin/hostname
        }
        const parsed = _collectFromHtml(baseUrl, pageResult.text);
        allCandidates.push(...parsed.candidates);
        manifestUrl = parsed.manifestUrl;
        browserconfigUrl = parsed.browserconfigUrl;
    }

    const originsToTry = Array.from(
        new Set([resolvedOrigin, inputOrigin].filter(Boolean))
    );
    const hostCandidates = [
        { hostname: resolvedHostname, origin: resolvedOrigin },
        { hostname: inputHostname, origin: inputOrigin },
    ].filter(item => item.hostname);
    const seenHost = new Set();
    const hostnamesToTry = hostCandidates.filter(item => {
        if (seenHost.has(item.hostname)) return false;
        seenHost.add(item.hostname);
        return true;
    });

    // Step 2: manifest
    if (manifestUrl) {
        const mResult = await _fetchText(manifestUrl);
        if (mResult && mResult.text) {
            allCandidates.push(..._collectFromManifest(mResult.finalUrl || manifestUrl, mResult.text));
        }
    } else {
        // Try well-known manifest paths
        let manifestFound = false;
        for (const targetOrigin of originsToTry) {
            for (const mPath of ['/site.webmanifest', '/manifest.json']) {
                const manifestCandidateUrl = targetOrigin + mPath;
                const mResult = await _fetchText(manifestCandidateUrl);
                if (mResult && mResult.text && mResult.text.trim().startsWith('{')) {
                    allCandidates.push(..._collectFromManifest(mResult.finalUrl || manifestCandidateUrl, mResult.text));
                    manifestFound = true;
                    break;
                }
            }
            if (manifestFound) {
                break;
            }
        }
    }

    // Step 3: browserconfig.xml
    if (browserconfigUrl) {
        const bcResult = await _fetchText(browserconfigUrl);
        if (bcResult && bcResult.text && bcResult.text.toLowerCase().includes('<browserconfig')) {
            allCandidates.push(
                ..._collectFromBrowserconfig(bcResult.finalUrl || browserconfigUrl, bcResult.text)
            );
        }
    } else {
        for (const targetOrigin of originsToTry) {
            const browserConfigCandidateUrl = targetOrigin + '/browserconfig.xml';
            const bcResult = await _fetchText(browserConfigCandidateUrl);
            if (bcResult && bcResult.text && bcResult.text.toLowerCase().includes('<browserconfig')) {
                allCandidates.push(
                    ..._collectFromBrowserconfig(
                        bcResult.finalUrl || browserConfigCandidateUrl,
                        bcResult.text
                    )
                );
                break;
            }
        }
    }

    // Step 4: common paths
    originsToTry.forEach(targetOrigin => {
        allCandidates.push(..._collectCommonPaths(targetOrigin));
    });

    // Step 5: third-party fallbacks
    hostnamesToTry.forEach(item => {
        allCandidates.push(..._collectThirdPartyFallbacks(item.hostname, item.origin));
    });

    // Step 6: deduplicate by URL (keep highest priority)
    const uniq = new Map();
    for (const c of allCandidates) {
        if (!c.src) continue;
        const existing = uniq.get(c.src);
        if (!existing || c.priority > existing.priority) {
            uniq.set(c.src, c);
        }
    }
    let dedupedList = Array.from(uniq.values());

    // Limit to a reasonable number before probing
    if (dedupedList.length > 40) {
        dedupedList.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        dedupedList = dedupedList.slice(0, 40);
    }

    // Step 7: probe image sizes in parallel (best-effort)
    const probeResults = await Promise.all(
        dedupedList.map(async c => {
            // Skip data URIs and obviously non-image URLs
            if (c.src.startsWith('data:') || c.isSvg) return c;
            const size = await _probeImageSize(c.src);
            if (size) {
                c.probeWidth = size.width;
                c.probeHeight = size.height;
                // Update sizesHint with actual probed size
                const maxSide = Math.max(size.width, size.height);
                if (!c.sizesHint || maxSide > c.sizesHint) {
                    c.sizesHint = maxSide;
                }
                // Generate label with actual size
                c.label = `${c.label || c.source} ${size.width}×${size.height}`;
            }
            return c;
        })
    );

    // Filter out candidates whose probe failed (no sizesHint and failed to load)
    // but keep ones that have at least a sizesHint or are from known-good sources
    const validCandidates = probeResults.filter(c => {
        // Keep if probe succeeded
        if (c.probeWidth && c.probeHeight) return true;
        // Keep if SVG (can't probe size easily but still valid)
        if (c.isSvg) return true;
        // Keep if it has a sizes hint from HTML/manifest
        if (c.sizesHint) return true;
        // Keep third-party services (Google/DuckDuckGo) — they're generally reliable
        if (c.rel === 'third-party') return true;
        // Keep data URIs
        if (c.src.startsWith('data:')) return true;
        return false;
    });

    return validCandidates.length ? validCandidates : probeResults;
}

// ======================== Icon selection & sorting ========================

/**
 * Sort candidates: highest resolution first, PNG prioritized.
 * Scoring: actual probed pixel area > sizesHint area > priority.
 * PNG gets a bonus; SVG gets a penalty for default selection (still shown in list).
 */
function prioritizeIconCandidates(list) {
    return [...list].sort((a, b) => {
        // --- format bonus: PNG > ICO/WEBP > others > SVG ---
        const fmtScore = (c) => {
            const ext = (c.ext || '').toLowerCase();
            if (ext === '.png') return 100;
            if (ext === '.ico') return 60;
            if (ext === '.webp') return 50;
            if (ext === '.jpg' || ext === '.jpeg') return 40;
            if (ext === '.gif') return 30;
            if (ext === '.svg' || c.isSvg) return 10;
            // Unknown ext but probed successfully — treat like PNG
            if (c.probeWidth) return 80;
            return 20;
        };

        // --- resolution score ---
        const resScore = (c) => {
            if (c.probeWidth && c.probeHeight) {
                return c.probeWidth * c.probeHeight;
            }
            if (c.sizesHint) return c.sizesHint * c.sizesHint;
            return 0;
        };

        const fmtA = fmtScore(a), fmtB = fmtScore(b);
        const resA = resScore(a), resB = resScore(b);

        // Primary: resolution (highest first)
        if (resA !== resB) return resB - resA;
        // Secondary: format (PNG first)
        if (fmtA !== fmtB) return fmtB - fmtA;
        // Tertiary: original priority
        return (b.priority || 0) - (a.priority || 0);
    });
}

function openSettingsModal() {
    // 打开设置时退出批量选择模式
    if (batchSelectState.enabled) {
        toggleBatchSelectMode(false);
    }
    
    if (els.bgSettingsPanel) {
        els.bgSettingsPanel.classList.add('hidden');
    }
    if (els.toggleBgSettingsBtn) {
        els.toggleBgSettingsBtn.textContent = '设置背景';
    }
    pendingStorageMode = appSettings.storageMode || STORAGE_MODES.BROWSER;
    populateSettingsForm();
    Array.from(els.storageModeRadios || []).forEach(radio => {
        radio.checked = radio.value === appSettings.storageMode;
    });
    updateStorageInfoVisibility(pendingStorageMode);
    // 刷新图标缓存诊断状态
    auditIconCacheStatus();
    if (els.settingsModal) {
        animateModalVisibility(els.settingsModal, { open: true });
    }
}

function closeSettingsModal() {
    return animateModalVisibility(els.settingsModal, { open: false });
}

async function handleStorageModeChange(mode) {
    pendingStorageMode = LOCAL_ONLY_MODE ? STORAGE_MODES.BROWSER : mode;
    updateStorageInfoVisibility(pendingStorageMode);
}

function toAbsoluteExportUrl(value) {
    if (!value || typeof value !== 'string') return value;
    return normalizePersistedAssetUrl(value);
}

function buildExportDataSnapshot() {
    const snapshot = deepClone(appData);
    attachBackgroundToData(snapshot);
    if (!snapshot || !Array.isArray(snapshot.categories)) {
        return snapshot;
    }

    snapshot.categories.forEach(cat => {
        walkCategoryBookmarks(cat, (bm) => {
            if (!bm || typeof bm !== 'object') return;
            if (typeof bm.icon === 'string' && bm.icon) {
                bm.icon = toAbsoluteExportUrl(resolveCachedIconSrc(bm.icon));
            }
            if (Array.isArray(bm.iconFallbacks)) {
                bm.iconFallbacks = bm.iconFallbacks
                    .map(item => (typeof item === 'string' ? toAbsoluteExportUrl(resolveCachedIconSrc(item)) : item))
                    .filter(Boolean);
            }
        });
    });

    if (snapshot.background && typeof snapshot.background === 'object') {
        const bg = normalizeBackgroundSettings(snapshot.background);
        if (bg.image) {
            bg.image = toAbsoluteExportUrl(resolveCachedIconSrc(bg.image));
        }
        snapshot.background = bg;
    }

    return snapshot;
}

function exportDataAsFile() {
    const exportData = buildExportDataSnapshot();
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `MyLocalNewTab-data-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handleImportDataFile(file, source = IMPORT_SOURCES.EDGE_TAB, mode = IMPORT_MODES.MERGE) {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const content = event.target.result;
            let normalized;
            
            // 处理 Edge/Chrome 书签 HTML 文件
            if (source === IMPORT_SOURCES.EDGE_BOOKMARK) {
                normalized = parseEdgeBookmarkHtml(content);
            } else if (source === IMPORT_SOURCES.SAFARI_BOOKMARK) {
                // 处理 Safari 书签 HTML 文件
                normalized = parseSafariBookmarkHtml(content);
            } else {
                const parsed = JSON.parse(content);
                normalized = parseImportedData(parsed, source);
            }
            
            if (!normalized) {
                alert('导入失败：文件格式不正确或不支持的数据来源');
                return;
            }
            appData = mode === IMPORT_MODES.OVERWRITE
                ? normalized
                : mergeImportedData(appData, normalized);
            ensureActiveCategory();
            normalizeDataStructure();
            maybeSyncBackgroundFromData(appData, { saveSettingsFlag: true });
            maybeSyncUiOpacityFromData(appData, { saveSettingsFlag: true });
            attachBackgroundToData(appData);
            // 导入是重要操作，立即保存
            saveData({ immediate: true });
            renderApp();
            // 图标缓存已在编辑时按需获取，无需批量预热
            alert('导入成功');
            closeSettingsModal();
        } catch (err) {
            console.error('导入数据失败', err);
            alert('导入失败：无法解析文件');
        }
    };
    reader.readAsText(file, 'utf-8');
}

function parseImportedData(raw, source) {
    if (source === IMPORT_SOURCES.WETAB) {
        return parseWeTabData(raw);
    }
    return parseMyLocalNewTabData(raw);
}

/**
 * 解析 Edge/Chrome 导出的 Netscape Bookmark HTML 文件
 * 结构说明：
 * - PERSONAL_TOOLBAR_FOLDER="true" 的 H3 是"收藏夹栏"
 * - 其他顶级文件夹/书签都属于隐含的"其他收藏夹"
 */
function parseEdgeBookmarkHtml(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') return null;
    
    // 检查是否为 Netscape Bookmark 格式
    if (!htmlContent.includes('NETSCAPE-Bookmark-file-1') && !htmlContent.includes('<DL>')) {
        return null;
    }
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    
    // 找到根 DL 元素
    const rootDL = doc.querySelector('DL');
    if (!rootDL) return null;
    
    const categories = [];
    let toolbarCategory = null;
    let otherBookmarks = [];
    
    // 遍历根 DL 的直接子 DT 元素
    const topLevelDTs = Array.from(rootDL.children).filter(el => el.tagName === 'DT');
    
    for (const dt of topLevelDTs) {
        const h3 = dt.querySelector(':scope > H3');
        const a = dt.querySelector(':scope > A');
        
        if (h3) {
            // 这是一个文件夹
            const isToolbar = h3.getAttribute('PERSONAL_TOOLBAR_FOLDER') === 'true';
            const folderName = h3.textContent.trim() || '未命名文件夹';
            const subDL = dt.querySelector(':scope > DL');
            const bookmarks = subDL ? parseBookmarkDL(subDL) : [];
            
            if (isToolbar) {
                // 收藏夹栏
                toolbarCategory = {
                    id: generateId('cat'),
                    name: folderName,
                    bookmarks
                };
            } else {
                // 其他顶级文件夹 → 归入"其他收藏夹"
                if (bookmarks.length > 0) {
                    // 创建一个文件夹书签
                    const folderBookmark = {
                        id: generateId('folder'),
                        title: folderName,
                        type: 'folder',
                        iconType: 'custom',
                        icon: buildColorSwatchDataUrl('#6b7280', folderName.slice(0, 2)),
                        iconFallbacks: [],
                        children: bookmarks
                    };
                    otherBookmarks.push(folderBookmark);
                }
            }
        } else if (a) {
            // 顶级链接书签 → 归入"其他收藏夹"
            const bookmark = parseBookmarkAnchor(a);
            if (bookmark) {
                otherBookmarks.push(bookmark);
            }
        }
    }
    
    // 添加收藏夹栏分类
    if (toolbarCategory) {
        categories.push(toolbarCategory);
    }
    
    // 添加"其他收藏夹"分类（如果有内容）
    if (otherBookmarks.length > 0) {
        categories.push({
            id: generateId('cat'),
            name: '其他收藏夹',
            bookmarks: otherBookmarks
        });
    }
    
    if (!categories.length) return null;
    
    return {
        activeCategory: categories[0].id,
        categories
    };
}

/**
 * 递归解析 DL 元素中的书签和文件夹
 */
function parseBookmarkDL(dlElement) {
    if (!dlElement) return [];
    
    const bookmarks = [];
    const dts = Array.from(dlElement.children).filter(el => el.tagName === 'DT');
    
    for (const dt of dts) {
        const h3 = dt.querySelector(':scope > H3');
        const a = dt.querySelector(':scope > A');
        
        if (h3) {
            // 子文件夹
            const folderName = h3.textContent.trim() || '未命名文件夹';
            const subDL = dt.querySelector(':scope > DL');
            const children = subDL ? parseBookmarkDL(subDL) : [];
            
            if (children.length > 0) {
                const folderBookmark = {
                    id: generateId('folder'),
                    title: folderName,
                    type: 'folder',
                    iconType: 'custom',
                    icon: buildColorSwatchDataUrl('#6b7280', folderName.slice(0, 2)),
                    iconFallbacks: [],
                    children
                };
                bookmarks.push(folderBookmark);
            }
        } else if (a) {
            const bookmark = parseBookmarkAnchor(a);
            if (bookmark) {
                bookmarks.push(bookmark);
            }
        }
    }
    
    return bookmarks;
}

/**
 * 解析单个书签 A 元素
 */
function parseBookmarkAnchor(anchorElement) {
    if (!anchorElement) return null;
    
    const href = anchorElement.getAttribute('HREF');
    const url = normalizeUrlInput(href);
    if (!url) return null;
    
    const title = anchorElement.textContent.trim() || url;
    const iconAttr = anchorElement.getAttribute('ICON');
    
    // 如果有内嵌的 base64 图标，使用它
    let iconType = 'favicon';
    let icon = '';
    let iconFallbacks = [];
    
    if (iconAttr && iconAttr.startsWith('data:image')) {
        iconType = 'custom';
        icon = iconAttr;
    } else {
        const meta = generateHighResIconMeta(url);
        icon = meta.icon;
        iconFallbacks = meta.iconFallbacks;
    }
    
    return {
        id: generateId('bm'),
        title,
        url,
        iconType,
        icon,
        iconFallbacks
    };
}

/**
 * 解析 Safari 导出的 Netscape Bookmark HTML 文件
 * Safari 书签结构说明：
 * - "个人收藏" - Safari 的收藏夹栏（类似 Edge 的收藏夹栏）
 * - "书签菜单" - Safari 的书签菜单
 * - "阅读列表" - Safari 特有的阅读列表（id="com.apple.ReadingList"）
 * - 顶级书签 - 不在任何文件夹中的书签
 */
function parseSafariBookmarkHtml(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string') return null;
    
    // 检查是否为 Netscape Bookmark 格式
    if (!htmlContent.includes('NETSCAPE-Bookmark-file-1') && !htmlContent.includes('<DL>')) {
        return null;
    }
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    
    // 找到根 DL 元素
    const rootDL = doc.querySelector('DL');
    if (!rootDL) return null;
    
    const categories = [];
    let readingListBookmarks = [];
    let topLevelBookmarks = [];
    
    // 遍历根 DL 的直接子 DT 元素
    const topLevelDTs = Array.from(rootDL.children).filter(el => el.tagName === 'DT');
    
    for (const dt of topLevelDTs) {
        const h3 = dt.querySelector(':scope > H3');
        const a = dt.querySelector(':scope > A');
        
        if (h3) {
            // 这是一个文件夹
            const folderId = h3.getAttribute('id') || '';
            const folderName = h3.textContent.trim() || '未命名文件夹';
            const subDL = dt.querySelector(':scope > DL');
            const bookmarks = subDL ? parseSafariBookmarkDL(subDL) : [];
            
            // 检查是否是阅读列表（Safari 特有）
            if (folderId === 'com.apple.ReadingList') {
                // 将阅读列表作为单独的分类
                if (bookmarks.length > 0) {
                    categories.push({
                        id: generateId('cat'),
                        name: '阅读列表',
                        bookmarks
                    });
                }
            } else if (folderName === '个人收藏' || folderName === '收藏夹') {
                // Safari 的"个人收藏"文件夹 - 作为主分类
                if (bookmarks.length > 0) {
                    categories.unshift({
                        id: generateId('cat'),
                        name: folderName,
                        bookmarks
                    });
                }
            } else if (folderName === '书签菜单') {
                // Safari 的"书签菜单" - 作为单独分类
                if (bookmarks.length > 0) {
                    categories.push({
                        id: generateId('cat'),
                        name: folderName,
                        bookmarks
                    });
                }
            } else {
                // 其他顶级文件夹 - 作为单独的分类
                if (bookmarks.length > 0) {
                    categories.push({
                        id: generateId('cat'),
                        name: folderName,
                        bookmarks
                    });
                }
            }
        } else if (a) {
            // 顶级链接书签
            const bookmark = parseBookmarkAnchor(a);
            if (bookmark) {
                topLevelBookmarks.push(bookmark);
            }
        }
    }
    
    // 将顶级书签添加为"未分类书签"分类
    if (topLevelBookmarks.length > 0) {
        categories.push({
            id: generateId('cat'),
            name: '未分类书签',
            bookmarks: topLevelBookmarks
        });
    }
    
    if (!categories.length) return null;
    
    return {
        activeCategory: categories[0].id,
        categories
    };
}

/**
 * 递归解析 Safari 书签 DL 元素中的书签和文件夹
 */
function parseSafariBookmarkDL(dlElement) {
    if (!dlElement) return [];
    
    const bookmarks = [];
    const dts = Array.from(dlElement.children).filter(el => el.tagName === 'DT');
    
    for (const dt of dts) {
        const h3 = dt.querySelector(':scope > H3');
        const a = dt.querySelector(':scope > A');
        
        if (h3) {
            // 子文件夹
            const folderName = h3.textContent.trim() || '未命名文件夹';
            const subDL = dt.querySelector(':scope > DL');
            const children = subDL ? parseSafariBookmarkDL(subDL) : [];
            
            if (children.length > 0) {
                const folderBookmark = {
                    id: generateId('folder'),
                    title: folderName,
                    type: 'folder',
                    iconType: 'custom',
                    icon: buildColorSwatchDataUrl('#6b7280', folderName.slice(0, 2)),
                    iconFallbacks: [],
                    children
                };
                bookmarks.push(folderBookmark);
            }
        } else if (a) {
            const bookmark = parseBookmarkAnchor(a);
            if (bookmark) {
                bookmarks.push(bookmark);
            }
        }
    }
    
    return bookmarks;
}

function parseMyLocalNewTabData(raw) {
    if (!raw || !Array.isArray(raw.categories)) return null;
    const categories = raw.categories.map((cat, index) => {
        if (!cat) return null;
        const catId = cat.id || generateId('cat');
        const catName = cat.name || `分类${index + 1}`;
        const bookmarks = Array.isArray(cat.bookmarks)
            ? cat.bookmarks.map(normalizeNativeBookmark).filter(Boolean)
            : [];
        return {
            id: catId,
            name: catName,
            bookmarks
        };
    }).filter(Boolean);

    if (!categories.length) return null;
    const activeCategory = categories.some(c => c.id === raw.activeCategory)
        ? raw.activeCategory
        : categories[0].id;
    const background = extractBackgroundFromData(raw);
    return background ? { categories, activeCategory, background } : { categories, activeCategory };
}

function normalizeNativeBookmark(bm) {
    if (!bm) return null;
    
    // 处理文件夹类型
    if (bm.type === 'folder') {
        const folder = {
            id: bm.id || generateId('bm'),
            title: bm.title || bm.name || '未命名文件夹',
            type: 'folder',
            children: Array.isArray(bm.children)
                ? bm.children.map(normalizeNativeBookmark).filter(Boolean)
                : []
        };
        return folder;
    }
    
    // 处理普通链接书签
    const url = normalizeUrlInput(bm.url || bm.target);
    if (!url) return null;
    const meta = generateHighResIconMeta(url);
    const iconType = bm.iconType === 'custom' ? 'custom' : 'favicon';
    const bookmark = {
        id: bm.id || generateId('bm'),
        title: bm.title || bm.name || url,
        url,
        iconType,
        icon: normalizePersistedAssetUrl(bm.icon || (iconType === 'favicon' ? meta.icon : '')),
        iconFallbacks: Array.isArray(bm.iconFallbacks)
            ? bm.iconFallbacks
                .map(item => (typeof item === 'string' ? normalizePersistedAssetUrl(item) : ''))
                .filter(Boolean)
            : []
    };

    if (bookmark.iconType === 'favicon') {
        bookmark.iconFallbacks = bookmark.iconFallbacks.length ? bookmark.iconFallbacks : meta.iconFallbacks;
        bookmark.icon = bookmark.icon || meta.icon;
    } else {
        bookmark.iconFallbacks = [];
        bookmark.icon = bookmark.icon || 'icons/default.svg';
    }
    return bookmark;
}

function mergeImportedData(current, incoming) {
    const base = current && Array.isArray(current.categories) ? deepClone(current) : { categories: [], activeCategory: null };
    const result = base;
    result.categories = Array.isArray(result.categories) ? result.categories : [];

    const idMap = new Map();
    const nameMap = new Map();
    result.categories.forEach(cat => {
        if (cat.id) idMap.set(cat.id, cat);
        if (cat.name) nameMap.set(normalizeNameKey(cat.name), cat);
        cat.bookmarks = Array.isArray(cat.bookmarks) ? cat.bookmarks : [];
    });

    const incomingCategories = incoming && Array.isArray(incoming.categories) ? incoming.categories : [];
    incomingCategories.forEach(cat => {
        if (!cat) return;
        const nameKey = normalizeNameKey(cat.name);
        const target = (cat.id && idMap.get(cat.id)) || nameMap.get(nameKey);
        if (target) {
            mergeBookmarksIntoCategory(target, cat.bookmarks || []);
        } else {
            const newCat = {
                id: cat.id || generateId('cat'),
                name: cat.name || '未命名分类',
                bookmarks: Array.isArray(cat.bookmarks) ? [...cat.bookmarks] : []
            };
            result.categories.push(newCat);
            if (newCat.id) idMap.set(newCat.id, newCat);
            if (newCat.name) nameMap.set(normalizeNameKey(newCat.name), newCat);
        }
    });

    const incomingActive = incoming?.activeCategory;
    const activeExists = result.categories.some(c => c.id === result.activeCategory);
    if (!activeExists) {
        const incomingExists = result.categories.some(c => c.id === incomingActive);
        result.activeCategory = incomingExists ? incomingActive : (result.categories[0]?.id || null);
    }

    const incomingBg = extractBackgroundFromData(incoming);
    const baseBg = extractBackgroundFromData(result) || extractBackgroundFromData(current);
    result.background = normalizeBackgroundSettings(incomingBg || baseBg || DEFAULT_SETTINGS.background);

    const mergedUiOpacity = normalizeUiOpacity(
        incoming?.uiOpacity ?? result.uiOpacity ?? current?.uiOpacity ?? DEFAULT_SETTINGS.uiOpacity
    );
    result.uiOpacity = mergedUiOpacity;

    return result;
}

function mergeBookmarksIntoCategory(targetCat, bookmarks) {
    if (!targetCat || !Array.isArray(bookmarks)) return;
    const existingUrls = new Set();
    walkCategoryBookmarks(targetCat, (bm) => {
        if (bm.type === 'folder') return;
        const u = normalizeUrlInput(bm.url || bm.target);
        if (u) existingUrls.add(u);
    });
    const nextBookmarks = Array.isArray(targetCat.bookmarks) ? targetCat.bookmarks : [];
    bookmarks.forEach(bm => {
        if (!bm) return;
        if (bm.type === 'folder') {
            nextBookmarks.push({
                ...bm,
                id: bm.id || generateId('folder')
            });
            return;
        }
        const url = normalizeUrlInput(bm.url || bm.target);
        if (!url || existingUrls.has(url)) return;
        existingUrls.add(url);
        nextBookmarks.push({
            ...bm,
            id: bm.id || generateId('bm'),
            url
        });
    });
    targetCat.bookmarks = nextBookmarks;
}

function normalizeNameKey(name = '') {
    return name.trim().toLowerCase();
}

function parseWeTabData(raw) {
    const icons = raw?.data?.['store-icon']?.icons || raw?.icons;
    if (!Array.isArray(icons)) return null;
    const categories = [];

    icons.forEach((section, index) => {
        if (!section) return;
        const catId = section.id || generateId('cat');
        const catName = section.name || section.iconClass || `WeTab 分类 ${index + 1}`;
        const bookmarks = [];
        const children = Array.isArray(section.children) ? section.children : [];

        children.forEach(child => collectWeTabSites(child, bookmarks));

        if (bookmarks.length) {
            categories.push({
                id: catId,
                name: catName,
                bookmarks
            });
        }
    });

    if (!categories.length) return null;
    return {
        activeCategory: categories[0].id,
        categories
    };
}

function collectWeTabSites(node, bookmarks, folderName = '') {
    if (!node) return;
    if (node.type === 'folder-icon' && Array.isArray(node.children)) {
        const nextFolder = node.name || folderName;
        const folderChildren = [];
        node.children.forEach(child => collectWeTabSites(child, folderChildren, nextFolder));
        if (folderChildren.length) {
            const folderBookmark = buildFolderBookmark(node, folderChildren, nextFolder);
            bookmarks.push(folderBookmark);
        }
        return;
    }
    if (node.type && node.type !== 'site') {
        return;
    }
    const url = normalizeUrlInput(node.target || node.url);
    if (!url) return;
    const baseTitle = node.name || node.title || url;
    const title = baseTitle;
    const iconMeta = deriveWeTabIcon(node, url);
    bookmarks.push({
        id: generateId('bm'),
        title,
        url,
        iconType: iconMeta.iconType,
        icon: iconMeta.icon,
        iconFallbacks: iconMeta.iconFallbacks
    });
}

function buildFolderBookmark(folderNode, children, folderName = '') {
    const title = folderName || folderNode.name || '文件夹';
    const normalizedChildren = normalizeFolderChildTitles(title, children, { clone: true });
    let iconSrc = resolveWeTabImage(folderNode.bgImage);
    if (!iconSrc && folderNode.bgType === 'color' && folderNode.bgColor) {
        iconSrc = buildColorSwatchDataUrl(folderNode.bgColor, title.slice(0, 2));
    }
    if (!iconSrc && children.length) {
        iconSrc = children[0].icon || '';
    }
    if (!iconSrc) {
        const firstUrl = children[0]?.url;
        const meta = firstUrl ? generateHighResIconMeta(firstUrl) : null;
        iconSrc = meta?.icon || 'icons/default.svg';
    }
    return {
        id: folderNode.id || generateId('folder'),
        title,
        url: '#',
        type: 'folder',
        iconType: 'custom',
        icon: iconSrc,
        iconFallbacks: [],
        children: normalizedChildren
    };
}

function deriveWeTabIcon(entry, url) {
    const bgType = (entry.bgType || '').toLowerCase();
    if (bgType === 'image') {
        const imageSrc = resolveWeTabImage(entry.bgImage);
        if (imageSrc) {
            return {
                iconType: 'custom',
                icon: imageSrc,
                iconFallbacks: []
            };
        }
    }
    if (bgType === 'color' && entry.bgColor) {
        return {
            iconType: 'custom',
            icon: buildColorSwatchDataUrl(entry.bgColor, entry.bgText || entry.name),
            iconFallbacks: []
        };
    }
    const meta = generateHighResIconMeta(url);
    return {
        iconType: 'favicon',
        icon: meta.icon,
        iconFallbacks: meta.iconFallbacks
    };
}

function resolveWeTabImage(bgImage) {
    if (!bgImage) return '';
    if (typeof bgImage === 'string') return bgImage;
    if (typeof bgImage === 'object') {
        const preferredKeys = ['large', 'medium', 'small', 'url', 'src'];
        for (const key of preferredKeys) {
            if (bgImage[key]) {
                return bgImage[key];
            }
        }
    }
    return '';
}

function buildColorSwatchDataUrl(color, label = '') {
    const safeColor = typeof color === 'string' && color.trim() ? color.replace(/["']/g, '').trim() : '#888';
    const text = (label || '').trim().slice(0, 2);
    const textMarkup = text
        ? `<text x="32" y="38" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="rgba(255,255,255,0.92)" font-weight="700">${escapeForSvg(text)}</text>`
        : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${safeColor}"/>${textMarkup}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function escapeForSvg(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return char;
        }
    });
}

function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    const parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    const meta = parts[0];
    const mimeMatch = meta.match(/data:([^;]+);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const binary = atob(parts[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function inferExtFromMime(mime = '') {
    const map = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/avif': 'avif',
        'image/gif': 'gif'
    };
    return map[mime.toLowerCase()] || '';
}

function inferMimeFromExtension(ext = '') {
    const map = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        avif: 'image/avif',
        gif: 'image/gif'
    };
    const lowered = ext.toLowerCase();
    return map[lowered] || '';
}

function inferMimeFromDataUrl(dataUrl = '') {
    const match = dataUrl.match(/^data:([^;]+);/);
    return match ? match[1] : '';
}

async function applyBackgroundFromSettings() {
    const normalizedBg = normalizeBackgroundSettings(appSettings.background);
    appSettings.background = normalizedBg;
    const rawImageUrl = normalizedBg.image || '';
    const imageUrl = resolveAssetDisplayUrl(rawImageUrl);
    const root = document.documentElement;

    if (!imageUrl) {
        if (root) {
            root.style.setProperty('--custom-bg-image', 'none');
            root.style.setProperty('--custom-bg-opacity', 0);
        }
        if (document.body) {
            document.body.classList.remove('custom-bg-enabled');
        }
        return;
    }

    if (root) {
        root.style.setProperty('--custom-bg-opacity', normalizedBg.opacity);
    }

    return new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            if (ok) {
                if (root) root.style.setProperty('--custom-bg-image', `url(${imageUrl})`);
                if (document.body) document.body.classList.add('custom-bg-enabled');
            } else if (document.body) {
                document.body.classList.remove('custom-bg-enabled');
            }
            resolve();
        };
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        setTimeout(() => finish(true), 1500);
        img.src = imageUrl;
    });
}

function extractBackgroundFromData(data) {
    if (!data || typeof data !== 'object') return null;
    const raw = data.background;
    if (raw && typeof raw === 'object') {
        return normalizeBackgroundSettings(raw);
    }
    return null;
}

function extractUiOpacityFromData(data) {
    if (!data || typeof data !== 'object') return null;
    const value = data.uiOpacity;
    if (value === undefined || value === null) return null;
    return normalizeUiOpacity(value);
}

function maybeSyncBackgroundFromData(data, { saveSettingsFlag = false } = {}) {
    const bg = extractBackgroundFromData(data);
    if (!bg) return false;
    const current = normalizeBackgroundSettings(appSettings.background);
    const merged = normalizeBackgroundSettings({ ...current, ...bg });
    appSettings.background = merged;
    applyBackgroundFromSettings({ allowBlocking: true });
    if (saveSettingsFlag) {
        saveSettings();
    }
    return true;
}

function maybeSyncUiOpacityFromData(data, { saveSettingsFlag = false } = {}) {
    const value = extractUiOpacityFromData(data);
    if (value === null) return false;
    appSettings.uiOpacity = normalizeUiOpacity(value);
    applyUiOpacity(appSettings.uiOpacity);
    if (saveSettingsFlag) {
        saveSettings();
    }
    return true;
}

function attachBackgroundToData(data) {
    if (!data || typeof data !== 'object') return data;
    const normalized = normalizeBackgroundSettings(appSettings.background);
    data.background = normalized;
    data.uiOpacity = getUiOpacity();
    return data;
}

function persistBackgroundChange() {
    attachBackgroundToData(appData);
    saveData({ notifyOnError: true });
}

function updateBackgroundControlsUI() {
    const uiOpacity = applyUiOpacity(appSettings.uiOpacity);
    if (els.uiOpacity) {
        els.uiOpacity.value = Math.round(uiOpacity * 100);
    }
    if (els.uiOpacityValue) {
        els.uiOpacityValue.textContent = `${Math.round(uiOpacity * 100)}%`;
    }

    const background = normalizeBackgroundSettings(appSettings.background);
    appSettings.background = background;

    if (els.backgroundOpacity) {
        els.backgroundOpacity.value = Math.round(background.opacity * 100);
    }
    if (els.backgroundOpacityValue) {
        els.backgroundOpacityValue.textContent = `${Math.round(background.opacity * 100)}%`;
    }
    if (els.bgSourceTip) {
        els.bgSourceTip.textContent = '本地：背景保存到本地数据库，可导出数据迁移。';
    }

    const actualImageUrl = normalizePersistedAssetUrl(background.image || '');
    const sourceUrl = typeof background.source === 'string' ? background.source.trim() : '';
    const displayUrl = sourceUrl || (
        actualImageUrl && !isPersistedAssetReference(actualImageUrl) && !actualImageUrl.startsWith('data:')
            ? actualImageUrl
            : ''
    );
    const isUrl = !!displayUrl;

    if (els.backgroundUrlInput) {
        els.backgroundUrlInput.disabled = false;
        els.backgroundUrlInput.placeholder = 'https://example.com/background.jpg';
        els.backgroundUrlInput.value = isUrl ? displayUrl : '';
    }

    const urlModeTip = document.getElementById('urlModeTip');
    if (urlModeTip) {
        urlModeTip.textContent = '推荐使用稳定的图片链接；链接图片会自动下载并保存到本地数据库。';
    }

    if (els.bgStatusTag) {
        if (!actualImageUrl) {
            els.bgStatusTag.textContent = '🖼️ 未设置背景';
            els.bgStatusTag.className = 'bg-tag';
        } else if (isPersistedAssetReference(actualImageUrl)) {
            els.bgStatusTag.textContent = '📦 本地数据库';
            els.bgStatusTag.className = 'bg-tag accent';
        } else if (actualImageUrl.startsWith('data:')) {
            els.bgStatusTag.textContent = '📦 本地数据';
            els.bgStatusTag.className = 'bg-tag';
        } else {
            els.bgStatusTag.textContent = '🔗 图片链接';
            els.bgStatusTag.className = 'bg-tag';
        }
    }

    if (els.bgModeTabs && els.bgModePanels) {
        const targetMode = isUrl ? 'url' : 'upload';
        Array.from(els.bgModeTabs).forEach(t => {
            t.classList.toggle('active', t.dataset.mode === targetMode);
            t.disabled = false;
        });
        Array.from(els.bgModePanels).forEach(p => p.classList.toggle('hidden', p.dataset.mode !== targetMode));
    }

    if (els.backgroundPreview) {
        const hasImage = !!actualImageUrl;
        const previewUrl = resolveAssetDisplayUrl(actualImageUrl);
        els.backgroundPreview.classList.toggle('has-image', hasImage);
        els.backgroundPreview.style.backgroundImage = hasImage ? `url(${previewUrl})` : 'none';
        els.backgroundPreview.style.setProperty('--bg-preview-opacity', background.opacity);
    }
    if (els.clearBackgroundBtn) {
        els.clearBackgroundBtn.disabled = !actualImageUrl;
    }
}

function handleUiOpacityInput(event, { persist = false } = {}) {
    const slider = event?.target || els.uiOpacity;
    if (!slider) return;
    const raw = parseInt(slider.value, 10);
    const opacity = normalizeUiOpacity(raw / 100);
    applyUiOpacity(opacity);
    if (appData && typeof appData === 'object') {
        appData.uiOpacity = opacity;
    }
    if (els.uiOpacityValue) {
        els.uiOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
    }
    if (persist) {
        saveSettings();
        saveData();
    }
}

function handleBackgroundOpacityInput(event) {
    const slider = event?.target || els.backgroundOpacity;
    if (!slider) return;
    const raw = parseInt(slider.value, 10);
    const opacity = clamp01(raw / 100, appSettings.background?.opacity);
    appSettings.background = normalizeBackgroundSettings({
        ...appSettings.background,
        opacity
    });
    saveSettings();
    applyBackgroundFromSettings({ allowBlocking: true });
    updateBackgroundControlsUI();
}

async function handleBackgroundImageChange(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) {
        alert('请选择图片文件。');
        event.target.value = '';
        return;
    }

    try {
        const persistedUrl = await persistBlobAsset(file, {
            fileName: file.name || 'background',
            sourceUrl: `background:${file.name || ''}`
        });
        if (!persistedUrl) {
            throw new Error('未返回资源地址');
        }
        appSettings.background = normalizeBackgroundSettings({
            ...appSettings.background,
            image: persistedUrl,
            source: ''
        });
        const saveSuccess = await saveSettingsWithValidation();
        if (!saveSuccess) {
            alert('保存失败，请检查数据库写入权限。');
            appSettings.background = normalizeBackgroundSettings({
                ...appSettings.background,
                image: '',
                source: ''
            });
            event.target.value = '';
            return;
        }
        
        applyBackgroundFromSettings({ allowBlocking: true });
        updateBackgroundControlsUI();
        persistBackgroundChange();
    } catch (error) {
        console.error('处理图片失败:', error);
        alert('读取图片失败，请重试。');
    }
    
    event.target.value = '';
}

function saveSettingsWithValidation() {
    return new Promise((resolve) => {
        appSettings = mergeSettingsWithDefaults(appSettings);
        syncCustomDomainToLocalStorage(appSettings.customDomain);
        chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: appSettings }, () => {
            if (chrome.runtime.lastError) {
                console.error('保存设置失败:', chrome.runtime.lastError);
                resolve(false);
            } else {
                chrome.storage.local.remove([STORAGE_KEYS.BACKGROUND_IMAGE], () => {});
                resolve(true);
            }
        });
    });
}

async function handleBackgroundUrlChange() {
    if (!els.backgroundUrlInput) return;
    const url = els.backgroundUrlInput.value.trim();
    
    if (!url) {
        clearBackgroundImage();
        return;
    }
    
    // 简单的 URL 格式验证
    try {
        new URL(url);
    } catch (e) {
        alert('请输入有效的图片链接地址');
        return;
    }

    try {
        const persistedUrl = await fetchExternalAssetToLocal(url, { maxBytes: DEFAULT_EXTERNAL_FETCH_MAX_BYTES });
        if (!persistedUrl) {
            throw new Error('无法下载该图片');
        }
        appSettings.background = normalizeBackgroundSettings({
            ...appSettings.background,
            image: persistedUrl,
            source: url
        });
        saveSettings();
        applyBackgroundFromSettings({ allowBlocking: true });
        updateBackgroundControlsUI();
        persistBackgroundChange();
    } catch (error) {
        console.error('拉取背景图片失败:', error);
        alert(`拉取背景图片失败：${error.message}`);
    }
}

function clearBackgroundImage() {
    appSettings.background = normalizeBackgroundSettings({
        ...appSettings.background,
        image: '',
        source: ''
    });
    if (els.backgroundImageInput) {
        els.backgroundImageInput.value = '';
    }
    if (els.backgroundUrlInput) {
        els.backgroundUrlInput.value = '';
    }
    saveSettings();
    applyBackgroundFromSettings({ allowBlocking: true });
    updateBackgroundControlsUI();
    persistBackgroundChange();
}

function bindBackgroundControls() {
    if (els.toggleBgSettingsBtn && els.bgSettingsPanel) {
        els.toggleBgSettingsBtn.addEventListener('click', () => {
            const isHidden = els.bgSettingsPanel.classList.contains('hidden');
            els.bgSettingsPanel.classList.toggle('hidden', !isHidden);
            els.toggleBgSettingsBtn.textContent = isHidden ? '收起设置' : '设置背景';
        });
    }
    if (els.backgroundImageInput) {
        els.backgroundImageInput.addEventListener('change', handleBackgroundImageChange);
    }
    if (els.uiOpacity) {
        els.uiOpacity.addEventListener('input', handleUiOpacityInput);
        els.uiOpacity.addEventListener('change', (e) => handleUiOpacityInput(e, { persist: true }));
    }
    if (els.backgroundOpacity) {
        els.backgroundOpacity.addEventListener('input', handleBackgroundOpacityInput);
        els.backgroundOpacity.addEventListener('change', (e) => {
            handleBackgroundOpacityInput(e);
            persistBackgroundChange();
        });
    }
    if (els.clearBackgroundBtn) {
        els.clearBackgroundBtn.addEventListener('click', () => {
            clearBackgroundImage();
        });
    }
    
    // 背景录入模式切换（上传/链接）
    if (els.bgModeTabs && els.bgModePanels) {
        Array.from(els.bgModeTabs).forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode;
                Array.from(els.bgModeTabs).forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
                Array.from(els.bgModePanels).forEach(p => p.classList.toggle('hidden', p.dataset.mode !== mode));
            });
        });
    }
    
    // URL 输入框变化
    if (els.backgroundUrlInput) {
        els.backgroundUrlInput.addEventListener('blur', handleBackgroundUrlChange);
        els.backgroundUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleBackgroundUrlChange();
            }
        });
    }
}

function updateStorageInfoVisibility(mode) {
    toggleSettingsSection(els.browserStorageInfo, true);
}

function toggleSettingsSection(el, show) {
    if (!el) return;
    el.classList.toggle('hidden', !show);
}

function populateSettingsForm() {
    // 填充自定义域名
    if (els.customDomainInput) {
        els.customDomainInput.value = appSettings.customDomain || '';
    }
    updateBackgroundControlsUI();
}

function syncSettingsFromUI() {
    // 读取自定义域名设置
    const customDomain = els.customDomainInput ? els.customDomainInput.value.trim() : (appSettings.customDomain || '');
    appSettings = mergeSettingsWithDefaults({
        ...appSettings,
        customDomain,
        uiOpacity: els.uiOpacity ? parseInt(els.uiOpacity.value, 10) / 100 : appSettings.uiOpacity,
        background: normalizeBackgroundSettings({
            ...appSettings.background,
            opacity: els.backgroundOpacity ? parseInt(els.backgroundOpacity.value, 10) / 100 : appSettings.background?.opacity,
            image: appSettings.background?.image
        })
    });
    appSettings.storageMode = STORAGE_MODES.BROWSER;
    appSettings.background = normalizeBackgroundSettings(appSettings.background);
    if (appData && typeof appData === 'object') {
        appData.uiOpacity = appSettings.uiOpacity;
    }
    applyBackgroundFromSettings({ allowBlocking: true });
    updateBackgroundControlsUI();
}

function bindSettingsInputListeners() {
    // 纯本地模式无需额外配置输入项
}

async function applyStorageConfig() {
    syncSettingsFromUI();
    appSettings.storageMode = STORAGE_MODES.BROWSER;
    saveSettings();
    attachBackgroundToData(appData);
    await saveData({ immediate: true });
    updateStorageInfoVisibility(STORAGE_MODES.BROWSER);
    closeSettingsModal();
}

function isPointerOutsideOpenModals(target) {
    // 检查是否点击在右键菜单上
    const contextMenus = document.querySelectorAll('.context-menu');
    for (const menu of contextMenus) {
        if (menu.contains(target)) return false;
    }
    
    // 检查是否点击在批量操作状态栏上
    const batchStatusBar = document.getElementById('batchStatusBar');
    if (batchStatusBar && batchStatusBar.contains(target)) return false;
    
    const modals = [els.bookmarkModal, els.categoryModal, els.settingsModal, els.folderModal].filter(m => m && !m.classList.contains('hidden'));
    if (!modals.length) return false;
    return modals.every(modal => {
        const content = modal.querySelector('.modal-content');
        return content ? !content.contains(target) : true;
    });
}

// --- 事件监听 ---

function setupEventListeners() {
    bindSettingsInputListeners();
    bindBackgroundControls();
    bindBookmarkSearchEvents();

    if (els.sidebarToggleBtn) {
        els.sidebarToggleBtn.addEventListener('click', () => {
            toggleMobileSidebar();
        });
    }

    if (els.sidebarBackdrop) {
        els.sidebarBackdrop.addEventListener('click', () => {
            closeMobileSidebar({ focusToggle: true });
        });
    }

    window.addEventListener('resize', scheduleResponsiveLayoutSync, { passive: true });
    window.addEventListener('orientationchange', scheduleResponsiveLayoutSync);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleResponsiveLayoutSync, { passive: true });
        window.visualViewport.addEventListener('scroll', scheduleResponsiveLayoutSync, { passive: true });
    }
    
    // 书签网格空白区域右键菜单
    if (els.bookmarkGrid) {
        els.bookmarkGrid.addEventListener('contextmenu', (e) => {
            // 只在点击空白区域时触发（不是书签卡片或添加按钮）
            const target = e.target;
            const isCard = target.closest('.bookmark-card');
            const isAddCard = target.closest('.add-bookmark-card');
            if (!isCard && !isAddCard) {
                e.preventDefault();
                const currentCat = getActiveCategory();
                showGridContextMenu(e.clientX, e.clientY, {
                    categoryId: currentCat?.id || appData.activeCategory,
                    folderId: null
                });
            }
        });
    }
    
    // 文件夹模态框内空白区域右键菜单
    if (els.folderContent) {
        els.folderContent.addEventListener('contextmenu', (e) => {
            // 只在点击空白区域时触发（不是书签卡片或添加按钮）
            const target = e.target;
            const isCard = target.closest('.bookmark-card');
            const isAddCard = target.closest('.add-bookmark-card');
            if (!isCard && !isAddCard && openFolderId) {
                e.preventDefault();
                showGridContextMenu(e.clientX, e.clientY, {
                    categoryId: openFolderCategoryId || appData.activeCategory,
                    folderId: openFolderId
                });
            }
        });
    }
    
    // 搜索
    if (els.searchEngineSelect) {
        els.searchEngineSelect.addEventListener('change', () => {
            appSettings.searchEngine = els.searchEngineSelect.value;
            saveSettings();
            updateSearchPlaceholder(appSettings.searchEngine);
        });
    }

    els.searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const query = els.searchInput.value;
            if (query) {
                const engine = appSettings.searchEngine || 'google';
                let url = '';
                switch (engine) {
                    case 'bing':
                        url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
                        break;
                    case 'baidu':
                        url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
                        break;
                    case 'yahoo':
                        url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
                        break;
                    case 'google':
                    default:
                        url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                        break;
                }
                window.location.href = url;
            }
        }
    });

    // 模态框关闭
    els.cancelBookmarkBtn.onclick = () => {
        const keepFolderOpen = !!(openFolderId && !(els.folderModal && els.folderModal.classList.contains('hidden')));
        closeModals({ keepFolderOpen });
    };
    els.cancelCategoryBtn.onclick = closeModals;
    if (els.closeSettingsBtn) {
        els.closeSettingsBtn.onclick = () => {
            syncSettingsFromUI();
            saveSettings();
            closeSettingsModal();
        };
    }
    if (els.settingsBtn) {
        els.settingsBtn.onclick = () => {
            closeMobileSidebar();
            openSettingsModal();
        };
    }
    if (els.retryUncachedIconsBtn) {
        els.retryUncachedIconsBtn.addEventListener('click', retryUncachedIcons);
    }
    if (els.closeFolderBtn) {
        els.closeFolderBtn.onclick = () => {
            if (openFolderId) {
                const loc = findBookmarkLocation(openFolderId);
                if (loc && loc.parentFolderId) {
                    const parentCard = findBookmarkCardElement(loc.parentFolderId);
                    if (document.startViewTransition) {
                        document.startViewTransition(() => {
                            openFolderModal(loc.parentFolderId, { anchorElement: parentCard });
                        });
                    } else {
                        openFolderModal(loc.parentFolderId, { anchorElement: parentCard });
                    }
                    return;
                }
            }
            closeFolderModal();
        };
    }
    if (els.applySettingsBtn) {
        els.applySettingsBtn.onclick = () => {
            applyStorageConfig();
        };
    }
    window.addEventListener('pointerdown', (e) => {
        // 检查是否点击在右键菜单上
        pointerDownOnContextMenu = !!e.target.closest('.context-menu');
        pointerDownOutsideModal = isPointerOutsideOpenModals(e.target);
    });
    window.addEventListener('pointerup', (e) => {
        // 如果是在右键菜单上点击的，不触发关闭模态框
        if (pointerDownOnContextMenu) {
            pointerDownOutsideModal = false;
            pointerDownOnContextMenu = false;
            return;
        }
        const pointerUpOutside = isPointerOutsideOpenModals(e.target);
        if (pointerDownOutsideModal && pointerUpOutside) {
            closeModals();
        }
        pointerDownOutsideModal = false;
        pointerDownOnContextMenu = false;
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (isMobileLayout() && isMobileSidebarOpen) {
                closeMobileSidebar({ focusToggle: true });
                return;
            }
            // 如果在批量选择模式，先退出批量选择
            if (batchSelectState.enabled) {
                toggleBatchSelectMode(false);
                return;
            }
            const keepFolderOpen = !!(openFolderId && !(els.folderModal && els.folderModal.classList.contains('hidden')));
            closeModals({ keepFolderOpen });
        }
    });

    if (els.folderAddBtn) {
        els.folderAddBtn.onclick = () => {
            openAddBookmarkModal({
                type: 'link',
                categoryId: openFolderCategoryId || appData.activeCategory,
                folderId: openFolderId || null
            });
        };
    }
    if (els.folderModalTitle) {
        els.folderModalTitle.style.cursor = 'pointer';
        els.folderModalTitle.title = '点击重命名';
        els.folderModalTitle.onclick = () => {
            enableFolderTitleEditing();
        };
    }

    // 添加分类
    els.addCategoryBtn.onclick = () => {
        closeMobileSidebar();
        els.categoryForm.reset();
        animateModalVisibility(els.categoryModal, { open: true });
    };

    els.categoryForm.onsubmit = (e) => {
        e.preventDefault();
        const name = els.categoryName.value.trim();
        if (name) {
            appData.categories.push({
                id: generateId('cat'),
                name: name,
                bookmarks: []
            });
            // 分类创建是重要操作，立即保存
            saveData({ immediate: true });
            renderCategories(); // 重新渲染分类列表
            closeModals();
        }
    };

    // 添加类型切换
    Array.from(els.bookmarkTypeButtons || []).forEach(btn => {
        btn.addEventListener('click', () => {
            if (modalState.lockType && btn.dataset.type !== modalState.type) return;
            setModalType(btn.dataset.type || 'link', { lock: modalState.lockType });
        });
    });

    // 图标类型切换
    Array.from(els.iconTypeRadios).forEach(radio => {
        radio.addEventListener('change', (e) => {
            toggleIconInput(e.target.value);
        });
    });

    Array.from(els.storageModeRadios || []).forEach(radio => {
        radio.addEventListener('change', async (e) => {
            if (e.target.checked) {
                await handleStorageModeChange(e.target.value);
            }
        });
    });

    // 自定义图标预览
    els.customIconInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                selectedCustomIconSrc = e.target.result;
                customIconMode = 'upload';
                activateCustomIconTab('upload');
                setIconPreviewSource(e.target.result);
            };
            reader.readAsDataURL(file);
        }
    });
    bindCustomSwatchEvents();
    bindFolderExitDropzone();
    setupDragNavigation();

    // 自动填充标题 (简单的优化)
    els.bookmarkUrl.addEventListener('blur', () => {
        if (modalState.type === 'folder') return;
        if (!els.bookmarkTitle.value && els.bookmarkUrl.value) {
            try {
                const url = new URL(els.bookmarkUrl.value);
                els.bookmarkTitle.value = url.hostname;
            } catch (e) {
                // ignore invalid url
            }
        }
        const activeIconType = document.querySelector('input[name="iconType"]:checked');
        if (activeIconType && activeIconType.value === 'favicon' && els.bookmarkUrl.value.trim()) {
            loadAutoIconsForUrl(els.bookmarkUrl.value.trim(), {
                desiredSrc: pendingAutoIconSelectionSrc
            });
        }
    });

    if (els.bookmarkCategory) {
        els.bookmarkCategory.addEventListener('change', () => {
            modalState.targetCategoryId = els.bookmarkCategory.value;
            modalState.targetFolderId = null;
        });
    }

    // 保存书签/文件夹
    els.bookmarkForm.onsubmit = async (e) => {
        e.preventDefault();

        // 防止重复提交
        if (isFormSubmitting) return;

        const title = (els.bookmarkTitle.value || '').trim();
        if (!title) {
            alert('请输入名称');
            return;
        }
        const categoryId = els.bookmarkCategory.value || modalState.targetCategoryId || appData.activeCategory;
        modalState.targetCategoryId = categoryId;
        const targetFolderId = (() => {
            if (!modalState.targetFolderId) return null;
            const loc = findBookmarkLocation(modalState.targetFolderId);
            return loc && loc.categoryId === categoryId ? modalState.targetFolderId : null;
        })();
        modalState.targetFolderId = targetFolderId;
        const keepFolderOpen = !!(openFolderId && !(els.folderModal && els.folderModal.classList.contains('hidden')));

        if (modalState.type === 'folder') {
            persistFolderFromForm(title, categoryId, targetFolderId, { keepFolderOpen });
            return;
        }

        const normalizedUrl = normalizeUrlInput(els.bookmarkUrl.value.trim());
        if (!normalizedUrl) {
            alert('请输入有效网址');
            return;
        }

        // 锁定提交，显示 loading
        isFormSubmitting = true;
        const submitBtn = els.bookmarkForm.querySelector('button[type="submit"], .btn-primary');
        const formSubmitBtn = document.querySelector('#bookmarkModal .modal-footer .btn-primary');
        const saveBtnEl = formSubmitBtn || submitBtn;
        if (saveBtnEl) {
            saveBtnEl.disabled = true;
            saveBtnEl.dataset.origText = saveBtnEl.textContent;
            saveBtnEl.textContent = '保存中…';
            saveBtnEl.classList.add('is-saving');
        }

        try {
            const iconTypeEl = document.querySelector('input[name="iconType"]:checked');
            const iconType = iconTypeEl ? iconTypeEl.value : 'favicon';
            
            let iconUrl = '';
            let iconFallbacks = [];

            if (iconType === 'custom') {
                if (selectedCustomIconSrc) {
                    iconUrl = selectedCustomIconSrc;
                } else if (els.customIconInput.files.length > 0) {
                    iconUrl = await readFileAsDataURL(els.customIconInput.files[0]);
                } else if (customIconMode === 'swatch') {
                    iconUrl = buildColorSwatchDataUrl(
                        (els.swatchColor && els.swatchColor.value) || DEFAULT_SWATCH_COLOR,
                        deriveSwatchText()
                    );
                    selectedCustomIconSrc = iconUrl;
                } else if (modalState.editingId && els.iconPreview?.src) {
                    iconUrl = els.iconPreview.src;
                }
                iconFallbacks = [];
            } else {
                if (selectedAutoIcon) {
                    iconUrl = selectedAutoIcon.src;
                    iconFallbacks = autoIconCandidates
                        .filter(candidate => candidate.src !== selectedAutoIcon.src)
                        .map(candidate => candidate.src);
                } else {
                    const iconMeta = generateHighResIconMeta(normalizedUrl);
                    iconUrl = iconMeta.icon;
                    iconFallbacks = iconMeta.iconFallbacks;
                }
            }

            // 对已有缓存做同步映射（不发起网络请求），其余的后台异步缓存
            const resolvedIconUrl = resolveCachedIconSrc(iconUrl) || iconUrl;
            const resolvedFallbacks = (iconFallbacks || []).map(item => resolveCachedIconSrc(item) || item);

            const bookmarkData = {
                id: modalState.editingId || generateId('bm'),
                title,
                url: normalizedUrl,
                icon: resolvedIconUrl,
                iconType,
                iconFallbacks: resolvedFallbacks
            };

            const targetList = getBookmarkList(categoryId, targetFolderId);
            if (!targetList) {
                alert('未找到目标分类，保存失败');
                return;
            }
            let insertIndex = targetList.length;

            if (modalState.editingId) {
                const existingLoc = findBookmarkLocation(modalState.editingId);
                if (existingLoc) {
                    const sameContainer = existingLoc.categoryId === categoryId && (existingLoc.parentFolderId || null) === targetFolderId;
                    if (sameContainer) {
                        insertIndex = Math.min(existingLoc.index, targetList.length);
                    }
                    removeBookmarkAtLocation(existingLoc);
                }
            }

            insertBookmarkToList(targetList, insertIndex, bookmarkData);
            // 书签创建/编辑是重要操作，立即保存
            saveData({ immediate: true });
            renderApp();
            refreshOpenFolderView();
            closeModals({ keepFolderOpen });

            // ---- 后台异步缓存图标（不阻塞UI） ----
            const bmId = bookmarkData.id;
            if (iconType === 'favicon') {
                _backgroundCacheIcons(bmId, iconUrl, iconFallbacks);
            } else if (iconType === 'custom' && iconUrl && iconUrl.startsWith('data:')) {
                _backgroundPersistCustomIcon(bmId, iconUrl, title);
            }
        } finally {
            // 解锁
            isFormSubmitting = false;
            if (saveBtnEl) {
                saveBtnEl.disabled = false;
                saveBtnEl.textContent = saveBtnEl.dataset.origText || '保存';
                saveBtnEl.classList.remove('is-saving');
            }
        }
    };

    if (els.exportDataBtn) {
        els.exportDataBtn.addEventListener('click', exportDataAsFile);
    }
    if (els.importDataInput) {
        els.importDataInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const selectedSource = (els.importSourceSelect && els.importSourceSelect.value) || IMPORT_SOURCES.EDGE_TAB;
                const selectedMode = (els.importModeSelect && els.importModeSelect.value) || IMPORT_MODES.MERGE;
                handleImportDataFile(e.target.files[0], selectedSource, selectedMode);
            }
            e.target.value = '';
        });
    }
    if (els.refreshIconsBtn) {
        els.refreshIconsBtn.addEventListener('click', () => {
            if (els.bookmarkUrl.value.trim()) {
                loadAutoIconsForUrl(els.bookmarkUrl.value.trim(), {
                    desiredSrc: pendingAutoIconSelectionSrc,
                    force: true
                });
            } else {
                ensureAutoIconContainersVisible();
                setAutoIconStatus('请输入网址以获取图标。');
            }
        });
    }
    // 页面卸载前确保数据已保存
    window.addEventListener('beforeunload', () => {
        // 同步刷新待保存的数据（使用 sendBeacon 或同步写入）
        if (saveDataDebounceTimer) {
            clearTimeout(saveDataDebounceTimer);
            saveDataDebounceTimer = null;
            // 使用同步方式尽可能保存数据
            const dataToSave = attachBackgroundToData(appData);
            try {
                // 尝试同步保存到 localStorage 作为备份
                const jsonStr = JSON.stringify({ [STORAGE_KEYS.DATA]: dataToSave });
                localStorage.setItem('MyLocalNewTab_emergency_backup', jsonStr);
            } catch (e) {
                // 忽略错误
            }
        }
    });
    
    // 页面可见性变化时的处理
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'hidden') {
            // 页面变为隐藏时，立即刷新待保存的数据
            await flushSaveData();
        } else if (document.visibilityState === 'visible') {
            // 页面变为可见时，检查是否有更新的数据
            await checkAndSyncLatestData();
        }
    });
}

function enableFolderTitleEditing() {
    if (!openFolderId || !els.folderModalTitle) return;
    const loc = findBookmarkLocation(openFolderId);
    if (!loc) return;

    const currentTitle = loc.bookmark.title;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.className = 'folder-title-input';
    
    // Replace title with input
    els.folderModalTitle.style.display = 'none';
    els.folderModalTitle.parentNode.insertBefore(input, els.folderModalTitle);
    
    input.focus();
    input.select();

    const save = () => {
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== currentTitle) {
            loc.bookmark.title = newTitle;
            // 文件夹重命名是用户主动操作，立即保存
            saveData({ immediate: true });
            renderApp(); // Update main grid to show new title
            // Update modal title text
            els.folderModalTitle.textContent = newTitle;
        }
        cleanup();
    };

    const cleanup = () => {
        if (input.parentNode) {
            input.parentNode.removeChild(input);
        }
        els.folderModalTitle.style.display = '';
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            save();
        } else if (e.key === 'Escape') {
            cleanup();
        }
    });
}

function readFileAsDataURL(file) {
    return blobToDataURL(file);
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

let navTimer = null;
function scheduleNavigation(action) {
    if (navTimer) return; // 如果已有计时器，不再重复调度，保持当前的计时
    navTimer = setTimeout(() => {
        action();
        navTimer = null; // 执行完毕后重置，允许下一次触发（实现连续导航）
    }, 600);
}
function cancelNavigation() {
    if (navTimer) {
        clearTimeout(navTimer);
        navTimer = null;
    }
}

function setupDragNavigation() {
    // 1. 拖拽到“返回/关闭”按钮进行导航
    if (els.closeFolderBtn) {
        els.closeFolderBtn.addEventListener('dragover', (e) => {
            if (!dragState.draggingId) return;
            e.preventDefault();
            e.stopPropagation();
            scheduleNavigation(() => {
                if (openFolderId) {
                    const loc = findBookmarkLocation(openFolderId);
                    if (loc && loc.parentFolderId) {
                        const parentAnchor = findBookmarkCardElement(loc.parentFolderId);
                        openFolderModal(loc.parentFolderId, { anchorElement: parentAnchor });
                    } else {
                        closeFolderModal();
                        // 文件夹关闭后，立即将占位符移动到主网格，防止松手时位置判定失效
                        if (els.bookmarkGrid) {
                            positionPlaceholderAtEnd(els.bookmarkGrid);
                        }
                    }
                }
            });
        });
        els.closeFolderBtn.addEventListener('dragleave', (e) => {
            cancelNavigation();
        });
        els.closeFolderBtn.addEventListener('drop', (e) => {
             e.preventDefault();
             cancelNavigation();
             if (openFolderId) {
                const loc = findBookmarkLocation(openFolderId);
                if (loc && loc.parentFolderId) {
                    const parentAnchor = findBookmarkCardElement(loc.parentFolderId);
                    openFolderModal(loc.parentFolderId, { anchorElement: parentAnchor });
                } else {
                    closeFolderModal();
                    if (els.bookmarkGrid) {
                        positionPlaceholderAtEnd(els.bookmarkGrid);
                    }
                }
            }
        });
    }

    // 2. 拖拽到文件夹外部区域（遮罩层）关闭文件夹
    if (els.folderModal) {
        els.folderModal.addEventListener('dragover', (e) => {
            if (!dragState.draggingId) return;
            e.preventDefault();
            if (e.target === els.folderModal) {
                scheduleNavigation(() => {
                    closeFolderModal();
                    // 文件夹关闭后，立即将占位符移动到主网格
                    if (els.bookmarkGrid) {
                        positionPlaceholderAtEnd(els.bookmarkGrid);
                    }
                });
            } else {
                if (e.target.closest('.modal-content')) {
                    cancelNavigation();
                }
            }
        });
        els.folderModal.addEventListener('dragleave', (e) => {
            if (e.target === els.folderModal) {
                cancelNavigation();
            }
        });
    }
}
