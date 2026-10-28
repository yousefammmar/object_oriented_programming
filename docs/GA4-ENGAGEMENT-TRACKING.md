# GA4 engagement tracking

Custom Google Analytics 4 events for the CS11253 OOP study site, added to support a web-analytics
research study on student engagement and on acquisition through social-media campaigns.

> **Status:** implemented and tested locally with the real `gtag.js` (all Google requests intercepted,
> so nothing was sent to the production property). **Arrival in the production GA4 property has not
> been verified yet** — do that with DebugView after deployment (section 5).

---

## 1. What was implemented

The existing Google tag (`G-4JHKFQBZ63`, in every page's `<head>`) is unchanged and still sends the
`page_view`. A small module forwards **seven custom events** through that same `gtag`:

| File | Change |
|---|---|
| `assets/js/analytics.js` *(new)* | `OOP.analytics.track(name, params)` — the only place that talks to `gtag` |
| `assets/js/progress.js` | `setDone()` → `lesson_complete` / `lesson_uncomplete`; `toggleLab()` → `lab_complete` / `lab_uncomplete` |
| `assets/js/code-viewer.js` | `copyCode()` → `code_copy`; new `select()` (tab click, arrow keys, in-page jump) → `code_file_view` |
| `assets/js/page-features.js` | `trackResourceClicks()` → `learning_resource_click` |
| 16 content pages | `<script src="assets/js/analytics.js">` right after `config.js` |
| `tools/verify_analytics.cjs` *(new)* | Automated browser test (`npm run verify:analytics`) |

Design rules:

- **Fails safe.** No `gtag` (tag removed), `gtag.js` blocked by an ad blocker, or `gtag` throwing → the
  event is dropped silently and the site behaves exactly as before.
- **One event per real state change.** Events are sent from the functions that change state
  (`setDone`, `toggleLab`, `copyCode`, `select`), not from click listeners, so extra listeners can't
  multiply them. As a second guard, `track()` drops an *identical* event (same name and parameters)
  repeated within 1 second.
- **No personal data.** Only ids, labels from the site's own config/page text and file names are sent.
  Never names, e-mails, account ids, C++ code, search queries or anything a student types.
  Strings are capped at GA4's 100-character limit.
- **No changes** to the Measurement ID, page views, localStorage keys/structure, buttons, CSS, course
  content, links or achievements. No backend, login, cookies or dependencies were added.
- **Consent.** The site currently has no consent banner. Because events go through `gtag`, a future
  Consent Mode setup, or the standard opt-out `window['ga-disable-G-4JHKFQBZ63'] = true`, applies to
  them automatically.

---

## 2. Event dictionary

GA4 adds its automatic parameters to every event (`page_location`, `page_title`, `page_referrer`,
session/traffic-source attribution, device, country …). Only the custom parameters are listed below.

### `lesson_complete`
A student marked a topic page as completed with the **Mark as completed** button.
Sent only when the topic goes from *not completed* to *completed* — never on page load or refresh.
**Self-reported; it does not measure learning.**

| Parameter | Type | Example | Meaning |
|---|---|---|---|
| `lesson_id` | string | `classes` | Topic id from `config.js` (table below) |
| `lesson_name` | string | `Class Basics` | Topic label as shown in the navigation |
| `completion_method` | string | `manual` | How it was completed. Always `manual` today (the site never auto-completes) |

### `lesson_uncomplete`
The student un-ticked a completed topic. Same parameters as `lesson_complete`.
Not sent by **Reset progress** (see limitations).

**Topic ids** (`lesson_id` → `lesson_name`):

| id | name | id | name |
|---|---|---|---|
| `cpp` | C++ Revision | `friend` | Friend Functions |
| `classes` | Class Basics | `inheritance` | Inheritance |
| `const` | Const & Static | `polymorphism` | Polymorphism |
| `composition` | Composition | `operators` | Operator Overloading |
| `dma` | Dynamic Memory | `labs` | Labs *(the Labs page as a whole)* |
| `this` | this Pointer | | |

### `lab_complete` / `lab_uncomplete`
A student ticked / un-ticked **Mark done** on one lab card on `labs.html`. Each click is a state
change, so each click sends exactly one event. Opening a lab never marks it done.

| Parameter | Type | Example | Meaning |
|---|---|---|---|
| `lab_number` | string | `03` | `01` … `10` (01 C++ Revision, 02 Pointers & Memory, 03 Classes Intro, 04 Ctors & Dtors, 05 Const & Static, 06 Composition, 07 Overloading, 08 Inheritance 1, 09 Inheritance 2, 10 Polymorphism) |
| `completion_method` | string | `manual` | Always `manual` |

Individual labs and the `labs` topic are independent, as in the site itself.

### `code_copy`
The **Copy** button in the code viewer successfully put a file on the clipboard. A failed copy sends
nothing. The code itself is never sent.

| Parameter | Type | Example | Meaning |
|---|---|---|---|
| `code_file` | string | `DynamicMemory.cpp` | File title shown in the editor |
| `page_path` | string | `/object_oriented_programming/code-files.html` | Path of the page the copy happened on |

### `code_file_view`
The student switched the code viewer to a **different** file: tab click, arrow/Home/End keys,
browser back/forward, or a search result that jumps within the open viewer.
The file shown on first load (default file or a deep link such as `code-files.html#sep`) sends
nothing; clicking the already-open tab sends nothing.

| Parameter | Type | Example |
|---|---|---|
| `code_file` | string | `Revision2.cpp` |

`code_file` values: Revision1.cpp, Revision2.cpp, Revision3.cpp, Revision4.cpp, Classes1.cpp,
Classes2.cpp, SettersandGetters1.cpp, Constructors1.cpp / 2 / 3, Destructor.cpp,
Separation (.h + .cpp + Driver), ObjectsArray1.cpp, Constants1.cpp, Constants2.cpp,
DynamicMemory.cpp, ThisPointer.cpp, FriendFunctions.cpp, Inheritance.cpp, Polymorphism.cpp,
OperatorOverloading.cpp.

### `learning_resource_click`
A click (or middle-click) on a resource link **inside the page content**: any external link (YouTube,
Google Drive/Docs, PSUT Archive, GitHub) and links to code examples (`code-files.html#…`).
Ordinary page-to-page links, the sidebar, the previous/next pager and the Home dashboard are excluded,
because the destination's `page_view` already records them.

| Parameter | Type | Example | Meaning |
|---|---|---|---|
| `resource_type` | string | `video` | Category (rules below) |
| `resource_name` | string | `Lab 01 · C++ Revision — Video Walkthrough` | Link text. For links inside a card (Labs, Examination Hall, Revision Hall) the card number/title is prefixed, so "Video Walkthrough" is never ambiguous |
| `lesson_id` | string | `cpp` | Topic id when the click happened on a topic page; absent on Home, Examination Hall, Revision Hall, All Links, Code Files |

`resource_type` is derived from metadata already on the page, first match wins:

| Order | Rule | `resource_type` |
|---|---|---|
| 1 | Link icon ▶ (`#i-play`) | `video` |
| 2 | Link icon 📋 (`#i-clipboard`) | `quiz` |
| 3 | Link icon ⚗ (`#i-flask`) | `lab` |
| 4 | Link icon `</>` (`#i-code`) or link to `code-files.html` | `code_example` |
| 5 | Host is youtube.com / youtu.be | `video` |
| 6 | Link text contains `.pdf` or `(PDF)` | `pdf` |
| 7 | Link text contains the word "slides" | `slides` |
| 8 | Google Drive folder URL | `folder` |
| 9 | Google Drive file, Google Docs or PSUT Archive file | `document` |
| 10 | Anything else | `external_website` |

The icons are the same cue the site already uses to colour resource chips (`kindOf()` in
`page-features.js`). A Drive file without `.pdf` in its text is `document`, not `pdf`, because the
format cannot be known reliably.

### Not tracked (on purpose)

| What | Why |
|---|---|
| Quiz scores | The site has no interactive quiz; Examination Hall only links to papers and solution videos |
| Video watching | No embedded players — every video opens on YouTube/Drive, so only the click is observable |
| Progress reset, bookmarks, theme, reading mode, search queries | Not requested; search queries could contain personal text |
| Page views, scroll, engagement time, outbound clicks | Already collected by the Google tag / Enhanced Measurement |

---

## 3. Where each event is triggered

| Event | Function | Called by |
|---|---|---|
| `lesson_complete` / `lesson_uncomplete` | `progress.js` → `setDone()` (compares old vs new state) | **Mark as completed** button (`page-features.js` → `completeButton()`) |
| `lab_complete` / `lab_uncomplete` | `progress.js` → `toggleLab()` | **Mark done** on lab cards (`page-features.js` → `addLabToggles()`) |
| `code_copy` | `code-viewer.js` → `copyCode()` → `done(ok)` when `ok` | **Copy** button (`onclick="copyCode()"`) |
| `code_file_view` | `code-viewer.js` → `select()` when the file differs | Tab click/keys, `hashchange` |
| `learning_resource_click` | `page-features.js` → `trackResourceClicks()` | One `click` + `auxclick` listener on `document` |

---

## 4. GA4 configuration (manual steps)

Menu names are those of the GA4 admin in 2026; Google renames them occasionally.

### 4.1 Register custom dimensions (required)
Event parameters only appear in reports and explorations after they are registered, and
**registration is not retroactive** — do this before the study starts.

*Admin → Data display → Custom definitions → Custom dimensions → Create custom dimension*

| Dimension name | Scope | Event parameter |
|---|---|---|
| Lesson ID | Event | `lesson_id` |
| Lesson name | Event | `lesson_name` |
| Completion method | Event | `completion_method` |
| Lab number | Event | `lab_number` |
| Code file | Event | `code_file` |
| Code page path | Event | `page_path` |
| Resource type | Event | `resource_type` |
| Resource name | Event | `resource_name` |

(8 of the 50 event-scoped dimensions a standard property allows. "Code page path" must not be named
"Page path" — that name is taken by a built-in dimension.)

**Custom metrics are not needed:** every parameter is categorical, and GA4's built-in *Event count*,
*Total users* and *Sessions* are the measures.

### 4.2 Data retention (strongly recommended)
*Admin → Data collection and modification → Data retention → Event data retention: 14 months.*
The default is 2 months, and explorations (which you need for the analyses below) can't reach
further back than this setting.

### 4.3 Check the second destination
The local test showed that the Google tag sends **every hit (page views and these events) to two
GA4 properties: `G-4JHKFQBZ63` and `G-FEC09FLLMC`**. The second ID is not in this repository; it
comes from the Google tag's own settings (*Admin → Data streams → [web stream] → Configure tag
settings → Manage Google tag → Destinations*). Confirm it is intended, and use one property for the
analysis.

