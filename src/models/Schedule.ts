import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISchedule extends Document {
  customerId: Types.ObjectId;
  shootDate: Date;
  startTime?: string;
  endTime?: string;
  location?: string;
  leadPhotographer?: Types.ObjectId;
  supportPhotographers: Types.ObjectId[];
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  notes?: string;
}

const scheduleSchema = new Schema<ISchedule>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    shootDate: { type: Date, required: true },
    startTime: { type: String, trim: true },
    endTime: { type: String, trim: true },
    location: { type: String, trim: true },
    leadPhotographer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    supportPhotographers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled'],
      default: 'pending',
    },
    notes: { type: String },
  },
  { timestamps: true },
);

scheduleSchema.index({ shootDate: 1 });
scheduleSchema.index({ customerId: 1 });
scheduleSchema.index({ status: 1 });

export default mongoose.model<ISchedule>('Schedule', scheduleSchema);
