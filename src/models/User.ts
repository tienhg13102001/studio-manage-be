import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

// 0: Superadmin | 1: Admin | 2: Sale | 3: Thợ chụp ảnh | 4: Cộng tác viên sale
export type UserRole = 0 | 1 | 2 | 3 | 4;

export const ROLE_LABELS: Record<UserRole, string> = {
  0: 'Superadmin',
  1: 'Admin',
  2: 'Sale',
  3: 'Thợ chụp ảnh',
  4: 'Cộng tác viên sale',
};

export interface IUser extends Document {
  username: string;
  name?: string;
  password: string;
  roles: UserRole[];
  isActive: boolean;
  comparePassword(plain: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, trim: true },
    name: { type: String, trim: true },
    password: { type: String, required: true, select: false },
    roles: { type: [{ type: Number, enum: [0, 1, 2, 3, 4] }], default: [2] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSchema.pre<IUser>('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (plain: string): Promise<boolean> {
  return bcrypt.compare(plain, this.password);
};

export default mongoose.model<IUser>('User', userSchema);
