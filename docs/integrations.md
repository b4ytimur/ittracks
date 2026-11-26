# Integrations

Everything here lives in [Settings](settings.md), under **Other apps** and **Data**.

## Keys

A key lets something other than the app use your account: a Shortcut, a quick-log link, an AI assistant or a backup script.

1. Under **Settings → Keys**, press **+ Key** and give it a **Name** ("iPhone Shortcuts", "Claude").
2. Under **It may**, tick only the access it needs:

   | Access | Allows |
   | --- | --- |
   | **Read** | Read habits, logs and stats (values only, no notes) |
   | **Log** | Log, skip and undo, and add slips |
   | **Notes** | Read and write notes and the journal |
   | **Export** | Download a full export |
   | **Edit** | Create and change habits, Tasks, templates and views (an assistant's setup, and bulk changes) |

3. Under **For**, choose **Every habit, now and later** or **Only some habits**. A key limited to some habits can't download an export.
4. **Make the key**, and copy it now. It is shown only once; the server keeps only its hash. Treat it like a password.

For a Shortcut, Read and Log are enough. For an AI assistant, Read lets it analyse; add Log if it may log for you, Edit if it may set up and change habits with you, and Notes only if it may read your notes and journal.

The key list shows when each key was made and last used. **Revoke** stops a key at once.

Every change, from the app or a key, also goes into an append-only event log that records where it came from (the app, a key, a link, the MCP server, a reminder or an import).

## Quick-log links

A link that logs as soon as it is opened: from a Shortcut, Siri, an NFC tag, a QR code or a home screen bookmark. The **Quick-log links** section builds one for you.

- `/q/<habit id>` opens the habit's quick log. Signed in, it works without a key, and what it did is said on Today, with Undo. When the habit isn't due, Today offers **Log it anyway**. A link opened with a key alone answers with one sentence.
- `?go=1` logs "same as last time" at once.
- `?value=250` adds 250 to the habit's number (or replaces it, when the field is set to [replace a second log](tasks.md#fields-metrics)), and marks the habit done once the target is reached. Add `&field=Minutes` when the habit has several numbers. A [tracker](habits.md#trackers) logs any day.
- Without a value, the link marks the habit done (copying your last log when it has Tasks).
- For a break habit, the link logs a slip (`?value=3` logs three), or a resisted craving with `&craving=1`.
- `&key=itk_…` lets it work without signing in.
- `&reply=text` answers with one plain line ("Drink water: 6 of 8 glasses") that Siri can read out.

Programs can POST to the same address with the key in an `Authorization: Bearer itk_…` header instead of the link. Opening the same link twice within a few seconds logs once.

Anyone with a link that has a key in it can log with it. Keep such links private, and revoke the key if one gets out.

### iPhone: Shortcuts, Siri and NFC

1. In Shortcuts, make a new shortcut with **Get Contents of URL** and paste the link.
2. To be asked for the amount each time, add **Ask for Input** (Number) first, and put its answer in place of the value in the link.
3. Add **Show Result** or **Speak Text** with the contents, and turn on **Answer in plain text** on the settings page.
4. Name it like you would say it ("Log water") to use it with Siri. For an NFC tag: Automation → NFC → run this shortcut.

### Android, QR codes and home screen

An app such as HTTP Shortcuts or Tasker can call the link from a home screen button or an NFC tag. An NFC tag or QR code that just holds the link opens it in the browser, which logs and shows the result. Habits with **Add to home screen shortcuts** ticked appear when you long-press the app icon.

## AI assistants (MCP)

Claude, Cursor and other assistants that support MCP can read your habits, run statistics on your server (trends, before/after tests, weekday patterns, correlations, unusual days, each with its sample size and caveats) and point to the logs their answers rest on. They can also set up habits with you: you say what you want to start, they suggest a few ways to do it, and they make the one you pick. They log and change things only when you ask.

### Set it up

1. Download `ittracks-mcp.mjs` from **Settings → AI assistants** (it is also at `https://<your server>/ittracks-mcp.mjs`, and in the repository at `static/ittracks-mcp.mjs`). It needs Node.js 18 or newer and nothing else.
2. Make a key for it: **Read**, plus **Log** if it may log for you, **Notes** if it may search your notes, and **Edit** if it may set up and change habits (setup and bulk changes need a key for every habit).
3. Add it to your assistant, replacing `/path/to/` with where you saved the file, and using your server's address and key. The settings page fills both in for you.

**Claude Desktop**: Settings → Developer → Edit Config, and add:

```json
{
  "mcpServers": {
    "ittracks": {
      "command": "node",
      "args": ["/path/to/ittracks-mcp.mjs"],
      "env": { "ITTRACKS_URL": "http://localhost:3000", "ITTRACKS_KEY": "itk_…" }
    }
  }
}
```

Restart Claude Desktop after saving.

**Claude Code**:

```sh
claude mcp add ittracks -e ITTRACKS_URL=http://localhost:3000 -e ITTRACKS_KEY=itk_… -- node /path/to/ittracks-mcp.mjs
```

**Other MCP clients** (Cursor and others): run `node /path/to/ittracks-mcp.mjs` as a stdio server with the two variables `ITTRACKS_URL` and `ITTRACKS_KEY` set.

`ITTRACKS_URL` must be reachable from the computer the assistant runs on: `http://localhost:3000` when the server runs on the same machine.

Claude on the web and on phones, and ChatGPT, can only reach a server on the internet over HTTPS with sign-in (a remote MCP server). ittracks doesn't offer that yet, so use Claude Desktop, Claude Code or another assistant that runs on your computer.

### What it can do

The tools come from your server, so the file never needs updating, and a key only sees the tools it may use.

- **Understand**: `describe` explains what is tracked; `today`, `logs`, `values` and `record` read days, logs and single records.
- **Analyse**: `habit_summary`, `series` and `correlate` do the maths on the server; `stats_describe`, `stats_trend`, `stats_compare` and `stats_groups` run real statistics (confidence intervals, trends with a change point, t-tests, Mann-Whitney, Fisher's exact test, Kruskal-Wallis and ANOVA, effect sizes), each with n, a plain reading and caveats. Answers carry refs (`log:<id>`, `day:<date>`…) the assistant can cite and open.
- **Log** (needs Log): `log_done`, `log_value`, `log_task`, `log_skip`, `log_undo`, `log_slip`, `remove_slip`, `log_craving`, `log_plan` (what Today and the log screen do without logging: tick tomorrow's prep, start a resting rotation early, swap or re-pick a day's Task), and `bulk` / `bulk_undo` ([Bulk editing](bulk-editing.md)).
- **Notes** (needs Notes): `search_notes`, `write_day_note`, `write_log_note`.
- **Set up** (needs Edit): `setup_guide`, `setup_read`, `setup` and `setup_undo`. See below.
- `events` reads the event log.

### Set things up by talking

Tell the assistant what you want ("I want to start learning Spanish", "make my gym days A and B with a rest day between", "move my evening habits into one routine"). It asks what it needs, suggests two or three ways to do it, and once you pick one it shows you exactly what it will make before anything is saved. Nothing changes until you say yes.

What it can make or change is everything the editors and Settings can: habits and the habits inside them (groups, routines), Variants and schedules (fixed days, N times a week, every N days, rotations with rest days, weekly cycles, phases for a program), Tasks with their fields (from a Task type or from scratch), steps and Tasks inside them, choice options, targets and levels, cues, reminders, break-habit plans, templates (from the Gallery, from scratch, or kept from one of your habits), views, measures (formulas such as `[Weight] * [Reps]`), Stats boards and cards and the number a habit shows on Today, your day start and parts of the day, units, groupings and tags, Task types, starter packs, Areas, identities, pauses and vacations, Library Collections, home screen shortcuts, deleting a habit or Task, and answering Today's suggestion to raise a habit's targets (Raise or Not yet). Everything goes through the same checks as the editors, so it can't save anything you couldn't save by hand.

It can't change your password, keys or reminder devices, and it can't restore a backup over your data: those stay yours to do in Settings.

A change made this way can be undone for a day: ask the assistant to undo it. A deleted habit or Task comes back only within a day, as in the app, so the assistant suggests archiving instead. Every change also shows in the event log as coming from the assistant. In Claude Desktop, the **start_habit** prompt starts this conversation for you.

What the assistant reads is sent to its provider, so pick the key's access with that in mind. Try asking it for a weekly review, whether your sleep affects your training, or whether a new routine made a difference.

## Export and import

**Settings → Data**:

- **Everything (JSON)**: a full backup of habits, Tasks, every log, slip, note and setting. It imports here or on another ittracks server, keeping ids so links keep working.
- **Tables (CSV)**: a zip of tidy tables (one row per logged value, per habit day, per habit and per field) with a README that explains every column. For Excel, Google Sheets, Python, R or an AI chat.

### Restore

Under **Restore from a backup**, pick a JSON export. It shows who made it, when, and what it holds. Press **Replace my data**, then **Download it, then replace**: what is here now is downloaded first, and if that fails nothing is replaced.

Restoring replaces every habit, Task, log, note and setting in the account. Your login, keys and reminder devices stay. To go back, restore the file it downloaded. Large files need the server's `BODY_SIZE_LIMIT` raised (the Docker image sets 50M).

### From a script

A key with **Export** access downloads the same files, for example for a nightly backup:

```sh
curl -H "Authorization: Bearer itk_…" "http://localhost:3000/api/v1/export?format=csv" -o ittracks.zip
```

Use `format=json` for the full backup. Without **Notes** access, notes, journal entries and text values are left out of the export.

Other exports: one habit as a [template](templates.md), the [journal as Markdown](notes-and-journal.md#export-to-obsidian), and [every log as CSV](stats.md#download-your-logs) from Stats.

The actions behind the MCP server (`/api/v1/actions`) are still changing and aren't documented for other uses yet.
