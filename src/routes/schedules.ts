import { Request, Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { protect } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/scheduleController';
import Schedule from '../models/Schedule';
import { requireCustomerAccess } from '../utils/customerScope';

const router = Router();

router.use(protect);

// CTV sale chỉ thao tác trên lịch của lớp mình tạo / phụ trách
const scheduleCustomer = async (id: string) => {
  if (!isValidObjectId(id)) return undefined;
  const s = await Schedule.findById(id).select('customer').lean();
  return s ? (s.customer ?? null) : undefined;
};
/** Body đổi / gán lớp → lớp mới cũng phải trong phạm vi. */
const bodyCustomer = (req: Request) =>
  req.body && 'customer' in req.body ? req.body.customer : undefined;

router.param(
  'id',
  requireCustomerAccess((req) => scheduleCustomer(req.params.id)),
);
router.param(
  'customer',
  requireCustomerAccess((req) => req.params.customer),
);

router
  .route('/')
  .get(asyncHandler(c.getAll))
  .post(
    requireCustomerAccess((req) => req.body?.customer ?? null),
    asyncHandler(c.create),
  );
router.get('/busy', asyncHandler(c.getBusy));
router.get('/customer/:customer', asyncHandler(c.getByCustomer));
router.get('/:id/contract', asyncHandler(c.exportContract));
// Route cũ (client chưa tải lại) → 410
router.post('/:id/sync-contract-deposit', c.goneContractRoute);
router
  .route('/:id')
  .get(asyncHandler(c.getOne))
  .put(requireCustomerAccess(bodyCustomer), asyncHandler(c.update))
  .delete(asyncHandler(c.remove));

export default router;
