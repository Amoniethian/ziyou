/**
 * IS_RELEASE is true when the app is built for public release
 * (`npm run build:release`, which sets VITE_RELEASE=1).
 *
 * It gates off the dev / maintenance plumbing that players shouldn't see
 * (the Supabase "建表 SQL" + 续接链接 config pipeline, etc.). The personal /
 * dev build leaves all tools on; the release build hides them.
 */
export const IS_RELEASE =
  import.meta.env.VITE_RELEASE === "1" || import.meta.env.MODE === "release";
