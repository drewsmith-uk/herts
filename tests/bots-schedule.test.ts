import { expect, it } from 'vitest';
import { parseSchedule, scheduleSummary, toSchedule } from '../plugins/bots/src/schedule';
it('recognises common schedules without changing their meaning', () => {
  for (const schedule of ['0 9 * * *', '30 18 * * 5', 'every 17m', '2027-01-20T14:30', '0 9 * * 1-5', '2027-01-20T14:30:00+02:00']) expect(toSchedule(parseSchedule(schedule))).toBe(schedule);
  expect(parseSchedule('0 9 * * *').frequency).toBe('daily');
  expect(parseSchedule('0 9 * * 1-5').frequency).toBe('advanced');
  expect(parseSchedule('2027-01-20T14:30:00Z').frequency).toBe('advanced');
  expect(scheduleSummary('30 18 * * 5')).toBe('Every Friday at 18:30');
  expect(toSchedule(parseSchedule())).toBe('0 9 * * *');
});
