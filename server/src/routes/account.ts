import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { AccountController } from '../controllers/AccountController';
import { AccountUserController } from '../controllers/AccountUserController';

const router = Router();

router.use(requireAuth);

// Account Management
router.post('/', AccountController.create);
router.get('/', AccountController.getAll);
router.put('/:accountId', AccountController.update);
router.delete('/:accountId', AccountController.delete);

// User Management
router.get('/:accountId/users', AccountUserController.listUsers);
router.post('/:accountId/users', AccountUserController.addUser);
router.delete('/:accountId/users/:targetUserId', AccountUserController.removeUser);

export default router;
