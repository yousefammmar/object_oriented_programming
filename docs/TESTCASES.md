# Test cases — GA4 engagement tracking

The 90 automated test cases for the custom GA4 events (see [GA4-ENGAGEMENT-TRACKING.md](GA4-ENGAGEMENT-TRACKING.md)),
what each one does and should output, the result of every testing round, and every issue found and how it was fixed.

All cases live in [`tools/verify_analytics.cjs`](../tools/verify_analytics.cjs).

```bash
npm install && npx playwright install chromium   # once
npm run verify:analytics                         # all 90 cases (~4 min)
node tools/verify_analytics.cjs 18 83            # only some cases
```

**How the tests work.** The script serves the site locally (also under `/object_oriented_programming/`,
the GitHub Pages path) and drives the real pages in Chromium with the real `gtag.js`. Every request to a
Google collection endpoint is answered locally with "204 No Content", so **no test data reaches the GA4
properties**. Custom events are read from `window.dataLayer` (what `gtag` receives); the intercepted
`/g/collect` requests show exactly what GA4 would receive. Every case starts from its own localStorage
state and **fails automatically on any uncaught JavaScript error**.

---

## Summary

| Phase | Area | Cases | Round 1 (first full run) | Final run |
|---|---|---|---|---|
| 1 | Page load and page views | TC01–TC17 (17) | 17 / 17 ✅ | 17 / 17 ✅ |
| 2 | Lesson completion | TC18–TC34 (17) | 17 / 17 ✅ | 17 / 17 ✅ |
| 3 | Lab completion | TC35–TC47 (13) | 13 / 13 ✅ | 13 / 13 ✅ |
| 4 | Code viewer | TC48–TC63 (16) | 16 / 16 ✅ | 16 / 16 ✅ |
| 5 | Learning-resource links | TC64–TC79 (16) | 14 / 16 ❌ (TC74, TC79) | 16 / 16 ✅ |
| 6 | GA missing, blocked or broken | TC80–TC87 (8) | 6 / 8 ❌ (TC83, TC87) | 8 / 8 ✅ |
| 7 | Privacy and GA4 data | TC88–TC90 (3) | 1 / 3 ❌ (TC89, TC90) | 3 / 3 ✅ |
| | **Total** | **90** | **84 / 90** | **90 / 90** |

**Testing rounds**

| Round | What ran | Result |
|---|---|---|
| 0 | First smoke test (53 checks, earlier version of the script) | Found the second GA4 destination and three test-setup problems (issues 6–9); then 53/53 |
| 1 | First full run of the 90 cases | 84/90 — 6 failures → issues 1–5 |
| 2 | Fixes applied; re-run of the 6 failed cases plus the 3 copy cases touched by the fix (TC56–58, 74, 79, 83, 87, 89, 90) | 9/9 |
| 3 | Full run of all 90 cases + the repo's content-preservation check | 90/90; preservation output identical to `main` |

---

## Issues found and how they were fixed

