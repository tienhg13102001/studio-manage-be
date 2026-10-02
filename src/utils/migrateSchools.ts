import '../config/loadEnv';

import mongoose, { Types } from 'mongoose';
import Customer from '../models/Customer';
import School, { normalizeSchoolName, toSchoolSearchKey } from '../models/School';

/**
 * Chuyển `customer.school` (chuỗi) → collection `schools` + `customer.schoolId`.
 *
 * - Gom theo tên chuẩn hoá (NFC, chữ thường, gộp khoảng trắng); mỗi nhóm upsert 1 School
 *   (atomic `findOneAndUpdate` + `$setOnInsert` theo `nameKey`, sau `School.init()` để chắc chắn
 *   có unique index), tên lấy theo cách viết gặp đầu tiên (đã trim).
 * - Chỉ gán `schoolId` cho lớp CHƯA có schoolId (null / không có field). Mỗi lớp được cập nhật
 *   trong MỘT lệnh: set `schoolId` + sao lưu `legacySchool` + unset `school`, lọc theo đúng chuỗi
 *   `school` còn trên document và `schoolId: null` → không ghi đè schoolId đã có.
 * - Lớp còn `school` dạng chuỗi nhưng ĐÃ có schoolId: không đụng schoolId, chỉ sao lưu
 *   `legacySchool` (nếu chưa có) rồi unset `school`.
 * - Trường rỗng / toàn khoảng trắng → không gán schoolId (vẫn sao lưu legacySchool rồi unset).
 * - Bảo thủ: tên chỉ khác dấu ("Dong Do" / "Đông Đô") vẫn thành các trường RIÊNG (theo nameKey);
 *   dry-run in mục "POSSIBLE DUPLICATES" để gộp tay nếu cần.
 * - Idempotent: chỉ quét lớp còn `school` dạng chuỗi. Server tự chạy (không dry-run) lúc khởi động.
 *
 * --dry-run hoàn toàn chỉ đọc: kết nối với `autoIndex: false, autoCreate: false` (không tạo
 * collection / index), không gọi `School.init()`, chỉ chạy truy vấn đọc.
 *
 * Chạy tay:
 *   yarn migrate:schools --dry-run          (local, ts-node)
 *   yarn migrate:schools --rollback
 * Trên VPS (backend chạy trong container `studio-backend`, code đã build ra dist/):
 *   docker exec studio-backend node dist/utils/migrateSchools.js --dry-run
 *   docker exec studio-backend node dist/utils/migrateSchools.js            (ghi DB — thường không cần, server tự chạy)
 *   docker exec studio-backend node dist/utils/migrateSchools.js --rollback
 * Lưu ý: server mới tự migrate khi khởi động, nên muốn dry-run trước thì chép dist/ mới lên VPS
 * rồi chạy lệnh dry-run TRƯỚC khi restart container.
 *
 * --rollback: khôi phục `school` (ưu tiên legacySchool; nếu lớp đã đổi sang trường khác sau migration
 * thì lấy tên School hiện tại), rồi unset `schoolId` + `legacySchool`. Không xoá document School.
 * Lưu ý: lớp đã bị XOÁ trường (schoolId = null) sau migration vẫn còn legacySchool → rollback sẽ
 * khôi phục lại tên trường cũ đó (không giữ trạng thái "không có trường").
 * Rollback chỉ có nghĩa khi quay lại bản backend cũ: bản mới sẽ migrate lại ở lần khởi động kế tiếp.
 */

interface RawCustomer {
  _id: Types.ObjectId;
  school: string;
  schoolId?: Types.ObjectId | null;
  legacySchool?: string;
}

interface SchoolGroup {
  key: string;
  name: string;
  spellings: Map<string, number>;
  customers: RawCustomer[];
}

/** Lớp chưa có schoolId: null hoặc không có field */
const NO_SCHOOL_ID = { schoolId: { $in: [null] } };

const buildGroups = async (): Promise<{
  groups: SchoolGroup[];
  blanks: RawCustomer[];
  linked: RawCustomer[];
}> => {
  // Truy cập collection gốc vì schema Customer không còn field `school`
  const rows = await Customer.collection
    .find<RawCustomer>(
      { school: { $type: 'string' } },
      { projection: { school: 1, schoolId: 1, legacySchool: 1 } },
    )
    .sort({ createdAt: 1, _id: 1 })
    .toArray();

  const groups = new Map<string, SchoolGroup>();
  const blanks: RawCustomer[] = [];
  // Đã có schoolId → chỉ sao lưu + unset `school`
  const linked: RawCustomer[] = [];
  for (const row of rows) {
    if (row.schoolId) {
      linked.push(row);
      continue;
    }
    const key = normalizeSchoolName(row.school);
    if (!key) {
      blanks.push(row);
      continue;
    }
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name: row.school.normalize('NFC').trim().replace(/\s+/g, ' '),
        spellings: new Map(),
        customers: [],
      };
      groups.set(key, g);
    }
    g.spellings.set(row.school, (g.spellings.get(row.school) ?? 0) + 1);
    g.customers.push(row);
  }
  return { groups: [...groups.values()], blanks, linked };
};

