import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction';
import Season from '../models/Season';
import type { TransactionResponse, TransactionSummaryRow } from '../types/dto';
import { notifyByRoles } from '../services/telegramService';
import { resolveSeasonForDate } from '../utils/seasonCache';
import { sendResponse } from '../utils/response';

const isPrivileged = (roles: number[]): boolean => roles.some((r) => r === 0 || r === 1 || r === 5);
/** Chỉ Kế toán (5) được đánh dấu / bỏ đánh dấu "KT đã hoàn tiền" (giống UI). */
const canRefund = (roles: number[]): boolean => roles.includes(5);

/** Người không có quyền xem tất cả chỉ được đọc / sửa / xoá giao dịch của chính mình. */
const ownScope = (req: Request): Record<string, unknown> =>
  isPrivileged(req.user!.roles) ? {} : { createdBy: req.user!._id };

/** Bỏ các field hoàn tiền khỏi body nếu người dùng không phải Kế toán. */
const stripRefundFields = (req: Request, body: Record<string, unknown>) => {
  if (!canRefund(req.user!.roles)) delete body.accountantRefunded;
};

interface TransactionQuery {
  customer?: string;
  type?: string;
  categoryId?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  limit?: string;
  season?: string;
  /** Tìm theo mô tả (không phân biệt hoa thường). */
  search?: string;
  /** Trạng thái kế toán hoàn tiền của khoản chi: `done` | `pending`. */
  refund?: string;
  sort?: string;
}

const TYPES = ['income', 'expense'];
const REFUNDS = ['done', 'pending'];
const SORTS = ['date_asc', 'date_desc'];
const MAX_LIMIT = 500;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isDateStr = (v: string) => !Number.isNaN(new Date(v).getTime());
const isPositiveInt = (v: string) => /^\d+$/.test(v) && Number(v) > 0;

/** Trả về thông báo lỗi nếu query không hợp lệ, ngược lại `null`. */
const validateQuery = (q: Record<string, unknown>): string | null => {
  const str = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined);
  for (const k of [
    'customer',
    'type',
    'categoryId',
    'createdBy',
    'dateFrom',
    'dateTo',
    'page',
    'limit',
    'season',
    'search',
    'refund',
    'sort',
  ]) {
    if (q[k] !== undefined && typeof q[k] !== 'string') return `${k} không hợp lệ`;
  }
  for (const k of ['customer', 'categoryId', 'createdBy', 'season']) {
    const v = str(k);
    if (v && !mongoose.isValidObjectId(v)) return `${k} không hợp lệ`;
  }
  for (const k of ['dateFrom', 'dateTo']) {
    const v = str(k);
    if (v && !isDateStr(v)) return `${k} không hợp lệ`;
  }
  const type = str('type');
  if (type && !TYPES.includes(type)) return 'type không hợp lệ';
  const refund = str('refund');
  if (refund && !REFUNDS.includes(refund)) return 'refund không hợp lệ';
  const sort = str('sort');
  if (sort && !SORTS.includes(sort)) return 'sort không hợp lệ';
  const page = str('page');
  if (page && !isPositiveInt(page)) return 'page không hợp lệ';
  const limit = str('limit');
  if (limit && (!isPositiveInt(limit) || Number(limit) > MAX_LIMIT)) return 'limit không hợp lệ';
  if ((str('search') ?? '').length > 200) return 'search quá dài';
  return null;
};

const oid = (v: string) => new mongoose.Types.ObjectId(v);

/** Bộ lọc dùng được cho cả `find` lẫn `aggregate` (id đã ép kiểu ObjectId). */
const buildFilter = (q: TransactionQuery) => {
  const filter: Record<string, unknown> = {};
  if (q.customer) filter.customer = oid(q.customer);
  if (q.type) filter.type = q.type;
  if (q.categoryId) filter.categoryId = oid(q.categoryId);
  if (q.createdBy) filter.createdBy = oid(q.createdBy);
  if (q.dateFrom || q.dateTo) {
    const dateRange: Record<string, Date> = {};
    if (q.dateFrom) dateRange.$gte = new Date(q.dateFrom);
    if (q.dateTo) dateRange.$lte = new Date(q.dateTo);
    filter.date = dateRange;
  }
  const search = q.search?.trim();
  if (search) filter.description = { $regex: escapeRegex(search), $options: 'i' };
  if (q.refund) {
    // Chỉ khoản chi mới có trạng thái hoàn tiền; lọc kèm Thu → không có kết quả
    filter.type = q.type && q.type !== 'expense' ? { $in: [] } : 'expense';
    filter.accountantRefunded = q.refund === 'done' ? true : { $ne: true };
  }
  return filter;
};