| # | Found in | Issue | Kind | Fix | Verified by |
|---|---|---|---|---|---|
| 1 | Phase 6 · TC83 · Round 1 | **Blocking `assets/js/analytics.js` broke the site.** Ad blockers often block any file named `analytics.js`; then *Mark as completed*, lab *Mark done*, code-tab switching and *Copy* threw `Cannot read properties of undefined (reading 'track')` and stopped working. | Site bug (critical) | Every caller checks `OOP.analytics` before tracking (`progress.js` ×2, `code-viewer.js` ×2, `page-features.js` ×1). | TC83 ✅ |
| 2 | Phase 7 · TC90 · Round 1 | **`page_path` never reached GA4 as a custom parameter.** `gtag.js` reserves that name: the `code_copy` hit carried it as its own `dp` field and no `ep.page_path`, so a custom dimension on it would stay empty. Not visible in `dataLayer` (TC56–58 passed); only the real network hit showed it. | GA4 data bug | Parameter renamed to `code_page_path`; custom-dimension table in the guide updated; rule added to `analytics.js`: never use names `gtag.js` reserves. | TC90 ✅ (`ep.code_page_path` on the wire), TC56–58 ✅ |
| 3 | Phase 5 · TC74, TC79 · Round 1 | **Vague resource names.** The handwritten-notebook link on C++ Revision, Class Basics and Composition was reported only as `"notebook"`. | Data quality | A link inside a highlighted note is named by the note's sentence, e.g. `Pages 10–19 in Dana AL-taher's notebook cover this topic.` | TC74 ✅, TC79 ✅ |
| 4 | Phase 7 · TC89 · Round 1 | **`track()` accepted bad input.** `track(null)` sent an event named `"null"` (the name check converted `null` to text); NaN/Infinity values, invalid parameter keys and a string instead of a parameter object were passed on. | Robustness | Name must be a string; parameter keys must follow the GA4 rule (snake_case, ≤ 40 chars); numbers must be finite; non-object parameters are ignored. | TC89 ✅ |
| 5 | Phase 6 · TC87 · Round 1 | **Test could not click before `gtag.js` loaded.** Playwright's `goto` waits for the page's `load` event, which includes `gtag.js`, so the "slow network" scenario never happened. | Test setup | TC87 opens the page with `waitUntil: 'domcontentloaded'`. | TC87 ✅ |
| 6 | Round 0 | **Every hit is also sent to a second GA4 property, `G-FEC09FLLMC`.** It is not in the repository; it comes from the Google tag's own settings in GA (*Destinations*). Page views and custom events both go there. | Finding (GA account setting) | Not a code issue — **owner must confirm** it is intended. Tests count only hits for `G-4JHKFQBZ63` and print a note about the second destination. | Note on every run |
| 7 | Round 0 | **Every hit appeared twice.** The test's local "204" reply had no CORS headers, so `gtag.js` treated the request as failed and resent it another way. | Test setup | The fake reply now carries the same CORS headers Google sends. | Round 0 re-run |
| 8 | Round 0 | **First page view "missing".** A fixed 2.5 s wait was shorter than `gtag.js` batching. | Test setup | Tests poll for hits (up to 10–20 s) instead of fixed waits. | Round 0 re-run |
| 9 | Round 0 | **Playwright 1.64 could not start its browser** (its Chromium build was not installed). | Environment | Ran with `CHROME=` pointing to an installed Chromium for Testing; the guide now says `npx playwright install chromium`. | All rounds |
| 10 | Round 0 | **`npm run verify` (content preservation) reports 27 differences.** | Pre-existing, not caused by this work | Output is byte-identical on `main` and on this branch: the differences are content changes made before this work (e.g. "Winter 2026", new topics). Left as is (out of scope). | Round 0 and Round 3 |

**Known behaviour kept on purpose** (documented, not bugs): *Reset progress* sends no events; browsing code
tabs with arrow keys sends one `code_file_view` per file passed; an identical event within 1 second is sent once.

---

## Phase 1 — Page load and page views (TC01–TC17)

**TC01–TC16** run the same check on each page. **Steps:** clear localStorage, open the page.
**Expected output:** `analytics.js` is the script right after `config.js` and before `progress.js`; exactly **one**
`page_view` hit for `G-4JHKFQBZ63` whose URL is that page (checked again 1.5 s later for duplicates);
**zero** custom events on load; no JavaScript error.

| ID | Page | Round 1 | Final |
|---|---|---|---|
| TC01 | `index.html` | ✅ | ✅ |
| TC02 | `cpp-revision.html` | ✅ | ✅ |
| TC03 | `class-basics.html` | ✅ | ✅ |
| TC04 | `const-static.html` | ✅ | ✅ |
| TC05 | `composition.html` | ✅ | ✅ |
| TC06 | `dynamic-memory.html` | ✅ | ✅ |
| TC07 | `this-pointer.html` | ✅ | ✅ |
| TC08 | `friend-functions.html` | ✅ | ✅ |
| TC09 | `inheritance.html` | ✅ | ✅ |
| TC10 | `polymorphism.html` | ✅ | ✅ |
| TC11 | `operator-overloading.html` | ✅ | ✅ |
| TC12 | `labs.html` | ✅ | ✅ |
| TC13 | `code-files.html` | ✅ | ✅ |
| TC14 | `revision-hall.html` | ✅ | ✅ |
| TC15 | `examination-hall.html` | ✅ | ✅ |
| TC16 | `all-links.html` | ✅ | ✅ |

| ID | What it does | Expected output | Round 1 | Final |
|---|---|---|---|---|
| TC17 | Opens the old redirect pages `cpp-basics.html` and `class-revision.html` | They forward to `cpp-revision.html` / `class-basics.html`, which load normally | ✅ | ✅ |

---

## Phase 2 — Lesson completion (TC18–TC34)

**TC18–TC28.** **Steps:** clear storage, open the topic page, click **Mark as completed** once.
**Expected output:** exactly one `lesson_complete` with the values below and `completion_method: "manual"`;
the topic is saved as completed and the button shows as pressed.

| ID | Page | `lesson_id` | `lesson_name` | Round 1 | Final |
|---|---|---|---|---|---|
| TC18 | `cpp-revision.html` | `cpp` | C++ Revision | ✅ | ✅ |
| TC19 | `class-basics.html` | `classes` | Class Basics | ✅ | ✅ |
| TC20 | `const-static.html` | `const` | Const & Static | ✅ | ✅ |
| TC21 | `composition.html` | `composition` | Composition | ✅ | ✅ |
| TC22 | `dynamic-memory.html` | `dma` | Dynamic Memory | ✅ | ✅ |
| TC23 | `this-pointer.html` | `this` | this Pointer | ✅ | ✅ |
| TC24 | `friend-functions.html` | `friend` | Friend Functions | ✅ | ✅ |
| TC25 | `inheritance.html` | `inheritance` | Inheritance | ✅ | ✅ |
| TC26 | `polymorphism.html` | `polymorphism` | Polymorphism | ✅ | ✅ |
| TC27 | `operator-overloading.html` | `operators` | Operator Overloading | ✅ | ✅ |
| TC28 | `labs.html` | `labs` | Labs | ✅ | ✅ |

| ID | What it does | Expected output | Round 1 | Final |
|---|---|---|---|---|
| TC29 | Inheritance already completed (seeded); click the button | One `lesson_uncomplete` {inheritance, Inheritance, manual}; no longer saved | ✅ | ✅ |
| TC30 | 5 rapid clicks on Polymorphism | Exactly 5 events: complete, uncomplete, complete, uncomplete, complete; final state completed | ✅ | ✅ |
| TC31 | Keyboard: focus the button, press Space, then Enter | `lesson_complete` then `lesson_uncomplete` | ✅ | ✅ |
| TC32 | Call `setDone` with no state change (cpp → done again, dma → not done again) and with an unknown id | No event | ✅ | ✅ |
| TC33 | Dynamic Memory completed (seeded); open and reload the page | No event; button still shows completed | ✅ | ✅ |
| TC34 | Home → *Reset progress* → Cancel, then *Reset progress* → confirm | Cancel keeps progress; confirm clears topics and labs; **no event**; bookmarks kept | ✅ | ✅ |

---

## Phase 3 — Lab completion (TC35–TC47)

**TC35–TC44.** **Steps:** clear storage, open Labs, click the lab's **Mark done** twice.
**Expected output:** first click → one `lab_complete` {lab_number, manual}, saved and shown as done;
second click → one `lab_uncomplete` with the same values, no longer saved.

| ID | Lab | `lab_number` | Round 1 | Final |
|---|---|---|---|---|
| TC35 | Lab 01 · C++ Revision | `01` | ✅ | ✅ |
| TC36 | Lab 02 · Pointers & Memory | `02` | ✅ | ✅ |
| TC37 | Lab 03 · Classes Intro | `03` | ✅ | ✅ |
| TC38 | Lab 04 · Ctors & Dtors | `04` | ✅ | ✅ |
| TC39 | Lab 05 · Const & Static | `05` | ✅ | ✅ |
| TC40 | Lab 06 · Composition | `06` | ✅ | ✅ |
| TC41 | Lab 07 · Overloading | `07` | ✅ | ✅ |
| TC42 | Lab 08 · Inheritance 1 | `08` | ✅ | ✅ |
| TC43 | Lab 09 · Inheritance 2 | `09` | ✅ | ✅ |
| TC44 | Lab 10 · Polymorphism | `10` | ✅ | ✅ |

| ID | What it does | Expected output | Round 1 | Final |
|---|---|---|---|---|
| TC45 | 4 rapid clicks on Lab 06 | Exactly 4 alternating `lab_complete` / `lab_uncomplete`; final state not done | ✅ | ✅ |
| TC46 | On Labs: page *Mark as completed*, then Lab 02 *Mark done*; look at the Operator Overload card | `lesson_complete` {labs} then `lab_complete` {02} only; the Operator Overload topic card has no lab toggle | ✅ | ✅ |
| TC47 | Seed progress, bookmarks and theme; complete/uncomplete a topic and a lab, switch a code tab | Progress, bookmarks and theme unchanged; no unknown localStorage keys | ✅ | ✅ |

---

## Phase 4 — Code viewer (TC48–TC63)

| ID | What it does | Expected output | Round 1 | Final |
|---|---|---|---|---|
| TC48 | Open Code Files | Revision1.cpp shown; **no** `code_file_view` | ✅ | ✅ |
| TC49 | Open `code-files.html#sep:12` | Separation file shown, line 12 highlighted; no event | ✅ | ✅ |
| TC50 | Open `code-files.html#bogus` | Default file shown; no event; no error | ✅ | ✅ |
| TC51 | Click each of the 19 tabs | 19 events, each `code_file_view` naming the file now shown | ✅ | ✅ |
| TC52 | Click the already-open tab twice | No event | ✅ | ✅ |
| TC53 | Arrow Right, Left, Left (wraps to the last tab) | 3 events: Revision2.cpp, Revision1.cpp, OperatorOverloading.cpp | ✅ | ✅ |
| TC54 | From Separation: End, then Home | OperatorOverloading.cpp, then Revision1.cpp | ✅ | ✅ |
| TC55 | Change the URL to `#dma:3`, `#dma:5`, `#bogus` (how search jumps) | One event for DynamicMemory.cpp; none for the same file at another line (line 5 highlighted); none for an unknown file | ✅ | ✅ |
| TC56 | Copy DynamicMemory.cpp | One `code_copy` {code_file: DynamicMemory.cpp, code_page_path: /code-files.html}; clipboard holds the exact code; button says "Copied!" | ✅ ¹ | ✅ |
| TC57 | Copy, switch to ThisPointer, copy | `code_copy` (Revision1.cpp), `code_file_view` (ThisPointer.cpp), `code_copy` (ThisPointer.cpp) | ✅ ¹ | ✅ |
| TC58 | Copy with no Clipboard API (old browser / `file://`) | Fallback copy works → one `code_copy`; "Copied!" | ✅ ¹ | ✅ |
| TC59 | Clipboard API refuses, fallback works | One `code_copy`; "Copied!" | ✅ | ✅ |
| TC60 | Both copy methods fail | **No** `code_copy`; button says "Copy failed" | ✅ | ✅ |
| TC61 | Double-click Copy; copy again after 1 s | One event for the double-click (duplicate guard); one more after 1 s | ✅ | ✅ |
| TC62 | Use wrap, full screen, code bookmark, line highlight, theme (T), reading mode (R), search (Ctrl/⌘K), shortcuts (?), All Links filter, page bookmark | No custom event at all | ✅ | ✅ |
| TC63 | Call `window.ct('sep')` from code | File switches; no event (only student actions count) | ✅ | ✅ |

