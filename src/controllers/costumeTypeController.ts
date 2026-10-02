import { Request, Response } from 'express';
import mongoose from 'mongoose';
import CostumeType from '../models/CostumeType';
import Costume from '../models/Costume';
import Package from '../models/Package';
import { sendResponse } from '../utils/response';

const USAGE_NAME_LIMIT = 3;

/** Giống hệt normalizeTypeName ở frontend (components/organisms/costumes/utils.ts) */
const normalizeTypeName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');

/** Chỉ nhận name + description; trả về thông báo lỗi nếu tên rỗng */
const parseBody = (body: Record<string, unknown>) => {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : undefined;
  return { name, description };
};

const isDuplicateName = async (name: string, excludeId?: string) => {
  const key = normalizeTypeName(name);
  const others = await CostumeType.find(
    excludeId ? { _id: { $ne: excludeId } } : {},
    'name',
  ).lean();
  return others.some((t) => normalizeTypeName(t.name) === key);
};

const getUsageOf = async (id: string) => {
  const [costumeCount, packageCount, costumes, packages] = await Promise.all([
    Costume.countDocuments({ type: id }),
    Package.countDocuments({ costumes: id }),
    Costume.find({ type: id }).sort({ name: 1 }).limit(USAGE_NAME_LIMIT).select('name'),
    Package.find({ costumes: id }).sort({ name: 1 }).limit(USAGE_NAME_LIMIT).select('name'),
  ]);
  return {
    costumeCount,
    packageCount,
    costumeNames: costumes.map((c) => c.name),
    packageNames: packages.map((p) => p.name),
  };
};

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const types = await CostumeType.find().sort({ name: 1 });
  sendResponse(res, 200, true, 'OK', types);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const { name, description } = parseBody(req.body);
  if (!name) {
    sendResponse(res, 400, false, 'Tên loại không được để trống');
    return;
  }
  if (await isDuplicateName(name)) {
    sendResponse(res, 409, false, 'Loại trang phục đã tồn tại');
    return;
  }
  const type = await CostumeType.create({ name, description });
  sendResponse(res, 201, true, 'Tạo loại trang phục thành công', type);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'ID không hợp lệ');
    return;
  }
  if (!(await CostumeType.exists({ _id: id }))) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const { name, description } = parseBody(req.body);
  if (!name) {
    sendResponse(res, 400, false, 'Tên loại không được để trống');
    return;
  }
  if (await isDuplicateName(name, id)) {
    sendResponse(res, 409, false, 'Loại trang phục đã tồn tại');
    return;
  }
  const type = await CostumeType.findByIdAndUpdate(
    id,
    { name, ...(description !== undefined && { description }) },
    { new: true, runValidators: true },
  );
  if (!type) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Cập nhật thành công', type);
};

export const getUsage = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'ID không hợp lệ');
    return;
  }
  if (!(await CostumeType.exists({ _id: id }))) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'OK', await getUsageOf(id));
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'ID không hợp lệ');
    return;
  }
  if (!(await CostumeType.exists({ _id: id }))) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const usage = await getUsageOf(id);
  if (usage.costumeCount > 0 || usage.packageCount > 0) {
    sendResponse(res, 409, false, 'Loại trang phục đang được sử dụng', usage);
    return;
  }
  await CostumeType.findByIdAndDelete(id);
  sendResponse(res, 200, true, 'Đã xóa loại trang phục');
};