### 4.4 Optional
- **Enhanced measurement** (*Admin → Data streams → [stream] → Enhanced measurement*): if *Outbound
  clicks* is on, external resource clicks also produce GA4's automatic `click` event. That is fine —
  `learning_resource_click` adds type/name/lesson — but never add the two together.
- **Key events**: marking `lesson_complete` / `lab_complete` as key events (*Admin → Data display →
  Events*) makes "Session key event rate" available per source/campaign. Remember they are
  self-reported.
- **Exclude your own testing**: *Admin → Data collection and modification → Data filters* → activate
  the *Developer traffic* filter (removes DebugView traffic), and/or an *Internal traffic* rule for your
  IP address. In explorations you can also filter **Hostname = yousefammmar.github.io** to drop
  `localhost` visits.
- **BigQuery export** (*Admin → Product links → BigQuery links*, free sandbox tier): raw event-level
  data with `user_pseudo_id`, useful for counting distinct browsers per lesson and for reproducible
  analysis.

---

## 5. Testing

### 5.1 Automated (local; sends nothing to Google)

```bash
npm install                      # once; installs Playwright (existing dev dependency)
npm run verify:analytics         # CHROME=/path/to/chrome npm run verify:analytics to use your own Chromium
```

It serves the site locally and drives Chromium with the real `gtag.js`. Every request to a Google
collection endpoint is answered locally, so no test data reaches GA4. It checks:

