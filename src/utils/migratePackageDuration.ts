import path from 'path';
import dotenv from 'dotenv';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.join(__dirname, '../..', envFile) });

import mongoose from 'mongoose';
import Package from '../models/Package';

const migrate = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI as string);
  console.log('Connected to MongoDB');

  // two_days và three_days là giá trị cũ, cần xoá (đặt về null)
  const obsolete = await Package.updateMany(
    { duration: { $in: ['two_days', 'three_days'] } },
    { $unset: { duration: '' } },
  );
  console.log(`Cleared obsolete duration values: ${obsolete.modifiedCount} document(s) updated`);

  await mongoose.disconnect();
  console.log('Done');
};

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
