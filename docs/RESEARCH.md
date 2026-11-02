# Research study — quizzes, study sessions and data export

**Study:** *Evaluating the validity of traditional web-analytics metrics as indicators of meaningful
student engagement in educational websites.*

The site records, for students who opt in, the same kind of numbers web analytics reports (active
time, page views, scroll depth) **per topic**, next to their score on an optional end-of-topic quiz,
so the two can be correlated. The design is **observational**: there is no pre-test, so the data can
show associations between engagement and quiz performance, **not** learning gains or causation.

| Piece | File |
|---|---|
| Question bank (10 topics × 8 questions) | `assets/js/quiz-data.js` |
| Quiz UI (everyone, optional) | `assets/js/quiz.js` |
| Consent, study sessions, Firestore writes | `assets/js/research.js` |
| Settings (`research: { … }`) | `assets/js/config.js` |
| Security rules | `firestore.rules` |
| Admin CSV export | `tools/export_research.cjs` |
| Tests | `tools/test_research.cjs` (Node), `tools/verify_research.cjs` (browser + emulators) |

---

## 1. Before collecting real data

0. **Consent mode** — `askConsent` in `config.js` → `research`:

   | `askConsent` | Behaviour |
   |---|---|
   | `false` (current setting) | **No prompt.** Every visitor takes part by default (`consentStatus: implied`) from their first page load. The sidebar link "Research study: taking part" opens the information sheet, where they can opt out — which stops recording and deletes their data. |
   | `true` | Opt-in. Nothing is recorded until the student clicks *I agree to take part* (invitation card on topic pages + the same dialog). |

   Collecting research data **without asking** normally needs either explicit consent or a formal
   waiver of consent from your ethics board, and may fall under Jordan's Personal Data Protection
   Law. **Implied participation is not formal consent, and this code is not an ethics approval.** Confirm which mode your approval covers before using real students' data; switching to
   `true` later makes default (`implied`) participants stop being recorded until they agree.
1. **Ethics approval.** Get approval from your institution's ethics board for this design, and
   check the participant information text in `research.js` (`open()`) against your protocol.
   Fill in `contact` and `ethics` in `config.js` → `research` (plain text, e.g.
   `contact: 'Your Name, you@psut.edu.jo'`, `ethics: 'Approved by … (ref. …)'`). They are shown in
   the consent dialog only when filled in. If the approved wording differs, edit the text and bump
   `consentVersion` — everyone is then asked again, and nothing is recorded until they answer.
2. **Firebase console, GA4 and export key** — every step outside the code, plus a production
   smoke test and the GA4 DebugView checklist, is in
   [RESEARCH-PRODUCTION.md](RESEARCH-PRODUCTION.md). None of it is done yet.

Turning research off: set `research: null` in `config.js`. The quizzes keep working.

---

## 2. What students see

- **Topic quiz** on each of the ten *Learn* topic pages, just above the previous/next links:
  "Take quiz" → 8 multiple-choice questions → score as a percentage → review of every question
  (their answer, the correct one, a short explanation) → "Retake quiz". Optional for everyone,
  whether or not they take part in the study. It never marks a topic as completed; "Mark as
  completed" stays the only way to do that.
- **Sidebar link** on every page: "Research study: taking part" / "Research study: not taking part"
  (or "About the research study" before an opt-in choice) → the participant information, with
  *Withdraw and delete my data* for participants (also shows their research ID, which they can quote
  to the research team).
- Only with `askConsent: true`: an **invitation** (bottom-right card) on topic pages until the student
  decides: *No thanks* or *Learn more* → the information with *I agree to take part*.

Opting out (or, in opt-in mode, declining or ignoring the card) changes nothing else: no research
code talks to Firebase, nothing is stored, and every feature works. A browser that opted out is
never re-enrolled automatically. Signing in with Google for progress sync is unrelated.

---

## 3. Identity, consent and privacy

