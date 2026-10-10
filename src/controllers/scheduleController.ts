import { Request, Response } from 'express';
import PDFDocument from 'pdfkit';
import path from 'path';
import { Types, isValidObjectId } from 'mongoose';
import Schedule, {
  EXTERNAL_CREW_CONFIRMATIONS,
  SCHEDULE_STATUSES,
  EXTERNAL_CREW_ROLES,
  type ExternalCrewRole,
  type IExternalCrewAssignment,
} from '../models/Schedule';
import ExternalPhotographer from '../models/ExternalPhotographer';
import User from '../models/User';
import Customer, { CUSTOMER_STATUSES, type CustomerStatus } from '../models/Customer';
import type { ICustomer } from '../models/Customer';
import type { IUser } from '../models/User';
import type { ISeason } from '../models/Season';
import type { ScheduleResponse } from '../types/dto';
import { notifyUsers } from '../services/telegramService';
import { deleteFolderAndRow } from '../services/googleSheetService';
import {
  LEGACY_SCHEDULE_FIELDS,
  createScheduleWithSideEffects,
  findPreferredScheduleId,
  stripLegacyScheduleFields,
} from '../services/scheduleService';
import { resolveSeasonForDate } from '../utils/seasonCache';
import { sendResponse } from '../utils/response';
import { CREW_FORBIDDEN_MSG, canEditCrew, crewChanged, hasCrew } from '../utils/permissions';
import { accessibleCustomerIds } from '../utils/customerScope';

interface ScheduleQuery {
  customer?: string;
  /**
   * Trạng thái chụp (`deposited` | `not_shot` | `shot`), `cancelled` để xem lịch đã huỷ,
   * hoặc (tương thích cũ) một trạng thái quy trình của lớp (Customer.status).
   */
  status?: string;
  /** `true` → trả cả lịch đã huỷ (vd: trang chi tiết lớp). Mặc định chỉ lịch đang áp dụng. */
  includeCancelled?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: string;
  limit?: string;
  season?: string;
  /** Lịch có thợ này trong ekip (thợ chính, thợ phụ hoặc thợ quay). */
  photographer?: string;
}

const isCustomerStatus = (v: string): v is (typeof CUSTOMER_STATUSES)[number] =>
  (CUSTOMER_STATUSES as readonly string[]).includes(v);

/** Trạng thái lớp được tính là "Đã chụp" trên trang Lịch chụp. */
const SHOT_CUSTOMER_STATUSES: CustomerStatus[] = ['shot', 'awaiting_print', 'done'];

/**
 * Trạng thái chụp → điều kiện lọc Customer.status. `deposited` = Đã cọc, `shot` = Đã chụp,
 * `not_shot` = Chưa chụp (mọi trạng thái còn lại, kể cả dữ liệu cũ chưa có status).
 */
const SHOOT_STATUS_FILTERS = {
  deposited: 'deposited',
  shot: { $in: SHOT_CUSTOMER_STATUSES },
  not_shot: { $nin: ['deposited', ...SHOT_CUSTOMER_STATUSES] },
} as const;

const isShootStatus = (v: string): v is keyof typeof SHOOT_STATUS_FILTERS =>
  Object.prototype.hasOwnProperty.call(SHOOT_STATUS_FILTERS, v);

/** Trả về thông báo lỗi nếu query lọc không hợp lệ (status/customer), ngược lại `null`. */
const validateQuery = (q: Record<string, unknown>): string | null => {
  if (
    q.status !== undefined &&
    q.status !== '' &&
    (typeof q.status !== 'string' ||
      (q.status !== 'cancelled' && !isShootStatus(q.status) && !isCustomerStatus(q.status)))
  ) {
    return 'status không hợp lệ';
  }
  if (q.customer !== undefined && q.customer !== '' && !isValidObjectId(q.customer)) {
    return 'customer không hợp lệ';
  }
  const photographerId =
    typeof q.photographer === 'string' && q.photographer.startsWith('external:')
      ? q.photographer.slice('external:'.length)
      : q.photographer;
  if (q.photographer !== undefined && q.photographer !== '' && !isValidObjectId(photographerId)) {
    return 'photographer không hợp lệ';
  }
  return null;
};

/** Cast to ObjectId so the filter also works in aggregation `$match` (no auto-casting there). */
const toId = (v: string) => (isValidObjectId(v) ? new Types.ObjectId(v) : v);

