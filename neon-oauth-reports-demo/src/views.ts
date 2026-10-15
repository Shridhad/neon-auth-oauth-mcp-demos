// Pure rendering + dummy-data code (no env, no server) so it can be previewed in isolation.

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"'`]/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- deterministic dummy data ----------

export interface Todo {
  title: string;
  createdAt: number;
  closedAt: number | null;
}

export interface Dataset {
  weeks: { label: string; created: number; completed: number }[];
  buckets: { label: string; count: number }[];
  weekdays: { label: string; total: number; rate: number }[];
  slowest: { title: string; createdAt: number; closedAt: number; durationMs: number }[];
  kpis: {
    total: number;
    completed: number;
    open: number;
    completionRate: number;
    avgPerWeek: number;
    medianCloseMs: number;
    longestOpenMs: number;
    longestOpenTitle: string;
  };
}

const H = 3600_000;
const D = 24 * H;
const WEEKS = 8;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// mulberry32
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERBS = ['Draft', 'Review', 'Book', 'Fix', 'Update', 'Send', 'Plan', 'Refactor', 'Call', 'Order', 'Write', 'Prepare', 'Renew', 'Clean up'];
const OBJECTS = [
  'quarterly roadmap', 'dentist appointment', 'flaky CI test', 'team offsite agenda', 'expense report',
  'onboarding doc', 'API rate limits', 'passport renewal', 'grocery list', 'launch checklist',
  'customer follow-up', 'database backup policy', 'conference talk outline', 'standup notes', 'invoice #',
  'dashboard filters', 'garden irrigation', 'security review', 'blog post draft', 'changelog',
];

