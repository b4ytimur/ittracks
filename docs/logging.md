# Logging

Most logging happens on **Today**. Anything you log can be changed or undone later, and you can log days you forgot.

## Today

Today lists your habits in sections: **Due today**, **Tracking** ([trackers](habits.md#trackers), each with its last value and **Log**), **Breaking and limiting**, **Prepare for tomorrow**, **Paused** and **Not due today**. Above them can sit widgets: progress today, this week day by day (tap a day to open it), streaks at risk, and quit counters with money saved. What shows, and in what order, is up to you: see [Views and changing pages in place](views-and-edit-mode.md).

On a new account Today asks one thing: **What do you want to track?** Write it as you would say it, in English or German: "read 10 pages every evening", "gym 3x a week", "stop smoking", "3 ducks every day". It reads back as a sentence: *Read · 10 pages · every day · in the evening*. Press a word to change it, then **Start tracking**; Undo takes all of it back. What it doesn't understand stays in the name. The box stays on Today until you have three habits.

Below it are the [starter packs](packs.md), the Gallery, and **Add a file**. Nothing else is asked until it matters: the first time you open Today after midnight it asks whether that still counts as the day before (change it any time under **Settings → Day starts**), and a part of the day is made when a sentence first uses one.

### Logging a habit

Each habit that is due has one control: the usual way to log it on the button, and the others behind **⋯**. The habit that is up next stands out.

| Button | Does |
| --- | --- |
| **Done** | A habit with nothing to fill in: marks it done. A habit with Tasks and **One-tap Done** on: logs your targets. One-tap Done comes before **Same as last** |
| **+1**, **+5 min**, **+2.5 kg**… | A habit with one number to reach (glasses of water, minutes read): counts one step toward the target. The step is the field's **+/− step** |
| **Log** | Opens the log screen |
| **Same as last** | Copies your last log and finishes it, with Undo. A Task that log left empty stays empty. Shown when that log has values to repeat, or one tick; a log of only ticked steps (a morning and an evening dose) or of readings that start blank opens with **Log** instead |
| **Resume** | A log you started and haven't finished |
| **⋯ → Minimum, Target, Stretch** | With Levels on: logs at that level |
| **⋯ → Log details…** | Opens the log screen |
| **⋯ → Skip today** | Skips the day. A skip neither adds to nor breaks a streak |

A habit you finish keeps its place for a moment, with its reward and **Undo**; then it goes where finished habits go. The line above the tabs keeps the Undo of your last ten changes, also on other pages. A finished row keeps its own **Undo** after a reload; when the day was logged with one tap (Done or Same as last) and nothing was saved since, it takes away what that tap wrote.

A day logged short of its target reads like "Done · 5 of 6 glasses" or "Missed · 1 of 2 steps". Whether it counts is the habit's [short-day rule](streaks.md#a-day-that-falls-short).

## The log screen

**Log** opens every Task in the habit's Variant for that day.

- Values start from last time, the target, or blank, as each field is set (see [fields](tasks.md#fields-metrics)). Each Task shows what you did last time and your best.
- **Sets**: one set is open at a time, with its numbers large. **Done set 2** logs it, and only that does: changing a number never logs a set. The next set takes its place under the same button.
- A number that starts from last time, changed by hand on one set, moves the sets still to do by as much ("+2.5 kg, as set 1"). One that starts from its target, such as reps, never does.
- The line above the open set says what you did; press it to go back and correct the last one, or untick it. **Add set** and **Remove set** change the count, for this log.
- Other Tasks are one line each. Press one to do it now (a machine is taken); press it again later to go on. **All open**, in the **⋯** beside the title, shows them all, and **One open at a time** goes back; it is kept per habit, on every device.
- **Change the plan**, at the end of the line under the title on an open log of today, changes the plan where it stands, from now on: the line reads "Changing Push day A, from now on." Drag a Task by its ⠿ into another order (or press ⠿ for **Move up** and **Move down**), rename one, or press "3 sets" or "8 reps" to change the number. **+ Task…** adds one and **Remove** takes one out; a log that has values in it keeps it. **Replace…** on a Slot with its own Task puts another Task there, in its place and with its sets, aiming as **Keep in the plan** does (below). "rest 90 s" changes the Task's clock everywhere; 0 turns it off. Inside an open Task, sets can be moved too, for this log only. Every change has an Undo. **Finish**, **Same as last time** and the level step aside meanwhile; **Done** (or Esc) goes back to the log.
- **⋯** on a Task: **How to** (its notes), **Last 7 times**, then the Tasks for its Slot, with a ✓ on the one in use: the plan's Task ("In the plan"), the one swapped in ("Today only"), and up to 2 Tasks used in that Slot before, newest first ("Used here 12 Nov · 50 kg × 8"). Tap one to swap at once. **Swap for another…** opens the Library: Tasks used here before, then up to 5 sharing a Tag with the plan's Task ("Like Bench press"), then the rest A to Z, with a search. Tap a row to swap. An [auto-filled slot](tasks.md#auto-filled-slots) has **Pick another** in place of the list.
- A swapped Task says so under its name: "Instead of Bench press, today only · 4 sets · rest 90 s". Its numbers start from its own last time; done for the first time, from what Bench press still had to do, in the fields with the same name and unit ("From Bench press"); else blank. Bench press's targets never show on it, and the rest is its own.
- A swap or **Pick another** is for that day only: "Using Incline bench press instead of Bench press, today only." On a past day it names the day instead: "Tue 18 Nov only". **Undo** goes back to the Task it showed before. Swapping back to the plan's own Task undoes the swap ("Back to Bench press, as planned."), so a later change to the plan still reaches that day. Sets you did before a swap keep the Task you did them with and stay in its card ("Bench press · 2 sets done"); the new Task gets the sets still to do. History, Stats and next time's values count each set for the Task it was done with, and a past log names the swap: History's **Show what a log holds** and the Task's recent sessions in Stats read "Incline bench press · instead of Bench press".
- **Keep in the plan**, beside **Undo** on the swap's line (or at the end of the swapped Task's ⋯, later in the visit), makes the swap the Slot's Task in that Variant from now on: "Replaced Bench press with Incline bench press in Push day A, from now on, aiming for 4 × 50 kg × 8." The Slot keeps its place and its planned sets. It aims only in the fields Bench press had a target in (same name and unit), at what most of today's sets used (on a tie, the one used last), or its last time when nothing is done yet; Minimum and Stretch are cleared, to set again in the habit editor. **Undo** puts the Slot back exactly, and today stays on the Task you swapped in. Other Variants, the Library and past logs stay as they are; later days list plain "Incline bench press". It isn't offered on an auto-filled slot (it would replace its rule) or on a past day. Offline it says "Not saved. Are you online?" with **Retry**.
- With Levels on, pick the level you are logging at.
- The note box takes Markdown.
- **Finish** saves the log. Fields marked **Required before Finish** must be filled. A line above it says how many planned sets aren't ticked and so won't be saved, with **Tick all**.
- Values that start from last time or the target are suggestions until you finish: saving as you go leaves them out. A value you type, pick or time is logged, even when it is the same as the suggestion. A choice that only shows last time's pick (or the target) says so; tap it to keep it. If some places still show only suggested values while you logged others (rounds you stopped before), a line says so, with **Keep them**. Finishing a log of values without touching anything saves it as planned.
- A finished log saves as you correct it, with one **Undo** back to what it was. A past day that isn't finished is kept on your device until **Finish**.

The log saves as you go. It also works offline: changes wait on the device and sync when the connection is back, in the order you made them. They wait just the same when the server has a problem or you were signed out, and go once it answers. A swap or **Pick another** waits the same way, and what you ticked before it is kept, on a past day too. A swap to the plan's Task, a Task in the ⋯ list or one already in the log shows at once, and its line adds "It will sync when you're back online."; the Library marks the others **Needs a connection**. If the server refuses a change, a line at the top says why, with **Try again** and **Discard**; nothing is dropped by itself. If the same log was changed on another device in the meantime, nothing is saved over it: the log says what differs and you choose **Keep mine** or **Use the other one**. Choosing the other one leaves an **Undo** that brings yours back.

### Timers

A duration field has a timer: **Stopwatch**, **Countdown** to the target, or a **Focus block** with **Work** and **Break** minutes and a number of **Rounds**. A Task with a [rest timer](tasks.md#rest-timer) starts a rest after each set. It runs in the line above the tabs, also on other pages and with the phone locked, with **+15 s** and **Skip**; after it ends it says for how long.

### Quick logs

`/q/<habit id>` opens a short log with only the fields marked **Show on quick logs**. Add `?go=1` to log "same as last time" at once, or `?value=250` to add a number. The link is at the bottom of the habit editor. See [Integrations](integrations.md#quick-log-links) to use it from Shortcuts, Siri, NFC tags or QR codes.

## Log a past day

Open a day from **Log a past day** on Today or History, a day in Today's week strip, **Log this day** in History, or a cell in a habit's chain. The day page shows:

- **Due that day**: each habit with the same control as on Today (the usual way, and the others behind **⋯**), or **Change** and **Clear** (take the log away) when it is logged, and a Variant picker. **Same as last** copies the last log from before that day, never one from a later day.
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

**History** is one page of days, newest first: what was done, skipped, missed and slipped, and what you wrote. The strip on top is the last seven days; press a day to go to it. A day's count is done of what was due: a skip was not due, a log on a day off changes nothing, and a group or routine counts through the habits inside it, as on Today. Today's count includes what is still to do. Press a row to open its log, or its day when it was missed or skipped. Search, filter by status, habit, Area and more, and use **⋯ → Show what a log holds** to see values like "80 kg × 8". **Show older** goes back further. **Notes only** is the [journal](notes-and-journal.md).

A habit's **Chain** tab is twelve weeks, a column a week. Press a day to read it, again to open it; the arrow keys move from day to day. The legend names the marks there are: **Done**, **Minimum**, **Stretch**, **Missed, forgiven** (a single miss under "never miss twice"), **Missed**, **Skipped**, **Not logged**; for a break habit **Clean**, **Within limit** or **Slip**.
