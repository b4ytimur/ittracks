/** Calendar dates as YYYY-MM-DD strings, computed in UTC so no time zone shifts creep in. */
export type ISODate = string;

const DAY = 86_400_000;

export const toDays = (d: ISODate): number => Date.parse(`${d}T00:00:00Z`) / DAY;
export const fromDays = (n: number): ISODate => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (d: ISODate, n: number): ISODate => fromDays(toDays(d) + n);
export const daysBetween = (a: ISODate, b: ISODate): number => toDays(b) - toDays(a);

/** 0 = Monday ... 6 = Sunday. */
export const weekday = (d: ISODate): number => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Monday of the week that contains d. */
export const weekStart = (d: ISODate): ISODate => addDays(d, -weekday(d));
