import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import Customer, {
  CUSTOMER_STATUS_LABELS,
  type CustomerStatus,
  type ICustomer,
  type ICustomerContract,
} from '../models/Customer';
import CustomerActivity from '../models/CustomerActivity';
import Schedule from '../models/Schedule';
import type { IExtraService } from '../models/extraService';
import type { ISeason } from '../models/Season';
import { syncContractDeposit } from '../services/contractService';
import { createFolderAndLog } from '../services/googleSheetService';
import { notifyUsers } from '../services/telegramService';
import { sendResponse } from '../utils/response';

const USER_REF_FIELDS = 'name username';
const SCHOOL_REF_FIELDS = 'name address';

// Tạo hợp đồng lần đầu: mọi bước trước khi chụp (cọc có thể chưa có)
const CONTRACT_STATUSES: CustomerStatus[] = [
  'new',
  'contacting',
  'contacted',
  'deposited',
  'scheduled',
];

const DOC_ID_RE = /^[\w-]{20,}$/;
const CONTRACT_CONFLICT_MSG = 'Hợp đồng vừa được người khác cập nhật — tải lại';
const MAX_EXTRA_SERVICES = 50;

const isAdmin = (req: Request) => req.user!.roles.some((r) => r === 0 || r === 1);

/**
 * Quyền thao tác hợp đồng / folder của lớp: admin, kế toán, sale phụ trách lớp
 * (lớp chưa có người phụ trách: mọi sale) — giống quyền ghi chú lớp + kế toán.
 */
const canManageClass = (req: Request, customer: Pick<ICustomer, 'assignedSale'>) => {
  const roles = req.user!.roles as number[];
  if (roles.some((r) => r === 0 || r === 1 || r === 5)) return true;
  return customer.assignedSale
    ? String(customer.assignedSale) === String(req.user!._id)
    : roles.some((r) => r === 2 || r === 4);
};

const schoolName = (school: unknown): string =>
  (school as { name?: string } | null | undefined)?.name ?? '';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const isDocsUrl = (v: unknown): v is string => {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname === 'docs.google.com';
  } catch {
    return false;
  }
};

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isCount = (v: unknown): v is number => isAmount(v) && Number.isInteger(v);
const toDate = (v: unknown): Date | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Kiểm tra body PUT /customers/:id/contract → dữ liệu hợp đồng, hoặc thông báo lỗi. */
const parseContractBody = (body: Record<string, unknown>): ICustomerContract | string => {
  if (!isDocsUrl(body.url)) return 'Link hợp đồng phải là Google Docs (https://docs.google.com/…)';

  let docId: string | null = null;
  if (body.docId !== undefined && body.docId !== null && body.docId !== '') {
    if (typeof body.docId !== 'string' || !DOC_ID_RE.test(body.docId)) {
      return 'docId không hợp lệ';
    }
    docId = body.docId;
  }

  const nullableAmount = (k: string): number | null | string => {
    const v = body[k];
    if (v === undefined || v === null) return null;
    return isAmount(v) ? v : `${k} không hợp lệ`;
  };
  const nullableCount = (k: string): number | null | string => {
    const v = body[k];
    if (v === undefined || v === null) return null;
    return isCount(v) ? v : `${k} không hợp lệ`;
  };
  const total = nullableAmount('total');
  const pricePerMember = nullableAmount('pricePerMember');
  const depositAmount = nullableAmount('depositAmount');
  const crewCount = nullableCount('crewCount');
  const crewCountSystem = nullableCount('crewCountSystem');
  for (const v of [total, pricePerMember, depositAmount, crewCount, crewCountSystem]) {
    if (typeof v === 'string') return v;
  }

  let pkg: Types.ObjectId | null = null;
  if (body.package !== undefined && body.package !== null && body.package !== '') {
    if (typeof body.package !== 'string' || !mongoose.isValidObjectId(body.package)) {
      return 'Gói chụp không hợp lệ';
    }
    pkg = new Types.ObjectId(body.package);
  }

  const shootDate = toDate(body.shootDate);
  if (!shootDate) return 'Cần ngày chụp hợp lệ';

  if (body.location !== undefined && body.location !== null && typeof body.location !== 'string') {
    return 'Địa điểm không hợp lệ';
  }
  const location = typeof body.location === 'string' ? body.location.trim().slice(0, 500) : '';

  let depositSyncedAt: Date | null = null;
  if (body.depositSyncedAt !== undefined && body.depositSyncedAt !== null) {
    depositSyncedAt = toDate(body.depositSyncedAt);
    if (!depositSyncedAt) return 'depositSyncedAt không hợp lệ';
  }

  const rawServices = body.extraServices ?? [];
  if (!Array.isArray(rawServices) || rawServices.length > MAX_EXTRA_SERVICES) {
    return 'Dịch vụ thêm không hợp lệ';
  }
  const extraServices: IExtraService[] = [];
  for (const raw of rawServices as Record<string, unknown>[]) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!name) return 'Dịch vụ thêm cần có tên';
    if (!isAmount(raw.quantity) || !isAmount(raw.unitPrice)) {
      return `Số lượng / đơn giá của dịch vụ “${name}” không hợp lệ`;
    }
    if (raw.note !== undefined && raw.note !== null && typeof raw.note !== 'string') {
      return `Ghi chú của dịch vụ “${name}” không hợp lệ`;
    }
    extraServices.push({
      name,
      quantity: raw.quantity,
      unitPrice: raw.unitPrice,
      amount: raw.quantity * raw.unitPrice,
      ...(typeof raw.note === 'string' && raw.note.trim() ? { note: raw.note.trim() } : {}),
    });
  }

  return {
    url: body.url,
    docId,
    total: total as number | null,
    package: pkg,
    pricePerMember: pricePerMember as number | null,
    shootDate,
    location,
    extraServices,
    crewCount: crewCount as number | null,
    crewCountSystem: crewCountSystem as number | null,
    depositAmount: depositAmount as number | null,
    depositSyncedAt,
  };
};

