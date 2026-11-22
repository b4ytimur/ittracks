# Schedules

A build habit's schedule decides which days it is due, and which Variant is due on each. Break habits have no schedule: they count every day.

Set it under **Schedule** in the habit editor. The quick buttons cover common cases: **Every day**, **Weekdays**, **Mon, Wed, Fri**, **3 times a week** and **A/B with 1 rest day**. For anything else, pick one under **How often**.

## Kinds of schedule

### On fixed weekdays

Each weekday is **Rest** or a Variant. With one Variant it reads **Do it**. Use this for "Mon A, Wed B, Fri A".

### A number of times per week or month

**Times** per **week** or **month**, on any days. The habit is due every day until you reach the number for that period. If a period ends short, each missing session counts as one miss, placed on the last days of the period. A period that started part way through (a habit begun on a Thursday) asks only for its share, rounded down. A skip counts as a session.

### Every few days

**Every N days**, **Starting** on a date. Every 2 days is every other day.

### Rotate through Variants

Variants take turns. **Rotate by**:

- **Variant, with rest days between them.** Variants come in the order listed in the editor. Set **After <Variant>, rest N days** for each one. Use this for "A, then 2 rest days, then B, then 1 rest day". **If you miss a day**:
  - **Wait**: the Variant stays due until you do it. Each time its gap comes round again without it, that is one more miss.
  - **Skip ahead to the next Variant**: the rotation runs like a roster. A missed day is missed and the next Variant comes up on its own date. A log on a day off is an extra and doesn't move the roster.
- **Week: a different Variant each week**, on the training days you pick. Variant 1 in week 1, Variant 2 in week 2, and round again.

Both take a **Starting** date.

### In phases: one schedule after another

Phases run schedules one after another from a **Starting** date: "every day with Ramp-up for 1 week, then every day with Maintain from then on". Each phase has a length (**For** N **days** or **weeks**) or runs **from then on, with no end**, and a schedule of its own, picked the same way as any schedule above. The title of each phase shows the dates it runs.

- **Targets change with the Variant.** Targets live on a Variant's Tasks, so give each phase its own Variant: Ramp-up aims for 5 glasses, Maintain for 1. Add Variants under **Variants** first.
- **Each phase starts fresh.** Its schedule runs as if it began on the phase's first day: a rotation starts with its first Variant, every N days counts from that day, and N times a week only counts what you did in this phase. A phase that starts or ends part way through a week asks for its share of the weekly number, rounded down.
- **A rotation in a phase** picks which Variants take part, under **Variants in this rotation**.
- **An end date.** When the last phase has a length, nothing is due after it: a 10-day course is one phase of 10 days. Pick **from then on** on the last phase to keep going.
- **Add, remove and reorder** phases with **+ phase**, **Remove** and the handle. A new phase runs from then on, and the one before it gets a length. Only the last phase can run with no end; the editor refuses a phase after one that never ends, and warns about a Variant no phase uses.

Moving the habit's **Started on** earlier doesn't move the phases. In a routine, habits that follow it on one Variant only come up in the phases that use that Variant, so a whole program can change from Base to Build weeks.

### From the habits inside it, and following a routine

These two only apply to habits inside other habits. See [Groups and routines](groups-and-routines.md).

### Which Variant comes up

"N times a week" and "every N days" use a single Variant: pick it under **Variant**. If a habit has more Variants than its schedule can use, the editor warns you. Use a rotation to take turns. A habit that follows a routine with several Variants can pair one of its own with each of the routine's (see [Keeping two rotations in step](groups-and-routines.md#keeping-two-rotations-in-step)). In phases, it logs whatever the routine's Variant in that phase is paired with.

## Changing a schedule

When you change the schedule of a habit that already has days, the editor asks how the change applies:

- **From today on**: earlier days keep the plan they had. Misses already counted stay, and logging a past day later judges it by the schedule it had then.
- **To past days too**: the plan was wrong from the start. Missed days are counted again with the new schedule, from **Started on**. Everything you logged stays.

## Doing a habit on a day it isn't due

Today lists habits that aren't due under **Not due today**. Press **Start … early** to log one anyway. For a past day, open it and use **Not due that day. Did one anyway?** (see [Past days](logging.md#log-a-past-day)). A day like this counts as done. A rotation that waits moves on from it; one that skips ahead doesn't.

## Pause and vacation

- **Pause one habit**: at the bottom of the habit editor, under **Pause**, pick **From**, **To** and an optional **Note**. Today shows it under **Paused** with **Streak is safe**.
- **Pause every habit**: **Settings → Vacation**.
- **Pause many habits at once**: select them on the Habits page. See [Bulk editing](bulk-editing.md).

Paused days aren't due and never count as missed. A pause over past days takes back the misses already counted for them. Break-habit counters keep running through a vacation.