- **Pseudonymous research ID.** A participant's browser signs in **anonymously** to a *separate*
  Firebase app instance (`"research"`). The research ID is that random uid. It is never linked to
  the Google account used for sync (different app, different user), and the research documents hold
  no name, email, Google uid, IP address or free text. Security rules reject research writes from
  Google-signed-in accounts.
- **One ID per browser.** A student who takes part on two devices appears as two participants
  (documented limitation, §10). Linking devices would need an identifier tied to the account, which
  the design deliberately avoids.
- **Consent record** `researchParticipants/{researchId}`: `consentStatus` (`granted` = agreed in the
  dialog, `implied` = taking part by default, `withdrawn`), `consentVersion`, `consentedAt` (agreement
  or first page load), `withdrawnAt`. The export includes `granted` and `implied` participants and
  says which in `consent_status`.
- **Withdrawal** (sidebar → *Withdraw and delete my data*): recording stops at once, local research
  data is removed, the consent record is set to `withdrawn`, every session document and the consent
  record are deleted, and the anonymous account is deleted. If the browser is offline, deletion is
  retried on the next visit; until then the record is excluded from the export (not `granted`).
  Align this "delete on withdrawal" behaviour with your ethics protocol.
- **Never recorded:** visitors who never open a topic page (no research account is created until a
  study session needs saving), browsers that keep no storage (every page would otherwise start a new
  participant), search-engine crawlers (user agent containing bot/crawl/spider/slurp/lighthouse),
  and anyone who opted out or withdrew — they are not re-enrolled.
- **GA4** receives the research ID only as the user property `participant_id`, so GA4's data can be
  matched with the study (§6) — never answers, session IDs, names or emails.

---

## 4. Study sessions and metric definitions

A **study session** is one topic, in one browser, for a consenting participant. It is **not** a GA4
session (GA4 sessions span the whole site and use their own ids).

**Lifecycle policy**

| Event | Effect |
|---|---|
| Topic page viewed, no open session for this topic | new session, `pageViews = 1` |
| Topic page viewed, this topic's session active within `sessionMinutes` (30) | **same** session, `pageViews + 1` — covers refresh, back/forward, a second tab, or visiting another page and coming back |
| No activity for longer than `sessionMinutes` | session ends; `endedAt = lastActiveAt` |
| Activity in a tab whose session has timed out | old session closed, new one started (its first page view) |
| Any page load | closes every timed-out session in this browser and saves unsaved ones |
| Another topic opened | that topic gets its own session; the first stays open until it times out |
| Withdrawal | recording stops; data deleted |

So a refresh never creates a new session, and sessions of different topics may overlap in time.

**Definitions** (identical on every topic page)

- **Active engagement time** (`engagementTimeSeconds`): time during which the page was *visible*
  (Page Visibility API) **and** the student had produced input — pointer down/move, key, wheel,
  touch or scroll — within the last `idleSeconds` (60). A stretch is credited up to the moment it went
  idle (last input + 60 s), not until the idleness was noticed; hiding the tab stops counting
  immediately; returning to the tab counts as input. Each millisecond is credited once
  (`Timer` in `research.js`, tested in `tools/test_research.cjs`). Stored as whole seconds (floored).
- **Page views** (`pageViews`): document loads of the topic page (including refreshes, back/forward
  and back/forward-cache restores) while the page is visible — a page opened in a background tab is
  counted when first shown — plus the view that starts a session after a timeout. Counted once per
  document, never by script re-initialisation.
- **Maximum scroll depth** (`maxScrollDepth`, 0–100): the highest percentage of the topic content
  that reached the bottom of the window, where content = from the top of `<main>` to the top of the
  quiz block. Measured continuously (on scroll and at load), not GA4's single 90% event; a page
  shorter than the window scores 100 at load; scrolling back up never lowers it.
- **Topic completion** (`topicCompleted`): whether the topic was marked with *Mark as completed* at the
  session's latest recorded activity (self-reported, independent of the quiz). Toggles during the
  session are also counted (`lesson_complete` / `lesson_uncomplete` interactions).
