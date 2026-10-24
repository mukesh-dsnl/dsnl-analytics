# DSNL Analytics — UI/UX redesign (HTML prototype)

A clickable, self-contained redesign of DSNL Analytics in plain HTML, CSS and
JavaScript. No build step and no framework; the only network request is the Inter
webfont.

## Open it

| File | What it is |
|---|---|
| `index.html` | The prototype: every screen, every state, clickable |
| `styleguide.html` | Foundations (color, type, spacing, chart colors) and every component |
| `responsive.html` | The prototype in exact **1440 × 900** and **1920 × 1080** frames |

Double-clicking `index.html` works. Serving the folder is closer to the real thing:

```bash
cd design
python -m http.server 8765        # then open http://127.0.0.1:8765
```

Sign in with any username and password. Use `wrong` as the password to see the
error state.

**Prototype controls:** the dark pill in the bottom-right corner opens a panel with
these controls:
- Switch the open screen between **Default / Loading / Empty / Error / No results /
  Upload failed**.
- Toggle Light / Dark.
- Collapse the sidebar.
- Jump to any screen.

## Folder layout

```
design/
├── index.html            prototype shell
├── styleguide.html       design system page
├── responsive.html       1440 / 1920 preview frames
└── assets/
    ├── css/
    │   ├── tokens.css      colors (light + dark), type, spacing, radius, chart colors
    │   ├── base.css        reset, body, focus, scrollbars
    │   ├── components.css  every reusable component
    │   └── screens.css     page layouts + the 1920 breakpoint
    └── js/
        ├── icons.js        inline Lucide icon set
        ├── data.js         sample data shaped like the real API
        ├── charts.js       SVG charts + shared hover tooltip
        ├── ui.js           component builders (used by prototype and style guide)
        ├── screens.js      one renderer per screen, all states
        ├── app.js          state, hash router, interactions, simulated flows
        └── styleguide.js   style guide page
```

---

## Step 0: what the current frontend has

I read `frontend/src` before designing. The redesign keeps all of the following:

**Routes / pages**
- `/login`: username and password with a show/hide toggle.
- `/analytics/{all,voicedrop,conference,multicall}/attempt-metrics`: the CDR
  dashboard (`CDRDashboardPage`). One layout is shared by all four services.
- `/analytics/{voicedrop,conference,multicall}/campaign-metrics`: single-day
  tables (`CampaignMetricsPage`).
  - Tabs: Account wise (rows expand to show CRNs; a chart popup per row),
    Service Provider wise, Location wise, and Campaigns (Voicedrop only).
  - Search, sorting, pagination and CSV export.
- `/analytics/multicall/registry`: MultiCall Registration Lookup (search panel,
  results table, account and profile view).
- `/assistant/:conversationId`: the AI chat, behind the `aiPermission` flag.
  - Composer with slash commands: `/voicedrop /conference /multicall /excel /csv /chart`.
  - Thinking steps while it answers; answer tables with copy.
  - Export files; conversation list with rename and delete.

**Layout:** sidebar groups Overview / Voicedrop / Conference / MultiCall, an
Analytics | Chat switch, a collapsible icon rail, and a user/logout footer. The
header holds the page filters, a date range (a single date on Campaign Metrics)
and the theme toggle.

**Dashboard API** (`POST /api/cdr/query/dashboard`, one request fills the page):

| Field | Contents |
|---|---|
| `summary` | `total_calls`, `total_participants`, `total_phone_numbers`, `minutes_usage`, `total_conferences` |
| `dtmf` | DTMF count |
| `call_direction` | Dial In / Dial Out counts |
| `connection_status` | Connected / Not Connected counts |
| `peak_ports` | `{bucket, peak}` per bucket |
| `service_provider` | counts per carrier |
| `reblast` | `{total, stages}`, plus `reblast_aid` |
| `disconnect_reason` | counts per reason |
| `location`, `minutes_by_location` | counts and minutes per location |
| `call_funnel`, `call_duration` | lifecycle stages and duration buckets (Voicedrop only) |
| `coverage` | `days`, `bucket` |

**Filters per service:**
- **All:** none.
- **Voicedrop:** Account ID, CRN, Time from/to.
- **Conference and MultiCall:** those four plus Conf Num and CPIN.

