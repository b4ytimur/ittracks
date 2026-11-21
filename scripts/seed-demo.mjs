// Fill an ittracks database with example Habits, Tasks and a few weeks of history,
// so a new install has something to click through.
//
//   node scripts/seed-demo.mjs [--db path] [--user name] [--today YYYY-MM-DD]
//                              [--create-user name:password]
//
// In Docker:  docker compose exec ittracks node scripts/seed-demo.mjs
// The app must have started once (to create the tables). Restart it afterwards.
// --create-user makes a new account first, for a demo server nobody has set up yet.
//
// It only adds rows. It never changes or deletes anything that is already there,
// and it stops if the example Habits already exist. Tags with the same name are reused.
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split("--")
    .filter(Boolean)
    .map((a) => a.trim().split(/\s+/)),
);
const dbPath = args.db ?? process.env.DATABASE_PATH ?? "./data/ittracks.db";
const today =
  args.today ??
  new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TZ }).format(
    new Date(),
  );

const db = new Database(dbPath, { fileMustExist: true });
db.pragma("foreign_keys = ON");

// ---------- dates ----------
const toDays = (d) => Math.round(Date.parse(d + "T00:00:00Z") / 86_400_000);
const fromDays = (n) => new Date(n * 86_400_000).toISOString().slice(0, 10);
const addDays = (d, n) => fromDays(toDays(d) + n);
const weekday = (d) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7; // 0 = Monday
const at = (d, hour) =>
  Math.floor(Date.parse(`${d}T${String(hour).padStart(2, "0")}:00:00Z`) / 1000);

// Same random numbers every run, so the history looks the same each time.
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

// ---------- account ----------
if (args["create-user"]) {
  const [name, ...rest] = args["create-user"].split(":");
  const password = rest.join(":");
  if (!name || password.length < 8) {
    console.error(
      "--create-user needs name:password, with a password of at least 8 characters.",
    );
    process.exit(1);
  }
  if (db.prepare("SELECT 1 FROM account WHERE username = ?").get(name)) {
    console.error(
      `An account named "${name}" already exists. Nothing was added.`,
    );
    process.exit(1);
  }
  const { hash } = await import("@node-rs/argon2");
  const accountId = randomUUID();
  db.prepare(
    "INSERT INTO account (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
  ).run(accountId, name, await hash(password), Math.floor(Date.now() / 1000));
  db.prepare("INSERT INTO settings (account_id, data) VALUES (?, ?)").run(
    accountId,
    JSON.stringify({ weightUnit: "kg" }),
  );
  args.user = name;
}
const accounts = db.prepare("SELECT id, username FROM account").all();
const account = args.user
  ? accounts.find((a) => a.username === args.user)
  : accounts[0];
if (!account) {
  console.error(
    accounts.length
      ? `No account named "${args.user}". Accounts: ${accounts.map((a) => a.username).join(", ")}`
      : "No account yet. Open the app and create one first, then run this again.",
  );
  process.exit(1);
}
if (!args.user && accounts.length > 1) {
  console.error(
    `Several accounts exist; pick one with --user (${accounts.map((a) => a.username).join(", ")}).`,
  );
  process.exit(1);
}
const A = account.id;

const HABITS = [
  "Gym",
  "Spanish",
  "Deep work",
  "No smoking",
  "No doomscrolling",
  "Less coffee",
];
const clash = db
  .prepare(
    `SELECT name FROM habit WHERE account_id = ? AND name IN (${HABITS.map(() => "?").join(",")})`,
  )
  .all(A, ...HABITS);
if (clash.length) {
  console.error(
    `Example Habits already exist (${clash.map((h) => h.name).join(", ")}). Nothing was added.`,
  );
  process.exit(1);
}

const settings = db
  .prepare("SELECT data FROM settings WHERE account_id = ?")
  .get(A);
const weightUnit = settings
  ? (JSON.parse(settings.data).weightUnit ?? "kg")
  : "kg";
/** Weights below are in kg; shown in lb if that is the account's default. */
const w = (kg) =>
  weightUnit === "lb" ? Math.round((kg * 2.2046) / 5) * 5 : kg;

