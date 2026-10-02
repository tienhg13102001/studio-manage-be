import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Costume from '../models/Costume';
import { sendResponse } from '../utils/response';

/** type rỗng ('') → null = "Không phân loại" (tránh CastError khi lưu) */
const normalizeBody = (body: Record<string, unknown>) =>
  body?.type === '' ? { ...body, type: null } : body;

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const costumes = await Costume.find().populate('type').sort({ name: 1 });
  sendResponse(res, 200, true, 'OK', costumes);
};

/** type khác rỗng nhưng không phải ObjectId → lỗi 400 thay vì CastError */
const hasInvalidType = (body: Record<string, unknown>) =>
  body?.type !== undefined &&
  body.type !== null &&
  body.type !== '' &&
  !mongoose.isValidObjectId(body.type);

export const create = async (req: Request, res: Response): Promise<void> => {
  if (hasInvalidType(req.body)) {
    sendResponse(res, 400, false, 'Loại trang phục không hợp lệ');
    return;
  }
  const costume = await Costume.create(normalizeBody(req.body));
  sendResponse(res, 201, true, 'Tạo trang phục thành công', costume);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 400, false, 'ID không hợp lệ');
    return;
  }
  if (hasInvalidType(req.body)) {
    sendResponse(res, 400, false, 'Loại trang phục không hợp lệ');
    return;
  }
  const costume = await Costume.findByIdAndUpdate(req.params.id, normalizeBody(req.body), {
    new: true,
    runValidators: true,
  });
  if (!costume) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Cập nhật thành công', costume);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 400, false, 'ID không hợp lệ');
    return;
  }
  const costume = await Costume.findByIdAndDelete(req.params.id);
  if (!costume) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Đã xóa trang phục');
};
