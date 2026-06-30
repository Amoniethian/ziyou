import type { ReactNode } from "react";
import { escapeRegex } from "./text";

/** Render an English sentence with the target word (and its inflections) highlighted. */
export function HighlightedEN({ en, word }: { en: string; word: string }) {
  const re = new RegExp("\\b" + escapeRegex(word) + "\\w*\\b", "gi");
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(en))) {
    if (m.index > last) parts.push(en.slice(last, m.index));
    parts.push(<em key={key++}>{m[0]}</em>);
    last = m.index + m[0].length;
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  parts.push(en.slice(last));
  return <>{parts}</>;
}

/** Render an English sentence with the first occurrence of `word` replaced by a blank. */
export function BlankedEN({ en, word }: { en: string; word: string }) {
  const re = new RegExp("\\b" + escapeRegex(word) + "\\w*\\b", "i");
  const m = en.match(re);
  if (!m || m.index === undefined) return <>{en}</>;
  return (
    <>
      {en.slice(0, m.index)}
      <span className="blank">_____</span>
      {en.slice(m.index + m[0].length)}
    </>
  );
}
