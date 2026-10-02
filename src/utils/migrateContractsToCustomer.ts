import '../config/loadEnv';

import mongoose, { Types } from 'mongoose';
import Customer from '../models/Customer';
import Schedule from '../models/Schedule';
import type { IExtraService } from '../models/extraService';

/**
 * Chuyển hợp đồng + folder Drive từ lịch chụp (Schedule.contract* / driveFolder*) sang lớp
 * (`Customer.contract`, `Customer.driveFolderUrl/Id`).
 *
 * - Hợp đồng: lớp CHƯA có `contract` ← lịch CHƯA HUỶ "tốt nhất" có `contractUrl` (ưu tiên: có
 *   `contractDocId` → `contractDepositSyncedAt` mới nhất → `shootDate` mới nhất → `updatedAt` mới
 *   nhất): url, docId, total, package, shootDate, location, extraServices, depositAmount,
 *   depositSyncedAt (+ `migratedFromSchedule`; `createdAt`/`createdBy` = null). Lớp chỉ có hợp đồng
 *   trên lịch ĐÃ HUỶ → không chuyển, in ở mục SKIPPED (cancelled only).
 * - Folder Drive: lớp CHƯA có `driveFolderUrl` ← lịch tốt nhất có `driveFolderUrl` (lịch chưa huỷ
 *   trước, rồi lịch đã huỷ — folder vô hại nên vẫn lấy làm phương án cuối; cùng thứ tự ưu tiên).
 * - Mỗi lớp cập nhật nguyên tử, lọc theo `contract: null/không có` / `driveFolderUrl: null/''/không
 *   có` → không ghi đè dữ liệu đã có. Idempotent. KHÔNG xoá field cũ trên Schedule.
 * - Lớp có >1 lịch (được xét) với contractUrl / driveFolderUrl KHÁC nhau → in ở mục CONFLICTS (vẫn
 *   lấy lịch tốt nhất); dry-run in đầy đủ để kiểm tra trước.
 * - Server tự chạy (không dry-run) lúc khởi động.
 *
 * --dry-run hoàn toàn chỉ đọc: kết nối với `autoIndex: false, autoCreate: false`, chỉ chạy truy vấn đọc.
 *
 * --rollback (không phá dữ liệu): chép hợp đồng / folder của lớp NGƯỢC lại lịch chụp để backend cũ
 * thấy hợp đồng / folder tạo SAU migration:
 *   - Bỏ qua nếu đã có lịch nào của lớp mang đúng link đó.
 *   - Hợp đồng: lịch đích = `contract.migratedFromSchedule` (nếu lịch còn tồn tại) — ghi đè link cũ
 *     trên lịch đó (là link đã được chuyển sang, lớp đã "Tạo lại" sau đó); không thì lịch chưa huỷ có
 *     `shootDate` mới nhất, chỉ ghi khi lịch đó chưa có `contractUrl`.
 *   - Folder: lịch chưa huỷ có `shootDate` mới nhất, chỉ ghi khi lịch đó chưa có `driveFolderUrl`.
 *   Không xoá `Customer.contract` / `driveFolderUrl` (backend cũ bỏ qua các field này). Field chỉ có
 *   trên lớp (crewCount, createdBy…) không chép về lịch.
 *
 * Chạy tay:
 *   yarn migrate:contracts --dry-run
 *   yarn migrate:contracts --rollback
 * Trên VPS (container `studio-backend`, code đã build ra dist/):
 *   docker exec studio-backend node dist/utils/migrateContractsToCustomer.js --dry-run
 *   docker exec studio-backend node dist/utils/migrateContractsToCustomer.js --rollback
 */

interface LegacySchedule {
  _id: Types.ObjectId;
  customer: Types.ObjectId;
  status?: string;
  updatedAt?: Date;
  package?: Types.ObjectId | null;
  shootDate?: Date;
  location?: string;
  extraServices?: IExtraService[];
  contractUrl?: string;
  contractDocId?: string | null;
  contractTotal?: number | null;
  contractDepositAmount?: number | null;
  contractDepositSyncedAt?: Date | null;
  driveFolderUrl?: string;
  driveFolderId?: string;
}

export interface ContractMigrationResult {
  contractsCandidates: number;
  contractsMigrated: number;
  foldersCandidates: number;
  foldersMigrated: number;
  conflicts: string[];
  /** Lớp chỉ có hợp đồng trên lịch đã huỷ → không chuyển. */
  skippedCancelledOnly: string[];
}

const time = (d?: Date | null) => (d ? new Date(d).getTime() : 0);
const isCancelled = (s: LegacySchedule) => s.status === 'cancelled';

/**
 * Thứ tự ưu tiên: lịch chưa huỷ trước → có contractDocId → contractDepositSyncedAt mới nhất →
 * shootDate mới nhất → updatedAt mới nhất.
 */
