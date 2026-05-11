(() => {
    const root = document.querySelector('.overseek-admin__form');
    if (!root) return;

    const tabs = Array.from(root.querySelectorAll('.overseek-admin__tab'));
    const panels = Array.from(root.querySelectorAll('.overseek-admin__tab-panel'));
    if (!tabs.length || !panels.length) return;

    const STORAGE_KEY = 'overseek_admin_active_tab';

    const setActiveTab = (tabKey) => {
        tabs.forEach((tab) => {
            const isActive = tab.dataset.tabTarget === tabKey;
            tab.classList.toggle('is-active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        panels.forEach((panel) => {
            const isActive = panel.dataset.tabPanel === tabKey;
            if (isActive) {
                panel.removeAttribute('hidden');
            } else {
                panel.setAttribute('hidden', 'hidden');
            }
        });
    };

    const validTabKeys = tabs.map((tab) => tab.dataset.tabTarget);
    const initialKey = window.location.hash
        ? window.location.hash.replace('#tab-', '')
        : window.localStorage.getItem(STORAGE_KEY);

    const activeKey = validTabKeys.includes(initialKey) ? initialKey : validTabKeys[0];
    setActiveTab(activeKey);

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const key = tab.dataset.tabTarget;
            if (!key) return;
            setActiveTab(key);
            window.localStorage.setItem(STORAGE_KEY, key);
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, '', `#tab-${key}`);
            }
        });
    });
})();
