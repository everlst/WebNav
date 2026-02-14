(function () {
    const hasNativeStorage =
        typeof window !== 'undefined' &&
        window.chrome &&
        window.chrome.storage &&
        window.chrome.storage.local &&
        typeof window.chrome.storage.local.get === 'function';

    if (hasNativeStorage) {
        return;
    }

    const runtimeState = { lastError: null };

    function clearLastError() {
        runtimeState.lastError = null;
    }

    function setLastError(error) {
        runtimeState.lastError = {
            message: error?.message || String(error || 'Unknown error')
        };
    }

    function normalizeKeys(keys) {
        if (keys === null || keys === undefined) return null;
        if (Array.isArray(keys)) return keys.map(String);
        if (typeof keys === 'string') return [keys];
        if (typeof keys === 'object') return Object.keys(keys);
        return null;
    }

    /**
     * 获取 API 基础 URL（读取 appSettings.customDomain）。
     * 优先从 localStorage 中同步读取（解决启动时 appSettings 尚未加载的问题），
     * 其次从 window.appSettings 读取。如果都没有则返回空字符串（使用相对路径）。
     */
    function getAdapterBaseUrl() {
        try {
            // 优先从 localStorage 同步读取（解决启动顺序问题）
            const cached = localStorage.getItem('WebNav_customDomain');
            if (cached) return cached.replace(/\/+$/, '');
        } catch (_) {}
        try {
            if (typeof window !== 'undefined' && window.appSettings && window.appSettings.customDomain) {
                return window.appSettings.customDomain.replace(/\/+$/, '');
            }
        } catch (_) {}
        return '';
    }

    function resolveUrl(path) {
        const base = getAdapterBaseUrl();
        if (!base) return path;
        const normalizedPath = path.startsWith('/') ? path : '/' + path;
        return base + normalizedPath;
    }

    async function postJson(url, payload) {
        const response = await fetch(resolveUrl(url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(text || `HTTP ${response.status}`);
        }
        return response.json();
    }

    function storageArea(area) {
        return {
            get(keys, callback) {
                const normalizedKeys = normalizeKeys(keys);
                postJson('/api/storage/get', { area, keys: normalizedKeys })
                    .then((res) => {
                        clearLastError();
                        const items = (res && res.items && typeof res.items === 'object') ? res.items : {};
                        let output = items;
                        if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
                            output = { ...keys, ...items };
                        }
                        if (typeof callback === 'function') {
                            callback(output);
                        }
                    })
                    .catch((error) => {
                        setLastError(error);
                        if (typeof callback === 'function') {
                            callback({});
                        }
                    });
            },
            set(items, callback) {
                postJson('/api/storage/set', { area, items: items || {} })
                    .then(() => {
                        clearLastError();
                        if (typeof callback === 'function') {
                            callback();
                        }
                    })
                    .catch((error) => {
                        setLastError(error);
                        if (typeof callback === 'function') {
                            callback();
                        }
                    });
            },
            remove(keys, callback) {
                const normalizedKeys = normalizeKeys(keys) || [];
                postJson('/api/storage/remove', { area, keys: normalizedKeys })
                    .then(() => {
                        clearLastError();
                        if (typeof callback === 'function') {
                            callback();
                        }
                    })
                    .catch((error) => {
                        setLastError(error);
                        if (typeof callback === 'function') {
                            callback();
                        }
                    });
            }
        };
    }

    const chromeObj = (window.chrome && typeof window.chrome === 'object') ? window.chrome : {};
    const runtimeObj = (chromeObj.runtime && typeof chromeObj.runtime === 'object') ? chromeObj.runtime : {};
    const storageObj = (chromeObj.storage && typeof chromeObj.storage === 'object') ? chromeObj.storage : {};

    Object.defineProperty(runtimeObj, 'lastError', {
        get() {
            return runtimeState.lastError;
        },
        set(value) {
            runtimeState.lastError = value;
        },
        configurable: true
    });

    if (!storageObj.local) {
        storageObj.local = storageArea('local');
    }
    if (!storageObj.sync) {
        storageObj.sync = storageArea('sync');
    }

    chromeObj.runtime = runtimeObj;
    chromeObj.storage = storageObj;
    window.chrome = chromeObj;
})();
