// The catalog of an account, from its logs. Apart from catalog.ts, so a page that only shows the
// builder doesn't carry the engine.
import type { Catalog } from './catalog';
import { unitWord } from '../units';
import { fits, groupsOf, unitOfMetric, unitsOf, type Prepared } from './engine';
import type { CustomMeasure } from './model';
import { seedMeasures } from './seed';

/** The account's measures as the cards it gets by itself see them. */
export const measuresOf = (P: Prepared): CustomMeasure[] => P.ds.measures ?? seedMeasures(P.ds.metrics);

export function catalogOf(P: Prepared, extra: { areas: Catalog['areas']; identities: Catalog['identities'] }): Catalog {
	const targeted = new Set(P.ds.slots.flatMap((s) => Object.keys(s.targets ?? {})));
	const taskTargets = new Set(P.ds.slots.filter((s) => s.taskId && s.targets && Object.keys(s.targets).length).map((s) => s.taskId!));
	return {
		habits: P.ds.habits.map((h) => ({
			id: h.id,
			name: h.name,
			direction: h.direction,
			archived: h.archived,
			areaId: h.areaId,
			hasCost: !!h.cost?.perDay,
			logged: (P.occsByHabit.get(h.id) ?? []).filter((o) => o.status === 'done').length
		})),
		tasks: P.ds.tasks
			.filter((t) => !t.parentTaskId)
			.map((t) => {
				return {
					id: t.id,
					name: t.name,
					areaId: t.areaId,
					tags: t.tags.map((x) => x.name),
					measures: measuresOf(P).filter((m) => fits(m, P.metricsByTask.get(t.id) ?? [])).map((m) => m.id),
					targets: taskTargets.has(t.id),
					logged: (P.logsByTask.get(t.id) ?? []).length
				};
			}),
		metrics: P.ds.metrics.map((m) => ({
			id: m.id,
			taskId: m.taskId,
			name: m.name,
			type: m.type,
			unit: m.unit,
			repeats: m.repeats,
			targets: targeted.has(m.id),
			dim: unitsOf(P).kindOf(unitOfMetric(m))?.id ?? `u:${unitWord(m.unit)}`,
			scored: m.type === 'choice' && !!m.scores && Object.keys(m.scores).length > 0
		})),
		tags: [...new Set(P.ds.tasks.flatMap((t) => t.tags.map((x) => x.name)))].sort((a, b) => a.localeCompare(b)),
		groupings: groupsOf(P).groupings.map(({ id, name, one }) => ({ id, name, one })),
		areas: extra.areas,
		identities: extra.identities
	};
}
