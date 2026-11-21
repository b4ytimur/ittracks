# ittracks

A fully customizable, self-hostable habit tracker. Build a habit out of your own Variants and Tasks, choose what to log (weight, sets, reps, minutes, words, yes or no), and schedule it with weekdays, rotations with rest days, or intervals. It also tracks bad habits with a slip counter and has a built-in timer.

Status: MVP in progress. You can set up habits, log them day to day, track slips, and share habits as template files.

## Concepts

| Term | Meaning |
| --- | --- |
| Habit | What you track, either *build* (do more) or *break* (do less) |
| Variant | A named version of a habit, e.g. Push day A, Pull day B |
| Slot | A position in a Variant, fixed to a Task or auto-filled by a Fill rule |
| Task | A reusable thing you do, kept in your Library, with Tags and Metrics |
| Metric | A value you log: number, count, duration, checkbox, choice or text |
| Schedule | Weekly, frequency, rotation (by Variant or by week) or interval |
| Occurrence / Log / Entry | A Variant on a date, what you did, and one row of values (e.g. one set) |
| Slip | A logged lapse of a break habit; resets its counter to 0. Can record time, place, feeling and company |
| Identity | Who you want to be ("I am a runner"). Each done Occurrence of a linked habit is a vote for it |
| Cue | When and where a habit happens, and what it is stacked after |
| Level | Minimum (the two-minute version), Target and Stretch |
| Streak rule | Strict, never miss twice (default), grace days, or consistency % |
| If-then plan | What a break habit's user does instead when a craving comes; a resisted craving is logged too |
| Area | A life area (Fitness, Learning...) that groups habits and Tasks |
| Collection | A folder of Tasks in the Library, hand-picked or smart (a saved filter); one level of nesting |
| Task type | A preset set of Metrics (Strength, Cardio, Study...) to start a Task from; you can save your own |
| Day start / parts of the day | When your day rolls over (default 04:00) and named hour ranges like Morning 05:00–11:00 that a cue can use instead of a time |
| Pause | A date range when a habit (or every habit, for a vacation) is not due and streaks are kept |

## Logging fast

- Values start from last time (or the target, or blank, per Metric). Changing a set's value marks it done, and "Finish remaining sets as planned" closes the rest.
- "Same as last time" on Today logs the last values in one tap, with Undo.
- The log saves as you go, and keeps working offline: changes wait on the device and sync when the connection is back.
- Quick-log links `/q/<habit id>` open a short log with only the fields marked "Show on quick logs". Add `?go=1` to log "same as last time" at once. Pinned habits appear as home screen shortcuts (long-press the app icon).
- Forgot a day? "Log a past day" on Today (or a day in History, the week strip or a habit's chain) opens that day: mark habits done, skipped or "same as last time", open the full log, or add a slip. A late log counts like one made on the day, streaks included, and "same as last time" copies the log from before that day. Today mentions yesterday when it was left unlogged. Settings can limit how far back you can log, or turn it off.

## Notes and journal

- Every note (Tasks, habits, logs, slips) is plain Markdown: a Write / Preview box with bold, list and link buttons. A Task's notes show as "How to" on its log screen. Raw HTML is off, only web, mail and in-app links are kept, and images show as links, so notes from a shared template can't run code or load tracking pixels.
- A Text field can have several lines (Markdown), with starter text and a list of prompts (one a day, in order or random, saved with the answer). A Choice can give each option a number (mood 5 to 1) so Stats can average it.
- The journal is a normal habit: "Start a daily journal" on the new habit screen adds one. History → Journal shows everything written, by day, with search, habit and mood filters and "On this day". An optional day note (Settings → Journal) adds one free note per day to Today and the Day page.
- Notes and journal entries are private: they never go into templates or anything shared. Settings → Journal downloads them as Markdown, one file per day, for an Obsidian vault.

## Reminders

Habits with a cue time (or a part of the day) can send a push notification at that time, with Done, Minimum and Snooze buttons. The server creates its own push keys on first start and stores them in the database, so there is nothing to configure. Turn reminders on per device in Settings. Push needs HTTPS (or `localhost`); on iPhone and iPad it works only after adding the app to the Home Screen.

## Stack

SvelteKit (TypeScript), SQLite through Drizzle ORM, Vitest. It ships as one Docker container.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # schedule, fill and streak rules
npm run check      # type check
```

After changing `src/lib/server/db/schema.ts`, run `npm run db:generate` to create a migration. Migrations run automatically on startup.

## Self-host

```sh
docker compose up -d
```

The app listens on port 3000 and keeps its database in `./data`. Set `ORIGIN` in `docker-compose.yml` to the address you open it at. On first visit you create the account for your server.

To install it on your phone, open it in the browser and choose "Add to Home Screen". Phones only offer this over HTTPS, so put the app behind a reverse proxy with a certificate (for example Caddy or Traefik).

## Templates

Any habit can be exported from its editor as a `.ittracks.json` file and imported on any ittracks server from the Habits tab. A template holds the habit, its Variants, schedule and Fill rules, and the Tasks it uses. It never contains your logs. The format is defined in `src/lib/template.ts` (version 3; versions 1 and 2 still import). A template can ask questions when it is added (which days, a starting weight, a time) and carries gallery details (category, days per week, minutes, equipment, Area). When a template's Task has the same name as one in your Library, your Task is used unless you choose "separate".

The Gallery (`/gallery`) ships ready-made templates from `src/lib/gallery/*.ittracks.json`. In those files, `{weight}` stands for the user's weight unit.

## License

[AGPL-3.0](LICENSE). You can self-host, modify and share it. If you run a modified version as a service for others, you must publish your changes.
