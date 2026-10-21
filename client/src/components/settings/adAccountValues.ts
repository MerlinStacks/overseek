export function validAdAccountId(platform: string, value: string): boolean {
    const id = value.trim();
    return platform === 'GOOGLE' ? /^(?:\d{10}|\d{3}-\d{3}-\d{4})$/.test(id) : platform === 'META' && /^(?:act_)?\d+$/.test(id);
}
