import { Router } from 'express';
import { protect } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/transactionController';

const router = Router();

router.use(protect);

router.get('/summary', asyncHandler(c.getSummary));
router.route('/').get(asyncHandler(c.getAll)).post(asyncHandler(c.create));
router
  .route('/:id')
  .get(asyncHandler(c.getOne))
  .put(asyncHandler(c.update))
  .delete(asyncHandler(c.remove));

export default router;