¹ Passed in Round 1 with the old parameter name `page_path`: `dataLayer` looked right, but the real
network hit did not carry it (issue 2, found by TC90). Re-run with `code_page_path` in Round 2.

---

## Phase 5 — Learning-resource links (TC64–TC79)

**TC64–TC73.** **Steps:** open the page, click the link. **Expected output:** exactly one
`learning_resource_click` with exactly these parameters (`lesson_id` only on topic pages).

| ID | Page → link | `resource_type` | `resource_name` | `lesson_id` | Round 1 | Final |
|---|---|---|---|---|---|---|
| TC64 | C++ Revision → chip "Intro" (YouTube) | `video` | Intro | `cpp` | ✅ | ✅ |
| TC65 | C++ Revision → chip "C++_Basics_Guide.pdf" | `pdf` | C++_Basics_Guide.pdf | `cpp` | ✅ | ✅ |
| TC66 | C++ Revision → chip "Revision1" (code example) | `code_example` | Revision1 | `cpp` | ✅ | ✅ |
| TC67 | C++ Revision → chip "Quiz1_2025" | `quiz` | Quiz1_2025 | `cpp` | ✅ | ✅ |
| TC68 | C++ Revision → chip "LAB1_2025" | `lab` | LAB1_2025 | `cpp` | ✅ | ✅ |
| TC69 | All Links → "OOP — Revision (Doc)" (Google Doc) | `document` | OOP — Revision (Doc) | — | ✅ | ✅ |
| TC70 | Labs → Lab 01 card → "Video Walkthrough" | `video` | Lab 01 · C++ Revision — Video Walkthrough | `labs` | ✅ | ✅ |
| TC71 | All Links → "Lecture Slides (Drive)" | `slides` | Lecture Slides (Drive) | — | ✅ | ✅ |
| TC72 | All Links → "Past Labs (Drive)" (Drive folder) | `folder` | Past Labs (Drive) | — | ✅ | ✅ |
| TC73 | All Links → "GitHub Repository" | `external_website` | GitHub Repository | — | ✅ | ✅ |

