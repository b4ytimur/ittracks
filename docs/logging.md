# Logging

Most logging happens on **Today**. Anything you log can be changed or undone later, and you can log days you forgot.

## Today

Today lists your habits in sections: **Due today**, **Breaking and limiting**, **Prepare for tomorrow**, **Paused** and **Not due today**. Above them can sit widgets: progress today, this week day by day (tap a day to open it), streaks at risk, and quit counters with money saved. What shows, and in what order, is up to you: see [Views and edit mode](views-and-edit-mode.md).

The first time you open Today it asks when your day starts, your parts of the day, and how much you want to see. All of it can be changed later in Settings.

### Buttons on a habit

Which buttons a habit shows depends on what it logs:

| Button | Does |
| --- | --- |
| **Done** | A habit with nothing to fill in: marks it done. A habit with Tasks and **One-tap Done** on: logs your targets |
| **+1**, **+5 min**, **+2.5 kg**… | A habit with one number to reach (glasses of water, minutes read): counts one step toward the target. The step is the field's **+/− step** |
| **Log** | Opens the log screen |
| **Same as last** | Copies your last log and finishes it, with Undo |
| **Or log Minimum / Stretch** | With Levels on: logs at that level |
| **Skip** | Skips the day. A skip neither adds to nor breaks a streak |
| **Resume** | A log you started and haven't finished |
| **Undo** | Takes back a done or skip |

A day logged short of its target reads like "Done · 5 of 6 glasses" or "Missed · 1 of 2 steps". Whether it counts is the habit's [short-day rule](streaks.md#a-day-that-falls-short).

## The log screen

**Log** opens every Task in the habit's Variant for that day.

- Values start from last time, the target, or blank, as each field is set (see [fields](tasks.md#fields-metrics)). Each Task shows what you did last time and your best.
- **Sets**: each row is one set with a **Done** tick. Changing a value ticks the set. Use **+ set** and **− set** to change the count, and **Finish remaining sets as planned** to close the rest at their planned values.
- **How to** shows the Task's notes.
- **Reroll** and **Swap** change the Task in an [auto-filled slot](tasks.md#auto-filled-slots).
- With Levels on, pick the level you are logging at.
- The note box takes Markdown.
- **Finish** saves the log. Fields marked **Required before Finish** must be filled. If some sets aren't ticked, it asks whether to tick them all or save only the ticked ones.
- Values that start from last time or the target are suggestions until you finish: saving as you go leaves them out. If you finish with some places still showing only those values while you logged others (rounds you stopped before), it asks whether you did them: **No, save only what I logged** or **Yes, keep them and finish**. Finishing without touching anything saves the whole log as planned.

The log saves as you go. It also works offline: changes wait on the device and sync when the connection is back.

### Timers

A duration field has a timer: **Stopwatch**, **Countdown** to the target, or a **Focus block** with **Work** and **Break** minutes and a number of **Rounds**. A Task with a [rest timer](tasks.md#rest-timer) starts a rest countdown after each set; **Dismiss** stops it.

### Quick logs

`/q/<habit id>` opens a short log with only the fields marked **Show on quick logs**. Add `?go=1` to log "same as last time" at once, or `?value=250` to add a number. The link is at the bottom of the habit editor. See [Integrations](integrations.md#quick-log-links) to use it from Shortcuts, Siri, NFC tags or QR codes.

## Log a past day

Open a day from **Log a past day** on Today or History, a day in Today's week strip, **Log this day** in History, or a cell in a habit's chain. The day page shows:

- **Due that day**: each habit with **Log**, **Same as last**, **Done**, **Skip** and **Clear** (take the log away), and a Variant picker. **Same as last** copies the last log from before that day.
- **Not due that day. Did one anyway?**: habits that weren't due, so you can log an extra day.
- **Started later**: habits that start after this day. **Start from this day** moves their start back.
- **Breaking**: that day's slips, with **Remove**, and a form to add one.
- Arrows to the previous and next day, with how many habits were left unlogged.

A late log counts like one made on the day, streaks included.

A value logged for a past day, here or through a [key](integrations.md) or [quick-log link](#quick-logs), is judged at once by the habit's [rule for a day that falls short](streaks.md#a-day-that-falls-short): done when it counts, missed when it doesn't.

**Settings → Logging past days** sets **How far back you can log**: **Any time** (default), a month, a week, 3 days, **Yesterday only**, or **Off: only today can be logged**. Slips can always be added for a past day. **Tell me on Today when yesterday has habits left unlogged** shows a **Log yesterday** nudge on Today. **Hide** dismisses it until tomorrow.

To skip a run of days at once (a sick week), see [Bulk editing](bulk-editing.md).

## Slips and cravings

A break habit on Today shows its counter: days since the last slip, or days within the limit.

- **Slip** (or **Log one**, for a habit with a limit) opens a form: **Count**, **Date**, **Time**, how you were feeling (the habit's slip triggers), **Where** and **With**. All but the count and date are optional.
- **Resisted** logs a craving you didn't give in to.

Today shows the feelings that come up most ("Most slips: Stressed"). Remove a slip from the day page.

## History and the chain

**History** lists recent days with what was done, skipped, missed and slipped. Filter it by status, habit, Area and more, tick **Show logged values** to see values like "80 kg × 8", and press **Show older** to go back further.

A habit's **Chain** (from its editor or Stats) is a calendar of the last weeks. Each cell is one day: **Done**, **Minimum**, **Stretch**, **Missed, forgiven** (a single miss under "never miss twice"), **Missed**, **Skipped** or **Not logged**. For a break habit: **Clean**, **Within limit** or **Slip**. Tap a cell to open that day.
