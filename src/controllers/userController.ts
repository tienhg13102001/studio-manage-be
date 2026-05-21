import { Request, Response } from 'express';
import User from '../models/User';
import { sendResponse } from '../utils/response';

export const getPhotographers = async (_req: Request, res: Response): Promise<void> => {
  const users = await User.find({ roles: { $in: [3] }, isActive: true })
    .select('_id username name roles')
    .sort({ username: 1 });
  sendResponse(res, 200, true, 'OK', users);
};

export const getSales = async (_req: Request, res: Response): Promise<void> => {
  const users = await User.find({ roles: { $in: [2, 4] }, isActive: true })
    .select('_id username name roles')
    .sort({ username: 1 });
  sendResponse(res, 200, true, 'OK', users);
};
export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const users = await User.find().sort({ createdAt: -1 }).lean();
  sendResponse(res, 200, true, 'OK', users);
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const user = await User.findById(req.params.id).lean();
  if (!user) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'OK', user);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const exists = await User.findOne({ username: req.body.username });
  if (exists) {
    sendResponse(res, 409, false, 'Username already exists');
    return;
  }
  const user = await User.create(req.body);
  sendResponse(res, 201, true, 'Tạo người dùng thành công', {
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
    sendResponse(res, 404, false, 'Not found');
    return;
  }

  Object.assign(user, rest);
  if (password) user.password = password;
  await user.save();

  sendResponse(res, 200, true, 'Cập nhật thành công', {
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
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Đã xóa người dùng');
};
