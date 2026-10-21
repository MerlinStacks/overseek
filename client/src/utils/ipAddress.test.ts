import { describe, expect, it } from 'vitest';
import { isIpOrCidr } from './ipAddress';
describe('IP/CIDR input validation', () => {
    it.each(['127.0.0.1', '10.0.0.0/0', '10.0.0.0/32', '::1', '2001:db8::/128', '::ffff:192.0.2.1'])('accepts %s', value => expect(isIpOrCidr(value)).toBe(true));
    it.each(['999.1.1.1', '01.2.3.4', '10.0.0.1/33', '::1/129', '::::', 'abc', '1.2.3.4/2/3', '1.2.3.4/', '127.0.0.1/path', '::1%lo'])('rejects %s', value => expect(isIpOrCidr(value)).toBe(false));
});
