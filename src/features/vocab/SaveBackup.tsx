import { useRef } from "react";
import { useStore } from "../../store";
import { toast } from "../../ui/toast";

/**
 * Whole-progress backup: export the entire save to one .json file, or import
 * one (overwriting everything — only a single progress exists at a time).
 *
 * The file is portable between the web build and the desktop build, and if kept
 * in a cloud-drive folder (Dropbox / iCloud / 坚果云) it doubles as free backup
 * and cross-device sync without any server.
 */
export function SaveBackup() {
  const fileRef = useRef<HTMLInputElement>(null);

  function doExport() {
    const data = useStore.getState().exportState();
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `字游存档-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("存档已导出");
  }

  async function onFile(f: File) {
    let data: any;
    try {
      data = JSON.parse(await f.text());
    } catch {
      toast("文件不是有效的存档 JSON");
      return;
    }
    if (!data || !Array.isArray(data.vocab)) {
      toast("这不像是字游的存档文件");
      return;
    }
    if (!window.confirm("导入会用这份存档【整个覆盖】当前进度（同时只保留一份），确定继续？")) return;
    useStore.getState().importState(data);
    toast("存档已导入");
  }

  return (
    <div className="cos-section">
      <h3>存档备份 / 恢复</h3>
      <div style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.7, marginBottom: 8 }}>
        把全部进度导出成一个文件，换设备 / 换版本时导入即可。<b>同时只保留一份进度，导入会整个覆盖当前的。</b>
        <br />把文件放进你的网盘文件夹（Dropbox / iCloud / 坚果云），就等于自动备份 + 多设备同步。
      </div>
      <div className="vocab-row">
        <button onClick={doExport}>导出存档</button>
        <button onClick={() => fileRef.current?.click()}>导入存档</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
