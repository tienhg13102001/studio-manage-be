import { Request, Response } from 'express';
import Category from '../models/Category';

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const { type } = req.query as { type?: 'income' | 'expense' };
  const filter = type ? { type } : {};
  const cats = await Category.find(filter).sort({ type: 1, name: 1 });
  res.json(cats);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const cat = await Category.create({ ...req.body, createdBy: req.user!._id });
  res.status(201).json(cat);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const cat = await Category.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!cat) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(cat);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const cat = await Category.findByIdAndDelete(req.params.id);
  if (!cat) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json({ message: 'Deleted' });
};
