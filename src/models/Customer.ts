import mongoose, { Document, Schema, Types } from 'mongoose';

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
  deposit?: { amount: number; date: Date; transactionId?: Types.ObjectId };
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
  },
  { timestamps: true },
);

customerSchema.index({ season: 1, createdAt: -1 });
customerSchema.index({ createdBy: 1, createdAt: -1 });
customerSchema.index({ status: 1, season: 1 });

export default mongoose.model<ICustomer>('Customer', customerSchema);
