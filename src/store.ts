import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import localforage from "localforage";
import type { State, Vocab, CreatureType, Sentence, DecorType, DecorItem, SyncData, RewardBuckets, Inventory } from "./types";
import {
  CONV,
  PENALTY,
  emptyInventory,
  emptyTodayStats,
  emptyCosmetics,
  defaultDecor,
  randomDecorVariant,
  todayKey
} from "./types";
import { loadLlmConfig } from "./lib/llmConfig";
import type { EnrichedWord } from "./lib/llm-enrich";
import { toast } from "./ui/toast";
import { audio } from "./lib/audio";
import starterVocab from "./data/vocab-scholar-set1.json";

/**
 * Zustand store for 词海.
 * Persists to IndexedDB via localforage.
 *
 * All reward / penalty / mastery / learning-flow logic that the legacy
 * single-file build kept inline lives here as actions on the store.
 */

const SET_SIZE = 50;

/**
 * Word-count reward cadence: every N learned/reviewed words yields a creature.
 * (The bucket field names are historical — the threshold is `n`.)
 */
const WORD_REWARDS: { bucket: keyof RewardBuckets; n: number; type: CreatureType; msg: string }[] = [
  { bucket: "ten",        n: 10, type: "smallFish", msg: "+ 一条小鱼" },
  { bucket: "twentyFive", n: 20, type: "moonFish",  msg: "+ 一条月亮鱼" },
  { bucket: "fifty",      n: 30, type: "clownfish", msg: "+ 一条小丑鱼" },
  { bucket: "hundred",    n: 40, type: "bigFish",   msg: "+ 一只 guppy" },
  { bucket: "twoHundred", n: 60, type: "turtle",    msg: "+ 一只七彩麒麟" }
];

/** Pay out every creature currently due from the reward buckets. */
function payoutWordRewards(b: RewardBuckets, inv: Inventory, announce: boolean) {
  for (const r of WORD_REWARDS) {
    while (b[r.bucket] >= r.n) {
      b[r.bucket] -= r.n;
      (inv as any)[r.type]++;
      if (announce) {
        toast(r.msg);
        audio.birth(r.type);
      }
    }
  }
}
const ICON_LABEL: Record<CreatureType, string> = {
  smallFish: "小鱼", moonFish: "月亮鱼", clownfish: "小丑鱼", bigFish: "guppy",
  turtle: "七彩麒麟", emberFish: "超级小鱼", seaweed: "海草", anemone: "海葵", coral: "珊瑚"
};

function normalizeVocab(raw: any, id: number): Vocab {
  return {
    id,
    word: raw.word,
    phonetic: raw.phonetic || "",
    meaning: raw.meaning || "",
    forms: raw.forms || "",
    context: raw.context || "",
    note: raw.note || "",
    sentences: Array.isArray(raw.sentences) ? raw.sentences : [],
    learned: false,
    known: 0,
    miss: 0,
    mastered: false,
    enrichmentStatus: raw.enrichmentStatus
  };
}

type Actions = {
  // rewards
  grantWord: () => void;
  grantReview: () => void;
  grantBreak: (mins?: number) => void;
  grantMinute: (m: number) => void;
  convertIfNeeded: () => void;
  // learning flow
  startLearnSession: () => void;
  learnAdvance: () => void;
  learnReview: () => void;
  learnSkipWord: () => void;
  learnExit: () => void;
  finishGroupTest: (right: number, total: number, checkPool: { wordId: number; sentence: Sentence }[]) => void;
  finishGroupCheckItem: (correct: boolean) => void;
  // quick capture
  addQuickWord: (word: string) => { id: number; duplicate: boolean };
  applyEnrichment: (id: number, e: EnrichedWord) => void;
  setEnrichmentStatus: (id: number, status: NonNullable<Vocab["enrichmentStatus"]>) => void;
  // review
  reviewFinish: (wordId: number, correct: boolean) => void;
  endReviewSession: () => void;
  checkMastery: () => void;
  // vocab management
  appendVocab: (list: any[]) => number;
  replaceVocab: (list: any[]) => void;
  resetLearned: () => void;
  // cosmetics
  setBackground: (url: string | null) => void;
  setCreatureImage: (type: CreatureType, url: string | null) => void;
  setPalette: (water: number, sand: number) => void;
  // 3D decor
  moveDecor: (id: string, x: number, z: number) => void;
  setDecorScale: (id: string, scale: number) => void;
  setDecorRot: (id: string, rot: number) => void;
  setDecorY: (id: string, y: number) => void;
  addDecor: (type: DecorType) => string;
  removeDecor: (id: string) => void;
  syncDecor: () => void;
  // cloud sync
  exportState: () => SyncData;
  importState: (d: SyncData) => void;
  markSynced: (iso: string) => void;
  resetAll: () => void;
};

