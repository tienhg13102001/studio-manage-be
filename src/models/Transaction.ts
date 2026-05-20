import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ITransaction extends Document {
  customer?: Types.ObjectId | null;
  type: 'income' | 'expense';
  amount: number;
  categoryId: Types.ObjectId;
  description?: string;
  date: Date;
  createdBy?: Types.ObjectId;
  accountantRefunded: boolean;
  season?: Types.ObjectId | null;
}

const transactionSchema = new Schema<ITransaction>(
  {
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    type: { type: String, enum: ['income', 'expense'], required: true },
    amount: { type: Number, required: true, min: 0 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    description: { type: String, trim: true },
    date: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    accountantRefunded: { type: Boolean, default: false },
    season: { type: Schema.Types.ObjectId, ref: 'Season', default: null },
  },
  { timestamps: true },
);

transactionSchema.index({ date: 1 });
transactionSchema.index({ customer: 1 });
transactionSchema.index({ type: 1 });

export default mongoose.model<ITransaction>('Transaction', transactionSchema);