| ID | What it does | Expected output | Round 1 | Final |
|---|---|---|---|---|
| TC74 | All Links → "Dr. Ibrahim — Full Playlist" (text split over two lines in the HTML); Class Basics → the notebook link inside the highlighted note | Names `Dr. Ibrahim — Full Playlist` and `Pages 10–19 in Dana AL-taher's notebook cover this topic.` | ❌ name was `notebook` (issue 3) | ✅ |
| TC75 | Click the ▶ icon inside the "Functions" chip | One event for "Functions" | ✅ | ✅ |
| TC76 | Middle-click "Arrays"; right-click "Pointers 1" | One event (opens in new tab); none for right-click | ✅ | ✅ |
| TC77 | Ctrl/⌘-click "Pointers 2"; focus "Intro" and press Enter | One event each | ✅ | ✅ |
| TC78 | Click the Home dashboard *Resume* link (to a code file), a "Key Concepts" placeholder, the previous/next pager, a sidebar link, the footer signature, and "Specific Lab Index" (internal page) | No event — these are navigation, not resources | ✅ | ✅ |
| TC79 | **Sweep:** clicks every link in the content of all 16 pages (251 resource links + all other links) | Each resource link → exactly one event with a valid `resource_type`, a non-empty, specific `resource_name` (≤ 100 chars, not generic like "notebook"), and `lesson_id` only on topic pages; every other link → no event | ❌ 3 links named `notebook` (issue 3) | ✅ |

