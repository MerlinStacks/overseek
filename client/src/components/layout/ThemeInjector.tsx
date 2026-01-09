import { useEffect } from 'react';
import { useAccount } from '../../context/AccountContext';

export function ThemeInjector() {
    const { currentAccount } = useAccount();

    useEffect(() => {
        if (!currentAccount?.appearance) return;

        const { primaryColor, appName } = currentAccount.appearance;


        if (primaryColor) {
            document.documentElement.style.setProperty('--primary-color', primaryColor);

            const styleId = 'whitelabel-overrides';
            let styleTag = document.getElementById(styleId);
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = styleId;
                document.head.appendChild(styleTag);
            }

            styleTag.innerHTML = `
                /* Backgrounds */
                .bg-blue-600 { background-color: ${primaryColor} !important; }
                .hover\\:bg-blue-700:hover { background-color: color-mix(in srgb, ${primaryColor}, black 10%) !important; }
                .bg-blue-500 { background-color: ${primaryColor} !important; }
                .hover\\:bg-blue-600:hover { background-color: ${primaryColor} !important; }
                
                /* Light Backgrounds */
                .bg-blue-50 { background-color: color-mix(in srgb, ${primaryColor}, white 90%) !important; }
                .hover\\:bg-blue-50:hover { background-color: color-mix(in srgb, ${primaryColor}, white 90%) !important; }
                .bg-blue-100 { background-color: color-mix(in srgb, ${primaryColor}, white 80%) !important; }

                /* Text */
                .text-blue-600 { color: ${primaryColor} !important; }
                .text-blue-500 { color: ${primaryColor} !important; }
                .hover\\:text-blue-500:hover { color: color-mix(in srgb, ${primaryColor}, white 20%) !important; }
                .text-blue-800 { color: color-mix(in srgb, ${primaryColor}, black 20%) !important; }
                
                /* Borders */
                .border-blue-600 { border-color: ${primaryColor} !important; }
                .border-blue-500 { border-color: ${primaryColor} !important; }
                .focus\\:border-blue-500:focus { border-color: ${primaryColor} !important; }

                /* Rings */
                .ring-blue-500 { --tw-ring-color: ${primaryColor} !important; }
                .focus\\:ring-blue-500:focus { --tw-ring-color: ${primaryColor} !important; }
            `;

            // We might need to inject a style tag to override Tailwind classes if we want deep integration,
            // but for now let's hope we can use CSS variables or inline styles where needed.
            // Actually, for Tailwind, we can't easily override 'bg-blue-600' unless we use 'bg-(--primary-color)' everywhere.
            // A brutal but effective way for "whitelabeling" existing Tailwind UI is to use a style tag to override rules.

            // However, a safer bet for now for "Whitelabeling" finding specific elements might be too complex.
            // Let's try to update title at least.
        }

        if (appName) {
            document.title = `${appName} | Dashboard`;
        } else {
            document.title = 'OverSeek | Dashboard';
        }

    }, [currentAccount]);

    return null;
}