const buildFilter = async (q: ScheduleQuery) => {
  const filter: Record<string, unknown> = {};
  if (q.customer) filter.customer = toId(q.customer);
  if (q.status === 'cancelled') {
    filter.status = 'cancelled';
  } else {
    if (q.includeCancelled !== 'true') filter.status = { $ne: 'cancelled' };
    const shootFilter =
      q.status && isShootStatus(q.status) ? SHOOT_STATUS_FILTERS[q.status] : undefined;
    if (q.status && (shootFilter || isCustomerStatus(q.status))) {
      // Lọc theo trạng thái chụp / trạng thái của lớp. Không lọc Customer theo mùa vì mùa của
      // lịch chụp (đã lọc ở Schedule.season) có thể khác mùa của lớp.
      const customerIds = await Customer.find({
        // Dữ liệu cũ chưa có status được tính là `new` (giống customerController);
        // `$nin` của not_shot đã bao gồm null/thiếu field.
        status: shootFilter ?? (q.status === 'new' ? { $in: ['new', null] } : q.status),
        ...(q.customer ? { _id: q.customer } : {}),
      }).distinct('_id');
      filter.customer = { $in: customerIds };
    }
  }
  if (q.dateFrom || q.dateTo) {
    const dateRange: Record<string, Date> = {};
    if (q.dateFrom) dateRange.$gte = new Date(q.dateFrom);
    if (q.dateTo) dateRange.$lte = new Date(q.dateTo);
    filter.shootDate = dateRange;
  }
  if (q.photographer) {
    if (q.photographer.startsWith('external:')) {
      filter.externalCrew = {
        $elemMatch: {
          photographer: toId(q.photographer.slice('external:'.length)),
          confirmation: { $ne: 'declined' },
        },
      };
    } else {
      const id = toId(q.photographer);
      filter.$or = [{ leadPhotographer: id }, { supportPhotographers: id }, { videographer: id }];
    }
  }
  return filter;
};

/** Ngày chụp được so theo lịch Việt Nam (UTC+7), không phụ thuộc giờ lưu trong `shootDate`. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const vnDayKey = (d: Date | string) =>
  new Date(new Date(d).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
/** Khoảng [00:00, 24:00) giờ Việt Nam của ngày `YYYY-MM-DD`. */
const vnDayRange = (key: string) => {
  const start = new Date(Date.parse(`${key}T00:00:00.000Z`) - VN_OFFSET_MS);
  return { $gte: start, $lt: new Date(start.getTime() + DAY_MS) };
};

interface CrewScheduleRow {
  _id: unknown;
  shootDate: Date;
  startTime?: string;
  endTime?: string;
  customer?: { className?: string } | null;
  leadPhotographer?: { _id: unknown; name?: string; username?: string } | null;
  supportPhotographers?: { _id: unknown; name?: string; username?: string }[];
  videographer?: { _id: unknown; name?: string; username?: string } | null;
  externalCrew?: Array<{
    photographer?: { _id: unknown; name?: string } | null;
    role: ExternalCrewRole;
    confirmation: 'pending' | 'confirmed' | 'declined';
  }>;
}

/** Lịch đang áp dụng (chưa huỷ) trong các ngày `days` có thợ thuộc ekip cần xét. */
const findCrewSchedules = (
  days: string[],
  crew?: { internalIds: string[]; externalIds: string[] },
) =>
  Schedule.find({
    status: { $ne: 'cancelled' },
    $and: [
      { $or: days.map((d) => ({ shootDate: vnDayRange(d) })) },
      ...(crew
        ? [
            {
              $or: [
                { leadPhotographer: { $in: crew.internalIds } },
                { supportPhotographers: { $in: crew.internalIds } },
                { videographer: { $in: crew.internalIds } },
                { 'externalCrew.photographer': { $in: crew.externalIds } },
              ],
            },
          ]
        : []),
    ],
  })
    .select(
      'customer shootDate startTime endTime leadPhotographer supportPhotographers videographer externalCrew',
    )
    .populate('customer', 'className')
    .populate('leadPhotographer', '_id name username')
    .populate('supportPhotographers', '_id name username')
    .populate('videographer', '_id name username')
    .populate('externalCrew.photographer', '_id name')
    .lean<CrewScheduleRow[]>();

const crewOf = (
  s: Pick<
    CrewScheduleRow,
    'leadPhotographer' | 'supportPhotographers' | 'videographer' | 'externalCrew'
  >,
) => [
  ...[s.leadPhotographer, ...(s.supportPhotographers ?? []), s.videographer]
    .filter((u): u is NonNullable<CrewScheduleRow['leadPhotographer']> => Boolean(u))
    .map((u) => ({ id: String(u._id), name: u.name ?? u.username ?? '', external: false })),
  ...(s.externalCrew ?? [])
    .filter((entry) => entry.photographer && entry.confirmation !== 'declined')
    .map((entry) => ({
      id: String(entry.photographer!._id),
      name: entry.photographer!.name ?? '',
      external: true,
    })),
];

/**
 * Gắn `conflicts` cho từng lịch đang áp dụng: thợ trong ekip đồng thời có lịch khác (chưa huỷ)
 * cùng ngày chụp.
 */
