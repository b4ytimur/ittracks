// Fill an ittracks database with example Habits, Tasks and a few weeks of history,
// so a new install has something to click through.
//
//   node scripts/seed-demo.mjs [--db path] [--user name] [--today YYYY-MM-DD]
//
// In Docker:  docker compose exec ittracks node scripts/seed-demo.mjs
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
});

seedAll();
const count = (t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n;
console.log(
  `Added example data to "${account.username}" (today = ${today}, weights in ${weightUnit}). ` +
    `Database now has ${count("habit")} habits, ${count("task")} tasks, ${count("occurrence")} occurrences, ${count("entry")} entries.`,
);
