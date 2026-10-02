import { Request, Response } from 'express';
import Feedback from '../models/Feedback';
import type { FeedbackResponse, FeedbackStats } from '../types/dto';
import { sendResponse } from '../utils/response';

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const { page = '1', limit = '20', isRead } = req.query as Record<string, string>;
  const query: Record<string, unknown> = {};
  if (isRead === 'true') query.isRead = true;
  else if (isRead === 'false') query.isRead = false;

  const skip = (Number(page) - 1) * Number(limit);
  const [data, total, totalUnread, [agg]] = await Promise.all([
    Feedback.find(query)
      .populate({ path: 'customer', populate: { path: 'schoolId', select: 'name address' } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean<FeedbackResponse[]>(),
    Feedback.countDocuments({}),
    Feedback.countDocuments({ isRead: false }),
    Feedback.aggregate<{
      totals: { count: number; crewAvg: number; albumAvg: number }[];
      crew: { _id: number; n: number }[];
      album: { _id: number; n: number }[];
    }>([
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                crewAvg: { $avg: '$crewFeedback.rating' },
                albumAvg: { $avg: '$albumFeedback.rating' },
              },
            },
          ],
          crew: [{ $group: { _id: '$crewFeedback.rating', n: { $sum: 1 } } }],
          album: [{ $group: { _id: '$albumFeedback.rating', n: { $sum: 1 } } }],
        },
      },
    ]),
  ]);
  const totalRead = total - totalUnread;
  const toDist = (rows: { _id: number; n: number }[]) =>
    [1, 2, 3, 4, 5].map((star) => rows.find((r) => r._id === star)?.n ?? 0);
  // Round half-up to 1 decimal so the shown number and stars agree.
  const round1 = (n = 0) => Math.round(n * 10) / 10;
  const stats: FeedbackStats = {
    count: agg.totals[0]?.count ?? 0,
    crewAvg: round1(agg.totals[0]?.crewAvg),
    albumAvg: round1(agg.totals[0]?.albumAvg),
    crewDist: toDist(agg.crew),
    albumDist: toDist(agg.album),
  };
  sendResponse(res, 200, true, 'OK', data, {
    total,
    totalRead,
    totalUnread,
    page: Number(page),
    limit: Number(limit),
    stats,
  });
};

export const markRead = async (req: Request, res: Response): Promise<void> => {
  const feedback = await Feedback.findByIdAndUpdate(
    req.params.id,
    { isRead: req.body?.isRead ?? true },
    { new: true },
  );
  if (!feedback) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Cập nhật thành công', feedback);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const feedback = await Feedback.findByIdAndDelete(req.params.id);
  if (!feedback) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Đã xóa feedback');
};

// Public: submit feedback
export const submit = async (req: Request, res: Response): Promise<void> => {
  const { customer, phone, crewFeedback, albumFeedback, content, suggestion } = req.body;

  const crewRating = Number(crewFeedback?.rating);
  const albumRating = Number(albumFeedback?.rating);

  if (!crewRating || !albumRating) {
    sendResponse(res, 400, false, 'crewFeedback.rating và albumFeedback.rating là bắt buộc');
    return;
  }
  if (crewRating < 1 || crewRating > 5 || albumRating < 1 || albumRating > 5) {
    sendResponse(res, 400, false, 'Đánh giá phải từ 1 đến 5');
    return;
  }
  if (!crewFeedback?.description?.trim() || !albumFeedback?.description?.trim()) {
    sendResponse(res, 400, false, 'Vui lòng chia sẻ thêm về ekip và album');
    return;
  }

  const feedback = await Feedback.create({
    customer: customer || undefined,
    phone,
    crewFeedback: {
      rating: crewRating,
      description: crewFeedback.description.trim(),
    },
    albumFeedback: {
      rating: albumRating,
      description: albumFeedback.description.trim(),
    },
    content,
    suggestion,
  });
  sendResponse(res, 201, true, 'Gửi đánh giá thành công', { _id: feedback._id });
};
