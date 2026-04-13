import mongoose, { Document, Schema } from 'mongoose';

export interface IPackage extends Document {
  name: string;
  pricePerMember: number;
  duration?: 'full_day' | 'half_day' | 'two_thirds_day';
  costume?: string;
  crewRatio?: string;
  editingScope?: 'full' | 'partial';
  deliveryDays?: number;
  studentsPerCrew?: number;
  description?: string;
}

const packageSchema = new Schema<IPackage>(
  {
    name: { type: String, required: true, trim: true },
    pricePerMember: { type: Number, required: true },
    duration: { type: String, enum: ['full_day', 'half_day', 'two_thirds_day'] },
    costume: { type: String, trim: true },
    crewRatio: { type: String, trim: true },
    editingScope: { type: String, enum: ['full', 'partial'], default: 'full' },
    deliveryDays: { type: Number },
    studentsPerCrew: { type: Number },
    description: { type: String, trim: true },
  },
  { timestamps: true },
);

export default mongoose.model<IPackage>('Package', packageSchema);
