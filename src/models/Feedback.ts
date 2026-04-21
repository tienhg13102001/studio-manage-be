import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IFeedbackItem {
  rating: number;
  description?: string;
}

export interface IFeedback extends Document {
  customerId?: Types.ObjectId;
  phone?: string;
  crewFeedback: IFeedbackItem;
  albumFeedback: IFeedbackItem;
  content?: string;
  suggestion?: string;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const feedbackItemSchema = new Schema<IFeedbackItem>(
  {
    rating: { type: Number, min: 1, max: 5, required: true },
    description: { type: String, trim: true },
  },
  { _id: false },
);

const feedbackSchema = new Schema<IFeedback>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    phone: { type: String, trim: true },
    crewFeedback: { type: feedbackItemSchema, required: true },
    albumFeedback: { type: feedbackItemSchema, required: true },
    content: { type: String, trim: true },
    suggestion: { type: String, trim: true },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

feedbackSchema.index({ createdAt: -1 });
feedbackSchema.index({ isRead: 1 });

export default mongoose.model<IFeedback>('Feedback', feedbackSchema);
