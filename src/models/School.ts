import mongoose, { Document, Schema } from 'mongoose';

/** Khoá so trùng tên trường: NFC, chữ thường, gộp khoảng trắng ("  THPT  Chu Văn An " → "thpt chu văn an") */
export const normalizeSchoolName = (name: string): string =>
  name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Khoá tìm kiếm không dấu ("Trường Đông Đô" → "truong dong do") */
export const toSchoolSearchKey = (name: string): string =>
  normalizeSchoolName(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

export const SCHOOL_NAME_MAX = 200;
export const SCHOOL_ADDRESS_MAX = 500;
export const SCHOOL_NOTE_MAX = 1000;

export interface ISchool extends Document {
  name: string;
  nameKey: string;
  searchKey: string;
  address?: string;
  note?: string;
}

const schoolSchema = new Schema<ISchool>(
  {
    name: { type: String, required: true, trim: true, maxlength: SCHOOL_NAME_MAX },
    // Tự tính từ `name` (pre validate) — unique để không trùng tên khác hoa/thường/khoảng trắng
    nameKey: { type: String, required: true, unique: true },
    searchKey: { type: String, required: true, index: true },
    address: { type: String, trim: true, maxlength: SCHOOL_ADDRESS_MAX },
    note: { type: String, trim: true, maxlength: SCHOOL_NOTE_MAX },
  },
  { timestamps: true },
);

schoolSchema.pre('validate', function (next) {
  if (typeof this.name === 'string') {
    this.name = this.name.normalize('NFC').trim().replace(/\s+/g, ' ');
    this.nameKey = normalizeSchoolName(this.name);
    this.searchKey = toSchoolSearchKey(this.name);
  }
  next();
});

export default mongoose.model<ISchool>('School', schoolSchema);
