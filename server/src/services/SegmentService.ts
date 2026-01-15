
import { CustomerSegment, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

interface SegmentRule {
    field: string;
    operator: string;
    value: any;
}

interface SegmentCriteria {
    type: 'AND' | 'OR';
    rules: SegmentRule[];
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