**Existing states:** CDR service unreachable; no readable exports; CODR missing
(Conference and MultiCall unavailable); reversed or too-wide date range; "No attempts
in this scope".

`data.js` uses these same field names, so the design maps onto the API one to one.

## What is new or changed (please review)

| Change | Why | Backend impact |
|---|---|---|
| **Upload Data page**, with one active dataset that a new upload replaces | Asked for in the brief | **New.** Today the backend reads parquet files from `CDR_LAKE_PATH`. Needs upload, processing status, dataset metadata and an atomic swap. |
| **Reports page** (schedules, run history, create/edit form) | Asked for in the brief | **New.** Needs scheduler, runs and email delivery. |
| **Custom tab** with a filter bar | Asked for in the brief. The filters move out of the header into a labelled bar with Apply/Reset and removable chips. | None for existing fields |
| **Call direction** and **Service provider** filters under "More filters" (marked *New*) | Common operations questions | **New** filter params |
| Metric tab bar (Overview, Connection, Dial In/Out, Peak ports, Service providers, Reblast & DTMF, Disconnect reasons, Custom) | Replaces the segmented chart-group switch | None |
| **Reblast & DTMF** grouped in one card; DTMF is no longer a KPI | Matches the brief's list | None |
| 4th KPI is **Connection rate** (All/Voicedrop); **Conferences** stays for Conference/MultiCall | The brief lists three KPIs; the fourth slot uses data already returned | None |
| Sidebar follows the theme (light in light mode) instead of always navy | Closer to the Linear/Grafana look asked for | None |
| Sidebar keeps **Campaign Metrics for Conference & MultiCall** and **Registration Lookup** | The brief's list leaves them out, but they exist today | None |
| AI assistant moved into the sidebar as "Ask AI"; conversation list sits inside the page | One navigation model instead of the Analytics/Chat switch | None |
| Active-dataset card at the bottom of the sidebar | Everyone can see which data they're looking at | Needs dataset status |
| "Upload failed" banner on every data screen | A failed upload keeps the old dataset, so pages must say so | Needs last-upload status |

Kept as they are: Location, Call activity (lifecycle) and Call duration panels, the
campaign tables, Registration Lookup, and the slash commands.

---

## Foundations

- **Color:** semantic tokens (`--color-bg-*`, `--color-text-*`, `--color-border-*`,
  `--color-brand-*`, `--color-status-*`) in light and dark, built from the existing
  brand values (`#00a3e0` cyan, the indigo-tinted neutral ramp, a navy dark mode).
- **Chart colors:** seven categorical series in a fixed order, plus fixed meanings:
  teal for connected/positive, coral for not connected/negative. Also grid, axis and
  track tokens. Each has a light and a dark value.
- **Type:** Inter, with tabular numbers for every figure. Scale: Display 30 / H1 22 /
  H2 17 / H3 14 / Body 14 / Small 13 / Caption 12 / Overline 11 / KPI 28 / Metric 20.
- **Spacing:** 4px base (`--space-2` … `--space-64`). Radius 6 / 8 / 12 / 16 / full.
  Three shadow levels.
- **Layout:**
  - Sidebar 248px (264 at ≥1800), collapsed rail 64px, top bar 60px.
  - Content area up to 1680px wide, on a 12-column dashboard grid.
  - **1440:** 4 KPI cards, 2-up chart rows.
  - **1920:** 5 KPI cards where the data has them, and a 3-up routing row
    (providers, reasons, location). Cards gain columns rather than stretching.

## Components (`ui.js` + `components.css`)

| Component | Variants and states |
|---|---|
| Button | primary, secondary, ghost, danger; sm/md/lg; icon-only, loading, disabled |
| Sidebar item | default, hover, active (marker + tint), group open/closed, badge, collapsed rail |
| KPI card | five tones, progress bar, sparkline, hover detail, skeleton |
| Chart card | title/subtitle, actions (CSV, expand), footer insight, skeleton |
| Tab bar | icons, counts, separator. Also a segmented control. |
| Date picker | trigger (range or single day), presets, two-month calendar, available-data note, max-range rule |
| Filter dropdown | empty / set trigger, popover with fields, "More filters" count |
| Table | sortable headers, numeric alignment, expandable sub-rows, meters, toolbar, footer/pager, skeleton |
| Upload box | default, drag-over, error. Plus progress bar and step list (done / active / failed / pending). |
| Chat bubble | user, assistant (text, table, query pill, actions), thinking steps, error |
| Also | badge, chip, switch, avatar, banner (info/success/warning/danger), empty/error/no-results panels, modal, drawer, toast |

