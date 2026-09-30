import mongoose, { Document, Schema, Types } from 'mongoose';

// Lịch sử chăm sóc lớp: đổi trạng thái, ghi chú, sự kiện hệ thống (vd: tạo hợp đồng)
export type CustomerActivityKind = 'status' | 'note' | 'system';

export interface ICustomerActivity extends Document {
  customer: Types.ObjectId;
  kind: CustomerActivityKind;
  fromStatus?: string;
  toStatus?: string;
  note: string;
  createdBy?: Types.ObjectId;
}

const customerActivitySchema = new Schema<ICustomerActivity>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    kind: { type: String, enum: ['status', 'note', 'system'], required: true },
    fromStatus: { type: String },
    toStatus: { type: String },
    note: { type: String, required: true, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

customerActivitySchema.index({ customer: 1, createdAt: -1 });

export default mongoose.model<ICustomerActivity>('CustomerActivity', customerActivitySchema);
