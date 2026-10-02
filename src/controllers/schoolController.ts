import { Request, Response } from 'express';
import mongoose from 'mongoose';
import School, {
  normalizeSchoolName,
  toSchoolSearchKey,
  SCHOOL_ADDRESS_MAX,
  SCHOOL_NAME_MAX,
  SCHOOL_NOTE_MAX,
} from '../models/School';
import { sendResponse } from '../utils/response';

const SCHOOL_FIELDS = 'name address note createdAt updatedAt';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Lỗi độ dài (tiếng Việt) cho các field gửi lên; undefined = hợp lệ */
const lengthError = (fields: {
  name?: string;
  address?: string;
  note?: string;
}): string | undefined => {
  if (fields.name !== undefined && fields.name.trim().length > SCHOOL_NAME_MAX)
    return `Tên trường tối đa ${SCHOOL_NAME_MAX} ký tự`;
  if (fields.address !== undefined && fields.address.trim().length > SCHOOL_ADDRESS_MAX)
    return `Địa chỉ tối đa ${SCHOOL_ADDRESS_MAX} ký tự`;
  if (fields.note !== undefined && fields.note.trim().length > SCHOOL_NOTE_MAX)
    return `Ghi chú tối đa ${SCHOOL_NOTE_MAX} ký tự`;
  return undefined;
};

const isValidationError = (e: unknown) => e instanceof mongoose.Error.ValidationError;

const isDuplicateKey = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const search = str(req.query.search)?.trim() ?? '';
  const limit = Math.min(Math.max(Number(str(req.query.limit)) || 50, 1), 500);
  const key = search ? toSchoolSearchKey(search) : '';
  const filter = key ? { searchKey: { $regex: escapeRegex(key) } } : {};
  const schools = await School.find(filter)
    .select(SCHOOL_FIELDS)
    .collation({ locale: 'vi' })
    .sort({ name: 1 })
    .limit(limit)
    .lean();
  sendResponse(res, 200, true, 'OK', schools);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const name = str(req.body?.name)?.trim() ?? '';
  if (!name) {
    sendResponse(res, 400, false, 'Vui lòng nhập tên trường');
    return;
  }
  const address = str(req.body?.address);
  const note = str(req.body?.note);
  const tooLong = lengthError({ name, address, note });
  if (tooLong) {
    sendResponse(res, 400, false, tooLong);
    return;
  }
  // Trùng tên (khác hoa/thường/khoảng trắng) → trả về trường đã có thay vì báo lỗi
  const existing = await School.findOne({ nameKey: normalizeSchoolName(name) })
    .select(SCHOOL_FIELDS)
    .lean();
  if (existing) {
    sendResponse(res, 200, true, 'Trường đã tồn tại', existing);
    return;
  }
  try {
    const school = await School.create({ name, address, note });
    const created = await School.findById(school._id).select(SCHOOL_FIELDS).lean();
    sendResponse(res, 201, true, 'Tạo trường thành công', created);
  } catch (e) {
    if (isValidationError(e)) {
      sendResponse(res, 400, false, 'Thông tin trường không hợp lệ');
      return;
    }
    if (!isDuplicateKey(e)) throw e;
    const again = await School.findOne({ nameKey: normalizeSchoolName(name) })
      .select(SCHOOL_FIELDS)
      .lean();
    sendResponse(res, 200, true, 'Trường đã tồn tại', again);
  }
};

export const update = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const school = await School.findById(req.params.id);
  if (!school) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const tooLong = lengthError({
    name: str(body.name),
    address: str(body.address),
    note: str(body.note),
  });
  if (tooLong) {
    sendResponse(res, 400, false, tooLong);
    return;
  }
  if (body.name !== undefined) {
    const name = str(body.name)?.trim() ?? '';
    if (!name) {
      sendResponse(res, 400, false, 'Vui lòng nhập tên trường');
      return;
    }
    school.name = name;
  }
  if (body.address !== undefined) school.address = str(body.address) ?? undefined;
  if (body.note !== undefined) school.note = str(body.note) ?? undefined;
  try {
    await school.save();
  } catch (e) {
    if (isDuplicateKey(e)) {
      sendResponse(res, 409, false, 'Đã có trường trùng tên');
      return;
    }
    if (isValidationError(e)) {
      sendResponse(res, 400, false, 'Thông tin trường không hợp lệ');
      return;
    }
    throw e;
  }
  const updated = await School.findById(school._id).select(SCHOOL_FIELDS).lean();
  sendResponse(res, 200, true, 'Cập nhật thành công', updated);
};