---

## Screen behavior notes (Phase 3)

How each prototype state maps to each screen:

| Screen | Loading | Empty (no dataset) | Error | No results | Upload failed |
|---|---|---|---|---|---|
| Sign in | Button spinner "Signing in…" | — | "Can't reach the sign-in service" banner (wrong password: "Incorrect username or password") | — | — |
| Dashboards (All / Voicedrop / Conference / MultiCall) | KPI and chart skeletons | "No data uploaded yet" + Upload data | Error panel with the failed endpoint + Retry | Filter bar + "No calls match these filters" + Clear filters | Warning banner: still showing the previous dataset |
| Campaign metrics | Table skeleton | Same empty panel | Error panel inside the table card | "No accounts match …" + Clear search | Banner |
| Registration lookup | Table skeleton | "Search for an account" (not dataset-bound) | Error panel | "No accounts match …" | — |
| Upload data | Card skeletons | First-upload hero: info banner + large drop zone, no active card | Error panel | — | Failed processing card: step 2 failed, reason, error report, "nothing was replaced" |
| Reports | Table skeleton | "No scheduled reports yet" (or "Upload data first") | Error panel | History filter: "No runs match these filters" | Banner |
| AI assistant | Conversation list and thread skeletons | No history + suggested questions | Assistant error bubble + Retry | "No conversations match …" | Banner in the thread |

### 1. Sign in
- Split layout: a brand panel on the navy dot-grid ground with yesterday's headline
  figures, and the form on the right.
- Enter submits. Show/hide password. "Keep me signed in" checkbox. Theme toggle in
  the top-right corner.
- On success, opens All Services.

### 2. Main layout
- **Sidebar sections:**
  - **Analytics:** All Services, then Voicedrop, Conference and MultiCall as
    expandable groups. Each group has Attempt Metrics and Campaign Metrics;
    MultiCall also has Registration Lookup.
  - **Data:** Upload Data (badge shows "Start" with no dataset, or upload progress
    while processing) and Reports.
  - **Assistant:** Ask AI.
- The group containing the current page opens automatically.
- The collapse button switches to an icon rail. On the rail, clicking a group opens
  that service's dashboard. The sidebar state is remembered.
- Active-dataset card at the bottom: file name, date coverage, row count. The dot
  turns amber after a failed upload, blue while processing, grey with no dataset.
  Clicking it opens Upload Data.
- **Top bar:**
  - Breadcrumb on the left.
  - Date control: a range picker on dashboards; a single-day picker on Campaign
    Metrics. Hidden on Upload, Reports, Registry and the assistant, matching today's
    app (the range is part of the question there).
  - Ask AI, theme toggle, and the user menu (profile, Light/Dark, my reports,
    shortcuts, Sign out).
- **Date picker:**
  - Presets: Yesterday, Last 7 / 14 days, Month to date, Custom range.
  - The first click picks the start and the second picks the end.
  - Days outside the dataset are disabled, and the 31-day maximum is enforced.
  - Changing the range briefly shows the loading state.

### 3. Dashboard (All / Voicedrop / Conference / MultiCall)
- **Page header:** service name, range, active file. Actions: Schedule report (opens
  the Reports form pre-set to this service) and Export.
- **Tab bar:** Overview shows every section. Each other metric tab shows that one card
  full width, with the KPI row kept above it. Custom opens the filter bar.
- **KPIs:** Total calls (bar = connection rate), Total participants (with unique
  phone numbers), Minutes usage (with a peak-shape sparkline), and Connection rate
  (All/Voicedrop) or Conferences (Conference/MultiCall). Hovering a card shows its
  breakdown.