const byPreference = (a: LegacySchedule, b: LegacySchedule) =>
  Number(isCancelled(a)) - Number(isCancelled(b)) ||
  Number(!!b.contractDocId) - Number(!!a.contractDocId) ||
  time(b.contractDepositSyncedAt) - time(a.contractDepositSyncedAt) ||
  time(b.shootDate) - time(a.shootDate) ||
  time(b.updatedAt) - time(a.updatedAt);

const groupByCustomer = (rows: LegacySchedule[]) => {
  const map = new Map<string, LegacySchedule[]>();
  for (const r of rows) {
    const key = String(r.customer);
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  }
  for (const list of map.values()) list.sort(byPreference);
  return map;
};

const NO_CONTRACT = { contract: { $in: [null] } };
const NO_FOLDER = { driveFolderUrl: { $in: [null, ''] } };

export const migrateContractsToCustomer = async ({
  dryRun = false,
}: { dryRun?: boolean } = {}): Promise<ContractMigrationResult> => {
  const result: ContractMigrationResult = {
    contractsCandidates: 0,
    contractsMigrated: 0,
    foldersCandidates: 0,
    foldersMigrated: 0,
    conflicts: [],
    skippedCancelledOnly: [],
  };

  // Collection gốc: field legacy không qua default/cast của schema
  const rows = await Schedule.collection
    .find<LegacySchedule>(
      {
        $or: [{ contractUrl: { $nin: [null, ''] } }, { driveFolderUrl: { $nin: [null, ''] } }],
      },
      {
        projection: {
          customer: 1,
          status: 1,
          updatedAt: 1,
          package: 1,
          shootDate: 1,
          location: 1,
          extraServices: 1,
          contractUrl: 1,
          contractDocId: 1,
          contractTotal: 1,
          contractDepositAmount: 1,
          contractDepositSyncedAt: 1,
          driveFolderUrl: 1,
          driveFolderId: 1,
        },
      },
    )
    .toArray();
  if (!rows.length) return result;

  const groups = groupByCustomer(rows.filter((r) => r.customer));
  const ids = [...groups.keys()].map((id) => new Types.ObjectId(id));
  const customers = await Customer.collection
    .find<{
      _id: Types.ObjectId;
      className?: string;
      contract?: unknown;
      driveFolderUrl?: string | null;
    }>({ _id: { $in: ids } }, { projection: { className: 1, contract: 1, driveFolderUrl: 1 } })
    .toArray();

  for (const c of customers) {
    const list = groups.get(String(c._id)) ?? [];
    const label = `${c.className ?? '?'} (${c._id})`;

    // Hợp đồng chỉ lấy từ lịch CHƯA huỷ; folder lấy cả lịch đã huỷ (sau lịch chưa huỷ)
    const withContract = list.filter((s) => s.contractUrl && !isCancelled(s));
    const withFolder = list.filter((s) => s.driveFolderUrl);
    if (!c.contract && !withContract.length && list.some((s) => s.contractUrl)) {
      result.skippedCancelledOnly.push(label);
    }
    if (new Set(withContract.map((s) => s.contractUrl)).size > 1) {
      result.conflicts.push(
        `${label}: ${withContract.length} lịch có hợp đồng khác nhau → lấy lịch ${withContract[0]._id}`,
      );
    }
    if (new Set(withFolder.map((s) => s.driveFolderUrl)).size > 1) {
      result.conflicts.push(
        `${label}: ${withFolder.length} lịch có folder Drive khác nhau → lấy lịch ${withFolder[0]._id}`,
      );
    }

    const src = withContract[0];
    if (src && !c.contract) {
      result.contractsCandidates++;
      if (!dryRun) {
        const written = await Customer.collection.updateOne(
          { _id: c._id, ...NO_CONTRACT },
          {
            $set: {
              contract: {
                url: src.contractUrl,
                docId: src.contractDocId ?? null,
                total: src.contractTotal ?? null,
                package: src.package ?? null,
                shootDate: src.shootDate ?? null,
                location: src.location ?? '',
                extraServices: src.extraServices ?? [],
                crewCount: null,
                crewCountSystem: null,
                depositAmount: src.contractDepositAmount ?? null,
                depositSyncedAt: src.contractDepositSyncedAt ?? null,
                createdAt: null,
                createdBy: null,
                migratedFromSchedule: src._id,
              },
            },
          },
        );
        result.contractsMigrated += written.modifiedCount;
      }
    }

    const folder = withFolder[0];
    if (folder && !c.driveFolderUrl) {
      result.foldersCandidates++;
      if (!dryRun) {
        const written = await Customer.collection.updateOne(
          { _id: c._id, ...NO_FOLDER },
          {
            $set: {
              driveFolderUrl: folder.driveFolderUrl,
              driveFolderId: folder.driveFolderId ?? null,
            },
          },
        );
        result.foldersMigrated += written.modifiedCount;
      }
    }
  }

  const prefix = dryRun ? '[Migration][dry-run]' : '[Migration]';
  console.log(
    `${prefix} hợp đồng/folder → lớp: ${result.contractsCandidates} hợp đồng cần chuyển` +
      `${dryRun ? '' : ` (đã chuyển ${result.contractsMigrated})`}, ` +
      `${result.foldersCandidates} folder cần chuyển` +
      `${dryRun ? '' : ` (đã chuyển ${result.foldersMigrated})`}, ` +
      `${result.conflicts.length} xung đột, ${result.skippedCancelledOnly.length} bỏ qua (chỉ có trên lịch huỷ)`,
  );
  if (result.conflicts.length) {
    console.log(`${prefix} CONFLICTS:\n  - ${result.conflicts.join('\n  - ')}`);
  }
  if (result.skippedCancelledOnly.length) {
    console.log(
      `${prefix} SKIPPED (cancelled only):\n  - ${result.skippedCancelledOnly.join('\n  - ')}`,
    );
  }
  return result;
};

