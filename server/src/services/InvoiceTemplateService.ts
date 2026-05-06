import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import {
    mergeInvoiceSettings,
    DEFAULT_INVOICE_TEMPLATE_SETTINGS,
} from '../../../packages/overseek-core/dist/invoiceRenderModel';
import { Logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

type InvoiceGridItem = Record<string, unknown>;
type InvoiceItemConfig = Record<string, unknown>;

type InvoiceTemplateSettings = {
    locale?: Record<string, unknown>;
    numbering?: Record<string, unknown>;
    compliance?: Record<string, unknown>;
    payment?: Record<string, unknown>;
    branding?: Record<string, unknown>;
    [key: string]: unknown;
};

type InvoiceTemplateVersionLayout = {
    grid: InvoiceGridItem[];
    items: InvoiceItemConfig[];
    settings: InvoiceTemplateSettings;
};

type InvoiceTemplateVersion = {
    id: string;
    createdAt: string;
    name: string;
    layout: InvoiceTemplateVersionLayout;
};

type InvoiceTemplateLayout = {
    grid: InvoiceGridItem[];
    items: InvoiceItemConfig[];
    settings: InvoiceTemplateSettings;
    versions: InvoiceTemplateVersion[];
};

function toPrismaJsonValue(obj: unknown): Prisma.InputJsonValue {
    return obj as Prisma.InputJsonValue;
}

export class InvoiceTemplateService {
    normalizeLayout(layout: unknown): InvoiceTemplateLayout {
        let layoutRaw: unknown = layout;
        let parsed: Record<string, unknown> = (layout as Record<string, unknown>) || {};

        if (typeof layoutRaw === 'string') {
            try {
                if (layoutRaw.length > 10 * 1024 * 1024) {
                    Logger.warn('[InvoiceTemplateService] Template layout string exceeds safe size, skipping parse', {
                        sizeMB: (layoutRaw.length / 1024 / 1024).toFixed(2)
                    });
                    parsed = {};
                } else {
                    parsed = JSON.parse(layoutRaw) as Record<string, unknown>;
                }
            } catch (error) {
                Logger.warn('[InvoiceTemplateService] Failed to parse template layout string', { error });
                parsed = {};
            }
        }

        const baseSettings = parsed?.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)
            ? parsed.settings as InvoiceTemplateSettings
            : (DEFAULT_INVOICE_TEMPLATE_SETTINGS as InvoiceTemplateSettings);

        const versions = Array.isArray(parsed?.versions) ? (parsed.versions as InvoiceTemplateVersion[]) : [];

        return {
            grid: Array.isArray(parsed?.grid) ? (parsed.grid as InvoiceGridItem[]) : [],
            items: Array.isArray(parsed?.items) ? (parsed.items as InvoiceItemConfig[]) : [],
            settings: mergeInvoiceSettings(baseSettings) as InvoiceTemplateSettings,
            versions: versions
                .filter((v) => v?.id && v?.layout)
                .slice(0, 25)
        };
    }

    private createVersionSnapshot(name: string, layout: InvoiceTemplateLayout) {
        return {
            id: randomUUID(),
            createdAt: new Date().toISOString(),
            name,
            layout: {
                grid: layout.grid,
                items: layout.items,
                settings: layout.settings
            }
        };
    }

    private nextVersionList(existingLayout: InvoiceTemplateLayout, currentName: string) {
        const snapshot = this.createVersionSnapshot(currentName, existingLayout);
        return [snapshot, ...existingLayout.versions].slice(0, 25);
    }

    private deepMergeSettings(existing: InvoiceTemplateSettings, incoming: InvoiceTemplateSettings): InvoiceTemplateSettings {
        return {
            ...existing,
            ...incoming,
            locale: {
                ...(existing.locale || {}),
                ...(incoming.locale || {})
            },
            numbering: {
                ...(existing.numbering || {}),
                ...(incoming.numbering || {})
            },
            compliance: {
                ...(existing.compliance || {}),
                ...(incoming.compliance || {})
            },
            payment: {
                ...(existing.payment || {}),
                ...(incoming.payment || {})
            },
            branding: {
                ...(existing.branding || {}),
                ...(incoming.branding || {})
            }
        };
    }

    async createTemplate(accountId: string, data: { name: string, layout: unknown }) {
        const existing = await prisma.invoiceTemplate.findFirst({
            where: { accountId }
        });

        const incomingLayout = this.normalizeLayout(data.layout);

        if (existing) {
            const existingLayout = this.normalizeLayout(existing.layout);
            const mergedSettings = this.deepMergeSettings(existingLayout.settings, incomingLayout.settings);
            const merged = {
                ...incomingLayout,
                settings: mergedSettings,
                versions: this.nextVersionList(existingLayout, existing.name)
            };
            return await prisma.invoiceTemplate.update({
                where: { id: existing.id },
                data: {
                    name: data.name,
                    layout: toPrismaJsonValue(merged)
                }
            });
        }

        return await prisma.invoiceTemplate.create({
            data: {
                accountId,
                name: data.name,
                layout: toPrismaJsonValue(incomingLayout)
            }
        });
    }

    async updateTemplate(id: string, accountId: string, data: { name?: string, layout?: unknown }) {
        const existing = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });

        if (!existing) throw new Error("Template not found or access denied");

        const existingLayout = this.normalizeLayout(existing.layout);
        const incomingLayout = data.layout
            ? this.normalizeLayout(data.layout)
            : existingLayout;

        const mergedSettings = this.deepMergeSettings(existingLayout.settings, incomingLayout.settings);
        const mergedLayout = {
            ...incomingLayout,
            settings: mergedSettings,
            versions: this.nextVersionList(existingLayout, existing.name)
        };

        return await prisma.invoiceTemplate.update({
            where: { id },
            data: {
                name: data.name ?? existing.name,
                layout: toPrismaJsonValue(mergedLayout)
            }
        });
    }

    async getTemplate(id: string, accountId: string) {
        const template = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });
        if (!template) return template;
        return {
            ...template,
            layout: this.normalizeLayout(template.layout)
        };
    }

    async getTemplates(accountId: string) {
        const templates = await prisma.invoiceTemplate.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' }
        });
        return templates.map((template) => ({
            ...template,
            layout: this.normalizeLayout(template.layout)
        }));
    }

    async getTemplateVersions(id: string, accountId: string) {
        const template = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });
        if (!template) throw new Error("Template not found or access denied");
        const layout = this.normalizeLayout(template.layout);
        return layout.versions;
    }

    async rollbackTemplateVersion(id: string, accountId: string, versionId: string) {
        const template = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });
        if (!template) throw new Error("Template not found or access denied");

        const currentLayout = this.normalizeLayout(template.layout);
        const targetVersion = currentLayout.versions.find((version) => version.id === versionId);
        if (!targetVersion) throw new Error("Version not found");

        const rollbackLayout = this.normalizeLayout(targetVersion.layout);
        const versionsAfterRollback = this.nextVersionList(currentLayout, template.name)
            .filter((version) => version.id !== versionId);

        const merged = {
            ...rollbackLayout,
            versions: versionsAfterRollback
        };

        return await prisma.invoiceTemplate.update({
            where: { id: template.id },
            data: {
                layout: toPrismaJsonValue(merged)
            }
        });
    }

    async deleteTemplate(id: string, accountId: string) {
        const existing = await prisma.invoiceTemplate.findFirst({
            where: { id, accountId }
        });

        if (!existing) throw new Error("Template not found or access denied");

        return await prisma.invoiceTemplate.delete({
            where: { id }
        });
    }
}

export const invoiceTemplateService = new InvoiceTemplateService();
