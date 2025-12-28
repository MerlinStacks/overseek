export const validateEmail = (blocks, globalStyles, subjectLine = '') => {
    const issues = [];

    // 1. Global Checks
    const width = parseInt(globalStyles?.container?.contentWidth || '600', 10);
    if (width > 650) {
        issues.push({
            id: 'global-width',
            severity: 'warning',
            message: 'Email width exceeds 650px. 600px is recommended for maximum compatibility.'
        });
    }

    if (subjectLine.length > 60) {
        issues.push({
            id: 'global-subject',
            severity: 'info',
            message: 'Subject line is long (>60 chars) and may be truncated on mobile devices.'
        });
    }

    // 2. Block Checks
    blocks.forEach(block => {
        validateBlock(block, issues);
    });

    return issues;
};

const validateBlock = (block, issues) => {
    // Recursively check columns
    if (block.columns) {
        block.columns.forEach(col => {
            col.forEach(subBlock => validateBlock(subBlock, issues));
        });
    }

    // Image Checks
    if (block.type === 'image') {
        if (!block.content.alt || block.content.alt === 'Image') {
            issues.push({
                severity: 'warning',
                blockId: block.id,
                message: 'Image missing descriptive Alt Text (important for accessibility and when images are blocked).'
            });
        }
        if (block.content.url && !block.content.url.startsWith('http')) {
            issues.push({
                severity: 'error',
                blockId: block.id,
                message: 'Image URL invalid (must start with http/https).'
            });
        }
    }

    // Link Checks (Button)
    if (block.type === 'button') {
        if (!block.content.link || block.content.link === '#') {
            issues.push({
                severity: 'error',
                blockId: block.id,
                message: 'Button has no destination link.'
            });
        }
    }

    // Social Checks
    if (block.type === 'social') {
        const hasLink = block.content.facebook || block.content.twitter || block.content.instagram;
        if (!hasLink) {
            issues.push({
                severity: 'warning',
                blockId: block.id,
                message: 'No social links configured.'
            });
        }
    }

    // Custom HTML Checks (Security & Compat)
    if (block.type === 'html') {
        const html = block.content.html || '';
        if (/<script/i.test(html)) {
            issues.push({
                severity: 'error',
                blockId: block.id,
                message: '<script> tags are identifying as spam/malicious and blocked by all email clients.'
            });
        }
        if (/<iframe/i.test(html)) {
            issues.push({
                severity: 'error',
                blockId: block.id,
                message: '<iframe> tags are not supported in most email clients.'
            });
        }
        if (/<form/i.test(html)) {
            issues.push({
                severity: 'error',
                blockId: block.id,
                message: 'Forms are not supported in most email clients.'
            });
        }
        if (/(display:\s*flex|display:\s*grid)/i.test(html)) {
            issues.push({
                severity: 'warning',
                blockId: block.id,
                message: 'Flexbox/Grid CSS has poor support (e.g., Outlook on Windows). Use tables for layout.'
            });
        }
    }

    // Placeholder Content Detection
    if (block.type === 'text') {
        if (block.content.text.includes('Lorem ipsum')) {
            issues.push({
                severity: 'info',
                blockId: block.id,
                message: 'Placeholder text (Lorem Ipsum) detected.'
            });
        }
    }
};
