import mongoose, { Document, Schema } from 'mongoose';

export interface ICustomer extends Document {
  className: string;
  school?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  studentCount: number;
  notes?: string;
}

const customerSchema = new Schema<ICustomer>(
  {
    className: { type: String, required: true, trim: true },
    school: { type: String, trim: true },
    contactName: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },
    studentCount: { type: Number, default: 0 },
    notes: { type: String },
  },
  { timestamps: true },
);

customerSchema.index({ className: 'text', school: 'text' });

export default mongoose.model<ICustomer>('Customer', customerSchema);
