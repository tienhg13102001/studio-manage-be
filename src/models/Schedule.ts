import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ISchedule extends Document {
  customer: Types.ObjectId;
  package?: Types.ObjectId;
  costumes: Types.ObjectId[];
  shootDate: Date;
  startTime?: string;
  endTime?: string;
  location?: string;
  leadPhotographer?: Types.ObjectId;
  supportPhotographers: Types.ObjectId[];
  bookedBy?: Types.ObjectId;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  notes?: string;
  season?: Types.ObjectId | null;
}

const scheduleSchema = new Schema<ISchedule>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    package: { type: Schema.Types.ObjectId, ref: 'Package', default: null },
    costumes: [{ type: Schema.Types.ObjectId, ref: 'Costume', default: [] }],
    shootDate: { type: Date, required: true },
    startTime: { type: String, trim: true },
    endTime: { type: String, trim: true },
    location: { type: String, trim: true },
    leadPhotographer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    supportPhotographers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    bookedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled'],
      default: 'pending',
    },
    notes: { type: String },
    season: { type: Schema.Types.ObjectId, ref: 'Season', default: null },
  },
  { timestamps: true },
);

scheduleSchema.index({ shootDate: 1 });
scheduleSchema.index({ customer: 1 });
scheduleSchema.index({ status: 1 });
scheduleSchema.index({ season: 1 });
scheduleSchema.index({ season: 1, shootDate: -1 });
scheduleSchema.index({ leadPhotographer: 1, shootDate: 1 });
scheduleSchema.index({ supportPhotographers: 1, shootDate: 1 });

export default mongoose.model<ISchedule>('Schedule', scheduleSchema);
