import { Router } from 'express';
import { protect } from '../middleware/auth';
import * as packageController from '../controllers/packageController';

const router = Router();

router.use(protect);

router.get('/', packageController.getAll);
router.get('/:id', packageController.getOne);
router.post('/', packageController.create);
router.put('/:id', packageController.update);
router.delete('/:id', packageController.remove);

export default router;
