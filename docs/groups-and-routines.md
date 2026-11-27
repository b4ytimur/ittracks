# Groups and routines

Build habits can sit inside other habits. This is optional: most habits stand alone. There are two kinds of holder:

| | Group | Routine |
| --- | --- | --- |
| Its days | Whenever a habit inside it is due | Its own schedule |
| Can you log it? | No, it is judged from the habits inside | Yes: **Done** marks the habits inside done |
| Habits inside | Keep their own schedules | Keep their own schedules, or follow the routine's days |
| Use it for | "Health: 3 of my 5 health habits a day" | "Morning routine: water, stretch, journal" |

Each habit inside keeps its own log, streak and Stats. The holder adds a streak of its own on top. Only build habits can sit inside another habit.

## Put a habit inside another

- In the habit's editor, pick the holder under **Inside**. The list shows **Groups** and **Routines** separately.
- Or, on the Habits page in **my order**, drag the habit's ⠿ under a group or routine and sideways to the right to put it inside. Sideways to the left takes it out. Or tap its ⠿ and choose **Put inside** or **Take out of**. See [Habits](views-and-edit-mode.md#habits).

A habit with past days counts in its new holder **from today on**, unless you say otherwise. Under **Inside** in the editor, choose **Past days too**; on the Habits page, press **Past days too** beside the move's Undo. Then all its days count in the holder, as if it had always been there. A group that starts later than the habit reaches back to the habit's start (Started on moves back, as **Start from this day** does). A routine keeps its own start, since its days are its own plan. **Undo** puts it back to from today on.

## Groups

Make a habit and set **How often** to **From the habits inside it (a group)**. A group has no Tasks of its own.

Choose when a day is done:

- **Done when**: **Every habit inside that is due is done**, or **A number of them are done** (**How many**). On a day only some are due, the number counts the ones due.
- Tick **A day with fewer done still counts at the Minimum** and set **Habits for the Minimum**. The Minimum must be fewer habits than the target.

On Today, a group shows a progress bar of the habits inside it. You can't log a group or set a reminder on it; do those on the habits inside. Sharing a group or a routine as a template takes the habits inside it along (see [Templates](templates.md#share-a-habit)).

Groups can sit inside other groups, but not inside routines. Moving a habit into or out of a group or routine applies from that day on, unless you choose **Past days too** (see above): past days keep the habits they had, so the holder's past days and streak don't change. Logging a day from before the move counts for the holder the habit was in that day. A habit that follows its routine's days with **To past days too** counts in the routine on its past days as well.

## Routines

A routine is a build habit with its own schedule and no Tasks of its own. Make one by creating a habit with a schedule and nothing under **What you do**, then put habits inside it.

### Habits inside a routine

A habit inside a routine can keep its own schedule, or set **How often** to **Whenever <routine> is due**. If the routine has several Variants, **Only when <routine> is on** limits it to some of them (stretches only on leg day). Pick the habit's own Variant under **Variant**.

### Keeping two rotations in step

When both the routine and the habit inside it have several Variants, **Variant on each of <routine>'s Variants** picks the habit's Variant for each of the routine's. Whenever the routine is on one of them, the habit logs the Variant picked for it, so the two go through their Variants together. For example, a "Gym day" routine rotates through Upper A, Lower A, Upper B and Lower B, and "Bench" only comes up on Upper days: **Heavy** on Upper A and **Light** on Upper B. A missed day, a waiting rotation or a late log moves the routine, and the habit moves with it. **Any other day** is the Variant it logs on a Variant of the routine's that isn't listed (one added later).

When you switch a habit to follow its routine, each of the routine's Variants starts paired with the habit's Variant of the same name, if there is one. A habit with a rotation of its own starts the routine where it is now, when the routine's rotation hasn't begun: Gym on Upper B makes a new Gym day start at Upper B, not at its first Variant. The order and rest days stay as they are; only where it starts changes. The band says so, and its Undo puts the routine back too. A habit that keeps a rotation of its own inside a rotating routine can drift away from it; the editor says so under **How often**. A Variant the habit never logs gets a warning, since it would never come up.

Today's log of a habit that follows its routine is planned again when the routine's today changes (a schedule edit, a rotation that moves on), as long as nothing is logged or noted in it yet. Changing the pairs applies from today on, like any schedule change.

### How a routine's day counts

On its days, a routine is judged from the habits inside it that are due, with the same **Done when** and Minimum choices as a group (under **On its days, judged from the habits inside**). A routine inside another routine that follows it has these choices too. A habit that follows the routine and wasn't logged on one of its days counts as missed. A day when none of them is due, you tick the routine off like any habit.

When the routine's days change (a schedule change to past days too, a past log that moves its rotation on), the habits that follow it count their days again from the routine's new days.

### Doing a routine

On Today, a routine shows the habits inside it.

- **Start** opens the routine's log: the habits inside that are due, in order. One is open, the rest are a line each. **Done** marks the open one and goes to the next; a habit with Tasks says **Open its log**, and Finish there comes back here. **Skip** is in its ⋯. The ⋯ at the top has **Mark the rest done** (every open habit gets its one tap; one that needs values, or whose time today is still ahead, stays open) and **Skip the rest**. The band's Undo puts back exactly what that marked. Leave and come back: the first one still to do is open.
- **Done** on the routine marks every habit inside that is due done. **Skip** skips them. This works on [past days](logging.md#log-a-past-day) too.
- A habit inside whose time today is still ahead stays due: its cue time, or the start of its part of the day. At 5 AM, **Done** on Evening medicines leaves Evening Lisinopril (20:00) open and says "Evening Lisinopril waits for 20:00." The routine stays open until it is done. On a past day every time has come, so Done marks them all.
- **Undo** on the routine opens again only the habits its own Done or Skip marked, and takes away what that one tap filled in. A habit you logged on its own stays as it is. A routine that is done only because every habit inside it was logged on its own has no Undo: undo those habits instead.
- **Clear** on a past routine day takes the logs of the habits inside it away too, so the day counts as missed again. Its Undo brings them all back.

Routines can sit inside other routines. Deleting a routine gives each habit that followed it the closest schedule of its own: its weekdays, a rotation of the Variants it was paired with (with the routine's other days as rest days), or its average gap.
