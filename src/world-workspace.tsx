import {
  useEffect,
  useRef,
  useMemo,
  useState,
  lazy,
  Suspense,
  type RefObject,
} from "react";
import type { Dashboard, Action } from "../shared/domain.js";
import { eligible } from "../shared/spatial.js";
import { HomeScene, type SceneSelection } from "./home-scene.js";
import { InventoryWorld } from "./inventory-world.js";
import { command, pendingCommand, pendingScope, request } from "./api.js";
import type { WorldMutate } from "./possession.js";
const CyberView = lazy(() =>
  import("./cyber-view.js").then((m) => ({ default: m.CyberView })),
);

export function WorldWorkspace({
  mode,
  state,
  mutate,
  sourceScene,
  onClose,
  onService,
}: {
  mode: "cyber" | "inventory";
  state: Dashboard;
  mutate: WorldMutate;
  sourceScene: RefObject<HomeScene | null>;
  onClose: () => void;
  onService: (id: string) => void;
}) {
  const [example, setExample] = useState<Dashboard>(),
    [error, setError] = useState("");
  const [activeScene, setActiveScene] = useState<HomeScene | null>(null);
  const [cyberSelection, setCyberSelection] = useState<SceneSelection>();
  const graphScene = useMemo(() => ({ current: activeScene }), [activeScene]);
  const current = example ?? state,
    host = useRef<HTMLDivElement>(null),
    scene = useRef<HomeScene | null>(null),
    currentRef = useRef(current);
  currentRef.current = current;
  async function openExample() {
    try {
      setExample(await request<Dashboard>("/world-example/state"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (pendingCommand() && pendingScope() === "example") void openExample();
  }, []);
  const apply: WorldMutate = async (action: Action, revision?: number) => {
    if (!example) return mutate(action, revision);
    try {
      await command(action, revision ?? currentRef.current.revision, "example");
    } finally {
      setExample(await request<Dashboard>("/world-example/state"));
    }
  };
  useEffect(() => {
    setCyberSelection(undefined);
    if (mode !== "cyber" || !host.current) return;
    try {
      const s = new HomeScene(
        host.current,
        (value) => {
          if (value.kind === "entity") setCyberSelection(value);
        },
        (message) => setError(message),
        () => setCyberSelection(undefined),
      );
      scene.current = s;
      s.update(currentRef.current, {
        room: "all",
        category: "all",
        query: "",
        task: "devices",
      });
      s.setCyber(true);
      if (!example && sourceScene.current) {
        s.camera.position.copy(sourceScene.current.camera.position);
        s.controls.target.copy(sourceScene.current.controls.target);
        s.camera.zoom = sourceScene.current.camera.zoom;
        s.camera.updateProjectionMatrix();
        s.controls.update();
      }
      setActiveScene(s);
    } catch {
      setError("WebGL 暂不可用，请返回物件列表。");
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
      setActiveScene(null);
    };
  }, [mode, Boolean(example)]);
  useEffect(() => {
    scene.current?.update(current, {
      room: "all",
      category: "all",
      query: "",
      task: "devices",
    });
  }, [current]);
  const selectedEntity =
    mode === "cyber" && cyberSelection?.kind === "entity"
      ? current.home.entities.find(
          (e) =>
            e.id === cyberSelection.id && eligible(current.home, e, "devices"),
        )
      : undefined;
  useEffect(() => {
    if (mode !== "cyber" || !activeScene) return;
    if (cyberSelection && !selectedEntity) {
      setCyberSelection(undefined);
      activeScene.select(undefined);
      return;
    }
    activeScene.select(cyberSelection);
  }, [mode, activeScene, cyberSelection, selectedEntity]);
  useEffect(() => {
    if (mode !== "cyber" || !cyberSelection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        document.querySelector("dialog[open], .world-dialog")
      )
        return;
      event.preventDefault();
      setCyberSelection(undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, cyberSelection]);
  return (
    <section
      className={`world-workspace ${example ? "world-example" : ""}`}
      aria-label={mode === "cyber" ? "赛博空间" : "库存空间"}
    >
      {mode === "cyber" ? (
        <>
          <div className="world-home-viewport" ref={host} />
          <Suspense
            fallback={
              <div className="world-loading" role="status">
                正在打开服务关系图…
              </div>
            }
          >
            {activeScene && (
              <CyberView
                state={current}
                scene={graphScene}
                mutate={apply}
                onClose={onClose}
                onExample={() => void openExample()}
                selectedHostId={selectedEntity?.id}
                onSelectEntity={(id) =>
                  setCyberSelection(id ? { kind: "entity", id } : undefined)
                }
                onService={(id) => {
                  if (!example) onService(id);
                  else setError("这是示例服务，用于展示连接关系。");
                }}
              />
            )}
          </Suspense>
        </>
      ) : (
        <InventoryWorld
          key={example ? "example" : "owner"}
          state={current}
          mutate={apply}
          onClose={onClose}
          onExample={() => void openExample()}
        />
      )}
      {example && (
        <div className="world-example-banner">
          示例小世界 · 可编辑，与家庭数据分开保存
          <button
            onClick={() => {
              if (pendingCommand())
                setError("请先确认待保存的操作，再切换空间。");
              else setExample(undefined);
            }}
          >
            返回我的家
          </button>
        </div>
      )}
      {error && (
        <div className="world-error" role="alert">
          {error}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
    </section>
  );
}
