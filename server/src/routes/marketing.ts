
import { Router } from 'express';
import { MarketingService } from '../services/MarketingService';
import { requireAuth } from '../middleware/auth';
import { Logger } from '../utils/logger';

const router = Router();
const service = new MarketingService();


router.use(requireAuth);

// Campaigns
router.get('/campaigns', async (req: any, res: any) => {
    try {
        const campaigns = await service.listCampaigns(req.user!.accountId);
        res.json(campaigns);
    } catch (e) { res.status(500).json({ error: e }); }
});

router.post('/campaigns', async (req: any, res: any) => {
    try {
        const campaign = await service.createCampaign(req.user!.accountId, req.body);
        res.json(campaign);
    } catch (e) {
        Logger.error('Error creating campaign', { error: e });
        res.status(500).json({ error: e });
    }
});

router.get('/campaigns/:id', async (req: any, res: any) => {
    try {
        const campaign = await service.getCampaign(req.params.id, req.user!.accountId);
        if (!campaign) return res.status(404).json({ error: 'Not found' });
        res.json(campaign);
    } catch (e) { res.status(500).json({ error: e }); }
});

router.put('/campaigns/:id', async (req: any, res: any) => {
    try {
        await service.updateCampaign(req.params.id, req.user!.accountId, req.body);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e }); }
});

router.delete('/campaigns/:id', async (req: any, res: any) => {
    try {
        await service.deleteCampaign(req.params.id, req.user!.accountId);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e }); }
});

router.post('/campaigns/:id/test', async (req: any, res: any) => {
    try {
        const { email } = req.body;
        await service.sendTestEmail(req.params.id, email);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e }); }
});

// Automations
router.get('/automations', async (req: any, res: any) => {
    try {
        const automations = await service.listAutomations(req.user!.accountId);
        res.json(automations);
    } catch (e) { res.status(500).json({ error: e }); }
});

router.post('/automations', async (req: any, res: any) => {
    // Upsert
    try {
        const automation = await service.upsertAutomation(req.user!.accountId, req.body);
        res.json(automation);
    } catch (e) { res.status(500).json({ error: e }); }
});

router.get('/automations/:id', async (req: any, res: any) => {
    try {
        const automation = await service.getAutomation(req.params.id, req.user!.accountId);
        if (!automation) return res.status(404).json({ error: 'Not found' });
        res.json(automation);
    } catch (e) { res.status(500).json({ error: e }); }
});

router.delete('/automations/:id', async (req: any, res: any) => {
    try {
        await service.deleteAutomation(req.params.id, req.user!.accountId);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e }); }
});

// Templates
router.get('/templates', async (req: any, res: any) => {
    try {
        const templates = await service.listTemplates(req.user!.accountId);
        res.json(templates);
    } catch (e) { res.status(500).json({ error: e }); }
});

router.post('/templates', async (req: any, res: any) => {
    try {
        const template = await service.upsertTemplate(req.user!.accountId, req.body);
        res.json(template);
    } catch (e) { res.status(500).json({ error: e }); }
});

router.delete('/templates/:id', async (req: any, res: any) => {
    try {
        await service.deleteTemplate(req.params.id, req.user!.accountId);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e }); }
});

export default router;
