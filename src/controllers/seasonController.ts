import { Request, Response } from 'express';
import Season from '../models/Season';
import { type SeasonResponse } from '../types/dto';

export const getAll = async (
  req: Request,
  res: Response<SeasonResponse[] | any>,
): Promise<void> => {
  const seasons = await Season.find();
  res.json(seasons);
};

export const create = async (req: Request, res: Response<SeasonResponse | any>): Promise<void> => {
  const { name, startDate, endDate } = req.body;
  if (!name || !startDate || !endDate) {
    res.status(400).json({ message: 'Missing required fields' });
    return;
  }
  const season = new Season({ name, startDate, endDate });
  await season.save();
  res.status(201).json(season);
};

export const update = async (req: Request, res: Response<SeasonResponse | any>): Promise<void> => {
  const { id } = req.params;
  const { name, startDate, endDate } = req.body;
  const season = await Season.findByIdAndUpdate(
    id,
    { name, startDate, endDate },
    { new: true, runValidators: true },
  );
  if (!season) {
    res.status(404).json({ message: 'Season not found' });
    return;
  }
  res.json(season);
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const season = await Season.findByIdAndDelete(id);
  if (!season) {
    res.status(404).json({ message: 'Season not found' });
    return;
  }
  res.json({ message: 'Deleted successfully' });
};
