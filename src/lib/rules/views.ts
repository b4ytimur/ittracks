// Conflict rules for view settings (src/lib/views.ts).
// "Remember last" and "page default" can't both apply: `open` is one field per page that holds
// either "last", "default" or a saved view, so the conflict can't be stored in the first place.
import { PAGES, sectionOrder, type ViewSettings } from '../views';
import { check, defineRules, evaluate, independent, type Issue } from './core';

export interface ViewCtx {
	/** How many named parts of the day the user has. */
	ranges: number;
}

/** Pages whose filter or grouping, saved anywhere, uses Identities. */
const usesIdentities = (v: ViewSettings) =>
	[...Object.values(v.defaults), ...Object.values(v.last), ...v.saved.map((s) => s.state)].some(
		(s) => !!s && (s.identity !== null || s.group === 'identity')
	);

export const viewRules = defineRules<ViewSettings, ViewCtx>({
	template: independent,
	open: [
		check(
			(v) =>
				PAGES.some((p) => {
					const o = v.open[p];
					return !!o && o !== 'last' && o !== 'default' && !v.saved.some((s) => s.id === o && s.page === p);
				}),
			'A page can only open with one of its own saved views'
		)
	],
	defaults: independent,
	last: independent,
	saved: [check((v) => new Set(v.saved.map((s) => s.id)).size !== v.saved.length, 'Two saved views have the same id')],
	startPage: independent,
	'today.sections': [
		check((v) => new Set(v.today.sections.map((s) => s.key)).size !== v.today.sections.length, 'A section is listed twice'),
		check(
			(v) => v.hidden.includes('prep') && sectionOrder(v).some((s) => s.key === 'prep' && s.show),
			'"Prepare for tomorrow" is shown, but the Prep feature is switched off, so it stays empty',
			'warn'
		),
		check((v) => !sectionOrder(v).some((s) => s.show), 'Every section of Today is hidden', 'warn')
	],
	'today.done': [
		check(
			(v) => v.today.done === 'hide' && v.today.widgets.includes('progress'),
			'Done items are hidden, but the progress count still includes them',
			'warn'
		)
	],
	'today.widgets': [
		check((v) => new Set(v.today.widgets).size !== v.today.widgets.length, 'A widget is listed twice')
	],
	'today.lines': independent,
	'today.timeAware': [
		check((v, c) => v.today.timeAware && c.ranges === 0, 'Only show what fits now needs parts of your day, set in Settings', 'warn')
	],
	'today.headline': independent,
	'today.headlineFor': independent,
	'today.order': independent,
	'habits.lines': independent,
	'history.values': independent,
	// A record of which settings you changed by hand; it blocks nothing.
	own: independent,
	hidden: [
		check(
			(v) => v.hidden.includes('identities') && usesIdentities(v),
			'Identities are switched off, but a view still filters or groups by Identity',
			'warn'
		)
	]
});

export function checkViews(v: ViewSettings, ctx: ViewCtx): Issue[] {
	return evaluate(viewRules, v, ctx);
}
