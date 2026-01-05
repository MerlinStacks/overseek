import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { PurchaseOrderService } from '../services/PurchaseOrderService';
import { PicklistService } from '../services/PicklistService';

const router = Router();
const prisma = new PrismaClient();
const poService = new PurchaseOrderService();
const picklistService = new PicklistService();

router.use(requireAuth);

// --- Settings & Alerts ---

// GET /settings
router.get('/settings', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    try {
        const settings = await prisma.inventorySettings.findUnique({
            where: { accountId }
        });
        res.json(settings || {});
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// POST /settings
router.post('/settings', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    const { isEnabled, lowStockThresholdDays, alertEmails } = req.body;
    try {
        const settings = await prisma.inventorySettings.upsert({
            where: { accountId },
            create: {
                accountId,
                isEnabled,
                lowStockThresholdDays,
                alertEmails
            },
            update: {
                isEnabled,
                lowStockThresholdDays,
                alertEmails
            }
        });
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// GET /health
import { InventoryService } from '../services/InventoryService';

router.get('/health', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    try {
        const risks = await InventoryService.checkInventoryHealth(accountId);
        res.json(risks);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to check inventory health' });
    }
});


// --- Suppliers ---

// GET /suppliers
router.get('/suppliers', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) return res.status(400).json({ error: 'No account' });

    try {
        const suppliers = await prisma.supplier.findMany({
            where: { accountId },
            include: { items: true },
            orderBy: { name: 'asc' }
        });
        res.json(suppliers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch suppliers' });
    }
});

// POST /suppliers
router.post('/suppliers', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) return res.status(400).json({ error: 'No account' });

    try {
        const { name, contactName, email, phone, currency, leadTimeDefault, leadTimeMin, leadTimeMax, paymentTerms } = req.body;
        const supplier = await prisma.supplier.create({
            data: {
                accountId,
                name,
                contactName,
                email,
                phone,
                currency: currency || 'USD',
                leadTimeDefault: leadTimeDefault ? parseInt(leadTimeDefault) : null,
                leadTimeMin: leadTimeMin ? parseInt(leadTimeMin) : null,
                leadTimeMax: leadTimeMax ? parseInt(leadTimeMax) : null,
                paymentTerms
            }
        });
        res.json(supplier);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create supplier' });
    }
});

// POST /suppliers/:id/items
router.post('/suppliers/:id/items', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const { name, sku, cost, leadTime, moq } = req.body;
        const item = await prisma.supplierItem.create({
            data: {
                supplierId: id,
                name,
                sku,
                cost: parseFloat(cost),
                leadTime: leadTime ? parseInt(leadTime) : null,
                moq: moq ? parseInt(moq) : 1
            }
        });
        res.json(item);
    } catch (error) {
        res.status(500).json({ error: 'Failed to add item' });
    }
});

// --- BOM ---

// GET /products/:productId/bom
router.get('/products/:productId/bom', async (req: Request, res: Response) => {
    const { productId } = req.params;
    const variationId = parseInt(req.query.variationId as string) || 0;

    try {
        const bom = await prisma.bOM.findUnique({
            where: {
                productId_variationId: {
                    productId,
                    variationId
                }
            },
            include: {
                items: {
                    include: { supplierItem: { include: { supplier: true } } }
                }
            }
        });
        res.json(bom || { items: [] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch BOM' });
    }
});

// POST /products/:productId/bom
router.post('/products/:productId/bom', async (req: Request, res: Response) => {
    const { productId } = req.params;
    const { items, variationId = 0 } = req.body; // variationId from body, default 0

    try {
        // Upsert BOM
        const bom = await prisma.bOM.upsert({
            where: {
                productId_variationId: {
                    productId,
                    variationId: Number(variationId)
                }
            },
            create: {
                productId,
                variationId: Number(variationId)
            },
            update: {}
        });

        // Replace items (Transaction)
        await prisma.$transaction([
            prisma.bOMItem.deleteMany({ where: { bomId: bom.id } }),
            prisma.bOMItem.createMany({
                data: items.map((item: any) => ({
                    bomId: bom.id,
                    supplierItemId: item.supplierItemId,
                    childProductId: item.childProductId, // Ensure childProductId is passed
                    quantity: item.quantity,
                    wasteFactor: item.wasteFactor || 0
                }))
            })
        ]);

        const updated = await prisma.bOM.findUnique({
            where: { id: bom.id },
            include: { items: { include: { supplierItem: true, childProduct: true } } }
        });

        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to save BOM' });
    }
});

// export default router; // Moved to end

// --- Purchase Orders ---

// GET /purchase-orders
router.get('/purchase-orders', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    const { status } = req.query;
    try {
        const orders = await poService.listPurchaseOrders(accountId, status as string);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch POs' });
    }
});

// GET /purchase-orders/:id
router.get('/purchase-orders/:id', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    const { id } = req.params;
    try {
        const po = await poService.getPurchaseOrder(accountId, id);
        if (!po) return res.status(404).json({ error: 'PO not found' });
        res.json(po);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch PO' });
    }
});

// POST /purchase-orders
router.post('/purchase-orders', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    try {
        const po = await poService.createPurchaseOrder(accountId, req.body);
        res.json(po);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create PO' });
    }
});

// PUT /purchase-orders/:id
router.put('/purchase-orders/:id', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    const { id } = req.params;
    try {
        await poService.updatePurchaseOrder(accountId, id, req.body);
        const updated = await poService.getPurchaseOrder(accountId, id);
        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update PO' });
    }
});

// --- Picklist ---

// GET /picklist
router.get('/picklist', async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    const { status, limit } = req.query;
    try {
        const picklist = await picklistService.generatePicklist(accountId, {
            status: status as string,
            limit: limit ? Number(limit) : undefined
        });
        res.json(picklist);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate picklist' });
    }
});

export default router;
