import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import Customer, {
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_ORDER,
  CustomerStatus,
} from '../models/Customer';
import CustomerActivity from '../models/CustomerActivity';
import Schedule, { ISchedule } from '../models/Schedule';
import Transaction, { ITransaction } from '../models/Transaction';
import Category from '../models/Category';
import { createScheduleWithSideEffects } from '../services/scheduleService';
import { notifyByRoles } from '../services/telegramService';
import { resolveCurrentSeason } from '../utils/seasonCache';
import { sendResponse } from '../utils/response';

const USER_REF_FIELDS = 'name username';

// Chỉ các field này được sửa qua POST/PUT; field quy trình chỉ đổi qua POST /:id/status
const EDITABLE_FIELDS = [
  'className',
  'school',
  'contactName',
  'contactPhone',
  'contactAddress',
  'total',
  'totalMale',
  'totalFemale',
  'notes',
  'season',
  'source',
];

const DEPOSIT_CATEGORY_NAME = 'Thu tiền cọc hợp đồng'.normalize('NFC');
const DEPOSIT_CATEGORY_REGEX = new RegExp(`cọc|${'cọc'.normalize('NFD')}`, 'i');

const NO_SCHEDULE_WARNING =
  'Chưa có lịch chụp nên chưa tạo folder Drive — tạo lịch chụp cho lớp này';
const CONFLICT_MESSAGE = 'Trạng thái lớp vừa thay đổi, tải lại trang';

// Các bước trước khi cọc: được "Không chốt" và sale được nhận lớp chưa có người phụ trách
const PRE_DEPOSIT: CustomerStatus[] = ['new', 'contacting', 'contacted'];

const isAdmin = (req: Request) => req.user!.roles.some((r) => r === 0 || r === 1);
const isSale = (req: Request) => req.user!.roles.some((r) => r === 2 || r === 4);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Query string có thể là mảng (?a=1&a=2) → gộp bằng dấu phẩy */
const queryStr = (v: unknown): string | undefined => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(',');
  return undefined;
};

const pickEditable = (req: Request): Record<string, unknown> | string => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const f of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, f)) data[f] = body[f];
  }
  if (isAdmin(req) && Object.prototype.hasOwnProperty.call(body, 'assignedSale')) {
    const v = body.assignedSale;
    if (v === null || v === '') data.assignedSale = null;
    else if (typeof v === 'string' && mongoose.isValidObjectId(v)) data.assignedSale = v;
    else return 'assignedSale không hợp lệ';
  }
  return data;
};

/** `me` → user hiện tại; id hợp lệ → ObjectId; sai định dạng → null */
const resolveSaleParam = (req: Request, value?: string): Types.ObjectId | null | undefined => {
  if (!value) return undefined;
  if (value === 'me') return req.user!._id as Types.ObjectId;
  return mongoose.isValidObjectId(value) ? new Types.ObjectId(value) : null;
};

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const search = queryStr(req.query.search);
  const page = Number(queryStr(req.query.page) ?? '1') || 1;
  const limit = Number(queryStr(req.query.limit) ?? '20') || 20;
  const season = queryStr(req.query.season);
  const status = queryStr(req.query.status);
  const assignedSale = queryStr(req.query.assignedSale);

  const query: Record<string, unknown> = search ? { $text: { $search: search } } : {};
  if (season) {
    if (!mongoose.isValidObjectId(season)) {
      sendResponse(res, 400, false, 'season không hợp lệ');
      return;
    }
    query.season = season;
  }
  if (status) {
    const statuses: (string | null)[] = status
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Dữ liệu cũ chưa có status được tính là `new`
    if (statuses.includes('new')) statuses.push(null);
    query.status = { $in: statuses };
  }
  if (assignedSale) {
    const sale = resolveSaleParam(req, assignedSale);
    if (!sale) {
      sendResponse(res, 400, false, 'assignedSale không hợp lệ');
      return;
    }
    query.assignedSale = sale;
  }
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Customer.find(query)
      .populate('assignedSale', USER_REF_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Customer.countDocuments(query),
  ]);
  sendResponse(res, 200, true, 'OK', data, { total, page, limit });
};

