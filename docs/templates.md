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
   - **+ Ask for a starting number** ("Your starting squat weight"): pick which targets it sets. With **In proportion**, every target moves by the same share as the answer, so a lighter day stays lighter. Without it, the answer becomes the target everywhere. Minimum and Stretch move with it either way.
   - Up to 10 questions in all.
5. **Download the template** and send the file, or **Save to my Gallery** to keep it on this server and add it again whenever you like.

A routine or a group shares as a whole program: the habits inside it come along, at any depth, with their schedules and Tasks. Habits that follow the routine keep following it, on the same Variants and with the same pairs of Variants. Archived habits stay out, and so does what sits inside them. A group with no habits inside can't be shared, since its days come from them. A habit inside a routine shared on its own takes the routine's days as a schedule of its own, with the Variants it was paired with.

For a plain export with no questions, use **Settings → Export, import and templates → Export a habit**.

## Import a template

**Habits → Import a template file**, and pick the file. Nothing is added until you press **Add this habit**. First you see:

- The **Habit name**, with a note if you already have a habit by that name.
- The template's questions (days, time, starting numbers), and the next four weeks with your answers.
- Its Tasks. A Task with the same name as one in your Library uses yours, unless you tick **Make separate Tasks instead**.
- The habits inside it, if any, with their days and Tasks. They are added inside the new habit, all at once: if one can't go where the file puts it, nothing is added. A starting-number question sets its targets in every habit that has them.
- Areas you don't have yet, with a box to add them.
- **Remind me**, when the habit has a time or part of the day.

Change anything afterwards in the habit editor.

## The Gallery

**Habits → Gallery** has ready-made habits: gym plans (Push Pull Legs, Beginner 5×5, Upper/Lower, full body, home bodyweight), running, walking, stretching, language practice, reading, instrument practice, meditation, journaling, gratitude, water, sleep on time, a morning routine, and habits to break (quit smoking, less social media, no added sugar).

Templates you saved from the Share page are at the top, under **Yours**, newest first. Open one to add it again (a whole program adds all its habits at once), **Download the file** to send it to someone, or **Remove from my Gallery**; removing it keeps the habits you added from it. Saved templates are part of the full export in Settings, so they move with your data.

Filter by search, category, **Any days a week**, **Any time a day** and **No equipment**. Adding one works like an import, with the same questions and preview. Weights in gallery templates use your [default weight unit](units.md#your-default-weight-unit).

## File format

The format is defined in `src/lib/template.ts` and is at version 9. Version 7 added phases, which start on the day you add the template. Version 8 added `children`: the habits inside the file's habit, each naming the habit it sits in by key, parents first. Version 9 added `map` to a follower's schedule: the routine's Variant key paired with the habit's own Variant key. Older files (versions 1 to 8) still import; newer fields take their defaults (versions 1 to 7 as one habit). Notes in a template come from a stranger, so they are shown with raw HTML off and images as links (see [Notes](notes-and-journal.md)).
