import { Router } from 'express';
import { getStats } from '../controllers/dashboardController';
import { protect } from '../middleware/auth';

const router = Router();

router.get('/', protect, getStats);

export default router;
