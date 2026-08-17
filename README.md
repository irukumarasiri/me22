# Attendance Checker

Static, mobile-first Firebase web app for university event attendance.

## Features

- Google sign-in with Firebase Authentication.
- Admin-only event creation, student imports, custom helper records, and attendance marking.
- Public index-number attendance search.
- Excel import for the current student-list format:
  - Column A: student name
  - Column B: index number
  - No header row required
- Mobile-friendly attendance entry. Admins select `22`, `23`, `24`, or `25`, then type only the rest of the index number.
- Dashes are not required. Values such as `220062D`, `220-062-D`, and `22 0062 d` are normalized to `220062D`.

## Firebase Setup

1. Create a Firebase project.
2. Enable Authentication > Sign-in method > Google.
3. Create a Firestore database.
4. In Firebase project settings, create or open the web app config.
5. Paste the config values into `firebase-config.js`.
6. Add your senior/admin Gmail address to `bootstrapAdminEmails` in `firebase-config.js`.
7. Add the same email to `firestore.rules` inside `isBootstrapAdmin()`.
8. Publish the Firestore rules.
9. Open the site and sign in once. Your user document will be created with role `admin`.
10. After that, additional admins can be assigned by editing their `users/{uid}` document role to `admin` in Firestore.

## Suggested Firestore Rules

Use `firestore.rules`. They allow public attendance search, while writes stay admin-only.

## Local Preview

Because this is a static app, any simple static server can run it. From this folder:

```powershell
python -m http.server 5173
```

Then open `http://localhost:5173`.
