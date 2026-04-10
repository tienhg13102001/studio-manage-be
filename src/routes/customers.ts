import { Router } from 'express';
import { protect } from '../middleware/auth';
import * as c from '../controllers/customerController';

const router = Router();

router.use(protect);

router.route('/').get(c.getAll).post(c.create);
router.route('/:id').get(c.getOne).put(c.update).delete(c.remove);

export default router;
