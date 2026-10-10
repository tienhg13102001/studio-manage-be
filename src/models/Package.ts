import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IPackage extends Document {
  name: string;
  pricePerMember: number;
  duration?: 'full_day' | 'half_day' | 'two_thirds_day';
  costumes?: Types.ObjectId[];
  crewRatio?: string;
  editingScope?: 'full' | 'partial';
  deliveryDays?: number;
  studentsPerCrew?: number;
  /** Gói có quay MV kỷ yếu (vd: Vip 2, Luxury) → mỗi lịch cần đúng 1 thợ quay */
  hasMv?: boolean;
  description?: string;
  isPopular?: boolean;
}

const packageSchema = new Schema<IPackage>(
  {
    name: { type: String, required: true, trim: true },
    pricePerMember: { type: Number, required: true },
    duration: { type: String, enum: ['full_day', 'half_day', 'two_thirds_day'] },
    costumes: [{ type: Schema.Types.ObjectId, ref: 'CostumeType' }],
    crewRatio: { type: String, trim: true },
    editingScope: { type: String, enum: ['full', 'partial'], default: 'full' },
    deliveryDays: { type: Number },
    studentsPerCrew: { type: Number },
    hasMv: { type: Boolean, default: false },
    description: { type: String, trim: true },
    isPopular: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default mongoose.model<IPackage>('Package', packageSchema);
