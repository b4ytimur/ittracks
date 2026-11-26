# Templates and the Gallery

A template is a file (`.ittracks.json`) holding one habit, and the habits inside it if it's a routine or a group: their Variants, schedules, targets, Fill rules and the Tasks they use. It never holds your logs, slips, journal entries or notes on logs. Anyone can import it on any ittracks server.

## Share a habit

1. Open the habit and press **Share as template**.
2. **About it**: **Template name** and **Description** ("Who it's for and how it works"). Under **Gallery details (optional)**: **Category**, days per week, **Minutes a day** and **Equipment**.
3. **What travels with it** (each optional):
   - The habit's Area and the Areas of its Tasks (by name).
   - Tasks from your Library that its auto-filled slots can pick from.
   - **The habit's own note** and the **How to notes of its Tasks**.
   - **Suggest turning the reminder on**.
4. **Questions** asked when someone adds it, so it fits them. Each starts with your own setting as its answer.
   - **Ask which days** (weekly schedules, rotations by week, and N times a week).
   - **Ask what time**.
   - **+ Ask for a starting number** ("Your starting squat weight"): pick which targets it sets. Its words, unit and starting value come from the first target picked, and follow when you pick another, unless you typed your own. With **In proportion**, every target moves by the same share as the answer, so a lighter day stays lighter. Without it, the answer becomes the target everywhere. Minimum and Stretch move with it either way.
   - Up to 10 questions in all.
5. **Download the template** and send the file, or **Save to my Gallery** to keep it on this server and add it again whenever you like.

A routine or a group shares as a whole program: the habits inside it come along, at any depth, with their schedules and Tasks. The file also names the [packs](packs.md) its Tasks' units and tags come from (Weight in kg brings Gym, for example), so whoever adds it gets them too. Habits that follow the routine keep following it, on the same Variants and with the same pairs of Variants. Archived habits stay out, and so does what sits inside them. A group with no habits inside can't be shared, since its days come from them. A habit inside a routine shared on its own takes the routine's days as a schedule of its own, with the Variants it was paired with.

For a plain export with no questions, use **Settings → Templates → Save as a file**.

## Add a template file

**Habits → Import a template file**, or **Add a file** on an empty Today, and pick the file. It is checked first: a file that can't be read, that isn't a template, that is a whole backup, or that a newer ittracks made says so in words, and nothing is changed. Nothing is added until you press **Add this habit**. First you see:

- The habit as a sentence: its name and its days. The template's questions (days, time, starting numbers) have their defaults, so adding takes one press; change one and the sentence follows. **Called** is the habit's name, with a note if you already have one by that name.
- **Its plan starts on**, for a rotation, an interval or phases: today unless you pick another day. A later day starts it then. An earlier day puts you where the plan is now (the day a roster's Night 1 was, or a club plan's first Monday), and nothing before today counts.
- **What it adds**: the habits inside it, what each Variant has in it, its Tasks and what they log, and the [packs](packs.md) that come with it (those the file names that you haven't taken). Undo takes them out again. A Task with the same name as one in your Library is yours, used as it is, unless you tick **Make separate Tasks**.
- Areas you don't have yet, with a box to add them, and **Remind me** when the habit has a time or part of the day.

A program's habits are added all at once: if one can't go where the file puts it, nothing is added. Adding has Undo: what it made goes again, except a Task another habit uses by then. Anything can be changed on the habit's page afterwards.

## The Gallery

**Habits → Gallery** has ready-made habits: gym plans (Push Pull Legs, Beginner 5×5, Upper/Lower, full body, home bodyweight), running, walking, stretching, language practice, reading, instrument practice, meditation, journaling, gratitude, water, sleep on time, a morning routine, and habits to break (quit smoking, less social media, no added sugar).

Templates you saved from the Share page are at the top, under **Yours**, newest first. Open one to add it again (a whole program adds all its habits at once), **Download the file** to send it to someone, or **Remove from my Gallery**; removing it keeps the habits you added from it. Saved templates are part of the full export in Settings, so they move with your data.

The Gallery groups habits by what you want (**Get stronger**, **Learn something**, **Stop something**) and has a search and three filters. **Add** on a row adds it as it comes, with Undo; open the row to change its words first. Adding one brings the [pack](packs.md) it belongs to, and says so. Weights use the unit Weight is [shown in](units.md#change-your-units).

## File format

The format is defined in `src/lib/template.ts` and is at version 12. Version 12 added `scoring` on a habit (`track` for a [tracker](habits.md#trackers)) and `sameDay` on fields. Version 11 added `packs`: the starter packs its Tasks use, by id. Version 7 added phases, which start on the day you add the template unless you pick another. Version 10 added a Task's own words and `times` and `better` on fields. Version 8 added `children`: the habits inside the file's habit, each naming the habit it sits in by key, parents first. Version 9 added `map` to a follower's schedule: the routine's Variant key paired with the habit's own Variant key. Older files (versions 1 to 8) still import; newer fields take their defaults (versions 1 to 7 as one habit). Notes in a template come from a stranger, so they are shown with raw HTML off and images as links (see [Notes](notes-and-journal.md)).