// Time-to-close buckets (ms ranges) with sampling weights.
const BUCKET_DEFS: { label: string; min: number; max: number; w: number }[] = [
  { label: '<1h', min: 5 * 60_000, max: H, w: 14 },
  { label: '1-6h', min: H, max: 6 * H, w: 24 },
  { label: '6-24h', min: 6 * H, max: 24 * H, w: 22 },
  { label: '1-3d', min: D, max: 3 * D, w: 20 },
  { label: '3-7d', min: 3 * D, max: 7 * D, w: 12 },
  { label: '>7d', min: 7 * D, max: 20 * D, w: 8 },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (t: number) => {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

/** Same `sub` + same UTC day => identical dataset. */
export function generateDataset(sub: string, nowMs = Date.now()): Dataset {
  const anchor = Math.floor(nowMs / D) * D;
  const rand = prng(hashSeed(sub));
  const weights = BUCKET_DEFS.map((b) => b.w);
  const wSum = weights.reduce((a, b) => a + b, 0);
  // Per-user personality: how many todos and how diligent.
  const total = 70 + Math.floor(rand() * 90);
  const diligence = 0.6 + rand() * 0.3;
  const used = new Set<string>();

  const todos: Todo[] = [];
  for (let i = 0; i < total; i++) {
    let title = '';
    for (let tries = 0; tries < 20; tries++) {
      const o = OBJECTS[Math.floor(rand() * OBJECTS.length)];
      title = `${VERBS[Math.floor(rand() * VERBS.length)]} ${o}${o.endsWith('#') ? 1000 + Math.floor(rand() * 9000) : ''}`;
      if (!used.has(title)) break;
    }
    used.add(title);
    const createdAt = anchor - Math.floor(rand() * WEEKS * 7 * D) - Math.floor(rand() * D);
    let closedAt: number | null = null;
    if (rand() < diligence) {
      let pick = rand() * wSum;
      let b = BUCKET_DEFS[0];
      for (let k = 0; k < BUCKET_DEFS.length; k++) {
        pick -= weights[k];
        if (pick <= 0) { b = BUCKET_DEFS[k]; break; }
      }
      const c = createdAt + b.min + rand() * (b.max - b.min);
      if (c <= anchor) closedAt = Math.round(c);
    }
    todos.push({ title, createdAt, closedAt });
  }

  const start = anchor - WEEKS * 7 * D;
  const weekIdx = (t: number) => Math.min(WEEKS - 1, Math.floor((t - start) / (7 * D)));
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({
    label: fmtDay(start + i * 7 * D),
    created: 0,
    completed: 0,
  }));
  const dayStats = WEEKDAYS.map(() => ({ total: 0, done: 0 }));
  const bucketCounts = BUCKET_DEFS.map(() => 0);
  const closed: { title: string; createdAt: number; closedAt: number; durationMs: number }[] = [];

  for (const t of todos) {
    if (t.createdAt >= start) weeks[weekIdx(t.createdAt)].created++;
    const wd = (new Date(t.createdAt).getUTCDay() + 6) % 7;
    dayStats[wd].total++;
    if (t.closedAt !== null) {
      dayStats[wd].done++;
      if (t.closedAt >= start) weeks[weekIdx(t.closedAt)].completed++;
      const durationMs = t.closedAt - t.createdAt;
      closed.push({ title: t.title, createdAt: t.createdAt, closedAt: t.closedAt, durationMs });
      const bi = BUCKET_DEFS.findIndex((b) => durationMs < b.max);
      bucketCounts[bi === -1 ? BUCKET_DEFS.length - 1 : bi]++;
    }
  }

  const durations = closed.map((c) => c.durationMs).sort((a, b) => a - b);
  const median = durations.length
    ? durations.length % 2
      ? durations[(durations.length - 1) / 2]
      : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
    : 0;
  const open = todos.filter((t) => t.closedAt === null).sort((a, b) => a.createdAt - b.createdAt);

  return {
    weeks,
    buckets: BUCKET_DEFS.map((b, i) => ({ label: b.label, count: bucketCounts[i] })),
    weekdays: WEEKDAYS.map((label, i) => ({
      label,
      total: dayStats[i].total,
      rate: dayStats[i].total ? dayStats[i].done / dayStats[i].total : 0,
    })),
    slowest: closed.sort((a, b) => b.durationMs - a.durationMs).slice(0, 10),
    kpis: {
      total: todos.length,
      completed: closed.length,
      open: open.length,
      completionRate: todos.length ? closed.length / todos.length : 0,
      avgPerWeek: todos.length / WEEKS,
      medianCloseMs: median,
      longestOpenMs: open.length ? anchor - open[0].createdAt : 0,
      longestOpenTitle: open[0]?.title ?? '',
    },
  };
}

// ---------- formatting ----------

export function fmtDuration(ms: number): string {
  if (ms < H) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 2 * D) return `${(ms / H).toFixed(1)} h`;
  return `${(ms / D).toFixed(1)} d`;
}
const fmtDateTime = (t: number) => {
  const d = new Date(t);
  return `${fmtDay(t)}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---------- charts (inline SVG) ----------

const CW = 560;
const CH = 240;
const M = { l: 34, r: 10, t: 12, b: 30 };

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const step = v <= 20 ? 5 : v <= 50 ? 10 : 20;
  return Math.ceil(v / step) * step;
}

function frame(inner: string, label: string): string {
  return `<svg class="chart" viewBox="0 0 ${CW} ${CH}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

function gridlines(max: number, fmt: (v: number) => string): string {
  const ticks = 4;
  let out = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const y = CH - M.b - ((CH - M.t - M.b) * i) / ticks;
    out += `<line class="grid" x1="${M.l}" x2="${CW - M.r}" y1="${y}" y2="${y}"/><text class="axis" x="${M.l - 6}" y="${y + 4}" text-anchor="end">${esc(fmt(v))}</text>`;
  }
  return out;
}

/** Generic bar chart; each group has one or more series values. */
function barChart(
  labels: string[],
  series: { name: string; cls: string; values: number[] }[],
  max: number,
  fmt: (v: number) => string,
  ariaLabel: string,
): string {
  const plotW = CW - M.l - M.r;
  const plotH = CH - M.t - M.b;
  const gw = plotW / labels.length;
  const bw = Math.min(26, (gw * 0.7) / series.length);
  let bars = '';
  labels.forEach((l, i) => {
    const gx = M.l + gw * i + gw / 2 - (bw * series.length) / 2;
    series.forEach((s, k) => {
      const h = max ? (s.values[i] / max) * plotH : 0;
      bars += `<rect class="${s.cls}" x="${(gx + bw * k).toFixed(1)}" y="${(CH - M.b - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${esc(l)} - ${esc(s.name)}: ${esc(fmt(s.values[i]))}</title></rect>`;
    });
    bars += `<text class="axis" x="${(M.l + gw * i + gw / 2).toFixed(1)}" y="${CH - 10}" text-anchor="middle">${esc(l)}</text>`;
  });
  return frame(gridlines(max, fmt) + bars, ariaLabel);
}

