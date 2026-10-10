import type { Types } from 'mongoose';
import Schedule, { ISchedule } from '../models/Schedule';
import Customer, { CUSTOMER_STATUS_LABELS, type ICustomer } from '../models/Customer';
import type { IUser } from '../models/User';
import type { ISeason } from '../models/Season';
import { notifyUsers } from './telegramService';
import { createFolderAndLog } from './googleSheetService';
import { resolveSeasonForDate } from '../utils/seasonCache';

/**
 * Tạo lịch chụp kèm các side effect: tự gán mùa theo ngày chụp, tạo (hoặc dùng lại) folder Drive
 * của LỚP + ghi Sheet (đồng bộ, lưu `Customer.driveFolderUrl` nếu lớp chưa có), rồi gửi Telegram
 * cho thợ chụp chạy nền.
 * Dùng chung cho POST /schedules và luồng chốt cọc của khách hàng.
 */
export const createScheduleWithSideEffects = async (
  body: Record<string, unknown>,
): Promise<ISchedule> => {
  const payload = stripLegacyScheduleFields(body);
  if (payload.season === undefined || payload.season === null || payload.season === '') {
    payload.season = await resolveSeasonForDate(payload.shootDate as string | undefined);
  }
  const schedule = await Schedule.create(payload);

  // Lấy bản populate để dựng tên folder + nội dung thông báo
  const full = await Schedule.findById(schedule._id)
    .populate<{
      customer: Pick<
        ICustomer,
        | '_id'
        | 'className'
        | 'schoolId'
        | 'status'
        | 'driveFolderUrl'
        | 'driveFolderId'
        | 'contract'
      >;
    }>({
      path: 'customer',
      select: 'className schoolId status driveFolderUrl driveFolderId contract.url',
      populate: { path: 'schoolId', select: 'name' },
    })
    .populate<{ leadPhotographer: Pick<IUser, 'name'> }>('leadPhotographer', 'name')
    .populate<{ supportPhotographers: Pick<IUser, 'name'>[] }>('supportPhotographers', 'name')
    .populate('externalCrew.photographer', 'name')
    .populate<{ season: Pick<ISeason, 'name'> }>('season', 'name')
    .lean();

  const dateStr = new Date(schedule.shootDate).toLocaleDateString('vi-VN');
  const ids = full
    ? [full.leadPhotographer, ...full.supportPhotographers]
        .filter(Boolean)
        .map((p) => String((p as { _id?: unknown })?._id ?? p))
    : [];

  // ── Tạo/dùng lại folder Drive của lớp + ghi Sheet ĐỒNG BỘ trước khi trả về ──
  let folderUrl = full?.customer?.driveFolderUrl ?? null;
  if (full) {
    try {
      const externalCrew = (full.externalCrew ?? []) as unknown as Array<{
        photographer?: { name?: string } | null;
        role: 'lead' | 'support';
        confirmation: string;
      }>;
      const leadName =
        (full.leadPhotographer as unknown as { name?: string })?.name ??
        externalCrew.find((entry) => entry.role === 'lead' && entry.confirmation !== 'declined')
          ?.photographer?.name;
      const supportNames = (full.supportPhotographers as unknown as { name?: string }[])
        .map((p) => p?.name)
        .filter((n): n is string => Boolean(n));
      supportNames.push(
        ...externalCrew
          .filter((entry) => entry.role === 'support' && entry.confirmation !== 'declined')
          .map((entry) => entry.photographer?.name)
          .filter((name): name is string => Boolean(name)),
      );
      const seasonName = (full.season as unknown as { name?: string })?.name ?? 'Chưa phân mùa';

      const result = await createFolderAndLog({
        scheduleId: String(full._id),
        folderId: full.customer?.driveFolderId ?? null,
        season: seasonName,
        school: (full.customer?.schoolId as { name?: string } | null | undefined)?.name ?? '',
        className: full.customer?.className ?? '',
        shootDate: dateStr,
        startTime: full.startTime,
        location: full.location,
        leadPhotographer: leadName,
        supportPhotographers: supportNames,
        contractUrl: full.customer?.contract?.url,
        // Cột "Trạng thái" trên Sheet: lịch huỷ → "Đã huỷ", còn lại là trạng thái của lớp
        status:
          full.status === 'cancelled'
            ? 'Đã huỷ'
            : CUSTOMER_STATUS_LABELS[full.customer?.status ?? 'new'],
      });

      // Lớp chưa có folder → lưu folder vừa tạo (không ghi đè folder đã có của lớp)
      if (result?.folderUrl && !folderUrl && full.customer?._id) {
        const saved = await Customer.findOneAndUpdate(
          { _id: full.customer._id, driveFolderUrl: { $in: [null, ''] } },
          { $set: { driveFolderUrl: result.folderUrl, driveFolderId: result.folderId } },
          { new: true, projection: { driveFolderUrl: 1 } },
        ).lean();
        folderUrl = saved?.driveFolderUrl ?? result.folderUrl;
      } else if (
        result?.folderUrl &&
        (result.scriptVersion ?? 0) >= 2 &&
        full.customer?.driveFolderId &&
        result.folderId !== full.customer.driveFolderId
      ) {
        // Script bản mới không dùng lại được folder đã lưu (bị xoá / vào thùng rác) → thay bằng
        // folder vừa tạo. Script cũ bỏ qua folderId nên không tin kết quả của nó.
        const saved = await Customer.findOneAndUpdate(
          { _id: full.customer._id, driveFolderId: full.customer.driveFolderId },
          { $set: { driveFolderUrl: result.folderUrl, driveFolderId: result.folderId } },
          { new: true, projection: { driveFolderUrl: 1 } },
        ).lean();
        if (saved?.driveFolderUrl) folderUrl = saved.driveFolderUrl;
      }
    } catch (e) {
      console.error('[Schedule] tạo folder Drive thất bại:', e);
    }
  }

  // ── Thông báo Telegram chạy nền (không chặn response) ──
  if (ids.length) {
    const timeStr = schedule.startTime ? ` • ${schedule.startTime}` : '';
    const locationStr = schedule.location ? `\n📍 ${schedule.location}` : '';
    const customerName = full?.customer?.className ?? 'Khách hàng';
    const text =
      `📅 <b>Lịch chụp mới được tạo</b>\n` +
      `👥 ${customerName}\n` +
      `📆 ${dateStr}${timeStr}${locationStr}`;
    void (async () => {
      try {
        await notifyUsers(ids, text);
        if (folderUrl) {
          await notifyUsers(ids, `📁 <b>Folder ảnh của lớp</b>\n🔗 ${folderUrl}`);
        }
      } catch (e) {
        console.error('[Schedule] gửi thông báo Telegram thất bại:', e);
      }
    })();
  }

  return schedule;
};

