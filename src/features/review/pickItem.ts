import type { Vocab, Sentence } from "../../types";
import { matchSurface } from "../../lib/text";

export type ReviewItem = {
  word: Vocab;
  sentence: Sentence | null;
  mode: "fillin" | "dictation" | "flashcard";
  expected: string;
};

/**
 * Weighted pick: words you've missed or barely seen come up more often.
 * Mode follows the word's state — mastered words get whole-sentence dictation,
 * learned words with sentences get fill-in, the rest fall back to a flashcard.
 */
export function pickReviewItem(vocab: Vocab[]): ReviewItem | null {
  const learned = vocab.filter((w) => w.learned);
  if (learned.length === 0) return null;
  const weights = learned.map((w) => Math.max(1, 5 - w.known) + w.miss * 2);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let word = learned[0];
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      word = learned[i];
      break;
    }
  }
  let mode: ReviewItem["mode"] = "flashcard";
  let sentence: Sentence | null = null;
  let expected = "";
  if (word.sentences.length) {
    sentence = word.sentences[Math.floor(Math.random() * word.sentences.length)];
    if (word.mastered) {
      mode = "dictation";
      expected = sentence.en;
    } else {
      mode = "fillin";
      expected = matchSurface(sentence.en, word.word);
    }
  }
  return { word, sentence, mode, expected };
}