const loadCustomer = (id: string) =>
  Customer.findById(id)
    .populate('assignedSale', USER_REF_FIELDS)
    .populate('schoolId', SCHOOL_REF_FIELDS)
    .lean();

/**
 * PUT /customers/:id/contract — lưu hợp đồng vừa tạo (frontend gọi Apps Script tạo Google Doc
 * rồi gửi kết quả lên đây). Lớp chưa có hợp đồng: tạo được ở mọi bước trước khi chụp.
 * Lớp đã có hợp đồng: chỉ admin được "Tạo lại" (ghi đè; link cũ lưu trong nhật ký lớp).
 * Lớp đang "Đã cọc" → tự chuyển "Chưa chụp".
 */
export const saveContract = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const customer = await Customer.findById(req.params.id)
    .select('className schoolId status assignedSale contract')
    .populate('schoolId', 'name')
    .lean();
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  if (!canManageClass(req, customer)) {
    sendResponse(res, 403, false, 'Bạn không phụ trách lớp này');
    return;
  }
  const admin = isAdmin(req);
  const previousUrl = customer.contract?.url ?? null;
  // Client gửi link hợp đồng nó đang thấy (null khi tạo mới) → lệch thì người khác vừa đổi
  const rawExpected = (req.body as { expectedUrl?: unknown } | undefined)?.expectedUrl;
  if (rawExpected !== undefined && rawExpected !== null && typeof rawExpected !== 'string') {
    sendResponse(res, 400, false, 'expectedUrl không hợp lệ');
    return;
  }
  const expectedUrl = (rawExpected as string | null | undefined) || null;
  if (rawExpected === undefined || expectedUrl !== previousUrl) {
    sendResponse(res, 409, false, CONTRACT_CONFLICT_MSG);
    return;
  }
  if (previousUrl && !admin) {
    sendResponse(res, 403, false, 'Lớp đã có hợp đồng — chỉ admin mới được tạo lại');
    return;
  }
  const status: CustomerStatus = customer.status ?? 'new';
  if (!previousUrl && !admin && !CONTRACT_STATUSES.includes(status)) {
    sendResponse(
      res,
      400,
      false,
      `Không tạo hợp đồng khi lớp ở trạng thái “${CUSTOMER_STATUS_LABELS[status]}”`,
    );
    return;
  }

  const parsed = parseContractBody((req.body ?? {}) as Record<string, unknown>);
  if (typeof parsed === 'string') {
    sendResponse(res, 400, false, parsed);
    return;
  }
  const user = req.user!;
  const contract: ICustomerContract = {
    ...parsed,
    createdAt: new Date(),
    createdBy: user._id as Types.ObjectId,
  };

  // Ghi nguyên tử: chỉ khi hợp đồng trên lớp vẫn là `expectedUrl` (tránh 2 người tạo cùng lúc)
  const written = await Customer.updateOne(
    expectedUrl
      ? { _id: customer._id, 'contract.url': expectedUrl }
      : { _id: customer._id, contract: { $in: [null] } },
    { $set: { contract } },
  );
  if (!written.matchedCount) {
    sendResponse(res, 409, false, CONTRACT_CONFLICT_MSG);
    return;
  }

  const note = previousUrl ? `Tạo lại hợp đồng (hợp đồng cũ: ${previousUrl})` : 'Đã tạo hợp đồng';
  try {
    // Có hợp đồng → lớp đang "Đã cọc" tự chuyển sang "Chưa chụp"
    const moved = await Customer.updateOne(
      { _id: customer._id, status: 'deposited' },
      { $set: { status: 'scheduled', statusChangedAt: new Date() } },
    );
    await CustomerActivity.create({
      customer: customer._id,
      kind: 'system',
      ...(moved.modifiedCount ? { fromStatus: 'deposited', toStatus: 'scheduled' } : {}),
      note,
      createdBy: user._id,
    });
  } catch (e) {
    console.error('[Contract] cập nhật trạng thái / nhật ký sau khi lưu hợp đồng thất bại:', e);
  }

  sendResponse(res, 200, true, 'Đã lưu hợp đồng', await loadCustomer(String(customer._id)));

  // Tiền cọc thay đổi trong lúc tạo hợp đồng → cập nhật ô tiền cọc (chạy nền, không throw)
  if (contract.docId) void syncContractDeposit(customer._id, user._id as Types.ObjectId);

  // Báo thợ chụp của lịch đang áp dụng (chạy nền)
  void (async () => {
    try {
      const schedules = await Schedule.find({
        customer: customer._id,
        status: { $ne: 'cancelled' },
      })
        .select('leadPhotographer supportPhotographers')
        .lean();
      const ids = [
        ...new Set(
          schedules
            .flatMap((s) => [s.leadPhotographer, ...(s.supportPhotographers ?? [])])
            .filter(Boolean)
            .map(String),
        ),
      ];
      if (!ids.length) return;
      const school = schoolName(customer.schoolId);
      const classSchool = escapeHtml(
        school ? `${customer.className} - ${school}` : customer.className,
      );
      const title = previousUrl ? 'Hợp đồng đã được tạo lại' : 'Hợp đồng đã được tạo';
      await notifyUsers(
        ids,
        `📄 <b>${title}</b>\n👥 ${classSchool}\n🔗 ${escapeHtml(contract.url)}`,
      );
    } catch (e) {
      console.error('[Telegram] thông báo tạo hợp đồng thất bại:', e);
    }
  })();
};