function legend(items: { name: string; cls: string }[]): string {
  return `<div class="legend">${items.map((i) => `<span><i class="sw ${i.cls}"></i>${esc(i.name)}</span>`).join('')}</div>`;
}

export function weeklyChart(d: Dataset): string {
  const max = niceMax(Math.max(...d.weeks.flatMap((w) => [w.created, w.completed])));
  return (
    legend([{ name: 'Created', cls: 'b1' }, { name: 'Completed', cls: 'b2' }]) +
    barChart(
      d.weeks.map((w) => w.label),
      [
        { name: 'Created', cls: 'b1', values: d.weeks.map((w) => w.created) },
        { name: 'Completed', cls: 'b2', values: d.weeks.map((w) => w.completed) },
      ],
      max,
      (v) => String(Math.round(v)),
      'To-dos created and completed per week over the last 8 weeks',
    )
  );
}

export function bucketChart(d: Dataset): string {
  const max = niceMax(Math.max(...d.buckets.map((b) => b.count)));
  return barChart(
    d.buckets.map((b) => b.label),
    [{ name: 'Closed to-dos', cls: 'b1', values: d.buckets.map((b) => b.count) }],
    max,
    (v) => String(Math.round(v)),
    'Distribution of time to close',
  );
}

export function weekdayChart(d: Dataset): string {
  return barChart(
    d.weekdays.map((w) => w.label),
    [{ name: 'Completion rate', cls: 'b2', values: d.weekdays.map((w) => w.rate) }],
    1,
    pct,
    'Completion rate by weekday of creation',
  );
}

// ---------- page chrome ----------

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--fg:#14171f;--muted:#586072;--line:#e3e6ec;--accent:#0b7a5a;--accent-fg:#fff;--b1:#9aa5b8;--b2:#0b7a5a;--warn:#a43b2a}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--card:#181c25;--fg:#eceff5;--muted:#a3adc0;--line:#2a303d;--accent:#3ddba6;--accent-fg:#06281d;--b1:#6b7790;--b2:#3ddba6;--warn:#ff9b8a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:1080px;margin:0 auto;padding:20px 16px 48px}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.brand{font-weight:700;font-size:1.1rem;display:flex;align-items:center;gap:8px}
.brand .dot{width:12px;height:12px;border-radius:50%;background:var(--accent)}
.btn{display:inline-block;background:var(--accent);color:var(--accent-fg);padding:12px 22px;border-radius:10px;font-weight:600;text-decoration:none;border:0}
.btn:focus-visible,a:focus-visible{outline:3px solid var(--fg);outline-offset:2px}
.btn.ghost{background:transparent;color:var(--fg);border:1px solid var(--line);padding:8px 14px;font-weight:500}
h1{font-size:1.6rem;margin:0 0 4px}
h2{font-size:1rem;margin:0 0 12px}
h2.sec{font-size:1.15rem;margin:8px 0 12px}
.sub{color:var(--muted);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.kpi .v{font-size:1.7rem;font-weight:700;letter-spacing:-.02em}
.kpi .l{color:var(--muted);font-size:.85rem}
.kpi .n{color:var(--muted);font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:12px;margin-bottom:12px}
.chart{width:100%;height:auto;display:block}
.chart .grid{stroke:var(--line);stroke-width:1}
.chart .axis{fill:var(--muted);font-size:11px}
.b1{fill:var(--b1);background:var(--b1)}.b2{fill:var(--b2);background:var(--b2)}
.legend{display:flex;gap:16px;font-size:.85rem;color:var(--muted);margin-bottom:6px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
.tablewrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.9rem}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--muted);font-weight:600;font-size:.8rem}
td.num,th.num{text-align:right}
dl.id{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0;font-size:.9rem}
dl.id dt{color:var(--muted)}
dl.id dd{margin:0;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem}
.badge{display:inline-block;border:1px solid var(--accent);color:var(--accent);border-radius:999px;padding:2px 10px;font-size:.8rem;margin-bottom:12px}
.who{margin:0 0 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.who img{border-radius:50%}
.note{color:var(--muted);font-size:.75rem}
.tag{display:inline-block;border-radius:999px;padding:1px 9px;font-size:.7rem;font-weight:700;letter-spacing:.04em;vertical-align:middle;margin-left:8px}
.tag.live{background:var(--accent);color:var(--accent-fg)}.tag.sample{border:1px solid var(--line);color:var(--muted)}
.notice{border:1px solid var(--warn);color:var(--warn);border-radius:10px;padding:10px 14px;margin-bottom:16px}
.hero{text-align:center;padding:64px 0 32px}
.hero h1{font-size:clamp(2rem,6vw,3.2rem);letter-spacing:-.03em;margin-bottom:12px}
.hero p{max-width:560px;margin:0 auto 24px;color:var(--muted);font-size:1.1rem}
.hero .fine{font-size:.9rem;margin:16px auto 0}
.feat{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:32px}
.err{max-width:520px;margin:64px auto;text-align:center}
.err h1{color:var(--warn)}
.err pre{text-align:left;white-space:pre-wrap;word-break:break-word;background:var(--bg);padding:10px;border-radius:8px;font-size:.8rem;color:var(--muted)}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">${body}</div></body></html>`;
}