const attachConflicts = async (items: ScheduleResponse[]) => {
  const active = items.filter((s) => s.status !== 'cancelled');
  const internalIds = [
    ...new Set(
      active.flatMap((s) =>
        [s.leadPhotographer, ...(s.supportPhotographers ?? []), s.videographer]
          .filter(Boolean)
          .map((u) => String(u!._id)),
      ),
    ),
  ];
  const externalIds = [
    ...new Set(
      active.flatMap((s) =>
        (s.externalCrew ?? [])
          .filter((entry) => entry.photographer && entry.confirmation !== 'declined')
          .map((entry) => String(entry.photographer!._id)),
      ),
    ),
  ];
  const days = [...new Set(active.map((s) => vnDayKey(s.shootDate)))];
  const others =
    (internalIds.length || externalIds.length) && days.length
      ? await findCrewSchedules(days, { internalIds, externalIds })
      : [];
  return items.map((s) => {
    if (s.status === 'cancelled') return { ...s, conflicts: [] };
    const day = vnDayKey(s.shootDate);
    const mine = new Set(crewOf(s).map((u) => `${u.external ? 'external' : 'internal'}:${u.id}`));
    const conflicts = others
      .filter((o) => String(o._id) !== String(s._id) && vnDayKey(o.shootDate) === day)
      .flatMap((o) =>
        crewOf(o)
          .filter((u) => mine.has(`${u.external ? 'external' : 'internal'}:${u.id}`))
          .map((u) => ({
            user: { _id: u.id, name: u.name, external: u.external },
            schedule: {
              _id: String(o._id),
              className: o.customer?.className ?? '',
              startTime: o.startTime,
              endTime: o.endTime,
            },
          })),
      );
    return { ...s, conflicts };
  });
};

const FONT_REGULAR = path.join(__dirname, '../../src/assets/fonts/Roboto-Regular.ttf');
const SCHOOL_POPULATE = { path: 'schoolId', select: 'name address' };
const schoolName = (customer?: { schoolId?: unknown } | null): string =>
  (customer?.schoolId as { name?: string } | null | undefined)?.name ?? '';

const FONT_BOLD = path.join(__dirname, '../../src/assets/fonts/Roboto-Bold.ttf');

type StatusFacet = 'deposited' | 'not_shot' | 'shot' | 'cancelled';

/**
 * Số lịch theo trạng thái chụp (kể cả đã huỷ) với các bộ lọc hiện tại, BỎ QUA bộ lọc trạng thái —
 * dùng cho chip đếm trên trang Lịch chụp.
 */
const countByShootStatus = async (match: Record<string, unknown>) => {
  const rows = await Schedule.aggregate<{ _id: StatusFacet; n: number }>([
    { $match: match },
    {
      $lookup: {
        from: Customer.collection.name,
        localField: 'customer',
        foreignField: '_id',
        as: 'c',
      },
    },
    { $project: { status: 1, cs: { $arrayElemAt: ['$c.status', 0] } } },
    {
      $group: {
        _id: {
          $cond: [
            { $eq: ['$status', 'cancelled'] },
            'cancelled',
            {
              $switch: {
                branches: [
                  { case: { $eq: ['$cs', 'deposited'] }, then: 'deposited' },
                  { case: { $in: ['$cs', SHOT_CUSTOMER_STATUSES] }, then: 'shot' },
                ],
                default: 'not_shot',
              },
            },
          ],
        },
        n: { $sum: 1 },
      },
    },
  ]);
  const counts: Record<StatusFacet, number> = { deposited: 0, not_shot: 0, shot: 0, cancelled: 0 };
  for (const r of rows) counts[r._id] = r.n;
  return counts;
};

