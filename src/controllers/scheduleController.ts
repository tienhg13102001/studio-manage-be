import { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import path from 'path';
import Schedule from '../models/Schedule';
import type { ICustomer } from '../models/Customer';
import type { IUser } from '../models/User';
import type { ISeason } from '../models/Season';
import type { ScheduleResponse } from '../types/dto';
import { notifyUsers } from '../services/telegramService';
import { createFolderAndLog, deleteFolderAndRow } from '../services/googleSheetService';
import { resolveSeasonForDate } from '../utils/seasonCache';
import { sendResponse } from '../utils/response';

interface ScheduleQuery {
  customer?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  limit?: string;
  season?: string;
}

const buildFilter = (q: ScheduleQuery) => {
  const filter: Record<string, unknown> = {};
  if (q.customer) filter.customer = q.customer;
  if (q.status) filter.status = q.status;
  if (q.dateFrom || q.dateTo) {
    const dateRange: Record<string, Date> = {};
    if (q.dateFrom) dateRange.$gte = new Date(q.dateFrom);
    if (q.dateTo) dateRange.$lte = new Date(q.dateTo);
    filter.shootDate = dateRange;
  }
  return filter;
};

const FONT_REGULAR = path.join(__dirname, '../../src/assets/fonts/Roboto-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '../../src/assets/fonts/Roboto-Bold.ttf');

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const { page = '1', limit = '20', season, ...rest } = req.query as ScheduleQuery;
  const filter = buildFilter(rest);
  if (season) {
    filter.season = season;
  }
  const skip = (Number(page) - 1) * Number(limit);
  const USER_FIELDS = '_id username name roles isActive createdAt';
  const CUSTOMER_FIELDS =
    '_id className school contactName contactPhone contactAddress total totalMale totalFemale notes createdAt';
  const [data, total] = await Promise.all([
    Schedule.find(filter)
      .populate('customer', CUSTOMER_FIELDS)
      .populate({ path: 'package', populate: { path: 'costumes' } })
      .populate('costumes')
      .populate('leadPhotographer', USER_FIELDS)
      .populate('supportPhotographers', USER_FIELDS)
      .populate('bookedBy', USER_FIELDS)
      .sort({ shootDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean<ScheduleResponse[]>(),
    Schedule.countDocuments(filter),
  ]);
  sendResponse(res, 200, true, 'OK', data, { total, page: Number(page), limit: Number(limit) });
};

export const getByCustomer = async (req: Request, res: Response): Promise<void> => {
  const USER_FIELDS = '_id username name roles isActive createdAt';
  const CUSTOMER_FIELDS =
    '_id className school contactName contactPhone contactAddress total totalMale totalFemale notes createdAt';
  const schedule = await Schedule.findOne({ customer: req.params.customer })
    .populate('customer', CUSTOMER_FIELDS)
    .populate({ path: 'package', populate: { path: 'costumes' } })
    .populate('costumes')
    .populate('leadPhotographer', USER_FIELDS)
    .populate('supportPhotographers', USER_FIELDS)
    .populate('bookedBy', USER_FIELDS)
    .sort({ shootDate: -1 })
    .lean<ScheduleResponse | null>();
  sendResponse(res, 200, true, 'OK', schedule);
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const USER_FIELDS = '_id username name roles isActive createdAt';
  const CUSTOMER_FIELDS =
    '_id className school contactName contactPhone contactAddress total totalMale totalFemale notes createdAt';
  const schedule = await Schedule.findById(req.params.id)
    .populate('customer', CUSTOMER_FIELDS)
    .populate({ path: 'package', populate: { path: 'costumes' } })
    .populate('costumes')
    .populate('leadPhotographer', USER_FIELDS)
    .populate('supportPhotographers', USER_FIELDS)
    .populate('bookedBy', USER_FIELDS)
    .lean<ScheduleResponse | null>();
  if (!schedule) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'OK', schedule);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const payload = { ...req.body };
  if (payload.season === undefined || payload.season === null || payload.season === '') {
    payload.season = await resolveSeasonForDate(payload.shootDate);
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

  // Trả response sau khi đã có driveFolderUrl (nếu tạo folder thành công)
  sendResponse(res, 201, true, 'Tạo lịch chụp thành công', schedule);

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
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const prevSchedule = await Schedule.findById(req.params.id).lean();
  const updateData = { ...req.body };
  // Nếu đổi ngày chụp mà client không gửi season, tự động tính lại theo mùa.
  if (
    updateData.shootDate &&
    (updateData.season === undefined || updateData.season === null || updateData.season === '')
  ) {
    updateData.season = await resolveSeasonForDate(updateData.shootDate);
  }
  const schedule = await Schedule.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });
  if (!schedule) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Cập nhật thành công', schedule);

  if (!prevSchedule) return;

  void (async () => {
    try {
      const full = await Schedule.findById(schedule._id)
        .populate<{
          customer: Pick<ICustomer, 'className' | 'school'>;
        }>('customer', 'className school')
        .lean();
      if (!full) return;

      const dateStr = new Date(full.shootDate).toLocaleDateString('vi-VN');
      const customerName = full.customer?.className ?? 'Khách hàng';
      const customerSchool = full.customer?.school || '';
      const timeStr = full.startTime ? ` • ${full.startTime}` : '';
      const locationStr = full.location ? `\n📍 ${full.location}` : '';

      // ── 1. Phát hiện thay đổi thợ chụp ──────────────────────────────────
      // Chỉ tính thay đổi khi client thực sự gửi field tương ứng. Nếu chỉ cập
      // nhật field khác (vd: contractUrl) thì giữ nguyên thợ cũ, tránh báo nhầm
      // "được gỡ khỏi lịch chụp".
      const leadProvided = 'leadPhotographer' in req.body;
      const supportsProvided = Array.isArray(req.body?.supportPhotographers);

      const prevLead = prevSchedule.leadPhotographer?.toString() ?? null;
      const newLead = leadProvided
        ? req.body.leadPhotographer
          ? String(req.body.leadPhotographer)
          : null
        : prevLead;

      const prevSupports = (prevSchedule.supportPhotographers ?? []).map((id) => id.toString());
      const newSupports: string[] = supportsProvided
        ? req.body.supportPhotographers.map(String)
        : prevSupports;

      // Thợ mới được thêm vào (chưa có trong lịch trước)
      const addedLead =
        newLead && newLead !== prevLead && !prevSupports.includes(newLead) ? [newLead] : [];
      const addedSupports = newSupports.filter(
        (id) => id !== prevLead && !prevSupports.includes(id),
      );
      const addedIds = [...new Set([...addedLead, ...addedSupports])];

      // Thợ bị gỡ ra
      const removedLead =
        prevLead && prevLead !== newLead && !newSupports.includes(prevLead) ? [prevLead] : [];
      const removedSupports = prevSupports.filter(
        (id) => id !== newLead && !newSupports.includes(id),
      );
      const removedIds = [...new Set([...removedLead, ...removedSupports])];

      if (addedIds.length) {
        const text =
          `📅 <b>Bạn được phân công lịch chụp</b>\n` +
          `👥 ${customerName} - ${customerSchool}\n` +
          `📆 ${dateStr}${timeStr}${locationStr}`;
        await notifyUsers(addedIds, text);
      }

      if (removedIds.length) {
        const text =
          `🗑 <b>Bạn đã được gỡ khỏi lịch chụp</b>\n` +
          `👥 ${customerName} - ${customerSchool}` +
          `\n📆 ${dateStr}${timeStr}${locationStr}`;
        await notifyUsers(removedIds, text);
      }

      // ── 2. Thông báo đổi status cho tất cả thợ hiện tại ─────────────────
      const newStatus = req.body?.status as string | undefined;
      if (newStatus && newStatus !== prevSchedule.status) {
        const statusLabel: Record<string, string> = {
          confirmed: '✅ Đã xác nhận',
          completed: '🎉 Hoàn thành',
          cancelled: '❌ Đã huỷ',
          pending: '⏳ Chờ xác nhận',
        };
        const text =
          `🔔 <b>Lịch chụp cập nhật trạng thái</b>\n` +
          `👥 ${customerName} - ${customerSchool}\n` +
          `📆 ${dateStr}${timeStr}${locationStr}\n` +
          `Trạng thái: ${statusLabel[newStatus] ?? newStatus}`;

        const currentIds = [full.leadPhotographer, ...full.supportPhotographers]
          .filter(Boolean)
          .map(String);
        if (currentIds.length) await notifyUsers(currentIds, text);
      }

      // ── 3. Thông báo tạo hợp đồng ──────────────────────────────────────
      const newContractUrl = req.body?.contractUrl as string | undefined;
      const prevContractUrl = prevSchedule.contractUrl ?? null;
      if (newContractUrl && newContractUrl !== prevContractUrl) {
        const text =
          `📄 <b>Hợp đồng đã được tạo</b>\n` +
          `👥 ${customerName} - ${customerSchool}\n` +
          `📆 ${dateStr}${timeStr}${locationStr}\n` +
          `🔗 ${newContractUrl}`;

        const currentIds = [full.leadPhotographer, ...full.supportPhotographers]
          .filter(Boolean)
          .map(String);
        if (currentIds.length) await notifyUsers(currentIds, text);
      }
    } catch (e) {
      console.error('[Telegram] schedule update notification failed:', e);
    }
  })();
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  // Lấy season name + folderId trước khi xoá để dọn folder Drive & dòng Sheet
  const target = await Schedule.findById(req.params.id)
    .populate<{ season: Pick<ISeason, 'name'> }>('season', 'name')
    .lean();
  if (!target) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }

  await Schedule.findByIdAndDelete(req.params.id);
  sendResponse(res, 200, true, 'Đã xóa lịch chụp');

  // Dọn dẹp Google Drive + Sheet (chạy nền, không chặn response)
  void deleteFolderAndRow({
    scheduleId: String(target._id),
    season: (target.season as unknown as { name?: string })?.name ?? 'Chưa phân mùa',
    folderId: target.driveFolderId,
  }).catch((e: unknown) => console.error('[Schedule] dọn Google Drive/Sheet khi xoá thất bại:', e));
};

