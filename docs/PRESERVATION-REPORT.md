# Content preservation report

Original: git revision `9e0769a` (single-page site) · Current: working tree · 2026-10-11

## 1. Text and links per section

| Section | Text nodes (orig → new) | Links (orig → new) | Result |
|---|---|---|---|
| home → index.html | 56 → 56 | 13 → 13 external | ✅ identical |
| cpp → cpp-basics.html | 41 → 41 | 13 → 13 external | ✅ identical |
| classes → class-basics.html | 54 → 54 | 22 → 22 external | ✅ identical |
| const → const-static.html | 42 → 42 | 4 → 4 external | ✅ identical |
| composition → composition.html | 31 → 31 | 9 → 9 external | ✅ identical |
| labs → labs.html | 50 → 50 | 23 → 23 external | ✅ identical |
| code → code-files.html | 156 → 156 | 1 → 1 external | ✅ identical |
| quizzes → examination-hall.html | 55 → 55 | 25 → 25 external | ✅ identical |
| links → all-links.html | 56 → 56 | 46 → 46 external | ✅ identical |

## 2. C++ code files (byte-for-byte)

| File id | Name | SHA-256 (first 12) | Result |
|---|---|---|---|
| revision | Revision1.cpp | 4c73e9e1c8dd | ✅ identical |
| revision2 | Revision2.cpp | 1ea47c54eaa1 | ✅ identical |
| revision3 | Revision3.cpp | 0c05392597fd | ✅ identical |
| revision4 | Revision4.cpp | 837ad7ff0808 | ✅ identical |
| classes1 | Classes1.cpp | 88eee7bd32df | ✅ identical |
| classes2 | Classes2.cpp | 13b1316ea0ae | ✅ identical |
| sg | SettersandGetters1.cpp | 8a1f6649ef04 | ✅ identical |
| ctor | Constructors1.cpp / 2 / 3 | c6057ce28eae | ✅ identical |
| dtor | Destructor.cpp | 094b85f9e55e | ✅ identical |
| sep | Separation (.h + .cpp + Driver) | 4582f82d7833 | ✅ identical |
| arr | ObjectsArray1.cpp | 187eb01e04ba | ✅ identical |
| const1 | Constants1.cpp | e25778aa0939 | ✅ identical |
| const2 | Constants2.cpp | ad079e5412d6 | ✅ identical |

## 3. Masthead, navigation labels and footer

- kicker: ✅ identical
- issue: ✅ identical
- h1: ✅ identical
- subtitle: ✅ identical
- nav: ✅ identical
- footer: ✅ identical
- symbols: ✅ identical
- footerLinks: ✅ identical
- themeLabel: ✅ identical

## Summary

**Zero unauthorised content changes.**

Not compared (by design): UI that scripts add (tagged `data-ui`: progress buttons, dashboard, pager, search, link filter), and navigation links that changed from `onclick` handlers to real page links.
