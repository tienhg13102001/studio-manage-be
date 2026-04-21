import { Router } from 'express';
import { protect } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import * as c from '../controllers/feedbackController';

const router = Router();

router.use(protect);
router.use(requireRole(0, 1));

router.get('/', c.getAll);
router.patch('/:id/read', c.markRead);
router.delete('/:id', c.remove);

export default router;
