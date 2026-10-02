import '../config/loadEnv';

import mongoose, { Types } from 'mongoose';
import Customer, { CustomerStatus } from '../models/Customer';
import Schedule from '../models/Schedule';

/**
 * Gán trạng thái quy trình cho các lớp cũ chưa có `status`, suy ra từ lịch chụp:
 *   (bỏ qua lịch cancelled) có lịch completed → shot; có lịch đã có hợp đồng → scheduled; có lịch → deposited; còn lại → new.
 * Đồng thời gán assignedSale = bookedBy của lịch chụp (nếu lớp chưa có sale).
 *
 * Mặc định chạy thử (chỉ in thống kê). Thêm `--apply` để ghi vào DB:
 *   yarn migrate:customer-status [--apply]
 *   node dist/utils/migrateCustomerStatus.js --apply   (trong container prod)
 */
const APPLY = process.argv.includes('--apply');

const migrate = async (): Promise<void> => {
  if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI');
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to database: ${mongoose.connection.name}`);
  console.log(APPLY ? 'Chế độ: --apply (ghi DB)' : 'Chế độ: dry-run (không ghi DB)');

  const customers = await Customer.find({ status: null })
    .select('_id assignedSale')
    .lean<{ _id: Types.ObjectId; assignedSale?: Types.ObjectId | null }[]>();
  console.log(`\nTìm thấy ${customers.length} lớp chưa có trạng thái`);

  const counts: Partial<Record<CustomerStatus, number>> = {};
  let assigned = 0;
  const ops: mongoose.AnyBulkWriteOperation[] = [];

  for (const c of customers) {
    // Bỏ qua lịch đã huỷ
    const schedules = await Schedule.find({ customer: c._id, status: { $ne: 'cancelled' } })
      .sort({ shootDate: 1 })
      .select('status contractUrl bookedBy')
      .lean();

    let status: CustomerStatus = 'new';
    // Script lịch sử: chạy trước khi lịch chụp bỏ trạng thái `completed` (nay chỉ còn active/cancelled)
    if (schedules.some((s) => (s.status as string) === 'completed')) status = 'shot';
    else if (schedules.some((s) => s.contractUrl)) status = 'scheduled';
    else if (schedules.length) status = 'deposited';
    counts[status] = (counts[status] ?? 0) + 1;

    const set: Record<string, unknown> = { status };
    const bookedBy = schedules.find((s) => s.bookedBy)?.bookedBy;
    if (!c.assignedSale && bookedBy) {
      set.assignedSale = bookedBy;
      assigned++;
    }
    // Lọc thêm status null → chạy lại không ghi đè trạng thái app đã đặt
    ops.push({ updateOne: { filter: { _id: c._id, status: null }, update: { $set: set } } });
  }

  console.log('\nPhân bổ trạng thái:');
  for (const [s, n] of Object.entries(counts)) console.log(`  • ${s}: ${n}`);
  console.log(`Gán sale phụ trách từ bookedBy: ${assigned}`);

  if (APPLY && ops.length) {
    const result = await Customer.bulkWrite(ops);
    console.log(`\n✅ Đã cập nhật ${result.modifiedCount} lớp`);
  } else if (!APPLY) {
    console.log('\nDry-run xong. Chạy lại với --apply để ghi DB.');
  }

  await mongoose.disconnect();
};

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
