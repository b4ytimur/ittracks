# Conflict rules

Options that block each other are declared once, here. Validation on save, template
import, the editors' greyed-out controls, clean-up before save and the tests all read
these files. Proposal: https://claude.ai/artifact/V1qPudz9pSe1aXRe5sC7RS

| File | Form |
| --- | --- |
| `habit.ts` | habit editor (`habitRules`) and each Slot (`slotRules`) |
| `task.ts` | Task editor (`taskRules`) and each Metric (`metricRules`) |
| `settings.ts` | Settings |

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
return the cleaned form and the errors to refuse.

A new form (for example view settings): add `<name>.ts` here with `defineRules<YourForm>`,
and add its schema and registry to `REGISTRIES` in `coverage.test.ts`.
