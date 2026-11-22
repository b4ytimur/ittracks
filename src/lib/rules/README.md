# Conflict rules

Options that block each other are declared once, here. Validation on save, template
import, the editors' greyed-out controls, clean-up before save and the tests all read
these files.

| File | Form |
| --- | --- |
| `habit.ts` | habit editor (`habitRules`) and each Slot (`slotRules`) |
| `task.ts` | Task editor (`taskRules`) and each Metric (`metricRules`) |
| `settings.ts` | Settings |
| `views.ts` | View settings (filters, layout, templates) |

## Adding an option

1. Add the field to its Zod schema in `src/lib/forms.ts` (or to `Settings`).
2. `npm run check` now fails with `Property '<field>' is missing`. Add an entry to the
   registry: `independent` if it conflicts with nothing, otherwise one or more of:
   - `exclusive(other, reason, { wins, fixed })`: only one of the two can be set. Declare it
     on both fields. `wins: true` on the side kept when old data has both; the other side
     gives a `fixed` note ("kept the time, cleared the part of the day").
   - `requiresAny([others], reason, clear)`: needs one of the others set.
   - `onlyWhen(when, reason, clear)`: means nothing unless `when` holds; cleared before save.
   - `check(bad, reason, 'block' | 'warn')`: any rule across fields, such as two numbers.
3. `npm test` checks the registry against the real schemas, and generates a test for
   every exclusive pair (add a sample value in `rules.test.ts` when it asks for one).

In a Svelte editor, `blocked(rules, form, 'field', ctx)` returns the reason a control is
greyed out, or null. On the server, `checkHabitForm` / `checkTask` / `checkSettings`
return the cleaned form and the errors to refuse (`cleanSettings` clears Settings that can't apply).

A new form (for example view settings): add `<name>.ts` here with `defineRules<YourForm>`,
and add its schema and registry to `REGISTRIES` in `coverage.test.ts`.

# History policies

What an edit may do to data already logged, declared once per field in the same files
(`habitPast`, `slotPast` in `habit.ts`; `taskPast`, `metricPast` in `task.ts`). The mechanism is
`history.ts`. Every field of those forms needs one, and `coverage.test.ts` fails when it's missing.

| Kind | Meaning | Example |
| --- | --- | --- |
| `display` | Past logs don't depend on it | a name, a prefill, a reminder |
| `versioned` | The old value is kept with the logs it applied to | schedule, Slot targets, limit, option numbers |
| `recompute` | Logs stay; what is worked out from them is worked out again | streak rule, start date |
| `migrate` | Once logged, a change asks what to do with past values | a Metric's unit: convert or keep the numbers |
| `locked` | Fixed once logged, except changes `allow` lets through | Metric type (numbers can switch), log per set, build or break |
| `archive` | List items removed after they were logged are archived, not deleted | Metrics, sub-tasks, choice options, slip feelings |
| `unguarded` | A known gap: the edit still changes how past data reads | cost per slip, removing a Variant |

The editors read them to grey out controls and ask (`lockedNow`, `allowedNow`, `checkTaskPast`);
the server refuses or migrates with the same functions (`checkTaskEdit`, `checkHabitEdit` in
`src/lib/server/repo`). Units come from the registry in `src/lib/units.ts`.

Choice options and slip feelings have stable ids (`src/lib/options.ts`): logs store the id, so a
rename shows in past logs, and option numbers keep the old set with the days it applied to
(`earlierScores`). Rows from before ids are brought up to date by `src/lib/server/db/upgrade.ts`.
