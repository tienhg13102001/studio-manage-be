import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import ProfitScenario from '../models/ProfitScenario';
import Package from '../models/Package';
import Schedule from '../models/Schedule';
import { sendResponse } from '../utils/response';

const NUMBER_FIELDS = [
  ['pricePerMember', 'Giá / học sinh'],
  ['students', 'Sĩ số'],
  ['crewCount', 'Số thợ'],
  ['crewRate', 'Tiền công / thợ'],
  ['videoCrewCount', 'Số thợ quay'],
  ['videoCrewRate', 'Tiền công / thợ quay'],
  ['printCostPerStudent', 'Chi phí in / học sinh'],
  ['costumeCost', 'Chi phí trang phục'],
] as const;

const toAmount = (v: unknown): number | null => {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const parseBody = async (body: Record<string, unknown>) => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'Vui lòng nhập tên kịch bản' };
  const value: Record<string, unknown> = { name };
  for (const [key, label] of NUMBER_FIELDS) {
    const n = toAmount(body[key]);
    if (n === null) return { error: `${label} phải là số không âm` };
    if (
      (key === 'students' || key === 'crewCount' || key === 'videoCrewCount') &&
      !Number.isInteger(n)
    ) {
      return { error: `${label} phải là số nguyên` };
    }
    value[key] = n;
  }
  const pkg = body.package;
  if (pkg === '' || pkg == null) value.package = null;
  else if (typeof pkg === 'string' && isValidObjectId(pkg) && (await Package.exists({ _id: pkg })))
    value.package = pkg;
  else return { error: 'Gói chụp không tồn tại' };
  const sch = body.schedule;
  if (sch === '' || sch == null) value.schedule = null;
  else if (typeof sch === 'string' && isValidObjectId(sch) && (await Schedule.exists({ _id: sch })))
    value.schedule = sch;
  else return { error: 'Lịch chụp không tồn tại' };
  if (body.otherCosts !== undefined && !Array.isArray(body.otherCosts)) {
    return { error: 'Chi phí khác không hợp lệ' };
  }
  const otherCosts: { label: string; amount: number }[] = [];
  for (const raw of (body.otherCosts as unknown[] | undefined) ?? []) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const amount = toAmount(row.amount);
    if (amount === null) return { error: 'Khoản chi khác phải là số không âm' };
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (label || amount) otherCosts.push({ label, amount });
  }
  value.otherCosts = otherCosts;
  for (const [key, label] of [
    ['printItems', 'In ấn'],
    ['costumeItems', 'Trang phục'],
    ['travelItems', 'Đi lại & ăn uống'],
  ] as const) {
    const raw = body[key];
    if (raw !== undefined && !Array.isArray(raw)) return { error: `${label} không hợp lệ` };
    if (Array.isArray(raw) && raw.length > 50) return { error: `${label}: tối đa 50 dòng` };
    const items: { label: string; unitPrice: number; quantity: number; unit: string }[] = [];
    for (const r of (raw as unknown[] | undefined) ?? []) {
      const row = (r ?? {}) as Record<string, unknown>;
      const unitPrice = toAmount(row.unitPrice);
      const quantity = toAmount(row.quantity);
      if (unitPrice === null || quantity === null) {
        return { error: `${label}: đơn giá và số lượng phải là số không âm` };
      }
      const unit = row.unit === 'class' || row.unit === 'crew' ? row.unit : 'student';
      const name = typeof row.label === 'string' ? row.label.trim().slice(0, 200) : '';
      if (name || unitPrice) items.push({ label: name, unitPrice, quantity, unit });
    }
    value[key] = items;
  }
  return { value };
};

const USER_REF_FIELDS = 'name username';
const PACKAGE_REF_FIELDS = 'name pricePerMember studentsPerCrew hasMv';

const SCHEDULE_REF = {
  path: 'schedule',
  select: 'shootDate customer',
  populate: { path: 'customer', select: 'className' },
};

type PopulatedClassSchedule = {
  _id: unknown;
  shootDate: Date;
  package?: { _id: unknown } | null;
  leadPhotographer?: unknown;
  supportPhotographers?: unknown[];
  videographer?: unknown;
  externalCrew?: { role: string }[];
  customer?: {
    _id: unknown;
    className: string;
    total?: number;
    schoolId?: { name?: string } | null;
    contract?: {
      package?: unknown;
      pricePerMember?: number | null;
      total?: number | null;
      crewCount?: number | null;
      videoCrewCount?: number | null;
      printed?: { total?: number } | null;
    } | null;
  } | null;
};