const brand = '<div class="brand"><span class="dot" aria-hidden="true"></span>Todo Insights</div>';

// ---------- pages ----------

export function renderLanding(): string {
  return page(
    'Todo Insights',
    `<header class="top">${brand}</header>
<main class="hero">
  <h1>Todo Insights</h1>
  <p>Reports for your to-dos, secured by Neon Auth.</p>
  <a class="btn" href="/login">Sign in</a>
  <p class="fine">You will sign in on the Neon Auth-hosted login page, then return here with a scoped access token.</p>
</main>
<section class="feat" aria-label="Features">
  <div class="card"><h2>Weekly throughput</h2><p class="sub">See what you create and finish, week by week.</p></div>
  <div class="card"><h2>Time to close</h2><p class="sub">Know how long things really take.</p></div>
  <div class="card"><h2>Best days</h2><p class="sub">Find the weekdays you get the most done.</p></div>
</section>`,
  );
}

export function renderError(title: string, message: string, detail?: string): string {
  return page(
    title,
    `<main class="err card"><h1>${esc(title)}</h1><p>${esc(message)}</p>
<p><a class="btn" href="/login">Sign in again</a></p>${detail ? `<pre>${esc(detail)}</pre>` : ''}</main>`,
  );
}

export interface Identity {
  sub: string;
  name?: string;
  email?: string;
  clientId?: string;
  aud: string[];
  iss?: string;
  scope?: string;
  exp?: number;
  picture?: string;
  nameSource?: 'id_token' | 'userinfo';
}

export interface LiveTodos {
  total: number;
  open: number;
  done: number;
  completionRate: number;
  createdLast7d: number;
  oldestOpen: { title: string; ageMs: number } | null;
  mostRecent: { title: string; createdAt: number } | null;
  perDay: { label: string; count: number }[];
  recent: { title: string; createdAt: number; done: boolean }[];
}
export type LiveResult = { ok: true; data: LiveTodos } | { ok: false };

function kpiTile(label: string, value: string, note = ''): string {
  return `<div class="card kpi"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div>${note ? `<div class="n" title="${esc(note)}">${esc(note)}</div>` : ''}</div>`;
}