const isDuplicateKey = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;

/** Upsert nguyên tử theo nameKey; trả về id + có phải vừa tạo mới không */
const upsertSchool = async (
  name: string,
  key: string,
): Promise<{ id: Types.ObjectId; created: boolean }> => {
  try {
    // findOneAndUpdate bỏ qua hook pre('validate') → tự tính nameKey/searchKey
    const res = await School.findOneAndUpdate(
      { nameKey: key },
      { $setOnInsert: { name, nameKey: key, searchKey: toSchoolSearchKey(name) } },
      { upsert: true, new: true, includeResultMetadata: true, projection: { _id: 1 } },
    );
    if (!res.value) throw new Error(`Upsert School "${name}" không trả về document`);
    return {
      id: res.value._id as Types.ObjectId,
      created: !res.lastErrorObject?.updatedExisting,
    };
  } catch (e) {
    // Trùng khoá (upsert song song) → đọc lại bản đã có
    if (!isDuplicateKey(e)) throw e;
    const again = await School.findOne({ nameKey: key }).select('_id').lean();
    if (again) return { id: again._id as Types.ObjectId, created: false };
    throw e;
  }
};

/** Nhóm tên (khác nameKey) cùng searchKey không dấu — sẽ thành các trường riêng */
const findPossibleDuplicates = (groups: SchoolGroup[]): SchoolGroup[][] => {
  const bySearchKey = new Map<string, SchoolGroup[]>();
  for (const g of groups) {
    const sk = toSchoolSearchKey(g.name);
    bySearchKey.set(sk, [...(bySearchKey.get(sk) ?? []), g]);
  }
  return [...bySearchKey.values()].filter((list) => list.length > 1);
};

export interface MigrateSchoolsResult {
  schools: number;
  schoolsCreated: number;
  customersMatched: number;
  customersUpdated: number;
  blanks: number;
  /** Lớp còn `school` chuỗi nhưng đã có schoolId (chỉ sao lưu + unset) */
  alreadyLinked: number;
}

export const migrateSchools = async ({
  dryRun = false,
}: { dryRun?: boolean } = {}): Promise<MigrateSchoolsResult> => {
  const { groups, blanks, linked } = await buildGroups();
  const customersMatched =
    groups.reduce((n, g) => n + g.customers.length, 0) + blanks.length + linked.length;
  const result: MigrateSchoolsResult = {
    schools: groups.length,
    schoolsCreated: 0,
    customersMatched,
    customersUpdated: 0,
    blanks: blanks.length,
    alreadyLinked: linked.length,
  };

  if (dryRun) {
    console.log(`[Migration][dry-run] Số tên trường khác nhau (sau chuẩn hoá): ${groups.length}`);
    for (const g of groups) {
      const exists = await School.exists({ nameKey: g.key });
      const merged = [...g.spellings.entries()].map(([s, n]) => `"${s}" ×${n}`).join(', ');
      console.log(
        `  • ${g.name} → ${g.customers.length} lớp${exists ? ' (School đã có)' : ''}` +
          (g.spellings.size > 1 ? ` — gộp: ${merged}` : ''),
      );
    }
    const dupes = findPossibleDuplicates(groups);
    if (dupes.length) {
      console.log(
        `[Migration][dry-run] POSSIBLE DUPLICATES — ${dupes.length} nhóm tên chỉ khác dấu, ` +
          'sẽ thành các trường RIÊNG (kiểm tra & gộp tay nếu cần):',
      );
      for (const list of dupes) {
        console.log(
          `  • ${list.map((g) => `"${g.name}" (${g.customers.length} lớp)`).join(' / ')}`,
        );
      }
    } else {
      console.log('[Migration][dry-run] POSSIBLE DUPLICATES: không có');
    }
    console.log(`[Migration][dry-run] Lớp trường rỗng (không gán schoolId): ${blanks.length}`);
    console.log(
      `[Migration][dry-run] Lớp đã có schoolId (chỉ sao lưu legacySchool + bỏ school): ${linked.length}`,
    );
    console.log(`[Migration][dry-run] Tổng số lớp sẽ cập nhật: ${customersMatched}`);
    return result;
  }

  // Đảm bảo unique index nameKey đã có trước khi upsert (tránh tạo trùng khi chạy song song)
  await School.init();

  for (const g of groups) {
    const { id: schoolId, created } = await upsertSchool(g.name, g.key);
    if (created) result.schoolsCreated++;
    const written = await Customer.collection.bulkWrite(
      g.customers.map((c) => ({
        updateOne: {
          filter: { _id: c._id, school: c.school, ...NO_SCHOOL_ID },
          update: {
            $set: { schoolId, legacySchool: c.school },
            $unset: { school: '' },
          },
        },
      })),
      { ordered: false },
    );
    result.customersUpdated += written.modifiedCount;
  }

  if (blanks.length) {
    const written = await Customer.collection.bulkWrite(
      blanks.map((c) => ({
        updateOne: {
          filter: { _id: c._id, school: c.school, ...NO_SCHOOL_ID },
          update: { $set: { legacySchool: c.school }, $unset: { school: '' } },
        },
      })),
      { ordered: false },
    );
    result.customersUpdated += written.modifiedCount;
  }

  if (linked.length) {
    // Không đụng schoolId; chỉ sao lưu legacySchool khi chưa có
    const written = await Customer.collection.bulkWrite(
      linked.map((c) =>
        c.legacySchool == null
          ? {
              updateOne: {
                filter: { _id: c._id, school: c.school, legacySchool: { $in: [null] } },
                update: { $set: { legacySchool: c.school }, $unset: { school: '' } },
              },
            }
          : {
              updateOne: {
                filter: { _id: c._id, school: c.school },
                update: { $unset: { school: '' } },
              },
            },
      ),
      { ordered: false },
    );
    result.customersUpdated += written.modifiedCount;
  }

  console.log(
    `[Migration] school → schoolId: ${result.schools} trường (tạo mới ${result.schoolsCreated}), ` +
      `${result.customersMatched} lớp cần chuyển, đã cập nhật ${result.customersUpdated}` +
      `, trường rỗng ${result.blanks}, đã có schoolId ${result.alreadyLinked}`,
  );
  return result;
};

