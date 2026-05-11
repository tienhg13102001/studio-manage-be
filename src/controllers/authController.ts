import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import jwt from 'jsonwebtoken';
import User from '../models/User';

const signToken = (id: string): string =>
  jwt.sign({ id }, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  });

export const login = async (req: Request, res: Response): Promise<void> => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() });
    return;
  }

  const { username, password } = req.body as { username: string; password: string };
  const user = await User.findOne({ username }).select('+password');
  if (!user || !user.isActive) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const match = await user.comparePassword(password);
  if (!match) {
    res.status(401).json({ message: 'Invalid credentials' });
    return;
  }

  const token = signToken(user._id.toString());
  res.json({
    token,
    user: { _id: user._id, username: user.username, name: user.name, roles: user.roles },
  });
};

export const getMe = (req: Request, res: Response): void => {
  res.json({ user: req.user });
};

export const refresh = (req: Request, res: Response): void => {
  const token = signToken(req.user!._id.toString());
  res.json({
    token,
    user: req.user,
  });
};
export const changePassword = async (req: Request, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  if (!currentPassword || !newPassword || newPassword.length < 6) {
    res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    return;
  }

  const user = await User.findById(req.user!._id).select('+password');
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  const match = await user.comparePassword(currentPassword);
  if (!match) {
    res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
    return;
  }

  user.password = newPassword;
  await user.save();

  res.json({ message: 'Đổi mật khẩu thành công' });
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  const { name } = req.body as { name?: string };
  const user = await User.findByIdAndUpdate(
    req.user!._id,
    { name },
    { new: true, runValidators: true },
  ).select('-password');
  res.json(user);
};