function identityPanel(id: Identity, resource: string): string {
  const row = (k: string, v: string | undefined) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '');
  return `<section class="card" aria-labelledby="idh"><span class="badge">Authorized by Neon Auth for ${esc(resource)}</span>
<h2 id="idh">Signed-in identity</h2>
${id.name ? `<p class="who">${id.picture && /^https:\/\//.test(id.picture) ? `<img src="${esc(id.picture)}" alt="" width="32" height="32" referrerpolicy="no-referrer"> ` : ''}<strong>${esc(id.name)}</strong>${id.nameSource ? `<br><span class="note">from ${id.nameSource === 'id_token' ? 'the ID token issued by Neon Auth' : 'the userinfo endpoint'}</span>` : ''}</p>` : ''}
<dl class="id">${row('name', id.name)}${row('email', id.email)}${row('sub', id.sub)}${row('client_id', id.clientId)}${row('aud', id.aud.join(', '))}${row('iss', id.iss)}${row('scope', id.scope)}${row('expires', id.exp ? new Date(id.exp * 1000).toISOString() : undefined)}</dl></section>`;
}

function slowestTable(d: Dataset): string {
  const rows = d.slowest
    .map(
      (r) =>
        `<tr><td>${esc(r.title)}</td><td>${esc(fmtDateTime(r.createdAt))}</td><td>${esc(fmtDateTime(r.closedAt))}</td><td class="num">${esc(fmtDuration(r.durationMs))}</td></tr>`,
    )
    .join('');
  return `<div class="tablewrap"><table><thead><tr><th>To-do</th><th>Created</th><th>Closed</th><th class="num">Duration</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function perDayChart(l: LiveTodos): string {
  const max = niceMax(Math.max(...l.perDay.map((p) => p.count)));
  return barChart(
    l.perDay.map((p, i) => (i % 2 === 0 ? p.label : '')),
    [{ name: 'Created', cls: 'b2', values: l.perDay.map((p) => p.count) }],
    max,
    (x) => String(Math.round(x)),
    'To-dos created per day over the last 14 days',
  );
}

function liveSection(live: LiveResult): string {
  const head = `<h2 class="sec">Your to-dos<span class="tag live">LIVE</span></h2>`;
  if (!live.ok) {
    return `<section aria-label="Live to-dos">${head}<p class="notice" role="status">Live to-do stats are temporarily unavailable. Showing sample data below.</p></section>`;
  }
  const l = live.data;
  if (l.total === 0) {
    return `<section aria-label="Live to-dos">${head}<div class="card"><p class="sub">No to-dos yet - add some in the Todo app or from your MCP client.</p></div></section>`;
  }
  const rows = l.recent
    .map(
      (r) =>
        `<tr><td>${esc(r.title)}</td><td>${esc(fmtDateTime(r.createdAt))}</td><td>${r.done ? 'done' : 'open'}</td></tr>`,
    )
    .join('');
  return `<section aria-label="Live to-dos">${head}
<div class="kpis">
${kpiTile('Total', String(l.total))}
${kpiTile('Open', String(l.open))}
${kpiTile('Done', String(l.done))}
${kpiTile('Completion rate', pct(l.completionRate))}
${kpiTile('Created, last 7 days', String(l.createdLast7d))}
${kpiTile('Oldest open', l.oldestOpen ? fmtDuration(l.oldestOpen.ageMs) : 'none', l.oldestOpen?.title ?? '')}
${kpiTile('Most recent', l.mostRecent ? fmtDay(l.mostRecent.createdAt) : '-', l.mostRecent?.title ?? '')}
</div>
<div class="grid2">
  <section class="card"><h2>Created per day, last 14 days</h2>${perDayChart(l)}</section>
  <section class="card"><h2>5 most recent</h2><div class="tablewrap"><table><thead><tr><th>To-do</th><th>Created</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></section>
</div></section>`;
}

export function renderDashboard(d: Dataset, id: Identity, resource: string, live: LiveResult = { ok: false }): string {
  const k = d.kpis;
  return page(
    'Todo Insights - Dashboard',
    `<header class="top">${brand}<div>${id.name ? `<span>Signed in as <strong>${esc(id.name)}</strong>${id.email ? ` (${esc(id.email)})` : ''}</span> ` : ''}<a class="btn ghost" href="/logout">Sign out</a></div></header>
<h1>Your to-do report</h1>
${liveSection(live)}
<h2 class="sec">Trends<span class="tag sample">SAMPLE DATA</span></h2>
<p class="sub">Last ${d.weeks.length} weeks. Sample data generated from your account id; time-to-close needs a completion timestamp that to-dos do not store.</p>
<section class="kpis" aria-label="Key metrics">
${kpiTile('Total to-dos', String(k.total))}
${kpiTile('Completed', String(k.completed))}
${kpiTile('Open', String(k.open))}
${kpiTile('Completion rate', pct(k.completionRate))}
${kpiTile('Avg to-dos / week', k.avgPerWeek.toFixed(1))}
${kpiTile('Median time to close', fmtDuration(k.medianCloseMs))}
${kpiTile('Longest open', fmtDuration(k.longestOpenMs), k.longestOpenTitle)}
</section>
<div class="grid2">
  <section class="card"><h2>Created vs completed per week</h2>${weeklyChart(d)}</section>
  <section class="card"><h2>Time to close</h2>${bucketChart(d)}</section>
</div>
<div class="grid2">
  <section class="card"><h2>Completion rate by weekday</h2>${weekdayChart(d)}</section>
  ${identityPanel(id, resource)}
</div>
<section class="card"><h2>10 slowest-closed to-dos</h2>${slowestTable(d)}</section>`,
  );
}
