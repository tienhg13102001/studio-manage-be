import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IExtraService {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  note?: string;
}

const extraServiceSchema = new Schema<IExtraService>(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    amount: { type: Number, required: true },
    note: { type: String },
  },
  { _id: false },
);

/**
 * Lịch chụp chỉ còn cờ huỷ: `active` (đang áp dụng) hoặc `cancelled` (đã huỷ).
 * Tiến độ của lớp nằm ở `Customer.status`. Dữ liệu cũ (pending/confirmed/completed)
 * được chuẩn hoá về `active` lúc khởi động (utils/normalizeScheduleStatus.ts).
 */
export const SCHEDULE_STATUSES = ['active', 'cancelled'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

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
  status: ScheduleStatus;
  notes?: string;
  season?: Types.ObjectId | null;
  contractUrl?: string;
  driveFolderUrl?: string;
  driveFolderId?: string;
  extraServices?: IExtraService[];
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
      enum: SCHEDULE_STATUSES,
      default: 'active',
    },
    notes: { type: String },
    season: { type: Schema.Types.ObjectId, ref: 'Season', default: null },
    contractUrl: { type: String },
    driveFolderUrl: { type: String },
    driveFolderId: { type: String },
    extraServices: { type: [extraServiceSchema], default: [] },
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
