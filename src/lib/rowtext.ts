// How a row of a log reads: its values side by side, with a × before a field that says so ("60 kg × 8").

export interface RowPart {
	text: string;
	times?: boolean;
}
/** Fields written after a × come last, so "Reps, Weight" also reads "60 kg × 8". */
export const inReadingOrder = <T extends { times?: boolean }>(xs: T[]): T[] => [...xs.filter((x) => !x.times), ...xs.filter((x) => x.times)];

export const joinRow = (parts: RowPart[], gap = ' · '): string => inReadingOrder(parts.filter((p) => p.text)).reduce((s, p) => (s ? `${s}${p.times ? ' × ' : gap}${p.text}` : p.text), '');
