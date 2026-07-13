# ryan-classes

Auto-updating feed of the CrossFit classes **Ryan Dobbeck** coaches at **Mag Mile CrossFit**,
scraped daily from their public Wodify schedule and published as JSON for ryandobbeck.com to render.

## How it works
- `scrape.mjs` renders the Mag Mile Wodify Online Sales schedule in headless Chromium (Playwright),
  clicks through this week + next week, and keeps only class blocks coached by "Ryan Dobbeck".
- Output: `docs/classes.json`.
- A GitHub Actions cron (`.github/workflows/scrape.yml`) runs it daily ~6am CT and commits changes.
- The site fetches it from:
  `https://raw.githubusercontent.com/rdobbeck/ryan-classes/main/docs/classes.json`

## Why scraping (and its one fragility)
Wodify runs on OutSystems: the class data is behind token-gated, per-deploy-versioned endpoints, so
there is no clean public API. We render the DOM instead. If Mag Mile ever redesigns their Wodify
schedule page, the parser in `scrape.mjs` may need a small update. The scraper **refuses to overwrite
`classes.json` when it parses zero classes** (fail-safe against silently blanking the site), and the
cron fires a Push-by-Techulus alert on failure (set the `PUSH_TECHULUS_KEY` repo secret to enable).

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
  "weeks": [ { "weekOf": "YYYY-MM-DD", "classes": [ { "date","day","start","end","title" } ] } ]
}
```