Final sweep counts: video 94 · document 39 · pdf 35 · code_example 28 · lab 21 · folder 17 · quiz 9 ·
external_website 6 · slides 2 (251 links).

---

## Phase 6 — GA missing, blocked or broken (TC80–TC87)

"Site still works" below means: *Mark as completed* saves and shows the topic with its toast, a resource
link click does not error, a lab *Mark done* saves and shows, a code tab switches the file, and *Copy* says "Copied!".

| ID | What it does | Expected output | Round 1 | Final |
|---|---|---|---|---|
| TC80 | Block `gtag.js` (like an ad blocker) | Site still works; no error | ✅ | ✅ |
| TC81 | Remove the Google tag from the page (no `window.gtag`) | Site still works; `track()` returns false | ✅ | ✅ |
| TC82 | Replace `gtag` with a function that throws | Lab and topic buttons and code tabs still work; `track()` returns false | ✅ | ✅ |
| TC83 | Block `assets/js/analytics.js` itself | Site still works; no error | ❌ *Mark as completed* threw an error and stopped (issue 1) | ✅ |
| TC84 | Make localStorage unavailable (strict privacy mode) | Events still follow state changes: complete → uncomplete; lab → `lab_complete` {02} | ✅ | ✅ |
| TC85 | Save corrupt progress data (`{not json`), then complete Class Basics | One `lesson_complete`; progress saved correctly | ✅ | ✅ |
| TC86 | Set GA's opt-out flag before the tag, then complete a topic | Event reaches `gtag`, but **no hit** reaches GA4 within 5 s; button works | ✅ | ✅ |
| TC87 | Delay `gtag.js` by 3 s and click *Mark as completed* before it arrives | The click happens before `gtag.js` loads; the queued `lesson_complete` is sent once it loads | ❌ test clicked after `gtag.js` had loaded (issue 5) | ✅ |

---

## Phase 7 — Privacy and GA4 data (TC88–TC90)

| ID | What it does | Expected output | Round 1 | Final |
|---|---|---|---|---|
| TC88 | Checks every custom event recorded during the whole run (plus a short session of its own) | Only the 7 documented event names and 8 documented parameters; ≤ 25 parameters; values are booleans, finite numbers or trimmed strings ≤ 100 chars with no line breaks, no C++ code (`#include`, `cout`), no `@` | ✅ | ✅ |
| TC89 | Calls `OOP.analytics.track()` directly with bad names (`Bad Name`, empty, 41 chars, `1abc`, `null`), messy parameters, a string instead of parameters, and repeated events | Bad names rejected; only `s` ("a b"), `long` (cut to 100), `n`, `b` kept; string parameters ignored; identical event within 1 s dropped, sent again after 1 s or after a different event | ❌ `track(null)` was accepted (issue 4) | ✅ |
| TC90 | Real GA4 network hits under `/object_oriented_programming/` after landing with `?utm_source=qa&utm_medium=test&utm_campaign=tc90`: lab 03, code chip, copy | Landing `page_view` keeps the full UTM URL; every hit has the same client id and session id (so events are attributed to the campaign session); `ep.lab_number=03` sent as text; `ep.resource_type=code_example`, `ep.lesson_id=cpp`; `ep.code_page_path=/object_oriented_programming/code-files.html`; no undocumented parameters | ❌ `page_path` was sent as `dp`, not as a parameter (issue 2) | ✅ |
