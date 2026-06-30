# 2D Aquarium feature (optional port)

The legacy single-file HTML in `legacy/cihai-2d.html` has a working Canvas 2D aquarium
with low-poly background, pixel sprites, and creature behavior (Boids for small fish,
anemone-seeking for clownfish, etc).

If you want a 2D fallback / lightweight alternative to the 3D version, port:

- `legacy/cihai-2d.html` → `buildLowPolyBackground`, `drawLowPolyBackground` → `background.ts`
- legacy `SPRITES`, `drawSprite` → `sprites.ts`
- legacy `updateFish`, `updateTurtle` → `physics.ts`
- legacy `frame()` loop → `useEffect` in `<Aquarium2D />`

Otherwise skip this folder and go straight to `aquarium-3d/`.
