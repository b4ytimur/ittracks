# Units

Every number, count and duration field can have a unit. Type any word: "kg", "pages", "glasses". Units of one kind convert into each other; a word that is in no kind is a label that never converts.

Kinds and units are yours. **Settings → Units** lists them, and all of it can be changed, added to or deleted.

## Units you can have

A new account has Time. The others come with [starter packs](packs.md) (Gym brings Weight, Running brings Distance), or you make your own. An account from before there were packs has all three.

| Kind | Units | Also accepted |
| --- | --- | --- |
| Time | `s`, `min`, `h` | sec, seconds, mins, minutes, hr, hrs, hours |
| Weight | `g`, `kg`, `lb` | grams, kgs, kilo, kilos, lbs, pounds |
| Distance | `m`, `km`, `mi` | meters, metres, kilometers, kilometres, miles |

Matching ignores case and spaces, so "Lbs" and "lb" are the same unit. Units only convert within one kind: kg to lb, never kg to km. A duration field with no unit is in minutes.

Each unit has a **±** step, how much − and + change a number on the log screen: 15 s, 5 min, 0.5 h, 50 g, 2.5 kg, 5 lb, 100 m, 0.5 km, 0.5 mi. A field can have its own step, under **When logging** on its Task.

## Change your units

Open a kind under **Settings → Units**:

- **Shown in** is the unit the kind is added up in. Volume and estimated 1RM use Weight's, and so do new Tasks made from the Strength type and templates from the [Gallery](templates.md#the-gallery). It doesn't change existing fields: each keeps its own unit.
- **+ Unit** adds one and asks how many of the kind's base it is ("1 duck = 1.2 kg"). Fields in it convert everywhere at once.
- **Renaming** a unit renames it on the fields that use it. The old word still means it.
- **×** takes a unit off your list. If fields use it they keep it, and it still converts there; if none do, it is gone.
- **+ Kind** makes a kind of your own. Its units convert into each other and into nothing else. A kind with one unit never converts.
- **Time** can't be deleted, and neither can its s, min and h: the clocks need them. You can add to it.

Two units can't have the same name. Every change has Undo.

## Change a unit

Edit the field's **Unit** in the Task editor. If the field already has values, the editor asks what to do with them:

- **Convert them**: 100 kg becomes 220.462 lb. This converts every logged value, the targets in your habits' Slots, and the targets kept with past logs, all in one save. Converted values keep three decimals, so converting back gives the original number.
- **Keep the numbers: they were already in lb**. Use this when the old unit was a typo.

Between units that don't convert (pages to minutes, or any free word), only **Keep the numbers** is offered.

To change the same field on many Tasks at once (every "Weight" from kg to lb), see [Bulk editing](bulk-editing.md#change-a-unit).

## Units in Stats

- A card that adds up **Every field called…** (say every "Distance") converts fields in convertible units into one unit. Fields whose unit can't be converted are left out, with a note.
- Volume (weight × reps) and estimated 1RM are shown in the unit Weight is shown in.