/** Khoảng ngày [đầu ngày bắt đầu, cuối ngày kết thúc] của mùa; null nếu không có mùa. */
const seasonDateRange = async (season: string): Promise<{ $gte: Date; $lte: Date } | null> => {
  if (!mongoose.isValidObjectId(season)) return null;
  const seasonDoc = await Season.findById(season).select('startDate endDate').lean();
  if (!seasonDoc) return null;
  const start = new Date(seasonDoc.startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(seasonDoc.endDate);
  end.setHours(23, 59, 59, 999);
  return { $gte: start, $lte: end };
};

/** Tổng thu / chi / chi chưa hoàn của toàn bộ tập đã lọc. */
const filteredTotals = async (match: Record<string, unknown>) => {
  const rows = await Transaction.aggregate<{
    _id: 'income' | 'expense';
    amount: number;
    count: number;
    pendingRefund: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: '$type',
        amount: { $sum: '$amount' },
        count: { $sum: 1 },
        pendingRefund: {
          $sum: {
            $cond: [{ $ne: ['$accountantRefunded', true] }, '$amount', 0],
          },
        },
      },
    },
  ]);
  const by = (t: string) => rows.find((r) => r._id === t);
  return {
    income: by('income')?.amount ?? 0,
    expense: by('expense')?.amount ?? 0,
    pendingRefund: by('expense')?.pendingRefund ?? 0,
    incomeCount: by('income')?.count ?? 0,
    expenseCount: by('expense')?.count ?? 0,
  };
};

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const invalid = validateQuery(req.query);
  if (invalid) {
    sendResponse(res, 400, false, invalid);
    return;
  }
  const { page = '1', limit = '20', season, sort, ...rest } = req.query as TransactionQuery;
  const filter = buildFilter(rest);
  if (!isPrivileged(req.user!.roles)) {
    filter.createdBy = req.user!._id;
  }
  // When a season is selected and the user hasn't specified an explicit date range,
  // use the season's date range so overhead transactions (without a customer) are included.
  if (season && !rest.dateFrom && !rest.dateTo) {
    const range = await seasonDateRange(season);
    if (range) filter.date = range;
  }
  const skip = (Number(page) - 1) * Number(limit);
  const dir = sort === 'date_asc' ? 1 : -1;
  const USER_FIELDS = '_id username name roles isActive createdAt';
  const CUSTOMER_FIELDS =
    '_id className schoolId contactName contactPhone contactAddress total totalMale totalFemale notes createdAt';
  const [data, total, totals] = await Promise.all([
    Transaction.find(filter)
      .populate({
        path: 'customer',
        select: CUSTOMER_FIELDS,
        populate: { path: 'schoolId', select: 'name address' },
      })
      .populate('categoryId')
      .populate('createdBy', USER_FIELDS)
      .sort({ date: dir, _id: dir })
      .skip(skip)
      .limit(Number(limit))
      .lean<TransactionResponse[]>(),
    Transaction.countDocuments(filter),
    filteredTotals(filter),
  ]);
  sendResponse(res, 200, true, 'OK', data, {
    total,
    page: Number(page),
    limit: Number(limit),
    totals,
  });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const tx = await Transaction.findOne({ _id: req.params.id, ...ownScope(req) })
    .populate({ path: 'customer', populate: { path: 'schoolId', select: 'name address' } })
    .populate('categoryId')
    .populate('createdBy')
    .lean<TransactionResponse | null>();
  if (!tx) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'OK', tx);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const createdBy =
    isPrivileged(req.user!.roles) && req.body.createdBy ? req.body.createdBy : req.user!._id;
  const payload = { ...req.body, createdBy };
  stripRefundFields(req, payload);
  if (!payload.season) {
    payload.season = await resolveSeasonForDate(payload.date);
  }
  const tx = await Transaction.create(payload);
  sendResponse(res, 201, true, 'Tạo giao dịch thành công', tx);

  // Fire-and-forget: thông báo admin/kế toán khi có giao dịch mới
  void (async () => {
    try {
      const typeLabel = tx.type === 'income' ? '💰 Thu' : '💸 Chi';
      const amount = tx.amount?.toLocaleString('vi-VN') ?? '0';
      const creatorName = req.user!.name ?? req.user!.username;
      const text =
        `🔔 <b>Giao dịch mới</b>\n` +
        `${typeLabel}: <b>${amount} đ</b>\n` +
        `Người tạo: ${creatorName}${tx.description ? `\nMô tả: ${tx.description}` : ''}`;
      // Thông báo cho Superadmin (0), Admin (1), Kế toán (5)
      await notifyByRoles([0, 1, 5], text);
    } catch (e) {
      console.error('[Telegram] transaction notification failed:', e);
    }
  })();
};

