import { Router } from 'express';
import { protect } from '../middleware/auth';
import {
  generateLinkToken,
  unlinkTelegram,
  getTelegramStatus,
  handleWebhook,
} from '../controllers/telegramController';

const router = Router();

// Webhook — Telegram gọi vào đây (không cần JWT)
router.post('/webhook', handleWebhook);

// Các endpoint yêu cầu đăng nhập
router.get('/status', protect, getTelegramStatus);
router.post('/generate-link-token', protect, generateLinkToken);
router.delete('/unlink', protect, unlinkTelegram);

export default router;
