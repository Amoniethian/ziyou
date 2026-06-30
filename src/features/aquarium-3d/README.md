# 3D Aquarium feature

Three.js scene wrapped as a React component.

## Mapping to legacy code

| Concern | Legacy file/section | Port target |
|---|---|---|
| Scene setup, camera, renderer | `legacy/cihai-3d-preview.html` → `init()` | `useEffect` in `<Aquarium3D />` |
| OrbitControls | same file | inside same `useEffect` |
| Procedural species factories | `makeSmallFish`, `makeRock`, etc. | `src/features/aquarium-3d/factories.ts` |
| Animation loop | `animate()` | `requestAnimationFrame` driven by ref |
| GLB upload + auto-fit | `renderUploadRows()` change handler | separate hook `useModelLoader()` |
| Color palette controls | `WATER_PRESETS`, `SAND_PRESETS` | move to `src/types.ts` constants, expose via store |

## React integration

```tsx
import { useRef, useEffect } from "react";
import { setupScene } from "./scene";
import { useStore } from "../../store";

export function Aquarium3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inv = useStore((s) => s.inv);
  const cosmetics = useStore((s) => s.cosmetics);

  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = setupScene(canvasRef.current, { cosmetics });
    scene.syncCreatureCounts(inv);
    return () => scene.dispose();
  }, []);

  // React re-syncs counts when inventory changes
  useEffect(() => {
    // trigger scene update via ref/imperative API
  }, [inv]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />;
}
```

The legacy prototype's `init` function is structured imperatively; when porting, separate scene setup
from React lifecycle by exposing a small imperative API (`setupScene(canvas, opts)` returning `{
syncCreatureCounts, dispose, addCreature, setPalette, ...}`).

## Performance notes

- Cap fish count to ~200 total; beyond that switch to instanced rendering (THREE.InstancedMesh)
- Use `flatShading: true` on all materials for the low-poly look
- Disable shadows on small fish (they're not visible at scale anyway)
- Use `renderer.setPixelRatio(Math.min(2, devicePixelRatio))` to avoid retina overdraw on phones
