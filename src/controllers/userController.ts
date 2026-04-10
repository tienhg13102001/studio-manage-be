import { Request, Response } from 'express';
import User from '../models/User';

export const getPhotographers = async (_req: Request, res: Response): Promise<void> => {
  const users = await User.find({ roles: { $in: [3] }, isActive: true })
    .select('_id username name roles')
    .sort({ username: 1 });
  res.json(users);
};

export const getSales = async (_req: Request, res: Response): Promise<void> => {
  const users = await User.find({ roles: { $in: [2, 4] }, isActive: true })
    .select('_id username name roles')
    .sort({ username: 1 });
  res.json(users);
};
export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const users = await User.find().sort({ createdAt: -1 });
  res.json(users);
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(user);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const exists = await User.findOne({ username: req.body.username });
  if (exists) {
    res.status(409).json({ message: 'Username already exists' });
    return;
  }
  const user = await User.create(req.body);
  res.status(201).json({
    _id: user._id,
    username: user.username,
    name: user.name,
    roles: user.roles,
    isActive: user.isActive,
  });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const { password, ...rest } = req.body as { password?: string; [key: string]: unknown };
  const user = await User.findById(req.params.id).select('+password');
  if (!user) {
    res.status(404).json({ message: 'Not found' });
    return;
  }

  Object.assign(user, rest);
  if (password) user.password = password;
  await user.save();

  res.json({
    _id: user._id,
    username: user.username,
    name: user.name,
    roles: user.roles,
    isActive: user.isActive,
  });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json({ message: 'Deleted' });
};
