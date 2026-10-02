import { Router } from 'express';
import { protect } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { asyncHandler } from '../utils/asyncHandler';
import * as c from '../controllers/schoolController';

const router = Router();

// Xem / tạo: cùng quyền với tạo/sửa lớp (mọi user đã đăng nhập).
// Sửa (đổi tên ảnh hưởng mọi lớp thuộc trường) / xoá (chỉ khi không còn lớp): chỉ Superadmin (0) / Admin (1).
router.use(protect);

router.route('/').get(asyncHandler(c.getAll)).post(asyncHandler(c.create));
router
  .route('/:id')
  .put(requireRole(0, 1), asyncHandler(c.update))
  .delete(requireRole(0, 1), asyncHandler(c.remove));

export default router;
