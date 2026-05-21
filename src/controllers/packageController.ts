import { Request, Response } from 'express';
import Package from '../models/Package';
import { sendResponse } from '../utils/response';

export const getAll = async (_req: Request, res: Response): Promise<void> => {
  const packages = await Package.find().sort({ name: 1 }).populate('costumes').lean();
  sendResponse(res, 200, true, 'OK', packages);
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const pkg = await Package.findById(req.params.id).populate('costumes').lean();
  if (!pkg) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'OK', pkg);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const pkg = await Package.create(req.body);
  sendResponse(res, 201, true, 'Tạo gói chụp thành công', pkg);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const pkg = await Package.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!pkg) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Cập nhật thành công', pkg);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  await Package.findByIdAndDelete(req.params.id);
  sendResponse(res, 200, true, 'Đã xóa gói chụp');
};
