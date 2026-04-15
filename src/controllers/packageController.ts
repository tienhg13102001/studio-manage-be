import { Request, Response } from 'express';
import Package from '../models/Package';

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const packages = await Package.find().sort({ name: 1 }).populate('costumes');
  res.json(packages);
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const pkg = await Package.findById(req.params.id).populate('costumes');
  if (!pkg) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(pkg);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const pkg = await Package.create(req.body);
  res.status(201).json(pkg);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const pkg = await Package.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!pkg) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(pkg);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  await Package.findByIdAndDelete(req.params.id);
  res.json({ message: 'Deleted' });
};
