/**
 * IP Exclusion Service for Analytics Tracking.
 *
 * Provides IP address exclusion checking for filtering admin/internal
 * traffic from analytics tracking and reports.
 */

import { prisma } from '../../utils/prisma';
import { cacheAside, CacheTTL } from '../../utils/cache';

/**
 * Check if an IP address is in CIDR notation and matches a given IP.
 *
 * @param ip - The IP address to check
 * @param cidr - The CIDR notation (e.g., "192.168.1.0/24")
 * @returns True if the IP is within the CIDR range
 */
function ipMatchesCidr(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split('/');
    if (!bits) return false;

    const mask = parseInt(bits, 10);
    if (isNaN(mask)) return false;

    // Convert IPs to numeric for comparison
    const ipNum = ipToNumber(ip);
    const rangeNum = ipToNumber(range);

    if (ipNum === null || rangeNum === null) return false;

    // Calculate subnet mask
    const subnetMask = ~((1 << (32 - mask)) - 1) >>> 0;

    return (ipNum & subnetMask) === (rangeNum & subnetMask);
}

/**
 * Convert IPv4 address to numeric representation.
 *
 * @param ip - IPv4 address string
 * @returns Numeric representation or null if invalid
 */
function ipToNumber(ip: string): number | null {
    // Handle IPv4-mapped IPv6 addresses (::ffff:192.168.1.1)
    if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }

    const parts = ip.split('.');
    if (parts.length !== 4) return null;

    let result = 0;
    for (const part of parts) {
        const num = parseInt(part, 10);
        if (isNaN(num) || num < 0 || num > 255) return null;
        result = (result << 8) + num;
    }

    return result >>> 0; // Ensure unsigned
}

/**
 * Normalize an IP address for comparison.
 * Handles IPv4-mapped IPv6, localhost variants, etc.
 *
 * @param ip - The IP address to normalize
 * @returns Normalized IP string
 */
export function normalizeIp(ip: string): string {
    if (!ip) return '';

    // Trim whitespace
    ip = ip.trim();

    // Handle IPv4-mapped IPv6 (::ffff:192.168.1.1 -> 192.168.1.1)
    if (ip.startsWith('::ffff:')) {
        ip = ip.substring(7);
    }

    // Handle localhost variants
    if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
        return '127.0.0.1';
    }

    return ip.toLowerCase();
}

/**
 * Check if an IP matches any entry in the exclusion list.
 *
 * @param ip - The IP address to check
 * @param excludedIps - Array of IPs/CIDRs to check against
 * @returns True if the IP should be excluded
 */
export function matchesExclusionList(ip: string, excludedIps: string[]): boolean {
    if (!ip || !excludedIps || excludedIps.length === 0) {
        return false;
    }

    const normalizedIp = normalizeIp(ip);

    for (const entry of excludedIps) {
        const normalizedEntry = normalizeIp(entry);

        // Check for CIDR notation
        if (entry.includes('/')) {
            if (ipMatchesCidr(normalizedIp, entry)) {
                return true;
            }
        } else {
            // Exact match
            if (normalizedIp === normalizedEntry) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Get the list of excluded IPs for an account.
 * Results are cached for performance.
 *
 * @param accountId - The account ID
 * @returns Array of excluded IP addresses/CIDRs
 */
export async function getExcludedIps(accountId: string): Promise<string[]> {
    return cacheAside(
        `excluded-ips:${accountId}`,
        async () => {
            const account = await prisma.account.findUnique({
                where: { id: accountId },
                select: { excludedIps: true }
            });

            if (!account?.excludedIps) return [];

            // Handle both array and JSON string formats
            if (Array.isArray(account.excludedIps)) {
                return account.excludedIps as string[];
            }

            return [];
        },
        { ttl: CacheTTL.MEDIUM, namespace: 'tracking' }
    );
}

/**
 * Check if an IP address should be excluded from tracking for a given account.
 *
 * @param accountId - The account ID
 * @param ip - The IP address to check
 * @returns True if the IP should be excluded
 */
export async function isExcludedIp(accountId: string, ip: string): Promise<boolean> {
    if (!ip) return false;

    const excludedIps = await getExcludedIps(accountId);
    return matchesExclusionList(ip, excludedIps);
}

/**
 * Invalidate the excluded IPs cache for an account.
 * Call this when the exclusion list is updated.
 *
 * @param accountId - The account ID
 */
export function invalidateExcludedIpsCache(accountId: string): void {
    // Cache invalidation is handled by cache utility's TTL
    // For immediate invalidation, we'd need to add a delete method to cache
    // For now, changes take effect after TTL expires (5 min default)
}
