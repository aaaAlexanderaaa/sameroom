import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe,
  Images,
  Mail,
  Sparkles,
  X,
} from "lucide-react";
import { hotspotEffectDefaults, type Hotspot } from "../shared/guest.js";
import "./hotspot-effects.css";

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

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function typewriterSchedule(text: string, targetSeconds = 24): number[] {
  const chars = Array.from(text);
  if (!chars.length) return [];
  const weights = chars.map((ch) => {
    if (ch === "\n") return 11;
    if ("。！？.!?".includes(ch)) return 10;
    if ("，、；：,;:" .includes(ch)) return 4;
    return 1;
  });
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
  const totalMs = Math.max(8000, Math.min(35000, targetSeconds * 1000));
  const unitMs = totalMs / totalWeight;
  let elapsed = 0;
  return weights.map((w) => {
    elapsed += w * unitMs;
    return Math.round(elapsed);
  });
}

function EnvelopeModal({
  hotspot,
  onClose,
}: {
  hotspot: Hotspot & { effect: { kind: "envelope" } };
  onClose: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const { effect } = hotspot;
  const chars = Array.from(effect.body);
  const wantsTypewriter = Boolean(effect.typewriter);
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const [visibleCount, setVisibleCount] = useState(() =>
    wantsTypewriter && !reducedMotion ? 0 : chars.length,
  );
  const [skipped, setSkipped] = useState(false);
  const [replaySeed, setReplaySeed] = useState(0);

  useEffect(() => {
    if (!opened) {
      setSkipped(false);
      setVisibleCount(wantsTypewriter && !reducedMotion ? 0 : chars.length);
      return;
    }
    if (!wantsTypewriter || reducedMotion || skipped) {
      setVisibleCount(chars.length);
      return;
    }
    setVisibleCount(0);
    const schedule = typewriterSchedule(
      effect.body,
      effect.typingDurationSeconds ?? 24,
    );
    const timers: number[] = [];
    for (let i = 0; i < schedule.length; i++) {
      timers.push(
        window.setTimeout(() => {
          setVisibleCount((prev) => Math.max(prev, i + 1));
        }, schedule[i]),
      );
    }
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [
    opened,
    wantsTypewriter,
    reducedMotion,
    effect.body,
    effect.typingDurationSeconds,
    chars.length,
    replaySeed,
    skipped,
  ]);

  const typingDone = visibleCount >= chars.length;
  const shownText = typingDone
    ? effect.body
    : chars.slice(0, visibleCount).join("");
  const shownParagraphs = shownText.split(/\n{2,}/);

  return (
    <div className="envelope-stage">
      {!opened ? (
        <div className={`envelope-card theme-${effect.theme}`}>
          <div className="envelope-flap" />
          <div className="envelope-meta">
            <span>
              {effect.recipient ? `To: ${effect.recipient}` : hotspot.label}
            </span>
            <span>{effect.date ?? ""}</span>
          </div>
          <button
            type="button"
            className="envelope-seal"
            onClick={() => setOpened(true)}
            aria-label="拆开信封"
          >
            {effect.sealText?.trim() || "拆"}
          </button>
          <div className="envelope-meta">
            <span>{effect.sender ? `From: ${effect.sender}` : ""}</span>
            <span className="envelope-hint">点一下火漆，拆开这封信</span>
          </div>
        </div>
      ) : (
        <article className={`letter-sheet theme-${effect.theme}`}>
          {effect.recipient && (
            <p className="envelope-meta">
              <span>致 {effect.recipient}：</span>
              <span>{effect.date ?? ""}</span>
            </p>
          )}
          {effect.photo && (
            <img
              className="letter-photo"
              src={effect.photo}
              alt={effect.title}
            />
          )}
          <div
            className={`letter-body ${wantsTypewriter ? "is-typewriter" : ""}`}
          >
            {shownParagraphs.map((para, i) => (
              <p key={i}>
                {para}
                {wantsTypewriter &&
                  !typingDone &&
                  i === shownParagraphs.length - 1 && (
                    <span className="typewriter-caret" aria-hidden="true" />
                  )}
              </p>
            ))}
          </div>
          {typingDone && (
            <div className="letter-sign">
              <span>
                {effect.signature ?? effect.sender ?? ""}
                {!effect.recipient && effect.date ? ` · ${effect.date}` : ""}
              </span>
              <div className="letter-controls">
                {wantsTypewriter && (
                  <button
                    type="button"
                    className="hotspot-secondary-btn"
                    onClick={() => {
                      setSkipped(false);
                      setReplaySeed((s) => s + 1);
                    }}
                  >
                    重打一遍
                  </button>
                )}
                <button
                  type="button"
                  className="hotspot-secondary-btn"
                  onClick={() => setOpened(false)}
                >
                  重新封好
                </button>
              </div>
            </div>
          )}
          {!typingDone && (
            <div className="letter-sign">
              <span className="muted">正在从桌面键盘敲出这封信…</span>
              <button
                type="button"
                className="hotspot-secondary-btn"
                onClick={() => {
                  setSkipped(true);
                  setVisibleCount(chars.length);
                }}
              >
                跳过直接读全文
              </button>
            </div>
          )}
        </article>
      )}
      <button type="button" className="hotspot-secondary-btn" onClick={onClose}>
        收起返回空间
      </button>
    </div>
  );
}

function AlbumModal({
  hotspot,
}: {
  hotspot: Hotspot & { effect: { kind: "album" } };
}) {
  const { effect } = hotspot;
  const [index, setIndex] = useState<number>(0);
  const [gridView, setGridView] = useState(effect.layout === "polaroid");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (gridView) return;
      if (event.key === "ArrowLeft") {
        setIndex((i) => (i - 1 + effect.items.length) % effect.items.length);
      } else if (event.key === "ArrowRight") {
        setIndex((i) => (i + 1) % effect.items.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [effect.items.length, gridView]);

  const current = effect.items[index] ?? effect.items[0];
  return (
    <div className="album-stage">
      {effect.subtitle && <p className="muted">{effect.subtitle}</p>}
      {effect.layout === "polaroid" && (
        <div className="spotlight-actions">
          <span className="muted">共 {effect.items.length} 张记忆</span>
          <button
            type="button"
            className="hotspot-secondary-btn"
            onClick={() => setGridView((v) => !v)}
          >
            {gridView ? "大图浏览" : "返回拍立得墙"}
          </button>
        </div>
      )}
      {gridView ? (
        <div className="polaroid-grid">
          {effect.items.map((item, i) => (
            <button
              key={`${item.photo}-${i}`}
              type="button"
              className="polaroid-card"
              onClick={() => {
                setIndex(i);
                setGridView(false);
              }}
            >
              <img src={item.photo} alt={item.caption ?? `相册照片 ${i + 1}`} />
              <span>{item.caption ?? `照片 ${i + 1}`}</span>
              {item.date && <small className="muted">{item.date}</small>}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="album-viewer">
            <img
              src={current.photo}
              alt={current.caption ?? `相册照片 ${index + 1}`}
            />
            {effect.items.length > 1 && (
              <>
                <button
                  type="button"
                  className="album-nav prev"
                  aria-label="上一张"
                  onClick={() =>
                    setIndex(
                      (i) =>
                        (i - 1 + effect.items.length) % effect.items.length,
                    )
                  }
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  type="button"
                  className="album-nav next"
                  aria-label="下一张"
                  onClick={() => setIndex((i) => (i + 1) % effect.items.length)}
                >
                  <ChevronRight size={20} />
                </button>
              </>
            )}
          </div>
          <div className="album-caption">
            <strong>
              {current.caption ?? `第 ${index + 1} 张`}
              {current.date ? ` · ${current.date}` : ""}
            </strong>
            {current.story && <p>{current.story}</p>}
          </div>
          {effect.items.length > 1 && (
            <div
              className="album-thumbs"
              role="tablist"
              aria-label="相册缩略图"
            >
              {effect.items.map((item, i) => (
                <button
                  key={`${item.photo}-${i}`}
                  type="button"
                  className={`album-thumb ${i === index ? "active" : ""}`}
                  aria-label={`查看第 ${i + 1} 张`}
                  aria-selected={i === index}
                  onClick={() => setIndex(i)}
                >
                  <img src={item.photo} alt="" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function HotspotEffectOverlay({
  hotspot,
  allHotspots,
  onClose,
  onSelectHotspot,
}: {
  hotspot: Hotspot;
  allHotspots: Hotspot[];
  onClose: () => void;
  onSelectHotspot?: (next: Hotspot) => void;
}) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus({ preventScroll: true });
    };
  }, [hotspot.id, onClose]);

  if (hotspot.effect.kind === "spotlight") {
    const idx = allHotspots.findIndex((h) => h.id === hotspot.id);
    const prev =
      allHotspots.length > 1
        ? allHotspots[(idx - 1 + allHotspots.length) % allHotspots.length]
        : undefined;
    const next =
      allHotspots.length > 1
        ? allHotspots[(idx + 1) % allHotspots.length]
        : undefined;
    const isPopup = hotspot.effect.presentation === "popup";
    return (
      <section
        className={isPopup ? "spotlight-popup" : "spotlight-dock"}
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-label={hotspot.effect.title}
      >
        <div className="hotspot-dialog-head">
          <div>
            <span className="hotspot-dialog-eyebrow">
              <Sparkles size={13} />
              {hotspot.effect.badge || "角落故事"}
            </span>
            <h2>{hotspot.effect.title}</h2>
          </div>
          <button
            type="button"
            className="hotspot-close"
            aria-label="关闭导览"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="spotlight-content">
          {hotspot.effect.photo && (
            <img
              className="spotlight-thumb"
              src={hotspot.effect.photo}
              alt={hotspot.effect.title}
            />
          )}
          <p className="spotlight-story">{hotspot.effect.story}</p>
        </div>
        {onSelectHotspot && allHotspots.length > 1 && (
          <div className="spotlight-actions">
            <button
              type="button"
              className="hotspot-secondary-btn"
              onClick={() => prev && onSelectHotspot(prev)}
            >
              <ArrowLeft size={14} />
              上一个彩蛋
            </button>
            <button
              type="button"
              className="hotspot-secondary-btn"
              onClick={() => next && onSelectHotspot(next)}
            >
              下一个彩蛋
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </section>
    );
  }

  const kindMeta = hotspotEffectDefaults[hotspot.effect.kind];
  return (
    <div
      className="hotspot-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={hotspot.effect.title}
        className={`hotspot-dialog ${
          hotspot.effect.kind === "album" || hotspot.effect.kind === "iframe"
            ? "wide"
            : ""
        }`}
      >
        <div className="hotspot-dialog-head">
          <div>
            <span className="hotspot-dialog-eyebrow">
              {hotspot.effect.kind === "envelope" ? (
                <Mail size={13} />
              ) : hotspot.effect.kind === "album" ? (
                <Images size={13} />
              ) : (
                <Globe size={13} />
              )}
              {kindMeta.label}
            </span>
            <h2>{hotspot.effect.title}</h2>
          </div>
          <button
            type="button"
            className="hotspot-close"
            aria-label="关闭窗口"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {hotspot.effect.kind === "envelope" && (
          <EnvelopeModal
            hotspot={hotspot as Hotspot & { effect: { kind: "envelope" } }}
            onClose={onClose}
          />
        )}

        {hotspot.effect.kind === "album" && (
          <AlbumModal
            hotspot={hotspot as Hotspot & { effect: { kind: "album" } }}
          />
        )}

        {hotspot.effect.kind === "link" &&
          (() => {
            const safe = safeExternalUrl(hotspot.effect.url);
            return (
              <div className="hotspot-link-card">
                <span className="hotspot-domain-pill">
                  <Globe size={13} />
                  {domainOf(hotspot.effect.url)}
                </span>
                {safe && (
                  <a
                    className="hotspot-url-pill"
                    href={safe}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink size={12} />
                    <span>{hotspot.effect.url}</span>
                  </a>
                )}
                {hotspot.effect.description && (
                  <p className="muted">{hotspot.effect.description}</p>
                )}
                {safe ? (
                  <a
                    className="hotspot-primary-btn"
                    href={safe}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {hotspot.effect.buttonLabel || "打开外部网站"}
                    <ExternalLink size={16} />
                  </a>
                ) : (
                  <p className="muted">这个链接格式暂时打不开。</p>
                )}
              </div>
            );
          })()}

        {hotspot.effect.kind === "iframe" &&
          (() => {
            const safe = safeExternalUrl(hotspot.effect.url);
            return (
              <>
                <div className="hotspot-iframe-bar">
                  <span>
                    {hotspot.effect.description ||
                      "部分外部站点限制嵌入；若空白请点右侧原页面。"}
                  </span>
                  {safe && (
                    <a
                      className="hotspot-secondary-btn"
                      href={safe}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      在新窗口打开原页
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
                {safe ? (
                  <iframe
                    className={`hotspot-iframe ${
                      hotspot.effect.aspectRatio === "4:3"
                        ? "ratio-4-3"
                        : hotspot.effect.aspectRatio === "tall"
                          ? "ratio-tall"
                          : ""
                    }`}
                    title={hotspot.effect.title}
                    src={safe}
                    referrerPolicy="no-referrer"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
                  />
                ) : (
                  <p className="muted">链接格式不受支持。</p>
                )}
              </>
            );
          })()}
      </div>
    </div>
  );
}
