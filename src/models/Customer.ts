import mongoose, { Document, Schema, Types } from 'mongoose';
import { extraServiceSchema, type IExtraService } from './extraService';

// Quy trình chăm sóc lớp — thứ tự các bước chính; `lost` (Không chốt) là nhánh phụ
export const CUSTOMER_STATUS_ORDER = [
  'new',
  'contacting',
  'contacted',
  'deposited',
  'scheduled',
  'shot',
  'awaiting_print',
  'done',
] as const;

export const CUSTOMER_STATUSES = [...CUSTOMER_STATUS_ORDER, 'lost'] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  new: 'Chưa làm việc',
  contacting: 'Bắt đầu liên hệ',
  contacted: 'Đã liên hệ',
  deposited: 'Đã cọc',
  scheduled: 'Chưa chụp',
  shot: 'Đã chụp',
  awaiting_print: 'Chưa trả ảnh in',
  done: 'Hoàn thành',
  lost: 'Không chốt',
};

/** Hợp đồng của lớp (tạo qua Apps Script Code_create_HD.gs, lưu bằng PUT /customers/:id/contract). */
export interface ICustomerContract {
  /** Link Google Doc */
  url: string;
  /** Google Doc id — null với hợp đồng cũ (không cập nhật được ô tiền cọc). */
  docId?: string | null;
  /** Tổng thanh toán in trên hợp đồng (gói + dịch vụ thêm) — dùng tính Đợt 2. */
  total?: number | null;
  package?: Types.ObjectId | null;
  /** Giá / thành viên in trên hợp đồng (mặc định theo gói, có thể chỉnh). */
  pricePerMember?: number | null;
  shootDate?: Date | null;
  location?: string;
  extraServices?: IExtraService[];
  crewCount?: number | null;
  crewCountSystem?: number | null;
  /** Số thợ quay MV in trên hợp đồng (gói có MV) */
  videoCrewCount?: number | null;
  /** Tiền cọc đang in trên hợp đồng; null = để trống "………". */
  depositAmount?: number | null;
  /** Lần cuối ô tiền cọc được điền số tiền. */
  depositSyncedAt?: Date | null;
  /** Ngày cọc đang in trên hợp đồng; null = để trống. */
  depositDate?: Date | null;
  createdAt?: Date | null;
  createdBy?: Types.ObjectId | null;
  /** Lịch chụp nguồn khi được chuyển từ dữ liệu cũ (migration). */
  migratedFromSchedule?: Types.ObjectId | null;
}

const contractSchema = new Schema<ICustomerContract>(
  {
    url: { type: String, required: true, trim: true },
    docId: { type: String, default: null },
    total: { type: Number, default: null },
    package: { type: Schema.Types.ObjectId, ref: 'Package', default: null },
    pricePerMember: { type: Number, default: null },
    shootDate: { type: Date, default: null },
    location: { type: String, trim: true },
    extraServices: { type: [extraServiceSchema], default: [] },
    crewCount: { type: Number, default: null },
    crewCountSystem: { type: Number, default: null },
    videoCrewCount: { type: Number, default: null },
    depositAmount: { type: Number, default: null },
    depositSyncedAt: { type: Date, default: null },
    depositDate: { type: Date, default: null },
    createdAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    migratedFromSchedule: { type: Schema.Types.ObjectId, ref: 'Schedule', default: null },
  },
  { _id: false },
);

export interface ICustomer extends Document {
  className: string;
  schoolId?: Types.ObjectId | null;
  /** Sao lưu tên trường cũ (chuỗi) cho rollback migration — select: false */
  legacySchool?: string;
  contactName: string;
  contactPhone: string;
  contactAddress: string;
  total: number;
  totalMale: number;
  totalFemale: number;
  notes?: string;
  createdBy?: Types.ObjectId;
  season?: Types.ObjectId | null;
  status: CustomerStatus;
  assignedSale?: Types.ObjectId | null;
  source?: string;
  lostReason?: string;
  statusChangedAt?: Date;
  /** Ngày dự kiến chụp — sale nhập khi tạo/sửa lớp */
  expectedShootDate?: Date | null;
  deposit?: { amount: number; date: Date; transactionId?: Types.ObjectId };
  /** Hợp đồng của lớp — null khi chưa có. */
  contract?: ICustomerContract | null;
  /** Folder Drive ảnh của lớp (tạo qua Apps Script Code.gs). */
  driveFolderUrl?: string | null;
  driveFolderId?: string | null;
}

const customerSchema = new Schema<ICustomer>(
  {
    className: { type: String, required: true, trim: true },
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', default: null, index: true },
    // Tên trường dạng chuỗi trước khi chuyển sang schoolId — chỉ để rollback migration, không trả về API
    legacySchool: { type: String, select: false },
    contactName: { type: String, required: true, trim: true },
    contactPhone: { type: String, required: true, trim: true },
    contactAddress: { type: String, required: true, trim: true },
    total: { type: Number, required: true, default: 0 },
    totalMale: { type: Number, required: true, default: 0 },
    totalFemale: { type: Number, required: true, default: 0 },
    notes: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    season: { type: Schema.Types.ObjectId, ref: 'Season', default: null },
    status: { type: String, enum: CUSTOMER_STATUSES, default: 'new', index: true },
    assignedSale: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    source: { type: String, trim: true },
    lostReason: { type: String, trim: true },
    statusChangedAt: { type: Date },
    expectedShootDate: { type: Date },
    deposit: {
      type: new Schema(
        {
          amount: Number,
          date: Date,
          // Giao dịch thu tiền cọc đã tạo → chốt cọc lại thì cập nhật, không tạo trùng
          transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
        },
        { _id: false },
      ),
      default: undefined,
    },
    contract: { type: contractSchema, default: null },
    driveFolderUrl: { type: String, default: null },
    driveFolderId: { type: String, default: null },
  },
  { timestamps: true },
);

customerSchema.index({ season: 1, createdAt: -1 });
customerSchema.index({ createdBy: 1, createdAt: -1 });
customerSchema.index({ status: 1, season: 1 });

export default mongoose.model<ICustomer>('Customer', customerSchema);