export const update = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const updateData = { ...req.body };
  if (!isPrivileged(req.user!.roles)) {
    delete updateData.createdBy;
  }
  stripRefundFields(req, updateData);
  // Nếu đổi ngày mà client không gửi season, tự tính lại
  if (updateData.date && !updateData.season) {
    updateData.season = await resolveSeasonForDate(updateData.date);
  }
  const tx = await Transaction.findOneAndUpdate(
    { _id: req.params.id, ...ownScope(req) },
    updateData,
    {
      new: true,
      runValidators: true,
    },
  );
  if (!tx) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Cập nhật thành công', tx);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const tx = await Transaction.findOneAndDelete({ _id: req.params.id, ...ownScope(req) });
  if (!tx) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Đã xóa giao dịch');
};

export const getSummary = async (req: Request, res: Response): Promise<void> => {
  const invalid = validateQuery(req.query);
  if (invalid) {
    sendResponse(res, 400, false, invalid);
    return;
  }
  const { dateFrom, dateTo, season } = req.query as {
    dateFrom?: string;
    dateTo?: string;
    season?: string;
  };
  const matchDate: Record<string, Date> = {};
  if (dateFrom) matchDate.$gte = new Date(dateFrom);
  if (dateTo) matchDate.$lte = new Date(dateTo);
  // Giống getAll: chọn mùa mà không nhập khoảng ngày → dùng khoảng ngày của mùa
  if (season && !dateFrom && !dateTo) {
    const range = await seasonDateRange(season);
    if (range) Object.assign(matchDate, range);
  }

  const dateFilter = Object.keys(matchDate).length ? { date: matchDate } : {};
  const createdByFilter = isPrivileged(req.user!.roles) ? {} : { createdBy: req.user!._id };
  const isIncome = { $eq: ['$type', 'income'] };
  const isExpense = { $eq: ['$type', 'expense'] };
  const isPending = { $and: [isExpense, { $ne: ['$accountantRefunded', true] }] };

  // Một dòng / lớp (kể cả `_id: null` = giao dịch không gắn lớp) để tổng các dòng khớp KPI
  const rows = await Transaction.aggregate([
    { $match: { ...dateFilter, ...createdByFilter } },
    {
      $group: {
        _id: '$customer',
        income: { $sum: { $cond: [isIncome, '$amount', 0] } },
        expense: { $sum: { $cond: [isExpense, '$amount', 0] } },
        incomeCount: { $sum: { $cond: [isIncome, 1, 0] } },
        expenseCount: { $sum: { $cond: [isExpense, 1, 0] } },
        pendingRefund: { $sum: { $cond: [isPending, '$amount', 0] } },
        pendingRefundCount: { $sum: { $cond: [isPending, 1, 0] } },
      },
    },
    {
      $lookup: {
        from: 'customers',
        localField: '_id',
        foreignField: '_id',
        as: 'customer',
      },
    },
    {
      $project: {
        customer: { $arrayElemAt: ['$customer', 0] },
        income: 1,
        expense: 1,
        profit: { $subtract: ['$income', '$expense'] },
        count: { $add: ['$incomeCount', '$expenseCount'] },
        incomeCount: 1,
        expenseCount: 1,
        pendingRefund: 1,
        pendingRefundCount: 1,
      },
    },
    // Gắn trường (schoolId → { _id, name, address }) như các API populate khác
    {
      $lookup: {
        from: 'schools',
        localField: 'customer.schoolId',
        foreignField: '_id',
        pipeline: [{ $project: { name: 1, address: 1 } }],
        as: 'school',
      },
    },
    {
      $set: {
        customer: {
          $cond: [
            { $ifNull: ['$customer', false] },
            {
              $mergeObjects: [
                '$customer',
                { schoolId: { $ifNull: [{ $arrayElemAt: ['$school', 0] }, null] } },
              ],
            },
            '$$REMOVE',
          ],
        },
      },
    },
    { $unset: ['school', 'customer.legacySchool'] },
    { $sort: { 'customer.className': 1 } },
  ]);

  sendResponse(res, 200, true, 'OK', rows);
};
