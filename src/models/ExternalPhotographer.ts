import mongoose, { Document, Schema } from 'mongoose';

/** Thợ cộng tác không có tài khoản đăng nhập hệ thống. */
export interface IExternalPhotographer extends Document {
  name: string;
  phone?: string;
  defaultFee?: number | null;
  notes?: string;
  isActive: boolean;
}

const externalPhotographerSchema = new Schema<IExternalPhotographer>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    defaultFee: { type: Number, min: 0, default: null },
    notes: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

externalPhotographerSchema.index({ name: 1 });

export default mongoose.model<IExternalPhotographer>(
  'ExternalPhotographer',
  externalPhotographerSchema,
);
