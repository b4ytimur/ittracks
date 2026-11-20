// Ready-made habit templates shipped with the app. Each JSON file is a normal
// template file, so the gallery and "Import a template" share one format.
import { templateFile, type TemplateFile } from '$lib/template';

export interface GalleryItem {
	slug: string;
	template: TemplateFile;
}

const files = import.meta.glob('./*.ittracks.json', { eager: true, import: 'default' });

/** Weight units are written as {weight} so each person gets their own unit. */
function withUnit(raw: unknown, weightUnit: string): unknown {
	return JSON.parse(JSON.stringify(raw).replaceAll('{weight}', weightUnit));
}

export function listGallery(weightUnit = 'kg'): GalleryItem[] {
	const out: GalleryItem[] = [];
	for (const [path, raw] of Object.entries(files)) {
		const parsed = templateFile.safeParse(withUnit(raw, weightUnit));
		if (!parsed.success) {
			console.warn(`Gallery template ${path} is invalid`, parsed.error.issues[0]);
			continue;
		}
		out.push({ slug: path.replace(/^\.\//, '').replace(/\.ittracks\.json$/, ''), template: parsed.data });
	}
	return out.sort((a, b) => a.template.name.localeCompare(b.template.name));
}

export function galleryItem(slug: string, weightUnit = 'kg'): GalleryItem | null {
	return listGallery(weightUnit).find((g) => g.slug === slug) ?? null;
}

/** Category order on the gallery page; anything else comes after. */
export const CATEGORY_ORDER = ['Gym', 'Cardio', 'Learning', 'Health', 'Mind', 'Routine', 'Break'];
