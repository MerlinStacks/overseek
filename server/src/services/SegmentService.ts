
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import crypto from 'crypto';
import { rollingFields, purchaseFields, validateCriteria } from './segments/criteria';
import { behaviourPredicate } from './segments/behaviourPredicate';

interface SegmentRule {
    field: string;
    operator: string;
    value: any;
    campaignId?: string;
    withinDays?: string;
}

interface SegmentCriteria {
    type: 'AND' | 'OR';
    rules: SegmentRule[];
}

interface PreviewFilterCondition {
    field: string;
    operator: string;
    value: string;
}

interface PreviewFilterGroup {
    combinator: 'AND' | 'OR';
    conditions: PreviewFilterCondition[];
}

/**
 * Result type for exportable customer data.
 * Contains both raw and SHA256-hashed identifiers for ad platform uploads.
 */
export interface ExportableCustomerData {
    profiles?: AdvertisingProfile[];
    emails: string[];
    phones: string[];
    hashedEmails: string[];
    hashedPhones: string[];
    totalCount: number;
}

export interface AdvertisingProfile {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    rawData?: unknown;
}

export class SegmentService {

    private buildAdvancedCondition(condition: PreviewFilterCondition): Prisma.WooCustomerWhereInput | null {
        const field = String(condition.field || '').trim();
        const operator = String(condition.operator || '').trim().toLowerCase();
        const value = String(condition.value || '').trim();
        if (!field || field === 'Select' || !value) return null;

        if (field === 'Name') {
            if (operator === 'is not') {
                return {
                    NOT: {
                        OR: [
                            { firstName: { equals: value, mode: 'insensitive' } },
                            { lastName: { equals: value, mode: 'insensitive' } }
                        ]
                    }
                };
            }
            if (operator === 'contains') {
                return {
                    OR: [
                        { firstName: { contains: value, mode: 'insensitive' } },
                        { lastName: { contains: value, mode: 'insensitive' } }
                    ]
                };
            }
            return {
                OR: [
                    { firstName: { equals: value, mode: 'insensitive' } },
                    { lastName: { equals: value, mode: 'insensitive' } }
                ]
            };
        }

        if (field === 'Email') {
            if (operator === 'is not') return { NOT: { email: { equals: value, mode: 'insensitive' } } };
            if (operator === 'contains') return { email: { contains: value, mode: 'insensitive' } };
            return { email: { equals: value, mode: 'insensitive' } };
        }

        if (field === 'Contact Status') {
            if (operator === 'is not') return { NOT: { rawData: { path: ['contactStatus'], equals: value.toUpperCase() } } };
            if (operator === 'contains') return { rawData: { path: ['contactStatus'], string_contains: value.toUpperCase() } };
            return { rawData: { path: ['contactStatus'], equals: value.toUpperCase() } };
        }

        if (field === 'Total Spent') {
            const numeric = Number(value);
            if (Number.isNaN(numeric)) return null;
            if (operator === 'greater than') return { totalSpent: { gt: numeric } };
            if (operator === 'less than') return { totalSpent: { lt: numeric } };
            if (operator === 'is not') return { NOT: { totalSpent: numeric } };
            return { totalSpent: numeric };
        }

        if (field === 'Orders') {
            const numeric = Number(value);
            if (Number.isNaN(numeric)) return null;
            if (operator === 'greater than') return { ordersCount: { gt: numeric } };
            if (operator === 'less than') return { ordersCount: { lt: numeric } };
            if (operator === 'is not') return { NOT: { ordersCount: numeric } };
            return { ordersCount: numeric };
        }

        return null;
    }

    private buildAdvancedFilterWhere(filters: PreviewFilterGroup[]): Prisma.WooCustomerWhereInput | null {
        const groups = (filters || []).map((group) => ({
            combinator: group.combinator === 'OR' ? 'OR' : 'AND',
            conditions: (group.conditions || [])
                .map((condition) => this.buildAdvancedCondition(condition))
                .filter(Boolean) as Prisma.WooCustomerWhereInput[]
        })).filter((group) => group.conditions.length > 0);

        if (groups.length === 0) return null;

        let expression: Prisma.WooCustomerWhereInput = { AND: groups[0].conditions };
        for (let index = 1; index < groups.length; index += 1) {
            const groupExpr: Prisma.WooCustomerWhereInput = { AND: groups[index].conditions };
            expression = groups[index].combinator === 'OR'
                ? { OR: [expression, groupExpr] }
                : { AND: [expression, groupExpr] };
        }

        return expression;
    }

    async createSegment(accountId: string, data: { name: string; description?: string; criteria: any }) {
        const error = validateCriteria(data.criteria);
        if (error) throw new Error(error);
        return prisma.customerSegment.create({
            data: {
                accountId,
                name: data.name,
                description: data.description,
                criteria: data.criteria
            }
        });
    }

