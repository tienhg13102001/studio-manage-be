import Schedule, { ISchedule } from '../models/Schedule';
import type { ICustomer } from '../models/Customer';
import type { IUser } from '../models/User';
import type { ISeason } from '../models/Season';
import { notifyUsers } from './telegramService';
import { createFolderAndLog } from './googleSheetService';
import { resolveSeasonForDate } from '../utils/seasonCache';

/**
 * Tạo lịch chụp kèm các side effect: tự gán mùa theo ngày chụp, tạo folder Drive + ghi Sheet
 * (đồng bộ, lưu driveFolderUrl), rồi gửi Telegram cho thợ chụp chạy nền.
 * Dùng chung cho POST /schedules và luồng chốt cọc của khách hàng.
 */
export const createScheduleWithSideEffects = async (
  body: Record<string, unknown>,
): Promise<ISchedule> => {
  const payload = { ...body };
  if (payload.season === undefined || payload.season === null || payload.season === '') {
    payload.season = await resolveSeasonForDate(payload.shootDate as string | undefined);
  }
  const schedule = await Schedule.create(payload);

  // Lấy bản populate để dựng tên folder + nội dung thông báo
  const full = await Schedule.findById(schedule._id)
    .populate<{ customer: Pick<ICustomer, 'className' | 'school'> }>('customer', 'className school')
    .populate<{ leadPhotographer: Pick<IUser, 'name'> }>('leadPhotographer', 'name')
    .populate<{ supportPhotographers: Pick<IUser, 'name'>[] }>('supportPhotographers', 'name')
    .populate<{ season: Pick<ISeason, 'name'> }>('season', 'name')
    .lean();

  const dateStr = new Date(schedule.shootDate).toLocaleDateString('vi-VN');
  const ids = full
    ? [full.leadPhotographer, ...full.supportPhotographers]
        .filter(Boolean)
        .map((p) => String((p as { _id?: unknown })?._id ?? p))
    : [];

  // ── Tạo folder Drive + ghi Sheet ĐỒNG BỘ, lưu driveFolderUrl trước khi trả về ──
  if (full) {
    try {
      const leadName = (full.leadPhotographer as unknown as { name?: string })?.name;
      const supportNames = (full.supportPhotographers as unknown as { name?: string }[])
        .map((p) => p?.name)
        .filter((n): n is string => Boolean(n));
      const seasonName = (full.season as unknown as { name?: string })?.name ?? 'Chưa phân mùa';

      const result = await createFolderAndLog({
        scheduleId: String(full._id),
        season: seasonName,
        school: full.customer?.school ?? '',
        className: full.customer?.className ?? '',
        shootDate: dateStr,
        startTime: full.startTime,
        location: full.location,
        leadPhotographer: leadName,
        supportPhotographers: supportNames,
        contractUrl: full.contractUrl,
        status: full.status,
      });

      if (result?.folderUrl) {
        schedule.driveFolderUrl = result.folderUrl;
        schedule.driveFolderId = result.folderId;
        await schedule.save();
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
    const folderUrl = schedule.driveFolderUrl;
    void (async () => {
      try {
        await notifyUsers(ids, text);
        if (folderUrl) {
          await notifyUsers(ids, `📁 <b>Folder ảnh đã tạo</b>\n🔗 ${folderUrl}`);
        }
      } catch (e) {
        console.error('[Schedule] gửi thông báo Telegram thất bại:', e);
      }
    })();
  }

  return schedule;
};
