// Scrapes Ryan Dobbeck's coached classes from the Mag Mile CrossFit Wodify
// Online Sales schedule and writes docs/classes.json (this week + next week).
// Wodify runs on OutSystems (no clean public API + token-gated endpoints), so we
// render the page in a headless browser and read the DOM. See README for fragility notes.
//
// Per-class booking links: Wodify's "Book" button is a JS button (no href), and the
// ClassId it books is not exposed anywhere in the DOM ahead of time — it only shows up
// in the URL after the button is actually clicked (SPA navigation to a review-purchase
// screen: `.../OnlineSalesPage/Main?q=ReviewPurchase|...&ClassId=<id>&...`). So for each
// of Ryan's classes we click Book, capture that URL, then reload the schedule and
// re-select the day before moving to the next class.
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

// --- read one rendered day's class rows from the DOM (structured, not text-blob parsing) ---
async function readDayRows(page) {
  return page.evaluate((COACH) => {
    const timeRe = /^(\d{1,2}:\d{2}\s*(?:AM|PM))\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM))$/i;
    const items = Array.from(document.querySelectorAll('.list-item'));
    return items.map((el, i) => {
      const lines = el.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
      const m = lines[0] && lines[0].match(timeRe);
      if (!m) return null;
      const minIdx = lines.findIndex((l) => /^\d+\s*min$/i.test(l));
      let title = (minIdx >= 0 ? lines[minIdx + 1] : lines[2]) || 'CrossFit';
      title = title.replace(/:\s*\d{1,2}:\d{2}\s*(?:AM|PM)\s*$/i, '').trim();
      const isCoach = lines.includes(COACH);
      const hasBook = !!Array.from(el.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Book');
      return { rowIndex: i, start: m[1].replace(/\s+/g, ' '), end: m[2].replace(/\s+/g, ' '), title, isCoach, hasBook };
    }).filter(Boolean);
  }, COACH);
}

function extractClassId(url) {
  if (!url.includes('ReviewPurchase')) return null;
  const m = url.match(/ClassId=(\d+)/i);
  return m ? m[1] : null;
}

function bookUrlFor(classId) {
  return `https://magmilecrossfit.wodify.com/OnlineSalesPage/Main?q=MembershipType|LocationId=11492&ClassId=${classId}&HasProgramAccess=False`;
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

async function selectDay(page, md) {
  const cell = page.getByText(md, { exact: true }).first();
  await cell.click({ timeout: 8000 });
  await page.waitForTimeout(1400);
}

// Click the Book button for a given row index, capture the resulting ClassId, then
// restore the schedule (reload + reselect day) so the caller can process the next row.
async function captureBookUrl(page, md, rowIndex) {
  const rows = page.locator('.list-item');
  const bookBtn = rows.nth(rowIndex).getByText('Book', { exact: true });
  await bookBtn.click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  const url = page.url();
  const classId = extractClassId(decodeURIComponent(url));
  // restore schedule state for the next row
  if (!(await loadSchedule(page))) throw new Error('schedule did not reload after booking click');
  await selectDay(page, md);
  return classId;
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
      await selectDay(page, t.md);
      let rows = await readDayRows(page);
      const ryanRows = rows.filter((r) => r.isCoach);
      const classes = [];
      // Process from the bottom up: clicking Book navigates away and reload/reselect
      // re-renders the day, but earlier row indices stay stable relative to unprocessed rows.
      for (const r of ryanRows) {
        let classId = null;
        let bookUrl = null;
        if (r.hasBook) {
          try {
            classId = await captureBookUrl(page, t.md, r.rowIndex);
            if (classId) bookUrl = bookUrlFor(classId);
          } catch (e) {
            process.stderr.write(`    book-link capture failed for ${t.md} ${r.start}: ${e.message.split('\n')[0]}\n`);
            // restore schedule state before continuing this day's loop
            await loadSchedule(page);
            await selectDay(page, t.md);
          }
        }
        classes.push({ date: t.iso, day: t.day, start: r.start, end: r.end, title: r.title, bookUrl });
      }
      if (classes.length) {
        if (!byWeek.has(t.weekOf)) byWeek.set(t.weekOf, []);
        byWeek.get(t.weekOf).push(...classes);
      }
      process.stderr.write(`  ${t.md} ${t.day}: ${classes.length} Ryan class(es)\n`);
    } catch (e) {
      process.stderr.write(`  ${t.md} ${t.day}: skipped (${e.message.split('\n')[0]})\n`);
      // best-effort recovery so one bad day doesn't kill the rest of the run
      await loadSchedule(page).catch(() => {});
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
  const withLinks = weeks.reduce((n, w) => n + w.classes.filter((c) => c.bookUrl).length, 0);
  process.stderr.write(`\nWrote docs/classes.json — ${total} classes across ${weeks.length} week(s), ${withLinks} with direct book links.\n`);
}

main().catch((e) => {
  process.stderr.write(`FATAL: ${e.message}\n`);
  process.exit(1);
});
