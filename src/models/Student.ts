import mongoose, { Document, Schema } from 'mongoose';

export interface IStudent extends Document {
  customerId: mongoose.Types.ObjectId;
  name: string;
  gender: 'male' | 'female';
  height?: number;
  weight?: number;
  notes?: string;
}

const studentSchema = new Schema<IStudent>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    name: { type: String, required: true, trim: true },
    gender: { type: String, enum: ['male', 'female'], required: true },
    height: { type: Number },
    weight: { type: Number },
    notes: { type: String },
  },
  { timestamps: true },
);

studentSchema.index({ customerId: 1 });
studentSchema.index({ name: 'text' });

export default mongoose.model<IStudent>('Student', studentSchema);
