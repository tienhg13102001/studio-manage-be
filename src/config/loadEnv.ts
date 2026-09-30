import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/**
 * Nạp env cho backend từ thư mục gốc backend/:
 *   .env.local  — env dev ở máy (ưu tiên, bị gitignore)
 *   .env        — fallback (kiểu cũ)
 * dotenv không ghi đè biến đã có, nên thứ tự = độ ưu tiên; biến do docker/shell đặt
 * (production: compose `env_file`) luôn thắng. Trên VPS không có file nào ở đây.
 */
const ROOT = path.resolve(__dirname, '..', '..');

export const loadEnv = (): void => {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT, file);
    if (fs.existsSync(p)) dotenv.config({ path: p });
  }
};

loadEnv();
