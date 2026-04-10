import { Router } from 'express';
import { protect } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import * as c from '../controllers/userController';

const router = Router();

// Available to any logged-in user (for assignment dropdowns)
router.get('/photographers', protect, c.getPhotographers);
router.get('/sales', protect, c.getSales);

// All other user management routes require superadmin
router.use(protect, requireRole(0));

router.route('/').get(c.getAll).post(c.create);
router.route('/:id').get(c.getOne).put(c.update).delete(c.remove);

export default router;
