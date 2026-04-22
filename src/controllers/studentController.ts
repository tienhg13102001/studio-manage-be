import { Request, Response } from 'express';
import Student from '../models/Student';

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const { customer, search, page = '1', limit = '50' } = req.query as Record<string, string>;
  const query: Record<string, unknown> = {};
  if (customer) query.customer = customer;
  if (search) query.$text = { $search: search };
  const skip = (Number(page) - 1) * Number(limit);
  const [data, total, totalMale, totalFemale] = await Promise.all([
    Student.find(query).sort({ name: 1 }).skip(skip).limit(Number(limit)),
    Student.countDocuments(query),
    Student.countDocuments({ ...query, gender: 'male' }),
    Student.countDocuments({ ...query, gender: 'female' }),
  ]);
  res.json({ data, total, totalMale, totalFemale, page: Number(page), limit: Number(limit) });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const student = await Student.findById(req.params.id);
  if (!student) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(student);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const student = await Student.create(req.body);
  res.status(201).json(student);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const student = await Student.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!student) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(student);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const student = await Student.findByIdAndDelete(req.params.id);
  if (!student) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json({ message: 'Deleted' });
};
