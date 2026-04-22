import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction';
import Customer from '../models/Customer';
import Schedule from '../models/Schedule';

const isPrivileged = (roles: number[]): boolean => roles.some((r) => r === 0 || r === 1);
const isPhotographer = (roles: number[]): boolean => roles.includes(3);

export const getStats = async (req: Request, res: Response): Promise<void> => {
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
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const txFilter = filterUserId ? { createdBy: filterUserId } : {};

  // This month income/expense
  const thisMonthStats = await Transaction.aggregate([
    { $match: { ...txFilter, date: { $gte: monthStart, $lte: monthEnd } } },
    { $group: { _id: '$type', total: { $sum: '$amount' } } },
  ]);
  const income = thisMonthStats.find((r) => r._id === 'income')?.total ?? 0;
  const expense = thisMonthStats.find((r) => r._id === 'expense')?.total ?? 0;

  const granularity: 'week' | 'month' = months === 1 ? 'week' : 'month';

  // Last N months (or 1 month by week) breakdown for chart
  const nMonthsAgo = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const monthly: Array<{ label: string; income: number; expense: number }> = [];

  if (granularity === 'week') {
    // Rolling window: từ ngày này tháng trước → hôm nay, gộp theo tuần (7 ngày)
    const windowStart = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate(), 0, 0, 0, 0);
    const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const dayRaw = await Transaction.aggregate([
      { $match: { ...txFilter, date: { $gte: windowStart, $lte: windowEnd } } },
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
    ]);

    // Tạo các bucket 7 ngày kết thúc tại hôm nay, đi ngược về trước cho tới khi phủ windowStart
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const totalDays = Math.floor((windowEnd.getTime() - windowStart.getTime()) / MS_PER_DAY) + 1;
    const numWeeks = Math.ceil(totalDays / 7);

    for (let i = numWeeks - 1; i >= 0; i--) {
      const wEnd = new Date(windowEnd);
      wEnd.setDate(wEnd.getDate() - i * 7);
      wEnd.setHours(23, 59, 59, 999);
      const wStart = new Date(wEnd);
      wStart.setDate(wStart.getDate() - 6);
      wStart.setHours(0, 0, 0, 0);
      if (wStart < windowStart) wStart.setTime(windowStart.getTime());

      let inc = 0;
      let exp = 0;
      for (const r of dayRaw) {
        const d = new Date(r._id.year, r._id.month - 1, r._id.day);
        if (d >= wStart && d <= wEnd) {
          inc += r.income;
          exp += r.expense;
        }
      }
      monthly.push({
        label: `${wStart.getFullYear()}-${String(wStart.getMonth() + 1).padStart(2, '0')}-${String(wStart.getDate()).padStart(2, '0')}`,
        income: inc,
        expense: exp,
      });
    }
  } else {
    // Aggregate by month
    const monthlyRaw = await Transaction.aggregate([
      { $match: { ...txFilter, date: { $gte: nMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: '$date' }, month: { $month: '$date' }, type: '$type' },
          total: { $sum: '$amount' },
        },
      },
      {
        $group: {
          _id: { year: '$_id.year', month: '$_id.month' },
          income: { $sum: { $cond: [{ $eq: ['$_id.type', 'income'] }, '$total', 0] } },
          expense: { $sum: { $cond: [{ $eq: ['$_id.type', 'expense'] }, '$total', 0] } },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Fill missing months so chart always shows N bars
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yr = d.getFullYear();
      const mo = d.getMonth() + 1;
      const found = monthlyRaw.find((r) => r._id.year === yr && r._id.month === mo);
      monthly.push({
        label: `${yr}-${String(mo).padStart(2, '0')}`,
        income: found?.income ?? 0,
        expense: found?.expense ?? 0,
      });
    }
  }

  // Customer count (created by user)
  const customerFilter = filterUserId ? { createdBy: filterUserId } : {};
  const customerCount = await Customer.countDocuments(customerFilter);

  // Schedule count & upcoming — only for photographers or admin
  // For photographer: schedules where they are leadPhotographer or in supportPhotographers
  // For admin: all schedules this month (or filtered by userId as photographer)
  let scheduleCount = 0;
  let upcomingSchedules: unknown[] = [];

  const showSchedules = privileged || isPhotographer(userRoles);
  if (showSchedules) {
    const shootDateFilter = { shootDate: { $gte: monthStart, $lte: monthEnd } };
    let scheduleFilter: Record<string, unknown> = { ...shootDateFilter };

    if (filterUserId) {
      // Filter lịch mà user là lead hoặc support photographer
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

    [scheduleCount, upcomingSchedules] = await Promise.all([
      Schedule.countDocuments(scheduleFilter),
      Schedule.find({ ...scheduleFilter, shootDate: { $gte: now } })
        .populate('customer', 'className school')
        .populate('leadPhotographer', 'name username')
        .sort({ shootDate: 1 })
        .limit(10)
        .lean(),
    ]);
  }

  res.json({
    thisMonth: { income, expense, profit: income - expense },
    monthly,
    granularity,
    customerCount,
    scheduleCount,
    showSchedules,
    upcomingSchedules,
  });
};
