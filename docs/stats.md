# Stats

The **Stats** page holds boards of cards. Each card asks one question of your logs ("volume per week by muscle group", "days done this month") and draws the answer. Boards and cards are saved with your settings; nothing about them touches your logs.

## Boards

- **⋯ → New board…**, next to the boards, starts one from a template, made from the habits and Tasks you already have, or empty.
- Each board has a range, as buttons (**This week**, **Last 7 days**, **This month**, **Last 30 days**, **Last 90 days**, **This year**, **Last 12 months**, **All time**), and a **Filter**: building or breaking habits, one habit, an identity, Areas and tags.
- In **Edit**, press a board's name to rename it. **⋯** moves it left or right, deletes it (with Undo), and sets whether Stats opens with the last board or with this one.

## Cards

Under its title a card says what it shows: *Volume · Bench press · per week · the board's range*. The words are the controls: press one and pick another, in Use and in Edit. A word offers only what the logs have. When a word doesn't go with the others, the nearest one that does takes its place, and the line above the tabs says so. Every change has **Undo**.

- **⋯** on a card: the chart kinds that suit it, its size (**Small**, **Wide**, **Full width**), **Show as a table**, **Show the logs**, **Download CSV**, **All settings…** and **Remove**.
- A chart says its point in a sentence ("Last 85 kg (8 Nov). Highest 90 kg (1 Nov).").
- Press a mark to see the logs behind it, in the card: five, then **All … logs**.
- In **Edit**, drag a card by its ⠿, or use the arrow keys on it.

Press **+ Card** to add one:

- **From your habits**: cards suggested from what you log. **Add** it as it is, or **Change first**.
- **Gallery**: ready-made cards.
- **Build your own**.

### All settings

What a sentence can't say (goals, rolling averages, splits, filters) is in **⋯ → All settings…**:

| Setting | Choices |
| --- | --- |
| **What it reads** | **Habit outcomes** (done, missed, target met), **A field you log**, **A Task** (sets, and your measures), **Slips**, **Cravings resisted**, **Money saved** |
| Fields | **Pick fields**, or **Every field called…** to add up every field with that name across your Tasks, in one unit |
| **Each log counts as** | Depends on the source: times done, done or missed (consistency), target met, the value, sum / best / average / number of sets, ticked, which option, % of target, how many, amount saved, or one of your [measures](#measures) |
| **Over time, take the** | **Sum**, **Average**, **Median**, **Lowest**, **Highest**, **Last**, **Number of logs**, **Days with a log** |
| **Card type** | **Number**, **Bars**, **Line**, **Calendar**, **Goal progress**, **Records**, **Table**, **Streak**, **Breakdown**, **Pattern grid**, **Recent sessions** |
| **One bar or point per** | **Each session**, **Day**, **Week**, **Month**, **Quarter**, **Year**, **Whole range**, or **Automatic** |
| **Split into one series per** | Habit, Task, a **grouping** of tags, Area, Variant, Level, Weekday, Part of the day, Choice option, Set number, Field |
| **Range** | **Same as the board**, a fixed range, or **Since a date…** |
| **Only some habits, tags or Areas** | Narrows the card within the board |
| **Compare and goals** | **Compare with the period before**, a **Goal** line (or a band, with **Top of a goal band**), **Take the goal from the targets**, and a 7 or 30 day **Rolling average** |

Choices that don't fit the rest of the card are greyed out, with the reason.

## A habit's Stats tab

Each habit has a **Stats** tab (from its editor or chain) with cards made automatically from what it logs. They change like any card; **Back to the automatic cards** undoes your changes. **Last times** on a Task's page shows its charts.

## Measures

**Settings → Measures**. A measure is a formula over the fields you log, with field names in square brackets: `[Weight] * [Reps]` or `[Distance] / [Time] * 60`. All of them are yours to change, delete and add to, also the ones an account starts with (Volume, Estimated 1RM, Hard sets, Pace and Heaviest set).

- Give it a **Name** and a **Unit**. In the unit, `{weight}` is the unit Weight is [shown in](units.md#change-your-units), and `[Distance]` the unit of that field.
- Work it out **On each set** (then **Add the sets up**, **Take the best set** or **Average the sets**) or **Once per log**.
- Use numbers, `+ - * / ^`, parentheses, and the functions listed under **Fields and functions you can use**. `first([Weight], [Load])` reads the first of these fields a Task has; `above([Weight], 0)`, `atleast([Reps], 1)` and `upto([Reps], 12)` leave a set out when it is outside the limit; `minutes([Time])` reads a time in minutes; `sets()` is how many sets were logged. A missing value or a division by zero gives no number for that log, never a made-up 0.
- Under **How it reads fields, and where it shows**: **Convert first** reads fields in the unit their kind is shown in, **Only Tasks logged in sets**, **Split by a grouping, it counts by the level**, **Less is better** (a pace), how logs combine **On a new card**, and the line it has **Among a Task's records**.

A formula that can't be read is not saved, and the line says why. One that names a field no Task has is, and counts nothing until one does.

Once saved, pick a measure under **Each log counts as** on any Task card. Measures find fields by name, so renaming a field changes their results. Deleting one that cards count by takes it off your list and keeps it for those cards.

### Estimated 1RM

How the best single lift is estimated from a set's weight and reps. **Epley**, **Brzycki** and **Lombardi** are there to pick, or write your own. `upto(…, 12)` in it leaves out high-rep sets, where estimates get unreliable.

## Groupings

Tags belong to groupings, under **Settings → Groupings**. When hard sets or volume are split by one, a set counts toward each of its Task's tags by the tag's level: a level that counts 1 is a full set, 0.5 half, 0 not at all. With several groupings, a card can be split by one of them or by every tag. See [Groupings and levels](tasks.md#groupings-and-levels).

## Download your logs

**Download every log as CSV** at the bottom of Stats. For a full export, see [Integrations](integrations.md#export-and-import).
