import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Types, isValidObjectId } from 'mongoose';
import Customer from '../models/Customer';
import { isSaleCollaborator } from './permissions';
import { sendResponse } from './response';

/**
 * Phạm vi lớp mà user được xem: Cộng tác viên sale chỉ thấy lớp mình tạo hoặc phụ trách.
 * `null` = không giới hạn.
 */
export const customerScope = (req: Request): Record<string, unknown> | null => {
  if (!isSaleCollaborator(req.user)) return null;
  const id = req.user!._id as Types.ObjectId;
  return { $or: [{ createdBy: id }, { assignedSale: id }] };
};

/** Id các lớp user được xem, `null` = không giới hạn. */
export const accessibleCustomerIds = async (req: Request): Promise<Types.ObjectId[] | null> => {
  const scope = customerScope(req);
  return scope ? Customer.find(scope).distinct('_id') : null;
};

export const canAccessCustomer = async (req: Request, customerId: unknown): Promise<boolean> => {
  const scope = customerScope(req);
  if (!scope) return true;
  if (!customerId || !isValidObjectId(customerId)) return false;
  return Boolean(await Customer.exists({ _id: customerId, ...scope }));
};

/**
 * Middleware chặn truy cập tài nguyên thuộc lớp ngoài phạm vi (trả 404 để không lộ lớp tồn tại).
 * `resolveCustomer` trả id lớp của tài nguyên; `undefined` = tài nguyên không tồn tại → để handler xử lý.
 */
export const requireCustomerAccess =
  (resolveCustomer: (req: Request) => Promise<unknown> | unknown): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!customerScope(req)) {
      next();
      return;
    }
    Promise.resolve(resolveCustomer(req))
      .then(async (customerId) => {
        if (customerId === undefined || (await canAccessCustomer(req, customerId))) next();
        else sendResponse(res, 404, false, 'Not found');
      })
      .catch(next);
  };
