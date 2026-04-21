import { Request, Response } from 'express';
import Feedback from '../models/Feedback';

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const { page = '1', limit = '20', isRead } = req.query as Record<string, string>;
  const query: Record<string, unknown> = {};
  if (isRead === 'true') query.isRead = true;
  else if (isRead === 'false') query.isRead = false;

  const skip = (Number(page) - 1) * Number(limit);
  const [data, total, unreadCount] = await Promise.all([
    Feedback.find(query)
      .populate('customerId', 'className school')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Feedback.countDocuments(query),
    Feedback.countDocuments({ isRead: false }),
  ]);
  res.json({ data, total, page: Number(page), limit: Number(limit), unreadCount });
};

export const markRead = async (req: Request, res: Response): Promise<void> => {
  const feedback = await Feedback.findByIdAndUpdate(
    req.params.id,
    { isRead: req.body?.isRead ?? true },
    { new: true },
  );
  if (!feedback) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(feedback);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const feedback = await Feedback.findByIdAndDelete(req.params.id);
  if (!feedback) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json({ message: 'Deleted' });
};

// Public: submit feedback
export const submit = async (req: Request, res: Response): Promise<void> => {
  const { customerId, phone, crewFeedback, albumFeedback, content, suggestion } = req.body;

  const crewRating = Number(crewFeedback?.rating);
  const albumRating = Number(albumFeedback?.rating);

  if (!crewRating || !albumRating) {
    res.status(400).json({ message: 'crewFeedback.rating và albumFeedback.rating là bắt buộc' });
    return;
  }
  if (crewRating < 1 || crewRating > 5 || albumRating < 1 || albumRating > 5) {
    res.status(400).json({ message: 'Đánh giá phải từ 1 đến 5' });
    return;
  }

  const feedback = await Feedback.create({
    customerId: customerId || undefined,
    phone,
    crewFeedback: {
      rating: crewRating,
      description: crewFeedback?.description,
    },
    albumFeedback: {
      rating: albumRating,
      description: albumFeedback?.description,
    },
    content,
    suggestion,
  });
  res.status(201).json({ _id: feedback._id });
};
