function field(context: any, path: string): unknown {
    if (path.split('.').some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) return undefined;
    return path.split('.').reduce((value, key) => value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined, context);
}
export function evaluateEmailCondition(expression: string, context: unknown): boolean {
    const match = expression.trim().match(/^(!?)([a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)*)(?:\s*(===|!==|==|!=|>=|<=|>|<)\s*(true|false|-?\d+(?:\.\d+)?|"[^"<>]*"|'[^'<>]*'))?$/);
    if (!match) throw new Error('Unsupported email display condition');
    const actual = field(context, match[2]);
    let result: boolean;
    if (!match[3]) result = Boolean(actual) && actual !== 'false' && actual !== '0';
    else {
        const raw = match[4];
        const expected = raw === 'true' ? true : raw === 'false' ? false : /^['"]/.test(raw) ? raw.slice(1, -1) : Number(raw);
        const operator = match[3];
        if (operator === '==' || operator === '===') result = actual === expected;
        else if (operator === '!=' || operator === '!==') result = actual !== expected;
        else if (typeof actual !== 'number' || typeof expected !== 'number') result = false;
        else result = operator === '>' ? actual > expected : operator === '<' ? actual < expected : operator === '>=' ? actual >= expected : actual <= expected;
    }
    return match[1] ? !result : result;
}
export function resolveEmailConditionBlocks(html: string, context: unknown): string {
    const stack: Array<{ parent: boolean; value: boolean; hasElse: boolean }> = [];
    let active = true, cursor = 0, result = '';
    for (const token of html.matchAll(/\{\{\s*(#if\s+([^}]+)|else|\/if)\s*\}\}/g)) {
        if (active) result += html.slice(cursor, token.index);
        if (token[1].startsWith('#if')) { const value = evaluateEmailCondition(token[2], context); stack.push({ parent: active, value, hasElse: false }); active = active && value; }
        else if (token[1].trim() === 'else') { const frame = stack[stack.length - 1]; if (!frame || frame.hasElse) throw new Error('Unbalanced email display condition'); frame.hasElse = true; active = frame.parent && !frame.value; }
        else { const frame = stack.pop(); if (!frame) throw new Error('Unbalanced email display condition'); active = frame.parent; }
        cursor = token.index! + token[0].length;
    }
    if (stack.length) throw new Error('Unbalanced email display condition');
    return result + html.slice(cursor);
}
