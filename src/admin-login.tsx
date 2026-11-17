import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { KeyRound, LoaderCircle, ArrowRight } from "lucide-react";
import { fetchSession, loginAdmin } from "./api.js";
import { BRAND_FULL, SameRoomLogo } from "./brand.js";
import "./fonts.css";
import "./admin-login.css";

function AdminLoginPage() {
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchSession()
      .then((session) => {
        if (session.role === "admin") {
          window.location.replace("/");
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await loginAdmin(key.trim());
      window.location.replace("/");
    } catch (e) {
      setError((e as Error).message || "验证失败，请检查管理员 Auth Key。");
      setBusy(false);
    }
  }

  return (
    <main className="admin-login-shell">
      <section className="admin-login-card" aria-label="管理员登录">
        <div className="admin-login-brand">
          <div className="admin-login-mark">
            <SameRoomLogo size={36} />
          </div>
          <div>
            <span className="admin-login-eyebrow">{BRAND_FULL}</span>
            <h1>管理者入口</h1>
          </div>
        </div>
        <p className="admin-login-desc">
          输入主人口令后，可以动手整理这间屋子的布局、添置新的 3D 物件、打理服务连线与来访彩蛋。
        </p>
        {checking ? (
          <p className="admin-login-status" role="status">
            <LoaderCircle size={16} className="spin" />
            正在检查当前会话…
          </p>
        ) : (
          <form className="admin-login-form" onSubmit={(e) => void submit(e)}>
            <label className="admin-login-field">
              <span>管理员 Auth Key</span>
              <div className="admin-login-input">
                <KeyRound size={16} />
                <input
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  placeholder="粘贴 DASH_ADMIN_KEY 或 admin-token 内容"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={busy}
                />
              </div>
            </label>
            {error && (
              <p className="admin-login-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="admin-login-submit"
              disabled={busy || !key.trim()}
            >
              {busy ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  正在验证…
                </>
              ) : (
                <>
                  进入管理工作台
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
        )}
        <div className="admin-login-footer">
          <a href="/">返回访客展示视角</a>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<AdminLoginPage />);
