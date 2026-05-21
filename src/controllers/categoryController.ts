import { Request, Response } from 'express';
import Category from '../models/Category';
import { sendResponse } from '../utils/response';

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const { type } = req.query as { type?: 'income' | 'expense' };
  const filter: Record<string, unknown> = type ? { type } : {};
  const cats = await Category.find(filter).sort({ type: 1, name: 1 }).lean();
  sendResponse(res, 200, true, 'OK', cats);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const cat = await Category.create({ ...req.body, createdBy: req.user!._id });
  sendResponse(res, 201, true, 'Tạo danh mục thành công', cat);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const cat = await Category.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!cat) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Cập nhật thành công', cat);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const cat = await Category.findByIdAndDelete(req.params.id);
  if (!cat) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Đã xóa danh mục');
};
