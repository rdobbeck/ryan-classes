// Scrapes Ryan Dobbeck's coached classes from the Mag Mile CrossFit Wodify
// Online Sales schedule and writes docs/classes.json (this week + next week).
// Wodify runs on OutSystems (no clean public API + token-gated endpoints), so we
// render the page in a headless browser and read the DOM. See README for fragility notes.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const SCHEDULE_URL =
  'https://magmilecrossfit.wodify.com/OnlineSalesPortal/ViewSchedule.aspx?LocationId=11492&OnlineMembershipId=280324';
const COACH = 'Ryan Dobbeck';
const TZ = 'America/Chicago';

// --- date helpers (compute the Mon-Sun of this week + next week in gym-local time) ---
function chicagoNow() {
  // Get Y/M/D as seen in America/Chicago, build a local Date at midnight.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date());
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return new Date(g('year'), g('month') - 1, g('day'));
}
function mondayOf(d) {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function buildTargets() {
  const mon = mondayOf(chicagoNow());
  const targets = [];
  for (let w = 0; w < 2; w++) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + w * 7 + i);
      targets.push({
        md: `${d.getMonth() + 1}/${d.getDate()}`,
        iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        day: DAYS[i],
        weekOf: `${mondayOf(d).getFullYear()}-${String(mondayOf(d).getMonth() + 1).padStart(2, '0')}-${String(mondayOf(d).getDate()).padStart(2, '0')}`,
      });
    }
  }
  return targets;
}

// --- parse one rendered day's class section for Ryan's classes ---
function parseDay(sectionText) {
  let sec = sectionText;
  const cut = sec.search(/Powered by|\nMagMile CrossFit\n/);
  if (cut > 0) sec = sec.slice(0, cut);
  const lines = sec.split('\n').map((s) => s.trim()).filter(Boolean);
  const timeRe = /^(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))$/i;
  const blocks = [];
  let cur = null;
  for (const ln of lines) {
    const m = ln.match(timeRe);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { start: m[1].replace(/\s+/g, ' '), end: m[2].replace(/\s+/g, ' '), lines: [] };
    } else if (cur) cur.lines.push(ln);
  }
  if (cur) blocks.push(cur);
  const classes = [];
  for (const b of blocks) {
    if (!b.lines.join(' ').includes(COACH)) continue;
    const minIdx = b.lines.findIndex((l) => /^\d+\s*min$/i.test(l));
    let title = (minIdx >= 0 ? b.lines[minIdx + 1] : b.lines[0]) || 'CrossFit';
    title = title.replace(/:\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*$/i, '').trim(); // drop redundant time suffix
    classes.push({ start: b.start, end: b.end, title });
  }
  return classes;
}

async function readClassSection(page) {
  return page.evaluate(() => {
    const scr = document.querySelector('.active-screen') || document.body;
    const txt = scr.innerText;
    const j = txt.search(/NEXT WEEK/i);
    return j >= 0 ? txt.slice(j + 9) : txt;
  });
}

// Poll until the schedule has actually rendered class content (a time range appears).
async function waitForSchedule(page, ms = 40000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const ready = await page
      .evaluate(() => /\d{1,2}:\d{2}\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)/i.test(
        (document.querySelector('.active-screen') || document.body).innerText))
      .catch(() => false);
    if (ready) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function loadSchedule(page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(SCHEDULE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    if (await waitForSchedule(page)) {
      await page.waitForTimeout(1500);
      return true;
    }
    process.stderr.write(`  load attempt ${attempt} did not render schedule, retrying...\n`);
  }
  return false;
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const page = await browser.newPage({ timezoneId: TZ });
  page.setDefaultTimeout(45000);
  if (!(await loadSchedule(page))) {
    await browser.close();
    throw new Error('Schedule never rendered after 3 attempts — Wodify may be down or changed.');
  }

  const targets = buildTargets();
  const byWeek = new Map();
  for (const t of targets) {
    try {
      const cell = page.getByText(t.md, { exact: true }).first();
      await cell.click({ timeout: 8000 });
      await page.waitForTimeout(1400);
      const section = await readClassSection(page);
      const classes = parseDay(section);
      if (classes.length) {
        if (!byWeek.has(t.weekOf)) byWeek.set(t.weekOf, []);
        for (const c of classes) {
          byWeek.get(t.weekOf).push({ date: t.iso, day: t.day, ...c });
        }
      }
      process.stderr.write(`  ${t.md} ${t.day}: ${classes.length} Ryan class(es)\n`);
    } catch (e) {
      process.stderr.write(`  ${t.md} ${t.day}: skipped (${e.message.split('\n')[0]})\n`);
    }
  }
  await browser.close();

  const weeks = [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekOf, classes]) => ({ weekOf, classes }));
  const total = weeks.reduce((n, w) => n + w.classes.length, 0);
  if (total === 0) throw new Error('No Ryan Dobbeck classes parsed for either week — likely a Wodify layout change. Not overwriting output.');

  const out = {
    generatedAt: new Date().toISOString(),
    coach: COACH,
    gym: {
      name: 'MagMile CrossFit',
      address: '7 East Illinois Street, Chicago, IL 60611',
      scheduleUrl: SCHEDULE_URL,
      website: 'https://magmilecrossfit.com',
    },
    weeks,
  };
  mkdirSync('docs', { recursive: true });
  writeFileSync('docs/classes.json', JSON.stringify(out, null, 2));
  process.stderr.write(`\nWrote docs/classes.json — ${total} classes across ${weeks.length} week(s).\n`);
}

main().catch((e) => {
  process.stderr.write(`FATAL: ${e.message}\n`);
  process.exit(1);
});
