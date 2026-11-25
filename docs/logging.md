# Logging

Most logging happens on **Today**. Anything you log can be changed or undone later, and you can log days you forgot.

## Today

Today lists your habits in sections: **Due today**, **Breaking and limiting**, **Prepare for tomorrow**, **Paused** and **Not due today**. Above them can sit widgets: progress today, this week day by day (tap a day to open it), streaks at risk, and quit counters with money saved. What shows, and in what order, is up to you: see [Views and edit mode](views-and-edit-mode.md).

The first time you open Today it asks when your day starts, your parts of the day, and how much you want to see. All of it can be changed later in Settings.

### Logging a habit

Each habit that is due has one control: the usual way to log it on the button, and the others behind **⋯**. The habit that is up next stands out.

| Button | Does |
| --- | --- |
| **Done** | A habit with nothing to fill in: marks it done. A habit with Tasks and **One-tap Done** on: logs your targets |
| **+1**, **+5 min**, **+2.5 kg**… | A habit with one number to reach (glasses of water, minutes read): counts one step toward the target. The step is the field's **+/− step** |
| **Log** | Opens the log screen |
| **Same as last** | Copies your last log and finishes it, with Undo |
| **Resume** | A log you started and haven't finished |
| **⋯ → Minimum, Target, Stretch** | With Levels on: logs at that level |
| **⋯ → Log details…** | Opens the log screen |
| **⋯ → Skip today** | Skips the day. A skip neither adds to nor breaks a streak |

A habit you finish keeps its place for a moment, with its reward and **Undo**; then it goes where finished habits go. The line above the tabs keeps the Undo of your last ten changes, also on other pages.

A day logged short of its target reads like "Done · 5 of 6 glasses" or "Missed · 1 of 2 steps". Whether it counts is the habit's [short-day rule](streaks.md#a-day-that-falls-short).

## The log screen

**Log** opens every Task in the habit's Variant for that day.

- Values start from last time, the target, or blank, as each field is set (see [fields](tasks.md#fields-metrics)). Each Task shows what you did last time and your best.
- **Sets**: one set is open at a time, with its numbers large. **Done set 2** logs it, and only that does: changing a number never logs a set. The next set takes its place under the same button.
- A number that starts from last time, changed by hand on one set, moves the sets still to do by as much ("+2.5 kg, as set 1"). One that starts from its target, such as reps, never does.
- The line above the open set says what you did; press it to go back and correct the last one, or untick it. **Add set** and **Remove set** change the count, for this log.
- Other Tasks are one line each. Press one to do it now (a machine is taken); press it again later to go on. **Layout: All open** shows them all.
- **⋯** on a Task: **How to** (its notes), **Last 7 times**, **Swap…**, and **Pick another** in an [auto-filled slot](tasks.md#auto-filled-slots).
- With Levels on, pick the level you are logging at.
- The note box takes Markdown.
- **Finish** saves the log. Fields marked **Required before Finish** must be filled. A line above it says how many planned sets aren't ticked and so won't be saved, with **Tick all**.
- Values that start from last time or the target are suggestions until you finish: saving as you go leaves them out. If some places still show only those values while you logged others (rounds you stopped before), a line says so, with **Keep them**. Finishing a log of values without touching anything saves it as planned.
- A finished log saves as you correct it, with one **Undo** back to what it was. A past day that isn't finished is kept on your device until **Finish**.

The log saves as you go. It also works offline: changes wait on the device and sync when the connection is back. They wait just the same when the server has a problem or you were signed out, and go once it answers. If the server refuses a change, a line at the top says why, with **Try again** and **Discard**; nothing is dropped by itself. If the same log was changed on another device in the meantime, nothing is saved over it: the log says what differs and you choose **Keep mine** or **Use the other one**. Choosing the other one leaves an **Undo** that brings yours back.

### Timers

A duration field has a timer: **Stopwatch**, **Countdown** to the target, or a **Focus block** with **Work** and **Break** minutes and a number of **Rounds**. A Task with a [rest timer](tasks.md#rest-timer) starts a rest after each set. It runs in the line above the tabs, also on other pages and with the phone locked, with **+15 s** and **Skip**; after it ends it says for how long.

### Quick logs

`/q/<habit id>` opens a short log with only the fields marked **Show on quick logs**. Add `?go=1` to log "same as last time" at once, or `?value=250` to add a number. The link is at the bottom of the habit editor. See [Integrations](integrations.md#quick-log-links) to use it from Shortcuts, Siri, NFC tags or QR codes.

## Log a past day

Open a day from **Log a past day** on Today or History, a day in Today's week strip, **Log this day** in History, or a cell in a habit's chain. The day page shows:

- **Due that day**: each habit with the same control as on Today (the usual way, and the others behind **⋯**), or **Change** and **Clear** (take the log away) when it is logged, and a Variant picker. **Same as last** copies the last log from before that day.
- **Not due that day**, folded: habits that weren't due, so you can log an extra day.
- **Started later**: habits that start after this day. **Start from this day** moves their start back.
- **Breaking**: that day's slips, with **Remove**, and **Log a slip…**
- The day before and the day after, with how many habits were left unlogged, and a date to jump to.

A late log counts like one made on the day, streaks included.

A value logged for a past day, here or through a [key](integrations.md) or [quick-log link](#quick-logs), is judged at once by the habit's [rule for a day that falls short](streaks.md#a-day-that-falls-short): done when it counts, missed when it doesn't.

**Settings → Logging past days** sets how far back you can log: **Any time** (default), a month, a week, 3 days, **Yesterday only**, or **Off: only today can be logged**. Slips can always be added for a past day. **Ask about yesterday** shows a **Log yesterday** nudge on Today. **Hide** dismisses it until tomorrow.

To skip a run of days at once (a sick week), see [Bulk editing](bulk-editing.md).

## Slips and cravings

A break habit on Today shows its counter: days since the last slip, or days within the limit.

- **Slip** (or **Log one**, for a habit with a limit) opens a form: **Count**, **Date**, **Time**, how you were feeling (the habit's slip triggers), **Where** and **With**. All but the count and date are optional.
- **Resisted** logs a craving you didn't give in to.

Today shows the feelings that come up most ("Most slips: Stressed"). Remove a slip from the day page.

## History and the chain

**History** is one page of days, newest first: what was done, skipped, missed and slipped, and what you wrote. The strip on top is the last seven days; press a day to go to it. A day's count is done of what was due: a skip was not due, and a log on a day off changes nothing. Press a row to open its log, or its day when it was missed or skipped. Search, filter by status, habit, Area and more, and use **⋯ → Show what a log holds** to see values like "80 kg × 8". **Show older** goes back further. **Notes only** is the [journal](notes-and-journal.md).

A habit's **Chain** tab is twelve weeks, a column a week. Press a day to read it, again to open it; the arrow keys move from day to day. The legend names the marks there are: **Done**, **Minimum**, **Stretch**, **Missed, forgiven** (a single miss under "never miss twice"), **Missed**, **Skipped**, **Not logged**; for a break habit **Clean**, **Within limit** or **Slip**.
