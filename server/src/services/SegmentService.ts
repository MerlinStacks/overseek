
import { CustomerSegment, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import crypto from 'crypto';

interface SegmentRule {
    field: string;
    operator: string;
    value: any;
}

interface SegmentCriteria {
    type: 'AND' | 'OR';
    rules: SegmentRule[];
}

/**
 * Result type for exportable customer data.
 * Contains both raw and SHA256-hashed identifiers for ad platform uploads.
 */
export interface ExportableCustomerData {
    emails: string[];
    phones: string[];
    hashedEmails: string[];
    hashedPhones: string[];
    totalCount: number;
}

export class SegmentService {

    async createSegment(accountId: string, data: { name: string; description?: string; criteria: any }) {
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
        return prisma.customerSegment.updateMany({
            where: { id, accountId },
            data: {
                ...data,
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
                _count: {
                    select: { campaigns: true }
                }
            }
        });
    }

    /**
     * previewCustomers - Returns a list of customers matching the segment criteria
     */
    async previewCustomers(accountId: string, segmentId: string) {
        const segment = await this.getSegment(segmentId, accountId);
        if (!segment) throw new Error('Segment not found');

        const criteria = segment.criteria as unknown as SegmentCriteria;
        const whereClause = this.buildWhereClause(accountId, criteria);

        return prisma.wooCustomer.findMany({
            where: whereClause,
            take: 50 // Preview limit
        });
    }

    /**
     * getCustomerIdsInSegment - Returns ALL customer IDs matching the segment (for broadcasts)
     */
    async getCustomerIdsInSegment(accountId: string, segmentId: string) {
        const segment = await this.getSegment(segmentId, accountId);
        if (!segment) return [];

        const criteria = segment.criteria as unknown as SegmentCriteria;
        const whereClause = this.buildWhereClause(accountId, criteria);

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
        const whereClause = this.buildWhereClause(accountId, criteria);

        return prisma.wooCustomer.count({ where: whereClause });
    }

    /**
     * iterateCustomersInSegment - Yields batches of customers in a segment
     */
    async *iterateCustomersInSegment(accountId: string, segmentId: string, batchSize = 1000) {
        const segment = await this.getSegment(segmentId, accountId);
        if (!segment) return;

        const criteria = segment.criteria as unknown as SegmentCriteria;
        const whereClause = this.buildWhereClause(accountId, criteria);

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
    async getExportableCustomers(accountId: string, segmentId: string): Promise<ExportableCustomerData> {
        const segment = await this.getSegment(segmentId, accountId);
        if (!segment) {
            throw new Error('Segment not found');
        }

        const criteria = segment.criteria as unknown as SegmentCriteria;
        const whereClause = this.buildWhereClause(accountId, criteria);

        // Fetch all customers with email and rawData (phone is in rawData.billing.phone)
        const customers = await prisma.wooCustomer.findMany({
            where: whereClause,
            select: {
                email: true,
                rawData: true
            }
        });

        // EDGE CASE: Handle empty segments gracefully with clear error message
        if (customers.length === 0) {
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

    private buildWhereClause(accountId: string, criteria: SegmentCriteria): Prisma.WooCustomerWhereInput {
        if (!criteria || !criteria.rules || criteria.rules.length === 0) {
            return { accountId }; // Return all if no rules? Or none? Let's say all for now or handle empty.
        }

        const conditions: Prisma.WooCustomerWhereInput[] = criteria.rules.map(rule => {
            return this.mapRuleToPrisma(rule);
        });

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
}

export const segmentService = new SegmentService();