/**
 * POST /customers/:id/contract/sync-deposit — cập nhật lại ô Tiền cọc / Đợt 2 trên hợp đồng
 * của lớp theo tiền cọc hiện tại.
 */
export const syncContractDepositNow = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const customer = await Customer.findById(req.params.id)
    .select('assignedSale contract.docId')
    .lean();
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  if (!canManageClass(req, customer)) {
    sendResponse(res, 403, false, 'Bạn không phụ trách lớp này');
    return;
  }
  if (!customer.contract?.docId) {
    sendResponse(res, 400, false, 'Hợp đồng này không tự cập nhật được tiền cọc');
    return;
  }

  const result = await syncContractDeposit(customer._id, req.user!._id as Types.ObjectId);
  if (result.skipped) {
    sendResponse(res, 503, false, 'Chưa cấu hình kết nối Apps Script hợp đồng');
    return;
  }
  if (result.failed.length) {
    sendResponse(
      res,
      502,
      false,
      `Không cập nhật được tiền cọc trên hợp đồng (${result.failed.join(', ')})`,
    );
    return;
  }
  sendResponse(
    res,
    200,
    true,
    'Đã cập nhật tiền cọc trên hợp đồng',
    await loadCustomer(String(customer._id)),
  );
};

// Mỗi lớp chỉ một yêu cầu tạo folder tại một thời điểm (bấm 2 lần / 2 người cùng bấm)
const folderInFlight = new Set<string>();

