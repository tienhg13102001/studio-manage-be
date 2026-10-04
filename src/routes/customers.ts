import { Router } from 'express';
import { protect } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/customerController';
import * as cc from '../controllers/customerContractController';
import { requireCustomerAccess } from '../utils/customerScope';

const router = Router();

router.use(protect);

// CTV sale chỉ thao tác trên lớp mình tạo / phụ trách
router.param('id', requireCustomerAccess((req) => req.params.id));

router.route('/').get(asyncHandler(c.getAll)).post(asyncHandler(c.create));
router.get('/status-counts', asyncHandler(c.getStatusCounts));
router.get('/:id/activities', asyncHandler(c.getActivities));
router.post('/:id/notes', asyncHandler(c.addNote));
router.post('/:id/status', asyncHandler(c.changeStatus));
router.put('/:id/contract', asyncHandler(cc.saveContract));
router.post('/:id/contract/sync-deposit', asyncHandler(cc.syncContractDepositNow));
router.post('/:id/drive-folder', asyncHandler(cc.createDriveFolder));
router
  .route('/:id')
  .get(asyncHandler(c.getOne))
  .put(asyncHandler(c.update))
  .delete(asyncHandler(c.remove));

export default router;
