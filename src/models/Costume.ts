import mongoose, { Document, Schema } from 'mongoose';

export interface ICostume extends Document {
  name: string;
  description?: string;
}

const costumeSchema = new Schema<ICostume>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
  },
  { timestamps: true },
);

export default mongoose.model<ICostume>('Costume', costumeSchema);
