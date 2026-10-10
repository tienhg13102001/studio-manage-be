import mongoose, { Document, Schema, Types } from 'mongoose';

/** Kịch bản "Tính lãi gói" (Công cụ) — lưu đầu vào, kết quả tính lại ở frontend. */
export interface IProfitScenario extends Document {
  name: string;
  package?: Types.ObjectId | null;
  pricePerMember: number;
  students: number;
  crewCount: number;
  crewRate: number;
  printCostPerStudent: number;
  costumeCost: number;
  otherCosts: { label: string; amount: number }[];
  createdBy?: Types.ObjectId | null;
}

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
    printCostPerStudent: { type: Number, min: 0, default: 0 },
    costumeCost: { type: Number, min: 0, default: 0 },
    otherCosts: { type: [otherCostSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export default mongoose.model<IProfitScenario>('ProfitScenario', profitScenarioSchema);
