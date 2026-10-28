# Cross-device sync (Firebase) — setup

The site works without any of this. Until `firebase` is set in `assets/js/config.js`, progress,
bookmarks and history stay in the visitor's browser and no Firebase code is downloaded.

Once configured, the sidebar shows **Sign in with Google** under the progress card. Signing in is
optional: guests keep using the site exactly as before. Signed-in students get the same progress,
labs, bookmarks, recent pages and achievements on every device.

## What gets stored

One Firestore document per student, `users/{uid}`:

```js
{
  state: {
    progress:     { topics: { cpp: true, … }, labs: { "01": true, … } },
    bookmarks:    [ { key, label, href }, … ],
    recent:       [ { key, label, href }, … ],   // newest first, max 6
    last:         { key, label, href, at },      // "continue learning"
    seen:         [ "page:cpp", "code:sep", … ], // used by achievements
    achievements: [ "first-topic", … ]           // already-announced unlocks
  },
  updatedAt: <server timestamp>
}
```

Firestore holds only this study data, keyed by `uid`. The student's name and email stay in Firebase
Authentication's user list (visible to the project owner, as with any Google sign-in).

## Setup (about 10 minutes)

1. **Create a project** at <https://console.firebase.google.com> → *Add project* (Google Analytics
   for Firebase is not needed).
2. **Add a web app**: Project settings → *Your apps* → `</>` (Web). Skip Firebase Hosting — the site
   stays on GitHub Pages. Copy the `firebaseConfig` object it shows.
3. **Paste the config** into `assets/js/config.js`, replacing `firebase: null`:

   ```js
   firebase: {
     apiKey: 'AIza…',
     authDomain: 'your-project.firebaseapp.com',
     projectId: 'your-project',
     storageBucket: 'your-project.firebasestorage.app',
     messagingSenderId: '…',
     appId: '1:…:web:…'
   },
   ```

   These values are public by design (every Firebase web app ships them); the rules in step 6 are
   what keep each student's data private.
4. **Turn on Google sign-in**: Build → Authentication → *Get started* → Sign-in method → **Google**
   → Enable → choose a support email → Save.
5. **Authorise the site's domain**: Authentication → Settings → *Authorized domains* → add
   `yousefammmar.github.io`. (`localhost` is already there, so `npm run serve` works for testing.)
6. **Create the database**: Build → Firestore Database → *Create database* → choose a location near
   your students → start in **production mode**. Then open the *Rules* tab, replace everything with
   the contents of [`firestore.rules`](../firestore.rules) and **Publish**.
7. Commit and push. After GitHub Pages rebuilds, open the site, click **Sign in with Google**, mark
   a topic complete, then open the site on another device and sign in with the same account.

## Try it locally first (no Firebase project needed)

The Firebase emulators fake Google sign-in and the database on your machine and enforce
`firestore.rules`. Needs the Firebase CLI (`npm i -g firebase-tools`) and Java 11+.

1. In `assets/js/config.js`, temporarily set:

   ```js
   firebase: { apiKey: 'demo-key', authDomain: 'demo-oop.firebaseapp.com', projectId: 'demo-oop', appId: 'demo', emulators: true },
   ```

   (`emulators: true` is ignored anywhere except `localhost`, but don't commit this line.)
2. Start the emulators and the site in two terminals:

   ```bash
   npm run emulators
   ```

   ```bash
   npm run serve
   ```

3. Open <http://localhost:8000>, click **Sign in with Google** and pick *Add new account* in the
   emulator's pop-up. Open the site in a second browser (another "device") with the same account to
   watch progress sync. The emulator dashboard at <http://localhost:4000> shows the stored documents.

## How syncing behaves

- **First sign-in on a device:** whatever was done as a guest is merged into the account (union of
  completed topics, labs, bookmarks …), so nothing is lost.
- **Afterwards:** each item (progress, bookmarks, …) is compared with the last state both sides agreed
  on. A change on one side wins, so un-marking a topic stays un-marked everywhere. If both devices
  changed the same item while out of touch, they are combined.
- **Live:** an open tab picks up changes from other devices within a second or two.
- **Signing out** keeps this device's data; the visitor just continues as a guest. Signing in again
  syncs it back. (On a shared computer, use *Reset progress* after signing out if needed.)
- **Opened from disk (`file://`)** or offline: sign-in is hidden / unavailable and the site stays local.

## Free tier

The Spark (free) plan covers a course-sized audience comfortably: each page view is about one read and
one write, against daily limits of 50,000 reads and 20,000 writes.

## Checking the merge logic

```bash
npm run test:sync
```
