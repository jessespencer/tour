export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${MONTHS[+m - 1]} ${+d} ${y}`;
}

/** "MAR 1–30 2013" within a month, "AUG 13 – SEP 22 2013" across months. */
export function formatRange(startIso: string, endIso: string): string {
  const [sy, sm, sd] = startIso.split('-');
  const [ey, em, ed] = endIso.split('-');
  if (sy === ey && sm === em) {
    return +sd === +ed ? `${MONTHS[+sm - 1]} ${+sd} ${sy}` : `${MONTHS[+sm - 1]} ${+sd}–${+ed} ${sy}`;
  }
  if (sy === ey) return `${MONTHS[+sm - 1]} ${+sd} – ${MONTHS[+em - 1]} ${+ed} ${sy}`;
  return `${MONTHS[+sm - 1]} ${sy} – ${MONTHS[+em - 1]} ${ey}`;
}
