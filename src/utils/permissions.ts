import type { UserRole } from '../models/User';

/**
 * Vai trò được phân công / đổi ekip thợ chụp (leadPhotographer, supportPhotographers).
 * Hiện chỉ Superadmin & Admin; vai trò "Điều phối" sẽ được thêm vào đây sau.
 * Giữ đồng bộ với frontend/src/utils/permissions.ts.
 */
export const CREW_EDITOR_ROLES: readonly UserRole[] = [0, 1];

export const CREW_FORBIDDEN_MSG = 'Chỉ quản trị viên mới được phân công ekip';

export const canEditCrew = (user: { roles?: readonly number[] } | null | undefined): boolean =>
  !!user?.roles?.some((r) => (CREW_EDITOR_ROLES as readonly number[]).includes(r));

/**
 * Cộng tác viên sale (kể cả khi kiêm Sale): chỉ xem lớp mình tạo / phụ trách, không xem thu chi.
 * Admin không bị giới hạn. Giữ đồng bộ với frontend/src/utils/permissions.ts.
 */
export const isSaleCollaborator = (
  user: { roles?: readonly number[] } | null | undefined,
): boolean => !!user?.roles?.includes(4) && !user.roles.some((r) => r === 0 || r === 1);

const idOrNull = (v: unknown): string | null => (v ? String(v) : null);

/** Body gửi ekip khác rỗng (thợ chính hoặc ít nhất một thợ phụ) — dùng khi tạo lịch. */
export const hasCrew = (body: {
  leadPhotographer?: unknown;
  supportPhotographers?: unknown;
  externalCrew?: unknown;
}) =>
  !!idOrNull(body.leadPhotographer) ||
  (Array.isArray(body.supportPhotographers) && body.supportPhotographers.some(Boolean)) ||
  (Array.isArray(body.externalCrew) && body.externalCrew.length > 0);

/**
 * Body cập nhật có đổi ekip so với lịch đang lưu không. Chỉ xét field client thực sự gửi
 * (`leadPhotographer` có trong body, `supportPhotographers` là mảng).
 */
export const crewChanged = (
  body: Record<string, unknown>,
  prev: { leadPhotographer?: unknown; supportPhotographers?: unknown[]; externalCrew?: unknown[] },
): boolean => {
  if (
    'leadPhotographer' in body &&
    idOrNull(body.leadPhotographer) !== idOrNull(prev.leadPhotographer)
  ) {
    return true;
  }
  if (Array.isArray(body.supportPhotographers)) {
    const next = [...new Set(body.supportPhotographers.filter(Boolean).map(String))].sort();
    const before = [...new Set((prev.supportPhotographers ?? []).map(String))].sort();
    if (next.join() !== before.join()) return true;
  }
  if ('externalCrew' in body) {
    return JSON.stringify(body.externalCrew) !== JSON.stringify(prev.externalCrew ?? []);
  }
  return false;
};
