import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ITransaction extends Document {
  customerId?: Types.ObjectId | null;
  type: 'income' | 'expense';
  amount: number;
  categoryId: Types.ObjectId;
  description?: string;
  date: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    type: { type: String, enum: ['income', 'expense'], required: true },
    amount: { type: Number, required: true, min: 0 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    description: { type: String, trim: true },
    date: { type: Date, required: true },
  },
  { timestamps: true },
);

transactionSchema.index({ date: 1 });
transactionSchema.index({ customerId: 1 });
transactionSchema.index({ type: 1 });

export default mongoose.model<ITransaction>('Transaction', transactionSchema);
