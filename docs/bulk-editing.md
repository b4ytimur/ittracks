# Bulk editing

Change many habits or Tasks in one go: skip a sick week, pause habits for a holiday, move habits to an Area, turn reminders on, or switch every Weight field from kg to lb. Every bulk change shows a preview first and can be undone.

## Select

1. On the **Habits** page or the **Library**, press **Select**.
2. Tick rows. A tap anywhere on a row ticks it, and Shift-click ticks a range. **Select all N shown** ticks everything the current filter shows, so filter first to select "all Fitness habits".
3. Pick an action on the bar, fill in its form, and press **Preview**.
4. The preview lists what will change, and what is left as it is and why (a reminder needs a time, a group can't be paused). Press **Apply N changes**, or **Cancel**.
5. A message confirms the change with **Undo**.

Undo puts back everything the change did. Items you changed again since are kept as they are now, and the message says how many.

**Select** and **Edit** are two modes of the same list: turning one on turns the other off.

## Actions on habits

| Action | Asks for | What it does |
| --- | --- | --- |
| **Skip days** | **From**, **To** | Skips every due day in the range. Days already done stay done. Days after today are left out: pause those instead. A skip neither adds to nor breaks a streak |
| **Pause** | **From**, **To**, **Note** | Pauses the habits, as [Pause](schedules.md#pause-and-vacation) in the editor does. Paused days aren't due, and a pause over past days takes back the misses counted for them. Archived habits, groups and habits already paused then are left out |
| **Area** | An Area, or **No Area** | Moves the habits to that Area |
| **Reminders** | **On** or **Off** | Turns reminders on or off. Habits without a time or part of the day are left as they are |

## Actions on Tasks

### Change a unit

**Field** (by name, such as "Weight"), **New unit** and **Past values**:

- **Convert them (60 kg becomes 132.277 lb)**: converts past values and targets. Only between units of one kind (kg and lb, km and mi, min and h).
- **Keep the numbers (60 kg becomes 60 lb)**.

Each selected Task that has a field with that name changes. See [Units](units.md) for what converts.

## From scripts and AI assistants

The same actions run through the `bulk` action of the [MCP server](integrations.md#ai-assistants-mcp): select by ids or by a filter (Area, build or break, tag), preview first, then apply with `apply: true`. `bulk_undo` takes a change back. A key needs **Log** access, plus **Edit** for pausing, changing settings and units.

> TODO: more bulk actions are being built. This page will list them when they land.
