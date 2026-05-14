import { Router } from "express";
import * as seasonController from '../controllers/seasonController';
import { requireRole } from "../middleware/role";


const router = Router();

router.get('/', seasonController.getAll);
router.post('/', requireRole(0), seasonController.create);
router.put('/:id', requireRole(0), seasonController.update);
router.delete('/:id', requireRole(0), seasonController.remove);

export default router;