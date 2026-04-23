import mongoose, { Document, Schema } from 'mongoose';

export interface ICostumeType extends Document {
  name: string;
  description?: string;
}

const costumeTypeSchema = new Schema<ICostumeType>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
  },
  { timestamps: true },
);

export default mongoose.model<ICostumeType>('CostumeType', costumeTypeSchema);
