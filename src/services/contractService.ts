import type { Types } from 'mongoose';
import Customer from '../models/Customer';
import CustomerActivity from '../models/CustomerActivity';
import Schedule from '../models/Schedule';

// Apps Script có thể chờ lock tối đa 20s + thời gian mở/sửa doc
const TIMEOUT_MS = 45_000;

/** Gọi action `updateDeposit` của Apps Script hợp đồng (Code_create_HD.gs). */
const callUpdateDeposit = async (
  url: string,
  secret: string,
  payload: { documentId: string; depositAmount: number | null; totalPayment: number },
): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'updateDeposit',
        secret,
        ...payload,
      }),
      redirect: 'follow',
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    let data: { success?: boolean; reason?: string; message?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'phản hồi không phải JSON' };
    }
    return data.success ? { ok: true } : { ok: false, reason: data.reason ?? data.message ?? '?' };
  } catch (e) {
    return { ok: false, reason: controller.signal.aborted ? 'quá thời gian' : String(e) };
  } finally {
    clearTimeout(timeout);
  }
};

export interface ContractSyncResult {
  /** Số hợp đồng đã cập nhật thành công. */
  updated: number;
  /** Lý do lỗi của các hợp đồng cập nhật thất bại. */
  failed: string[];
  /** Bỏ qua vì thiếu cấu hình env. */
  skipped?: boolean;
}

const runSync = async (
  customerId: string,
  userId?: Types.ObjectId | string,
  scheduleId?: string,
): Promise<ContractSyncResult> => {
  const result: ContractSyncResult = { updated: 0, failed: [] };
  try {
    const url = process.env.CONTRACT_SCRIPT_URL ?? '';
    const secret = process.env.CONTRACT_SCRIPT_SECRET ?? '';
    const customer = await Customer.findById(customerId).select('deposit').lean();
    if (!customer) return result;
    const raw = Number(customer.deposit?.amount);
    const amount = Number.isFinite(raw) && raw > 0 ? raw : null;

    const schedules = await Schedule.find({
      customer: customer._id,
      status: { $ne: 'cancelled' },
      contractDocId: { $nin: [null, ''] },
      ...(scheduleId ? { _id: scheduleId } : {}),
    })
      .select('contractDocId contractTotal contractDepositAmount')
      .lean();
    const stale = schedules.filter((s) => (s.contractDepositAmount ?? null) !== amount);
    if (!stale.length) return result;
    if (!url || !secret) {
      console.warn(
        '[Contract] CONTRACT_SCRIPT_URL / CONTRACT_SCRIPT_SECRET chưa cấu hình → bỏ qua cập nhật tiền cọc hợp đồng',
      );
      return { ...result, skipped: true };
    }

    for (const s of stale) {
      const res = await callUpdateDeposit(url, secret, {
        documentId: s.contractDocId!,
        depositAmount: amount,
        totalPayment: Number(s.contractTotal) || 0,
      });
      if (res.ok) {
        await Schedule.updateOne(
          { _id: s._id },
          {
            $set: {
              contractDepositAmount: amount,
              contractDepositSyncedAt: amount === null ? null : new Date(),
            },
          },
        );
        result.updated++;
      } else {
        result.failed.push(res.reason);
        console.error(
          `[Contract] cập nhật tiền cọc hợp đồng ${s.contractDocId} thất bại:`,
          res.reason,
        );
        await CustomerActivity.create({
          customer: customer._id,
          kind: 'system',
          note: `Không cập nhật được tiền cọc trên hợp đồng (${res.reason})`,
          ...(userId ? { createdBy: userId } : {}),
        });
      }
    }
  } catch (e) {
    console.error('[Contract] đồng bộ tiền cọc hợp đồng thất bại:', e);
    result.failed.push(String(e));
  }
  return result;
};

// Mỗi lớp chỉ chạy một lượt đồng bộ tại một thời điểm; lượt mới xếp sau lượt đang chạy
// (để đọc tiền cọc mới nhất) thay vì gọi Apps Script song song.
const inFlight = new Map<string, Promise<ContractSyncResult>>();

/**
 * Sau khi tiền cọc của lớp thay đổi / vừa lưu `contractDocId`: cập nhật ô "Tiền cọc" + "Đợt 2"
 * trên các hợp đồng đã tạo (lịch chưa huỷ có `contractDocId`, hoặc chỉ lịch `scheduleId`)
 * nếu số tiền đang in khác tiền cọc hiện tại.
 * Không bao giờ throw — lỗi được log và ghi vào lịch sử chăm sóc lớp.
 * Cần env CONTRACT_SCRIPT_URL + CONTRACT_SCRIPT_SECRET; thiếu → bỏ qua (cảnh báo).
 */
export const syncContractDeposit = (
  customerId: Types.ObjectId | string,
  userId?: Types.ObjectId | string,
  scheduleId?: string,
): Promise<ContractSyncResult> => {
  const key = String(customerId);
  const prev = inFlight.get(key) ?? Promise.resolve(null);
  const next = prev.then(() => runSync(key, userId, scheduleId));
  inFlight.set(key, next);
  void next.finally(() => {
    if (inFlight.get(key) === next) inFlight.delete(key);
  });
  return next;
};
