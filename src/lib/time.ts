import { legs } from '../data/legs';
import { MONTHS } from './format';

const DAY_MS = 86_400_000;

// Timeline spans the full range of the legs (legs can start before their
// first mapped show — LITV runs Apr 4–7 with one dated performance).
const START_ISO = legs.map((l) => l.startDate).sort()[0];
const END_ISO = legs.map((l) => l.endDate).sort().at(-1)!;
const BASE = Date.parse(START_ISO); // UTC midnight

export function dayOf(iso: string): number {
  return (Date.parse(iso) - BASE) / DAY_MS;
}

export const TOTAL_DAYS = dayOf(END_ISO);

export function labelForDay(day: number): string {
  const clamped = Math.max(0, Math.min(TOTAL_DAYS, day));
  const d = new Date(BASE + Math.round(clamped) * DAY_MS);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}
