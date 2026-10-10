import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import ExternalPhotographer from '../models/ExternalPhotographer';
import { sendResponse } from '../utils/response';

const parseBody = (body: Record<string, unknown>) => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const fee = body.defaultFee === '' || body.defaultFee == null ? null : Number(body.defaultFee);
  if (!name) return { error: 'Vui lòng nhập tên thợ ngoài' };
  if (fee !== null && (!Number.isFinite(fee) || fee < 0)) {
    return { error: 'Chi phí mặc định phải là số không âm' };
  }
  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    return { error: 'Trạng thái hoạt động không hợp lệ' };
  }
  return {
    value: {
      name,
      phone,
      notes,
      defaultFee: fee,
      ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
    },
  };
};

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const rows = await ExternalPhotographer.find().sort({ isActive: -1, name: 1 }).lean();
  sendResponse(res, 200, true, 'OK', rows);
};

/** Safe names for schedule filters; contact and fee remain admin-only. */
export const getChoices = async (_req: Request, res: Response): Promise<void> => {
  const rows = await ExternalPhotographer.find()
    .select('_id name isActive')
    .sort({ name: 1 })
    .lean();
  sendResponse(res, 200, true, 'OK', rows);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const parsed = parseBody(req.body ?? {});
  if (parsed.error) {
    sendResponse(res, 400, false, parsed.error);
    return;
  }
  const row = await ExternalPhotographer.create(parsed.value);
  sendResponse(res, 201, true, 'Đã thêm thợ ngoài', row);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  if (!isValidObjectId(req.params.id)) {
    sendResponse(res, 400, false, 'Thợ ngoài không hợp lệ');
    return;
  }
  const parsed = parseBody(req.body ?? {});
  if (parsed.error) {
    sendResponse(res, 400, false, parsed.error);
    return;
  }
  const row = await ExternalPhotographer.findByIdAndUpdate(req.params.id, parsed.value, {
    new: true,
    runValidators: true,
  });
  if (!row) {
    sendResponse(res, 404, false, 'Không tìm thấy thợ ngoài');
    return;
  }
  sendResponse(res, 200, true, 'Đã cập nhật thợ ngoài', row);
};
