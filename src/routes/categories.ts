import { Router } from 'express';
import { protect } from '../middleware/auth';
import * as c from '../controllers/categoryController';

const router = Router();

router.use(protect);

router.route('/').get(c.getAll).post(c.create);
router.route('/:id').put(c.update).delete(c.remove);

export default router;
