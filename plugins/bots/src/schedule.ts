export const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function parseSchedule(schedule = '') {
  const initial = { frequency: schedule ? 'advanced' : 'daily', time: '09:00', day: '1', minutes: '60', once: '', schedule };
  const cron = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])$/.exec(schedule);
  if (cron && +cron[1] < 60 && +cron[2] < 24) return { ...initial, frequency: cron[3] === '*' ? 'daily' : 'weekly', time: `${cron[2].padStart(2, '0')}:${cron[1].padStart(2, '0')}`, day: cron[3] === '*' ? '1' : cron[3] };
  const interval = /^every (\d+)m$/.exec(schedule);
  if (interval) return { ...initial, frequency: 'interval', minutes: interval[1] };
  // Zoned timestamps stay in the advanced field: a datetime-local must not change their zone.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(schedule)) return { ...initial, frequency: 'once', once: schedule };
  return initial;
}
export function toSchedule(value: ReturnType<typeof parseSchedule>) {
  const [hour, minute] = value.time.split(':');
  return value.frequency === 'daily' ? `${Number(minute)} ${Number(hour)} * * *`
    : value.frequency === 'weekly' ? `${Number(minute)} ${Number(hour)} * * ${value.day}`
    : value.frequency === 'interval' ? `every ${value.minutes}m`
    : value.frequency === 'once' ? value.once : value.schedule;
}
export function scheduleSummary(schedule: string) {
  const v = parseSchedule(schedule);
  return v.frequency === 'daily' ? `Every day at ${v.time}` : v.frequency === 'weekly' ? `Every ${days[Number(v.day)]} at ${v.time}` : v.frequency === 'interval' ? `Every ${v.minutes} minutes` : v.frequency === 'once' ? `Once on ${v.once.replace('T', ' at ')}` : schedule || 'Choose a schedule';
}
