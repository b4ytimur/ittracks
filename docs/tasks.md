# Tasks and the Library

A **Task** is a reusable thing you do: an exercise, "new words", "read", "meditate". Tasks live in your **Library** and are used by habits through [Slots](habits.md#what-you-do-variants-slots-and-targets). One Task can be used by many habits, and its history is shared.

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
3. Add **Tags** with a level (**low**, **medium**, **high**) to describe what it works on, such as "triceps: high". [Auto-filled slots](#auto-filled-slots) and Stats use them.
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
- **Required before Finish**.
- **Show on quick logs**: the field appears on the short [quick log](integrations.md#quick-log-links). Required fields always show there.

Use the arrows to reorder fields. **Use weight and reps per set** adds the Strength fields in one go.

### Changing fields that have logs

- A field's type can't change once it has values, except between number, count and duration (they all store a number). Add a new field instead.
- **Log per set** is fixed once the field has values.
- Removing a field that has values **archives** it: its values stay in History and Stats.
- Renaming a choice option renames it in past logs too. Removing one that was logged archives it.
- A changed option number applies from today; past days keep the numbers they had.
- A unit change asks whether to convert past values or keep their numbers. See [Units](units.md#change-a-unit).
- Renaming a field keeps its values, but [your own measures](stats.md#your-measures) find fields by name, so check them after a rename.

## Rest timer

Tick **Start a rest countdown after each set** and set the **Seconds**. It needs a field logged per set.

## Auto-filled slots

An auto-filled slot picks a Task from your Library each time the habit comes up, by tags. Add one with **Add an auto-filled slot** in the habit editor. Rules:

- **Must have**: a tag at **at least low**, **at least medium**, or **high**.
- **Must not have**: a tag **not at all**, **at most low** or **at most medium**.
- **Prefer**: tags that rank a Task higher.

How it picks: Tasks that pass the must and must-not rules, minus Tasks already used in this log, ranked by preferred tags, then by least recently done (never-done first), with ties broken at random.

On the log screen, **⋯ → Pick another** picks another Task and **Swap…** lets you choose one. A tag can't be in both **Must have** and **Must not have**; the editor tells you if a rule can never match.

## Tasks inside Tasks

A Task can hold other things under **Inside this Task**, in order:

- **Add a step**: something you tick off, like "warm-up set".
- **Add a Task from your Library…**: a Task logged inside this one, like the exercises of a circuit. A Task can sit inside several others.

Each Task inside can have its own **Sets** (or **Rounds**, when it has Tasks inside it) and **Minimum**, **Target** and **Stretch** per number field.

When a Task with parts and no per-set fields is used in a habit, its **Rounds** repeat everything inside it. A circuit of three exercises with 3 rounds logs each exercise three times.

Limits: nesting goes up to 4 levels deep, and a Task can't end up inside itself. Removing a step or Task that has logs archives it: its past logs keep their place.

## Archive, duplicate, delete

- **Archive** keeps the Task's history and hides it from the Library and pickers. You can also archive and rename Tasks in place in the Library's [edit mode](views-and-edit-mode.md#edit-mode).
- **Duplicate** makes a copy.
- **Delete** removes the Task and every log of it. It asks first.
- **History** at the top of a Task shows its charts.

Several Tasks can change unit at once: see [Bulk editing](bulk-editing.md).
