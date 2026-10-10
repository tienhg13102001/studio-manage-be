import { Router } from 'express';
import { protect } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/externalPhotographerController';

const router = Router();
router.use(protect);
router.get('/choices', asyncHandler(c.getChoices));
router.use(requireRole(0, 1));
router.route('/').get(asyncHandler(c.getAll)).post(asyncHandler(c.create));
router.put('/:id', asyncHandler(c.update));
export default router;
