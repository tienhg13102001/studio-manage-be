import { Router } from 'express';
import { body } from 'express-validator';
import { login, getMe, refresh, changePassword, updateProfile } from '../controllers/authController';
import { protect } from '../middleware/auth';

const router = Router();

router.post(
  '/login',
  [
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  login,
);

router.get('/me', protect, getMe);
router.post('/refresh', protect, refresh);
router.patch('/change-password', protect, changePassword);
router.patch('/profile', protect, updateProfile);

export default router;
