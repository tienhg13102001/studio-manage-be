import { Request, Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { protect } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/studentController';
import Student from '../models/Student';
import { requireCustomerAccess } from '../utils/customerScope';

const router = Router();

router.use(protect);

// CTV sale chỉ thao tác trên học sinh của lớp mình tạo / phụ trách
const studentCustomer = async (id: string) => {
  if (!isValidObjectId(id)) return undefined;
  const s = await Student.findById(id).select('customer').lean();
  return s ? (s.customer ?? null) : undefined;
};
/** Body đổi / gán lớp → lớp mới cũng phải trong phạm vi. */
const bodyCustomer = (req: Request) =>
  req.body && 'customer' in req.body ? req.body.customer : undefined;

router.param(
  'id',
  requireCustomerAccess((req) => studentCustomer(req.params.id)),
);

router
  .route('/')
  .get(asyncHandler(c.getAll))
  .post(
    requireCustomerAccess((req) => req.body?.customer ?? null),
    asyncHandler(c.create),
  );
router
  .route('/:id')
  .get(asyncHandler(c.getOne))
  .put(requireCustomerAccess(bodyCustomer), asyncHandler(c.update))
  .delete(asyncHandler(c.remove));

export default router;
