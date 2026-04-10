import { Request, Response } from 'express';
import Customer from '../models/Customer';

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const { search, page = '1', limit = '20' } = req.query as Record<string, string>;
  const query = search ? { $text: { $search: search } } : {};
  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    Customer.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Customer.countDocuments(query),
  ]);
  res.json({ data, total, page: Number(page), limit: Number(limit) });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(customer);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.create(req.body);
  res.status(201).json(customer);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!customer) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(customer);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.findByIdAndDelete(req.params.id);
  if (!customer) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json({ message: 'Deleted' });
};
