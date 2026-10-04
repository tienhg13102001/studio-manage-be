import { Request, Response, NextFunction, Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { protect } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/transactionController';
import Transaction from '../models/Transaction';
import { customerScope, requireCustomerAccess } from '../utils/customerScope';
import { sendResponse } from '../utils/response';

const router = Router();

router.use(protect);

// CTV sale không xem thu chi tổng; chỉ giao dịch gắn với lớp mình tạo / phụ trách
const denyCollaborator = (req: Request, res: Response, next: NextFunction) => {
  if (customerScope(req)) sendResponse(res, 403, false, 'Bạn không có quyền xem thu chi');
  else next();
};
const transactionCustomer = async (id: string) => {
  if (!isValidObjectId(id)) return undefined;
  const t = await Transaction.findById(id).select('customer').lean();
  return t ? (t.customer ?? null) : undefined;
};
const bodyCustomer = (req: Request) =>
  req.body && 'customer' in req.body ? req.body.customer : undefined;

router.param(
  'id',
  requireCustomerAccess((req) => transactionCustomer(req.params.id)),
);

router.get('/summary', denyCollaborator, asyncHandler(c.getSummary));
router
  .route('/')
  .get(
    requireCustomerAccess((req) => req.query.customer ?? null),
    asyncHandler(c.getAll),
  )
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
