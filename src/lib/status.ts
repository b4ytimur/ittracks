// A record's state as a tag, in one place: its words and its look.
export const STATUS = {
	archived: { label: 'Archived', tone: 'neutral' },
	hidden: { label: 'Hidden', tone: 'neutral' },
	paused: { label: 'Paused', tone: 'neutral' },
	unused: { label: 'Unused', tone: 'neutral' },
	upNext: { label: 'Up next', tone: 'strong' }
} as const;
export type Status = keyof typeof STATUS;
