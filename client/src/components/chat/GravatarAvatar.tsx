/**
 * GravatarAvatar - Avatar component with Gravatar support and fallback to initials.
 * Uses MD5 hash of email to fetch Gravatar images, with initials fallback.
 */
import { useState, useEffect, memo } from 'react';
import { cn } from '../../utils/cn';

interface GravatarAvatarProps {
    email?: string;
    name: string;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
    variant?: 'blue' | 'gray' | 'amber';
}

/**
 * Converts a string to MD5 hash using SubtleCrypto API.
 * Falls back to a simple hash if unavailable.
 */
async function md5Hash(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str.toLowerCase().trim());

    // crypto.subtle is only available in secure contexts (HTTPS or localhost)
    // Check existence before use to avoid TypeError in HTTP contexts
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        try {
            // Use SubtleCrypto for modern browsers (but it doesn't support MD5)
            // Gravatar also accepts SHA256, let's use that as primary
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch {
            // Fall through to simple hash
        }
    }

    // Simple fallback hash for older browsers or non-secure contexts
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base'
};

const variantClasses = {
    blue: 'bg-blue-600',
    gray: 'bg-gray-500',
    amber: 'bg-amber-600'
};

export const GravatarAvatar = memo(function GravatarAvatar({
    email,
    name,
    size = 'sm',
    className,
    variant = 'gray'
}: GravatarAvatarProps) {
    const [gravatarUrl, setGravatarUrl] = useState<string | null>(null);
    const [imageError, setImageError] = useState(false);

    const initial = name?.charAt(0).toUpperCase() || '?';
    const pixelSize = size === 'sm' ? 32 : size === 'md' ? 40 : 48;

    useEffect(() => {
        let cancelled = false;

        if (!email) {
            // Defer to avoid cascading renders
            const timeoutId = setTimeout(() => {
                if (!cancelled) setGravatarUrl(null);
            }, 0);
            return () => {
                cancelled = true;
                clearTimeout(timeoutId);
            };
        }

        // Defer the error reset to avoid cascading renders
        const resetTimeout = setTimeout(() => {
            if (!cancelled) setImageError(false);
        }, 0);

        // Generate Gravatar URL
        md5Hash(email).then(hash => {
            if (!cancelled) {
                // Use d=404 so we get a 404 if no Gravatar exists (triggers onError)
                setGravatarUrl(`https://www.gravatar.com/avatar/${hash}?s=${pixelSize * 2}&d=404`);
            }
        });

        return () => {
            cancelled = true;
            clearTimeout(resetTimeout);
        };
    }, [email, pixelSize]);

    const showImage = gravatarUrl && !imageError;

    return (
        <div
            className={cn(
                "rounded-full flex items-center justify-center font-medium shrink-0 overflow-hidden",
                sizeClasses[size],
                !showImage && variantClasses[variant],
                !showImage && "text-white",
                className
            )}
        >
            {showImage ? (
                <img
                    src={gravatarUrl}
                    alt={name}
                    className="w-full h-full object-cover"
                    onError={() => setImageError(true)}
                    loading="lazy"
                />
            ) : (
                initial
            )}
        </div>
    );
});