export const getAll = async (req: Request, res: Response): Promise<void> => {
  const invalid = validateQuery(req.query);
  if (invalid) {
    sendResponse(res, 400, false, invalid);
    return;
  }
  const { page = '1', limit = '20', season, ...rest } = req.query as ScheduleQuery;
  const filter = await buildFilter(rest);
  if (season) {
    filter.season = toId(season);
  }
  const facetFilter = await buildFilter({ ...rest, status: undefined, includeCancelled: 'true' });
  if (season) facetFilter.season = toId(season);
  // CTV sale chỉ thấy lịch của lớp mình tạo / phụ trách
  const ownIds = await accessibleCustomerIds(req);
  if (ownIds) {
    filter.$and = [{ customer: { $in: ownIds } }];
    facetFilter.$and = [{ customer: { $in: ownIds } }];
  }
  const skip = (Number(page) - 1) * Number(limit);
  const USER_FIELDS = '_id username name roles isActive createdAt';
  const CUSTOMER_FIELDS =
    '_id className schoolId contactName contactPhone contactAddress total totalMale totalFemale notes status deposit assignedSale driveFolderUrl contract.url contract.docId contract.crewCount contract.videoCrewCount createdAt';
  const [data, total, statusCounts] = await Promise.all([
    Schedule.find(filter)
      .populate({ path: 'customer', select: CUSTOMER_FIELDS, populate: SCHOOL_POPULATE })
      .populate({ path: 'package', populate: { path: 'costumes' } })
      .populate('costumes')
      .populate('leadPhotographer', USER_FIELDS)
      .populate('supportPhotographers', USER_FIELDS)
      .populate('videographer', USER_FIELDS)
      .populate('externalCrew.photographer', '_id name isActive')
      .populate('bookedBy', USER_FIELDS)
      .sort({ shootDate: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean<ScheduleResponse[]>(),
    Schedule.countDocuments(filter),
    countByShootStatus(facetFilter),
  ]);
  const withConflicts = await attachConflicts(data);
  sendResponse(res, 200, true, 'OK', withConflicts, {
    total,
    page: Number(page),
    limit: Number(limit),
    statusCounts,
  });
};

/**
 * GET /schedules/busy?date=YYYY-MM-DD&exclude=<scheduleId> — các lịch đang áp dụng trong ngày
 * (theo giờ Việt Nam) kèm ekip, dùng để hiện thợ bận/rảnh khi phân công ekip.
 */
export const getBusy = async (req: Request, res: Response): Promise<void> => {
  const { date, exclude } = req.query as { date?: string; exclude?: string };
  const parsed = typeof date === 'string' ? Date.parse(`${date}T00:00:00.000Z`) : NaN;
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== date
  ) {
    sendResponse(res, 400, false, 'date không hợp lệ (YYYY-MM-DD)');
    return;
  }
  if (exclude !== undefined && exclude !== '' && !isValidObjectId(exclude)) {
    sendResponse(res, 400, false, 'exclude không hợp lệ');
    return;
  }
  const rows = await findCrewSchedules([date]);
  const data = rows
    .filter((s) => !exclude || String(s._id) !== exclude)
    .map((s) => ({
      _id: String(s._id),
      className: s.customer?.className ?? '',
      startTime: s.startTime,
      endTime: s.endTime,
      leadPhotographer: s.leadPhotographer ? String(s.leadPhotographer._id) : null,
      supportPhotographers: (s.supportPhotographers ?? []).map((u) => String(u._id)),
      videographer: s.videographer ? String(s.videographer._id) : null,
      externalCrew: (s.externalCrew ?? [])
        .filter((entry) => entry.photographer)
        .map((entry) => ({
          photographer: String(entry.photographer!._id),
          role: entry.role,
          confirmation: entry.confirmation,
        })),
    }));
  sendResponse(res, 200, true, 'OK', data);
};

export const getByCustomer = async (req: Request, res: Response): Promise<void> => {
  const USER_FIELDS = '_id username name roles isActive createdAt';
  const CUSTOMER_FIELDS =
    '_id className schoolId contactName contactPhone contactAddress total totalMale totalFemale notes status deposit driveFolderUrl contract.url contract.docId contract.crewCount contract.videoCrewCount createdAt';
  if (!isValidObjectId(req.params.customer)) {
    sendResponse(res, 400, false, 'customer không hợp lệ');
    return;
  }
  // Ưu tiên lịch đang áp dụng (mới nhất); chỉ trả lịch đã huỷ khi lớp không còn lịch nào khác
  const scheduleId = await findPreferredScheduleId(req.params.customer);
  const schedule = scheduleId
    ? await Schedule.findById(scheduleId)
        .populate({ path: 'customer', select: CUSTOMER_FIELDS, populate: SCHOOL_POPULATE })
        .populate({ path: 'package', populate: { path: 'costumes' } })
        .populate('costumes')
        .populate('leadPhotographer', USER_FIELDS)
        .populate('supportPhotographers', USER_FIELDS)
        .populate('videographer', USER_FIELDS)
        .populate('externalCrew.photographer', '_id name isActive')
        .populate('bookedBy', USER_FIELDS)
        .lean<ScheduleResponse | null>()
    : null;
  sendResponse(res, 200, true, 'OK', schedule);
};

export const getOne = async (req: Request, res: Response): Promise<void> => {
  const USER_FIELDS = '_id username name roles isActive createdAt';
  const CUSTOMER_FIELDS =
    '_id className schoolId contactName contactPhone contactAddress total totalMale totalFemale notes status deposit driveFolderUrl contract.url contract.docId contract.crewCount contract.videoCrewCount createdAt';
  const schedule = await Schedule.findById(req.params.id)
    .populate({ path: 'customer', select: CUSTOMER_FIELDS, populate: SCHOOL_POPULATE })
    .populate({ path: 'package', populate: { path: 'costumes' } })
    .populate('costumes')
    .populate('leadPhotographer', USER_FIELDS)
    .populate('supportPhotographers', USER_FIELDS)
    .populate('videographer', USER_FIELDS)
    .populate('externalCrew.photographer', '_id name isActive')
    .populate('bookedBy', USER_FIELDS)
    .lean<ScheduleResponse | null>();
  if (!schedule) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'OK', schedule);
};

// Tương thích khi rollout: client cũ còn gửi pending/confirmed/completed → coi là `active`.
// Remove after one release: bỏ LEGACY_STATUSES khi mọi client đã lên bản mới.
const LEGACY_STATUSES: readonly unknown[] = ['pending', 'confirmed', 'completed'];

/**
 * Chuẩn hoá `status` trong body: chấp nhận `active` | `cancelled` (hoặc bỏ trống), giá trị cũ
 * được chuyển thành `active`. Trả về `false` nếu giá trị không hợp lệ.
 */
const normalizeBodyStatus = (body: Record<string, unknown> | undefined): boolean => {
  if (!body || body.status === undefined) return true;
  if (LEGACY_STATUSES.includes(body.status)) {
    body.status = 'active';
    return true;
  }
  return (SCHEDULE_STATUSES as readonly unknown[]).includes(body.status);
};

/** Client cũ còn gửi hợp đồng / folder Drive lên lịch chụp (nay thuộc về lớp). */
export const STALE_CLIENT_MSG = 'Phiên bản cũ — vui lòng tải lại trang';

