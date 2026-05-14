import type { Document } from "mongoose";
import mongoose from "mongoose";


export interface ISeason extends Document {
  name: string;
  startDate: Date;
  endDate: Date;
}

const seasonSchema = new mongoose.Schema<ISeason>(
  {
    name: { type: String, required: true, unique: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<ISeason>("Season", seasonSchema);