- **Last activity** (`lastActiveAt`): end of the last credited active moment, or the last page view.

**Saving.** Every change is written to `localStorage` first (at most 5 s of data at risk), then to
Firestore every `saveSeconds` (60) while it changes, whenever the tab is hidden, right after a quiz,
and on the next page load. `pagehide`/`unload` are not relied on. Each write is a complete snapshot
of the session (`set`, no increments), so repeated or lost writes cannot double-count. Up to 200
finished sessions wait locally if Firestore is unreachable (offline, Anonymous sign-in disabled …).

---

## 5. Quiz attempts and scoring

- 8 questions per topic, 4 options each, one correct; same questions in the same order for everyone
  (a fixed instrument — no shuffling). All 8 must be answered to submit.
  **Score** = round(correct / 8 × 100), so possible scores are 0, 13, 25, 38, 50, 63, 75, 88, 100.
- `quizStatus`: `not_started` (never opened in this session — *not* "skipped"), `started`
  (opened, no submission in this session), `completed` (≥ 1 submitted attempt).
- **Repeat attempts are never overwritten.** Each submission is a new entry in `quizAttempts`
  (keyed by a random attempt id; rules forbid changing or removing an entry). Policy for analysis:
  - `quizScore` = the **first** attempt in the session (primary outcome: later attempts follow the
    answer review, so they are inflated);
  - `quizLastScore`, `quiz_best_score` and every attempt are kept for sensitivity analyses;
  - `quizPriorAttempts` = attempts on this topic in *earlier* sessions in this browser. Use
    `quiz_prior_attempts = 0` for a first-ever exposure.
- Duplicate submissions: the form ignores repeat submits of the same attempt, and research.js
  records one entry per started attempt.
- An attempt belongs to the session that is open when it is **submitted**. If a student opens the
  quiz, leaves it idle past the 30-minute timeout and then submits, it is recorded in the new
  session (its `started_at` is then earlier than `session_started_at`).
- **Integrity.** Scores are computed in the browser, so they are not tamper-proof. Mitigations: the
  stored answers are re-scored against `quiz-data.js` at export (`score_verified`); rules bound
  every value, keep counters monotonic and make attempts append-only. True server-side scoring would
  need a Cloud Function (Blaze plan) holding the answer key, which is currently public in
  `quiz-data.js`. Treat `score_verified = 0` rows as invalid.
- **Versioning.** Each topic has a `version`. Changing a topic's questions, options or answers ⇒ bump
  it. Attempts store the version; the export only re-scores matching versions (others get empty
  `score_recomputed`), so analyses never mix question sets.

---

## 6. Google Analytics 4 events

Sent through the existing `analytics.js` (`OOP.analytics.track`) — no second Google tag. Existing
events are unchanged.

| Event | When | Parameters | Who |
|---|---|---|---|
| `quiz_started` | "Take quiz" / "Retake quiz" | `lesson_id` | everyone |
| `quiz_completed` | an attempt is submitted | `lesson_id`, `quiz_score` (0–100) | everyone |
| `study_session_started` | a study session starts | `lesson_id` | participants (everyone not opted out when `askConsent: false`) |
| `study_session_completed` | a study session is closed (often on a later page load) | `lesson_id`, `study_active_sec`, `study_quiz_status` | participants |

No answers or session IDs are sent. `study_session_completed` is usually sent after the timeout, so
GA4 attributes it to a later GA4 session.

**GA4 ↔ Firestore linkage: user property `participant_id`.** For participants only, `research.js`
gives GA4 the research ID (`OOP.analytics.setParticipant`), so GA4's own metrics (engagement time,
views, sessions, scroll, device, traffic source / UTM campaign) can be broken down per participant
and joined with the export on `participant_id` = `research_id`.