export type Store = State & Actions;

function freshState(): State {
  return {
    vocab: (starterVocab as any[]).map((raw, i) => normalizeVocab(raw, i)),
    inv: emptyInventory(),
    today: emptyTodayStats(),
    totalFocusMin: 0,
    totalBreakMin: 0,
    rewardBuckets: { ten: 0, twentyFive: 0, fifty: 0, hundred: 0, twoHundred: 0 },
    timeBuckets: { twenty: 0, forty: 0, sixty: 0 },
    learnSession: null,
    reviewSession: { attempts: 0, correct: 0 },
    cosmetics: emptyCosmetics(),
    tankDecor: defaultDecor()
  };
}

const STRUCTURE_TYPES: DecorType[] = ["seaweed", "anemone", "coral"];

/** Random (x,z) on the sand floor, away from the very edges. */
function randomDecorPos(): { x: number; z: number; rot: number } {
  return {
    x: (Math.random() - 0.5) * 5.6,
    z: (Math.random() - 0.5) * 3.0,
    rot: Math.random() * Math.PI * 2
  };
}

let decorSeq = 0;
function newDecorId(type: string): string {
  decorSeq += 1;
  return `${type}-${Date.now().toString(36)}-${decorSeq}`;
}

/**
 * Reconcile the placeable decor list with earned structure counts:
 * non-default entries of each structure type should equal inventory.
 * Existing entries keep their (possibly user-arranged) positions.
 */
