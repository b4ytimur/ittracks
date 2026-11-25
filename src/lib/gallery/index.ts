// Ready-made habit templates shipped with the app. Each JSON file is a normal
// template file, so the gallery and "Import a template" share one format.
import { templateFile, type TemplateFile } from '$lib/template';
import { STARTER, withShownUnits, type UnitTable } from '$lib/units';

export interface GalleryItem {
	slug: string;
	template: TemplateFile;
}

const files = import.meta.glob('./*.ittracks.json', { eager: true, import: 'default' });

/** Weight units are written as {weight} so each person gets their own unit. */
function withUnit(raw: unknown, units: UnitTable): unknown {
	return JSON.parse(JSON.stringify(raw, (_, v) => (typeof v === 'string' ? withShownUnits(v, units) : v)));
}

export function listGallery(units: UnitTable = STARTER): GalleryItem[] {
	const out: GalleryItem[] = [];
	for (const [path, raw] of Object.entries(files)) {
		const parsed = templateFile.safeParse(withUnit(raw, units));
		if (!parsed.success) {
			console.warn(`Gallery template ${path} is invalid`, parsed.error.issues[0]);
			continue;
		}
		out.push({ slug: path.replace(/^\.\//, '').replace(/\.ittracks\.json$/, ''), template: parsed.data });
	}
	return out.sort((a, b) => a.template.name.localeCompare(b.template.name));
}

export function galleryItem(slug: string, units: UnitTable = STARTER): GalleryItem | null {
	return listGallery(units).find((g) => g.slug === slug) ?? null;
}

/** Category order on the gallery page; anything else comes after. */
export const CATEGORY_ORDER = ['Gym', 'Cardio', 'Learning', 'Health', 'Mind', 'Routine', 'Break'];

/** The starter pack a ready-made template is at home in: its units, groupings and measures come with it. */
export const PACK_OF: Record<string, string> = {
	'beginner-5x5': 'gym',
	'full-body-3': 'gym',
	'home-bodyweight': 'gym',
	'push-pull-legs': 'gym',
	'upper-lower-4': 'gym',
	'running-3': 'running',
	'daily-walk': 'running',
	'instrument-practice': 'music',
	reading: 'reading',
	'language-daily': 'study'
};
