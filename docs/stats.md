# Stats

The **Stats** page holds boards of cards. Each card asks one question of your logs ("volume per week by muscle group", "days done this month") and draws the answer. Boards and cards are saved with your settings; nothing about them touches your logs.

## Boards

- **+ Board** starts a board from a template, made from the habits and Tasks you already have, or as an empty board.
- Each board has a **Range** (**This week**, **Last 7 days**, **This month**, **Last 30 days**, **Last 90 days**, **This year**, **Last 12 months**, **All time**) and a **Filter**: building or breaking habits, one habit, an identity, Areas and tags.
- In **Customize** you can rename a board, move it left or right, delete it, and choose whether Stats opens on **The last board I looked at** or a fixed one.

## Cards

Press **Customize**, then **Add a card**:

- **From your habits**: cards suggested from what you log. **Add** it as it is, or **Change first**.
- **Gallery**: ready-made cards.
- **Build your own**.

While customizing, drag cards in the grid, resize them (**Small**, **Wide**, **Full width**), and edit or remove them from each card's bar. Tap a number on a card to see the logs behind it. Each card can be downloaded as CSV.

### Building a card

| Setting | Choices |
| --- | --- |
| **What it reads** | **Habit outcomes** (done, missed, target met), **A field you log**, **A Task** (sets, volume, e1RM, your own measures), **Slips**, **Cravings resisted**, **Money saved** |
| Fields | **Pick fields**, or **Every field called…** to add up every field with that name across your Tasks, in one unit |
| **Each log counts as** | Depends on the source: times done, done or missed (consistency), target met, the value, sum / best / average / number of sets, ticked, which option, volume (weight × reps), estimated 1RM, hard sets, pace, % of target, how many, amount saved, or [your own measure](#your-measures) |
| **Over time, take the** | **Sum**, **Average**, **Median**, **Lowest**, **Highest**, **Last**, **Number of logs**, **Days with a log** |
| **Card type** | **Number**, **Bars**, **Line**, **Calendar**, **Goal progress**, **Records**, **Table**, **Streak**, **Breakdown**, **Pattern grid**, **Recent sessions** |
| **One bar or point per** | **Each session**, **Day**, **Week**, **Month**, **Quarter**, **Year**, **Whole range**, or **Automatic** |
| **Split into one series per** | Habit, Task, **Tag (muscle group)**, Area, Variant, Level, Weekday, Part of the day, Choice option, Set number, Field |
| **Range** | **Same as the board**, a fixed range, or **Since a date…** |
| **Only some habits, tags or Areas** | Narrows the card within the board |
| **Compare and goals** | **Compare with the period before**, a **Goal** line (or a band, with **Top of a goal band**), **Take the goal from the targets**, and a 7 or 30 day **Rolling average** |

Choices that don't fit the rest of the card are greyed out, with the reason.

## A habit's Stats tab

Each habit has a **Stats** tab (from its editor or chain) with cards made automatically from what it logs. **Customize** changes them like any board; **Back to the automatic cards** undoes your changes. A Task's **History** in the Task editor shows its charts.

## Your measures

**Settings → Your measures and formulas**. A measure is a formula over the fields you log, with field names in square brackets: `[Weight] * [Reps]` (tonnage) or `[Distance] / [Time] * 60` (speed).

- Give it a **Name** and a **Unit**.
- Work it out **On each set** (then **Add the sets up**, **Take the best set** or **Average the sets**) or **Once per log**.
- Use numbers, `+ - * / ^`, parentheses, and the functions listed under **Fields and functions you can use**. A missing value or a division by zero gives no number for that log, never a made-up 0.

Once saved, pick it under **Each log counts as** on any Task card. Measures find fields by name, so renaming a field changes their results.

## Estimated 1RM

How the best single lift is estimated from a set's weight and reps: **Epley**, **Brzycki**, **Lombardi**, or **Your own** formula. **Only for sets of this many reps or fewer** (default 12) leaves out high-rep sets, where estimates get unreliable.

## Muscle groups

When hard sets or volume are split by tag, a set counts toward each of its Task's tags by the tag's level. Set what **High**, **Medium** and **Low** count for: 1 is a full set, 0.5 half, 0 not at all.

## Download your logs

**Download every log as CSV** at the bottom of Stats. For a full export, see [Integrations](integrations.md#export-and-import).