function reconcileDecor(decor: DecorItem[], inv: State["inv"]): DecorItem[] {
  const next = [...decor];
  for (const type of STRUCTURE_TYPES) {
    const owned = next.filter((d) => d.type === type && !d.def);
    const desired = (inv as any)[type] as number;
    if (owned.length < desired) {
      for (let i = owned.length; i < desired; i++) {
        const p = randomDecorPos();
        next.push({ id: newDecorId(type), type, x: p.x, z: p.z, rot: p.rot, variant: randomDecorVariant(type) });
      }
    } else if (owned.length > desired) {
      let toRemove = owned.length - desired;
      // Remove most-recently-added non-default entries first.
      for (let i = next.length - 1; i >= 0 && toRemove > 0; i--) {
        if (next[i].type === type && !next[i].def) {
          next.splice(i, 1);
          toRemove--;
        }
      }
    }
  }
  return next;
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...freshState(),

      /* ---------- Rewards ---------- */
      grantWord: () => {
        const s = get();
        const today = { ...s.today, learnedToday: s.today.learnedToday + 1 };
        const b = { ...s.rewardBuckets };
        const inv = { ...s.inv };
        for (const r of WORD_REWARDS) b[r.bucket]++;
        payoutWordRewards(b, inv, true);
        set({ today, rewardBuckets: b, inv });
        get().convertIfNeeded();
      },

      // Correct reviews also grow the tank (shares the reward buckets with
      // learning, but does NOT count as a newly-learned word).
      grantReview: () => {
        const s = get();
        const b = { ...s.rewardBuckets };
        const inv = { ...s.inv };
        for (const r of WORD_REWARDS) b[r.bucket]++;
        payoutWordRewards(b, inv, true);
        set({ rewardBuckets: b, inv });
        get().convertIfNeeded();
      },

      // Finishing a rest break grows one gold-red translucent "super small fish".
      grantBreak: (mins = 0) => {
        set({
          inv: { ...get().inv, emberFish: get().inv.emberFish + 1 },
          totalBreakMin: get().totalBreakMin + Math.max(0, mins)
        });
        toast("休息好啦 · + 一条超级小鱼");
        audio.birth("smallFish");
      },

      grantMinute: (m) => {
        const s = get();
        const today = { ...s.today, minutes: s.today.minutes + m };
        const tb = { ...s.timeBuckets };
        const inv = { ...s.inv };
        tb.twenty += m; tb.forty += m; tb.sixty += m;
        while (tb.twenty >= 20) { tb.twenty -= 20; inv.seaweed++; toast("+ 海草"); audio.birth("seaweed"); }
        while (tb.forty  >= 40) { tb.forty  -= 40; inv.anemone++; toast("+ 海葵"); audio.birth("anemone"); }
        while (tb.sixty  >= 60) { tb.sixty  -= 60; inv.coral++;   toast("+ 珊瑚"); audio.birth("coral"); }
        set({ today, timeBuckets: tb, inv, totalFocusMin: s.totalFocusMin + m });
        get().convertIfNeeded();
        set({ tankDecor: reconcileDecor(get().tankDecor, get().inv) });
      },

      convertIfNeeded: () => {
        const s = get();
        const inv = { ...s.inv, medals: [...s.inv.medals] };
        for (const c of CONV) {
          while ((inv as any)[c.type] >= c.threshold) {
            const remove = c.threshold - c.keep;
            (inv as any)[c.type] -= remove;
            inv.medals.push({ type: c.type, label: c.label, n: remove });
            toast(c.label + " 凝成奖牌");
          }
        }
        set({ inv });
        set({ tankDecor: reconcileDecor(get().tankDecor, inv) });
      },

      /* ---------- Learning flow ---------- */
      startLearnSession: () => {
        const candidates = get().vocab.filter(
          (w) => !w.learned && w.enrichmentStatus !== "loading"
        );
        if (candidates.length === 0) return;
        const queue = candidates.slice(0, 10).map((w) => w.id);
        set({ learnSession: { queue, idx: 0, step: 0, mode: "word" } });
      },

      learnAdvance: () => {
        const s = get().learnSession;
        if (!s) return;
        const w = get().vocab.find((x) => x.id === s.queue[s.idx]);
        if (!w) return;
        let step = s.step;
        while (true) {
          step++;
          if (step >= 4) break;
          if (step === 1 && (!w.sentences || w.sentences.length < 2)) continue;
          if (step === 2 && (!w.sentences || w.sentences.length < 1)) continue;
          break;
        }
        if (step >= 4) {
          // Word complete.
          set({ vocab: get().vocab.map((x) => (x.id === w.id ? { ...x, learned: true } : x)) });
          get().grantWord();
          const cur = get().learnSession!;
          const idx = cur.idx + 1;
          if (idx >= cur.queue.length) {
            set({ learnSession: { ...cur, idx, step: 0, mode: "group" } });
          } else {
            set({ learnSession: { ...cur, idx, step: 0 } });
          }
        } else {
          set({ learnSession: { ...s, step } });
        }
      },

      // Go back to the word's familiarize card (re-read), keeping the queue.
      learnReview: () => {
        const s = get().learnSession;
        if (!s) return;
        set({ learnSession: { ...s, step: 0 } });
      },

      // "Can't recall": skip to the next word WITHOUT marking this one learned,
      // so it stays in the unlearned pool and comes back in a later group.
      learnSkipWord: () => {
        const s = get().learnSession;
        if (!s) return;
        const idx = s.idx + 1;
        if (idx >= s.queue.length) set({ learnSession: { ...s, idx, step: 0, mode: "group" } });
        else set({ learnSession: { ...s, idx, step: 0 } });
      },

      learnExit: () => set({ learnSession: null }),

      finishGroupTest: (right, total, checkPool) => {
        const s = get().learnSession;
        if (!s) return;
        const today = {
          ...get().today,
          attempts: get().today.attempts + total,
          correct: get().today.correct + right
        };
        if (checkPool.length === 0) {
          set({ today, learnSession: null });
          return;
        }
        set({
          today,
          learnSession: {
            ...s,
            mode: "groupCheck",
            checkPool,
            checkIdx: 0,
            checkResults: { right: 0, wrong: 0 }
          }
        });
      },

      finishGroupCheckItem: (correct) => {
        const s = get().learnSession;
        if (!s || !s.checkPool || s.checkResults === undefined || s.checkIdx === undefined) return;
        const cr = {
          right: s.checkResults.right + (correct ? 1 : 0),
          wrong: s.checkResults.wrong + (correct ? 0 : 1)
        };
        const checkIdx = s.checkIdx + 1;
        if (checkIdx >= s.checkPool.length) {
          set({
            today: {
              ...get().today,
              attempts: get().today.attempts + s.checkPool.length,
              correct: get().today.correct + cr.right
            },
            learnSession: null
          });
          toast(`整组默写：${cr.right}/${s.checkPool.length} 通过`);
        } else {
          set({ learnSession: { ...s, checkIdx, checkResults: cr } });
        }
      },

      /* ---------- Quick capture ---------- */
      addQuickWord: (rawWord) => {
        const word = rawWord.replace(/\s+/g, " ").trim();
        const s = get();
        if (!word) return { id: -1, duplicate: false };
        if (s.vocab.find((w) => w.word.toLowerCase() === word.toLowerCase())) {
          return { id: -1, duplicate: true };
        }
        const id = s.vocab.length === 0 ? 0 : Math.max(...s.vocab.map((v) => v.id)) + 1;
        const entry = normalizeVocab({ word }, id);
        entry.enrichmentStatus = loadLlmConfig() ? "loading" : "minimal";
        set({ vocab: [...s.vocab, entry] });
        return { id, duplicate: false };
      },

      applyEnrichment: (id, e) =>
        set({
          vocab: get().vocab.map((w) =>
            w.id === id
              ? {
                  ...w,
                  phonetic: e.phonetic,
                  meaning: e.meaning,
                  forms: e.forms,
                  context: e.context,
                  sentences: Array.isArray(e.sentences) ? e.sentences : [],
                  enrichmentStatus: "done"
                }
              : w
          )
        }),

      setEnrichmentStatus: (id, status) =>
        set({
          vocab: get().vocab.map((w) => (w.id === id ? { ...w, enrichmentStatus: status } : w))
        }),

      /* ---------- Review ---------- */
      reviewFinish: (wordId, correct) => {
        const s = get();
        set({
          vocab: s.vocab.map((w) =>
            w.id === wordId
              ? { ...w, known: w.known + (correct ? 1 : 0), miss: w.miss + (correct ? 0 : 1) }
              : w
          ),
          today: {
            ...s.today,
            attempts: s.today.attempts + 1,
            correct: s.today.correct + (correct ? 1 : 0)
          },
          reviewSession: {
            attempts: s.reviewSession.attempts + 1,
            correct: s.reviewSession.correct + (correct ? 1 : 0)
          }
        });
        if (correct) get().grantReview();
      },

      endReviewSession: () => {
        const s = get();
        const att = s.reviewSession.attempts;
        if (att === 0) {
          toast("本次还未开始");
          return;
        }
        const rate = (att - s.reviewSession.correct) / att;
        const inv = { ...s.inv };
        const losses: string[] = [];
        const take = (type: CreatureType) => {
          if ((inv as any)[type] > 0) {
            (inv as any)[type]--;
            losses.push("- 1 " + ICON_LABEL[type]);
          }
        };
        for (const p of PENALTY) if (rate > p.errorRate) take(p.type);
        set({ inv, reviewSession: { attempts: 0, correct: 0 } });
        get().checkMastery();
        toast(
          `本次 ${att} 题，错误率 ${(rate * 100).toFixed(0)}%。` +
            (losses.length ? " " + losses.join("，") : " 全部留缸")
        );
      },

      checkMastery: () => {
        const vocab = get().vocab.map((w) => ({ ...w }));
        let changed = false;
        for (let si = 0; si * SET_SIZE < vocab.length; si++) {
          const slice = vocab.slice(si * SET_SIZE, (si + 1) * SET_SIZE);
          if (slice.length < SET_SIZE) continue;
          if (!slice.every((w) => w.learned)) continue;
          const known = slice.reduce((a, w) => a + w.known, 0);
          const miss = slice.reduce((a, w) => a + w.miss, 0);
          const total = known + miss;
          if (total < SET_SIZE) continue;
          if (known / total >= 0.9 && !slice.every((w) => w.mastered)) {
            for (const w of slice) w.mastered = true;
            changed = true;
            toast(`第 ${si + 1} 套词已掌握，复习升级为整句默写`);
            audio.mastered();
          }
        }
        if (changed) set({ vocab });
      },

      /* ---------- Vocab management ---------- */
      appendVocab: (list) => {
        const s = get();
        let nextId = s.vocab.length === 0 ? 0 : Math.max(...s.vocab.map((v) => v.id)) + 1;
        const entries = list.filter((x) => x && x.word).map((raw) => normalizeVocab(raw, nextId++));
        set({ vocab: [...s.vocab, ...entries] });
        return entries.length;
      },

      replaceVocab: (list) => {
        let id = 0;
        const entries = list.filter((x) => x && x.word).map((raw) => normalizeVocab(raw, id++));
        set({ vocab: entries, learnSession: null });
      },

      resetLearned: () =>
        set({ vocab: get().vocab.map((w) => ({ ...w, learned: false })) }),

      /* ---------- Cosmetics ---------- */
      setBackground: (url) => set({ cosmetics: { ...get().cosmetics, background: url } }),

      setCreatureImage: (type, url) =>
        set({
          cosmetics: {
            ...get().cosmetics,
            creatures: { ...get().cosmetics.creatures, [type]: url }
          }
        }),

      setPalette: (water, sand) =>
        set({ cosmetics: { ...get().cosmetics, palette: { water, sand } } }),

      moveDecor: (id, x, z) =>
        set({ tankDecor: get().tankDecor.map((d) => (d.id === id ? { ...d, x, z } : d)) }),

      setDecorScale: (id, scale) =>
        set({ tankDecor: get().tankDecor.map((d) => (d.id === id ? { ...d, scale } : d)) }),

      setDecorRot: (id, rot) =>
        set({ tankDecor: get().tankDecor.map((d) => (d.id === id ? { ...d, rot } : d)) }),

      // Raise/lower a piece of decor above the sand (clamped to the tank).
      // Near the ground it SNAPS flush to the sand so it never hovers with an
      // ugly little gap.
      setDecorY: (id, y) => {
        let ny = Math.max(-0.3, Math.min(3.5, y));
        if (Math.abs(ny) < 0.18) ny = 0; // snap to the floor
        set({ tankDecor: get().tankDecor.map((d) => (d.id === id ? { ...d, y: ny } : d)) });
      },

      // Add a fresh decor piece (e.g. a 造景石头) at the centre; returns its id
      // so the caller can select it. Rocks aren't inventory-driven, so they
      // stick around until explicitly removed.
      addDecor: (type) => {
        const id = newDecorId(type);
        set({ tankDecor: [...get().tankDecor, { id, type, x: 0, z: 0, rot: 0, variant: randomDecorVariant(type) }] });
        return id;
      },

      // Remove a decor piece. Rocks (not inventory-driven) stay gone; earned
      // structures would be re-added by reconcile on the next grant.
      removeDecor: (id) =>
        set({ tankDecor: get().tankDecor.filter((d) => d.id !== id) }),

      syncDecor: () => set({ tankDecor: reconcileDecor(get().tankDecor, get().inv) }),

      exportState: () => {
        const s = get();
        return {
          vocab: s.vocab, inv: s.inv, today: s.today,
          totalFocusMin: s.totalFocusMin, totalBreakMin: s.totalBreakMin,
          rewardBuckets: s.rewardBuckets, timeBuckets: s.timeBuckets,
          cosmetics: s.cosmetics, tankDecor: s.tankDecor,
          learnSession: s.learnSession,
          _syncedAt: s._syncedAt, _device: s._device
        };
      },

      importState: (d) =>
        set({
          vocab: d.vocab ?? get().vocab,
          // Spread over full defaults so cloud data saved before new creatures
          // (e.g. emberFish) still has every field.
          inv: d.inv ? { ...emptyInventory(), ...d.inv } : get().inv,
          today: d.today ?? get().today,
          // Keep the larger lifetime totals so a stale device can't shrink them.
          totalFocusMin: Math.max(d.totalFocusMin ?? 0, get().totalFocusMin),
          totalBreakMin: Math.max(d.totalBreakMin ?? 0, get().totalBreakMin),
          rewardBuckets: d.rewardBuckets ?? get().rewardBuckets,
          timeBuckets: d.timeBuckets ?? get().timeBuckets,
          cosmetics: d.cosmetics ?? get().cosmetics,
          tankDecor: reconcileDecor(d.tankDecor ?? get().tankDecor, d.inv ?? get().inv),
          learnSession: d.learnSession ?? get().learnSession,
          _syncedAt: d._syncedAt,
          _device: d._device
        }),

      markSynced: (iso) => set({ _syncedAt: iso }),

      resetAll: () => set(freshState())
    }),
    {
      name: "cihai-state",
      storage: createJSONStorage(() => ({
        getItem: async (k) => (await localforage.getItem<string>(k)) ?? null,
        setItem: async (k, v) => {
          await localforage.setItem(k, v);
        },
        removeItem: async (k) => {
          await localforage.removeItem(k);
        }
      })),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Lifetime focus/rest counters. For saves that predate them (or that an
        // earlier build already reset to 0), estimate the history ONCE from the
        // inventory the user earned: every 海草 = 20 focus min (counting the ones
        // already converted into medals too — 15 seaweed per medal), and every
        // 火精灵 (emberFish) = one completed break (~5 min each).
        if (state.totalFocusMin == null) state.totalFocusMin = 0;
        if (state.totalBreakMin == null) state.totalBreakMin = 0;
        if (!state._timeBackfilled) {
          state._timeBackfilled = true;
          if (state.totalFocusMin === 0 && state.totalBreakMin === 0 && state.inv) {
            const seaweedMedal = state.inv.medals?.find((m) => m.type === "seaweed")?.n ?? 0;
            const seaweedEarned = (state.inv.seaweed ?? 0) + 15 * seaweedMedal;
            state.totalFocusMin = seaweedEarned * 20;
            state.totalBreakMin = (state.inv.emberFish ?? 0) * 5;
          }
        }
        // Migrate saves that predate the emberFish (break-reward) creature.
        if (state.inv && state.inv.emberFish == null) state.inv.emberFish = 0;
        if (state.cosmetics?.creatures && (state.cosmetics.creatures as Record<string, unknown>).emberFish === undefined) {
          (state.cosmetics.creatures as Record<string, string | null>).emberFish = null;
        }
        // Reset the day on rehydrate.
        if (state.today.date !== todayKey()) state.today = emptyTodayStats();
        // Recover entries stuck mid-enrichment from a previous session.
        for (const w of state.vocab) {
          if (w.enrichmentStatus === "loading") w.enrichmentStatus = "failed";
        }
        // Re-pay reward buckets against the current thresholds, so creatures
        // already earned under an updated cadence are granted (silently) on load.
        if (state.rewardBuckets && state.inv) payoutWordRewards(state.rewardBuckets, state.inv, false);
        // Migrate older saves that predate the 3D tank.
        if (!state.tankDecor || state.tankDecor.length === 0) state.tankDecor = defaultDecor();
        // Give pre-variant decor a random style so bundled variants show up.
        for (const d of state.tankDecor) if (d.variant == null) d.variant = randomDecorVariant(d.type);
        state.tankDecor = reconcileDecor(state.tankDecor, state.inv);
      },
      // Persist learnSession (resume mid-group); never persist the live review tally.
      partialize: (s) => ({ ...s, reviewSession: { attempts: 0, correct: 0 } })
    }
  )
);
