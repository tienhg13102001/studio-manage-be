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
