import { describe, expect, it } from 'vitest';
import { evaluateEmailPreflight, groupPreflightIssues } from './emailPreflight';

describe('evaluateEmailPreflight', () => {
    it('returns blocking issues for missing subject and empty content', () => {
        const issues = evaluateEmailPreflight({ html: '', subject: '' });
        expect(issues.map((issue) => issue.id)).toEqual(['subject', 'content']);
        expect(issues.every((issue) => issue.severity === 'blocking')).toBe(true);
    });

    it('requires unsubscribe wording for marketing emails', () => {
        const issues = evaluateEmailPreflight({
            html: '<p>Hello there</p><a href="https://example.com">Shop</a>',
            subject: 'Weekly update',
            emailCategory: 'MARKETING',
        });
        expect(issues.some((issue) => issue.id === 'unsubscribe' && issue.severity === 'blocking')).toBe(true);
    });

    it('does not require unsubscribe wording for transactional emails', () => {
        const issues = evaluateEmailPreflight({
            html: '<p>Your order shipped</p><a href="https://example.com">Track</a>',
            subject: 'Order update',
            emailCategory: 'TRANSACTIONAL',
        });
        expect(issues.some((issue) => issue.id === 'unsubscribe')).toBe(false);
    });

    it('flags unresolved merge tags and missing alt text', () => {
        const issues = evaluateEmailPreflight({
            html: '<img src="hero.jpg" /><p>Hi {{}}</p><a href="https://example.com">View</a><p>unsubscribe</p>',
            subject: 'Update',
        });
        expect(issues.some((issue) => issue.id === 'merge-tag' && issue.severity === 'blocking')).toBe(true);
        expect(issues.some((issue) => issue.id === 'alt' && issue.severity === 'warning')).toBe(true);
    });

    it('returns no issues for clean transactional email', () => {
        const issues = evaluateEmailPreflight({
            html: '<p>Thanks for your order.</p><img src="https://cdn.example.com/hero.jpg" alt="Hero" /><a href="https://example.com">Track order</a>',
            subject: 'Your receipt',
            emailCategory: 'TRANSACTIONAL',
        });
        expect(issues).toEqual([]);
    });

    it('recognizes an enabled dynamic product button as a CTA', () => {
        const issues = evaluateEmailPreflight({
            html: '<p>New products</p>{{new_products count:3 showButton:true}}',
            subject: 'New products',
            emailCategory: 'TRANSACTIONAL',
        });

        expect(issues.some((issue) => issue.id === 'cta')).toBe(false);
    });

    it('groups issues by severity', () => {
        const issues = evaluateEmailPreflight({
            html: '<p>Hi {{}}</p><img src="hero.jpg" />',
            subject: '',
            emailCategory: 'MARKETING',
        });

        const grouped = groupPreflightIssues(issues);
        expect(grouped.blocking.length).toBeGreaterThan(0);
        expect(grouped.warning.length).toBeGreaterThan(0);
        expect(grouped.blocking.every((issue) => issue.severity === 'blocking')).toBe(true);
        expect(grouped.warning.every((issue) => issue.severity === 'warning')).toBe(true);
    });
});
