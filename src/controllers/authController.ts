import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { sendResponse } from '../utils/response';

const signToken = (id: string): string =>
  jwt.sign({ id }, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  });

export const login = async (req: Request, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    sendResponse(res, 400, false, 'Validation failed', errors.array());
    return;
  }

  const { username, password } = req.body as { username: string; password: string };
  const user = await User.findOne({ username }).select('+password');
  if (!user || !user.isActive) {
    sendResponse(res, 401, false, 'Invalid credentials');
    return;
  }

  const match = await user.comparePassword(password);
  if (!match) {
    sendResponse(res, 401, false, 'Invalid credentials');
    return;
  }

  const token = signToken(user._id.toString());
  sendResponse(res, 200, true, 'Login successful', {
    token,
    user: { _id: user._id, username: user.username, name: user.name, roles: user.roles },
  });
};

export const getMe = (req: Request, res: Response): void => {
  sendResponse(res, 200, true, 'OK', { user: req.user });
};

export const refresh = (req: Request, res: Response): void => {
  const token = signToken(req.user!._id.toString());
  sendResponse(res, 200, true, 'OK', { token, user: req.user });
};
export const changePassword = async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  if (!currentPassword || !newPassword || newPassword.length < 6) {
    sendResponse(res, 400, false, 'Mật khẩu mới phải có ít nhất 6 ký tự');
    return;
  }

  const user = await User.findById(req.user!._id).select('+password');
  if (!user) {
    sendResponse(res, 404, false, 'User not found');
    return;
  }

  const match = await user.comparePassword(currentPassword);
  if (!match) {
    sendResponse(res, 400, false, 'Mật khẩu hiện tại không đúng');
    return;
  }

  user.password = newPassword;
  await user.save();

  sendResponse(res, 200, true, 'Đổi mật khẩu thành công');
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  const { name } = req.body as { name?: string };
  const user = await User.findByIdAndUpdate(
    req.user!._id,
    { name },
    { new: true, runValidators: true },
  ).select('-password');
  sendResponse(res, 200, true, 'Cập nhật thành công', user);
};
