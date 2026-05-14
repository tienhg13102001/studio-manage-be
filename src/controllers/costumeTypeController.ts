import { Request, Response } from 'express';
import CostumeType from '../models/CostumeType';
import { sendResponse } from '../utils/response';

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const types = await CostumeType.find().sort({ name: 1 });
  sendResponse(res, 200, true, 'OK', types);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const type = await CostumeType.create(req.body);
  sendResponse(res, 201, true, 'Tạo loại trang phục thành công', type);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const type = await CostumeType.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!type) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Cập nhật thành công', type);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const type = await CostumeType.findByIdAndDelete(req.params.id);
  if (!type) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Đã xóa loại trang phục');
};
