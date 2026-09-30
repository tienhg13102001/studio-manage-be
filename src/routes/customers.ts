import { Router } from 'express';
import { protect } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/customerController';

const router = Router();

router.use(protect);

router.route('/').get(asyncHandler(c.getAll)).post(asyncHandler(c.create));
router.get('/status-counts', asyncHandler(c.getStatusCounts));
router.get('/:id/activities', asyncHandler(c.getActivities));
router.post('/:id/notes', asyncHandler(c.addNote));
router.post('/:id/status', asyncHandler(c.changeStatus));
router
  .route('/:id')
  .get(asyncHandler(c.getOne))
  .put(asyncHandler(c.update))
  .delete(asyncHandler(c.remove));

export default router;
