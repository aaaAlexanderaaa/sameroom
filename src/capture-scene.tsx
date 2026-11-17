import { useEffect, useRef, useState } from "react";
import type { Dashboard } from "../shared/domain.js";
import { HomeScene } from "./home-scene.js";

/** Read-only preview of the actual home plus a temporary capture candidate. */
export function CaptureScene({
  state,
  roomId,
  entityId,
  supportId,
}: {
  state: Dashboard;
  roomId: string;
  entityId?: string;
  supportId?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<HomeScene | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      scene.current = new HomeScene(host.current!, () => {}, setError);
      scene.current.setPresentation("natural", false);
    } catch {
      setError("无法显示空间预览。请恢复 WebGL 后再检查摆放效果。");
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.update(state, {
      room: roomId,
      category: "all",
      query: "",
      task: "browse",
    });
    scene.current?.focus(roomId);
    scene.current?.select(
      entityId ? { kind: "entity", id: entityId } : undefined,
    );
  }, [state, roomId, entityId]);
  // Reframe when switching to another support in the same room.
  useEffect(() => {
    if (entityId) {
      scene.current?.select(undefined);
      scene.current?.select({ kind: "entity", id: entityId });
    }
  }, [entityId, supportId]);
  return (
    <div className="capture-space">
      <div
        ref={host}
        className="capture-viewport"
        aria-label="当前家庭中的摆放预览"
      />
      <span className="capture-preview-badge">摆放预览 · 尚未保存</span>
      {error && (
        <p className="capture-scene-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