1. exactly one `page_view` per page load (also after switching code files);
2. lesson complete → reverse → complete gives 1 + 1 + 1 events; repeating a state, opening or refreshing a page gives none; seeded progress is kept;
3. lab complete/reverse for a new and an already-done lab; lab data kept;
4. `code_file_view` on tab click, arrow key and in-page jump, none on first render or same tab; `code_copy` on success (clipboard verified), none on failure;
5. `learning_resource_click` type/name/lesson for 14 representative links, plus middle-click; none for placeholders, pager, sidebar or internal page links;
6. events really leave via `gtag.js` (`/g/collect` hit with `ep.lesson_id`, …);
7. only the 8 documented parameters, no code/e-mail, no new localStorage keys;
8. the site still works with `gtag.js` blocked, with the Google tag removed and with a `gtag` that throws;
9. no uncaught JavaScript errors.

Last run: **53/53 checks passed** (Chromium for Testing, Playwright 1.64). `npm run verify` (content
preservation) produces identical output before and after this change.

### 5.2 Realtime (production)
1. Open the live site in a normal browser window without an ad blocker (Brave Shields, uBlock, etc. block GA).
2. In GA4: *Reports → Realtime overview* → card **Event count by Event name**.
3. Mark a topic complete, toggle a lab, switch and copy a code file, click a resource link.
4. Within about a minute the event names appear; click one to see its parameters and values.

