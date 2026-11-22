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

### From the habits inside it, and following a routine

These two only apply to habits inside other habits. See [Groups and routines](groups-and-routines.md).

### Which Variant comes up

"N times a week", "every N days" and "follow a routine" use a single Variant: pick it under **Variant**. If a habit has more Variants than its schedule can use, the editor warns you. Use a rotation to take turns.

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

> TODO: schedules that change over time ("5 a day in week 1, then 1 a day") are being built. This page will cover them when they land.
