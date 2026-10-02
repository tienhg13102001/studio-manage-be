import { Router, Request, Response } from 'express';
import { isValidObjectId, type Types } from 'mongoose';
import Customer from '../models/Customer';
import Student from '../models/Student';
import Schedule from '../models/Schedule';
import Package from '../models/Package';
import * as feedbackController from '../controllers/feedbackController';
import type { CostumeDto, PublicScheduleResponse } from '../types/dto';
import { sendResponse } from '../utils/response';
import { findPreferredScheduleId } from '../services/scheduleService';

const router = Router();

// Submit feedback (public, no auth)
router.post('/feedback', feedbackController.submit);

// List packages (public, used by portfolio pricing section)
router.get('/packages', async (_req: Request, res: Response): Promise<void> => {
  const packages = await Package.find({})
    .select(
      'name pricePerMember duration crewRatio editingScope deliveryDays studentsPerCrew description costumes isPopular',
    )
    .populate('costumes', 'name')
    .sort({ pricePerMember: 1 });
  sendResponse(res, 200, true, 'OK', packages);
});

// Get all classes (for public form selector)
router.get('/customers', async (_req: Request, res: Response): Promise<void> => {
  const customers = await Customer.find({})
    .select('className schoolId')
    .populate('schoolId', 'name')
    .sort({ className: 1 });
  sendResponse(res, 200, true, 'OK', customers);
});

// Get class info by id (for form title)
router.get('/customers/:id', async (req: Request, res: Response): Promise<void> => {
  const customer = await Customer.findById(req.params.id)
    .select('className schoolId')
    .populate('schoolId', 'name');
  if (!customer) {
    sendResponse(res, 404, false, 'Not found');
    return;
  }
  sendResponse(res, 200, true, 'OK', customer);
});

// Get students by class (for display on public form)
router.get('/students', async (req: Request, res: Response): Promise<void> => {
  const { customer } = req.query as Record<string, string>;
  if (!customer) {
    sendResponse(res, 400, false, 'customer is required');
    return;
  }
  const students = await Student.find({ customer }).sort({ name: 1 });
  sendResponse(res, 200, true, 'OK', students);
});

// Submit student info (public)
router.post('/students', async (req: Request, res: Response): Promise<void> => {
  const { customer, name, gender, height, weight, notes, costumes } = req.body;
  if (!customer || !name || !gender) {
    sendResponse(res, 400, false, 'customer, name và gender là bắt buộc');
    return;
  }
  const student = await Student.create({
    customer,
    name,
    gender,
    height,
    weight,
    notes,
    costumes: Array.isArray(costumes) ? costumes : [],
  });
  sendResponse(res, 201, true, 'Tạo học sinh thành công', student);
});

// Get shoot schedule by class (public, minimal fields)
router.get(
  '/schedules/customer/:customer',
  async (req: Request, res: Response): Promise<void> => {
    if (!isValidObjectId(req.params.customer)) {
      sendResponse(res, 400, false, 'customer không hợp lệ');
      return;
    }
    // Ưu tiên lịch đang áp dụng (mới nhất); chỉ trả lịch đã huỷ khi lớp không còn lịch nào khác
    const scheduleId = await findPreferredScheduleId(req.params.customer);
    if (!scheduleId) {
      sendResponse(res, 200, true, 'OK', null);
      return;
    }
    const schedule = await Schedule.findById(scheduleId)
      .select('shootDate startTime endTime location status package customer costumes')
      .populate('costumes', '_id name description gender type createdAt')
      .populate({
        path: 'package',
        select: 'name',
      })
      .populate({
        path: 'customer',
        select: 'className schoolId',
        populate: { path: 'schoolId', select: 'name' },
      })
      .lean<{
        _id: Types.ObjectId;
        shootDate: Date;
        startTime?: string;
        endTime?: string;
        location?: string;
        status: PublicScheduleResponse['status'];
        customer: {
          _id: Types.ObjectId;
          className: string;
          schoolId?: { _id: Types.ObjectId; name: string } | null;
        } | null;
        package: {
          _id: Types.ObjectId;
          name: string;
        } | null;
        costumes: CostumeDto[];
      } | null>();

    // Lớp đã bị xoá (populate trả null) → coi như chưa có lịch
    if (!schedule || !schedule.customer) {
      sendResponse(res, 200, true, 'OK', null);
      return;
    }

    const response: PublicScheduleResponse = {
      _id: String(schedule._id),
      shootDate: new Date(schedule.shootDate).toISOString(),
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      location: schedule.location,
      status: schedule.status === 'cancelled' ? 'cancelled' : 'active',
      costumes: schedule.costumes,
      customer: {
        _id: String(schedule.customer._id),
        className: schedule.customer.className,
        schoolId: schedule.customer.schoolId
          ? { _id: String(schedule.customer.schoolId._id), name: schedule.customer.schoolId.name }
          : null,
      },
      package: schedule.package
        ? {
            _id: String(schedule.package._id),
            name: schedule.package.name,
          }
        : null,
    };

    sendResponse(res, 200, true, 'OK', response);
  },
);

export default router;
