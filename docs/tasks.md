# Tasks and the Library

A **Task** is a reusable thing you do: an exercise, "new words", "read", "meditate". Tasks live in your **Library** and are used by habits through [Slots](habits.md#what-you-do-variants-slots-and-targets). One Task can be used by many habits, and its history is shared.


A Task's page is one page of lines, like a [habit's](habits.md#a-habits-page): each line says what it means, opens where it stands, and saves by itself with **Undo**. A field or step still being typed (no name yet, or a Choice with fewer than two options) waits until it is finished, and the page says so; the rest of its line saves. Only a change that touches what is logged waits for its own **Save**: a unit on a field with values (you choose whether they are converted or kept), or a field or step with logs taken away. Its Undo puts back exactly what it replaced, and leaves values you corrected since.

## Find Tasks

The **Library** page lists your Tasks. Filter them with the search box (names and tags), an **Area**, a **Collection** or **Tags** (all picked tags must match). Sort and save filters like any page: see [Views](views-and-edit-mode.md#filters-and-saved-views).

**Collections** are folders of Tasks, one level deep:

- **Hand-picked: you choose the Tasks.**
- **Smart: Tasks that match rules, kept up to date**, by tags, Area and **Name contains**.

Deleting a collection never deletes its Tasks.

## Make a Task

**Library → New task**, or **+ New Task…** in a Slot of the habit editor.

1. **Start from a type** to get its fields: **Strength** (weight and reps per set, with a rest timer), **Bodyweight** (reps per set), **Cardio** (time and distance), **Study** (minutes and items), **Timed** (minutes, with the built-in timer), **Count** (one number, like glasses or pages) or **Yes or no** (nothing to fill in). Types you saved yourself show here too.
2. Give it a **Name**, and optionally an **Area** and **Collections**.
3. Add **Tags** with a level (**low**, **medium**, **high**, or [your own](#groupings-and-levels)) to describe what it works on, such as "triceps: high". [Auto-filled slots](#auto-filled-slots) and Stats use them.
4. Adjust the fields under **What you log**.
5. **Save task**.

To reuse a set of fields, open **Save these fields as a Task type** at the bottom of a Task, name it ("Swimming") and save. It is offered when you make a new Task.

## Fields (Metrics)

Each field has a **Name** and a **Type**:

| Type | For |
| --- | --- |
| **Number** | Weight, distance, money: any decimal |
| **Count** | Reps, pages, glasses: whole numbers |
| **Duration** | Minutes (the log screen has a timer for it) |
| **Checkbox** | A yes or no tick |
| **Choice** | Pick one of your **Options** ("Great", "OK", "Bad") |
| **Text** | A word, or several lines of Markdown |

Options per field:

- **Unit** (numbers, counts and durations). See [Units](units.md).
- **Log per set**: logged once per set (weight, reps) instead of once per log (total minutes).
- **Give each option a number, so Stats can chart it** (choices): mood 5 to 1.
- **Several lines (Markdown), for a journal entry or a reflection** (text), with optional **Starter text** and **Prompts**. See [Notes and journal](notes-and-journal.md#writing-fields).
- **When logging**: **Start with** last time's value, the target (numbers only) or blank; and the **+/− step** for the buttons on the log screen.
- **A second quick log the same day** (numbers logged once per log): **Adds to it**, like glasses of water, or **Replaces it**, like a weigh-in. It applies to [quick-log links](integrations.md#quick-log-links) and to an AI assistant logging a value; the log screen always shows the day's value to change.
- **Required before Finish**.
- **Show on quick logs**: the field appears on the short [quick log](integrations.md#quick-log-links). Required fields always show there.

Drag ⠿ to reorder fields, or use the arrow keys on it.

### Changing fields that have logs

- A field's type can't change once it has values, except between number, count and duration (they all store a number). Add a new field instead.
- **Log per set** is fixed once the field has values.
- Removing a field that has values **archives** it: its values stay in History and Stats.
- Renaming a choice option renames it in past logs too. Removing one that was logged archives it.
- A changed option number applies from today; past days keep the numbers they had.
- A unit change asks whether to convert past values or keep their numbers. See [Units](units.md#change-a-unit).
- Renaming a field keeps its values, but [measures](stats.md#measures) find fields by name, so check them after a rename.

## Rest timer

Tick **Start a rest countdown after each set** and set the **Seconds**. It needs a field logged per set.

## A Task's own words

A Task that logs rows calls one of them a **set**, several **sets**, and the clock between two **Rest**. Change these on its page under **Its words**: "lap", "laps", "Breathe". The log, the clock, its page and the messages use them.

Under a field's **When logging**:

- **Written after a ×** says how a row reads: "60 kg × 8". A field without it stands beside the others: "80 bpm · 5 min".
- **Less is better** colours a change the other way in Stats, and makes the lowest number the record (a time, body weight). In a habit its target is a most ("at most 5 cigarettes"): a day at or under it is done, over it is not, and a day with nothing logged is still missed. With levels, the Minimum is the most that still counts and the Stretch the least. Today's +1 leaves the day open while you count; going over the most opens a finished day again.

## Groupings and levels

**Settings → Groupings** holds what your tags are members of. An account starts with one; you can rename it, and add others ("Skills", "Rooms").

- **Members** are tags. Add one before any Task has it, rename one (the rules, Collections, views and cards that name it follow), remove one no Task has, and move one to another grouping.
- **Levels** have a name and a weight, strongest first. Rename them, weigh them, add your own. A level Tasks have can come off your list; those Tasks keep it. Their order is what "at least" and "at most" compare in an auto-filled slot.
- **One is called** is the word used in card titles ("Hard sets per muscle group").

## Auto-filled slots

An auto-filled slot picks a Task from your Library each time the habit comes up, by tags. Add one with **Add an auto-filled slot** in the habit editor. Rules:

- **Must have**: a tag at **at least low**, **at least medium**, or **high** (your own levels, if you named them).
- **Must not have**: a tag **not at all**, **at most low** or **at most medium**.
- **Prefer**: tags that rank a Task higher.

How it picks: Tasks that pass the must and must-not rules, minus Tasks already used in this log, ranked by preferred tags, then by least recently done (never-done first), with ties broken at random.

On the log screen, **⋯ → Pick another** picks another Task and **Swap for another…** lets you choose one, for that day only, each with **Undo**. **Keep in the plan** isn't offered there: it would replace the rule. A tag can't be in both **Must have** and **Must not have**; the editor tells you if a rule can never match.

## Tasks inside Tasks

A Task can hold other things under **Inside this Task**, in order:

- **Add a step**: something you tick off, like "warm-up set".
- **Add a Task from your Library…**, then **Add**: a Task logged inside this one, like the exercises of a circuit. A Task can sit inside several others.

Each Task inside can have its own **Sets** (or **Rounds**, when it has Tasks inside it) and **Minimum**, **Target** and **Stretch** per number field.

When a Task with parts and no per-set fields is used in a habit, its **Rounds** repeat everything inside it. A circuit of three exercises with 3 rounds logs each exercise three times. In the log the rounds are its rows: the open one lists what is in it, each with its own tick, and **Done round 2** ticks what is left of it in one press. Press one to change its numbers; a number changed from last time goes on to the rounds still to do.

Limits: nesting goes up to 4 levels deep, and a Task can't end up inside itself. Removing a step or Task that has logs archives it: its past logs keep their place.

## Archive, duplicate, delete

- **Archive** keeps the Task's history and hides it from the Library and pickers. You can also archive and rename Tasks in place in the Library's [edit mode](views-and-edit-mode.md#edit-mode).
- **Duplicate** makes a copy.
- **Delete** removes the Task and every log of it, with no question. **Undo** in the band brings it back. Until a day later it also waits under **Show archived** in the Library and on its own page, with **Put back**; then it goes for good with its logs.
- **History** at the top of a Task shows its charts.

Several Tasks can change unit at once: see [Bulk editing](bulk-editing.md).
