import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { fetchSession } from "./api.js";
import { BRAND_FULL, SameRoomLogo } from "./brand.js";
import { GuestApp } from "./guest-app.js";

const AdminDashboard = lazy(() =>
  import("./dashboard.js").then((m) => ({ default: m.AdminApp })),
);

function RootEntry() {
  const [role, setRole] = useState<"loading" | "guest" | "admin">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    void fetchSession()
      .then((info) => setRole(info.role))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (role === "loading") {
    return (
      <div
        style={{
          height: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#eeeae3",
          color: "#263f37",
          fontFamily:
            '"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
        }}
      >
        <div style={{ display: "grid", placeItems: "center", gap: 10 }}>
          <SameRoomLogo size={44} />
          <strong>{BRAND_FULL}</strong>
          <span style={{ fontSize: 13, color: "#6b7971" }}>
            {error || "正在推门进屋…"}
          </span>
        </div>
      </div>
    );
  }

  if (role === "admin") {
    return (
      <Suspense
        fallback={
          <div
            style={{
              height: "100dvh",
              display: "grid",
              placeItems: "center",
              background: "#eeeae3",
              color: "#263f37",
            }}
          >
            正在加载管理工作台…
          </div>
        }
      >
        <AdminDashboard />
      </Suspense>
    );
  }

  return <GuestApp />;
}

createRoot(document.getElementById("app")!).render(<RootEntry />);
