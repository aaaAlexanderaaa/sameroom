import "./style.css";
import { Viewer } from "./viewer.js";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header class="topbar"><a class="brand" href="/">共在<span>·SameRoom</span><small>3D 物件检视台</small></a><span class="local-badge"><i></i> 本地预览</span></header>
  <main>
    <section class="workspace" aria-label="模型预览">
      <div class="viewport-heading"><span class="eyebrow">MODEL INSPECTOR</span><h1 id="model-title">陶瓷机器人</h1><p id="model-source">离线示例 · 非 AI 生成</p></div>
      <div id="viewport"></div>
      <div class="viewport-footer"><span id="selection">未选择部件</span><span>拖动旋转 · 滚轮缩放 · 点击选择</span></div>
      <div class="viewport-tools" aria-label="视角操作"><button id="rotate" aria-label="向右旋转">↻</button><button id="zoom-in" aria-label="放大">＋</button><button id="zoom-out" aria-label="缩小">−</button><button id="reset">重置视角</button></div>
    </section>
    <aside class="panel" aria-label="模型与展示设置">
      <section><span class="eyebrow">01 / ASSET</span><h2>选择模型</h2><label for="model-select">工作区资产</label><select id="model-select"><option value="/models/offline-robot.glb">陶瓷机器人 · 离线示例</option></select><p id="library-status" class="hint">正在检查本地资产…</p><label class="file-button" for="file">打开本地 GLB <span>↗</span></label><input id="file" type="file" accept=".glb,model/gltf-binary" /><p class="hint">文件只在浏览器中打开。</p></section>
      <section><span class="eyebrow">02 / DISPLAY</span><h2>观察与光照</h2><div class="toggle"><label for="auto-rotate">自动旋转</label><input id="auto-rotate" type="checkbox" /></div><div class="toggle"><label for="grid">地面网格</label><input id="grid" type="checkbox" checked /></div><div class="toggle"><label for="wireframe">线框视图</label><input id="wireframe" type="checkbox" /></div><label class="range-label" for="light">光照强度 <output id="light-value">3.0</output></label><input id="light" type="range" min="0" max="6" step="0.1" value="3" /></section>
      <section><span class="eyebrow">03 / DETAILS</span><h2>模型信息</h2><dl><div><dt>网格</dt><dd id="meshes">—</dd></div><div><dt>三角面</dt><dd id="triangles">—</dd></div><div><dt>动画</dt><dd id="animations">—</dd></div></dl></section>
      <p id="status" role="status" aria-live="polite" data-state="loading">正在加载模型…</p>
    </aside>
  </main><footer class="page-footer"><span>AHOLO 3D WORKBENCH</span><span>从一个模型开始，构建你的 3D 作品。</span></footer>`;

function element<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
const status = element("status");
function message(text: string, state: string) {
  status.textContent = text;
  status.dataset.state = state;
}
let viewer: Viewer | undefined;
let request = 0;
async function load(
  source: string | ArrayBuffer | Promise<ArrayBuffer>,
  title: string,
  origin: string,
) {
  const current = ++request;
  message("正在加载模型…", "loading");
  try {
    const info = await viewer!.load(source);
    if (!info || current !== request) return;
    element("model-title").textContent = title;
    element("model-source").textContent = origin;
    element("meshes").textContent = info.meshes.toLocaleString("zh-CN");
    element("triangles").textContent = Math.round(
      info.triangles,
    ).toLocaleString("zh-CN");
    element("animations").textContent = String(info.animations);
    element("selection").textContent = "未选择部件";
    message("模型已就绪", "ready");
  } catch {
    if (current === request)
      message(
        "模型加载失败。请选择有效、包含完整资源的 GLB，或重新选择示例。",
        "error",
      );
  }
}
try {
  viewer = new Viewer(
    element("viewport"),
    (name) => {
      element("selection").textContent = name;
    },
    () => {
      message("图形连接已中断，请刷新页面恢复。", "error");
    },
  );
  void load("/models/offline-robot.glb", "陶瓷机器人", "离线示例 · 非 AI 生成");
} catch {
  message("无法启动 WebGL。请启用浏览器硬件加速后刷新页面。", "error");
  document
    .querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
      "input, button, select",
    )
    .forEach((control) => {
      control.disabled = true;
    });
}

element<HTMLSelectElement>("model-select").addEventListener(
  "change",
  (event) => {
    const select = event.target as HTMLSelectElement;
    const offline = select.value === "/models/offline-robot.glb";
    void load(
      select.value,
      offline ? "陶瓷机器人" : select.selectedOptions[0].text,
      offline
        ? "离线示例 · 非 AI 生成"
        : (select.selectedOptions[0].dataset.source ?? "Lux3D · 本地生成资产"),
    );
  },
);
element<HTMLInputElement>("file").addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (
    !file.name.toLowerCase().endsWith(".glb") ||
    file.size > 200 * 1024 * 1024
  ) {
    message("请选择小于 200 MB 的 .glb 文件。", "error");
    return;
  }
  try {
    await load(file.arrayBuffer(), file.name, "本地文件 · 仅在当前浏览器中");
  } catch {
    message("无法读取文件，请重新选择。", "error");
  }
});
element("reset").addEventListener("click", () => viewer?.reset());
element("rotate").addEventListener("click", () => viewer?.rotate());
element("zoom-in").addEventListener("click", () => viewer?.zoom(0.8));
element("zoom-out").addEventListener("click", () => viewer?.zoom(1.25));
element<HTMLInputElement>("auto-rotate").addEventListener("change", (event) => {
  if (viewer)
    viewer.controls.autoRotate = (event.target as HTMLInputElement).checked;
});
element<HTMLInputElement>("grid").addEventListener("change", (event) => {
  if (viewer) viewer.grid.visible = (event.target as HTMLInputElement).checked;
});
element<HTMLInputElement>("wireframe").addEventListener("change", (event) =>
  viewer?.setWireframe((event.target as HTMLInputElement).checked),
);
element<HTMLInputElement>("light").addEventListener("input", (event) => {
  const value = Number((event.target as HTMLInputElement).value);
  viewer?.light(value);
  element("light-value").textContent = value.toFixed(1);
});
// Motion is opt-in, including when prefers-reduced-motion is set.
async function library() {
  try {
    const response = await fetch("/generated/manifest.json", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("No manifest");
    const manifest: {
      schemaVersion: number;
      models: { name: string; url: string; providerId?: string }[];
    } = await response.json();
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.models))
      throw new Error("Invalid manifest");
    for (const model of manifest.models) {
      if (!/^\/generated\/[a-z0-9_-]+\/\d+\.glb$/.test(model.url)) continue;
      const option = new Option(model.name, model.url);
      option.dataset.source =
        model.providerId === "fixture"
          ? "离线流程示例 · 非 AI 生成"
          : "Lux3D · 本地生成资产";
      element<HTMLSelectElement>("model-select").add(option);
    }
    const count = element<HTMLSelectElement>("model-select").options.length - 1;
    element("library-status").textContent = count
      ? `${count} 个已下载的生成模型`
      : "暂无已下载的生成模型，先体验离线示例。";
  } catch {
    element("library-status").textContent =
      "暂无已下载的生成模型，先体验离线示例。";
  }
}
void library();
if (import.meta.hot) import.meta.hot.dispose(() => viewer?.dispose());
