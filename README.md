# ittracks

A fully customizable, self-hostable habit tracker. Build a habit out of your own Variants and Tasks, choose what to log (weight, sets, reps, minutes, words, yes or no), and schedule it with weekdays, rotations with rest days, or intervals. It also tracks bad habits with a slip counter and has a built-in timer.

Status: MVP in progress. You can set up habits, log them day to day, track slips, and share habits as template files.

The user guide is in [docs/](docs/README.md): habits, schedules, Tasks, logging, streaks, units, bulk editing, views, templates, notes, stats and integrations.

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
- Quick-log links `/q/<habit id>` open a short log with only the fields marked "Show on quick logs". Add `?go=1` to log "same as last time" at once, or `?value=250` to add a number. Pinned habits appear as home screen shortcuts (long-press the app icon). With a key (see Integrations) the same links work from Shortcuts, Siri, NFC tags and QR codes without signing in.
- Forgot a day? "Log a past day" on Today (or a day in History, the week strip or a habit's chain) opens that day: mark habits done, skipped or "same as last time", open the full log, or add a slip. A late log counts like one made on the day, streaks included, and "same as last time" copies the log from before that day. Today mentions yesterday when it was left unlogged. Settings can limit how far back you can log, or turn it off.

## Notes and journal

- Every note (Tasks, habits, logs, slips) is plain Markdown: a Write / Preview box with bold, list and link buttons. A Task's notes show as "How to" on its log screen. Raw HTML is off, only web, mail and in-app links are kept, and images show as links, so notes from a shared template can't run code or load tracking pixels.
- A Text field can have several lines (Markdown), with starter text and a list of prompts (one a day, in order or random, saved with the answer). A Choice can give each option a number (mood 5 to 1) so Stats can average it.
- The journal is a normal habit: "Start a daily journal" on the new habit screen adds one. History → Journal shows everything written, by day, with search, habit and mood filters and "On this day". An optional day note (Settings → Day note) adds one free note per day to Today and the Day page.
- Notes and journal entries are private: they never go into templates or anything shared. Settings → Download the journal saves them as Markdown, one file per day, for an Obsidian vault.

## Reminders

Habits with a cue time (or a part of the day) can send a push notification at that time, with Done, Minimum and Snooze buttons. The server creates its own push keys on first start and stores them in the database, so there is nothing to configure. Turn reminders on per device in Settings. Push needs HTTPS (or `localhost`); on iPhone and iPad it works only after adding the app to the Home Screen.

## Integrations

Settings → Keys makes keys. A key has only the access you give it (Read, Log, Notes, Export), can be limited to some habits, and is shown once; the server keeps only its hash. Every change, from the app or a key, also goes into an append-only event log that records where it came from.

- **Quick-log links that carry a value**: `/q/<habit>?key=itk_…&value=250` (add `&field=Minutes` when the habit has several numbers, `&craving=1` for a break habit, `&reply=text` for one plain line Siri can read out). Programs can POST to the same address with `Authorization: Bearer itk_…`. The settings page builds the link and has a recipe for iPhone Shortcuts, Siri and NFC tags.
- **AI assistants (MCP)**: `static/ittracks-mcp.mjs` (also served at `/ittracks-mcp.mjs`) is a zero-dependency MCP server for Claude Desktop, Claude Code, Cursor and other MCP clients. It needs Node 18+ and two variables, `ITTRACKS_URL` and `ITTRACKS_KEY`. It is built for analysis: `describe` explains what is tracked; `habit_summary`, `series` and `correlate` do the math on the server; `stats_describe`, `stats_trend`, `stats_compare` and `stats_groups` run real statistics (confidence intervals, least squares and Mann-Kendall trends with a change point, Welch's t-test, Mann-Whitney, Fisher's exact test, Kruskal-Wallis and ANOVA, effect sizes, unusual days), each with n, a plain reading and caveats; raw rows come as compact CSV, and every answer carries refs (`log:<id>`, `day:<date>`, …) the assistant can cite and open with `record`. It logs only through the logging tools, which need the Log access.
- **Export and import**: Settings → Data downloads everything as JSON (a full backup that imports here or on another server, keeping ids so links keep working) or as tidy CSV tables in a zip with a README that explains every column. Restoring replaces the account's data after a preview; logins, keys and devices stay. Large imports need `BODY_SIZE_LIMIT` (the Docker image sets 50M). A key with Export access can download the same files from `/api/v1/export?format=json|csv`.

The actions behind these (`GET /api/v1/actions`, `POST /api/v1/actions/<name>`) are internal for now: they may still change, and they are not documented for other uses. Their code is in `src/lib/server/core/`; the statistical tests are in `src/lib/engine/statistics.ts` (built on simple-statistics and jStat, and checked against SciPy in its tests).

## Stack

SvelteKit (TypeScript), SQLite through Drizzle ORM, Vitest. It ships as one Docker container.

## Develop

```sh
make up            # install, migrate, start; prints http://localhost:5173 once it answers
make seed          # add the example data (below) to the database
make mcp           # copy the AI assistant script to ~/.ittracks/ and print the Claude Desktop config
npm test           # schedule, fill and streak rules
npm run check      # type check
```

`make up` and `make seed` take `PORT`, `HOST` and `DATABASE_PATH` (default `./data/ittracks.db`), e.g. `make up PORT=5180 DATABASE_PATH=./data/try.db`. On a database with no account yet, `make seed` makes one first: `demo` / `demo1234`, or `SEED_USER` and `SEED_PASSWORD`. `make mcp` puts the address from `PORT` and `HOST` in the config, and copies to `MCP_DIR` (default `~/.ittracks`). Without make: `npm install`, then `npm run dev`.

After changing `src/lib/server/db/schema.ts`, run `npm run db:generate` to create a migration. Migrations run automatically on startup.

## Self-host

```sh
docker compose up -d
```

The app listens on port 3000 and keeps its database in `./data`. Set `ORIGIN` to the address you open it at (links and the MCP setup in Settings → AI assistants use it), in a `.env` file next to `docker-compose.yml` (`ORIGIN=https://…`) or in `docker-compose.yml` itself. `BIND_ADDRESS=127.0.0.1` in `.env` keeps the port on the machine itself. On first visit you create the account for your server.

To install it on your phone, open it in the browser and choose "Add to Home Screen". Phones only offer this over HTTPS. [Private server with Tailscale](docs/private-server.md) walks through HTTPS for your own devices only, on a Mac, a home server or a small VPS, with nothing open to the internet. A reverse proxy with a certificate (for example Caddy or Traefik) also works.

Run it from a normal folder (not one reached through a symlink), so that Docker Desktop creates `./data` on your computer. Creating the folder first with `mkdir data` also works.

### Example data

To try the app without setting everything up, create your account and then add example habits (a gym rotation, a Spanish checklist with a timer, a deep-work target and two break habits), with a few weeks of history:

```sh
docker compose exec ittracks node scripts/seed-demo.mjs --today "$(date +%F)"  # if your day starts at 4 AM and it is past midnight, pass yesterday's date
docker compose restart
```

It only adds rows, never changes what you made, and refuses to run twice. On a server nobody has set up yet, add `--create-user name:password` to make the account too. Restart the container afterwards so it picks up the new rows. Outside Docker, run `make seed`.

## Templates

Any habit can be exported from its editor as a `.ittracks.json` file and imported on any ittracks server from the Habits tab. A template holds the habit, its Variants, schedule and Fill rules, and the Tasks it uses. It never contains your logs. The format is defined in `src/lib/template.ts` (version 6; versions 1 to 5 still import). A template can ask questions when it is added (which days, a starting weight, a time) and carries gallery details (category, days per week, minutes, equipment, Area). When a template's Task has the same name as one in your Library, your Task is used unless you choose "separate".

The Gallery (`/gallery`) ships ready-made templates from `src/lib/gallery/*.ittracks.json`. In those files, `{weight}` stands for the user's weight unit.

## License

[AGPL-3.0](LICENSE). You can self-host, modify and share it. If you run a modified version as a service for others, you must publish your changes.
