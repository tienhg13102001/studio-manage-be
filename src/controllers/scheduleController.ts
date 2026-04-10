import { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import path from 'path';
import Schedule from '../models/Schedule';
import type { ICustomer } from '../models/Customer';
import type { IUser } from '../models/User';

const FONT_REGULAR = path.join(__dirname, '../../src/assets/fonts/Roboto-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '../../src/assets/fonts/Roboto-Bold.ttf');

interface ScheduleQuery {
  customerId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  limit?: string;
}

const buildFilter = (q: ScheduleQuery) => {
  const filter: Record<string, unknown> = {};
  if (q.customerId) filter.customerId = q.customerId;
  if (q.status) filter.status = q.status;
  if (q.dateFrom || q.dateTo) {
    const dateRange: Record<string, Date> = {};
    if (q.dateFrom) dateRange.$gte = new Date(q.dateFrom);
    if (q.dateTo) dateRange.$lte = new Date(q.dateTo);
    filter.shootDate = dateRange;
  }
  return filter;
};

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const { page = '1', limit = '20', ...rest } = req.query as ScheduleQuery;
  const filter = buildFilter(rest);
  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    Schedule.find(filter)
      .populate('customerId', 'className school')
      .populate('leadPhotographer', 'username name role')
      .populate('supportPhotographers', 'username name role')
      .sort({ shootDate: 1 })
      .skip(skip)
      .limit(Number(limit)),
    Schedule.countDocuments(filter),
  ]);
  res.json({ data, total, page: Number(page), limit: Number(limit) });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const schedule = await Schedule.findById(req.params.id)
    .populate('customerId', 'className school contactName contactPhone')
    .populate('leadPhotographer', 'username role')
    .populate('supportPhotographers', 'username role');
  if (!schedule) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(schedule);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const schedule = await Schedule.create(req.body);
  res.status(201).json(schedule);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const schedule = await Schedule.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!schedule) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json(schedule);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const schedule = await Schedule.findByIdAndDelete(req.params.id);
  if (!schedule) {
    res.status(404).json({ message: 'Not found' });
    return;
  }
  res.json({ message: 'Deleted' });
};

export const exportContract = async (req: Request, res: Response): Promise<void> => {
  const schedule = await Schedule.findById(req.params.id)
    .populate<{
      customerId: ICustomer;
    }>('customerId', 'className school contactName contactPhone studentCount')
    .populate<{ leadPhotographer: IUser }>('leadPhotographer', 'username name')
    .populate<{ supportPhotographers: IUser[] }>('supportPhotographers', 'username name');

  if (!schedule) {
    res.status(404).json({ message: 'Not found' });
    return;
  }

  const customer = schedule.customerId as unknown as ICustomer;
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
    ['Số lượng học sinh', String(customer?.studentCount ?? '—')],
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
