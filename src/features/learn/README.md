# Learning feature

The 4-step per-word flow + 10-word group test + 3-sentence dictation.

## Mapping to legacy code

| Step | Legacy function (in `legacy/cihai-2d.html`) | Port target |
|---|---|---|
| Familiarize | `renderFamiliarize()` | `<FamiliarizeStep word={...} onNext={...} />` |
| Sentence match | `renderMatch()` | `<MatchStep word={...} onComplete={...} />` |
| Word reconstruct | `renderReconstruct()` | `<ReconstructStep word={...} onComplete={...} />` |
| Word dictation | `renderDictate()` | `<DictateStep word={...} onComplete={...} />` |
| Group quiz | `renderGroupTest()` | `<GroupQuiz queue={...} onComplete={...} />` |
| 3-sentence check | `renderGroupCheck()` | `<GroupCheck pool={...} onComplete={...} />` |

## State machine

```
START → familiarize → match → reconstruct → dictate → next word
                                                       └─ if last → groupQuiz → groupCheck → END
```

Drive by a single `LearnSession` object held in zustand store (see `src/types.ts`).
