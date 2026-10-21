/** Validate addresses locally without contacting a third party. IPv6 parsing uses the URL parser. */
export function isIpOrCidr(value: string): boolean {
    const parts = value.split('/'); if (parts.length > 2) return false;
    const [address, prefix] = parts;
    let version: 4 | 6;
    if (address.includes(':')) {
        if (!/^[a-f\d:.]+$/i.test(address)) return false;
        try { new URL(`http://[${address}]/`); } catch { return false; }
        version = 6;
    } else {
        const octets = address.split('.');
        if (octets.length !== 4 || !octets.every(octet => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)) return false;
        version = 4;
    }
    return prefix === undefined || (/^(?:0|[1-9]\d{0,2})$/.test(prefix) && Number(prefix) <= (version === 4 ? 32 : 128));
}
