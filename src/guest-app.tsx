import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Compass,
  Mail,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { BRAND_FULL, SameRoomLogo } from "./brand.js";
import { fetchGuestState } from "./api.js";
import { HomeScene, type SceneSelection } from "./home-scene.js";
import type { SceneStyle } from "./scene-design.js";
import { HotspotEffectOverlay } from "./hotspot-effects.js";
import {
  hotspotEffectDefaults,
  resolveHotspotVisual,
  resolveHotspotWorldPosition,
  type GuestDashboard,
  type Hotspot,
} from "../shared/guest.js";
import "./fonts.css";
import "./hotspot-effects.css";
import "./guest-app.css";

function safeExternalUrl(raw: string): string | undefined {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function GuestApp({ onExitPreview }: { onExitPreview?: () => void }) {
  const [guestState, setGuestState] = useState<GuestDashboard>();
  const [loadingError, setLoadingError] = useState("");
  const [sceneError, setSceneError] = useState("");
  const [selection, setSelection] = useState<SceneSelection>();
  const [activeHotspot, setActiveHotspot] = useState<Hotspot>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [top, setTop] = useState(false);
  const [sceneStyle, setSceneStyle] = useState<SceneStyle>("natural");
  const [showHotspots, setShowHotspots] = useState(true);
  const [variantOverrides, setVariantOverrides] = useState<
    Record<string, string>
  >({});
  const [toast, setToast] = useState("");

  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<HomeScene | null>(null);

  useEffect(() => {
    let alive = true;
    let events: EventSource | undefined;
    void fetchGuestState()
      .then((initial) => {
        if (!alive) return;
        setGuestState(initial);
        events = new EventSource("/api/guest/stream");
        events.addEventListener("state", (event) => {
          const next = JSON.parse(
            (event as MessageEvent).data,
          ) as GuestDashboard;
          setGuestState((prev) =>
            !prev || next.revision >= prev.revision ? next : prev,
          );
        });
      })
      .catch((error: Error) => setLoadingError(error.message));
    return () => {
      alive = false;
      events?.close();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const effectiveState = useMemo(() => {
    if (!guestState) return undefined;
    if (!Object.keys(variantOverrides).length) return guestState;
    return {
      ...guestState,
      home: {
        ...guestState.home,
        entities: guestState.home.entities.map((entity) => {
          const override = variantOverrides[entity.id];
          if (
            override &&
            guestState.home.assets.some((asset) => asset.id === override)
          ) {
            return { ...entity, assetId: override };
          }
          return entity;
        }),
      },
    };
  }, [guestState, variantOverrides]);

  const activateRef = useRef<(hotspot: Hotspot) => void>(() => {});
  const emptyRef = useRef<() => void>(() => {});

  const clearSelection = () => {
    setSelection(undefined);
    setMenuOpen(false);
    if (activeHotspot?.effect.kind === "spotlight") {
      scene.current?.restoreView();
    }
    setActiveHotspot(undefined);
  };

  function activateHotspot(hotspot: Hotspot) {
    setMenuOpen(false);
    setSelection(undefined);

    if (
      hotspot.effect.kind === "link" &&
      hotspot.effect.openMode === "direct"
    ) {
      const safe = safeExternalUrl(hotspot.effect.url);
      if (safe) {
        const opened = window.open(safe, "_blank", "noopener,noreferrer");
        if (opened) return;
      }
    }

    if (hotspot.effect.kind === "variant" && effectiveState) {
      const target = effectiveState.home.entities.find(
        (e) => e.id === (hotspot.effect as { entityId: string }).entityId,
      );
      if (!target) return;
      const currentAsset = effectiveState.home.assets.find(
        (a) => a.id === target.assetId,
      );
      const pool = hotspot.effect.assetIds?.length
        ? effectiveState.home.assets.filter((a) =>
            (hotspot.effect as { assetIds?: string[] }).assetIds!.includes(
              a.id,
            ),
          )
        : currentAsset?.variant?.group
          ? effectiveState.home.assets.filter(
              (a) => a.variant?.group === currentAsset.variant!.group,
            )
          : [];
      if (pool.length > 1) {
        const currentIdx = pool.findIndex((a) => a.id === target.assetId);
        const nextAsset = pool[(currentIdx + 1) % pool.length];
        setVariantOverrides((prev) => ({ ...prev, [target.id]: nextAsset.id }));
        setToast(
          `已切换「${target.name}」外观：${nextAsset.variant?.label ?? nextAsset.name}（仅本次浏览生效）`,
        );
      } else {
        setToast("暂无可切换的外观变体。");
      }
      return;
    }

    if (hotspot.effect.kind === "spotlight" && effectiveState) {
      const targetEntity = hotspot.effect.targetEntityId
        ? effectiveState.home.entities.find(
            (e) =>
              e.id ===
              (hotspot.effect as { targetEntityId?: string }).targetEntityId,
          )
        : undefined;
      const targetRoom = targetEntity
        ? effectiveState.home.rooms.find(
            (r) => r.id === targetEntity.locationId,
          )
        : undefined;
      const worldPoint: [number, number, number] | undefined =
        targetEntity && targetRoom
          ? [
              targetRoom.origin[0] + targetEntity.position[0],
              targetRoom.origin[1] + targetEntity.position[1] + 0.25,
              targetRoom.origin[2] + targetEntity.position[2],
            ]
          : resolveHotspotWorldPosition(effectiveState.home, hotspot);
      if (worldPoint) {
        scene.current?.focusPoint(
          worldPoint,
          hotspot.effect.cameraOffset,
          hotspot.effect.zoom,
        );
      }
      setActiveHotspot(hotspot);
      return;
    }

    setActiveHotspot(hotspot);
  }

  activateRef.current = activateHotspot;
  emptyRef.current = () => {
    if (selection || menuOpen || activeHotspot) {
      clearSelection();
    } else {
      setMenuOpen(true);
    }
  };

  useEffect(() => {
    if (!guestState || !host.current || scene.current) return;
    try {
      const instance = new HomeScene(
        host.current,
        (value) => {
          setActiveHotspot(undefined);
          setMenuOpen(false);
          setSelection(value);
        },
        setSceneError,
        () => emptyRef.current(),
      );
      instance.setHotspotHandler((hotspot) => activateRef.current(hotspot));
      scene.current = instance;
    } catch {
      setSceneError("WebGL 暂不可用，请打开下方「共在导览」查看屋里的故事和彩蛋。");
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [Boolean(guestState)]);

  useEffect(() => {
    if (!effectiveState) return;
    scene.current?.update(effectiveState, {
      room: "all",
      category: "all",
      query: "",
      guest: true,
      showHotspots,
      activeHotspotId: activeHotspot?.id,
    });
  }, [effectiveState, showHotspots, activeHotspot?.id]);

  useEffect(() => {
    scene.current?.setPresentation(sceneStyle, true);
  }, [sceneStyle]);

  useEffect(() => {
    scene.current?.select(selection);
  }, [selection, effectiveState]);

  useEffect(() => {
    scene.current?.setView(top ? "top" : "angle");
  }, [top]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (activeHotspot) {
          if (activeHotspot.effect.kind === "spotlight") {
            scene.current?.restoreView();
          }
          setActiveHotspot(undefined);
          return;
        }
        if (menuOpen || selection) {
          clearSelection();
        }
      } else if (
        event.key.toLowerCase() === "m" &&
        !activeHotspot &&
        !(event.target as HTMLElement)?.closest("input, textarea, select")
      ) {
        event.preventDefault();
        setMenuOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeHotspot, menuOpen, selection]);

  if (!effectiveState) {
    return (
      <main className="guest-shell" aria-label="空间展示">
        <div
          style={{
            height: "100%",
            display: "grid",
            placeItems: "center",
            gap: 12,
            textAlign: "center",
            padding: 24,
          }}
        >
          <SameRoomLogo size={42} />
          <h1>{BRAND_FULL}</h1>
          <p className="muted">{loadingError || "正在推门进屋…"}</p>
        </div>
      </main>
    );
  }

  const focusedEntity = selection
    ? effectiveState.home.entities.find((e) => e.id === selection.id)
    : undefined;
  const hotspots = effectiveState.home.hotspots;
  const letterHotspot = hotspots.find((h) => h.effect.kind === "envelope");

  return (
    <div className="guest-shell" data-mode="guest">
      <main className="guest-shell" aria-label={effectiveState.home.name}>
        <h1 className="sr-only">{effectiveState.home.name}</h1>
        <div
          className="guest-viewport"
          ref={host}
          data-testid="guest-viewport"
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuOpen((v) => !v);
          }}
        />

        {!focusedEntity && (
          <div className="guest-brand-pill">
            <SameRoomLogo size={30} />
            <div className="guest-brand-copy">
              <strong>{effectiveState.home.name}</strong>
              <span>{effectiveState.home.description}</span>
            </div>
          </div>
        )}

        {focusedEntity && (
          <div
            className="guest-focus-pill"
            role="region"
            aria-label="当前聚焦物品"
          >
            <button
              type="button"
              className="guest-pill-btn"
              aria-label="返回全景"
              onClick={() => setSelection(undefined)}
            >
              <ArrowLeft size={16} />
            </button>
            <div className="guest-focus-text">
              <strong>{focusedEntity.name}</strong>
              {focusedEntity.publicSummary && (
                <small>{focusedEntity.publicSummary}</small>
              )}
            </div>
            <button
              type="button"
              className="guest-pill-btn"
              title="正面查看"
              aria-label="正面查看"
              onClick={() => scene.current?.inspect()}
            >
              <RotateCcw size={15} />
            </button>
          </div>
        )}

        {onExitPreview && (
          <div className="guest-preview-banner" role="status">
            <span>访客视角预览中（已过滤私密信息与库存）</span>
            <button type="button" onClick={onExitPreview}>
              退出预览
            </button>
          </div>
        )}

        {sceneError && (
          <div className="scene-error" role="alert">
            <p>{sceneError}</p>
            <button
              type="button"
              className="guest-chip-btn"
              onClick={() => setMenuOpen(true)}
            >
              打开共在导览
            </button>
          </div>
        )}

        <div className="guest-launcher-zone">
          <button
            type="button"
            className="guest-launcher"
            aria-label="打开共在导览"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Compass size={17} />
            <span>共在导览</span>
            {hotspots.length > 0 && (
              <span className="guest-launcher-count">{hotspots.length}</span>
            )}
          </button>
          {!menuOpen && (
            <div className="guest-quick-chips" aria-label="快捷导览">
              {letterHotspot && (
                <button
                  type="button"
                  className="guest-quick-chip is-letter"
                  onClick={() => activateHotspot(letterHotspot)}
                >
                  <Mail size={14} />
                  <span>读那封信</span>
                </button>
              )}
              <button
                type="button"
                className="guest-quick-chip"
                onClick={() => setTop((v) => !v)}
              >
                {top ? "3D 视角" : "俯视"}
              </button>
              <button
                type="button"
                className="guest-quick-chip"
                aria-pressed={showHotspots}
                onClick={() => setShowHotspots((v) => !v)}
              >
                <Sparkles size={13} />
                <span>彩蛋</span>
              </button>
              <button
                type="button"
                className="guest-quick-chip is-icon"
                aria-label="重置访客视角"
                onClick={() => {
                  setTop(false);
                  scene.current?.reset();
                }}
              >
                <RotateCcw size={13} />
              </button>
            </div>
          )}
          <span className="guest-hint">
            拖动旋转 · 点物品拉近 · 点光晕点看彩蛋
          </span>
        </div>

        {menuOpen && (
          <section
            className="guest-menu-panel"
            role="dialog"
            aria-label="共在导览"
            tabIndex={-1}
          >
            <div className="guest-menu-head">
              <div>
                <h2>{effectiveState.home.name}</h2>
                <p>{effectiveState.home.description}</p>
              </div>
              <button
                type="button"
                className="guest-pill-btn"
                aria-label="关闭共在导览"
                onClick={() => setMenuOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="guest-hotspot-list">
              <span className="guest-section-label">
                屋里的故事与彩蛋 · {hotspots.length}
              </span>
              {hotspots.length ? (
                hotspots.map((hotspot) => {
                  const visual = resolveHotspotVisual(hotspot);
                  const kind = hotspotEffectDefaults[hotspot.effect.kind];
                  return (
                    <button
                      key={hotspot.id}
                      type="button"
                      className="guest-hotspot-item"
                      onClick={() => activateHotspot(hotspot)}
                    >
                      <span
                        className="guest-hotspot-dot"
                        style={
                          {
                            "--dot-color": visual.color,
                          } as React.CSSProperties
                        }
                      />
                      <span>
                        <strong>{hotspot.label}</strong>
                        <small>{kind.label}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  );
                })
              ) : (
                <p className="muted">这间屋子暂时还没挂上互动彩蛋。</p>
              )}
            </div>

            <div className="guest-hotspot-list">
              <span className="guest-section-label">视野与风格</span>
              <div className="guest-controls-row">
                <button
                  type="button"
                  className="guest-chip-btn"
                  aria-label="缩小场景"
                  onClick={() => scene.current?.zoom(0.85)}
                >
                  <Minus size={14} />
                </button>
                <button
                  type="button"
                  className="guest-chip-btn"
                  aria-label="放大场景"
                  onClick={() => scene.current?.zoom(1.18)}
                >
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  className={`guest-chip-btn ${!top ? "active" : ""}`}
                  onClick={() => setTop(false)}
                >
                  3D
                </button>
                <button
                  type="button"
                  className={`guest-chip-btn ${top ? "active" : ""}`}
                  onClick={() => setTop(true)}
                >
                  俯视
                </button>
                <button
                  type="button"
                  className="guest-chip-btn"
                  onClick={() => {
                    clearSelection();
                    scene.current?.reset();
                  }}
                >
                  <RotateCcw size={13} />
                  重置
                </button>
              </div>
              <div className="guest-controls-row">
                <button
                  type="button"
                  className={`guest-chip-btn ${sceneStyle === "natural" ? "active" : ""}`}
                  onClick={() => setSceneStyle("natural")}
                >
                  自然材质
                </button>
                <button
                  type="button"
                  className={`guest-chip-btn ${sceneStyle === "soft" ? "active" : ""}`}
                  onClick={() => setSceneStyle("soft")}
                >
                  柔和色彩
                </button>
                <button
                  type="button"
                  className={`guest-chip-btn ${showHotspots ? "active" : ""}`}
                  onClick={() => setShowHotspots((v) => !v)}
                >
                  <Sparkles size={13} />
                  光晕点
                </button>
              </div>
            </div>
          </section>
        )}

        {activeHotspot && (
          <HotspotEffectOverlay
            hotspot={activeHotspot}
            allHotspots={hotspots}
            onClose={() => {
              if (activeHotspot.effect.kind === "spotlight") {
                scene.current?.restoreView();
              }
              setActiveHotspot(undefined);
            }}
            onSelectHotspot={(next) => activateHotspot(next)}
          />
        )}

        {toast && (
          <div className="guest-toast" role="status">
            <span>{toast}</span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setToast("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