/**
 * POST /customers/:id/drive-folder — tạo (hoặc dùng lại) folder ảnh Drive cho lớp chưa có folder
 * (vd: chưa có lịch chụp). Tên folder theo ngày chụp (hợp đồng → lịch chụp → ngày dự kiến).
 */
export const createDriveFolder = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  const customer = await Customer.findById(req.params.id)
    .select(
      'className schoolId assignedSale status season expectedShootDate contract driveFolderUrl',
    )
    .populate('schoolId', 'name')
    .populate<{ season: Pick<ISeason, 'name'> | null }>('season', 'name')
    .lean();
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  if (!canManageClass(req, customer)) {
    sendResponse(res, 403, false, 'Bạn không phụ trách lớp này');
    return;
  }
  if (customer.driveFolderUrl) {
    sendResponse(res, 200, true, 'Lớp đã có folder', await loadCustomer(String(customer._id)));
    return;
  }
  const key = String(customer._id);
  if (folderInFlight.has(key)) {
    sendResponse(res, 409, false, 'Đang tạo folder cho lớp này, thử lại sau ít giây');
    return;
  }
  folderInFlight.add(key);
  try {
    await createFolderForCustomer(res, customer);
  } finally {
    folderInFlight.delete(key);
  }
};

const createFolderForCustomer = async (
  res: Response,
  customer: {
    _id: Types.ObjectId;
    className: string;
    schoolId?: unknown;
    season?: Pick<ISeason, 'name'> | null;
    expectedShootDate?: Date | null;
    contract?: ICustomerContract | null;
  },
): Promise<void> => {
  const schedule = await Schedule.findOne({ customer: customer._id, status: { $ne: 'cancelled' } })
    .select('shootDate location')
    .sort({ shootDate: -1 })
    .lean();
  const date = customer.contract?.shootDate ?? schedule?.shootDate ?? customer.expectedShootDate;
  const result = await createFolderAndLog({
    action: 'folder',
    season: customer.season?.name ?? 'Chưa phân mùa',
    school: schoolName(customer.schoolId),
    className: customer.className,
    shootDate: date ? new Date(date).toLocaleDateString('vi-VN') : '',
    location: customer.contract?.location || schedule?.location || undefined,
  });
  if (!result) {
    sendResponse(res, 502, false, 'Không tạo được folder Drive (kiểm tra cấu hình Apps Script)');
    return;
  }
  // Code.gs bản cũ không hiểu action 'folder' (tạo folder + ghi thêm dòng Sheet) → không lưu
  if (result.action !== 'folder') {
    console.error('[Drive] Code.gs chưa cập nhật (không trả action "folder")');
    sendResponse(res, 502, false, 'Script folder chưa cập nhật');
    return;
  }
  await Customer.updateOne(
    { _id: customer._id, driveFolderUrl: { $in: [null, ''] } },
    { $set: { driveFolderUrl: result.folderUrl, driveFolderId: result.folderId } },
  );
  sendResponse(res, 200, true, 'Đã tạo folder Drive', await loadCustomer(String(customer._id)));
};
