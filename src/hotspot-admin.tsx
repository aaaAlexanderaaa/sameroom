import { useEffect, useState } from "react";
import { v4 as randomUUID } from "uuid";
import {
  Camera,
  Check,
  Crosshair,
  Eye,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { PhotoPicker } from "./possession.js";
import { hotspotIconMeta } from "./hotspot-icons.js";
import type { SurfacePickHit } from "./home-scene.js";
import type { Action, Dashboard, Entity } from "../shared/domain.js";
import {
  hotspotEffectDefaults,
  hotspotIconKeys,
  resolveHotspotVisual,
  type EntityGuest,
  type Hotspot,
  type HotspotEffect,
  type HotspotIconKey,
} from "../shared/guest.js";

const colorPresets = [
  "#b65a44",
  "#3d7a64",
  "#35688c",
  "#58569c",
  "#b67c2c",
  "#a88324",
  "#8c4a6e",
  "#4c5c56",
];

function slugifyId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function defaultEffect(
  kind: HotspotEffect["kind"],
  home: Dashboard["home"],
  fallbackEntity?: Entity,
): HotspotEffect {
  switch (kind) {
    case "envelope":
      return {
        kind: "envelope",
        title: "一封留给访客的信",
        theme: "cream",
        sealText: "拆",
        body: "欢迎来到我的 3D 小空间，随便逛逛。",
      };
    case "album":
      return {
        kind: "album",
        title: "空间记忆相册",
        layout: "lightbox",
        items: [],
      } as unknown as HotspotEffect;
    case "link":
      return {
        kind: "link",
        title: "外部链接",
        url: "https://example.com",
        openMode: "card",
      };
    case "iframe":
      return {
        kind: "iframe",
        title: "内嵌互动网页",
        url: "https://example.com",
        aspectRatio: "16:9",
      };
    case "spotlight":
      return {
        kind: "spotlight",
        title: "角落故事",
        story: "这里记录着这个角落的来历和想法。",
        ...(fallbackEntity ? { targetEntityId: fallbackEntity.id } : {}),
      };
    case "variant": {
      const variantEntity =
        home.entities.find((e) => {
          const asset = home.assets.find((a) => a.id === e.assetId);
          return Boolean(asset?.variant?.group) && e.scope === "home";
        }) ?? fallbackEntity;
      return {
        kind: "variant",
        title: "切换外观彩蛋",
        entityId: variantEntity?.id ?? "",
      };
    }
  }
}

export function EntityGuestSection({
  entity,
  mutate,
  notify,
}: {
  entity: Entity;
  mutate: (action: Action) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [visibility, setVisibility] = useState<EntityGuest["visibility"]>(
    entity.guest?.visibility ?? "show",
  );
  const [summary, setSummary] = useState(entity.guest?.summary ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVisibility(entity.guest?.visibility ?? "show");
    setSummary(entity.guest?.summary ?? "");
  }, [entity.id, entity.guest?.visibility, entity.guest?.summary]);

  if (entity.scope !== "home" || entity.visibility === "editing") return null;

  return (
    <details className="demo-controls">
      <summary>访客展示设置</summary>
      <p>
        控制访客模式下这件物品能否被点击对焦、隐藏，以及对外显示的一句话介绍。
      </p>
      <label className="field">
        访客可见性
        <select
          value={visibility}
          onChange={(e) =>
            setVisibility(e.target.value as EntityGuest["visibility"])
          }
        >
          <option value="show">可点击对焦欣赏（默认）</option>
          <option value="backdrop">仅作为背景渲染（不可点击）</option>
          <option value="hide">在访客模式下完全隐藏</option>
        </select>
      </label>
      <label className="field">
        访客公开短简介（可选）
        <input
          maxLength={240}
          placeholder="例如：日常主力工作区桌面"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="secondary full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await mutate({
              type: "entity.guest",
              entityId: entity.id,
              guest: {
                visibility,
                ...(summary.trim() ? { summary: summary.trim() } : {}),
              },
            });
            notify("访客展示设置已保存。");
          } catch (e) {
            notify((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Check size={14} />
        保存访客展示设置
      </button>
    </details>
  );
}

export function HotspotDraftForm({
  state,
  initialHotspot,
  pickedHit,
  onPickInScene,
  onCaptureCameraPose,
  onPreview,
  mutate,
  notify,
  onCancel,
  onSaved,
}: {
  state: Dashboard;
  initialHotspot?: Hotspot;
  pickedHit?: SurfacePickHit;
  onPickInScene: (draft: Hotspot) => void;
  onCaptureCameraPose: () =>
    { offset: [number, number, number]; zoom: number } | undefined;
  onPreview: (hotspot: Hotspot) => void;
  mutate: (action: Action) => Promise<void>;
  notify: (message: string) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const physicalRooms = state.home.rooms.filter((r) => r.kind === "room");
  const visibleEntities = state.home.entities.filter(
    (e) =>
      e.scope === "home" &&
      e.lifecycle === "active" &&
      e.visibility !== "editing" &&
      e.attachment?.kind !== "storage",
  );
  const firstRoom = physicalRooms[0];
  const firstEntity = visibleEntities[0];

  const [id] = useState(() => initialHotspot?.id ?? slugifyId("hotspot"));
  const [label, setLabel] = useState(initialHotspot?.label ?? "新交互光晕点");
  const [audience, setAudience] = useState<Hotspot["audience"]>(
    initialHotspot?.audience ?? "guest-and-admin",
  );
  const [anchor, setAnchor] = useState<Hotspot["anchor"]>(
    initialHotspot?.anchor ??
      (firstEntity
        ? {
            kind: "entity",
            entityId: firstEntity.id,
            offset: [0, 0.35, 0],
          }
        : {
            kind: "room",
            locationId: firstRoom?.id ?? state.home.rooms[0].id,
            position: [0, 0.3, 0],
          }),
  );
  const [visual, setVisual] = useState<Hotspot["visual"]>(
    initialHotspot?.visual ?? { size: "md", pulse: "soft" },
  );
  const [effect, setEffect] = useState<HotspotEffect>(
    initialHotspot?.effect ??
      defaultEffect("envelope", state.home, firstEntity),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pickedHit) return;
    if (pickedHit.kind === "entity" && pickedHit.entityId) {
      setAnchor({
        kind: "entity",
        entityId: pickedHit.entityId,
        offset: pickedHit.entityLocalOffset ?? [0, 0.25, 0],
      });
    } else {
      setAnchor({
        kind: "room",
        locationId: pickedHit.locationId,
        position: pickedHit.roomPosition,
      });
    }
  }, [pickedHit]);

  const resolvedVisual = resolveHotspotVisual({
    id,
    label,
    audience,
    anchor,
    visual,
    effect,
  });

  function changeEffectKind(kind: HotspotEffect["kind"]) {
    const defaults = hotspotEffectDefaults[kind];
    setEffect(defaultEffect(kind, state.home, firstEntity));
    setVisual((v) => ({
      ...v,
      icon: defaults.icon,
      color: defaults.color,
    }));
  }

  function currentDraft(): Hotspot {
    return {
      id,
      label: label.trim() || "未命名交互点",
      audience,
      anchor,
      visual,
      effect,
    };
  }

  async function submit() {
    setError("");
    if (effect.kind === "album" && effect.items.length === 0) {
      setError("相册至少需要添加 1 张照片。");
      return;
    }
    setBusy(true);
    try {
      const draft = currentDraft();
      await mutate({ type: "hotspot.upsert", hotspot: draft });
      notify("交互光晕点已保存。");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hotspot-form">
      <div className="two-fields">
        <label className="field">
          悬停标签名称
          <input
            value={label}
            maxLength={160}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：欢迎信 / 桌面演化相册"
          />
        </label>
        <label className="field">
          可见范围
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value as Hotspot["audience"])}
          >
            <option value="guest-and-admin">访客与管理者均可见</option>
            <option value="guest-only">仅访客模式展示</option>
            <option value="admin-only">仅管理者可见（草稿）</option>
          </select>
        </label>
      </div>

      <fieldset className="hotspot-fieldset">
        <legend>空间位置锚点</legend>
        <div className="hotspot-anchor-bar">
          <select
            aria-label="锚点类型"
            value={anchor.kind}
            onChange={(e) => {
              const kind = e.target.value;
              if (kind === "entity" && firstEntity) {
                setAnchor({
                  kind: "entity",
                  entityId: firstEntity.id,
                  offset: [0, 0.35, 0],
                });
              } else if (firstRoom) {
                setAnchor({
                  kind: "room",
                  locationId: firstRoom.id,
                  position: [0, 0.35, 0],
                });
              }
            }}
          >
            <option value="entity" disabled={!firstEntity}>
              跟随物品（随家具移动）
            </option>
            <option value="room" disabled={!firstRoom}>
              固定在房间坐标
            </option>
          </select>
          <button
            type="button"
            className="secondary"
            onClick={() => onPickInScene(currentDraft())}
          >
            <Crosshair size={14} />在 3D 场景点击拾取
          </button>
        </div>

        {anchor.kind === "entity" ? (
          <>
            <label className="field">
              依附物件
              <select
                value={anchor.entityId}
                onChange={(e) =>
                  setAnchor({ ...anchor, entityId: e.target.value })
                }
              >
                {visibleEntities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="three-fields">
              {(["左右 X", "高度 Y", "前后 Z"] as const).map((axis, idx) => (
                <label className="field" key={axis}>
                  {axis}
                  <input
                    type="number"
                    step="0.05"
                    value={anchor.offset[idx]}
                    onChange={(e) => {
                      const next = [...anchor.offset] as [
                        number,
                        number,
                        number,
                      ];
                      next[idx] = Number(e.target.value) || 0;
                      setAnchor({ ...anchor, offset: next });
                    }}
                  />
                </label>
              ))}
            </div>
          </>
        ) : (
          <>
            <label className="field">
              所属房间
              <select
                value={anchor.locationId}
                onChange={(e) =>
                  setAnchor({ ...anchor, locationId: e.target.value })
                }
              >
                {physicalRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="three-fields">
              {(["左右 X", "高度 Y", "前后 Z"] as const).map((axis, idx) => (
                <label className="field" key={axis}>
                  {axis}
                  <input
                    type="number"
                    step="0.05"
                    value={anchor.position[idx]}
                    onChange={(e) => {
                      const next = [...anchor.position] as [
                        number,
                        number,
                        number,
                      ];
                      next[idx] = Number(e.target.value) || 0;
                      setAnchor({ ...anchor, position: next });
                    }}
                  />
                </label>
              ))}
            </div>
          </>
        )}
      </fieldset>

      <fieldset className="hotspot-fieldset">
        <legend>光晕外观（按功能预设，支持自由修改）</legend>
        <div className="two-fields">
          <label className="field">
            交互类型
            <select
              value={effect.kind}
              onChange={(e) =>
                changeEffectKind(e.target.value as HotspotEffect["kind"])
              }
            >
              {Object.entries(hotspotEffectDefaults).map(([kind, meta]) => (
                <option key={kind} value={kind}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            图标样式
            <select
              value={resolvedVisual.icon}
              onChange={(e) =>
                setVisual((v) => ({
                  ...v,
                  icon: e.target.value as HotspotIconKey,
                }))
              }
            >
              {hotspotIconKeys.map((key) => (
                <option key={key} value={key}>
                  {hotspotIconMeta[key].label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="hotspot-visual-row">
          <div className="hotspot-swatches" role="group" aria-label="光晕颜色">
            {colorPresets.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`hotspot-swatch ${resolvedVisual.color.toLowerCase() === hex ? "active" : ""}`}
                style={{ background: hex }}
                aria-label={`颜色 ${hex}`}
                onClick={() => setVisual((v) => ({ ...v, color: hex }))}
              />
            ))}
            <input
              type="color"
              aria-label="自定义光晕颜色"
              value={resolvedVisual.color}
              onChange={(e) =>
                setVisual((v) => ({ ...v, color: e.target.value }))
              }
            />
          </div>
          <select
            aria-label="光晕大小"
            value={resolvedVisual.size}
            onChange={(e) =>
              setVisual((v) => ({
                ...v,
                size: e.target.value as "sm" | "md" | "lg",
              }))
            }
          >
            <option value="sm">小点</option>
            <option value="md">标准</option>
            <option value="lg">大点</option>
          </select>
          <select
            aria-label="呼吸动效"
            value={resolvedVisual.pulse}
            onChange={(e) =>
              setVisual((v) => ({
                ...v,
                pulse: e.target.value as "soft" | "beacon" | "static",
              }))
            }
          >
            <option value="soft">柔和呼吸</option>
            <option value="beacon">信标强脉冲</option>
            <option value="static">静止微光</option>
          </select>
        </div>
      </fieldset>

      <fieldset className="hotspot-fieldset">
        <legend>效果内容配置</legend>
        <label className="field">
          弹窗 / 卡片标题
          <input
            value={effect.title}
            maxLength={160}
            onChange={(e) => setEffect({ ...effect, title: e.target.value })}
          />
        </label>

        {effect.kind === "envelope" && (
          <>
            <div className="three-fields">
              <label className="field">
                信封纸张风格
                <select
                  value={effect.theme}
                  onChange={(e) =>
                    setEffect({
                      ...effect,
                      theme: e.target.value as "cream" | "kraft" | "night",
                    })
                  }
                >
                  <option value="cream">奶油宣纸</option>
                  <option value="kraft">复古牛皮纸</option>
                  <option value="night">深海夜色</option>
                </select>
              </label>
              <label className="field">
                火漆印字
                <input
                  maxLength={8}
                  value={effect.sealText ?? ""}
                  placeholder="拆"
                  onChange={(e) =>
                    setEffect({ ...effect, sealText: e.target.value })
                  }
                />
              </label>
              <label className="field">
                日期（可选）
                <input
                  maxLength={40}
                  value={effect.date ?? ""}
                  placeholder="2026.11"
                  onChange={(e) =>
                    setEffect({ ...effect, date: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="two-fields">
              <label className="field">
                收信人（可选）
                <input
                  maxLength={80}
                  value={effect.recipient ?? ""}
                  placeholder="来访的朋友"
                  onChange={(e) =>
                    setEffect({ ...effect, recipient: e.target.value })
                  }
                />
              </label>
              <label className="field">
                写信人 / 署名（可选）
                <input
                  maxLength={80}
                  value={effect.sender ?? ""}
                  onChange={(e) =>
                    setEffect({ ...effect, sender: e.target.value })
                  }
                />
              </label>
            </div>
            <label className="field">
              信件正文
              <textarea
                rows={5}
                maxLength={6000}
                value={effect.body}
                onChange={(e) => setEffect({ ...effect, body: e.target.value })}
              />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={Boolean(effect.typewriter)}
                onChange={(e) =>
                  setEffect({ ...effect, typewriter: e.target.checked })
                }
              />
              打印机逐字敲出特效（约 24 秒带句间停顿）
            </label>
            <PhotoPicker
              photos={effect.photo ? [effect.photo] : []}
              onChange={(photos) =>
                setEffect({
                  ...effect,
                  photo: photos.at(-1),
                })
              }
              onBusy={setBusy}
            />
          </>
        )}

        {effect.kind === "album" && (
          <>
            <div className="two-fields">
              <label className="field">
                相册副标题（可选）
                <input
                  maxLength={240}
                  value={effect.subtitle ?? ""}
                  onChange={(e) =>
                    setEffect({ ...effect, subtitle: e.target.value })
                  }
                />
              </label>
              <label className="field">
                展开风格
                <select
                  value={effect.layout}
                  onChange={(e) =>
                    setEffect({
                      ...effect,
                      layout: e.target.value as "lightbox" | "polaroid",
                    })
                  }
                >
                  <option value="lightbox">幻灯片大图灯箱</option>
                  <option value="polaroid">拍立得画册网格</option>
                </select>
              </label>
            </div>
            <PhotoPicker
              photos={effect.items.map((item) => item.photo)}
              onChange={(urls) => {
                const byUrl = new Map(effect.items.map((i) => [i.photo, i]));
                setEffect({
                  ...effect,
                  items: urls.map((url) => byUrl.get(url) ?? { photo: url }),
                });
              }}
              onBusy={setBusy}
            />
            {effect.items.map((item, idx) => (
              <div className="album-item-editor" key={item.photo}>
                <img src={item.photo} alt="" />
                <div>
                  <input
                    placeholder={`照片 ${idx + 1} 标题（可选）`}
                    maxLength={160}
                    value={item.caption ?? ""}
                    onChange={(e) => {
                      const next = [...effect.items];
                      next[idx] = { ...item, caption: e.target.value };
                      setEffect({ ...effect, items: next });
                    }}
                  />
                  <input
                    placeholder="日期或配文故事（可选）"
                    maxLength={1000}
                    value={item.story ?? ""}
                    onChange={(e) => {
                      const next = [...effect.items];
                      next[idx] = { ...item, story: e.target.value };
                      setEffect({ ...effect, items: next });
                    }}
                  />
                </div>
              </div>
            ))}
          </>
        )}

        {effect.kind === "link" && (
          <>
            <label className="field">
              外部网站 URL（http / https）
              <input
                type="url"
                value={effect.url}
                onChange={(e) => setEffect({ ...effect, url: e.target.value })}
              />
            </label>
            <div className="two-fields">
              <label className="field">
                触发方式
                <select
                  value={effect.openMode}
                  onChange={(e) =>
                    setEffect({
                      ...effect,
                      openMode: e.target.value as "card" | "direct",
                    })
                  }
                >
                  <option value="card">先弹出说明卡片再跳转（推荐）</option>
                  <option value="direct">点击直接新窗口跳转</option>
                </select>
              </label>
              <label className="field">
                按钮文案（可选）
                <input
                  maxLength={60}
                  value={effect.buttonLabel ?? ""}
                  placeholder="前往访问"
                  onChange={(e) =>
                    setEffect({ ...effect, buttonLabel: e.target.value })
                  }
                />
              </label>
            </div>
            <label className="field">
              简介说明（可选）
              <textarea
                rows={3}
                maxLength={600}
                value={effect.description ?? ""}
                onChange={(e) =>
                  setEffect({ ...effect, description: e.target.value })
                }
              />
            </label>
          </>
        )}

        {effect.kind === "iframe" && (
          <>
            <label className="field">
              嵌入网页 URL（http / https）
              <input
                type="url"
                value={effect.url}
                onChange={(e) => setEffect({ ...effect, url: e.target.value })}
              />
            </label>
            <div className="two-fields">
              <label className="field">
                画框比例
                <select
                  value={effect.aspectRatio}
                  onChange={(e) =>
                    setEffect({
                      ...effect,
                      aspectRatio: e.target.value as "16:9" | "4:3" | "tall",
                    })
                  }
                >
                  <option value="16:9">16:9 宽屏</option>
                  <option value="4:3">4:3 标准</option>
                  <option value="tall">竖屏卡片</option>
                </select>
              </label>
              <label className="field">
                补充说明（可选）
                <input
                  maxLength={600}
                  value={effect.description ?? ""}
                  onChange={(e) =>
                    setEffect({ ...effect, description: e.target.value })
                  }
                />
              </label>
            </div>
          </>
        )}

        {effect.kind === "spotlight" && (
          <>
            <div className="two-fields">
              <label className="field">
                顶部角标（可选）
                <input
                  maxLength={40}
                  value={effect.badge ?? ""}
                  placeholder="角落故事"
                  onChange={(e) =>
                    setEffect({ ...effect, badge: e.target.value })
                  }
                />
              </label>
              <label className="field">
                弹出形态
                <select
                  value={effect.presentation ?? "dock"}
                  onChange={(e) =>
                    setEffect({
                      ...effect,
                      presentation: e.target.value as "dock" | "popup",
                    })
                  }
                >
                  <option value="dock">底部导览条</option>
                  <option value="popup">居中气泡卡片</option>
                </select>
              </label>
            </div>
            <label className="field">
              导览故事正文
              <textarea
                rows={4}
                maxLength={2000}
                value={effect.story}
                onChange={(e) =>
                  setEffect({ ...effect, story: e.target.value })
                }
              />
            </label>
            <div className="two-fields">
              <label className="field">
                聚焦参照物件（可选）
                <select
                  value={effect.targetEntityId ?? ""}
                  onChange={(e) =>
                    setEffect({
                      ...effect,
                      targetEntityId: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">以光晕点为中心</option>
                  {visibleEntities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field">
                <span>预设镜头机位</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const pose = onCaptureCameraPose();
                    if (!pose) return;
                    setEffect({
                      ...effect,
                      cameraOffset: pose.offset,
                      zoom: pose.zoom,
                    });
                    notify(`已采集当前镜头偏移（缩放 ${pose.zoom}x）`);
                  }}
                >
                  <Camera size={14} />
                  采集当前视角
                </button>
              </div>
            </div>
            <PhotoPicker
              photos={effect.photo ? [effect.photo] : []}
              onChange={(photos) =>
                setEffect({ ...effect, photo: photos.at(-1) })
              }
              onBusy={setBusy}
            />
          </>
        )}

        {effect.kind === "variant" && (
          <>
            <label className="field">
              目标物品（含多外观变体分组）
              <select
                value={effect.entityId}
                onChange={(e) =>
                  setEffect({ ...effect, entityId: e.target.value })
                }
              >
                {visibleEntities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              提示文案（可选）
              <input
                maxLength={240}
                value={effect.description ?? ""}
                onChange={(e) =>
                  setEffect({ ...effect, description: e.target.value })
                }
              />
            </label>
          </>
        )}
      </fieldset>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="hotspot-form-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => onPreview(currentDraft())}
        >
          <Eye size={14} />
          试运行效果
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="secondary" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void submit()}
        >
          <Check size={14} />
          保存交互点
        </button>
      </div>
    </div>
  );
}

export function HotspotManager({
  state,
  draftToResume,
  pickedHit,
  onPickInScene,
  onCaptureCameraPose,
  onPreview,
  mutate,
  notify,
}: {
  state: Dashboard;
  draftToResume?: Hotspot;
  pickedHit?: SurfacePickHit;
  onPickInScene: (draft: Hotspot) => void;
  onCaptureCameraPose: () =>
    { offset: [number, number, number]; zoom: number } | undefined;
  onPreview: (hotspot: Hotspot) => void;
  mutate: (action: Action) => Promise<void>;
  notify: (message: string) => void;
}) {
  const hotspots = state.home.hotspots ?? [];
  const [editing, setEditing] = useState<Hotspot | "new" | undefined>(
    draftToResume,
  );
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    if (draftToResume) setEditing(draftToResume);
  }, [draftToResume]);

  if (editing) {
    return (
      <HotspotDraftForm
        state={state}
        initialHotspot={editing === "new" ? undefined : editing}
        pickedHit={pickedHit}
        onPickInScene={onPickInScene}
        onCaptureCameraPose={onCaptureCameraPose}
        onPreview={onPreview}
        mutate={mutate}
        notify={notify}
        onCancel={() => setEditing(undefined)}
        onSaved={() => setEditing(undefined)}
      />
    );
  }

  return (
    <div className="hotspot-manager">
      <div className="hotspot-manager-bar">
        <p className="muted">
          在标准视图留下类似游戏的光晕点。访客点击普通物品只会拉近对焦，点击光晕点才会触发这些互动效果。
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => setEditing("new")}
        >
          <Plus size={15} />
          新建光晕点
        </button>
      </div>

      {hotspots.length ? (
        <div className="hotspot-admin-list">
          {hotspots.map((hotspot) => {
            const visual = resolveHotspotVisual(hotspot);
            const meta = hotspotEffectDefaults[hotspot.effect.kind];
            return (
              <div className="hotspot-admin-row" key={hotspot.id}>
                <span
                  className="guest-hotspot-dot"
                  style={{ "--dot-color": visual.color } as React.CSSProperties}
                />
                <div className="hotspot-admin-info">
                  <strong>{hotspot.label}</strong>
                  <small>
                    {meta.label} ·{" "}
                    {hotspot.audience === "guest-and-admin"
                      ? "全员可见"
                      : hotspot.audience === "guest-only"
                        ? "仅访客"
                        : "仅管理者"}
                    {" · "}
                    {hotspot.anchor.kind === "entity"
                      ? `跟随「${
                          state.home.entities.find(
                            (e) =>
                              e.id ===
                              (hotspot.anchor as { entityId: string }).entityId,
                          )?.name ?? hotspot.anchor.entityId
                        }」`
                      : `房间「${
                          state.home.rooms.find(
                            (r) =>
                              r.id ===
                              (hotspot.anchor as { locationId: string })
                                .locationId,
                          )?.name ?? hotspot.anchor.locationId
                        }」`}
                  </small>
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onPreview(hotspot)}
                >
                  <Sparkles size={14} />
                  预览
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEditing(hotspot)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label={`删除 ${hotspot.label}`}
                  disabled={busyId === hotspot.id}
                  onClick={async () => {
                    setBusyId(hotspot.id);
                    try {
                      await mutate({
                        type: "hotspot.delete",
                        hotspotId: hotspot.id,
                      });
                      notify("已删除交互光晕点。");
                    } catch (e) {
                      notify((e as Error).message);
                    } finally {
                      setBusyId("");
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="calm-empty">
          <Sparkles size={20} />
          <strong>还没有设置交互光晕点</strong>
          <p>可以给桌面的信封、相册或外链入口加上一个光点。</p>
        </div>
      )}
    </div>
  );
}
