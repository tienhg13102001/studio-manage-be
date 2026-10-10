import mongoose, { Document, Schema, Types } from 'mongoose';

/** Kịch bản "Tính lãi gói" (Công cụ) — lưu đầu vào, kết quả tính lại ở frontend. */
export interface IProfitScenario extends Document {
  name: string;
  package?: Types.ObjectId | null;
  pricePerMember: number;
  students: number;
  crewCount: number;
  crewRate: number;
  /** Thợ quay MV (gói có hasMv). */
  videoCrewCount: number;
  videoCrewRate: number;
  /** Cũ (trước khi tách dòng) — chỉ đọc, kịch bản mới dùng printItems/costumeItems. */
  printCostPerStudent: number;
  costumeCost: number;
  printItems: ICostItem[];
  costumeItems: ICostItem[];
  travelItems: ICostItem[];
  otherCosts: { label: string; amount: number }[];
  createdBy?: Types.ObjectId | null;
}

/** Một dòng chi phí: đơn giá × số lượng (× sĩ số nếu /hs, × số người ekip nếu /người). */
export interface ICostItem {
  label: string;
  unitPrice: number;
  quantity: number;
  unit: 'student' | 'class' | 'crew';
}

const costItemSchema = new Schema<ICostItem>(
  {
    label: { type: String, trim: true, default: '' },
    unitPrice: { type: Number, min: 0, default: 0 },
    quantity: { type: Number, min: 0, default: 1 },
    unit: { type: String, enum: ['student', 'class', 'crew'], default: 'student' },
  },
  { _id: false },
);

const otherCostSchema = new Schema(
  {
    label: { type: String, trim: true, default: '' },
    amount: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const profitScenarioSchema = new Schema<IProfitScenario>(
  {
    name: { type: String, required: true, trim: true },
    package: { type: Schema.Types.ObjectId, ref: 'Package', default: null },
    pricePerMember: { type: Number, min: 0, default: 0 },
    students: { type: Number, min: 0, default: 0 },
    crewCount: { type: Number, min: 0, default: 0 },
    crewRate: { type: Number, min: 0, default: 0 },
    videoCrewCount: { type: Number, min: 0, default: 0 },
    videoCrewRate: { type: Number, min: 0, default: 0 },
    printCostPerStudent: { type: Number, min: 0, default: 0 },
    costumeCost: { type: Number, min: 0, default: 0 },
    printItems: { type: [costItemSchema], default: [] },
    costumeItems: { type: [costItemSchema], default: [] },
    travelItems: { type: [costItemSchema], default: [] },
    otherCosts: { type: [otherCostSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export default mongoose.model<IProfitScenario>('ProfitScenario', profitScenarioSchema);
