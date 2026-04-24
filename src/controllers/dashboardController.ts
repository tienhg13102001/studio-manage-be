import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction';
import Customer from '../models/Customer';
import Schedule from '../models/Schedule';
import type { DashboardStats, UpcomingScheduleDto } from '../types/dto';

const isPrivileged = (roles: number[]): boolean => roles.some((r) => r === 0 || r === 1);
const isPhotographer = (roles: number[]): boolean => roles.includes(3);

export const getStats = async (req: Request, res: Response<DashboardStats>): Promise<void> => {
  const { userId, months: monthsStr } = req.query as { userId?: string; months?: string };
  const months = Math.max(1, Math.min(12, parseInt(monthsStr ?? '6', 10) || 6));
  const privileged = isPrivileged(req.user!.roles);
  const userRoles = req.user!.roles as number[];

  // Determine userId to filter — non-admin always uses own ID
  let filterUserId: mongoose.Types.ObjectId | null = null;
  if (!privileged) {
    filterUserId = req.user!._id as mongoose.Types.ObjectId;
  } else if (userId) {
    filterUserId = new mongoose.Types.ObjectId(userId);
  }

  const now = new Date();
  // Window: [now - N months, now]
  const windowStart = new Date(
    now.getFullYear(),
    now.getMonth() - months,
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  const windowEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  );

  const txFilter = filterUserId ? { createdBy: filterUserId } : {};
  const dateRange = { $gte: windowStart, $lte: windowEnd };

  // Window income/expense totals
  const totalsRaw = await Transaction.aggregate([
    { $match: { ...txFilter, date: dateRange } },
    { $group: { _id: '$type', total: { $sum: '$amount' } } },
  ]);
  const income = totalsRaw.find((r) => r._id === 'income')?.total ?? 0;
  const expense = totalsRaw.find((r) => r._id === 'expense')?.total ?? 0;

  // Daily breakdown: group by actual transaction date (only days with data).
  const dailyRaw: Array<{
    _id: { year: number; month: number; day: number };
    income: number;
    expense: number;
  }> = await Transaction.aggregate([
    { $match: { ...txFilter, date: dateRange } },
    {
      $group: {
        _id: {
          year: { $year: '$date' },
          month: { $month: '$date' },
          day: { $dayOfMonth: '$date' },
          type: '$type',
        },
        total: { $sum: '$amount' },
      },
    },
    {
      $group: {
        _id: { year: '$_id.year', month: '$_id.month', day: '$_id.day' },
        income: { $sum: { $cond: [{ $eq: ['$_id.type', 'income'] }, '$total', 0] } },
        expense: { $sum: { $cond: [{ $eq: ['$_id.type', 'expense'] }, '$total', 0] } },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
  ]);

  const daily = dailyRaw.map((r) => ({
    label: `${r._id.year}-${String(r._id.month).padStart(2, '0')}-${String(r._id.day).padStart(2, '0')}`,
    income: r.income,
    expense: r.expense,
  }));

  // Customer count within window (by createdAt)
  const customerFilter: Record<string, unknown> = {
    ...(filterUserId ? { createdBy: filterUserId } : {}),
    createdAt: dateRange,
  };
  const customerCount = await Customer.countDocuments(customerFilter);

  // Schedule count & upcoming — only for photographers or admin
  let scheduleCount = 0;
  let upcomingSchedules: UpcomingScheduleDto[] = [];

  const showSchedules = privileged || isPhotographer(userRoles);
  if (showSchedules) {
    const shootDateFilter = { shootDate: dateRange };
    let scheduleFilter: Record<string, unknown> = { ...shootDateFilter };

    if (filterUserId) {
      scheduleFilter = {
        ...shootDateFilter,
        $or: [{ leadPhotographer: filterUserId }, { supportPhotographers: filterUserId }],
      };
    } else if (!privileged && isPhotographer(userRoles)) {
      const selfId = req.user!._id;
      scheduleFilter = {
        ...shootDateFilter,
        $or: [{ leadPhotographer: selfId }, { supportPhotographers: selfId }],
      };
    }

    const upcomingFilter: Record<string, unknown> = { ...scheduleFilter, shootDate: { $gte: now } };

    [scheduleCount, upcomingSchedules] = await Promise.all([
      Schedule.countDocuments(scheduleFilter),
      Schedule.find(upcomingFilter)
        .populate('customer', 'className school')
        .populate('leadPhotographer', 'name username')
        .sort({ shootDate: 1 })
        .limit(10)
        .lean<UpcomingScheduleDto[]>(),
    ]);
  }

  res.json({
    totals: { income, expense, profit: income - expense },
    daily,
    customerCount,
    scheduleCount,
    showSchedules,
    upcomingSchedules,
  });
};
