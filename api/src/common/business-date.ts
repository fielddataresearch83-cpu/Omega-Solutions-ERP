/** Returns the calendar date at an instant in an IANA company timezone. */
export function businessDateAt(timezone: string, instant: Date = new Date()): string {
  if (!timezone || !Number.isFinite(instant.getTime())) throw new RangeError('A valid timezone and instant are required.');
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  } catch {
    throw new RangeError(`Invalid company timezone: ${timezone}`);
  }
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
