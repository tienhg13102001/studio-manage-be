import mongoose, { Document, Schema, Types } from 'mongoose';
import { extraServiceSchema, type IExtraService } from './extraService';

export type { IExtraService };

/**
 * Lịch chụp chỉ còn cờ huỷ: `active` (đang áp dụng) hoặc `cancelled` (đã huỷ).
 * Tiến độ của lớp nằm ở `Customer.status`. Dữ liệu cũ (pending/confirmed/completed)
 * được chuẩn hoá về `active` lúc khởi động (utils/normalizeScheduleStatus.ts).
 */
export const SCHEDULE_STATUSES = ['active', 'cancelled'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const EXTERNAL_CREW_CONFIRMATIONS = ['pending', 'confirmed', 'declined'] as const;
export type ExternalCrewConfirmation = (typeof EXTERNAL_CREW_CONFIRMATIONS)[number];
/** `video` = thợ quay MV (gói có MV), không tính vào luật một thợ chính. */
export const EXTERNAL_CREW_ROLES = ['lead', 'support', 'video'] as const;
export type ExternalCrewRole = (typeof EXTERNAL_CREW_ROLES)[number];
export interface IExternalCrewAssignment {
  photographer: Types.ObjectId;
  role: ExternalCrewRole;
  confirmation: ExternalCrewConfirmation;
}

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
  /** Thợ quay MV nội bộ (role 6). Mỗi lịch tối đa 1 thợ quay: nội bộ HOẶC thợ ngoài role 'video'. */
  videographer?: Types.ObjectId | null;
  externalCrew: IExternalCrewAssignment[];
  bookedBy?: Types.ObjectId;
  status: ScheduleStatus;
  notes?: string;
  season?: Types.ObjectId | null;
  /**
   * @deprecated Hợp đồng + folder Drive đã chuyển sang lớp (`Customer.contract`,
   * `Customer.driveFolderUrl/Id`) — utils/migrateContractsToCustomer.ts. Giữ lại field cũ (chỉ đọc,
   * không ghi nữa) để có thể rollback.
   */
  contractUrl?: string;
  /** @deprecated xem `contractUrl` */
  contractDocId?: string | null;
  /** @deprecated xem `contractUrl` */
  contractTotal?: number | null;
  /** @deprecated xem `contractUrl` */
  contractDepositAmount?: number | null;
  /** @deprecated xem `contractUrl` */
  contractDepositSyncedAt?: Date | null;
  /** @deprecated xem `contractUrl` */
  driveFolderUrl?: string;
  /** @deprecated xem `contractUrl` */
  driveFolderId?: string;
  extraServices?: IExtraService[];
}

const externalCrewSchema = new Schema<IExternalCrewAssignment>(
  {
    photographer: { type: Schema.Types.ObjectId, ref: 'ExternalPhotographer', required: true },
    role: { type: String, enum: EXTERNAL_CREW_ROLES, required: true },
    confirmation: { type: String, enum: EXTERNAL_CREW_CONFIRMATIONS, default: 'pending' },
  },
  { _id: false },
);

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
    videographer: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    externalCrew: { type: [externalCrewSchema], default: [] },
    bookedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: SCHEDULE_STATUSES,
      default: 'active',
    },
    notes: { type: String },
    season: { type: Schema.Types.ObjectId, ref: 'Season', default: null },
    // Legacy (chỉ đọc) — hợp đồng/folder Drive giờ nằm trên Customer
    contractUrl: { type: String },
    contractDocId: { type: String },
    contractTotal: { type: Number },
    contractDepositAmount: { type: Number },
    contractDepositSyncedAt: { type: Date },
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
scheduleSchema.index({ videographer: 1, shootDate: 1 });
scheduleSchema.index({ 'externalCrew.photographer': 1, shootDate: 1 });

export default mongoose.model<ISchedule>('Schedule', scheduleSchema);
