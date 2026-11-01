# Research system — production steps and verification

Everything here happens **outside the code** (Firebase console, GA4, your machine). None of it has
been done or tested yet; the code was verified only against the local Firebase emulators
(see [RESEARCH.md §11](RESEARCH.md#11-testing)). Project: `object-oriented-programm-95ff5`.

## 1. Before any real student data

| # | Step | Where | Why |
|---|---|---|---|
| 1 | Ethics approval that covers **participation by default with opt-out** (`askConsent: false`), or switch to `askConsent: true` | your ethics board; `config.js` | Implied participation is **not** formal consent and is **not** an ethics approval or waiver |
| 2 | Fill in `contact` and `ethics` in `config.js` → `research` | repo | Shown in the information sheet |
| 3 | Enable **Anonymous** sign-in | Firebase console → Authentication → Sign-in method → Add new provider → Anonymous → Enable | Without it, data stays in students' browsers and is never saved |
| 4 | Publish the rules: paste the **whole** [`firestore.rules`](../firestore.rules) → **Publish** | Firestore Database → Rules | Contains both the sync rules and the research rules; the research collection is denied without them |
| 5 | Check the sign-up quota | Authentication → Settings → *Sign-up quota* (Identity Platform projects) | Firebase limits new accounts per IP address per hour (100 by default). A whole class signing up from one lab/campus IP within an hour can hit it; affected students' data waits in their browser and is retried on later visits. Raise it for the pilot hour if possible |
| 6 | (Optional) Anonymous-account cleanup | Authentication → Settings → *User account cleanup* (needs Identity Platform) | Removes long-unused anonymous accounts. Their research documents stay until you delete them |
| 7 | Service-account key for exports | Project settings → Service accounts → *Generate new private key* → save **outside the repo** (e.g. `~/secure/oop-research-sa.json`, `chmod 600`) | Full database access: never commit, email or upload it. `.gitignore` blocks common key names |
| 8 | Register GA4 custom definitions, including the **user-scoped** `participant_id`; turn Google signals off | GA4 → Admin → Custom definitions ([GA4 doc §4.1](GA4-ENGAGEMENT-TRACKING.md#41-register-custom-dimensions-required)) | Not retroactive — do it before the pilot |
| 9 | Merge `experiment` → `main` and push | git (only when you decide) | GitHub Pages serves `main` |

No new Firebase project, API key or config value is needed: the site uses the existing web config.

## 2. Production smoke test (after steps 3–4 and 9)

Use a private browser window, on the live site:

1. Open a topic page (e.g. *Class Basics*). The sidebar shows **Research study: taking part**.
2. Firebase console → Authentication → Users: one new **anonymous** user appeared.
3. Firestore → Data → `researchParticipants/<that uid>`: `consentStatus: "implied"`; inside
   `sessions/<id>`: `topicId: "classes"`, `pageViews: 1`.
4. Take the quiz, then switch to another tab (forces a save). The session shows
   `quizStatus: "completed"`, `quizScore`, one entry in `quizAttempts`.
5. Rules: open `https://firestore.googleapis.com/v1/projects/object-oriented-programm-95ff5/databases/(default)/documents/researchParticipants/<uid>`
   in the browser (no sign-in). Expected: **403 PERMISSION_DENIED**.
6. Export: `GOOGLE_APPLICATION_CREDENTIALS=~/secure/oop-research-sa.json npm run export:research`
   → one row for your session.
7. Sidebar → *Research study* → **Withdraw and delete my data**. The anonymous user and both
   documents disappear; the sidebar shows *not taking part*.
8. Delete the test data if anything is left, so it does not enter the dataset.

If step 2 shows no user: Anonymous sign-in is off (browser console: `auth/operation-not-allowed`
or `auth/admin-restricted-operation`). If step 3 stays empty: rules not published
(`permission-denied` in the console).

## 3. GA4 DebugView

1. Turn on debug mode for your browser only: [Tag Assistant](https://tagassistant.google.com/) →
   *Add domain* → `https://yousefammmar.github.io/object_oriented_programming/` → *Connect*
   (or the *Google Analytics Debugger* Chrome extension).
2. GA4 → *Admin → Data display → DebugView*, pick your device.
3. Do the actions below and check each event and its parameters:

| Action on the live site | Expected event(s) | Parameters to check |
|---|---|---|
| Open Home / Labs / Code Files / Revision Hall / Examination Hall / All Links | `page_view` only | — |
| Open a topic page (first time in 30 min) | `page_view`, `study_session_started` | `lesson_id` |
| Refresh the same topic page | `page_view` only (same study session) | — |
| *Mark as completed* on / off | `lesson_complete` / `lesson_uncomplete` | `lesson_id`, `lesson_name`, `completion_method = manual` |
| Labs → *Mark done* | `lab_complete` / `lab_uncomplete` | `lab_number` |
| Code Files → another tab / *Copy* | `code_file_view` / `code_copy` | `code_file` (+ `code_page_path`) |
| Click a video/PDF/Drive/code chip | `learning_resource_click` | `resource_type`, `resource_name` |
| *Take quiz* / *Retake quiz* | `quiz_started` | `lesson_id` |
| *Submit answers* (all answered) | `quiz_completed` (once per attempt) | `lesson_id`, `quiz_score` 0–100 — **no answers** |
| Come back after > 30 min idle, or load a page after that | `study_session_completed` | `lesson_id`, `study_active_sec`, `study_quiz_status` |
| Any hit after your research ID exists (e.g. *Mark as completed* on a topic page after ≥ 60 s) | user property `participant_id` | equals your research ID (sidebar → *Research study*) |
| Sidebar → withdraw | no further `study_session_*` events; `participant_id` cleared | — |

No event parameter may contain a name, email, research ID, session ID or quiz answer; the research ID
appears only as the user property `participant_id`. Debug traffic is
marked as developer traffic (filter it out of reports as in the GA4 doc §4.4).

## 4. Status

| Area | Verified locally (emulators + Chromium) | Verified against production | Not yet verified |
|---|---|---|---|
| Quiz UI, scoring, attempts | ✅ | — | Safari / Firefox |
| Study sessions, metrics, saving, offline resync | ✅ | — | real-world timing on phones |
| Firestore rules (research + sync) | ✅ 26 rule cases | ⚠️ only that unauthenticated reads of `researchParticipants` and `users` are refused (403, checked 2026-10-29) — the default deny-all rules would answer the same | that the published rules are this file |
| Anonymous auth, withdrawal deletion | ✅ | — | provider enabled, sign-up quota |
| Google sign-in + sync | ✅ (emulator credential) | — | sign-in popup and sync on the live site |
| GA4 events and payloads | ✅ (dataLayer, Google blocked) | — | DebugView, custom definitions |
| CSV export | ✅ (emulator) | — | with the service-account key |
