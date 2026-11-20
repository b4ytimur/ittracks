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
| Slip | A logged lapse of a break habit; resets its counter to 0 |

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

Run it from a normal folder (not one reached through a symlink), so that Docker Desktop creates `./data` on your computer. Creating the folder first with `mkdir data` also works.

### Example data

To try the app without setting everything up, create your account and then add example habits (a gym rotation, a Spanish checklist with a timer, a deep-work target and two break habits), with a few weeks of history:

```sh
docker compose exec ittracks node scripts/seed-demo.mjs --today "$(date +%F)"
```

It only adds rows, never changes what you made, and refuses to run twice. Outside Docker, run `node scripts/seed-demo.mjs`.

## Templates

Any habit can be exported from its editor as a `.ittracks.json` file and imported on any ittracks server from the Habits tab. A template holds the habit, its Variants, schedule and Fill rules, and the Tasks it uses. It never contains your logs. The format is defined in `src/lib/template.ts` (version 1).

## License

[AGPL-3.0](LICENSE). You can self-host, modify and share it. If you run a modified version as a service for others, you must publish your changes.