// ---------- statements ----------
const now = Math.floor(Date.now() / 1000);
const q = {
  task: db.prepare(
    `INSERT INTO task (id, account_id, name, notes, parent_task_id, rest_timer_enabled, rest_timer_seconds, sort_order, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  findTag: db.prepare(
    "SELECT id FROM tag WHERE account_id = ? AND lower(name) = lower(?)",
  ),
  tag: db.prepare("INSERT INTO tag (id, account_id, name) VALUES (?, ?, ?)"),
  taskTag: db.prepare(
    "INSERT INTO task_tag (task_id, tag_id, level) VALUES (?, ?, ?)",
  ),
  metric: db.prepare(
    `INSERT INTO metric (id, task_id, name, type, unit, choices, repeats, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  habit: db.prepare(
    `INSERT INTO habit (id, account_id, name, direction, notes, start_date, schedule, archived, sort_order, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ),
  variant: db.prepare(
    "INSERT INTO variant (id, habit_id, name, sort_order) VALUES (?, ?, ?, ?)",
  ),
  slot: db.prepare(
    `INSERT INTO slot (id, variant_id, task_id, fill_rule, sets, targets, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
  occurrence: db.prepare(
    `INSERT INTO occurrence (id, habit_id, variant_id, date, status, picks, notes, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  entry: db.prepare(
    'INSERT INTO entry (id, occurrence_id, task_id, "values", sort_order) VALUES (?, ?, ?, ?, ?)',
  ),
  slip: db.prepare(
    "INSERT INTO slip (id, habit_id, date, count, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ),
};

// ---------- helpers ----------
let taskOrder = 0;
/** Create a Task with Tags, Metrics and sub-tasks. Returns { id, m: {metric name: id}, subs: [ids] }. */
function makeTask({
  name,
  notes = null,
  rest = null,
  tags = {},
  metrics = [],
  subtasks = [],
}) {
  const id = randomUUID();
  q.task.run(
    id,
    A,
    name,
    notes,
    null,
    rest ? 1 : 0,
    rest ?? 90,
    taskOrder++,
    now,
  );
  for (const [tagName, level] of Object.entries(tags)) {
    let tagId = q.findTag.get(A, tagName)?.id;
    if (!tagId) {
      tagId = randomUUID();
      q.tag.run(tagId, A, tagName);
    }
    q.taskTag.run(id, tagId, level);
  }
  const m = {};
  metrics.forEach((x, i) => {
    m[x.name] = randomUUID();
    q.metric.run(
      m[x.name],
      id,
      x.name,
      x.type,
      x.unit ?? null,
      x.choices ? JSON.stringify(x.choices) : null,
      x.repeats ? 1 : 0,
      i,
    );
  });
  const subs = subtasks.map((s, i) => {
    const sid = randomUUID();
    q.task.run(sid, A, s, null, id, 0, 90, i, now);
    return sid;
  });
  return { id, m, subs };
}

const liftMetrics = [
  { name: "Weight", type: "number", unit: weightUnit, repeats: true },
  { name: "Reps", type: "count", repeats: true },
];
const lift = (name, tags, rest = 90, extra = {}) =>
  makeTask({ name, tags, rest, metrics: liftMetrics, ...extra });

function addOccurrence(
  habitId,
  variantId,
  date,
  status,
  picks = {},
  notes = null,
) {
  const id = randomUUID();
  q.occurrence.run(
    id,
    habitId,
    variantId,
    date,
    status,
    JSON.stringify(picks),
    notes,
    status === "done" ? at(date, 18) : null,
  );
  return id;
}
let entryOrder = 0;
const addEntry = (occId, taskId, values) =>
  q.entry.run(
    randomUUID(),
    occId,
    taskId,
    JSON.stringify(values),
    entryOrder++,
  );

const seedAll = db.transaction(() => {
  // ================= Gym =================
  const T = {
    bench: lift("Bench press", { chest: 3, triceps: 1, push: 3 }, 120, {
      notes: "Feet flat, shoulder blades pinned.",
      subtasks: ["Warm-up set with the bar"],
    }),
    incline: lift("Incline dumbbell press", {
      chest: 2,
      shoulders: 1,
      push: 2,
    }),
    ohp: lift("Overhead press", { shoulders: 3, triceps: 2, push: 3 }, 120),
    pushdown: lift("Triceps pushdown", { triceps: 3, push: 1 }, 60),
    dips: lift("Dips", { triceps: 3, chest: 2, push: 2 }, 90),
    lateral: lift("Lateral raise", { shoulders: 2 }, 60),
    squat: lift("Squat", { legs: 3, core: 1 }, 180, {
      subtasks: ["Mobility warm-up"],
    }),
    rdl: lift("Romanian deadlift", { legs: 2, back: 2 }, 120),
    legpress: lift("Leg press", { legs: 3 }, 120),
    pullup: lift("Pull-up", { back: 3, biceps: 1, pull: 3 }, 120),
    row: lift("Barbell row", { back: 3, biceps: 1, pull: 3 }, 120),
    curl: lift("Bicep curl", { biceps: 3, pull: 1 }, 60),
    hammer: lift("Hammer curl", { biceps: 2, pull: 1 }, 60),
    plank: makeTask({
      name: "Plank",
      tags: { core: 3 },
      rest: 60,
      metrics: [{ name: "Hold", type: "count", unit: "s", repeats: true }],
    }),
  };

  const gym = randomUUID();
  const vA = randomUUID();
  const vB = randomUUID();
  const start = addDays(today, -27);
  q.habit.run(
    gym,
    A,
    "Gym",
    "build",
    "Push day and pull-and-legs day, one rest day after each. Open slots are filled from the Library by Tag.",
    start,
    JSON.stringify({
      kind: "rotation",
      step: "variant",
      onMiss: "wait",
      weekdays: [],
      start,
      order: [
        { variantId: vA, restDays: 1 },
        { variantId: vB, restDays: 1 },
      ],
    }),
    0,
    now,
  );
  q.variant.run(vA, gym, "A · Push", 0);
  q.variant.run(vB, gym, "B · Pull & legs", 1);

  const slots = { A: [], B: [] };
  const addSlot = (
    v,
    key,
    { task = null, rule = null, sets, targets = {} },
  ) => {
    const id = randomUUID();
    const list = slots[key];
    q.slot.run(
      id,
      v,
      task?.id ?? null,
      rule
        ? JSON.stringify({ must: {}, mustNot: {}, prefer: [], ...rule })
        : null,
      sets,
      JSON.stringify(targets),
      list.length,
    );
    list.push({ id, task, rule });
  };
  addSlot(vA, "A", {
    task: T.bench,
    sets: 3,
    targets: { [T.bench.m.Reps]: 8 },
  });
  addSlot(vA, "A", { task: T.ohp, sets: 3, targets: { [T.ohp.m.Reps]: 8 } });
  addSlot(vA, "A", { rule: { must: { chest: 2 } }, sets: 3 });
  addSlot(vA, "A", { rule: { must: { triceps: 3 } }, sets: 3 });
  addSlot(vB, "B", {
    task: T.squat,
    sets: 3,
    targets: { [T.squat.m.Reps]: 5 },
  });
  addSlot(vB, "B", {
    task: T.pullup,
    sets: 3,
    targets: { [T.pullup.m.Reps]: 8 },
  });
  addSlot(vB, "B", {
    rule: { must: { back: 2 }, mustNot: { legs: 2 } },
    sets: 3,
  });
  addSlot(vB, "B", { rule: { must: { biceps: 2 } }, sets: 2 });
  addSlot(vB, "B", { rule: { must: { core: 3 } }, sets: 2 });

  // Starting weight (kg) and reps for each lift; weights climb a little each session.
  const base = {
    bench: [55, 8, 2.5],
    incline: [20, 10, 1],
    ohp: [35, 8, 1.25],
    pushdown: [25, 12, 1.25],
    dips: [0, 8, 0],
    lateral: [8, 12, 0.5],
    squat: [70, 5, 2.5],
    rdl: [60, 8, 2.5],
    legpress: [110, 10, 5],
    pullup: [0, 6, 0],
    row: [50, 8, 2.5],
    curl: [12, 10, 0.5],
    hammer: [12, 10, 0.5],
  };
  const done = { A: 0, B: 0 };
  const lastUsed = {}; // rotate open-slot picks so the Library gets used evenly
  // Every second day, one session done a day late, one skipped.
  const sessions = [];
  for (let d = start, i = 0; d < today; i++) {
    sessions.push(d);
    d = addDays(d, i === 6 ? 3 : 2);
  }
  sessions.forEach((date, i) => {
    const key = i % 2 === 0 ? "A" : "B";
    const v = key === "A" ? vA : vB;
    if (i === 9) {
      addOccurrence(gym, v, date, "skipped", {}, "Travelling");
      done[key]++;
      return;
    }
    const n = done[key]++;
    const picks = {};
    const used = new Set(
      slots[key].filter((s) => s.task).map((s) => s.task.id),
    );
    const items = slots[key].map((s) => {
      if (s.task) return s.task;
      const pool = Object.entries(T)
        .filter(([k]) => base[k] || k === "plank")
        .filter(([, t]) => !used.has(t.id))
        .filter(([k]) => matches(k, s.rule))
        .sort((a, b) => (lastUsed[a[0]] ?? -1) - (lastUsed[b[0]] ?? -1));
      const [k, t] = pool[0];
      lastUsed[k] = i;
      used.add(t.id);
      picks[s.id] = t.id;
      return t;
    });
    const occ = addOccurrence(
      gym,
      v,
      date,
      "done",
      picks,
      i === sessions.length - 1 ? "Felt strong today." : null,
    );
    items.forEach((t, j) => {
      const k = Object.keys(T).find((x) => T[x] === t);
      const sets = slots[key][j].rule ? (key === "B" && j === 3 ? 2 : 3) : 3;
      for (let s = 0; s < sets; s++) {
        if (k === "plank") {
          addEntry(occ, t.id, { [t.m.Hold]: 40 + n * 5 + s * -5 });
          continue;
        }
        const [kg, reps, step] = base[k];
        const tired = s === 2 && rand() < 0.5 ? 1 : 0;
        addEntry(occ, t.id, {
          [t.m.Weight]: kg === 0 ? null : w(kg + step * n),
          [t.m.Reps]: reps - tired + (kg === 0 ? Math.floor(n / 2) : 0),
        });
      }
      for (const sub of t.subs) addEntry(occ, sub, { done: true });
    });
  });

  function matches(k, rule) {
    const tagsOf = {
      bench: { chest: 3, triceps: 1 },
      incline: { chest: 2, shoulders: 1 },
      ohp: { shoulders: 3, triceps: 2 },
      pushdown: { triceps: 3 },
      dips: { triceps: 3, chest: 2 },
      lateral: { shoulders: 2 },
      squat: { legs: 3, core: 1 },
      rdl: { legs: 2, back: 2 },
      legpress: { legs: 3 },
      pullup: { back: 3, biceps: 1 },
      row: { back: 3, biceps: 1 },
      curl: { biceps: 3 },
      hammer: { biceps: 2 },
      plank: { core: 3 },
    }[k];
    return (
      Object.entries(rule.must ?? {}).every(
        ([t, min]) => (tagsOf[t] ?? 0) >= min,
      ) &&
      Object.entries(rule.mustNot ?? {}).every(
        ([t, max]) => (tagsOf[t] ?? 0) <= max,
      )
    );
  }

  // ================= Spanish (checklist + timer) =================
  const spanish = makeTask({
    name: "Spanish practice",
    tags: { language: 3 },
    metrics: [
      { name: "Study time", type: "duration", unit: "min" },
      { name: "New words", type: "count" },
      { name: "How it went", type: "choice", choices: ["Easy", "OK", "Hard"] },
    ],
    subtasks: [
      "Duolingo lesson",
      "Anki review",
      "Read one short article",
      "Listen to a podcast episode",
    ],
  });
  const sp = randomUUID();
  const spV = randomUUID();
  const spStart = addDays(today, -24);
  q.habit.run(
    sp,
    A,
    "Spanish",
    "build",
    "Monday to Saturday. Sunday is free.",
    spStart,
    JSON.stringify({
      kind: "weekly",
      days: Object.fromEntries([0, 1, 2, 3, 4, 5].map((d) => [String(d), spV])),
    }),
    1,
    now,
  );
  q.variant.run(spV, sp, "Daily", 0);
  q.slot.run(
    randomUUID(),
    spV,
    spanish.id,
    null,
    null,
    JSON.stringify({ [spanish.m["Study time"]]: 20 }),
    0,
  );
  for (let d = spStart, i = 0; d < today; d = addDays(d, 1), i++) {
    if (weekday(d) === 6) continue;
    if (i === 5 || i === 16) {
      addOccurrence(sp, spV, d, "missed");
      continue;
    }
    if (i === 11) {
      addOccurrence(sp, spV, d, "skipped", {}, "Sick");
      continue;
    }
    const occ = addOccurrence(sp, spV, d, "done");
    addEntry(occ, spanish.id, {
      [spanish.m["Study time"]]: 15 + Math.round(rand() * 20),
      [spanish.m["New words"]]: 5 + Math.round(rand() * 12),
      [spanish.m["How it went"]]: ["Easy", "OK", "OK", "Hard"][
        Math.floor(rand() * 4)
      ],
      _summary: true,
    });
    spanish.subs.forEach((sub, j) => {
      if (j < 2 || rand() < 0.5) addEntry(occ, sub, { done: true });
    });
  }

  // ================= Deep work (focus timer, 4 times a week) =================
  const focus = makeTask({
    name: "Focus block",
    notes: "Use the timer in Focus block mode: 25 min work, 5 min break.",
    tags: { focus: 3 },
    metrics: [
      { name: "Focused time", type: "duration", unit: "min" },
      { name: "What I worked on", type: "text" },
    ],
  });
  const dw = randomUUID();
  const dwV = randomUUID();
  const dwStart = addDays(today, -20);
  q.habit.run(
    dw,
    A,
    "Deep work",
    "build",
    "Four focus blocks a week, any days.",
    dwStart,
    JSON.stringify({
      kind: "frequency",
      times: 4,
      period: "week",
      variantId: dwV,
    }),
    2,
    now,
  );
  q.variant.run(dwV, dw, "Focus", 0);
  q.slot.run(
    randomUUID(),
    dwV,
    focus.id,
    null,
    null,
    JSON.stringify({ [focus.m["Focused time"]]: 100 }),
    0,
  );
  const topics = [
    "ittracks schedule engine",
    "Reading: Deep Work",
    "Thesis notes",
    "Side project UI",
    "Tax paperwork",
  ];
  for (let d = dwStart, i = 0; d < today; d = addDays(d, 1), i++) {
    if (weekday(d) >= 5 || i % 3 === 2) continue;
    const occ = addOccurrence(dw, dwV, d, "done");
    addEntry(occ, focus.id, {
      [focus.m["Focused time"]]: [50, 75, 100][Math.floor(rand() * 3)],
      [focus.m["What I worked on"]]: topics[i % topics.length],
      _summary: true,
    });
  }

  // ================= Break habits =================
  const smoke = randomUUID();
  q.habit.run(
    smoke,
    A,
    "No smoking",
    "break",
    "Quit on the 1st of October.",
    addDays(today, -50),
    null,
    3,
    now,
  );
  q.slip.run(
    randomUUID(),
    smoke,
    addDays(today, -41),
    2,
    "Party, two cigarettes",
    now,
  );
  q.slip.run(
    randomUUID(),
    smoke,
    addDays(today, -19),
    1,
    "Stressful deadline",
    now,
  );

  const scroll = randomUUID();
  q.habit.run(
    scroll,
    A,
    "No doomscrolling",
    "break",
    "No social feeds in bed.",
    addDays(today, -12),
    null,
    4,
    now,
  );
  q.slip.run(randomUUID(), scroll, addDays(today, -4), 1, null, now);

  // ================= Cues, stacking, levels, identities, slip context =================
  // Only when the database has these columns (added in migration 0001).
  const habitCols = db
    .prepare("PRAGMA table_info(habit)")
    .all()
    .map((c) => c.name);
  if (!habitCols.includes("cue")) return;

  const setHabit = db.prepare(
    `UPDATE habit SET cue = ?, streak_rule = ?, minimum_counts = 1, levels = ?, quick_done = ?, if_then = ?, triggers = ?
     WHERE id = ?`,
  );
  const cue = (time, place, afterHabitId = null, afterText = null) =>
    JSON.stringify({ time, place, afterHabitId, afterText });
  const levels = (minimum, target, stretch) =>
    JSON.stringify({ enabled: true, minimum, target, stretch });
  const triggers = JSON.stringify([
    "Bored",
    "Stressed",
    "Tired",
    "Social",
    "After a meal",
    "Coffee",
  ]);

  setHabit.run(
    cue("18:30", "the gym on my way home", null, "I leave work"),
    JSON.stringify({ kind: "grace", misses: 1, period: "week" }),
    levels(
      "Just the first two lifts",
      "Full session",
      "Full session plus an extra set each",
    ),
    0,
    null,
    null,
    gym,
  );
  setHabit.run(
    cue("07:30", "the kitchen table", null, "I pour my morning coffee"),
    JSON.stringify({ kind: "neverTwice" }),
    levels(
      "One Duolingo lesson",
      "20 minutes and the checklist",
      "40 minutes and a podcast",
    ),
    1,
    null,
    null,
    sp,
  );
  setHabit.run(
    cue("09:00", "my desk, phone in the drawer", sp, null),
    JSON.stringify({ kind: "consistency", days: 30 }),
    null,
    0,
    null,
    null,
    dw,
  );
  setHabit.run(
    cue(null, null),
    JSON.stringify({ kind: "strict" }),
    null,
    0,
    JSON.stringify({
      when: "want a cigarette",
      then: "do 10 push-ups and drink a glass of water",
      habitId: null,
    }),
    triggers,
    smoke,
  );
  setHabit.run(
    cue(null, null),
    JSON.stringify({ kind: "strict" }),
    null,
    0,
    JSON.stringify({
      when: "reach for my phone in bed",
      then: "read two pages of my book",
      habitId: null,
    }),
    triggers,
    scroll,
  );

  // Slot levels: Spanish study time 5 / 20 / 40 minutes, Gym rep targets 5 / 8 / 10.
  db.prepare(
    "UPDATE slot SET min_targets = ?, stretch_targets = ? WHERE variant_id = ?",
  ).run(
    JSON.stringify({ [spanish.m["Study time"]]: 5 }),
    JSON.stringify({ [spanish.m["Study time"]]: 40 }),
    spV,
  );
  for (const [t, min, max] of [
    [T.bench, 5, 10],
    [T.ohp, 5, 10],
    [T.squat, 3, 8],
    [T.pullup, 5, 10],
  ]) {
    db.prepare(
      "UPDATE slot SET min_targets = ?, stretch_targets = ? WHERE task_id = ?",
    ).run(
      JSON.stringify({ [t.m.Reps]: min }),
      JSON.stringify({ [t.m.Reps]: max }),
      t.id,
    );
  }

  // Some Spanish days were the minimum, some went past the target.
  const spDone = db
    .prepare(
      "SELECT id FROM occurrence WHERE habit_id = ? AND status = 'done' ORDER BY date",
    )
    .all(sp);
  const setLevel = db.prepare("UPDATE occurrence SET level = ? WHERE id = ?");
  spDone.forEach((o, i) => {
    if (i % 5 === 3) setLevel.run("minimum", o.id);
    else if (i % 7 === 2) setLevel.run("stretch", o.id);
    else setLevel.run("target", o.id);
  });
  db.prepare(
    "UPDATE occurrence SET level = 'target' WHERE habit_id IN (?, ?) AND status = 'done'",
  ).run(gym, dw);

  // Identities: each done Habit is a vote for who you want to be.
  const addIdentity = db.prepare(
    "INSERT INTO identity (id, account_id, statement, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const link = db.prepare(
    "INSERT INTO habit_identity (habit_id, identity_id) VALUES (?, ?)",
  );
  [
    ["I am someone who trains.", [gym]],
    ["I am a Spanish speaker.", [sp]],
    ["I am a non-smoker.", [smoke]],
    ["I protect my focus.", [dw, scroll]],
  ].forEach(([statement, habits], i) => {
    const iid = randomUUID();
    addIdentity.run(iid, A, statement, i, now);
    for (const h of habits) link.run(h, iid);
  });

  // Slip context, so the top triggers have something to show.
  const slipCtx = db.prepare(
    "UPDATE slip SET time = ?, place = ?, feeling = ?, with_whom = ? WHERE habit_id = ? AND date = ?",
  );
  slipCtx.run(
    "23:30",
    "A friend's party",
    "Social",
    "Friends",
    smoke,
    addDays(today, -41),
  );
  slipCtx.run(
    "16:00",
    "Office balcony",
    "Stressed",
    "Coworkers",
    smoke,
    addDays(today, -19),
  );
  slipCtx.run("00:15", "Bed", "Tired", "Alone", scroll, addDays(today, -4));
  q.slip.run(randomUUID(), scroll, addDays(today, -9), 1, null, now);
  slipCtx.run("23:50", "Bed", "Bored", "Alone", scroll, addDays(today, -9));

  // Cravings resisted with the if-then plan.
  const crave = db.prepare(
    "INSERT INTO craving (id, habit_id, date, time, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  [-15, -11, -8, -6, -3, -2, -1].forEach((d, i) =>
    crave.run(
      randomUUID(),
      smoke,
      addDays(today, d),
      ["13:10", "17:45", "21:00", "13:30"][i % 4],
      now,
    ),
  );
  [-7, -5, -2].forEach((d) =>
    crave.run(randomUUID(), scroll, addDays(today, d), "23:15", now),
  );

  // ================= Areas, Collections, rewards, prep, reduce mode... =================
  // Only when the database has these columns (migrations 0002 and 0003).
  const cols = (t) =>
    db
      .prepare(`PRAGMA table_info(${t})`)
      .all()
      .map((c) => c.name);
  if (!cols("habit").includes("area_id") || !cols("habit").includes("reward"))
    return;

  // Areas group Habits and Tasks.
  const addArea = db.prepare(
    "INSERT INTO area (id, account_id, name, color, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const areas = {};
  [
    ["fitness", "Fitness", "#dc2626", "💪"],
    ["learning", "Learning", "#2563eb", "📚"],
    ["focus", "Focus", "#7c3aed", "🎯"],
    ["health", "Health", "#16a34a", "🌱"],
  ].forEach(([k, name, color, icon], i) => {
    areas[k] = randomUUID();
    addArea.run(areas[k], A, name, color, icon, i);
  });
  const habitArea = db.prepare("UPDATE habit SET area_id = ? WHERE id = ?");
  const taskArea = db.prepare(
    "UPDATE task SET area_id = ? WHERE id = ? OR parent_task_id = ?",
  );
  habitArea.run(areas.fitness, gym);
  habitArea.run(areas.learning, sp);
  habitArea.run(areas.focus, dw);
  habitArea.run(areas.health, smoke);
  habitArea.run(areas.focus, scroll);
  for (const t of Object.values(T)) taskArea.run(areas.fitness, t.id, t.id);
  taskArea.run(areas.learning, spanish.id, spanish.id);
  taskArea.run(areas.focus, focus.id, focus.id);

  // Collections: one hand-picked, two saved filters, one nested.
  const addCollection = db.prepare(
    "INSERT INTO collection (id, account_id, name, parent_id, filter, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const addToCollection = db.prepare(
    "INSERT INTO collection_task (collection_id, task_id) VALUES (?, ?)",
  );
  const gymCol = randomUUID();
  addCollection.run(gymCol, A, "Gym", null, null, 0);
  const pushCol = randomUUID();
  addCollection.run(pushCol, A, "Push day favourites", gymCol, null, 0);
  for (const t of [T.bench, T.incline, T.ohp, T.dips, T.pushdown])
    addToCollection.run(pushCol, t.id);
  const filter = (tags) => JSON.stringify({ tags, areaId: null, text: "" });
  addCollection.run(
    randomUUID(),
    A,
    "Leg exercises",
    gymCol,
    filter(["legs"]),
    1,
  );
  addCollection.run(randomUUID(), A, "Arms", null, filter(["biceps"]), 1);

  // Steppers: weight moves in plates, reps one at a time.
  const setStep = db.prepare("UPDATE metric SET step = ? WHERE id = ?");
  for (const t of Object.values(T)) {
    if (t.m.Weight) setStep.run(weightUnit === "lb" ? 5 : 2.5, t.m.Weight);
    if (t.m.Reps) setStep.run(1, t.m.Reps);
    if (t.m.Hold) setStep.run(5, t.m.Hold);
  }
  setStep.run(5, spanish.m["Study time"]);
  setStep.run(25, focus.m["Focused time"]);

  // Reframes, temptation bundles, prep lists, rewards, progression.
  const setP2 = db.prepare(
    `UPDATE habit SET reframe = ?, bundle = ?, prep = ?, reward = ?, cost = ?, "limit" = ?, progression = ?, progression_from = ?
     WHERE id = ?`,
  );
  const j = (x) => (x ? JSON.stringify(x) : null);
  setP2.run(
    "I get to train. My body gets stronger every session.",
    j({ reward: "Listen to my favourite podcast", strict: true }),
    j([
      "Pack the gym bag the night before",
      "Fill the water bottle",
      "Shoes by the door",
    ]),
    j({
      celebrate: true,
      message: "Session done. Protein shake time.",
      jar: { amount: 5, unit: "€", goal: "New lifting shoes" },
    }),
    null,
    null,
    j({ after: 4, by: 5, unit: "percent" }),
    null,
    gym,
  );
  setP2.run(
    "I get to talk with my grandmother in her own language.",
    j({ reward: "A really good coffee", strict: false }),
    j(["Phone on Do Not Disturb"]),
    j({ celebrate: true, message: "¡Muy bien!", jar: null }),
    null,
    null,
    j({ after: 5, by: 5, unit: "amount" }),
    null,
    sp,
  );
  setP2.run(
    null,
    null,
    j(["Close chat apps", "Phone in the drawer", "Water on the desk"]),
    j({
      celebrate: true,
      message: "Deep work block done.",
      jar: { amount: 1, unit: "block", goal: "a free afternoon on Friday" },
    }),
    null,
    null,
    null,
    null,
    dw,
  );
  setP2.run(
    "I'm free from cigarettes, not giving something up.",
    null,
    null,
    null,
    j({ amount: 0.4, unit: "€", perDay: 15 }),
    null,
    null,
    null,
    smoke,
  );

  // Prep already ticked this morning for today's Gym session.
  db.prepare(
    "INSERT INTO prep_tick (habit_id, date, item) VALUES (?, ?, ?)",
  ).run(gym, today, "Pack the gym bag the night before");

  // Reduce mode: a break habit with a daily limit that tapers down each week.
  const coffee = randomUUID();
  const coffeeStart = addDays(today, -21);
  q.habit.run(
    coffee,
    A,
    "Less coffee",
    "break",
    "Cutting down slowly, not quitting.",
    coffeeStart,
    null,
    5,
    now,
  );
  setHabit.run(
    cue(null, null),
    JSON.stringify({ kind: "strict" }),
    null,
    0,
    JSON.stringify({
      when: "want a third coffee",
      then: "have a glass of sparkling water",
      habitId: null,
    }),
    JSON.stringify(["Tired", "Afternoon slump", "Meeting", "Habit"]),
    coffee,
  );
  setP2.run(
    null,
    null,
    null,
    null,
    j({ amount: 3.2, unit: "€", perDay: 4 }),
    j({
      max: 4,
      period: "day",
      taper: { by: 1, every: "week", floor: 1 },
      start: coffeeStart,
    }),
    null,
    null,
    coffee,
  );
  habitArea.run(areas.health, coffee);
  for (let d = coffeeStart, i = 0; d < today; d = addDays(d, 1), i++) {
    const allowed = Math.max(1, 4 - Math.floor(i / 7));
    const cups = Math.max(
      1,
      allowed - (rand() < 0.4 ? 1 : 0) + (rand() < 0.12 ? 1 : 0),
    );
    q.slip.run(randomUUID(), coffee, d, cups, null, now);
    slipCtx.run(
      "15:00",
      "Office",
      rand() < 0.5 ? "Tired" : "Afternoon slump",
      "Coworkers",
      coffee,
      d,
    );
  }
  q.slip.run(randomUUID(), coffee, today, 1, "Morning cup", now);

  // Settings the app would otherwise ask about on first visit. Only fills keys that are unset.
  const row = db
    .prepare("SELECT data FROM settings WHERE account_id = ?")
    .get(A);
  const data = row ? JSON.parse(row.data) : { weightUnit };
  const fill = {
    dayStart: "04:00",
    ranges: [
      { name: "Morning", start: "06:00", end: "12:00" },
      { name: "Afternoon", start: "12:00", end: "18:00" },
      { name: "Evening", start: "18:00", end: "23:00" },
    ],
    areasSeeded: true,
    groupByArea: true,
    pinned: [gym, sp],
    // A few saved views to switch between (customizable views, PR #10).
    views: (() => {
      const vs = (x) => ({
        areas: [],
        direction: "all",
        status: "all",
        identity: null,
        habit: null,
        query: "",
        tags: [],
        collection: null,
        archived: false,
        sort: "",
        group: "none",
        ...x,
      });
      return {
        template: "standard",
        saved: [
          {
            id: randomUUID(),
            name: "Fitness",
            page: "today",
            state: vs({ areas: [areas.fitness] }),
          },
          {
            id: randomUUID(),
            name: "By part of day",
            page: "today",
            state: vs({ group: "part", sort: "cue" }),
          },
          {
            id: randomUUID(),
            name: "Break habits",
            page: "habits",
            state: vs({ direction: "break" }),
          },
          {
            id: randomUUID(),
            name: "Push day favourites",
            page: "library",
            state: vs({ collection: pushCol }),
          },
          {
            id: randomUUID(),
            name: "Slips only",
            page: "history",
            state: vs({ status: "slip" }),
          },
        ],
      };
    })(),
    // Stats boards (PR #14). Stored like the app stores them; missing card fields get defaults on read.
    stats: (() => {
      const card = (c) => ({ id: randomUUID(), ...c });
      const tile = { chart: "tile" };
      const wide = (chart, x = {}) => ({ chart, size: "wide", ...x });
      const board = (name, template, cards, extra = {}) => ({
        id: randomUUID(),
        name,
        cards,
        range: "30d",
        filter: {
          areas: [],
          tags: [],
          habit: null,
          identity: null,
          direction: "all",
        },
        template,
        ...extra,
      });
      const reps = randomUUID();
      const outcomes = { source: "outcomes" };
      const studyTime = { source: "field", name: "Study time" };
      const boards = [
        board("Overview", "overview", [
          card({
            title: "Done this week",
            what: outcomes,
            perLog: "done",
            overTime: "sum",
            range: "week",
            compare: { previous: true },
            look: tile,
          }),
          card({
            title: "Consistency",
            what: outcomes,
            perLog: "rate",
            overTime: "avg",
            compare: { previous: true },
            look: tile,
          }),
          card({
            title: "Target met",
            what: outcomes,
            perLog: "targetMet",
            overTime: "avg",
            look: tile,
          }),
          card({
            title: "Slips this week",
            what: { source: "slips" },
            perLog: "count",
            overTime: "sum",
            range: "week",
            compare: { previous: true },
            look: tile,
          }),
          card({
            title: "Consistency per habit",
            what: outcomes,
            perLog: "rate",
            overTime: "avg",
            bucket: "all",
            split: "habit",
            look: wide("bars", { top: 12 }),
          }),
          card({
            title: "Streaks",
            what: outcomes,
            perLog: "done",
            look: wide("streak"),
          }),
          card({
            title: "Levels reached",
            what: outcomes,
            perLog: "done",
            overTime: "sum",
            split: "level",
            look: wide("breakdown"),
          }),
          card({
            title: "Done per day",
            what: outcomes,
            perLog: "done",
            overTime: "sum",
            range: "90d",
            look: { chart: "calendar", size: "full" },
          }),
        ]),
        board("Gym", "gym", [
          card({
            title: "Sessions per week",
            what: outcomes,
            perLog: "done",
            overTime: "sum",
            bucket: "week",
            range: "90d",
            filter: { habits: [gym] },
            look: wide("bars"),
          }),
          card({
            title: "Hard sets per muscle group this week",
            what: { source: "task" },
            perLog: "hardSets",
            overTime: "sum",
            bucket: "all",
            split: "tag",
            range: "week",
            compare: { goal: 10, goalMax: 20 },
            look: wide("bars", { top: 12 }),
          }),
          card({
            title: "Volume per week",
            what: { source: "task" },
            perLog: "volume",
            overTime: "sum",
            bucket: "week",
            range: "90d",
            look: wide("bars"),
          }),
          card({
            title: "Bench press: estimated 1RM",
            what: { source: "task", taskId: T.bench.id },
            perLog: "e1rm",
            overTime: "max",
            bucket: "session",
            range: "90d",
            look: wide("line"),
          }),
          card({
            title: "Squat: estimated 1RM",
            what: { source: "task", taskId: T.squat.id },
            perLog: "e1rm",
            overTime: "max",
            bucket: "session",
            range: "90d",
            look: wide("line"),
          }),
          card({
            title: "Bench press: records",
            what: { source: "task", taskId: T.bench.id },
            perLog: "e1rm",
            overTime: "max",
            range: "all",
            look: { chart: "records" },
          }),
          card({
            title: "Reps per session",
            what: { source: "task" },
            perLog: `custom:${reps}`,
            overTime: "sum",
            bucket: "session",
            range: "90d",
            look: wide("line"),
          }),
          card({
            title: "Volume per exercise",
            what: { source: "task" },
            perLog: "volume",
            overTime: "sum",
            split: "task",
            look: wide("table"),
          }),
          card({
            title: "Bench press: recent sessions",
            what: { source: "task", taskId: T.bench.id },
            perLog: "volume",
            overTime: "sum",
            filter: { habits: [gym] },
            look: wide("sessions", { top: 5 }),
          }),
        ]),
        board("Learning", "learner", [
          card({
            title: "Study time this week",
            what: studyTime,
            perLog: "value",
            overTime: "sum",
            range: "week",
            compare: { previous: true },
            look: tile,
          }),
          card({
            title: "New words so far",
            what: { source: "field", name: "New words" },
            perLog: "value",
            overTime: "sum",
            range: "all",
            compare: { running: true },
            look: tile,
          }),
          card({
            title: "Focused time per week",
            what: { source: "field", name: "Focused time" },
            perLog: "value",
            overTime: "sum",
            bucket: "week",
            range: "90d",
            compare: { goal: 240 },
            look: wide("bars"),
          }),
          card({
            title: "Study time per week",
            what: studyTime,
            perLog: "value",
            overTime: "sum",
            bucket: "week",
            range: "90d",
            look: wide("bars"),
          }),
          card({
            title: "Study time by weekday",
            what: studyTime,
            perLog: "value",
            overTime: "sum",
            bucket: "all",
            split: "weekday",
            range: "90d",
            look: wide("bars"),
          }),
          card({
            title: "How Spanish went",
            what: { source: "field", name: "How it went" },
            perLog: "option",
            overTime: "count",
            split: "option",
            range: "90d",
            look: wide("breakdown"),
          }),
        ]),
        board(
          "Quitting",
          "quitter",
          [
            card({
              title: "Days clean",
              what: { source: "slips" },
              perLog: "count",
              look: wide("streak"),
            }),
            card({
              title: "Money saved",
              what: { source: "money" },
              perLog: "saved",
              overTime: "sum",
              range: "all",
              look: tile,
            }),
            card({
              title: "Cravings resisted",
              what: { source: "cravings" },
              perLog: "count",
              overTime: "sum",
              compare: { previous: true },
              look: tile,
            }),
            card({
              title: "Slips per week",
              what: { source: "slips" },
              perLog: "count",
              overTime: "sum",
              bucket: "week",
              split: "habit",
              range: "90d",
              look: wide("bars", { stacked: true }),
            }),
            card({
              title: "When slips happen",
              what: { source: "slips" },
              perLog: "count",
              overTime: "sum",
              range: "90d",
              look: wide("pattern"),
            }),
          ],
          {
            filter: {
              areas: [],
              tags: [],
              habit: null,
              identity: null,
              direction: "break",
            },
            range: "90d",
          },
        ),
      ];
      return {
        boards,
        open: "last",
        last: boards[0].id,
        measures: [
          {
            id: reps,
            name: "Total reps",
            formula: "[Reps]",
            per: "set",
            combine: "sum",
            unit: "reps",
          },
        ],
        offered: ["overview", "gym", "learner", "quitter"],
      };
    })(),
  };
  for (const [k, v] of Object.entries(fill)) {
    if (
      data[k] === undefined ||
      (Array.isArray(data[k]) && data[k].length === 0)
    )
      data[k] = v;
  }
  db.prepare(
    "INSERT INTO settings (account_id, data) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET data = excluded.data",
  ).run(A, JSON.stringify(data));
});

seedAll();
const count = (t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
console.log(
  `Added example data to "${account.username}" (today = ${today}, weights in ${weightUnit}). ` +
    `Database now has ${count("habit")} habits, ${count("task")} tasks, ${count("occurrence")} occurrences, ${count("entry")} entries.`,
);