/** Khôi phục `school` dạng chuỗi; giữ nguyên collection schools. */
export const rollbackSchools = async (): Promise<number> => {
  const rows = await Customer.collection
    .find<{
      _id: Types.ObjectId;
      schoolId?: Types.ObjectId | null;
      legacySchool?: string;
    }>(
      { $or: [{ legacySchool: { $exists: true } }, { schoolId: { $ne: null } }] },
      { projection: { schoolId: 1, legacySchool: 1 } },
    )
    .toArray();

  const ids = [
    ...new Set(
      rows
        .map((r) => r.schoolId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const schools = await School.find({ _id: { $in: ids } })
    .select('name nameKey')
    .lean();
  const byId = new Map(schools.map((s) => [String(s._id), s]));

  const ops = rows.map((r) => {
    const current = r.schoolId ? byId.get(String(r.schoolId)) : undefined;
    let school: string | undefined = r.legacySchool;
    // Đã đổi sang trường khác sau migration → lấy tên trường hiện tại
    if (current && (school === undefined || normalizeSchoolName(school) !== current.nameKey)) {
      school = current.name;
    }
    const update: Record<string, unknown> = { $unset: { schoolId: '', legacySchool: '' } };
    if (school !== undefined) update.$set = { school };
    return { updateOne: { filter: { _id: r._id }, update } };
  });

  let modified = 0;
  if (ops.length) {
    const written = await Customer.collection.bulkWrite(ops, { ordered: false });
    modified = written.modifiedCount;
  }
  console.log(`[Migration][rollback] Đã khôi phục school cho ${modified}/${rows.length} lớp`);
  return modified;
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

/** Hook khởi động: thử lại tối đa 3 lần, lỗi chỉ log — không làm sập server. */
export const migrateSchoolsOnStartup = async (): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await migrateSchools();
      return;
    } catch (e) {
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[Migration] chuyển school → schoolId thất bại (lần ${attempt}/${MAX_ATTEMPTS}), thử lại:`,
          e,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        console.error(
          `[Migration] ERROR: chuyển school → schoolId thất bại sau ${MAX_ATTEMPTS} lần — ` +
            'một số lớp còn tên trường dạng chuỗi, sẽ thử lại ở lần khởi động sau:',
          e,
        );
      }
    }
  }
};

if (require.main === module) {
  const DRY_RUN = process.argv.includes('--dry-run');
  const ROLLBACK = process.argv.includes('--rollback');
  (async () => {
    if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI');
    // Dry-run: không tạo collection / index khi kết nối → hoàn toàn chỉ đọc
    await mongoose.connect(
      process.env.MONGO_URI,
      DRY_RUN ? { autoIndex: false, autoCreate: false } : {},
    );
    console.log(`Connected to database: ${mongoose.connection.name}`);
    if (ROLLBACK) {
      if (DRY_RUN) console.log('--rollback không hỗ trợ --dry-run; bỏ qua.');
      else await rollbackSchools();
    } else {
      await migrateSchools({ dryRun: DRY_RUN });
    }
    await mongoose.disconnect();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
