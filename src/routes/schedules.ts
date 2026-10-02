import { Router } from 'express';
import { protect } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/scheduleController';

const router = Router();

router.use(protect);

router.route('/').get(asyncHandler(c.getAll)).post(asyncHandler(c.create));
router.get('/busy', asyncHandler(c.getBusy));
router.get('/customer/:customer', asyncHandler(c.getByCustomer));
router.get('/:id/contract', asyncHandler(c.exportContract));
router.post('/:id/sync-contract-deposit', asyncHandler(c.syncContractDepositNow));
router
  .route('/:id')
  .get(asyncHandler(c.getOne))
  .put(asyncHandler(c.update))
  .delete(asyncHandler(c.remove));

export default router;
