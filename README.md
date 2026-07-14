# ryan-classes

Auto-updating feed of the CrossFit classes **Ryan Dobbeck** coaches at **Mag Mile CrossFit**,
scraped daily from their public Wodify schedule and published as JSON for ryandobbeck.com to render.

## How it works
- `scrape.mjs` renders the Mag Mile Wodify Online Sales schedule in headless Chromium (Playwright),
  clicks through this week + next week, and keeps only class rows coached by "Ryan Dobbeck".
- For each of Ryan's classes it also clicks the row's "Book" button to capture the class-specific
  booking URL (Wodify's SPA navigates to `.../Main?q=ReviewPurchase|...&ClassId=<id>&...` — the
  ClassId isn't exposed anywhere in the DOM ahead of a click), then reloads the schedule and
  re-selects the day before moving to the next class. This is why a full scrape takes a couple
  minutes rather than a few seconds.
- Output: `docs/classes.json`, each class carrying its own `bookUrl` (falls back to the generic
  `gym.scheduleUrl` if a capture fails for that one row).
- A GitHub Actions cron (`.github/workflows/scrape.yml`) runs it daily ~6am CT and commits changes.
- The site fetches it from:
  `https://raw.githubusercontent.com/rdobbeck/ryan-classes/main/docs/classes.json`

## Why scraping (and its fragility)
Wodify runs on OutSystems: the class data and the per-class Book flow are behind token-gated,
per-deploy-versioned, click-driven state, so there is no clean public API and no ClassId available
without simulating the click. We render the DOM and click through it instead. If Mag Mile ever
redesigns their Wodify schedule page, both the row parser and the Book-click flow in `scrape.mjs`
may need an update. The scraper **refuses to overwrite `classes.json` when it parses zero classes**
(fail-safe against silently blanking the site), and the cron fires a Push-by-Techulus alert on
failure (set the `PUSH_TECHULUS_KEY` repo secret to enable).

## Run locally
```
npm install
npx playwright install chromium
node scrape.mjs
```

## Data shape
```json
{
  "generatedAt": "…ISO…",
  "coach": "Ryan Dobbeck",
  "gym": { "name", "address", "scheduleUrl", "website" },
  "weeks": [ { "weekOf": "YYYY-MM-DD", "classes": [ { "date","day","start","end","title","bookUrl" } ] } ]
}
```
