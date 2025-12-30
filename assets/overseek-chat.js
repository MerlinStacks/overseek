(function () {
    // OverSeek Chat Widget
    // Config comes from window.overseekChatConfig

    if (!window.overseekChatConfig || !window.overseekChatConfig.enabled) {
        console.log('OverSeek Chat: Disabled or missing config');
        return;
    }

    const config = window.overseekChatConfig;
    const { businessHours, timezone, offlineBehavior, offlineMessage, styles } = config;

    // --- Helper Functions ---

    function getCurrentTimeInZone() {
        // Create date object in target timezone
        // This is tricky in pure JS without libraries if timezone is just a string like "America/New_York"
        // We use Intl.DateTimeFormat to get components

        // Simple default if timezone missing
        const timeZone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

        try {
            const date = new Date();
            const options = { timeZone, hour12: false, weekday: 'long', hour: '2-digit', minute: '2-digit' };
            const formatter = new Intl.DateTimeFormat('en-US', options);
            const parts = formatter.formatToParts(date);

            const dayMap = {};
            parts.forEach(p => dayMap[p.type] = p.value);

            // dayMap.weekday will be "Monday", "Tuesday", etc.
            // dayMap.hour will be "09"
            // dayMap.minute will be "30"

            return {
                day: dayMap.weekday,
                time: `${dayMap.hour}:${dayMap.minute}`
            };
        } catch (e) {
            console.error('OverSeek Chat: Invalid Timezone', e);
            // Fallback to local browser time
            const d = new Date();
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return {
                day: days[d.getDay()],
                time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
            };
        }
    }

    function isBusinessOpen() {
        const { day, time } = getCurrentTimeInZone();
        const schedule = businessHours[day];

        // If no schedule for today, assume closed or open? 
        // Logic: If schedule exists and enabled is false -> Closed.
        // If schedule exists and enabled is true -> Check time.

        if (!schedule || !schedule.enabled) return false;

        const start = schedule.start || '00:00';
        const end = schedule.end || '23:59';

        return time >= start && time <= end;
    }

    function createWidget(isOpen) {
        // If closed and behavior is 'hide', do nothing
        if (!isOpen && offlineBehavior === 'hide') return;

        // Create Container
        const container = document.createElement('div');
        container.id = 'overseek-chat-widget';
        Object.assign(container.style, {
            position: 'fixed',
            bottom: '20px',
            zIndex: '9999',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
            [styles.position || 'right']: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: styles.position === 'left' ? 'flex-start' : 'flex-end',
            gap: '10px'
        });

        // Chat Bubble
        const bubble = document.createElement('div');
        Object.assign(bubble.style, {
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: styles.primaryColor || '#6366f1',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#fff',
            transition: 'transform 0.2s'
        });
        bubble.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

        bubble.onmouseover = () => bubble.style.transform = 'scale(1.1)';
        bubble.onmouseout = () => bubble.style.transform = 'scale(1)';

        bubble.onclick = () => {
            if (isOpen) {
                // Open Chat Window (Simulated for now, or link to actual chat logic if implemented)
                // For this scope, we just alert or toggle a dummy window
                alert("Chat Connected! (This would open the chat window)");
            } else {
                // Show tooltip or message if not already visible
                alert(offlineMessage || "We are currently closed.");
            }
        };

        // Offline Label (optional)
        if (!isOpen && offlineMessage) {
            const messageBox = document.createElement('div');
            Object.assign(messageBox.style, {
                background: '#fff',
                padding: '10px 15px',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                fontSize: '14px',
                color: '#333',
                maxWidth: '250px',
                marginBottom: '5px'
            });
            messageBox.innerText = offlineMessage;
            container.appendChild(messageBox);
        }

        container.appendChild(bubble);
        document.body.appendChild(container);
    }

    // --- Init ---
    const open = isBusinessOpen();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => createWidget(open));
    } else {
        createWidget(open);
    }

})();