export const getStatusCounts = async (req: Request, res: Response): Promise<void> => {
  const season = queryStr(req.query.season);
  const assignedSale = queryStr(req.query.assignedSale);
  const match: Record<string, unknown> = {};
  if (season) {
    if (!mongoose.isValidObjectId(season)) {
      sendResponse(res, 400, false, 'season không hợp lệ');
      return;
    }
    match.season = new Types.ObjectId(season);
  }
  if (assignedSale) {
    const sale = resolveSaleParam(req, assignedSale);
    if (!sale) {
      sendResponse(res, 400, false, 'assignedSale không hợp lệ');
      return;
    }
    match.assignedSale = sale;
  }
  const rows = await Customer.aggregate<{ _id: string; count: number }>([
    { $match: match },
    { $group: { _id: { $ifNull: ['$status', 'new'] }, count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(CUSTOMER_STATUSES.map((s) => [s, 0])) as Record<
    CustomerStatus,
    number
  >;
  for (const r of rows) {
    if (r._id in counts) counts[r._id as CustomerStatus] += r.count;
  }
  sendResponse(res, 200, true, 'OK', counts);
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.findById(req.params.id)
    .populate('assignedSale', USER_REF_FIELDS)
    .lean();
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'OK', customer);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  // Lớp mới luôn bắt đầu ở `new` (default của schema)
  const data = pickEditable(req);
  if (typeof data === 'string') {
    sendResponse(res, 400, false, data);
    return;
  }
  const payload: Record<string, unknown> = { ...data, createdBy: req.user!._id };
  if (!payload.season) {
    payload.season = await resolveCurrentSeason();
  }
  const customer = await Customer.create(payload);
  sendResponse(res, 201, true, 'Tạo khách hàng thành công', customer);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const data = pickEditable(req);
  if (typeof data === 'string') {
    sendResponse(res, 400, false, data);
    return;
  }
  const customer = await Customer.findByIdAndUpdate(
    req.params.id,
    { $set: data },
    { new: true, runValidators: true },
  ).lean();
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Cập nhật thành công', customer);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.findByIdAndDelete(req.params.id);
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  await CustomerActivity.deleteMany({ customer: customer._id });
  sendResponse(res, 200, true, 'Đã xóa khách hàng');
};

export const getActivities = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const activities = await CustomerActivity.find({ customer: req.params.id })
    .populate('createdBy', USER_REF_FIELDS)
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  sendResponse(res, 200, true, 'OK', activities);
};

export const addNote = async (req: Request, res: Response): Promise<void> => {
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (!note) {
    sendResponse(res, 400, false, 'Ghi chú không được để trống');
    return;
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const customer = await Customer.findById(req.params.id).select('status assignedSale').lean();
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const userId = String(req.user!._id);
  const allowed =
    isAdmin(req) ||
    (customer.assignedSale ? String(customer.assignedSale) === userId : isSale(req));
  if (!allowed) {
    sendResponse(res, 403, false, 'Bạn không phụ trách lớp này');
    return;
  }
  const activity = await CustomerActivity.create({
    customer: customer._id,
    kind: 'note',
    toStatus: customer.status ?? 'new',
    note,
    createdBy: req.user!._id,
  });
  await activity.populate('createdBy', USER_REF_FIELDS);
  sendResponse(res, 201, true, 'Đã thêm ghi chú', activity);
};

interface StatusBody {
  status?: string;
  note?: string;
  lostReason?: string;
  assignedSale?: string | null;
  deposit?: { amount?: number | string; date?: string };
  schedule?: {
    package?: string;
    shootDate?: string;
    startTime?: string;
    endTime?: string;
    location?: string;
    leadPhotographer?: string;
    supportPhotographers?: string[];
  };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const findDepositCategory = async (userId: Types.ObjectId) =>
  (await Category.findOne({ type: 'income', name: DEPOSIT_CATEGORY_NAME })) ??
  (await Category.findOne({ type: 'income', name: DEPOSIT_CATEGORY_REGEX }).sort({
    createdAt: 1,
  })) ??
  (await Category.findOneAndUpdate(
    { type: 'income', name: DEPOSIT_CATEGORY_NAME },
    { $setOnInsert: { type: 'income', name: DEPOSIT_CATEGORY_NAME, createdBy: userId } },
    { upsert: true, new: true },
  ));

export const changeStatus = async (req: Request, res: Response): Promise<void> => {
  const body = (req.body ?? {}) as StatusBody;
  const target = body.status as CustomerStatus;
  if (!CUSTOMER_STATUSES.includes(target)) {
    sendResponse(res, 400, false, 'Trạng thái không hợp lệ');
    return;
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) {
    sendResponse(res, 400, false, 'Cần ghi chú khi đổi trạng thái');
    return;
  }
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const customer = await Customer.findById(req.params.id).lean();
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }

  const current: CustomerStatus = customer.status ?? 'new';
  if (current === target) {
    sendResponse(res, 400, false, 'Lớp đã ở trạng thái này');
    return;
  }

  const user = req.user!;
  const userId = String(user._id);
  const assignedId = customer.assignedSale ? String(customer.assignedSale) : null;
  const admin = isAdmin(req);
  // Sale nhận lớp chưa có người phụ trách ở các bước trước cọc
  const claims = !assignedId && isSale(req) && PRE_DEPOSIT.includes(current);

  // ── Phân quyền ──
  if (!admin) {
    if (current === 'lost') {
      sendResponse(res, 403, false, 'Chỉ admin mới được mở lại lớp không chốt');
      return;
    }
    const next = CUSTOMER_STATUS_ORDER[CUSTOMER_STATUS_ORDER.indexOf(current) + 1];
    const isNextStep = target === next;
    const isLost = target === 'lost' && PRE_DEPOSIT.includes(current);
    if (!isNextStep && !isLost) {
      sendResponse(res, 403, false, 'Chỉ admin mới được chuyển lùi hoặc nhảy bước');
      return;
    }
    if (!claims && assignedId !== userId) {
      if (assignedId && current === 'new' && target === 'contacting' && isSale(req)) {
        sendResponse(res, 409, false, 'Lớp đã có sale phụ trách');
        return;
      }
      let photographerOk = false;
      if (current === 'scheduled' && target === 'shot' && user.roles.includes(3)) {
        photographerOk = Boolean(
          await Schedule.exists({
            customer: customer._id,
            status: { $ne: 'cancelled' },
            $or: [{ leadPhotographer: user._id }, { supportPhotographers: user._id }],
          }),
        );
      }
      if (!photographerOk) {
        const msg =
          !assignedId && current === 'new' && target === 'contacting'
            ? 'Chỉ sale mới được nhận lớp'
            : 'Bạn không phụ trách lớp này';
        sendResponse(res, 403, false, msg);
        return;
      }
    }
  }

  // ── Validate dữ liệu theo trạng thái đích ──
  const lostReason = typeof body.lostReason === 'string' ? body.lostReason.trim() : '';
  if (target === 'lost' && !lostReason) {
    sendResponse(res, 400, false, 'Cần nhập lý do không chốt');
    return;
  }

  // Admin có thể gán / đổi sale phụ trách khi đổi trạng thái
  let newAssigned: Types.ObjectId | null | undefined;
  if (admin && Object.prototype.hasOwnProperty.call(body, 'assignedSale')) {
    const v = body.assignedSale;
    if (v === null || v === '') newAssigned = null;
    else if (typeof v === 'string' && mongoose.isValidObjectId(v))
      newAssigned = new Types.ObjectId(v);
    else {
      sendResponse(res, 400, false, 'assignedSale không hợp lệ');
      return;
    }
  } else if (claims) {
    newAssigned = user._id as Types.ObjectId;
  }

  let deposit: { amount: number; date: Date } | null = null;
  if (target === 'deposited') {
    const amount = Number(body.deposit?.amount);
    const date = body.deposit?.date ? new Date(body.deposit.date) : null;
    if (!(amount > 0) || !date || Number.isNaN(date.getTime())) {
      sendResponse(res, 400, false, 'Cần nhập số tiền cọc và ngày cọc hợp lệ');
      return;
    }
    deposit = { amount, date };
    if (body.schedule && !body.schedule.shootDate) {
      sendResponse(res, 400, false, 'Cần ngày chụp để tạo lịch chụp');
      return;
    }
  }

  // ── Đổi trạng thái NGUYÊN TỬ: chỉ khớp nếu status + sale vẫn như lúc đọc ──
  const set: Record<string, unknown> = { status: target, statusChangedAt: new Date() };
  const unset: Record<string, ''> = {};
  if (target === 'lost') set.lostReason = lostReason;
  else unset.lostReason = '';
  if (deposit) {
    set['deposit.amount'] = deposit.amount;
    set['deposit.date'] = deposit.date;
  }
  if (newAssigned !== undefined) set.assignedSale = newAssigned;
  const written = await Customer.updateOne(
    {
      _id: customer._id,
      status: current === 'new' ? { $in: ['new', null] } : current,
      assignedSale: customer.assignedSale ?? null,
    },
    { $set: set, $unset: unset },
  );
  if (!written.matchedCount) {
    sendResponse(res, 409, false, CONFLICT_MESSAGE);
    return;
  }

  const activity = await CustomerActivity.create({
    customer: customer._id,
    kind: 'status',
    fromStatus: current,
    toStatus: target,
    note,
    createdBy: user._id,
  });
  await activity.populate('createdBy', USER_REF_FIELDS);

  // ── Side effect khi chốt cọc: lỗi không làm hỏng request, trả về dạng cảnh báo ──
  const warnings: string[] = [];
  let schedule: ISchedule | null = null;
  let transaction: ITransaction | null = null;

  if (deposit) {
    let hasContract = false;
    try {
      const active = await Schedule.find({ customer: customer._id, status: { $ne: 'cancelled' } })
        .select('contractUrl')
        .lean();
      hasContract = active.some((s) => s.contractUrl);
      if (!active.length && body.schedule) {
        const s = body.schedule;
        schedule = await createScheduleWithSideEffects({
          customer: customer._id,
          package: s.package || null,
          shootDate: s.shootDate,
          startTime: s.startTime,
          endTime: s.endTime,
          location: s.location,
          leadPhotographer: s.leadPhotographer || null,
          supportPhotographers: (s.supportPhotographers ?? []).filter(Boolean),
          bookedBy: user._id,
        });
      } else if (!active.length) {
        warnings.push(NO_SCHEDULE_WARNING);
      }
    } catch (e) {
      console.error('[Customer] tạo lịch chụp khi chốt cọc thất bại:', e);
      warnings.push(`Không tạo được lịch chụp: ${errMsg(e)}`);
    }

    try {
      // Đã có giao dịch cọc liên kết (admin chuyển qua lại) → cập nhật thay vì tạo mới
      const linkedId = customer.deposit?.transactionId;
      if (linkedId) {
        transaction = await Transaction.findByIdAndUpdate(
          linkedId,
          { $set: { amount: deposit.amount, date: deposit.date } },
          { new: true },
        );
      }
      if (!transaction) {
        const category = (await findDepositCategory(user._id as Types.ObjectId))!;
        transaction = await Transaction.create({
          customer: customer._id,
          type: 'income',
          amount: deposit.amount,
          categoryId: category._id,
          description: `Tiền cọc – ${customer.className} ${customer.school ?? ''}`.trim(),
          date: deposit.date,
          season: customer.season ?? null,
          createdBy: user._id,
        });
        await Customer.updateOne(
          { _id: customer._id },
          { $set: { 'deposit.transactionId': transaction._id } },
        );
      }
    } catch (e) {
      console.error('[Customer] tạo giao dịch tiền cọc thất bại:', e);
      warnings.push(`Không tạo được giao dịch tiền cọc: ${errMsg(e)}`);
    }

    // Lịch chụp đã có hợp đồng từ trước → hook contractUrl sẽ không chạy nữa, tự chuyển luôn
    if (hasContract) {
      try {
        const moved = await Customer.updateOne(
          { _id: customer._id, status: 'deposited' },
          { $set: { status: 'scheduled', statusChangedAt: new Date() } },
        );
        if (moved.modifiedCount) {
          await CustomerActivity.create({
            customer: customer._id,
            kind: 'system',
            fromStatus: 'deposited',
            toStatus: 'scheduled',
            note: 'Đã có hợp đồng',
            createdBy: user._id,
          });
        }
      } catch (e) {
        console.error('[Customer] tự chuyển sang Chưa chụp thất bại:', e);
        warnings.push(`Không tự chuyển được sang "Chưa chụp": ${errMsg(e)}`);
      }
    }
  }

  const updated = await Customer.findById(customer._id)
    .populate('assignedSale', USER_REF_FIELDS)
    .lean();

  sendResponse(res, 200, true, 'Đã cập nhật trạng thái', {
    customer: updated,
    activity,
    schedule,
    transaction,
    warnings,
  });

  // ── Báo admin khi chốt cọc (chạy nền, không làm hỏng request) ──
  if (deposit) {
    const saleName = escapeHtml(user.name || user.username);
    const text =
      `💰 <b>Lớp chốt cọc</b>\n` +
      `👥 ${escapeHtml(customer.className)}` +
      `${customer.school ? ` - ${escapeHtml(customer.school)}` : ''}\n` +
      `💵 ${deposit.amount.toLocaleString('vi-VN')}đ\n` +
      `🧑‍💼 Sale: ${saleName}`;
    void notifyByRoles([0, 1], text).catch((e: unknown) =>
      console.error('[Telegram] thông báo chốt cọc thất bại:', e),
    );
  }
};