/**
 * Field hợp đồng / folder Drive cũ trên lịch chụp — đã chuyển sang lớp, không ghi nữa.
 */
export const LEGACY_SCHEDULE_FIELDS = [
  'contractUrl',
  'contractDocId',
  'contractTotal',
  'contractDepositAmount',
  'contractDepositSyncedAt',
  'driveFolderUrl',
  'driveFolderId',
] as const;

/** Bản sao `body` đã bỏ các field cũ ở `LEGACY_SCHEDULE_FIELDS`. */
export const stripLegacyScheduleFields = <T extends object>(body: T): T => {
  const out = { ...body } as Record<string, unknown>;
  for (const k of LEGACY_SCHEDULE_FIELDS) delete out[k];
  return out as T;
};

/**
 * Chọn lịch chụp đại diện của một lớp: ưu tiên lịch đang áp dụng (chưa huỷ), chỉ rơi về lịch
 * đã huỷ khi lớp không còn lịch nào khác; cùng nhóm thì lấy ngày chụp mới nhất.
 * Dùng chung cho GET /schedules/customer/:customer và route public của form học sinh.
 */
export const findPreferredScheduleId = async (customer: string): Promise<Types.ObjectId | null> => {
  const pick = (extra: Record<string, unknown>) =>
    Schedule.findOne({ customer, ...extra })
      .select('_id')
      .sort({ shootDate: -1 })
      .lean<{ _id: Types.ObjectId } | null>();
  const found = (await pick({ status: { $ne: 'cancelled' } })) ?? (await pick({}));
  return found?._id ?? null;
};
