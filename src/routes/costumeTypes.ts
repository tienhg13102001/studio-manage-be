import { Router } from 'express';
import { protect } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/costumeTypeController';

const router = Router();

router.use(protect);

router.route('/').get(asyncHandler(c.getAll)).post(asyncHandler(c.create));
router.get('/:id/usage', asyncHandler(c.getUsage));
router.route('/:id').put(asyncHandler(c.update)).delete(asyncHandler(c.remove));

export default router;
