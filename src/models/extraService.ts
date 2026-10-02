import { Schema } from 'mongoose';

/** Dịch vụ sử dụng thêm — dùng chung cho lịch chụp (Schedule) và hợp đồng của lớp (Customer). */
export interface IExtraService {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  note?: string;
}

export const extraServiceSchema = new Schema<IExtraService>(
  {
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    amount: { type: Number, required: true },
    note: { type: String },
  },
  { _id: false },
);