### 5.3 DebugView (production, per-event detail)
1. Turn on debug mode for your browser only: open [Tag Assistant](https://tagassistant.google.com/),
   *Add domain* → `https://yousefammmar.github.io/object_oriented_programming/` → *Connect*
   (or install the *Google Analytics Debugger* Chrome extension and enable it).
2. In GA4: *Admin → Data display → DebugView*, pick your device.
3. Repeat the actions. Each event appears on the timeline within seconds; click it to see all
   parameters. Expected sequence for one topic: `page_view` → `lesson_complete` (`lesson_id`,
   `lesson_name`, `completion_method = manual`).
4. Debug traffic is flagged as developer traffic, so the Developer-traffic filter (4.4) can remove it.

| Action on the site | Expected in DebugView |
|---|---|
| Open any page | `page_view` only — no custom event |
| *Mark as completed* (off → on) | `lesson_complete` |
| *Mark as completed* (on → off) | `lesson_uncomplete` |
| Labs → *Mark done* | `lab_complete` / `lab_uncomplete` with `lab_number` |
| Code Files → another tab | `code_file_view` |
| Code Files → *Copy* | `code_copy` |
| Click a video/PDF/Drive/code chip | `learning_resource_click` (+ GA4 `click` if outbound clicks are on) |

---

## 6. Analysing engagement

Use *Explore → Free form* (or *Funnel exploration*). Always add **Total users** next to **Event count**:
event counts are not student counts.

| Question | Rows | Columns | Values | Filter |
|---|---|---|---|---|
| Which topics are completed? | Lesson name | Event name | Event count, Total users | Event name matches regex `lesson_(un)?complete` |
| Which labs are completed? | Lab number | Event name | Event count, Total users | Event name matches regex `lab_(un)?complete` |
| Which code files are used? | Code file | Event name | Event count | Event name matches regex `code_.*` |
| Which resources are used, per topic? | Lesson ID, Resource type, Resource name | — | Event count, Total users | Event name = `learning_resource_click` |
| Engagement across topics | Page path and screen class | — | Views, Average engagement time per active user | — (built-in) |

**Net completions** ≈ `lesson_complete` − `lesson_uncomplete` per lesson; better: users with a
`lesson_complete` (Total users with that event filter).

**Funnel per topic** (*Funnel exploration*): step 1 `page_view` where page path contains
`class-basics` → step 2 `learning_resource_click` with Lesson ID = `classes` → step 3
`lesson_complete` with Lesson ID = `classes`.

---

## 7. Comparing UTM campaigns

The site does not touch attribution: GA4 reads the UTM parameters from the landing URL and
attributes the session itself.

**Build links consistently** (lower-case, fixed vocabulary), e.g.

```
https://yousefammmar.github.io/object_oriented_programming/?utm_source=instagram&utm_medium=social&utm_campaign=oop_final_2026&utm_content=story_1
```

For deep links put the UTM query **before** the `#`:
`.../code-files.html?utm_source=whatsapp&utm_medium=social&utm_campaign=oop_final_2026#sep`.
Links shared in messaging apps without UTMs usually show up as `(direct) / (none)`.

**Exploration:** rows *Session source / medium* or *Session campaign* (and *Session manual ad
content* for `utm_content`); columns *Event name*; values *Sessions*, *Engaged sessions*,
*Engagement rate*, *Event count*, *Total users*; filter the event names of interest.
Compare **rates** (events per session, users completing ÷ users), not raw counts, because campaigns
bring different amounts of traffic. Use *First user source / medium / campaign* instead when the
question is about the students a campaign *acquired* (later visits included).

---

## 8. Methodological limitations

1. **Self-reported completion.** `lesson_complete` / `lab_complete` are button clicks. They do not
   show understanding, time spent or learning outcomes, and students may tick topics they skipped.
2. **Events are not students.** GA4 "users" are browser instances (a first-party cookie). One student
   on a phone and a laptop counts twice; a shared lab computer merges students; cleared cookies and
   Safari's 7-day cookie cap inflate "new users".
3. **Progress lives in the browser** (localStorage), per device. *Reset progress* sends no events, so a
   student who resets and re-completes produces a second `lesson_complete`. Toggling on/off repeatedly
   produces several events.
4. **Under-counting.** Ad blockers, Brave Shields, tracking protection and blocked scripts stop GA
   entirely for some students, and this is probably not random (e.g. more technical students).
5. **Clicks are not consumption.** `learning_resource_click` means a link was opened, not that a video
   was watched or a PDF read (they are on YouTube/Drive, outside the site). Right-click → "Open in new
   tab" and some mobile long-press opens are not seen.
6. **`resource_type` is rule-based** (section 2). It reflects the site's icons and URLs, not the file's
   actual format.
7. **Code viewer:** browsing tabs with the arrow keys sends one `code_file_view` per file passed. The
   1-second duplicate guard could drop a genuine second copy of the same file within 1 s.
8. **Two destinations.** Data also goes to `G-FEC09FLLMC` (4.3); analyse one property only.
9. **GA4 processing:** custom dimensions are not retroactive; explorations are limited by data
   retention (default 2 months) and may be sampled or thresholded; your own test visits are
   included unless filtered (4.4).
10. **No consent notice is shown.** No personal data is sent by these events, but GA4 itself uses
    cookies and IP-derived location. Check your institution's research-ethics requirements on
    informing participants.
