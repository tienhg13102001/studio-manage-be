/**
 * In-memory cache for season date lookups.
 * resolveSeasonForDate is called on every create request; caching avoids
 * a round-trip to MongoDB for each request.
 * TTL: 5 minutes — seasons rarely change.
 */
import { Types } from 'mongoose';
import Season from '../models/Season';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  id: Types.ObjectId | null;
  expiry: number;
}

const cache = new Map<string, CacheEntry>();

/** Returns the season _id whose [startDate, endDate] contains the given date. */
export const resolveSeasonForDate = async (
  date: Date | string | undefined,
): Promise<Types.ObjectId | null> => {
  if (!date) return null;
  const d = new Date(date);
  // Normalise to date-only string as cache key
  const key = d.toISOString().slice(0, 10);

  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiry) return cached.id;

  const season = await Season.findOne({
    startDate: { $lte: d },
    endDate: { $gte: d },
  })
    .select('_id')
    .lean<{ _id: Types.ObjectId } | null>();

  const id = season?._id ?? null;
  cache.set(key, { id, expiry: Date.now() + CACHE_TTL_MS });
  return id;
};

/** Returns the season _id for today (used when no date is specified). */
export const resolveCurrentSeason = async (): Promise<Types.ObjectId | null> => {
  return resolveSeasonForDate(new Date());
};

/** Clears the cache (e.g., after a season is created/updated). */
export const clearSeasonCache = (): void => {
  cache.clear();
};
