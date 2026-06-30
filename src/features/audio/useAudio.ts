import { useSyncExternalStore } from "react";
import { audio, type AudioSettings } from "../../lib/audio";

/** Subscribe a component to live audio settings. */
export function useAudioSettings(): AudioSettings {
  return useSyncExternalStore(
    (cb) => audio.subscribe(cb),
    () => audio.getSettings()
  );
}
