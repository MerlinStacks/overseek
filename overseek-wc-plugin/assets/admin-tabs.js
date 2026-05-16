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

    const hiddenProfilesInput = root.querySelector('#overseek_email_relay_profiles');
    const editorRoot = root.querySelector('[data-relay-profiles-editor]');
    if (!hiddenProfilesInput || !editorRoot) return;

    const listEl = editorRoot.querySelector('[data-profiles-list]');
    const addBtn = editorRoot.querySelector('[data-add-profile]');
    const jsonEditor = editorRoot.querySelector('[data-profiles-json-editor]');
    if (!listEl || !addBtn || !jsonEditor) return;

    const emptyProfile = () => ({
        id: '',
        name: '',
        from_name: '',
        from_email: '',
        reply_to: '',
        smtp_host: '',
        smtp_port: 587,
        smtp_secure: 'tls',
        smtp_auth: true,
        smtp_username: '',
        smtp_password: '',
        smtp_from_force: true,
    });

    const parseProfiles = (raw) => {
        try {
            const parsed = JSON.parse(raw || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };

    let profiles = parseProfiles(hiddenProfilesInput.value);

    const validationEl = document.createElement('div');
    validationEl.className = 'overseek-admin__profiles-validation';
    editorRoot.appendChild(validationEl);

    const escapeHtml = (value) =>
        String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;');

    const syncToInputs = () => {
        const serialized = JSON.stringify(profiles, null, 2);
        hiddenProfilesInput.value = serialized;
        jsonEditor.value = serialized;
    };

    const normalizeId = (value) => String(value || '').trim().toLowerCase();

    const clearFieldErrors = () => {
        listEl.querySelectorAll('.is-field-invalid').forEach((el) => el.classList.remove('is-field-invalid'));
    };

    const markFieldInvalid = (index, key) => {
        const card = listEl.querySelector(`[data-profile-index="${index}"]`);
        if (!card) return;
        const field = card.querySelector(`[data-key="${key}"]`);
        if (!field) return;
        field.classList.add('is-field-invalid');
    };

    const validateProfiles = () => {
        clearFieldErrors();
        const errors = [];
        const ids = new Set();

        profiles.forEach((profile, index) => {
            const row = index + 1;
            const id = normalizeId(profile.id);
            const fromEmail = String(profile.from_email || '').trim();
            const replyTo = String(profile.reply_to || '').trim();
            const smtpHost = String(profile.smtp_host || '').trim();
            const smtpAuth = Boolean(profile.smtp_auth);
            const smtpUsername = String(profile.smtp_username || '').trim();
            const smtpPassword = String(profile.smtp_password || '').trim();
            const smtpPort = Number(profile.smtp_port || 0);

            if (!id) {
                errors.push(`Profile ${row}: ID is required.`);
                markFieldInvalid(index, 'id');
            } else if (!/^[a-z0-9_-]+$/.test(id)) {
                errors.push(`Profile ${row}: ID must use lowercase letters, numbers, underscores, or hyphens.`);
                markFieldInvalid(index, 'id');
            } else if (ids.has(id)) {
                errors.push(`Profile ${row}: Duplicate ID '${id}'.`);
                markFieldInvalid(index, 'id');
            } else {
                ids.add(id);
            }

            if (!fromEmail || !/^\S+@\S+\.\S+$/.test(fromEmail)) {
                errors.push(`Profile ${row}: valid From Email is required.`);
                markFieldInvalid(index, 'from_email');
            }

            if (replyTo && !/^\S+@\S+\.\S+$/.test(replyTo)) {
                errors.push(`Profile ${row}: Reply-To must be a valid email.`);
                markFieldInvalid(index, 'reply_to');
            }

            if (!smtpHost) {
                errors.push(`Profile ${row}: SMTP Host is required.`);
                markFieldInvalid(index, 'smtp_host');
            }

            if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
                errors.push(`Profile ${row}: SMTP Port must be between 1 and 65535.`);
                markFieldInvalid(index, 'smtp_port');
            }

            if (smtpAuth && (!smtpUsername || !smtpPassword)) {
                errors.push(`Profile ${row}: SMTP Username and Password are required when SMTP auth is enabled.`);
                if (!smtpUsername) markFieldInvalid(index, 'smtp_username');
                if (!smtpPassword) markFieldInvalid(index, 'smtp_password');
            }
        });

        if (errors.length === 0) {
            validationEl.innerHTML = '';
            validationEl.classList.remove('is-visible');
        } else {
            validationEl.innerHTML = `<strong>Fix sender profile issues before saving:</strong><ul>${errors
                .map((error) => `<li>${escapeHtml(error)}</li>`)
                .join('')}</ul>`;
            validationEl.classList.add('is-visible');
        }

        return errors;
    };

    const render = () => {
        listEl.innerHTML = profiles
            .map((profile, index) => {
                const secure = profile.smtp_secure === 'ssl' ? 'ssl' : 'tls';
                const smtpAuthChecked = profile.smtp_auth ? 'checked' : '';
                const forceChecked = profile.smtp_from_force ? 'checked' : '';
                return `
                <div class="overseek-admin__profile-card" data-profile-index="${index}">
                    <div class="overseek-admin__profiles-header">
                        <strong>Profile ${index + 1}</strong>
                        <button type="button" class="button-link-delete" data-remove-profile="${index}">Remove</button>
                    </div>
                    <div class="overseek-admin__profiles-grid">
                        <label><span>ID</span><input type="text" data-key="id" value="${escapeHtml(profile.id)}" /></label>
                        <label><span>Name</span><input type="text" data-key="name" value="${escapeHtml(profile.name)}" /></label>
                        <label><span>From Name</span><input type="text" data-key="from_name" value="${escapeHtml(profile.from_name)}" /></label>
                        <label><span>From Email</span><input type="text" data-key="from_email" value="${escapeHtml(profile.from_email)}" /></label>
                        <label><span>Reply-To</span><input type="text" data-key="reply_to" value="${escapeHtml(profile.reply_to)}" /></label>
                        <label><span>SMTP Host</span><input type="text" data-key="smtp_host" value="${escapeHtml(profile.smtp_host)}" /></label>
                        <label><span>SMTP Port</span><input type="number" data-key="smtp_port" value="${escapeHtml(profile.smtp_port || 587)}" /></label>
                        <label><span>SMTP Secure</span>
                            <select data-key="smtp_secure">
                                <option value="tls" ${secure === 'tls' ? 'selected' : ''}>TLS</option>
                                <option value="ssl" ${secure === 'ssl' ? 'selected' : ''}>SSL</option>
                            </select>
                        </label>
                        <label><span>SMTP Username</span><input type="text" data-key="smtp_username" value="${escapeHtml(profile.smtp_username)}" /></label>
                        <label><span>SMTP Password</span><input type="text" data-key="smtp_password" value="${escapeHtml(profile.smtp_password || '')}" /></label>
                        <label class="overseek-admin__check"><input type="checkbox" data-key="smtp_auth" ${smtpAuthChecked} /> SMTP auth</label>
                        <label class="overseek-admin__check"><input type="checkbox" data-key="smtp_from_force" ${forceChecked} /> Force SMTP from</label>
                    </div>
                </div>`;
            })
            .join('');

        syncToInputs();
        validateProfiles();
    };

    addBtn.addEventListener('click', () => {
        profiles.push(emptyProfile());
        render();
    });

    listEl.addEventListener('click', (event) => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest('[data-remove-profile]');
        if (!button) return;
        const index = Number(button.getAttribute('data-remove-profile'));
        if (Number.isNaN(index)) return;
        profiles.splice(index, 1);
        render();
    });

    listEl.addEventListener('input', (event) => {
        if (!(event.target instanceof Element)) return;
        const input = event.target;
        const card = input.closest('[data-profile-index]');
        if (!card || !(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
        const index = Number(card.getAttribute('data-profile-index'));
        const key = input.getAttribute('data-key');
        if (Number.isNaN(index) || !key || !profiles[index]) return;

        if (input instanceof HTMLInputElement && input.type === 'checkbox') {
            profiles[index][key] = input.checked;
        } else if (key === 'smtp_port') {
            profiles[index][key] = Number(input.value || 0);
        } else {
            profiles[index][key] = input.value;
        }

        syncToInputs();
        validateProfiles();
    });

    jsonEditor.addEventListener('input', () => {
        const parsed = parseProfiles(jsonEditor.value);
        profiles = parsed;
        hiddenProfilesInput.value = jsonEditor.value;
        render();
    });

    root.addEventListener('submit', (event) => {
        const target = event.submitter;
        const action = target && target.getAttribute ? target.getAttribute('value') : '';
        if (action === 'overseek_test_email_relay_profile') {
            return;
        }

        const errors = validateProfiles();
        if (errors.length > 0) {
            event.preventDefault();
            const relayTab = root.querySelector('[data-tab-target="email-relay"]');
            if (relayTab instanceof HTMLButtonElement) {
                relayTab.click();
            }
            validationEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    render();
})();
