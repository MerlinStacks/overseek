import { useEffect, useState, memo } from 'react';
import { cn } from '../../utils/cn';

interface Props { email?: string; name: string; size?: 'sm' | 'md' | 'lg'; className?: string; variant?: 'blue' | 'gray' | 'amber' }
const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' };
const variants = { blue: 'bg-[var(--primary-color)] text-[var(--primary-foreground)]', gray: 'bg-gray-500 text-white', amber: 'bg-amber-600 text-white' };
export const GravatarAvatar = memo(function GravatarAvatar({ email, name, size = 'sm', className, variant = 'gray' }: Props) {
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    return <AvatarImage key={JSON.stringify([normalized, size])} email={normalized} name={name} size={size} className={className} variant={variant} />;
});
function AvatarImage({ email, name, size = 'sm', className, variant = 'gray' }: Props) {
    const [url, setUrl] = useState<string | null>(null); const [failed, setFailed] = useState(false);
    const pixels = size === 'sm' ? 32 : size === 'md' ? 40 : 48;
    useEffect(() => {
        let disposed = false;
        if (email && globalThis.crypto?.subtle) {
            void (async () => {
                try {
                    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
                    if (disposed) return;
                    const hash = Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
                    if (/^[a-f0-9]{64}$/.test(hash)) setUrl(`https://www.gravatar.com/avatar/${hash}?s=${pixels * 2}&d=blank`);
                } catch { /* Initials are the fallback when a valid digest is unavailable. */ }
            })();
        }
        return () => { disposed = true; };
    }, [email, pixels]);
    return <div role="img" aria-label={name || 'Customer'} className={cn('rounded-full flex items-center justify-center font-medium shrink-0 overflow-hidden relative', sizes[size], variants[variant], className)}>
        <span aria-hidden="true">{name?.charAt(0).toUpperCase() || '?'}</span>
        {url && !failed && <img src={url} alt="" aria-hidden="true" referrerPolicy="no-referrer" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={() => setFailed(true)} />}
    </div>;
}
