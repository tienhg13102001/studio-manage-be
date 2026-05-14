import { Request, Response } from 'express';
import Costume from '../models/Costume';
import { sendResponse } from '../utils/response';

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const costumes = await Costume.find().populate('type').sort({ name: 1 });
  sendResponse(res, 200, true, 'OK', costumes);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const costume = await Costume.create(req.body);
  sendResponse(res, 201, true, 'Tạo trang phục thành công', costume);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const costume = await Costume.findByIdAndUpdate(req.params.id, req.body, {
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
  const costume = await Costume.findByIdAndDelete(req.params.id);
  if (!costume) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Đã xóa trang phục');
};
