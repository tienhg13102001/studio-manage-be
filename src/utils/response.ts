import { Response } from 'express';

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  [key: string]: unknown;
}

export const sendResponse = <T = unknown>(
  res: Response,
  statusCode: number,
  success: boolean,
  message: string,
  data: T | null = null,
  pagination: PaginationMeta | null = null,
) => {
  return res.status(statusCode).json({
    success,
    message,
    data,
    ...(pagination && { pagination }),
  });
};
