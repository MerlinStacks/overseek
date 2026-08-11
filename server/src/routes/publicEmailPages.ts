type PageKind = 'error' | 'success';

export interface StorefrontPageBrand {
    name?: string | null;
    homeUrl?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
}

interface StorefrontStatusPageOptions {
    kind?: PageKind;
    title: string;
    message: string;
    detail?: string;
    brand?: StorefrontPageBrand | null;
    actionLabel?: string;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeHttpUrl(raw: string | null | undefined): string | null {
    if (!raw) return null;
    try {
        const parsed = new URL(raw);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
    } catch {
        return null;
    }
}

function safeColour(raw: string | null | undefined): string {
    return raw && /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#5b4bdb';
}

export function storefrontBrandFromAccount(account: {
    name?: string | null;
    wooUrl?: string | null;
    domain?: string | null;
    appearance?: unknown;
} | null | undefined): StorefrontPageBrand | null {
    if (!account) return null;
    const appearance = account.appearance && typeof account.appearance === 'object' && !Array.isArray(account.appearance)
        ? account.appearance as { appName?: unknown; logoUrl?: unknown; primaryColor?: unknown }
        : {};
    const domainUrl = account.domain
        ? safeHttpUrl(account.domain) || safeHttpUrl(`https://${account.domain}`)
        : null;

    return {
        name: typeof appearance.appName === 'string' && appearance.appName.trim()
            ? appearance.appName.trim()
            : account.name,
        homeUrl: safeHttpUrl(account.wooUrl) || domainUrl,
        logoUrl: typeof appearance.logoUrl === 'string' ? safeHttpUrl(appearance.logoUrl) : null,
        primaryColor: typeof appearance.primaryColor === 'string' ? appearance.primaryColor : null,
    };
}

export function renderStorefrontStatusPage({
    kind = 'error',
    title,
    message,
    detail,
    brand,
    actionLabel = 'Return to store',
}: StorefrontStatusPageOptions): string {
    const storeName = brand?.name?.trim() || 'Online store';
    const homeUrl = safeHttpUrl(brand?.homeUrl);
    const logoUrl = safeHttpUrl(brand?.logoUrl);
    const accent = safeColour(brand?.primaryColor);
    const escapedStoreName = escapeHtml(storeName);
    const icon = kind === 'success'
        ? '<path d="m8.4 12.2 2.3 2.3 5-5"/><path d="M20 11.1V12a8 8 0 1 1-4.7-7.3"/>'
        : '<path d="M9 10V8.6a3 3 0 0 1 6 0V10"/><path d="M6.8 10h10.4l.8 9H6l.8-9Z"/><path d="M9.5 15.5h5"/>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${escapeHtml(title)} | ${escapedStoreName}</title>
    <style>
        :root { --accent: ${accent}; --ink: #17161c; --muted: #686672; --line: #e9e7ee; --paper: #ffffff; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; color: var(--ink); background: #f7f6fa; font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        body::before { content: ""; position: fixed; inset: 0; pointer-events: none; background: radial-gradient(circle at 12% 10%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 32%), radial-gradient(circle at 90% 90%, #eeeaf8, transparent 34%); }
        .shell { position: relative; display: grid; grid-template-rows: auto 1fr auto; min-height: 100vh; width: min(1180px, calc(100% - 40px)); margin: auto; }
        .brand { display: flex; align-items: center; gap: 12px; min-height: 92px; color: var(--ink); font-size: 17px; font-weight: 750; text-decoration: none; letter-spacing: -.02em; }
        .brand-mark { display: grid; place-items: center; width: 42px; height: 42px; overflow: hidden; border: 1px solid var(--line); border-radius: 13px; background: var(--paper); box-shadow: 0 6px 18px rgba(25, 20, 40, .06); }
        .brand-mark img { display: block; width: 100%; height: 100%; object-fit: contain; padding: 5px; }
        .brand-initial { color: var(--accent); font-size: 18px; font-weight: 850; }
        main { display: grid; place-items: center; padding: 28px 0 80px; }
        .card { width: min(660px, 100%); padding: clamp(32px, 6vw, 68px); text-align: center; border: 1px solid rgba(225, 222, 232, .9); border-radius: 28px; background: rgba(255, 255, 255, .92); box-shadow: 0 28px 80px rgba(31, 25, 52, .10); backdrop-filter: blur(12px); }
        .illustration { position: relative; display: grid; place-items: center; width: 104px; height: 104px; margin: 0 auto 30px; color: var(--accent); border-radius: 32px; background: color-mix(in srgb, var(--accent) 9%, white); transform: rotate(-3deg); }
        .illustration::after { content: ""; position: absolute; width: 18px; height: 18px; right: -4px; top: 5px; border-radius: 50%; background: #f4b84a; box-shadow: -88px 78px 0 -5px color-mix(in srgb, var(--accent) 45%, white); }
        .illustration svg { width: 54px; height: 54px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; transform: rotate(3deg); }
        .eyebrow { margin: 0 0 12px; color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
        h1 { margin: 0; font-size: clamp(2rem, 7vw, 3.5rem); line-height: 1.02; letter-spacing: -.055em; }
        .message { max-width: 500px; margin: 20px auto 0; color: var(--muted); font-size: 17px; line-height: 1.65; }
        .detail { margin: 12px auto 0; color: #8a8791; font-size: 14px; line-height: 1.55; }
        .actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
        .button { display: inline-flex; min-height: 50px; align-items: center; justify-content: center; padding: 0 23px; border-radius: 999px; font-size: 15px; font-weight: 750; text-decoration: none; transition: transform .15s ease, box-shadow .15s ease; }
        .button:hover { transform: translateY(-2px); }
        .primary { color: #fff; background: var(--accent); box-shadow: 0 10px 24px color-mix(in srgb, var(--accent) 28%, transparent); }
        .secondary { color: var(--ink); border: 1px solid var(--line); background: #fff; }
        footer { padding: 24px 0 30px; color: #85828d; font-size: 12px; text-align: center; }
        @media (max-width: 600px) { .shell { width: min(100% - 24px, 1180px); } .brand { min-height: 74px; } main { padding: 18px 0 50px; } .card { border-radius: 22px; } .actions { flex-direction: column; } .button { width: 100%; } }
    </style>
</head>
<body>
    <div class="shell">
        ${homeUrl ? `<a class="brand" href="${escapeHtml(homeUrl)}">` : '<div class="brand">'}
            <span class="brand-mark">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" />` : `<span class="brand-initial">${escapeHtml(storeName.charAt(0).toUpperCase())}</span>`}</span>
            <span>${escapedStoreName}</span>
        ${homeUrl ? '</a>' : '</div>'}
        <main>
            <section class="card" aria-labelledby="page-title">
                <div class="illustration" aria-hidden="true"><svg viewBox="0 0 24 24">${icon}</svg></div>
                <p class="eyebrow">${kind === 'success' ? 'All sorted' : 'Something went wrong'}</p>
                <h1 id="page-title">${escapeHtml(title)}</h1>
                <p class="message">${escapeHtml(message)}</p>
                ${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ''}
                <div class="actions">
                    ${homeUrl ? `<a class="button primary" href="${escapeHtml(homeUrl)}">${escapeHtml(actionLabel)}</a>` : ''}
                    <a class="button ${homeUrl ? 'secondary' : 'primary'}" href="mailto:?subject=${encodeURIComponent(`Help with ${storeName}`)}">Contact support</a>
                </div>
            </section>
        </main>
        <footer>For your security, links are checked before opening.</footer>
    </div>
</body>
</html>`;
}
