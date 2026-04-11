import { Router, Request, Response } from 'express';
import Customer from '../models/Customer';
import Student from '../models/Student';

const router = Router();

// Get all classes (for public form selector)
router.get('/customers', async (_req: Request, res: Response): Promise<void> => {
  const customers = await Customer.find({}).select('className school').sort({ className: 1 });
  res.json(customers);
});

// Get class info by id (for form title)
router.get('/customers/:id', async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.findById(req.params.id).select('className school');
  if (!customer) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(customer);
});

// Get students by class (for display on public form)
router.get('/students', async (req: Request, res: Response): Promise<void> => {
  const { customerId } = req.query as Record<string, string>;
  if (!customerId) {
    res.status(400).json({ message: 'customerId is required' });
    return;
  }
  const students = await Student.find({ customerId }).sort({ name: 1 });
  res.json(students);
});

// Submit student info (public)
router.post('/students', async (req: Request, res: Response): Promise<void> => {
  const { customerId, name, gender, height, weight, notes } = req.body;
  if (!customerId || !name || !gender) {
    res.status(400).json({ message: 'customerId, name và gender là bắt buộc' });
    return;
  }
  const student = await Student.create({ customerId, name, gender, height, weight, notes });
  res.status(201).json(student);
});

export default router;