export const exportContract = async (req: Request, res: Response): Promise<void> => {
  const schedule = await Schedule.findById(req.params.id)
    .populate<{
      customer: ICustomer;
    }>('customer', 'className school contactName contactPhone total')
    .populate<{ leadPhotographer: IUser }>('leadPhotographer', 'username name')
    .populate<{ supportPhotographers: IUser[] }>('supportPhotographers', 'username name');

  if (!schedule) {
    res.status(404).json({ message: 'Not found' });
    return;
  }

  const customer = schedule.customer as unknown as ICustomer;
  const lead = schedule.leadPhotographer as unknown as IUser | null;
  const supports = (schedule.supportPhotographers as unknown as IUser[]) ?? [];

  const formatDate = (d: Date | string) => {
    const date = new Date(d);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  };

  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="hop-dong-${schedule._id}.pdf"`);
  doc.pipe(res);

  doc.registerFont('Regular', FONT_REGULAR).registerFont('Bold', FONT_BOLD);

  // ── Header ──────────────────────────────────────────────────────────────
  doc.font('Bold').fontSize(18).text('YUME STUDIO', { align: 'center' });
  doc
    .font('Regular')
    .fontSize(10)
    .text('ĐC: [Địa chỉ studio]  •  SĐT: [Số điện thoại]', { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);

  // ── Title ────────────────────────────────────────────────────────────────
  doc.font('Bold').fontSize(16).text('HỢP ĐỒNG CHỤP ẢNH KỶ YẾU', { align: 'center' });
  doc
    .font('Regular')
    .fontSize(10)
    .text(`Số hợp đồng: HD-${String(schedule._id).slice(-6).toUpperCase()}`, { align: 'center' });
  doc.moveDown(1);

  // ── Parties ──────────────────────────────────────────────────────────────
  doc.font('Bold').fontSize(12).text('A. CÁC BÊN THAM GIA HỢP ĐỒNG');
  doc.moveDown(0.3);
  doc.font('Bold').fontSize(10).text('BÊN A (Studio):');
  doc
    .font('Regular')
    .fontSize(10)
    .text('Tên: Yume Studio')
    .text('Địa chỉ: [Địa chỉ studio]')
    .text('Điện thoại: [Số điện thoại]');
  doc.moveDown(0.5);

  doc.font('Bold').fontSize(10).text('BÊN B (Khách hàng):');
  doc
    .font('Regular')
    .fontSize(10)
    .text(`Đại diện lớp: ${customer?.contactName ?? '____________________'}`)
    .text(`Lớp / Trường: ${customer?.className ?? ''} – ${customer?.school ?? ''}`)
    .text(`Số điện thoại: ${customer?.contactPhone ?? '____________________'}`);
  doc.moveDown(1);

  // ── Schedule details ─────────────────────────────────────────────────────
  doc.font('Bold').fontSize(12).text('B. THÔNG TIN BUỔI CHỤP');
  doc.moveDown(0.3);

  const rows: [string, string][] = [
    ['Ngày chụp', formatDate(schedule.shootDate)],
    ['Giờ bắt đầu', schedule.startTime ?? '—'],
    ['Giờ kết thúc', schedule.endTime ?? '—'],
    ['Địa điểm', schedule.location ?? '—'],
    ['Thợ leader', lead ? (lead.name ?? lead.username) : '—'],
    ['Thợ support', supports.length ? supports.map((u) => u.name ?? u.username).join(', ') : '—'],
    ['Số lượng học sinh', String(customer?.total ?? '—')],
  ];

  for (const [label, value] of rows) {
    const y = doc.y;
    doc
      .font('Bold')
      .fontSize(10)
      .text(label + ':', 50, y, { width: 150, continued: false });
    doc.font('Regular').fontSize(10).text(value, 210, y);
    doc.moveDown(0.1);
  }
  doc.moveDown(0.8);

  // ── Terms ────────────────────────────────────────────────────────────────
  doc.font('Bold').fontSize(12).text('C. ĐIỀU KHOẢN HỢP ĐỒNG');
  doc.moveDown(0.3);
  const terms = [
    '1. Studio cam kết thực hiện đúng lịch chụp đã thoả thuận. Trường hợp bất khả kháng sẽ thông báo trước ít nhất 24 giờ.',
    '2. Bên B cần xác nhận lịch chụp trước 48 giờ. Nếu huỷ sau thời hạn này, khoản đặt cọc sẽ không được hoàn lại.',
    '3. Ảnh gốc sẽ được bàn giao sau khi bên B thanh toán đầy đủ.',
    '4. Thời gian bàn giao ảnh chỉnh sửa: trong vòng 30 ngày làm việc kể từ ngày chụp.',
    '5. Mọi tranh chấp phát sinh sẽ được giải quyết trên tinh thần thương lượng, hoà giải.',
  ];
  for (const t of terms) {
    doc.font('Regular').fontSize(10).text(t, { width: 495 });
    doc.moveDown(0.3);
  }
  doc.moveDown(0.8);

  // ── Notes ────────────────────────────────────────────────────────────────
  if (schedule.notes) {
    doc.font('Bold').fontSize(12).text('D. GHI CHÚ THÊM');
    doc.moveDown(0.3);
    doc.font('Regular').fontSize(10).text(schedule.notes, { width: 495 });
    doc.moveDown(0.8);
  }

  // ── Signatures ───────────────────────────────────────────────────────────
  doc
    .font('Regular')
    .fontSize(10)
    .text(`Hà Nội, ngày ${formatDate(new Date())}`, { align: 'right' });
  doc.moveDown(1);

  const sigY = doc.y;
  doc.font('Bold').fontSize(10).text('ĐẠI DIỆN BÊN A', 50, sigY, { width: 220, align: 'center' });
  doc.font('Bold').fontSize(10).text('ĐẠI DIỆN BÊN B', 325, sigY, { width: 220, align: 'center' });
  doc
    .font('Regular')
    .fontSize(9)
    .text('(Ký và ghi rõ họ tên)', 50, doc.y, { width: 220, align: 'center' });
  doc
    .font('Regular')
    .fontSize(9)
    .text('(Ký và ghi rõ họ tên)', 325, doc.y, { width: 220, align: 'center' });

  doc.end();
};
