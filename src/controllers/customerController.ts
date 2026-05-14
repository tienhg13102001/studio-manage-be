import { Request, Response } from 'express';
import Customer from '../models/Customer';
import { sendResponse } from '../utils/response';

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const { search, page = '1', limit = '20' } = req.query as Record<string, string>;
  const query = search ? { $text: { $search: search } } : {};
  const skip = (Number(page) - 1) * Number(limit);
  const [data, total] = await Promise.all([
    Customer.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Customer.countDocuments(query),
  ]);
  sendResponse(res, 200, true, 'OK', data, { total, page: Number(page), limit: Number(limit) });
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'OK', customer);
};

export const create = async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.create({ ...req.body, createdBy: req.user!._id });
  sendResponse(res, 201, true, 'Tạo khách hàng thành công', customer);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Cập nhật thành công', customer);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.findByIdAndDelete(req.params.id);
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'Đã xóa khách hàng');
};