const hasLegacyFields = (body: unknown) =>
  !!body &&
  typeof body === 'object' &&
  LEGACY_SCHEDULE_FIELDS.some((k) => Object.prototype.hasOwnProperty.call(body, k));

const INVALID_STATUS_MSG = 'Trạng thái lịch chụp không hợp lệ (chỉ active hoặc cancelled)';

/**
 * Validate the whole external crew (and the internal videographer) whenever a schedule is created
 * or its crew changes. Mỗi lịch tối đa 1 thợ quay: `videographer` nội bộ HOẶC 1 thợ ngoài role
 * 'video'; thợ ngoài role 'video' không tính vào luật một thợ chính.
 */
const validateExternalCrew = async (
  body: Record<string, unknown>,
  previous?: {
    leadPhotographer?: unknown;
    supportPhotographers?: unknown[];
    videographer?: unknown;
    externalCrew?: IExternalCrewAssignment[];
  } | null,
): Promise<string | null> => {
  const videographerSupplied = Object.prototype.hasOwnProperty.call(body, 'videographer');
  if (videographerSupplied) {
    const v = body.videographer;
    if (v === null || v === '' || v === undefined) {
      body.videographer = null;
    } else if (typeof v !== 'string' || !isValidObjectId(v)) {
      return 'Thợ quay không hợp lệ';
    } else if (v !== String(previous?.videographer ?? '')) {
      // Thợ quay mới phải là người dùng đang hoạt động có vai trò "Thợ quay phim"
      const ok = await User.exists({ _id: v, roles: 6, isActive: true });
      if (!ok) return 'Thợ quay phải là người dùng có vai trò Thợ quay phim';
    }
  }

  const supplied = Object.prototype.hasOwnProperty.call(body, 'externalCrew');
  if (supplied && !Array.isArray(body.externalCrew)) return 'Danh sách thợ ngoài không hợp lệ';
  const raw = supplied ? (body.externalCrew as unknown[]) : (previous?.externalCrew ?? []);
  if (raw.length > 50) return 'Một lịch có tối đa 50 thợ ngoài';
  const normalized: Array<{
    photographer: string;
    role: ExternalCrewRole;
    confirmation: string;
  }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return 'Thợ ngoài không hợp lệ';
    const entry = item as Record<string, unknown>;
    const photographer = String(entry.photographer ?? '');
    const role = entry.role;
    const confirmation = entry.confirmation ?? 'pending';
    if (
      !isValidObjectId(photographer) ||
      !(EXTERNAL_CREW_ROLES as readonly unknown[]).includes(role) ||
      !(EXTERNAL_CREW_CONFIRMATIONS as readonly unknown[]).includes(confirmation)
    ) {
      return 'Thông tin phân công thợ ngoài không hợp lệ';
    }
    normalized.push({
      photographer,
      role: role as ExternalCrewRole,
      confirmation: String(confirmation),
    });
  }
  const ids = normalized.map((entry) => entry.photographer);
  if (new Set(ids).size !== ids.length) return 'Một thợ ngoài chỉ được phân công một lần';
  const externalLeads = normalized.filter((entry) => entry.role === 'lead').length;
  const internalLead = Object.prototype.hasOwnProperty.call(body, 'leadPhotographer')
    ? body.leadPhotographer
    : previous?.leadPhotographer;
  if (externalLeads > 1 || (externalLeads && internalLead)) {
    return 'Chỉ được chọn một thợ chính trong hoặc ngoài hệ thống';
  }
  const externalVideos = normalized.filter((entry) => entry.role === 'video').length;
  const internalVideographer = videographerSupplied ? body.videographer : previous?.videographer;
  if (externalVideos > 1 || (externalVideos && internalVideographer)) {
    return 'Chỉ được chọn một thợ quay trong hoặc ngoài hệ thống';
  }
  if (internalVideographer) {
    // Một người không thể vừa chụp vừa quay trong cùng buổi
    const supports = Object.prototype.hasOwnProperty.call(body, 'supportPhotographers')
      ? body.supportPhotographers
      : previous?.supportPhotographers;
    const photographers = [internalLead, ...(Array.isArray(supports) ? supports : [])]
      .filter(Boolean)
      .map(String);
    if (photographers.includes(String(internalVideographer))) {
      return 'Thợ quay không được đồng thời là thợ chụp của buổi này';
    }
  }
  if (supplied && ids.length) {
    const existing = await ExternalPhotographer.find({ _id: { $in: ids } })
      .select('_id isActive')
      .lean();
    if (existing.length !== ids.length) return 'Có thợ ngoài không tồn tại';
    const oldIds = new Set(
      (previous?.externalCrew ?? []).map((entry) => String(entry.photographer)),
    );
    if (existing.some((person) => !person.isActive && !oldIds.has(String(person._id)))) {
      return 'Không thể phân công thợ ngoài đã ngừng hoạt động';
    }
    body.externalCrew = normalized;
  }
  return null;
};

