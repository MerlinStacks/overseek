import { siteConfig } from '../../config/site';

/** Do not turn development placeholders into public contact instructions. */
export function PrivacyContact({ email = siteConfig.privacyEmail, label = 'Privacy contact' }: { email?: string; label?: string } = {}) {
    const valid = /^[^\s@<>]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/i.test(email) && !/@(?:.*\.)?localhost$/i.test(email);
    return valid ? <a href={`mailto:${encodeURIComponent(email).replace('%40', '@')}`}>{email}</a> : <span>{label} is not configured. Contact the service operator through your usual support channel.</span>;
}