/** Lớp đã có lịch chụp (đang hoạt động) để tính lãi theo số liệu thật. */
export const getClasses = async (req: Request, res: Response): Promise<void> => {
  const season = typeof req.query.season === 'string' ? req.query.season : '';
  const filter: Record<string, unknown> = { status: 'active' };
  if (season && isValidObjectId(season)) filter.season = season;
  const schedules = (await Schedule.find(filter)
    .select(
      'shootDate package customer leadPhotographer supportPhotographers videographer externalCrew',
    )
    .populate({
      path: 'customer',
      select:
        'className total schoolId contract.package contract.pricePerMember contract.total contract.crewCount contract.videoCrewCount contract.printed.total',
      populate: { path: 'schoolId', select: 'name' },
    })
    .sort({ shootDate: -1 })
    .limit(500)
    .lean()) as unknown as PopulatedClassSchedule[];
  const rows = schedules
    .filter((s) => s.customer)
    .map((s) => {
      const c = s.customer!;
      const ext = s.externalCrew ?? [];
      const photo =
        (s.leadPhotographer ? 1 : 0) +
        (s.supportPhotographers?.length ?? 0) +
        ext.filter((e) => e.role !== 'video').length;
      const video = (s.videographer ? 1 : 0) + ext.filter((e) => e.role === 'video').length;
      return {
        scheduleId: s._id,
        customerId: c._id,
        className: c.className,
        school: c.schoolId?.name ?? '',
        shootDate: s.shootDate,
        package: c.contract?.package ?? s.package?._id ?? s.package ?? null,
        pricePerMember: c.contract?.pricePerMember ?? null,
        contractTotal: c.contract?.total ?? null,
        students: c.contract?.printed?.total || c.total || 0,
        crewAssigned: photo,
        videoAssigned: video,
        crewCount: c.contract?.crewCount ?? null,
        videoCrewCount: c.contract?.videoCrewCount ?? null,
      };
    });
  sendResponse(res, 200, true, 'OK', rows);
};

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const rows = await ProfitScenario.find()
    .populate(SCHEDULE_REF)
    .populate('package', PACKAGE_REF_FIELDS)
    .populate('createdBy', USER_REF_FIELDS)
    .sort({ updatedAt: -1 })
    .lean();
  sendResponse(res, 200, true, 'OK', rows);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const parsed = await parseBody(req.body ?? {});
  if (parsed.error) {
    sendResponse(res, 400, false, parsed.error);
    return;
  }
  const created = await ProfitScenario.create({ ...parsed.value, createdBy: req.user!._id });
  const row = await ProfitScenario.findById(created._id)
    .populate('package', PACKAGE_REF_FIELDS)
    .populate('createdBy', USER_REF_FIELDS)
    .populate(SCHEDULE_REF)
    .lean();
  sendResponse(res, 201, true, 'Đã lưu kịch bản', row);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  if (!isValidObjectId(req.params.id)) {
    sendResponse(res, 400, false, 'Kịch bản không hợp lệ');
    return;
  }
  const parsed = await parseBody(req.body ?? {});
  if (parsed.error) {
    sendResponse(res, 400, false, parsed.error);
    return;
  }
  const row = await ProfitScenario.findByIdAndUpdate(req.params.id, parsed.value, {
    new: true,
    runValidators: true,
  })
    .populate('package', PACKAGE_REF_FIELDS)
    .populate('createdBy', USER_REF_FIELDS)
    .populate(SCHEDULE_REF)
    .lean();
  if (!row) {
    sendResponse(res, 404, false, 'Không tìm thấy kịch bản');
    return;
  }
  sendResponse(res, 200, true, 'Đã cập nhật kịch bản', row);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  if (!isValidObjectId(req.params.id)) {
    sendResponse(res, 400, false, 'Kịch bản không hợp lệ');
    return;
  }
  const row = await ProfitScenario.findByIdAndDelete(req.params.id);
  if (!row) {
    sendResponse(res, 404, false, 'Không tìm thấy kịch bản');
    return;
  }
  sendResponse(res, 200, true, 'Đã xoá kịch bản', null);
};
