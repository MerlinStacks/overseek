/**
 * Widget Route - Fastify Plugin
 * Serves the embedded chat widget script with 2026 modern design
 * Features: Pre-chat form, Agent avatars, Emoji picker, File attachments
 */

import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../utils/prisma';
import { Logger } from '../utils/logger';

const widgetRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * Serve Widget Script
     * GET /api/chat/widget.js
     */
    fastify.get('/widget.js', async (request, reply) => {
        const api_url = process.env.API_URL || "https://api.overseek.com";
        const query = request.query as { id?: string };
        const accountId = query.id;

        if (!accountId) {
            reply.header('Content-Type', 'application/javascript');
            return '';
        }

        try {
            // Fetch Settings
            const feature = await prisma.accountFeature.findUnique({
                where: { accountId_featureKey: { accountId, featureKey: 'CHAT_SETTINGS' } }
            });
            const config = feature?.config as any || {};

            // Defaults - appearance and positioning
            const position = config.position || 'bottom-right';
            const showOnMobile = config.showOnMobile !== false;
            const primaryColor = config.primaryColor || '#2563eb';
            const headerText = config.headerText || 'Live Chat';
            const welcomeMessage = config.welcomeMessage || 'Hello! How can we help you today?';

            // Check Business Hours
            if (config.businessHours?.enabled) {
                const now = new Date();
                const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                const dayName = days[now.getDay()];
                const schedule = config.businessHours.days?.[dayName];
                if (!schedule || !schedule.isOpen) {
                    reply.header('Content-Type', 'application/javascript');
                    return 'console.log("OverSeek Chat: Currently Closed (Day)");';
                }
                const nowTime = now.getHours() * 60 + now.getMinutes();
                const [openH, openM] = schedule.open.split(':').map(Number);
                const [closeH, closeM] = schedule.close.split(':').map(Number);
                if (nowTime < openH * 60 + openM || nowTime > closeH * 60 + closeM) {
                    reply.header('Content-Type', 'application/javascript');
                    return 'console.log("OverSeek Chat: Currently Closed (Time)");';
                }
            }

            const rightPos = position === 'bottom-right' ? '20px' : 'auto';
            const leftPos = position === 'bottom-left' ? '20px' : 'auto';
            const windowRight = position === 'bottom-right' ? 'right: 0;' : 'left: 0;';

            const script = `
(function() {
    const API_URL = '${api_url}';
    const accountId = '${accountId}';
    const PRIMARY_COLOR = '${primaryColor}';
    const HEADER_TEXT = '${headerText}';
    const WELCOME_MSG = '${welcomeMessage}';

    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isMobile = window.innerWidth <= 640;

    // Common emojis for picker
    const EMOJIS = ['😀','😂','😍','🥰','😊','👍','👏','❤️','🔥','✨','🎉','💯','🙏','😎','🤔','👀','💪','🙌','😅','🥳'];

    function getCookie(name) {
        var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        if (match) return match[2];
    }

    function hexToRgb(hex) {
        const result = /^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex);
        return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 37, g: 99, b: 235 };
    }
    
    const rgb = hexToRgb(PRIMARY_COLOR);
    const darkerColor = 'rgb(' + Math.max(0, rgb.r - 30) + ',' + Math.max(0, rgb.g - 30) + ',' + Math.max(0, rgb.b - 30) + ')';

    const styles = \`
        /* === 2026 Chat Widget with Enhanced Features === */
        #os-chat-widget {
            --os-primary: \${PRIMARY_COLOR};
            --os-primary-dark: \${darkerColor};
            --os-bg: \${prefersDark ? '#1e1e2e' : '#ffffff'};
            --os-bg-subtle: \${prefersDark ? '#2a2a3e' : '#f8fafc'};
            --os-text: \${prefersDark ? '#e2e8f0' : '#1e293b'};
            --os-text-muted: \${prefersDark ? '#94a3b8' : '#64748b'};
            --os-border: \${prefersDark ? '#3f3f5a' : '#e2e8f0'};
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            position: fixed; bottom: 20px;
            right: ${rightPos}; left: ${leftPos};
            z-index: 999999;
        }
        ${showOnMobile ? '' : '@media (max-width: 640px) { #os-chat-widget { display: none !important; } }'}
        
        /* Toggle Button */
        #os-chat-toggle {
            width: 64px; height: 64px; border-radius: 50%;
            background: linear-gradient(135deg, var(--os-primary), var(--os-primary-dark));
            box-shadow: 0 8px 32px rgba(0,0,0,0.25);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        #os-chat-toggle:hover { transform: scale(1.08) translateY(-2px); }
        
        /* Chat Window */
        #os-chat-window {
            display: none; position: absolute; bottom: 84px; ${windowRight}
            width: 400px; height: 600px;
            background: var(--os-bg);
            border-radius: 20px;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
            flex-direction: column; overflow: hidden;
            opacity: 0; transform: translateY(20px) scale(0.95);
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            backdrop-filter: blur(20px);
        }
        #os-chat-window.open { display: flex; opacity: 1; transform: translateY(0) scale(1); }
        
        @media (max-width: 640px) {
            #os-chat-window {
                position: fixed !important; inset: 0 !important;
                width: 100% !important; height: 100% !important;
                border-radius: 0 !important;
            }
            #os-chat-widget.open #os-chat-toggle { display: none; }
        }
        
        /* Header */
        .os-header {
            background: linear-gradient(135deg, var(--os-primary), var(--os-primary-dark));
            color: white; padding: 18px 20px;
            display: flex; justify-content: space-between; align-items: center;
        }
        .os-header-title { font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 10px; }
        .os-header-title::before {
            content: ''; width: 10px; height: 10px;
            background: #22c55e; border-radius: 50%;
            box-shadow: 0 0 8px #22c55e; animation: os-pulse 2s infinite;
        }
        @keyframes os-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        .os-close { cursor: pointer; font-size: 24px; opacity: 0.8; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; }
        .os-close:hover { opacity: 1; background: rgba(255,255,255,0.15); }
        
        /* Pre-chat Form */
        .os-prechat {
            flex: 1; padding: 24px; display: flex; flex-direction: column; justify-content: center;
            background: var(--os-bg-subtle);
        }
        .os-prechat h3 { font-size: 18px; font-weight: 600; color: var(--os-text); margin-bottom: 8px; }
        .os-prechat p { font-size: 14px; color: var(--os-text-muted); margin-bottom: 24px; }
        .os-prechat input {
            width: 100%; padding: 14px 16px; margin-bottom: 12px;
            border: 2px solid var(--os-border); border-radius: 12px;
            font-size: 14px; background: var(--os-bg); color: var(--os-text);
            outline: none; transition: all 0.2s;
        }
        .os-prechat input:focus { border-color: var(--os-primary); }
        .os-prechat input::placeholder { color: var(--os-text-muted); }
        .os-prechat button {
            width: 100%; padding: 14px;
            background: linear-gradient(135deg, var(--os-primary), var(--os-primary-dark));
            color: white; border: none; border-radius: 12px;
            font-size: 15px; font-weight: 600; cursor: pointer;
            transition: all 0.2s; margin-top: 8px;
        }
        .os-prechat button:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,0.2); }
        
        /* Messages Area */
        .os-messages {
            flex: 1; padding: 20px; overflow-y: auto;
            display: none; flex-direction: column; gap: 12px;
            background: var(--os-bg-subtle); scroll-behavior: smooth;
        }
        .os-messages.active { display: flex; }
        .os-messages::-webkit-scrollbar { width: 6px; }
        .os-messages::-webkit-scrollbar-thumb { background: var(--os-border); border-radius: 3px; }
        
        /* Message with Avatar */
        .os-msg-row { display: flex; gap: 10px; align-items: flex-end; animation: os-msg-in 0.3s ease; }
        .os-msg-row.user { flex-direction: row-reverse; }
        @keyframes os-msg-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        
        .os-avatar {
            width: 32px; height: 32px; border-radius: 50%;
            background: linear-gradient(135deg, var(--os-primary), var(--os-primary-dark));
            display: flex; align-items: center; justify-content: center;
            color: white; font-size: 12px; font-weight: 600;
            flex-shrink: 0;
        }
        .os-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        
        .os-message {
            max-width: 75%; padding: 12px 16px;
            border-radius: 18px; font-size: 14px; line-height: 1.5;
        }
        .os-message.user {
            background: linear-gradient(135deg, var(--os-primary), var(--os-primary-dark));
            color: white; border-bottom-right-radius: 4px;
        }
        .os-message.agent {
            background: var(--os-bg); border: 1px solid var(--os-border);
            color: var(--os-text); border-bottom-left-radius: 4px;
        }
        .os-message img { max-width: 200px; border-radius: 8px; margin-top: 8px; display: block; }
        
        /* Typing */
        .os-typing { display: flex; gap: 4px; padding: 12px 16px; background: var(--os-bg); border: 1px solid var(--os-border); border-radius: 18px; align-self: flex-start; }
        .os-typing span { width: 8px; height: 8px; background: var(--os-text-muted); border-radius: 50%; animation: os-bounce 1.4s infinite; }
        .os-typing span:nth-child(2) { animation-delay: 0.2s; }
        .os-typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes os-bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
        
        /* Input Area */
        .os-input-area {
            padding: 12px 16px; border-top: 1px solid var(--os-border);
            display: none; flex-direction: column; gap: 8px; background: var(--os-bg);
        }
        .os-input-area.active { display: flex; }
        .os-input-row { display: flex; gap: 8px; align-items: center; }
        
        .os-input-actions { display: flex; gap: 4px; }
        .os-input-btn {
            width: 40px; height: 40px; border-radius: 50%;
            background: var(--os-bg-subtle); border: 1px solid var(--os-border);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; transition: all 0.2s; color: var(--os-text-muted);
        }
        .os-input-btn:hover { background: var(--os-border); color: var(--os-text); }
        .os-input-btn svg { width: 18px; height: 18px; }
        
        #os-input {
            flex: 1; border: 2px solid var(--os-border); border-radius: 24px;
            padding: 12px 18px; font-size: 14px; outline: none;
            background: var(--os-bg-subtle); color: var(--os-text);
        }
        #os-input:focus { border-color: var(--os-primary); background: var(--os-bg); }
        
        #os-send {
            background: linear-gradient(135deg, var(--os-primary), var(--os-primary-dark));
            color: white; border: none; border-radius: 50%;
            width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
            cursor: pointer; transition: all 0.2s;
        }
        #os-send:hover { transform: scale(1.05); }
        #os-send svg { width: 18px; height: 18px; }
        
        /* Emoji Picker */
        .os-emoji-picker {
            display: none; padding: 12px; background: var(--os-bg);
            border: 1px solid var(--os-border); border-radius: 12px;
            flex-wrap: wrap; gap: 4px; max-width: 280px;
            position: absolute; bottom: 100%; left: 0; margin-bottom: 8px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15);
        }
        .os-emoji-picker.open { display: flex; }
        .os-emoji-picker button {
            width: 36px; height: 36px; border: none; background: none;
            font-size: 20px; cursor: pointer; border-radius: 8px;
            transition: background 0.2s;
        }
        .os-emoji-picker button:hover { background: var(--os-bg-subtle); }
        
        /* File Preview */
        .os-file-preview {
            display: none; padding: 8px 12px; background: var(--os-bg-subtle);
            border-radius: 8px; font-size: 13px; color: var(--os-text);
            align-items: center; gap: 8px;
        }
        .os-file-preview.active { display: flex; }
        .os-file-preview .os-file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .os-file-preview .os-file-remove {
            width: 24px; height: 24px; border-radius: 50%;
            background: var(--os-border); border: none; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            color: var(--os-text-muted); font-size: 14px;
        }
    \`;

    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    const container = document.createElement('div');
    container.id = 'os-chat-widget';
    container.innerHTML = \`
        <div id="os-chat-window">
            <div class="os-header">
                <span class="os-header-title">\${HEADER_TEXT}</span>
                <span class="os-close" id="os-close">&times;</span>
            </div>
            <div class="os-prechat" id="os-prechat">
                <h3>👋 Start a conversation</h3>
                <p>Please enter your details so we can help you better.</p>
                <input type="text" id="os-prechat-name" placeholder="Your name" required />
                <input type="email" id="os-prechat-email" placeholder="Your email" required />
                <button id="os-prechat-submit">Start Chat</button>
            </div>
            <div class="os-messages" id="os-messages"></div>
            <div class="os-input-area" id="os-input-area">
                <div class="os-file-preview" id="os-file-preview">
                    <span>📎</span>
                    <span class="os-file-name" id="os-file-name"></span>
                    <button class="os-file-remove" id="os-file-remove">&times;</button>
                </div>
                <div class="os-input-row" style="position: relative;">
                    <div class="os-input-actions">
                        <button class="os-input-btn" id="os-emoji-btn" title="Emoji">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                                <line x1="9" y1="9" x2="9.01" y2="9"/>
                                <line x1="15" y1="9" x2="15.01" y2="9"/>
                            </svg>
                        </button>
                        <button class="os-input-btn" id="os-attach-btn" title="Attach file">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                            </svg>
                        </button>
                        <input type="file" id="os-file-input" accept="image/*,.pdf,.doc,.docx" style="display:none" />
                    </div>
                    <div class="os-emoji-picker" id="os-emoji-picker">
                        \${EMOJIS.map(e => '<button type="button">' + e + '</button>').join('')}
                    </div>
                    <input type="text" id="os-input" placeholder="Type a message..." autocomplete="off" />
                    <button id="os-send" aria-label="Send">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
        <div id="os-chat-toggle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"></path>
            </svg>
        </div>
    \`;
    document.body.appendChild(container);

    // Elements
    const widget = document.getElementById('os-chat-widget');
    const toggle = document.getElementById('os-chat-toggle');
    const windowEl = document.getElementById('os-chat-window');
    const closeBtn = document.getElementById('os-close');
    const prechatForm = document.getElementById('os-prechat');
    const prechatName = document.getElementById('os-prechat-name');
    const prechatEmail = document.getElementById('os-prechat-email');
    const prechatSubmit = document.getElementById('os-prechat-submit');
    const messagesEl = document.getElementById('os-messages');
    const inputArea = document.getElementById('os-input-area');
    const input = document.getElementById('os-input');
    const sendBtn = document.getElementById('os-send');
    const emojiBtn = document.getElementById('os-emoji-btn');
    const emojiPicker = document.getElementById('os-emoji-picker');
    const attachBtn = document.getElementById('os-attach-btn');
    const fileInput = document.getElementById('os-file-input');
    const filePreview = document.getElementById('os-file-preview');
    const fileName = document.getElementById('os-file-name');
    const fileRemove = document.getElementById('os-file-remove');
    
    let isOpen = false;
    let conversationId = localStorage.getItem('os_conv_id_' + accountId);
    let visitorName = localStorage.getItem('os_name_' + accountId) || '';
    let visitorEmail = localStorage.getItem('os_email_' + accountId) || '';
    let selectedFile = null;
    let agentAvatar = null;

    // Check if user already filled form
    if (visitorName && visitorEmail) {
        prechatForm.style.display = 'none';
        messagesEl.classList.add('active');
        inputArea.classList.add('active');
        addMessageUI(WELCOME_MSG, 'agent');
    }

    function openChat() {
        isOpen = true;
        widget.classList.add('open');
        windowEl.classList.add('open');
        if (visitorName && conversationId) {
            startOrResumeChat();
        }
    }

    function closeChat() {
        isOpen = false;
        widget.classList.remove('open');
        windowEl.classList.remove('open');
        emojiPicker.classList.remove('open');
    }

    toggle.addEventListener('click', () => isOpen ? closeChat() : openChat());
    closeBtn.addEventListener('click', closeChat);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) closeChat(); });

    // Pre-chat form submission
    prechatSubmit.addEventListener('click', () => {
        const name = prechatName.value.trim();
        const email = prechatEmail.value.trim();
        if (!name || !email) {
            alert('Please enter your name and email');
            return;
        }
        if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
            alert('Please enter a valid email');
            return;
        }
        visitorName = name;
        visitorEmail = email;
        localStorage.setItem('os_name_' + accountId, name);
        localStorage.setItem('os_email_' + accountId, email);
        
        prechatForm.style.display = 'none';
        messagesEl.classList.add('active');
        inputArea.classList.add('active');
        addMessageUI(WELCOME_MSG, 'agent');
        startOrResumeChat();
        input.focus();
    });

    // Emoji picker
    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPicker.classList.toggle('open');
    });
    emojiPicker.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            input.value += e.target.textContent;
            emojiPicker.classList.remove('open');
            input.focus();
        }
    });
    document.addEventListener('click', () => emojiPicker.classList.remove('open'));

    // File attachment
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                alert('File too large. Max 5MB.');
                return;
            }
            selectedFile = file;
            fileName.textContent = file.name;
            filePreview.classList.add('active');
        }
    });
    fileRemove.addEventListener('click', () => {
        selectedFile = null;
        fileInput.value = '';
        filePreview.classList.remove('active');
    });

    function showTyping() {
        const existing = document.getElementById('os-typing');
        if (existing) return;
        const row = document.createElement('div');
        row.className = 'os-msg-row agent';
        row.id = 'os-typing-row';
        row.innerHTML = '<div class="os-avatar">' + (agentAvatar ? '<img src="' + agentAvatar + '">' : '🤖') + '</div><div class="os-typing" id="os-typing"><span></span><span></span><span></span></div>';
        messagesEl.appendChild(row);
        scrollToBottom();
    }

    function hideTyping() {
        const row = document.getElementById('os-typing-row');
        if (row) row.remove();
    }

    async function sendMessage() {
        const text = input.value.trim();
        if (!text && !selectedFile) return;
        
        if (selectedFile) {
            // Upload file first
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('visitorToken', getCookie('_os_vid') || 'anon');
            
            try {
                const uploadRes = await fetch(\`\${API_URL}/api/chat/public/\${conversationId}/upload\`, {
                    method: 'POST',
                    body: formData
                });
                const uploadData = await uploadRes.json();
                if (uploadData.url) {
                    addMessageUI('[Image]', 'user', uploadData.url);
                }
            } catch (err) {
                console.error('Upload failed', err);
            }
            
            selectedFile = null;
            fileInput.value = '';
            filePreview.classList.remove('active');
        }
        
        if (text) {
            addMessageUI(text, 'user');
            input.value = '';
        }
        
        scrollToBottom();
        if (!conversationId) await startOrResumeChat();
        
        showTyping();
        
        try {
            const visitorToken = getCookie('_os_vid') || 'anon';
            const res = await fetch(\`\${API_URL}/api/chat/public/\${conversationId}/messages\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: text || '[Attachment]', visitorToken, name: visitorName, email: visitorEmail })
            });
            if (!res.ok) throw new Error('Failed');
        } catch (err) {
            hideTyping();
            addMessageUI('Failed to send. Please try again.', 'agent');
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

    async function startOrResumeChat() {
        const visitorToken = getCookie('_os_vid');
        if (!visitorToken) return;
        try {
            const res = await fetch(\`\${API_URL}/api/chat/public/conversation\`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId, visitorToken, name: visitorName, email: visitorEmail })
            });
            const data = await res.json();
            if (data.id) {
                conversationId = data.id;
                localStorage.setItem('os_conv_id_' + accountId, conversationId);
                if (data.assignee?.avatarUrl) agentAvatar = data.assignee.avatarUrl;
                if (data.messages && data.messages.length > 0) {
                    messagesEl.innerHTML = '';
                    data.messages.forEach(msg => {
                        const type = msg.senderType === 'CUSTOMER' ? 'user' : 'agent';
                        const avatar = msg.senderType !== 'CUSTOMER' && msg.sender?.avatarUrl;
                        addMessageUI(msg.content, type, null, avatar);
                    });
                }
                pollMessages();
            }
        } catch (err) { console.error('Chat Init Error', err); }
    }

    async function pollMessages() {
        if (!conversationId || !isOpen) return;
        try {
            const visitorToken = getCookie('_os_vid') || 'anon';
            const res = await fetch(\`\${API_URL}/api/chat/public/\${conversationId}/messages?visitorToken=\${visitorToken}\`);
            const messages = await res.json();
            if (Array.isArray(messages) && messages.length > 0) {
                hideTyping();
                const currentCount = messagesEl.querySelectorAll('.os-msg-row').length;
                if (messages.length > currentCount) {
                    messages.slice(currentCount).forEach(msg => {
                        const type = msg.senderType === 'CUSTOMER' ? 'user' : 'agent';
                        const avatar = msg.senderType !== 'CUSTOMER' && msg.sender?.avatarUrl;
                        addMessageUI(msg.content, type, null, avatar);
                    });
                }
            }
        } catch (err) { console.error('Poll error', err); }
        setTimeout(pollMessages, 3000);
    }

    function addMessageUI(text, type, imageUrl, avatarUrl) {
        hideTyping();
        const row = document.createElement('div');
        row.className = 'os-msg-row ' + type;
        
        let avatarHtml = '';
        if (type === 'agent') {
            avatarHtml = '<div class="os-avatar">' + (avatarUrl || agentAvatar ? '<img src="' + (avatarUrl || agentAvatar) + '">' : '🤖') + '</div>';
        } else {
            const initials = visitorName ? visitorName.charAt(0).toUpperCase() : '👤';
            avatarHtml = '<div class="os-avatar">' + initials + '</div>';
        }
        
        let msgContent = '<div class="os-message ' + type + '">' + escapeHtml(text);
        if (imageUrl) {
            msgContent += '<img src="' + imageUrl + '" alt="Attachment">';
        }
        msgContent += '</div>';
        
        row.innerHTML = avatarHtml + msgContent;
        messagesEl.appendChild(row);
        scrollToBottom();
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }
})();
`;

            reply.header('Content-Type', 'application/javascript');
            return script;
        } catch (e) {
            Logger.error('Widget script error', { error: e });
            reply.header('Content-Type', 'application/javascript');
            return '';
        }
    });
};

export default widgetRoutes;
