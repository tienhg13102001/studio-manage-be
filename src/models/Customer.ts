import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICustomer extends Document {
  className: string;
  school?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  studentCount: number;
  notes?: string;
  createdBy?: Types.ObjectId;
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
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

customerSchema.index({ className: 'text', school: 'text' });

export default mongoose.model<ICustomer>('Customer', customerSchema);