export const create = async (req: Request, res: Response): Promise<void> => {
  if (hasLegacyFields(req.body)) {
    sendResponse(res, 409, false, STALE_CLIENT_MSG);
    return;
  }
  if (!normalizeBodyStatus(req.body)) {
    sendResponse(res, 400, false, INVALID_STATUS_MSG);
    return;
  }
  // Lịch mới luôn ở trạng thái `active` — không tạo lịch đã huỷ (tránh tạo folder/Telegram thừa)
  const { status: _status, ...body } = req.body as Record<string, unknown>;
  if (hasCrew(body) && !canEditCrew(req.user)) {
    sendResponse(res, 403, false, CREW_FORBIDDEN_MSG);
    return;
  }
  const invalidCrew = await validateExternalCrew(body);
  if (invalidCrew) {
    sendResponse(res, 400, false, invalidCrew);
    return;
  }
  const schedule = await createScheduleWithSideEffects(body);
  sendResponse(res, 201, true, 'Tạo lịch chụp thành công', schedule);
};

export const update = async (req: Request, res: Response): Promise<void> => {
  if (hasLegacyFields(req.body)) {
    sendResponse(res, 409, false, STALE_CLIENT_MSG);
    return;
  }
  if (!normalizeBodyStatus(req.body)) {
    sendResponse(res, 400, false, INVALID_STATUS_MSG);
    return;
  }
  const prevSchedule = await Schedule.findById(req.params.id).lean();
  if (prevSchedule && req.body && crewChanged(req.body, prevSchedule) && !canEditCrew(req.user)) {
    sendResponse(res, 403, false, CREW_FORBIDDEN_MSG);
    return;
  }
  const invalidCrew = await validateExternalCrew(req.body ?? {}, prevSchedule);
  if (invalidCrew) {
    sendResponse(res, 400, false, invalidCrew);
    return;
  }
  // Khôi phục lịch đã huỷ: mỗi lớp chỉ được có một lịch đang áp dụng
  if (prevSchedule?.status === 'cancelled' && req.body?.status === 'active') {
    const otherActive = await Schedule.exists({
      _id: { $ne: prevSchedule._id },
      customer: req.body.customer ?? prevSchedule.customer,
      status: { $ne: 'cancelled' },
    });
    if (otherActive) {
      sendResponse(
        res,
        409,
        false,
        'Lớp này đã có lịch chụp khác đang áp dụng. Huỷ lịch đó trước khi khôi phục lịch này.',
      );
      return;
    }
  }
  // Đã chặn field cũ ở trên; vẫn lọc lại cho chắc
  const updateData = stripLegacyScheduleFields({ ...req.body });
  // Nếu đổi ngày chụp mà client không gửi season, tự động tính lại theo mùa.
  if (
    updateData.shootDate &&
    (updateData.season === undefined || updateData.season === null || updateData.season === '')
  ) {
    updateData.season = await resolveSeasonForDate(updateData.shootDate);
  }
  const schedule = await Schedule.findByIdAndUpdate(req.params.id, updateData, {
    new: true,
    runValidators: true,
  });
  if (!schedule) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }

  sendResponse(res, 200, true, 'Cập nhật thành công', schedule);

  if (!prevSchedule) return;

  void (async () => {
    try {
      const full = await Schedule.findById(schedule._id)
        .populate<{
          customer: Pick<ICustomer, 'className' | 'schoolId'>;
        }>({ path: 'customer', select: 'className schoolId', populate: SCHOOL_POPULATE })
        .lean();
      if (!full) return;

      const dateStr = new Date(full.shootDate).toLocaleDateString('vi-VN');
      const customerName = full.customer?.className ?? 'Khách hàng';
      const customerSchool = schoolName(full.customer);
      const classSchool = customerSchool ? `${customerName} - ${customerSchool}` : customerName;
      const timeStr = full.startTime ? ` • ${full.startTime}` : '';
      const locationStr = full.location ? `\n📍 ${full.location}` : '';

      // ── 1. Phát hiện thay đổi thợ chụp ──────────────────────────────────
      // Chỉ tính thay đổi khi client thực sự gửi field tương ứng. Nếu chỉ cập
      // nhật field khác (vd: contractUrl) thì giữ nguyên thợ cũ, tránh báo nhầm
      // "được gỡ khỏi lịch chụp".
      const leadProvided = 'leadPhotographer' in req.body;
      const supportsProvided = Array.isArray(req.body?.supportPhotographers);
      const videographerProvided = 'videographer' in req.body;

      const prevLead = prevSchedule.leadPhotographer?.toString() ?? null;
      const newLead = leadProvided
        ? req.body.leadPhotographer
          ? String(req.body.leadPhotographer)
          : null
        : prevLead;

      const prevSupports = (prevSchedule.supportPhotographers ?? []).map((id) => id.toString());
      const newSupports: string[] = supportsProvided
        ? req.body.supportPhotographers.map(String)
        : prevSupports;

      // Thợ quay nội bộ được tính như một thợ phụ
      const prevVideo = prevSchedule.videographer?.toString() ?? null;
      const newVideo = videographerProvided
        ? req.body.videographer
          ? String(req.body.videographer)
          : null
        : prevVideo;

      const prevCrew = new Set(
        [prevLead, ...prevSupports, prevVideo].filter((id): id is string => Boolean(id)),
      );
      const newCrew = new Set(
        [newLead, ...newSupports, newVideo].filter((id): id is string => Boolean(id)),
      );

      // Thợ mới được thêm vào (chưa có trong lịch trước)
      const addedIds = [...newCrew].filter((id) => !prevCrew.has(id));

      // Thợ bị gỡ ra
      const removedIds = [...prevCrew].filter((id) => !newCrew.has(id));

      if (addedIds.length) {
        const text =
          `📅 <b>Bạn được phân công lịch chụp</b>\n` +
          `👥 ${classSchool}\n` +
          `📆 ${dateStr}${timeStr}${locationStr}`;
        await notifyUsers(addedIds, text);
      }

      if (removedIds.length) {
        const text =
          `🗑 <b>Bạn đã được gỡ khỏi lịch chụp</b>\n` +
          `👥 ${classSchool}` +
          `\n📆 ${dateStr}${timeStr}${locationStr}`;
        await notifyUsers(removedIds, text);
      }

      // ── 2. Thông báo huỷ / khôi phục lịch cho tất cả thợ hiện tại ───────
      const newStatus = req.body?.status as string | undefined;
      const wasCancelled = prevSchedule.status === 'cancelled';
      if (newStatus && (newStatus === 'cancelled') !== wasCancelled) {
        const title = wasCancelled
          ? '♻️ <b>Lịch chụp được khôi phục</b>'
          : '❌ <b>Lịch chụp đã bị huỷ</b>';
        const text = `${title}\n` + `👥 ${classSchool}\n` + `📆 ${dateStr}${timeStr}${locationStr}`;

        const currentIds = [full.leadPhotographer, ...full.supportPhotographers, full.videographer]
          .filter(Boolean)
          .map(String);
        if (currentIds.length) await notifyUsers(currentIds, text);
      }
    } catch (e) {
      console.error('[Telegram] schedule update notification failed:', e);
    }
  })();
};

