import { Router } from 'express';
import { protect } from '../middleware/auth';
import * as c from '../controllers/scheduleController';

const router = Router();

router.use(protect);

router.route('/').get(c.getAll).post(c.create);
router.get('/:id/contract', c.exportContract);
router.route('/:id').get(c.getOne).put(c.update).delete(c.remove);

export default router;
