import { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 4 không bắt lỗi của handler async → chuyển lỗi sang global error handler */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
