# Units

Every number, count and duration field can have a unit. Type any word: "kg", "pages", "glasses". Units the app knows can convert into each other; any other word is a label that never converts.

## Units that convert

| Kind | Units | Also accepted |
| --- | --- | --- |
| Time | `s`, `min`, `h` | sec, seconds, mins, minutes, hr, hrs, hours |
| Weight | `g`, `kg`, `lb` | grams, kgs, kilo, kilos, lbs, pounds |
| Distance | `m`, `km`, `mi` | meters, metres, kilometers, kilometres, miles |

Matching ignores case and spaces, so "Lbs" and "lb" are the same unit. Units only convert within one kind: kg to lb, never kg to km. A duration field with no unit is in minutes.

Each known unit has a default **+/− step** on the log screen: 15 s, 5 min, 0.5 h, 50 g, 2.5 kg, 5 lb, 100 m, 0.5 km, 0.5 mi. Set your own step per field under **When logging** in the Task editor.

## Your default weight unit

**Settings → Units → Weights** (kg or lb). New Tasks made from the Strength type use it, and so do templates from the [Gallery](templates.md#the-gallery). Changing it doesn't change existing fields: each field keeps its own unit.

## Change a unit

Edit the field's **Unit** in the Task editor. If the field already has values, the editor asks what to do with them:

- **Convert them**: 100 kg becomes 220.462 lb. This converts every logged value, the targets in your habits' Slots, and the targets kept with past logs, all in one save. Converted values keep three decimals, so converting back gives the original number.
- **Keep the numbers: they were already in lb**. Use this when the old unit was a typo.

Between units that don't convert (pages to minutes, or any free word), only **Keep the numbers** is offered.

To change the same field on many Tasks at once (every "Weight" from kg to lb), see [Bulk editing](bulk-editing.md#change-a-unit).

## Units in Stats

- A card that adds up **Every field called…** (say every "Distance") converts fields in convertible units into one unit. Fields whose unit can't be converted are left out, with a note.
- Volume (weight × reps) and estimated 1RM are shown in your default weight unit.
