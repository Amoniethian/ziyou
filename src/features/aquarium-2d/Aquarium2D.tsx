import { useEffect, useRef } from "react";
import { useStore } from "../../store";
import { ICONS } from "../../lib/icons";
import { AquariumEngine } from "./engine";
import { AmbientToggle } from "../audio/AudioControls";

export function Aquarium2D() {
  const inv = useStore((s) => s.inv);
  const cosmetics = useStore((s) => s.cosmetics);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AquariumEngine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new AquariumEngine(canvasRef.current);
    engineRef.current = engine;
    engine.setCosmetics(cosmetics);
    engine.setInventory(inv);
    engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setCosmetics(cosmetics);
  }, [cosmetics]);

  useEffect(() => {
    engineRef.current?.setInventory(inv);
  }, [inv]);

  return (
    <main className="aquarium-wrap">
      <div className="aq-head">
        <h2>海 缸</h2>
        <div className="aq-head-right">
          <div className="legend">小鱼 · 月亮鱼 · 小丑鱼 · guppy · 七彩麒麟 · 海葵 · 珊瑚 · 海草</div>
          <AmbientToggle />
        </div>
      </div>
      <div className="canvas-frame">
        <canvas ref={canvasRef} />
      </div>
      <div className="medal-shelf">
        {inv.medals.map((m, i) => (
          <div key={i} className="medal" title={`${m.label} × ${m.n}`}>
            {ICONS[m.type] || "✦"}
          </div>
        ))}
      </div>
    </main>
  );
}
