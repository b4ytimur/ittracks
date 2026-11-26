# Streaks and missed days

Each build habit has a streak rule, a rule for days that fall short, and a rule for days you don't log. Set all three under **+ Streak and days you don't log** in the habit editor. Changing any of them recounts the streak from what you logged; your logs stay as they are.

## How the streak counts

| Rule | Behaviour |
| --- | --- |
| **Never miss twice: one miss is forgiven** (default) | A single miss doesn't end the streak (it adds nothing to it). Two misses in a row do. After a miss, Today says "You missed last time. Don't miss twice." |
| **Strict: any miss resets it** | Any miss sets it back to 0 |
| **Grace days: a few misses allowed** | Up to N **Misses** **Per** week or month. One more ends the streak. The editor warns if the allowance is so high the streak can never break |
| **Consistency: % done, no streak** | The share of due days done **Over the last N days** (7 to 365), instead of a streak |

The streak counts due days, not calendar days: a habit due Monday, Wednesday and Friday has a streak of 3 after one full week.

What each day counts as:

- **Done** adds one.
- **Skipped** counts neither way: it doesn't add to the streak and doesn't break it.
- **Paused** days (a pause or a vacation) aren't due, so they never count.
- **Missed** breaks the streak under the rule above.
- Days a habit spent archived don't count as missed once you unarchive it.

## Days you don't log

**Days you don't log**:

- **Count as missed once the day is over** (default). Streaks, consistency, the chain and Stats treat a forgotten day as a miss. Log or skip it later to change that.
- **Don't count them: only what you log counts.** A day you forget leaves your streak and consistency as they were. Logging it later still counts.

How a miss is found depends on the [schedule](schedules.md):

- Weekdays, every N days, a weekly rotation and a rotation that skips ahead: every due day with no log is one miss.
- N times a week or month: when the period ends short, each missing session is one miss.
- A rotation that waits: each time the Variant's gap comes round again without it, one more miss.

## A day that falls short

A day logged short of its target, like 5 of 6 glasses or 1 of 2 doses. **A day that falls short of the target**:

- **Counts once it reaches the Minimum** (with Levels on), or **Counts once anything is logged** (without Levels). Such a day counts as done at the Minimum and shows as "Done · 5 of 6 glasses".
- **Only the full target counts.** Good for medication: 1 of 2 doses is a miss once the day is over, shown as "Missed · 1 of 2 steps".

Below the Minimum is always a miss once the day is over. What you logged always stays in History and Stats.

## Groups and routines

A [group or routine](groups-and-routines.md) has its own streak, counted from the habits inside it: a day is done when enough of them are done, and counts at the Minimum when its Minimum number is reached. Each habit inside keeps its own streak as well.

## Trackers

A [tracker](habits.md#trackers) has no streak and no missed days: it only keeps what you log. Its headline on Today is its last value.

## Break habits

A break habit has no streak rule. Its counter shows whole days since the last slip (or since **Counting from**). A slip sets it back to 0. With a limit, it shows days (or weeks) in a row within the limit. Its Stats show the longest run.

## The number on Today

Each habit shows one headline number on Today: **Streak**, **Consistency, last 30 days**, **Done this week**, **Times done**, **Last value** or **Nothing**. A tracker shows **Last value** unless you pick another for it. Consistency says how many days it covers: "86% in 30 days", or "100% in 2 days" for a habit or group that is newer than that. Pick the default for all habits, or one per habit, in Today's [edit mode](views-and-edit-mode.md#edit-mode).
