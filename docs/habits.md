# Habits

A habit is either:

- **Build: something to do.** It has a schedule, and each due day is done, skipped or missed.
- **Break: something to stop, with a slip counter.** It has no schedule. You log slips, and the counter shows days since the last one.

Once a habit has logs, you can't switch it between build and break: build habits keep days and break habits keep slips, so switching would hide one or the other. Make a new habit instead.

## Create a habit

Go to **Habits → New habit**. You choose how to start:

- **Pick a ready-made habit**: opens the [Gallery](templates.md#the-gallery).
- **Build it step by step**: four short steps (what you do, which days, when, and a check).
- **Copy one of my habits**: starts from a copy.
- **Start blank in the full editor**: every option on one page.
- **Start a daily journal**: see [Notes and journal](notes-and-journal.md#journal).

To skip this choice and always open the full editor, untick **Ask how to start** in **Settings → New habits**. Which lines a new habit starts with is chosen at the end of its page under **On every new habit**, and on any habit's page in **Edit**: press the ones you want there from the start. It is kept per kind (habits, groups, habits you break).

## A habit's page

A habit's page is one page of lines. Each line says what it means ("Weekly on Mon, Wed, Fri."); press it and it opens where it stands. **Details**, **Chain** and **Stats** are its three tabs.

- What you change saves by itself, with **Undo** in the line above the tabs.
- A change that would rewrite past days (the days, the start, Levels, the streak, a limit, what it sits inside) waits: the line says **not saved**, what it was and what saving does, with **Save** and **Cancel**. Left unsaved, it is kept on your device and is there when you come back. Its Undo puts back exactly what it replaced; what you logged since stays. It can be taken back for a day, as long as the habit wasn't changed again.
- If another device changed the same line in the meantime, nothing is saved over it: choose **Show it** or **Keep mine**.
- Lines that hold nothing aren't shown: add them with the buttons at the end.
- Tasks and Variants are moved by their ⠿ handle, with the mouse, a finger or the arrow keys.

## What you do: Variants, Slots and targets

**Edit** on a habit's page moves its sections: drag ⠿ beside a heading. The order is the same on every habit of that kind (build habits, groups, habits you break), with Undo and **Reset layout**.

A build habit holds one or more **Variants**. Most habits have one. Add more with **Add another Variant (for A/B plans)** when you alternate plans, like Push day A and Pull day B. Each Variant can be renamed, moved, duplicated or removed. One you logged something on is archived instead: past days keep it, and **Bring back** stands under the list.

Each Variant holds **Slots**, one per thing you log:

- **Add a Task** puts a fixed Task from your [Library](tasks.md) in the Slot. Pick **+ New Task…** in the list to make one on the spot from a Task type.
- **Add an auto-filled slot** picks a Task for you each time from tags you choose. See [auto-filled slots](tasks.md#auto-filled-slots).

For each Slot you can set:

- **Target sets**, when the Task logs something per set. For a Task that has Tasks inside it, this reads **Rounds**: everything inside is logged once per round.
- A **Target** for each number field (weight, reps, minutes…). With Levels on, also a **Minimum** and a **Stretch**. A field where [less is better](tasks.md#fields-metrics) is marked "at most": its target is the most a done day has.

A habit with no Slots has nothing to fill in: you just tick it off.

## Schedule and start date

See [Schedules](schedules.md). **Started on** is the first day that can be logged. Nothing is due before it. Moving it earlier means the due days in between that you leave unlogged count as missed, unless the habit ignores days you don't log (see [Streaks](streaks.md#days-you-dont-log)).

## When and where

Optional. A clear time and place make a habit easier to start.

- **Time**, or **Or part of the day** (one or the other, not both).
- **Where**, such as "in the park".
- **After**: **Another habit** or **Something else I do** ("I pour my morning coffee"). This stacks the habit after something you already do.
- **Reminder** is a line of its own. **Remind me** sends a push notification at the habit's time, or when its part of the day starts, or at a **Time of its own**. **What it says** replaces its words, and you pick what it offers besides **Done**: **Minimum** (with Levels) and **Snooze 30 min**. This device's permission stands in the same line; **Settings → Reminders** lists every habit's reminder.

Push needs HTTPS (or `localhost`). On iPhone and iPad it works only after adding the app to the Home Screen.

## Levels

Tick **Use levels** to give the habit a two-minute **Minimum**, your **Target**, and a **Stretch**, each with a short description ("Put on running shoes", "Run 5 km", "Run 10 km"). Then set numbers per level in each Slot. On Today, **Or log** offers Minimum and Stretch next to the main buttons. Whether a Minimum day keeps the streak alive is a [streak setting](streaks.md#a-day-that-falls-short).

## Streak settings

Under **+ Streak and days you don't log**: how the streak counts, whether a short day counts, and what an unlogged day counts as. See [Streaks and missed days](streaks.md).

## More ways to make it stick (optional)

- **Pair it with something you enjoy**: a treat to pair with the habit. Tick **Save it as a treat for after the habit is done** to keep it for afterwards.
- **Prepare the day before**: steps shown on Today the day before the habit is due ("Lay out gym clothes").
- **Reward**: **Celebrate when I finish** with your own message, and **Fill a jar toward a reward**: a pretend jar that adds an amount each time ("2 € toward new running shoes").
- **Progression**: **Suggest raising my targets when I keep hitting them**. After a number of logs in a row at Target or better, Today offers to raise them by a percentage or by steps (each field's own +/− step). Press **Raise** or **Not yet**. Nothing changes until you accept, and past logs keep the targets they aimed for.

Also on the page:

- **Reframe**: a line to see on the card ("I get to do this today").
- **Identity**: who this habit makes you ("I am a runner"). The **Identities** page lists them: add, rename, move and delete them there (with Undo), and see in words what stands for each. Nothing about identities is said when you log; an identity's line on Today is off for new accounts (**Today → Edit**).
- **Notes**: Markdown. See [Notes and journal](notes-and-journal.md).
- **One-tap Done on Today (logs your targets)**, for habits with Tasks.
- **In the app icon's menu**: the habit appears when you long-press the app icon. The menu holds four.
- The habit's **quick-log link**. See [Integrations](integrations.md#quick-log-links).

Features you never use can be hidden app-wide in **Settings → Features**. See [Views](views-and-edit-mode.md#switch-features-off).

## Break habits

A break habit shows the days since your last slip. Log a slip whenever it happens and the counter goes back to 0.

- **Counting from**: the day the counter starts.
- **If-then plan**: "If I want a cigarette, then I will do 10 push-ups", or pick one of your build habits to do instead.
- **Slip triggers**: feelings you can pick when you log a slip. Today shows which ones come up most. Renaming a feeling renames it in past slips too; removing one that past slips used archives it.
- **Cost**: tick **Show what slips cost and what staying clean saves**. Set the **Cost per slip**, a **Unit** (€, kcal, min) and, optionally, **Slips a day before you started**, so Today can show the money saved. Money saved uses today's price for every day, so a new price changes past savings.
- **Reduce instead of quitting**: tick **Allow up to a limit**. Set **Up to** N **per** day or week. The counter then shows days (or weeks) in a row within the limit. Tick **Lower the limit over time** to drop it **By** N **Every** week or month, **Down to** a floor. A changed limit applies from today; past days keep the limit they had.

Logging slips and resisted cravings is covered in [Logging](logging.md#slips-and-cravings).

## Archive, delete, duplicate

- **Archive** hides the habit from Today and keeps its history. **Unarchive** brings it back. You can also archive from the Habits page in [edit mode](views-and-edit-mode.md#edit-mode).
- **Delete** removes the habit and its history, with no question. **Undo** in the band brings it back. Until a day later it also waits among archived habits (**Include archived** in the Habits filters) and on its own page, with **Put back**; then it goes for good with its logs.
- **Duplicate** opens a copy in the editor.
- **Share as template** downloads a file others can import. See [Templates](templates.md).

## What an edit does to past days

Edits never rewrite what you logged, with one exception you choose yourself (converting a unit, see [Units](units.md)). Some edits re-judge past days instead:

- Changing the streak rule, Levels, the short-day rule or the unlogged-day rule recounts streaks from the days logged.
- A schedule change applies **From today on** or **To past days too**. See [Changing a schedule](schedules.md#changing-a-schedule).
- Changing targets, sets or the Task in a Slot, or adding or removing Slots, applies from then on. Past logs keep the Slots and targets they had, in History, Stats and how they were judged.
- Removing a Variant unlinks the days logged with it from it.

If an edit can't apply to a habit that already has logs, the editor says why and refuses to save it.
