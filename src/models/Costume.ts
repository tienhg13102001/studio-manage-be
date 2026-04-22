import mongoose, { Document, Schema } from 'mongoose';

export interface ICostume extends Document {
  name: string;
  description?: string;
  gender: 'male' | 'female' | 'unisex';
}

const costumeSchema = new Schema<ICostume>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    gender: {
      type: String,
      enum: ['male', 'female', 'unisex'],
      default: 'unisex',
      required: true,
    },
  },
  { timestamps: true },
);

export default mongoose.model<ICostume>('Costume', costumeSchema);
