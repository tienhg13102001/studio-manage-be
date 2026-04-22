import { Request, Response } from 'express';
import Transaction from '../models/Transaction';

const isPrivileged = (roles: number[]): boolean => roles.some((r) => r === 0 || r === 1 || r === 5);

interface TransactionQuery {
  customerId?: string;
  type?: string;
  categoryId?: string;
  createdBy?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  limit?: string;
}

const buildFilter = (q: TransactionQuery) => {
  const filter: Record<string, unknown> = {};
  if (q.customerId) filter.customerId = q.customerId;
  if (q.type) filter.type = q.type;
  if (q.categoryId) filter.categoryId = q.categoryId;
  if (q.createdBy) filter.createdBy = q.createdBy;
  if (q.dateFrom || q.dateTo) {
    const dateRange: Record<string, Date> = {};
    if (q.dateFrom) dateRange.$gte = new Date(q.dateFrom);
    if (q.dateTo) dateRange.$lte = new Date(q.dateTo);
    filter.date = dateRange;
  }
  return filter;
};

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const { page = '1', limit = '20', ...rest } = req.query as TransactionQuery;
  const filter = buildFilter(rest);
  if (!isPrivileged(req.user!.roles)) {
    filter.createdBy = req.user!._id;
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    Transaction.find(filter)
      .populate('customerId', 'className school')
      .populate('categoryId', 'name type')
      .populate('createdBy', 'name username')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Transaction.countDocuments(filter),
  ]);
  res.json({ data, total, page: Number(page), limit: Number(limit) });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const tx = await Transaction.findById(req.params.id)
    .populate('customerId', 'className school')
    .populate('categoryId', 'name type')
    .populate('createdBy', 'name username');
  if (!tx) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(tx);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const createdBy =
    isPrivileged(req.user!.roles) && req.body.createdBy ? req.body.createdBy : req.user!._id;
  const tx = await Transaction.create({ ...req.body, createdBy });
  res.status(201).json(tx);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const updateData = { ...req.body };
  if (!isPrivileged(req.user!.roles)) {
    delete updateData.createdBy;
  }
  const tx = await Transaction.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });
  if (!tx) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(tx);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const tx = await Transaction.findByIdAndDelete(req.params.id);
  if (!tx) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json({ message: 'Deleted' });
};

export const getSummary = async (req: Request, res: Response): Promise<void> => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
  const matchDate: Record<string, Date> = {};
  if (dateFrom) matchDate.$gte = new Date(dateFrom);
  if (dateTo) matchDate.$lte = new Date(dateTo);

  const dateFilter = Object.keys(matchDate).length ? { date: matchDate } : {};
  const createdByFilter = isPrivileged(req.user!.roles) ? {} : { createdBy: req.user!._id };

  const rows = await Transaction.aggregate([
    { $match: { ...dateFilter, ...createdByFilter } },
    {
      $group: {
        _id: { customerId: '$customerId', type: '$type' },
        total: { $sum: '$amount' },
      },
    },
    {
      $group: {
        _id: '$_id.customerId',
        income: {
          $sum: { $cond: [{ $eq: ['$_id.type', 'income'] }, '$total', 0] },
        },
        expense: {
          $sum: { $cond: [{ $eq: ['$_id.type', 'expense'] }, '$total', 0] },
        },
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
      },
    },
    { $sort: { 'customer.className': 1 } },
  ]);

  res.json(rows);
};
