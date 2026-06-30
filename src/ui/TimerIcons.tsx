/**
 * Clean inline-SVG icons for the focus / rest timers (replacing the 🍅 ☕
 * emoji, which looked clunky). Self-coloured so they read on any background.
 */

/** Focus = a little sprout (you "种海草" while you focus). */
export function FocusIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block" }}>
      <path d="M12 21v-8" stroke="#6f9e5e" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M12 14C8.8 14 6.2 11.8 6 8.2 9.4 8.2 12 10.4 12 14Z" fill="#7bb56a" />
      <path d="M12 13C12 9.6 14.4 7 17.8 7 17.6 10.4 15.2 13 12 13Z" fill="#9bd083" />
    </svg>
  );
}

/** Rest = a warm teacup with a wisp of steam. */
export function BreakIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden style={{ display: "block" }}>
      <path d="M10 3.5c-.7.9-.7 1.8 0 2.7M14 3.5c-.7.9-.7 1.8 0 2.7" stroke="#d8a07a" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d="M5 9h11v4a5.5 5.5 0 0 1-5.5 5.5h0A5.5 5.5 0 0 1 5 13V9Z" fill="#e0a878" />
      <path d="M16 10.5h1.6a2.4 2.4 0 0 1 0 4.8H16" stroke="#cf8e62" strokeWidth="1.7" fill="none" />
      <path d="M6 20.5h9" stroke="#c98b6b" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