- **Sections:**
  - **Call outcomes:** Connected vs Not Connected and Dial In vs Dial Out (donut,
    counts, shares, split bar, one-line insight).
  - **Capacity & follow-up:** Peak ports line chart, with a hover readout, peak
    marker, average and bucket size. Hourly for one day, daily for a range. Next to
    it, Reblast & DTMF: the two counts plus reblasts by stage.
  - **Routing:** Service providers (count + connect rate, lowest-rate callout),
    Disconnect reasons, Location.
  - **Call lifecycle (Voicedrop only):** Call activity funnel and Call duration.
- Every bar, arc and point has a hover tooltip. Each card has Download CSV and Expand.

### 4. Custom tab
- **Filter bar:** Account ID, CRN, Time period (from/to), and More filters (Conf Num
  and CPIN for Conference/MultiCall only, plus the new Call direction and Service
  provider).
- Apply runs the query; the dashboard below is the same content, narrowed. Applied
  filters show as removable chips. Reset clears them all. The Custom tab shows the
  number of active filters.
- Unknown IDs show the no-results panel. In the prototype, try Account ID `999999`;
  `118230` works.
- Switching service keeps the date range. Filters are kept separately for each
  service (today's app clears them on switch).

### 5. Upload data
1. **No dataset yet:** info banner and a large drop zone. A file goes straight to
   processing.
2. **Dataset active:** active-dataset card (file, uploader, coverage, rows, CDR/CODR
   split, size), a smaller drop zone headed "Replace with a new file", rules, and
   recent uploads.
3. **Pick or drop a file → replace warning** (modal):
   - Shows "Will be removed" vs "New file".
   - Says nothing changes until processing succeeds.
   - **Replace dataset** stays disabled until the "I understand…" box is ticked.
4. **Processing:** overall progress plus four steps (upload → check columns → build
   tables → switch). The old dataset is marked "Stays active until the new file is
   ready". The sidebar shows progress, and the user can leave the page. Cancel is
   available.
5. **Ready:** success banner with **Open dashboard**. The active card and the sidebar
   switch to the new file, and the old file shows as "Replaced" in history.
6. **Failed:** the column-check step fails with a reason ("Missing required column
   CONFEREE_TYPE"), an error report download, and Try another file. The previous
   dataset stays active, and every data screen shows the warning banner. To see this
   live, set the prototype state to *Upload failed* and run an upload.

### 6. Reports
- **Scheduled tab:** each row shows name, service and contents, frequency and time,
  format, recipients (+n), next run, last-run status, an Active switch (pause/resume),
  and actions: Run now, Edit, Delete.
- **History tab:** status filter (All / Delivered / Failed / Running / Queued) and
  search. Rows show report, run time, data range, format and status (Running has a
  spinner; Failed shows the reason). Download works for Delivered runs; Failed runs
  offer Retry. Files are kept for 30 days.
- **New / Edit schedule** (side drawer):
  - Name and Service.
  - Contents: checkboxes for each dashboard section, date range, optional Account ID.
  - Frequency (Daily / Weekly with day / Monthly with day of month), time (IST), and
    a "next run" preview.
  - Format: CSV, Excel or PDF.
  - Recipients as chips (Enter adds one).
  - Send test, then Save. Runs are skipped while a dataset is processing.

### 7. AI assistant
- **Left panel:** New chat, search, and conversations grouped by Today / Yesterday /
  Previous 7 days.
- **Chat header:** title, plus the dataset the answers come from.
- **Empty thread:** an intro and four suggested questions, taken from today's app.
- **Sending:** the user bubble appears, then live thinking steps (reading the
  question → choosing tables → running the query → writing the answer). Then the
  answer text, a result table, a query pill showing what ran, and Copy / Export
  Excel buttons.
- While it answers, the send button becomes Stop.
- Enter sends; Shift+Enter adds a new line.
- The composer has slash commands, a service-scope chip and an Excel-attach chip.

## Next steps

1. Review the "What is new or changed" table, especially the backend items (upload,
   dataset status, reports scheduler, the two new filters).
2. Once the layout is approved, the tokens in `tokens.css` can replace the theme block
   in `frontend/src/index.css` directly, since the names follow the existing ramp.
3. If you later get a Figma Professional seat, the same tokens and component list can
   be rebuilt as Figma variables and components.