- **When it is set:** at the start of every page from the ID saved at registration, and when Firebase
  restores or creates the identity. GA4 sends it once per page load and keeps it for the user's
  later hits. Opting out sends an empty value and it is never set again.
- **Not linked:** GA4's automatic `page_view` of each page (sent by the Google tag before any site
  script runs; GA4's stored value should still apply from the second page on — verify in the pilot)
  and everything before a participant's research ID exists (their first topic visit until the first
  save, ≤ `saveSeconds`).
- **Joining:** use an **inner join** with the Firestore export. Withdrawn participants are deleted
  from Firestore, so their GA4 rows (which GA4 keeps until its retention ends) drop out. Never join
  on `ga_session_id` or `client_id`.
- **Consent:** information sheet version 2 (`consentVersion: 2`) tells participants about the link.
  Make sure your ethics approval covers connecting the research record to GA4's device-level data.

---

## 7. Firestore data model and rules

```
researchParticipants/{researchId}                (researchId = anonymous uid)
  researchId, consentStatus, consentVersion, consentedAt, withdrawnAt?, updatedAt
researchParticipants/{researchId}/sessions/{sessionId}
  researchId, sessionId, topicId, startedAt, lastActiveAt, endedAt,
  engagementTimeSeconds, pageViews, maxScrollDepth,
  quizStatus, quizStartedAt, quizCompletedAt, quizScore, quizLastScore,
  quizAttemptCount, quizPriorAttempts,
  quizAttempts: { <attemptId>: { attemptNumber, quizVersion, score, correctCount,
                                 questionCount, answers[], startedAt, submittedAt } },
  interactions: { lesson_complete: n, learning_resource_click: n, … }, interactionsTracked, topicCompleted,
  consentVersion, schemaVersion, updatedAt
```

All times are Firestore timestamps; `updatedAt` is the server's time, the others come from the
student's device clock (compare with `updatedAt` to spot a wrong clock). This is separate from the
sync data (`users/{uid}`), which is unchanged.

`firestore.rules` (research part):

- only the owning **anonymous** account can read, create, update or delete its records; nothing is
  readable by anyone else or without sign-in; Google accounts cannot write research data;
- consent can be created only as `granted` or `implied`, later re-confirmed or set to `withdrawn` — never back;
- session documents: fixed set of fields with types and ranges (score 0–100, scroll 0–100, page
  views ≥ 1, engagement ≤ 24 h …), `researchId`/`sessionId` must match the path, `updatedAt` must be
  the server time, `completed` ⇔ at least one attempt, attempt count = number of attempts;
- on update: identity fields, topic and start time cannot change; engagement, page views and scroll
  depth cannot decrease; recorded attempts cannot be changed or removed.

The export uses admin credentials, which bypass rules by design.

---

## 8. Exporting the data (admin only)

```bash
GOOGLE_APPLICATION_CREDENTIALS=~/secure/oop-research-sa.json node tools/export_research.cjs
```

(`npm run export:research` does the same when the variable is set.) It writes three files to
`research-export/` (git-ignored) and prints how many participants/sessions were left out, how many
participants have a first quiz attempt and how many have GA4 data:

- `research_sessions.csv` and `research_quiz_attempts.csv` — from Firestore;
- `research_participants.csv` — **one row per participant, ready for SPSS/JASP**: their Firestore
  totals joined with their GA4 metrics (GA4 Data API, user property `participant_id` = `research_id`,
  from the day of the first exported session until today). Withdrawn participants' GA4 rows drop out.