/** Route cũ POST /schedules/:id/sync-contract-deposit — nay ở POST /customers/:id/contract/sync-deposit. */
export const goneContractRoute = (_req: Request, res: Response): void => {
  sendResponse(res, 410, false, STALE_CLIENT_MSG);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  // Lấy season name + folderId trước khi xoá để dọn folder Drive & dòng Sheet
  const target = await Schedule.findById(req.params.id)
    .populate<{ season: Pick<ISeason, 'name'> }>('season', 'name')
    .lean();
  if (!target) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }

  await Schedule.findByIdAndDelete(req.params.id);
  sendResponse(res, 200, true, 'Đã xóa lịch chụp');

  // Dọn dẹp Google Drive + Sheet (chạy nền, không chặn response)
  void deleteFolderAndRow({
    scheduleId: String(target._id),
    season: (target.season as unknown as { name?: string })?.name ?? 'Chưa phân mùa',
    // Không gửi folderId: folder ảnh thuộc về lớp, xoá lịch không được xoá folder
  }).catch((e: unknown) => console.error('[Schedule] dọn Google Drive/Sheet khi xoá thất bại:', e));
};

export const exportContract = async (req: Request, res: Response): Promise<void> => {
  const schedule = await Schedule.findById(req.params.id)
    .populate<{
      customer: ICustomer;
    }>({
      path: 'customer',
      select: 'className schoolId contactName contactPhone total',
      populate: SCHOOL_POPULATE,
    })
    .populate<{ leadPhotographer: IUser }>('leadPhotographer', 'username name')
    .populate<{ supportPhotographers: IUser[] }>('supportPhotographers', 'username name')
    .populate<{ videographer: IUser | null }>('videographer', 'username name')
    .populate('externalCrew.photographer', 'name');

  if (!schedule) {
    res.status(404).json({ message: 'Not found' });
    return;
  }

  const customer = schedule.customer as unknown as ICustomer;
  const lead = schedule.leadPhotographer as unknown as IUser | null;
  const supports = (schedule.supportPhotographers as unknown as IUser[]) ?? [];
  const videographer = schedule.videographer as unknown as IUser | null;
  const externalCrew = schedule.externalCrew as unknown as Array<{
    photographer?: { name?: string } | null;
    role: ExternalCrewRole;
    confirmation: string;
  }>;
  const leadName =
    (lead && (lead.name ?? lead.username)) ??
    externalCrew.find((entry) => entry.role === 'lead' && entry.confirmation !== 'declined')
      ?.photographer?.name ??
    '—';
  const supportNames = [
    ...supports.map((person) => person.name ?? person.username),
    ...externalCrew
      .filter((entry) => entry.role === 'support' && entry.confirmation !== 'declined')
      .map((entry) => entry.photographer?.name)
      .filter((name): name is string => Boolean(name)),
  ];

  const videographerName =
    (videographer && (videographer.name ?? videographer.username)) ??
    externalCrew.find((entry) => entry.role === 'video' && entry.confirmation !== 'declined')
      ?.photographer?.name;

  const formatDate = (d: Date | string) => {
    const date = new Date(d);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  };

  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="hop-dong-${schedule._id}.pdf"`);
  doc.pipe(res);

  doc.registerFont('Regular', FONT_REGULAR).registerFont('Bold', FONT_BOLD);

  // ── Header ──────────────────────────────────────────────────────────────
  doc.font('Bold').fontSize(18).text('YUME STUDIO', { align: 'center' });
  doc
    .font('Regular')
    .fontSize(10)
    .text('ĐC: [Địa chỉ studio]  •  SĐT: [Số điện thoại]', { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);

  // ── Title ────────────────────────────────────────────────────────────────
  doc.font('Bold').fontSize(16).text('HỢP ĐỒNG CHỤP ẢNH KỶ YẾU', { align: 'center' });
  doc
    .font('Regular')
    .fontSize(10)
    .text(`Số hợp đồng: HD-${String(schedule._id).slice(-6).toUpperCase()}`, { align: 'center' });
  doc.moveDown(1);

  // ── Parties ──────────────────────────────────────────────────────────────
  doc.font('Bold').fontSize(12).text('A. CÁC BÊN THAM GIA HỢP ĐỒNG');
  doc.moveDown(0.3);
  doc.font('Bold').fontSize(10).text('BÊN A (Studio):');
  doc
    .font('Regular')
    .fontSize(10)
    .text('Tên: Yume Studio')
    .text('Địa chỉ: [Địa chỉ studio]')
    .text('Điện thoại: [Số điện thoại]');
  doc.moveDown(0.5);

  doc.font('Bold').fontSize(10).text('BÊN B (Khách hàng):');
  doc
    .font('Regular')
    .fontSize(10)
    .text(`Đại diện lớp: ${customer?.contactName ?? '____________________'}`)
    .text(
      `Lớp / Trường: ${[customer?.className, schoolName(customer)].filter(Boolean).join(' – ')}`,
    )
    .text(`Số điện thoại: ${customer?.contactPhone ?? '____________________'}`);
  doc.moveDown(1);

  // ── Schedule details ─────────────────────────────────────────────────────
  doc.font('Bold').fontSize(12).text('B. THÔNG TIN BUỔI CHỤP');
  doc.moveDown(0.3);

  const rows: [string, string][] = [
    ['Ngày chụp', formatDate(schedule.shootDate)],
    ['Giờ bắt đầu', schedule.startTime ?? '—'],
    ['Giờ kết thúc', schedule.endTime ?? '—'],
    ['Địa điểm', schedule.location ?? '—'],
    ['Thợ leader', leadName],
    ['Thợ support', supportNames.length ? supportNames.join(', ') : '—'],
    ...(videographerName ? [['Thợ quay', videographerName] as [string, string]] : []),
    ['Số lượng học sinh', String(customer?.total ?? '—')],
  ];

  for (const [label, value] of rows) {
    const y = doc.y;
    doc
      .font('Bold')
      .fontSize(10)
      .text(label + ':', 50, y, { width: 150, continued: false });
    doc.font('Regular').fontSize(10).text(value, 210, y);
    doc.moveDown(0.1);
  }
  doc.moveDown(0.8);

  // ── Terms ────────────────────────────────────────────────────────────────
  doc.font('Bold').fontSize(12).text('C. ĐIỀU KHOẢN HỢP ĐỒNG');
  doc.moveDown(0.3);
  const terms = [
    '1. Studio cam kết thực hiện đúng lịch chụp đã thoả thuận. Trường hợp bất khả kháng sẽ thông báo trước ít nhất 24 giờ.',
    '2. Bên B cần xác nhận lịch chụp trước 48 giờ. Nếu huỷ sau thời hạn này, khoản đặt cọc sẽ không được hoàn lại.',
    '3. Ảnh gốc sẽ được bàn giao sau khi bên B thanh toán đầy đủ.',
    '4. Thời gian bàn giao ảnh chỉnh sửa: trong vòng 30 ngày làm việc kể từ ngày chụp.',
    '5. Mọi tranh chấp phát sinh sẽ được giải quyết trên tinh thần thương lượng, hoà giải.',
  ];
  for (const t of terms) {
    doc.font('Regular').fontSize(10).text(t, { width: 495 });
    doc.moveDown(0.3);
  }
  doc.moveDown(0.8);

  // ── Notes ────────────────────────────────────────────────────────────────
  if (schedule.notes) {
    doc.font('Bold').fontSize(12).text('D. GHI CHÚ THÊM');
    doc.moveDown(0.3);
    doc.font('Regular').fontSize(10).text(schedule.notes, { width: 495 });
    doc.moveDown(0.8);
  }

  // ── Signatures ───────────────────────────────────────────────────────────
  doc
    .font('Regular')
    .fontSize(10)
    .text(`Hà Nội, ngày ${formatDate(new Date())}`, { align: 'right' });
  doc.moveDown(1);

  const sigY = doc.y;
  doc.font('Bold').fontSize(10).text('ĐẠI DIỆN BÊN A', 50, sigY, { width: 220, align: 'center' });
  doc.font('Bold').fontSize(10).text('ĐẠI DIỆN BÊN B', 325, sigY, { width: 220, align: 'center' });
  doc
    .font('Regular')
    .fontSize(9)
    .text('(Ký và ghi rõ họ tên)', 50, doc.y, { width: 220, align: 'center' });
  doc
    .font('Regular')
    .fontSize(9)
    .text('(Ký và ghi rõ họ tên)', 325, doc.y, { width: 220, align: 'center' });

  doc.end();
};
