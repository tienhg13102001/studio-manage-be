/**
 * Response DTOs returned to the client.
 * These types MUST stay in sync with `frontend/src/types/index.ts`.
 *
 * Rule: Model types (kept internally) hold ObjectId string references on
 * relations; Response DTOs hold fully populated documents so the frontend
 * receives a consistent, strict shape.
 */

import type { CustomerStatus } from '../models/Customer';
import type { ScheduleStatus } from '../models/Schedule';

export type UserRole = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface UserDto {
  _id: string;
  username: string;
  name?: string;
  roles: UserRole[];
  isActive: boolean;
  createdAt?: string;
}

/** Trường đã populate trên lớp (`customer.schoolId`). */
export interface SchoolRefDto {
  _id: string;
  name: string;
  address?: string;
}

export interface SchoolDto extends SchoolRefDto {
  note?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerDto {
  _id: string;
  className: string;
  schoolId?: SchoolRefDto | null;
  contactName: string;
  contactPhone: string;
  contactAddress: string;
  total: number;
  totalMale?: number;
  totalFemale?: number;
  notes?: string;
  /** Trạng thái quy trình của lớp — cũng là trạng thái hiển thị của lịch chụp. */
  status?: CustomerStatus;
  /** Ngày dự kiến chụp (ISO) */
  expectedShootDate?: string | null;
  /** Hợp đồng của lớp — null khi chưa có. */
  contract?: CustomerContractDto | null;
  /** Folder Drive ảnh của lớp. */
  driveFolderUrl?: string | null;
  driveFolderId?: string | null;
  createdAt?: string;
}

export interface CustomerContractDto {
  url: string;
  /** null = hợp đồng cũ, không tự cập nhật ô tiền cọc */
  docId?: string | null;
  total?: number | null;
  /** Package id */
  package?: string | null;
  /** Giá / thành viên in trên hợp đồng */
  pricePerMember?: number | null;
  shootDate?: string | null;
  location?: string;
  extraServices?: ExtraServiceDto[];
  crewCount?: number | null;
  crewCountSystem?: number | null;
  /** Số thợ quay MV in trên hợp đồng (gói có MV) */
  videoCrewCount?: number | null;
  /** Tiền cọc đang in; null = để trống "………" */
  depositAmount?: number | null;
  depositSyncedAt?: string | null;
  depositDate?: string | null;
  printed?: {
    className?: string;
    school?: string;
    contactName?: string;
    contactPhone?: string;
    contactAddress?: string;
    total?: number;
    totalMale?: number;
    totalFemale?: number;
  } | null;
  createdAt?: string | null;
  createdBy?: string | null;
  migratedFromSchedule?: string | null;
}

export interface CostumeDto {
  _id: string;
  name: string;
  description?: string;
  gender: 'male' | 'female' | 'unisex';
  createdAt?: string;
}

export interface PackageDto {
  _id: string;
  name: string;
  pricePerMember: number;
  duration?: 'full_day' | 'half_day' | 'two_thirds_day';
  costumes?: CostumeDto[];
  crewRatio?: string;
  editingScope?: 'full' | 'partial';
  deliveryDays?: number;
  studentsPerCrew?: number;
  /** Gói có quay MV kỷ yếu → mỗi lịch cần đúng 1 thợ quay */
  hasMv?: boolean;
  description?: string;
  createdAt?: string;
}

export interface CategoryDto {
  _id: string;
  name: string;
  type: 'income' | 'expense';
  isDefault: boolean;
  createdBy?: string;
}

export interface ExtraServiceDto {
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  note?: string;
}

/** Flat schedule — used for create/update payloads. */
export interface ScheduleDto {
  _id: string;
  customer: string;
  package: string | null;
  shootDate: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  leadPhotographer: string | null;
  supportPhotographers: string[];
  /** Thợ quay MV nội bộ (role 6); loại trừ với thợ ngoài role 'video' */
  videographer?: string | null;
  externalCrew: Array<{
    photographer: string;
    role: 'lead' | 'support' | 'video';
    confirmation: 'pending' | 'confirmed' | 'declined';
  }>;
  bookedBy: string | null;
  status: ScheduleStatus;
  notes?: string;
  season?: string | null;
  /** @deprecated legacy — hợp đồng giờ ở `CustomerDto.contract` */
  contractUrl?: string;
  /** @deprecated legacy */
  contractDocId?: string | null;
  /** @deprecated legacy */
  contractTotal?: number | null;
  /** @deprecated legacy */
  contractDepositAmount?: number | null;
  /** @deprecated legacy */
  contractDepositSyncedAt?: string | null;
  /** @deprecated legacy — folder giờ ở `CustomerDto.driveFolderUrl` */
  driveFolderUrl?: string;
  /** @deprecated legacy */
  driveFolderId?: string;
  extraServices?: ExtraServiceDto[];
  createdAt?: string;
}

/** Populated schedule returned by GET endpoints. */
export interface ScheduleResponse extends Omit<
  ScheduleDto,
  | 'customer'
  | 'package'
  | 'leadPhotographer'
  | 'supportPhotographers'
  | 'videographer'
  | 'externalCrew'
  | 'bookedBy'
> {
  customer: CustomerDto;
  package: PackageDto | null;
  leadPhotographer: UserDto | null;
  supportPhotographers: UserDto[];
  videographer?: UserDto | null;
  externalCrew: Array<{
    photographer: { _id: string; name: string; isActive: boolean } | null;
    role: 'lead' | 'support' | 'video';
    confirmation: 'pending' | 'confirmed' | 'declined';
  }>;
  bookedBy: UserDto | null;
}

export interface TransactionDto {
  _id: string;
  customer: string | null;
  type: 'income' | 'expense';
  amount: number;
  categoryId: string;
  description?: string;
  date: string;
  createdBy: string | null;
  accountantRefunded?: boolean;
  createdAt?: string;
}

export interface TransactionResponse extends Omit<
  TransactionDto,
  'customer' | 'categoryId' | 'createdBy'
> {
  customer: CustomerDto | null;
  categoryId: CategoryDto;
  createdBy: UserDto | null;
}

export interface TransactionSummaryRow {
  _id: string | null;
  customer?: CustomerDto;
  income: number;
  expense: number;
  profit: number;
  /** Số giao dịch (thu + chi). */
  count: number;
  incomeCount: number;
  expenseCount: number;
  /** Tổng các khoản chi kế toán chưa hoàn tiền. */
  pendingRefund: number;
  pendingRefundCount: number;
}

export interface StudentDto {
  _id: string;
  customer: string;
  name: string;
  gender: 'male' | 'female';
  height?: number;
  weight?: number;
  notes?: string;
  costumes: string[];
  createdAt?: string;
}

/** Populated student returned by GET endpoints. */
export interface StudentResponse extends Omit<StudentDto, 'costumes'> {
  costumes: CostumeDto[];
}

export interface FeedbackItemDto {
  rating: number;
  description?: string;
}

export interface FeedbackDto {
  _id: string;
  customer: string | null;
  phone?: string;
  crewFeedback: FeedbackItemDto;
  albumFeedback: FeedbackItemDto;
  content?: string;
  suggestion?: string;
  isRead: boolean;
  createdAt: string;
}

export interface FeedbackResponse extends Omit<FeedbackDto, 'customer'> {
  customer: CustomerDto | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalMale?: number;
  totalFemale?: number;
}

/** Global feedback stats (all feedback). Dist arrays: index 0..4 = count of 1..5 stars. */
export interface FeedbackStats {
  count: number;
  crewAvg: number;
  albumAvg: number;
  crewDist: number[];
  albumDist: number[];
}

export interface FeedbackListResponse extends PaginatedResponse<FeedbackResponse> {
  totalRead: number;
  totalUnread: number;
  stats: FeedbackStats;
}

export interface ErrorResponse {
  message: string;
}

/**
 * Public (unauthenticated) schedule shape — exposed by `/public/schedules/:customer`.
 * Intentionally narrower than `ScheduleResponse` to avoid leaking staff / booking info.
 */
export interface PublicScheduleResponse {
  _id: string;
  shootDate: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  status: ScheduleDto['status'];
  customer: Pick<CustomerDto, '_id' | 'className' | 'schoolId'>;
  costumes: CostumeDto[];
  package: {
    _id: string;
    name: string;
  } | null;
}

/** Upcoming schedule cell shown on the dashboard. */
export interface UpcomingScheduleDto {
  _id: string;
  shootDate: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  status: ScheduleDto['status'];
  customer?: Pick<CustomerDto, '_id' | 'className' | 'schoolId' | 'status'>;
  leadPhotographer?: Pick<UserDto, '_id' | 'name' | 'username'>;
  videographer?: Pick<UserDto, '_id' | 'name' | 'username'> | null;
  externalCrew?: Array<{
    photographer: { _id: string; name: string } | null;
    role: 'lead' | 'support' | 'video';
    confirmation: 'pending' | 'confirmed' | 'declined';
  }>;
}

export interface DashboardStats {
  totals: { income: number; expense: number; profit: number };
  daily: Array<{ label: string; income: number; expense: number }>;
  customerCount: number;
  scheduleCount: number;
  showSchedules: boolean;
  upcomingSchedules: UpcomingScheduleDto[];
}

// Season DTOs
export interface SeasonDto {
  _id: string;
  name: string;
  startDate: string;
  endDate: string;
  createdAt?: string;
}

export interface SeasonResponse extends SeasonDto {}