No npm packages: it signs a token with the service-account key and calls the Firestore and GA4 Data
REST APIs. Against the emulator: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node tools/export_research.cjs --project demo-oop`
(GA4 skipped).

**One-time GA4 setup** (otherwise the export still runs, warns, and leaves the GA4 columns empty):
1. Google Cloud console → project `object-oriented-programm-95ff5` → *APIs & Services → Library* →
   **Google Analytics Data API** → *Enable*.
2. GA4 → *Admin → Property access management* (property "Object Oriented", `G-FEC09FLLMC`,
   id `558651328`) → *+ Add users* → the service account's `client_email` from the key file →
   role **Viewer**.
3. Another property: `--ga4-property <numeric property id>`.

CSV conventions: UTF-8, comma-separated, header row, RFC 4180 quoting; **missing = empty cell**
(pandas → `NaN`, SPSS → system-missing), never 0; times in UTC as `YYYY-MM-DD HH:MM:SS`; one row
per session (or attempt), so topic analysis is a filter/group on `topic_id`.

```python
import pandas as pd
s = pd.read_csv('research-export/research_sessions.csv', parse_dates=['session_started_at', 'quiz_completed_at'])
first = s[(s.quiz_status == 'completed') & (s.quiz_prior_attempts == 0) & (s.quiz_score_verified == 1)]
print(first[['engagement_time_seconds', 'page_views', 'max_scroll_depth', 'quiz_score']].corr(method='spearman'))
```

SPSS: *File → Import Data → CSV*, first row = variable names; set the `*_at` columns to type
*Date* with format `yyyy-mm-dd hh:mm:ss`.

---

## 9. Data dictionary

**`research_participants.csv`** — one row per participant with at least one exported session.

| Column | Type | Meaning |
|---|---|---|
| `research_id` | text | as in the sessions file; equals GA4's `participant_id` |
| `sessions`, `topics_studied` | integer | study sessions, distinct topics |
| `engagement_time_seconds`, `page_views` | integer | sums over sessions (Firestore, §4) |
| `max_scroll_depth_mean` | number | mean of the sessions' max scroll depth % |
| `quizzes_first_attempt` | integer | topics with a verified first attempt (`quiz_prior_attempts = 0`, `quiz_score_verified = 1`) |
| `quiz_first_score_mean` | number / empty | mean score of those first attempts; empty = none |
| `quiz_attempts` | integer | all submitted attempts, retakes included |
| `topics_completed` | integer | topics marked completed (self-reported) |
| `learning_resource_clicks`, `code_copies` | integer / empty | sums over sessions with interaction tracking; empty if never tracked |
| `ga4_linked` | 1 / 0 / empty | 1 = GA4 has data under this `participant_id`; empty = GA4 not fetched |
| `ga4_engagement_seconds` | integer / empty | GA4 `userEngagementDuration` |
| `ga4_views`, `ga4_sessions`, `ga4_engaged_sessions` | integer / empty | GA4 `screenPageViews`, `sessions`, `engagedSessions` |
| `ga4_scroll_events` | integer / empty | GA4 `scroll` events (90 % depth, Enhanced measurement) |
| `ga4_device` | text / empty | `deviceCategory` with the most GA4 sessions |
| `ga4_lesson_completions`, `ga4_lab_completions`, `ga4_code_file_views`, `ga4_resource_clicks` | integer / empty | GA4 `lesson_complete`, `lab_complete`, `code_file_view`, `learning_resource_click` events on **every** page (RQ3); the Firestore counts only cover topic-page study sessions |

GA4 columns cover only hits that carried `participant_id` (§6): check `ga4_views` against
`page_views` in the pilot before relying on it.

**`research_sessions.csv`** — one row per study session of a consenting participant.

| Column | Type | Meaning |
|---|---|---|
| `research_id` | text | pseudonymous participant id (one per browser) |
| `session_id` | text (UUID) | study session id, unique |
| `topic_id` | text | `cpp`, `classes`, `const`, `composition`, `dma`, `this`, `friend`, `inheritance`, `polymorphism`, `operators` |
| `session_started_at` | datetime UTC | first page view of the session (device clock) |
| `session_last_active_at` | datetime UTC | last credited activity or page view |
| `session_ended_at` | datetime UTC / empty | end of the session; empty while still open |
| `session_end_source` | text | `recorded` (closed by the site), `inferred` (open but inactive > 30 min at export → end = last activity), `open` (possibly still in progress) |
| `engagement_time_seconds` | integer ≥ 0 | active engagement time (§4) |
| `page_views` | integer ≥ 1 | qualifying page views in the session (§4) |
| `max_scroll_depth` | integer 0–100 | maximum scroll depth % (§4) |
| `quiz_status` | text | `not_started`, `started`, `completed` (§5) |
| `quiz_score` | integer 0–100 / empty | first attempt in this session; empty = no completed attempt (**not** 0) |
| `quiz_score_verified` | 1 / 0 / empty | 1 = re-scored from the answers and matches; 0 = mismatch (exclude); empty = no attempt or older quiz version |
| `quiz_last_score` | integer / empty | last attempt in the session |
| `quiz_best_score` | integer / empty | best attempt in the session |
| `quiz_attempt_count` | integer ≥ 0 | submitted attempts in the session |
| `quiz_prior_attempts` | integer ≥ 0 | attempts on this topic in earlier sessions (same browser) |
| `quiz_started_at` | datetime / empty | first time the quiz was opened in the session |
| `quiz_completed_at` | datetime / empty | submission time of the first attempt |
| `topic_completed` | 1 / 0 / empty | topic marked "completed" at the session's latest activity (self-reported); empty for records saved before this field existed |
| `interactions_tracked` | 1 / 0 | 0 = interaction counting was unavailable (analytics.js blocked) → the `*_count` columns are empty |
| `lesson_complete_count`, `lesson_uncomplete_count` | integer / empty | "Mark as completed" turned on / off during the session |
| `learning_resource_click_count` | integer / empty | notes, videos, code examples, past quizzes/labs opened from the page |
| `code_copy_count`, `code_file_view_count`, `lab_complete_count`, `lab_uncomplete_count` | integer / empty | other site interactions during the session (rare on topic pages) |
| `consent_status` | text | `granted` (agreed in the dialog) or `implied` (taking part by default, `askConsent: false`) |
| `consent_version` | integer | information-sheet version shown when they agreed / were enrolled |
| `schema_version` | integer | record format (currently 1) |
| `updated_at` | datetime UTC | server time of the last save |

**`research_quiz_attempts.csv`** — one row per submitted attempt (join to sessions on `session_id`).

| Column | Type | Meaning |
|---|---|---|
| `research_id`, `session_id`, `topic_id` | | as above |
| `attempt_id` | text (UUID) | unique attempt id |
| `attempt_number` | integer ≥ 1 | order within the session |
| `quiz_prior_attempts` | integer | attempts on this topic before this session |
| `quiz_version` | integer | question-set version the attempt used |
| `question_count`, `correct_count` | integer | as reported by the browser |
| `score_reported` | integer 0–100 | score computed in the browser |
| `score_recomputed` | integer / empty | score from the stored answers and the current answer key (empty if the version changed) |
| `score_verified` | 1 / 0 / empty | reported = recomputed |
| `started_at`, `submitted_at` | datetime UTC | attempt start ("Take/Retake quiz") and submission |
| `duration_seconds` | integer / empty | submitted − started |
| `answers` | text | chosen option index per question, `;`-separated (0 = first option) |
| `item_correct` | text | 1/0 per question, `;`-separated — for item analysis |

---

## 10. Methodology and limitations (report these)

**Design statements**

- The study is **observational**. Nothing is assigned or manipulated.
- **Quiz participation is optional**, so the quiz-score sample is self-selected (**self-selection
  bias**).
- **Quiz performance is not learning improvement.** There is no pre-test, so a score is a one-time
  outcome, not a gain.
- **Engagement does not establish causation.** Associations between engagement metrics and scores
  can reflect prior knowledge, motivation or other confounders.
- **Predictive validity needs validation.** If a model is used to *predict* quiz performance from
  engagement metrics, report its performance on held-out data (k-fold cross-validation or a
  held-out participant set), not only in-sample R².
- **Implied participation** (`askConsent: false`) is not formal consent and does not replace ethics
  approval.

**Analysis notes for the supported analyses**

- *Unit of analysis* is the study session. Sessions are **nested in participants** (and topics), so
  observations are not independent: use cluster-robust standard errors by `research_id`, or mixed
  models with participant and topic effects.
- *Descriptive statistics:* report per topic and overall; include the share of sessions with
  `quiz_status = completed` and compare engagement between quiz-takers and non-takers (selection).
- *Correlation:* engagement time, page views and scroll depth are skewed — prefer Spearman, or
  log-transform time (`log1p`).
- *Multiple regression* (traditional metrics → quiz score): restrict to first exposure
  (`quiz_prior_attempts = 0`, verified scores), check collinearity between the engagement metrics
  (VIF), and keep topic as a factor because topics differ in difficulty.
- *Comparing traditional vs learning-specific indicators:* `topic_completed` (self-reported) and the
  interaction counts are the learning-specific behaviour indicators; the quiz score is the outcome.

**Measurement limitations**

- **No pre-test**: the data cannot measure learning gain; quiz score is an outcome measured once.
- **Self-selection**: quiz-taking is optional (and so is consent in opt-in mode); quiz-takers may be
  more motivated than other students. Compare `quiz_status` groups and report the proportions.
  With `askConsent: false`, report that participation was by default with opt-out.
- **Active time is an approximation**: a visible page with recent input is not proof of attention
  (an idle mouse over the page counts for up to `idleSeconds`); reading without touching anything
  for longer than `idleSeconds` is not counted; a visible-but-unfocused window still counts while
  input reaches it; two visible windows of the same topic can both count.
- **Device clocks** set the client timestamps; `updatedAt` (server) can reveal skew.
- **One ID per browser**: a student on two devices is two participants; clearing site data creates
  a new participant (the old one keeps its data until exported/withdrawn).
- **Unfinished sessions**: if a student never returns, the last ≤ 60 s may be unsaved and the session
  stays open (`session_end_source = inferred` at export).
- **Interaction counts** depend on `analytics.js` loading (ad blockers can block it); flagged by
  `interactions_tracked`.
- **Scores are client-side** and the answer key is public (§5).
- **GA4 metrics are different**: GA4's engagement time and sessions use other rules. Compare them
  per participant through `participant_id` (§6), not GA4's totals against this dataset's.

---

## 11. Testing

| Command | What it checks |
|---|---|
| `npm run test:research` | timer (idle, hidden, no double counting), question bank shape, scoring, export logic (consent filter, missing values, re-scoring, CSV) |
| `npm run emulators` then `npm run verify:research` | 133 browser checks against the Firebase emulators: quizzes on all 10 topics; both consent modes (opt-in: consent / decline; default: no prompt, opt-out deletes, earlier "no" respected); sessions, page views, active time, idle, hidden tab, scroll depth, topic completion, quiz attempts, interactions, second tab, session timeout; offline save and resync; no research account for Home-only visitors, crawlers or blocked storage; 26 security-rule cases; GA4 payloads (valid, no ids/answers/emails, no duplicates); GA4 user property `participant_id` (set for participants only, from the start of each page, cleared on withdrawal, never set again after opting out); CSV export (unique ids, ranges, no personal data); withdrawal; Google sync still working and separate; existing features (completion, bookmarks, dashboard, achievements, pager, theme, search, code viewer) |
| `npm run verify:analytics`, `npm run test:sync`, `npm run verify` | existing GA4, sync and content-preservation suites |

The browser suite rewrites `config.js` on the fly (emulators, project `demo-oop`, short timings) and
blocks Google's tag, so it never touches the real project or GA4. **Not tested by these scripts:**
GA4 DebugView and the production Firestore project. After deploying, check GA4 with Tag Assistant
(DebugView), and do one real consent → quiz → withdraw run on the live site while watching
*Firestore → Data*.
