import Schedule from '../models/Schedule';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Chuẩn hoá trạng thái lịch chụp cũ (pending/confirmed/completed) về `active`.
 * Idempotent — chạy mỗi lần server khởi động sau khi kết nối DB. Thử lại tối đa 3 lần;
 * lỗi chỉ log, không làm sập server.
 */
export const normalizeScheduleStatus = async (): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await Schedule.updateMany(
        { status: { $in: ['pending', 'confirmed', 'completed'] } },
        { $set: { status: 'active' } },
      );
      console.log(
        `[Migration] schedule status → active: matched ${result.matchedCount}, modified ${result.modifiedCount}`,
      );
      return;
    } catch (e) {
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[Migration] chuẩn hoá trạng thái lịch chụp thất bại (lần ${attempt}/${MAX_ATTEMPTS}), thử lại:`,
          e,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        console.error(
          `[Migration] ERROR: chuẩn hoá trạng thái lịch chụp thất bại sau ${MAX_ATTEMPTS} lần — ` +
            'lịch cũ (pending/confirmed/completed) chưa được chuyển về active, cần kiểm tra DB:',
          e,
        );
      }
    }
  }
};
