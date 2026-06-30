# Migration map · 词海

Function-by-function pointer from the legacy single-file HTML to this TypeScript codebase.

> Source of truth: `legacy/cihai-2d.html`. Line numbers below are approximate.
> When in doubt about behavior, run the legacy file side-by-side and match observable behavior.

---

## Top-level state and persistence

| Legacy | New |
|---|---|
| `let state = ...` (~line 590) | `src/types.ts` (types) + `src/store.ts` (zustand) |
| `function save()` | `useStore.persist` middleware (auto via zustand) |
| `localStorage.setItem(STORAGE_KEY, ...)` | `localforage` (IndexedDB) via persist storage adapter |
| `state.today.date !== todayKey()` reset | `onRehydrateStorage` in `store.ts` |

## Reward system

| Legacy function | New location |
|---|---|
| `grantWord()` | `useStore.getState().grantWord()` |
| `grantMinute(m)` | `useStore.getState().grantMinute(m)` |
| `convertIfNeeded()` | `useStore.getState().convertIfNeeded()` |
| `endReviewSession()` | `useStore.getState().endReviewSession()` |
| `checkAndUpdateMastery()` | `useStore.getState().checkMastery()` |
| `CONV`, `PENALTY` constants | `src/types.ts` (exported) |

## Learning flow

| Legacy function | New component (target) |
|---|---|
| `renderLearn()` | `<LearnRoute />` in `src/features/learn/LearnRoute.tsx` |
| `renderQuickAdd()` | `<QuickAdd />` |
| `renderFamiliarize()` | `<FamiliarizeStep />` |
| `renderMatch()` | `<MatchStep />` |
| `renderReconstruct()` | `<ReconstructStep />` |
| `renderDictate()` | `<DictateStep />` |
| `renderGroupTest()` | `<GroupQuiz />` |
| `renderGroupCheck()` | `<GroupCheck />` |
| `advanceStep()` | reducer-style action on `LearnSession` |
| `startLearnSession()` | `useStore.getState().startLearnSession()` |
| `exitLearnSession()` | `useStore.getState().exitLearnSession()` |
| `addQuickWord()` | `src/features/learn/quickAdd.ts` (calls `enrichWord` from `lib/llm-enrich.ts`) |
| `enrichWord()` | `src/lib/llm-enrich.ts::enrichWord` |

## Review flow

| Legacy function | New component (target) |
|---|---|
| `renderReview()` | `<ReviewRoute />` |
| `pickReviewItem()` | `src/features/review/pickItem.ts` |
| `renderReviewFillin()` | `<FillinReview />` |
| `renderReviewDictation()` | `<DictationReview />` |
| `renderReviewFlashcard()` | `<FlashcardReview />` |
| `submitFillin()` / `submitDictation()` | actions on review session in store |

## Pomodoro

| Legacy | New |
|---|---|
| `pomTick`, `pom-start` handler | `src/features/pomodoro/usePomodoro.ts` (custom hook) |
| Triggers `grantMinute(25)` on completion | same |

## Aquarium (2D version, optional port)

| Legacy function | New location |
|---|---|
| `buildLowPolyBackground`, `drawLowPolyBackground` | `src/features/aquarium-2d/background.ts` |
| `SPRITES` + `drawSprite` | `src/features/aquarium-2d/sprites.ts` |
| `updateFish`, `updateTurtle` | `src/features/aquarium-2d/physics.ts` |
| `frame()` loop | `useEffect` in `<Aquarium2D />` with rAF |

## Aquarium (3D version)

See `src/features/aquarium-3d/README.md` for detailed mapping from `legacy/cihai-3d-preview.html`.

## Cosmetics (background + creature image upload)

| Legacy | New |
|---|---|
| `renderCreatureRows()` | `<CosmeticsTab />` |
| `readFile()` → data URL | same pattern, store in `state.cosmetics` |
| `getImage()` cache | move to `src/features/aquarium-*/imageCache.ts` |

## Drive sync

| Legacy | New |
|---|---|
| `callDriveCowork` (MCP path) | dropped — not used outside Cowork |
| `restDriveSearch/Create/Download` | `src/lib/drive-sync.ts` (much cleaner) |
| `syncToCloud` / `loadFromCloud` | `drive.push()` / `drive.pull()` |
| `scheduleSync` debounce | `makeDebouncedSync()` factory |
| OAuth Client ID UI | `<DriveSettings />` — read from `import.meta.env.VITE_GOOGLE_CLIENT_ID` |
| Mode detection (`COWORK_MODE`) | dropped — production app is standalone only |

## Where things AREN'T migrated yet

These are intentionally left as TODOs in the scaffold:

- 24-hour fish return logic (penalties currently just remove)
- Set-completion 3-sentence quiz pulling random sentences from the 50-word window
- Drive folder cleanup (delete old state files after N)
- Audio system (Web Audio API for ambient + feedback sounds)
- PWA manifest + service worker for offline use
- Tauri / Capacitor wrappers

The design spec (`legacy/cihai-design-spec.md` §8) lays out the order they should land.

---

## How to actually migrate

1. `npm install` to verify the scaffold runs.
2. `npm run dev`. The skeleton renders the panel with stats from the seeded starter vocab.
3. Open `legacy/cihai-2d.html` in a second tab for behavioral reference.
4. Pick ONE feature folder (suggest: `features/learn/`). Port its functions one by one,
   replacing legacy `renderX()` (which mutates DOM directly) with React components driven by
   `useStore` state.
5. After each component works, run the legacy version on the same vocab data and confirm parity.
6. Once `learn` is done, move to `review`, then `pomodoro`, then `aquarium-2d` (or skip to 3D).
7. Add Drive sync last — it's a wrapper on top, doesn't change feature logic.

The vocab JSON data is already in place (`src/data/vocab-scholar-set1.json`) and seeded into
the store on first run. You shouldn't need to touch it during migration.
