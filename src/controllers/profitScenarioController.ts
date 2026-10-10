import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import ProfitScenario from '../models/ProfitScenario';
import Package from '../models/Package';
import { sendResponse } from '../utils/response';

const NUMBER_FIELDS = [
  ['pricePerMember', 'Giá / học sinh'],
  ['students', 'Sĩ số'],
  ['crewCount', 'Số thợ'],
  ['crewRate', 'Tiền công / thợ'],
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
    if ((key === 'students' || key === 'crewCount') && !Number.isInteger(n)) {
      return { error: `${label} phải là số nguyên` };
    }
    value[key] = n;
  }
  const pkg = body.package;
  if (pkg === '' || pkg == null) value.package = null;
  else if (typeof pkg === 'string' && isValidObjectId(pkg) && (await Package.exists({ _id: pkg })))
    value.package = pkg;
  else return { error: 'Gói chụp không tồn tại' };
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
  return { value };
};

const USER_REF_FIELDS = 'name username';
const PACKAGE_REF_FIELDS = 'name pricePerMember studentsPerCrew';

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const rows = await ProfitScenario.find()
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
