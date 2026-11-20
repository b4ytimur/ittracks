import { describe, expect, it } from 'vitest';
import { listGallery } from '.';
import { applyAnswers, fromTemplate } from '$lib/template';
import { habitForm, taskForm } from '$lib/forms';

describe('gallery', () => {
	const items = listGallery('lb');

	it('ships 20 valid templates', () => {
		expect(items).toHaveLength(20);
	});

	it.each(items.map((i) => [i.slug, i] as const))('%s makes a valid habit and Tasks', (_, item) => {
		expect(JSON.stringify(item.template)).not.toContain('{weight}');
		const made = fromTemplate(applyAnswers(item.template, {}), '2026-01-05');
		expect(habitForm.safeParse(made.habit).error?.issues ?? []).toEqual([]);
		for (const t of made.tasks) expect(taskForm.safeParse(t.form).success).toBe(true);
		for (const q of item.template.questions)
			if (q.kind === 'number')
				for (const m of q.metrics) expect(item.template.tasks.some((t) => t.metrics.some((x) => x.key === m))).toBe(true);
	});

	it('uses the weight unit of the person', () => {
		const t = items.find((i) => i.slug === 'beginner-5x5')!.template;
		expect(t.tasks.flatMap((x) => x.metrics).some((m) => m.unit === 'lb')).toBe(true);
	});
});