/** Chép hợp đồng / folder của lớp về lịch chụp (xem `--rollback` ở đầu file). */
export const rollbackContractsToSchedule = async (): Promise<number> => {
  const customers = await Customer.collection
    .find<{
      _id: Types.ObjectId;
      contract?: {
        url?: string;
        docId?: string | null;
        total?: number | null;
        depositAmount?: number | null;
        depositSyncedAt?: Date | null;
        migratedFromSchedule?: Types.ObjectId | null;
      } | null;
      driveFolderUrl?: string | null;
      driveFolderId?: string | null;
    }>(
      { $or: [{ 'contract.url': { $nin: [null, ''] } }, { driveFolderUrl: { $nin: [null, ''] } }] },
      { projection: { contract: 1, driveFolderUrl: 1, driveFolderId: 1 } },
    )
    .toArray();

  let modified = 0;
  for (const c of customers) {
    const schedules = await Schedule.collection
      .find<
        Pick<LegacySchedule, '_id' | 'status' | 'shootDate' | 'contractUrl' | 'driveFolderUrl'>
      >({ customer: c._id }, { projection: { status: 1, shootDate: 1, contractUrl: 1, driveFolderUrl: 1 } })
      .toArray();
    const newestActive = schedules
      .filter((s) => s.status !== 'cancelled')
      .sort((a, b) => time(b.shootDate) - time(a.shootDate))[0];

    const contract = c.contract;
    if (contract?.url && !schedules.some((s) => s.contractUrl === contract.url)) {
      const source = contract.migratedFromSchedule
        ? schedules.find((s) => String(s._id) === String(contract.migratedFromSchedule))
        : undefined;
      const target = source ?? newestActive;
      // Lịch nguồn của migration: ghi đè link đã chuyển sang (lớp đã tạo lại hợp đồng sau đó).
      // Lịch khác: chỉ ghi khi chưa có hợp đồng.
      if (target && (source || !target.contractUrl)) {
        const w = await Schedule.collection.updateOne(
          { _id: target._id, contractUrl: target.contractUrl ?? { $in: [null, ''] } },
          {
            $set: {
              contractUrl: contract.url,
              contractDocId: contract.docId ?? null,
              contractTotal: contract.total ?? null,
              contractDepositAmount: contract.depositAmount ?? null,
              contractDepositSyncedAt: contract.depositSyncedAt ?? null,
            },
          },
        );
        modified += w.modifiedCount;
      }
    }

    if (
      c.driveFolderUrl &&
      newestActive &&
      !newestActive.driveFolderUrl &&
      !schedules.some((s) => s.driveFolderUrl === c.driveFolderUrl)
    ) {
      const w = await Schedule.collection.updateOne(
        { _id: newestActive._id, driveFolderUrl: { $in: [null, ''] } },
        { $set: { driveFolderUrl: c.driveFolderUrl, driveFolderId: c.driveFolderId ?? null } },
      );
      modified += w.modifiedCount;
    }
  }
  console.log(
    `[Migration][rollback] Đã chép hợp đồng/folder về lịch chụp: ${modified} cập nhật (${customers.length} lớp)`,
  );
  return modified;
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

/** Hook khởi động: thử lại tối đa 3 lần, lỗi chỉ log — không làm sập server. */
export const migrateContractsOnStartup = async (): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await migrateContractsToCustomer();
      return;
    } catch (e) {
      if (attempt < MAX_ATTEMPTS) {
        console.warn(
          `[Migration] chuyển hợp đồng/folder → lớp thất bại (lần ${attempt}/${MAX_ATTEMPTS}), thử lại:`,
          e,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        console.error(
          `[Migration] ERROR: chuyển hợp đồng/folder → lớp thất bại sau ${MAX_ATTEMPTS} lần — ` +
            'sẽ thử lại ở lần khởi động sau:',
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
      else await rollbackContractsToSchedule();
    } else {
      await migrateContractsToCustomer({ dryRun: DRY_RUN });
    }
    await mongoose.disconnect();
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
