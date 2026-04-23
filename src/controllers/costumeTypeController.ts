import { Request, Response } from 'express';
import CostumeType from '../models/CostumeType';

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const types = await CostumeType.find().sort({ name: 1 });
  res.json(types);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const type = await CostumeType.create(req.body);
  res.status(201).json(type);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const type = await CostumeType.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!type) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(type);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const type = await CostumeType.findByIdAndDelete(req.params.id);
  if (!type) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json({ message: 'Deleted' });
};
