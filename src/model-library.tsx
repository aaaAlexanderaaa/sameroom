import { useState } from "react";
import { ArrowUpRight, Box, Search, Upload } from "lucide-react";
import {
  modelSourceSchema,
  type ImportedModel,
  type ModelSource,
} from "../shared/model-source.js";

export function ModelAttribution({ source }: { source?: ModelSource }) {
  return (
    <div className="model-attribution">
      <dl>
        <div>
          <dt>来源</dt>
          <dd>{source?.platform || "未填写"}</dd>
        </div>
        <div>
          <dt>作者</dt>
          <dd>{source?.author || "未填写"}</dd>
        </div>
        <div>
          <dt>许可</dt>
          <dd>{source?.license || "未填写"}</dd>
        </div>
      </dl>
      {source?.url && (
        <a href={source.url} target="_blank" rel="noopener noreferrer">
          查看模型原始页面 <ArrowUpRight size={14} />
        </a>
      )}
    </div>
  );
}

export function ModelLibrary({
  market,
  imports,
  busy,
  initialQuery,
  onImport,
  onSelect,
}: {
  market: boolean;
  imports: ImportedModel[];
  busy: boolean;
  initialQuery: string;
  onImport: (file: File, source?: ModelSource) => Promise<void>;
  onSelect: (model: ImportedModel) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [fields, setFields] = useState({
    platform: "",
    url: "",
    author: "",
    license: "",
  });
  const [error, setError] = useState("");
  const search = query.trim();
  const sketchfab = new URL("https://sketchfab.com/search");
  sketchfab.search = new URLSearchParams({
    type: "models",
    features: "downloadable",
    ...(search ? { q: search } : {}),
  }).toString();
  const polyhaven = new URL("https://polyhaven.com/models");
  if (search) polyhaven.searchParams.set("s", search);

  async function upload(file?: File) {
    if (!file || busy) return;
    setError("");
    if (!/\.glb$/i.test(file.name) || file.size > 64 * 1024 * 1024) {
      setError(
        "请选择自包含的 .glb 文件，最大 64 MiB。其他格式请先转换为 GLB。",
      );
      return;
    }
    const values = Object.fromEntries(
      Object.entries(fields)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value),
    );
    const parsed = modelSourceSchema.safeParse(values);
    if (!parsed.success) {
      setError(
        "请检查模型出处：链接需为不含账号密码的完整 http:// 或 https:// 页面地址。",
      );
      return;
    }
    try {
      await onImport(
        file,
        Object.keys(parsed.data).length ? parsed.data : undefined,
      );
    } catch (e) {
      setError(`导入未完成：${(e as Error).message}。可以重新选择文件。`);
    }
  }

  return (
    <div className="capture-grid model-library">
      <section>
        {market ? (
          <>
            <div className="section-label">寻找熟悉的那一件</div>
            <h3>标准物品，可以从现成模型开始</h3>
            <p className="muted">
              输入品牌、型号或物品名称，在新标签页中搜索。选好模型后回到这里上传。
            </p>
            <label className="field">
              搜索模型关键词
              <input
                type="search"
                maxLength={160}
                placeholder="例如 Mac mini M1、desk、chair"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="model-search-examples" aria-label="搜索示例">
              {["Mac mini", "mini PC", "desk", "chair"].map((value) => (
                <button key={value} onClick={() => setQuery(value)}>
                  {value}
                </button>
              ))}
            </div>
            <a
              className="model-market-card"
              href={sketchfab.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Search size={20} />
              <span>
                <strong>去 Sketchfab 搜索</strong>
                <small>具体型号、电子设备 · 已筛选可下载模型</small>
                <small>下载通常需要登录；许可按模型查看</small>
              </span>
              <ArrowUpRight size={17} />
            </a>
            <a
              className="model-market-card"
              href={polyhaven.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Box size={20} />
              <span>
                <strong>去 Poly Haven 搜索</strong>
                <small>家具、灯具、生活道具 · CC0 资产</small>
                <small>部分提供 glTF 和贴图，需先打包为 GLB</small>
              </span>
              <ArrowUpRight size={17} />
            </a>
            <details className="model-ecosystem">
              <summary>群核旗下的模型资源</summary>
              <p>
                <a
                  href="https://www.modelo.io/3d-models"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Modelo 模型社区 ↗
                </a>
                ：有可下载资源，偏建筑与室内；使用他人上传内容受个人、非商业用途等条款限制。
              </p>
              <p>
                <a
                  href="https://www.kujiale.com/modelpackage/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  酷家乐 ↗
                </a>{" "}
                ·{" "}
                <a
                  href="https://www.coohom.com/model-library"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Coohom ↗
                </a>
                ：适合查找家居模型，能否导出到本项目需看具体资源权限。
              </p>
            </details>
          </>
        ) : (
          <div className="capture-placeholder">
            <Upload size={38} />
            <h3>把已有模型带进来</h3>
            <p>
              选择当前设备里的 GLB，上传后旋转、靠近检查，再确认大小和位置。
            </p>
          </div>
        )}
        <div className="model-quality-note">
          <strong>先认得出，再放进来</strong>
          <p>
            核对具体型号、接口、底部和材质。下载前查看许可，优先选自包含
            GLB；面数多不一定更像实物。
          </p>
        </div>
      </section>
      <section>
        <h3>{market ? "下载好了？带回小世界" : "选择模型文件"}</h3>
        <p className="muted">
          从你正在使用的手机或电脑选择文件，保存到共在（SameRoom）。支持自包含
          GLB，最大 64 MiB。
        </p>
        <fieldset disabled={busy} className="capture-fields">
          <details className="model-source-fields" open={market || undefined}>
            <summary>保留模型出处（选填）</summary>
            <p className="muted">
              填写模型页面上的作者和许可，随模型保留。不确定的信息可以留空。
            </p>
            <label className="field">
              来源平台
              <input
                maxLength={80}
                value={fields.platform}
                placeholder="例如 Sketchfab、自己制作"
                onChange={(e) =>
                  setFields({ ...fields, platform: e.target.value })
                }
              />
            </label>
            <label className="field">
              模型原始链接
              <input
                type="url"
                maxLength={2048}
                value={fields.url}
                placeholder="https://…（模型介绍页）"
                onChange={(e) => setFields({ ...fields, url: e.target.value })}
              />
            </label>
            <label className="field">
              模型作者
              <input
                maxLength={160}
                value={fields.author}
                placeholder="作者或工作室名称"
                onChange={(e) =>
                  setFields({ ...fields, author: e.target.value })
                }
              />
            </label>
            <label className="field">
              模型许可
              <input
                maxLength={300}
                value={fields.license}
                placeholder="例如 CC BY 4.0，以原页面为准"
                onChange={(e) =>
                  setFields({ ...fields, license: e.target.value })
                }
              />
            </label>
          </details>
          <div className="model-import">
            <label htmlFor="model-file">选择下载的 GLB</label>
            <input
              id="model-file"
              aria-label="导入 GLB 模型"
              type="file"
              accept=".glb,model/gltf-binary"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                void upload(file);
              }}
            />
          </div>
        </fieldset>
        {busy && (
          <p role="status" className="muted">
            正在验证并保存模型…
          </p>
        )}
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        <div className="section-label spaced">已导入的模型</div>
        {imports.length === 0 && (
          <p className="muted">
            还没有导入模型。上传后会留在这里，下次可以继续使用。
          </p>
        )}
        <div className="job-list">
          {imports.map((model) => (
            <button
              key={model.id}
              className="job"
              disabled={busy}
              onClick={() => onSelect(model)}
            >
              <Box size={15} />
              <span>
                {model.name}
                <small>
                  {model.source?.platform || "本地导入"} ·{" "}
                  {model.source?.author || "作者未填写"}
                </small>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