    async updateSegment(id: string, accountId: string, data: { name?: string; description?: string; criteria?: any }) {
        if (data.criteria !== undefined) {
            const error = validateCriteria(data.criteria);
            if (error) throw new Error(error);
        }
        return prisma.customerSegment.updateMany({
            where: { id, accountId },
            data: {
                name: data.name,
                description: data.description,
                criteria: data.criteria,
                updatedAt: new Date()
            }
        });
    }

    async deleteSegment(id: string, accountId: string) {
        return prisma.customerSegment.deleteMany({
            where: { id, accountId }
        });
    }

    async getSegment(id: string, accountId: string) {
        return prisma.customerSegment.findFirst({
            where: { id, accountId }
        });
    }

    async listSegments(accountId: string) {
        return prisma.customerSegment.findMany({
            where: { accountId },
            orderBy: { createdAt: 'desc' },
            include: {
                audienceSyncs: { select: { id: true, platform: true, audienceName: true, status: true, lastSyncAt: true, lastError: true, memberCount: true, autoSyncEnabled: true, includeSubscribers: true, enhancedMatching: true } },
                _count: {
                    select: { campaigns: true }
                }
            }
        });
    }

    /**
     * previewCustomers - Returns a list of customers matching the segment criteria
     */
    async previewCustomers(accountId: string, segmentId: string, page = 1, pageSize = 25, filters: PreviewFilterGroup[] = []) {
        const segment = await this.getSegment(segmentId, accountId);
        if (!segment) throw new Error('Segment not found');

        const criteria = segment.criteria as unknown as SegmentCriteria;
        const baseWhereClause = await this.buildWhereClause(accountId, criteria);
        const advancedWhereClause = this.buildAdvancedFilterWhere(filters);
        const whereClause = advancedWhereClause
            ? { AND: [baseWhereClause, advancedWhereClause] }
            : baseWhereClause;

        const safePage = Math.max(1, page);
        const safePageSize = Math.min(100, Math.max(1, pageSize));
        const skip = (safePage - 1) * safePageSize;

        const [customers, total] = await Promise.all([
            prisma.wooCustomer.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                skip,
                take: safePageSize
            }),
            prisma.wooCustomer.count({ where: whereClause })
        ]);

        return {
            customers,
            pagination: {
                page: safePage,
                pageSize: safePageSize,
                total,
                totalPages: Math.max(1, Math.ceil(total / safePageSize))
            }
        };
    }

    /**
     * getCustomerIdsInSegment - Returns ALL customer IDs matching the segment (for broadcasts)
     */
    async getCustomerIdsInSegment(accountId: string, segmentId: string) {
        const segment = await this.getSegment(segmentId, accountId);
        if (!segment) return [];

        const criteria = segment.criteria as unknown as SegmentCriteria;
        const whereClause = await this.buildWhereClause(accountId, criteria);

        const customers = await prisma.wooCustomer.findMany({
            where: whereClause,
            select: { id: true, email: true, wooId: true }
        });

        return customers;
    }

    /**
     * getSegmentCount - Returns the count of customers in a segment
     */
    async getSegmentCount(accountId: string, segmentId: string): Promise<number> {
        const segment = await this.getSegment(segmentId, accountId);
        if (!segment) return 0;

        const criteria = segment.criteria as unknown as SegmentCriteria;
        const whereClause = await this.buildWhereClause(accountId, criteria);

        return prisma.wooCustomer.count({ where: whereClause });
    }

    async getMatchingSegmentIdsForCustomer(accountId: string, customerId: string): Promise<string[]> {
        const customer = await prisma.wooCustomer.findFirst({
            where: { id: customerId, accountId },
            select: {
                id: true,
                totalSpent: true,
                ordersCount: true,
                email: true,
                firstName: true,
                lastName: true
            }
        });
        if (!customer) return [];

        const segments = await prisma.customerSegment.findMany({
            where: { accountId },
            select: { id: true, criteria: true }
        });

        const matchingSegmentIds: string[] = [];

        for (const segment of segments) {
            const criteria = segment.criteria as unknown as SegmentCriteria;
            const where = await this.buildWhereClause(accountId, criteria);
            if (await prisma.wooCustomer.count({ where: { AND: [where, { id: customerId }] } })) {
                matchingSegmentIds.push(segment.id);
            }
        }

        return matchingSegmentIds;
    }

    /**
     * iterateCustomersInSegment - Yields batches of customers in a segment
     */
    async *iterateCustomersInSegment(accountId: string, segmentId: string, batchSize = 1000) {
        const segment = await this.getSegment(segmentId, accountId);
        if (!segment) return;

        const criteria = segment.criteria as unknown as SegmentCriteria;
        const whereClause = await this.buildWhereClause(accountId, criteria);

        let cursor: string | undefined;

        while (true) {
            const params: any = {
                where: whereClause,
                take: batchSize,
                orderBy: { id: 'asc' },
                select: { id: true, email: true }
            };

            if (cursor) {
                params.cursor = { id: cursor };
                params.skip = 1;
            }

            const batch = await prisma.wooCustomer.findMany(params);

            if (batch.length === 0) break;

            yield batch;

            if (batch.length < batchSize) break;

            cursor = batch[batch.length - 1].id;
        }
    }

    /**
     * getExportableCustomers - Returns customer identifiers for ad platform sync
     * 
     * Retrieves all customers in a segment and returns both raw and SHA256-hashed
     * emails/phones. Both Meta Custom Audiences and Google Customer Match require
     * SHA256 hashing for privacy compliance.
     * 
     * @param accountId - The account ID
     * @param segmentId - The segment to export
     * @returns Object containing raw and hashed emails/phones
     * @throws Error if segment not found or segment is empty
     */
    async getExportableCustomers(accountId: string, segmentId: string, allowEmpty = false): Promise<ExportableCustomerData> {
        const segment = await this.getSegment(segmentId, accountId);
        if (!segment) {
            throw new Error('Segment not found');
        }

        const criteria = segment.criteria as unknown as SegmentCriteria;
        const whereClause = await this.buildWhereClause(accountId, criteria);

        // Fetch all customers with email and rawData (phone is in rawData.billing.phone)
        const customers = await prisma.wooCustomer.findMany({
            where: whereClause,
            select: {
                email: true,
                firstName: true,
                lastName: true,
                rawData: true
            }
        });

        // EDGE CASE: Handle empty segments gracefully with clear error message
        if (customers.length === 0 && !allowEmpty) {
            throw new Error(`No customers match this segment. The segment "${segment.name}" has 0 customers matching the current criteria. Please adjust the segment rules or wait for more customer data.`);
        }

        const emails: string[] = [];
        const phones: string[] = [];
        const hashedEmails: string[] = [];
        const hashedPhones: string[] = [];

        for (const customer of customers) {
            // Process email
            if (customer.email) {
                const normalizedEmail = customer.email.toLowerCase().trim();
                emails.push(normalizedEmail);
                hashedEmails.push(this.sha256Hash(normalizedEmail));
            }

            // Process phone - extract from rawData.billing.phone
            const rawData = customer.rawData as Record<string, any> | null;
            const phone = rawData?.billing?.phone || rawData?.phone;
            if (phone && typeof phone === 'string') {
                const normalizedPhone = phone.replace(/\D/g, '');
                if (normalizedPhone.length >= 10) {
                    phones.push(normalizedPhone);
                    hashedPhones.push(this.sha256Hash(normalizedPhone));
                }
            }
        }

        return {
            profiles: customers,
            emails,
            phones,
            hashedEmails,
            hashedPhones,
            totalCount: customers.length
        };
    }


    /**
     * SHA256 hash for PII before sending to ad platforms.
     * Both Meta and Google require this for Customer Match / Custom Audiences.
     */
    private sha256Hash(value: string): string {
        return crypto.createHash('sha256').update(value).digest('hex');
    }

    private async buildWhereClause(accountId: string, criteria: SegmentCriteria): Promise<Prisma.WooCustomerWhereInput> {
        const error = validateCriteria(criteria);
        if (error) throw new Error(error);
        if (!criteria || !criteria.rules || criteria.rules.length === 0) {
            return { accountId }; // Return all if no rules? Or none? Let's say all for now or handle empty.
        }

        const conditions: Prisma.WooCustomerWhereInput[] = await Promise.all(criteria.rules.map(async rule => {
            if (rollingFields.includes(rule.field) || purchaseFields.includes(rule.field)) return this.mapRollingRule(accountId, rule);
            return this.mapRuleToPrisma(rule);
        }));

        if (criteria.type === 'OR') {
            return {
                accountId,
                OR: conditions
            };
        }

        // Default AND
        return {
            accountId,
            AND: conditions
        };
    }

    private mapRuleToPrisma(rule: SegmentRule): Prisma.WooCustomerWhereInput {
        const { field, operator, value } = rule;

        // Numeric fields
        if (field === 'totalSpent' || field === 'ordersCount') {
            const numValue = Number(value);
            switch (operator) {
                case 'gt': return { [field]: { gt: numValue } };
                case 'lt': return { [field]: { lt: numValue } };
                case 'gte': return { [field]: { gte: numValue } };
                case 'lte': return { [field]: { lte: numValue } };
                case 'eq': return { [field]: { equals: numValue } };
                default: return {};
            }
        }

        // String fields
        if (field === 'email' || field === 'firstName' || field === 'lastName') {
            switch (operator) {
                case 'contains': return { [field]: { contains: value, mode: 'insensitive' } };
                case 'equals': return { [field]: { equals: value, mode: 'insensitive' } };
                case 'startsWith': return { [field]: { startsWith: value, mode: 'insensitive' } };
                default: return {};
            }
        }

        return {};
    }

    private async mapRollingRule(accountId: string, rule: SegmentRule): Promise<Prisma.WooCustomerWhereInput> {
        const predicate = behaviourPredicate(rule);
        const customers = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT c.id FROM "WooCustomer" c WHERE c."accountId" = ${accountId} AND ${predicate}`);
        return { id: { in: customers.map(customer => customer.id) } };
    }

}

export const segmentService = new SegmentService();
