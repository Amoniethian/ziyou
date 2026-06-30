import { useEffect, useState } from "react";
import { useStore } from "../../store";
import type { CreatureType } from "../../types";
import { ICONS } from "../../lib/icons";
import { hasModel, initModels, subscribeModels, type ModelSlot } from "../aquarium-3d/modelStore";
import { ModelThumb } from "../aquarium-3d/ModelThumb";

const ITEMS: [CreatureType, string][] = [
  ["smallFish", "小鱼"], ["moonFish", "月亮鱼"], ["clownfish", "小丑鱼"], ["bigFish", "guppy"],
  ["turtle", "七彩麒麟"], ["emberFish", "超级小鱼"], ["seaweed", "海草"], ["anemone", "海葵"], ["coral", "珊瑚"]
];

export function Species() {
  const inv = useStore((s) => s.inv);
  // Re-render when a model is uploaded/cleared so previews appear/disappear.
  const [, bump] = useState(0);
  useEffect(() => {
    initModels().then(() => bump((v) => v + 1));
    return subscribeModels(() => bump((v) => v + 1));
  }, []);

  return (
    <div className="pane">
      <div className="inv-grid">
        {ITEMS.map(([k, l]) => (
          <div className="inv-item" key={k}>
            {hasModel(k as ModelSlot) ? (
              <div className="ic ic-3d"><ModelThumb slot={k as ModelSlot} /></div>
            ) : (
              <div className="ic">{ICONS[k]}</div>
            )}
            <div className="num">{inv[k]}</div>
            <div className="lbl">{l}</div>
          </div>
        ))}
      </div>
      <div className="inv-note">
        转化规则：50 小鱼 → 留 25 + 奖牌；15 月亮鱼 → 留 5 + 奖牌；10 小丑鱼 → 留 5 + 奖牌；4 guppy → 留 1 + 奖牌。
        20 海草 → 留 5 + 奖牌；10 海葵 → 留 5 + 奖牌；8 珊瑚 → 留 2 + 奖牌。七彩麒麟只累计、不转化。
        有上传模型的会显示小预览。
      </div>
    </div>
  );
}
