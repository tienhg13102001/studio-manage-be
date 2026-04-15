import { Request, Response } from 'express';
import Costume from '../models/Costume';

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const costumes = await Costume.find().sort({ name: 1 });
  res.json(costumes);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const costume = await Costume.create(req.body);
  res.status(201).json(costume);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const costume = await Costume.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!costume) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(costume);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const costume = await Costume.findByIdAndDelete(req.params.id);
  if (!costume) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json({ message: 'Deleted' });
};
