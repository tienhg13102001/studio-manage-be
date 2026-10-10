import { Router } from 'express';
import { protect } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/profitScenarioController';

const router = Router();
router.use(protect, requireRole(0, 1));
router.get('/classes', asyncHandler(c.getClasses));
router.route('/').get(asyncHandler(c.getAll)).post(asyncHandler(c.create));
router.route('/:id').put(asyncHandler(c.update)).delete(asyncHandler(c.remove));
export default router;
