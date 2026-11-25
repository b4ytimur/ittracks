# Bulk editing

Change many habits, Tasks or days in one go: skip a sick week, pause habits for a holiday, archive old habits, move habits to an Area, change their streak rule, or switch every Weight field from kg to lb. Every bulk change shows a preview first and can be undone.

## Select

1. On the **Habits** page, the **Library** or **History**, press **Select**.
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
| **Archive** | **Archive** or **Bring back** | Archives the habits, as **Archive** on the Habits page does: their days up to today are counted first, and they keep every log. **Bring back** returns them, and days spent in the archive never count as missed. To bring habits back, show archived habits first. A group or routine is archived on its own: the habits inside it stay, and the preview names them |
| **Area** | An Area, or **No Area** | Moves the habits to that Area |
| **Reminders** | **On** or **Off** | Turns reminders on or off. Habits without a time or part of the day are left as they are |
| **Streak rule** | **How the streak counts**, and **Misses** and **Per**, or **Over the last N days**, when the rule needs them | Sets the same streak rule on every habit. Break habits are left as they are. Streaks are worked out again from the days logged, and the preview says so. A grace rule with so many misses that the streak can never break is still set, with a warning next to the habit |
| **Days you don't log** | **Count as missed once the day is over** or **Don't count them: only what you log counts** | As the same choice under Streak in the editor. Not counting them takes away the misses written for days nobody logged; counting them again writes them back. Groups and break habits are left as they are |

## Actions on Tasks

### Archive

**Archive** or **Bring back**, as **Archive** in the Library's edit mode. Archived Tasks keep their logs and leave the pickers.

### Change a unit

**Field** (by name, such as "Weight"), **New unit**, **Past values** and **Tasks inside them**:

- **Convert them (60 kg becomes 132.277 lb)**: converts past values and targets. Only between units of one kind (kg and lb, km and mi, min and h).
- **Keep the numbers (60 kg becomes 60 lb)**.
- **Tasks inside them**: **Change them too** (the default) also changes the field in the Library Tasks inside the selected Tasks, at any depth, so selecting a workout changes its exercises. **Leave them** changes only the selected Tasks.

Each Task with a field of that name changes once, even when it is both selected and inside another. The preview shows where each one sits, such as "Leg day › Squat › Weight". See [Units](units.md) for what converts.

## Actions on days

### Skip

On **History**, press **Select**, tick the days, and press **Skip**. Each ticked day is skipped, as **Skip** on the day itself: a missed day becomes skipped, which neither adds to nor breaks a streak. Done days stay done, and days after today or too far back to log are left out with the reason (you can change how far back in **Settings → Logging past days**). For every day in a date range, use **Skip days** on the Habits page instead.

## From scripts and AI assistants

The same actions run through the `bulk` action of the [MCP server](integrations.md#ai-assistants-mcp): select by ids or by a filter (Area, build or break, tag), preview first, then apply with `apply: true`. Days are picked by id only: a log id, or the habit and the date as `Drink water@2026-11-16`. `bulk_undo` takes a change back. A key needs **Log** access, plus **Edit** for pausing, archiving, changing settings and units.
