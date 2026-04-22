import { Router, Request, Response } from 'express';
import Customer from '../models/Customer';
import Student from '../models/Student';
import Schedule from '../models/Schedule';
import * as feedbackController from '../controllers/feedbackController';
import type { PublicScheduleResponse } from '../types/dto';

const router = Router();

// Submit feedback (public, no auth)
router.post('/feedback', feedbackController.submit);

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
  const { customer } = req.query as Record<string, string>;
  if (!customer) {
    res.status(400).json({ message: 'customer is required' });
    return;
  }
  const students = await Student.find({ customer }).sort({ name: 1 });
  res.json(students);
});

// Submit student info (public)
router.post('/students', async (req: Request, res: Response): Promise<void> => {
  const { customer, name, gender, height, weight, notes } = req.body;
  if (!customer || !name || !gender) {
    res.status(400).json({ message: 'customer, name và gender là bắt buộc' });
    return;
  }
  const student = await Student.create({ customer, name, gender, height, weight, notes });
  res.status(201).json(student);
});

// Get shoot schedule by class (public, minimal fields)
router.get(
  '/schedules/customer/:customer',
  async (req: Request, res: Response<PublicScheduleResponse | null>): Promise<void> => {
    const schedule = await Schedule.findOne({ customer: req.params.customer })
      .select('shootDate startTime endTime location status package customer')
      .populate({
        path: 'package',
        select: 'name costumes',
        populate: { path: 'costumes' },
      })
      .populate('customer', 'className school')
      .sort({ shootDate: 1 })
      .lean<PublicScheduleResponse | null>();
    res.json(schedule);
  },
);

export default router;
