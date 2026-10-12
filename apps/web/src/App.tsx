import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL_PT,
  MB,
  GB,
  builtinLenses,
  formatBytes,
  queryNodes,
  referenceCircles,
  topFiles,
  topFolders,
  totalsByCategory,
  type Category,
  type ScaleMode,
} from "@astrolabe/core";
import type { Camera } from "@astrolabe/render";
import { GalaxyCanvas, type GalaxyHandle, type HoverInfo } from "./components/GalaxyCanvas";
import { AstraDock } from "./components/AstraDock";
import { createSampleScene, homeIndex, selectionBytes } from "./data";

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const DAY = 86_400_000;
const fmtDate = (t: number) => new Date(t).toLocaleDateString("pt-BR", { year: "numeric", month: "short", day: "numeric" });

const SCALES: { id: ScaleMode; label: string; hint: string }[] = [
  { id: "log", label: "Log", hint: "Cada 10× de peso vira um degrau de tamanho: enxerga toda a estrutura" },
  { id: "sqrt", label: "Raiz", hint: "A área do círculo é proporcional ao tamanho: o gargalo aparece" },
  { id: "linear", label: "Linear", hint: "Raio proporcional ao tamanho: os gigantes dominam" },
];

export function App() {
  const [scene] = useState(createSampleScene);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const galaxy = useRef<GalaxyHandle>(null);
  const [lensId, setLensId] = useState("type");
  const [scaleMode, setScaleMode] = useState<ScaleMode>("log");
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [zoom, setZoom] = useState(0);
  const [category, setCategory] = useState<Category | null>(null);
  const [query, setQuery] = useState("");
  const [topTab, setTopTab] = useState<"files" | "folders">("files");
  const lastZoom = useRef(0);

  const { tree } = scene;
  const rootIdx = tree.roots[0] ?? 0;

  const cats = useMemo(() => totalsByCategory(tree), [tree]);
  const heavyFiles = useMemo(() => topFiles(tree, 10), [tree]);
  const heavyFolders = useMemo(() => topFolders(tree, 10), [tree]);
  const totalBytes = tree.total[rootIdx] ?? 0;
  const maxCat = cats[0]?.bytes ?? 1;
  const folderCount = useMemo(() => tree.nodes.filter((n) => n.kind === "folder").length, [tree]);

  const homeCamera = useCallback(
    (w: number, h: number): Camera => {
      const i = homeIndex(scene);
      return { cx: scene.layout.x[i]!, cy: scene.layout.y[i]!, zoom: Math.min(w, h) / 2 / scene.focusRadius(i) };
    },
    [scene],
  );

  const redraw = () => {
    galaxy.current?.redraw();
    bump();
  };

  const chooseLens = (id: string) => {
    const lens = builtinLenses.find((l) => l.id === id);
    if (!lens) return;
    setLensId(id);
    setCategory(null);
    scene.setFocus(null);
    scene.setLens(lens);
    redraw();
  };

  const chooseScale = (mode: ScaleMode) => {
    setScaleMode(mode);
    scene.setScale(mode);
    galaxy.current?.flyHome();
    redraw();
  };

  const focusCategory = (c: Category) => {
    if (category === c) {
      setCategory(null);
      scene.setFocus(null);
    } else {
      setCategory(c);
      scene.setFocus(queryNodes(tree, { kind: "file", categories: [c] }, { now: scene.now, dup: scene.dup }));
    }
    redraw();
  };

  const runSearch = () => {
    const q = query.trim();
    if (!q) {
      scene.setFocus(null);
      setCategory(null);
      redraw();
      return;
    }
    const found = queryNodes(tree, { pathContains: q, sortBy: "size", limit: 3000 }, { now: scene.now, dup: scene.dup });
    scene.setFocus(found.filter((i) => tree.nodes[i]!.kind === "file"));
    setCategory(null);
    if (found[0] !== undefined) galaxy.current?.flyTo(found[0]);
    redraw();
  };

  const onZoom = useCallback((z: number) => {
    if (Math.abs(z - lastZoom.current) / (lastZoom.current || 1) > 0.02) {
      lastZoom.current = z;
      setZoom(z);
    }
  }, []);

  const sel = [...scene.selection];
  const selBytes = sel.length ? selectionBytes(scene) : 0;
  const lensLegend = scene.lens.legend(scene.lensContext);
  const refs = referenceCircles(scene.layout.folderSpec, [10 * MB, 1 * GB, 100 * GB]);
  const hoverNode = hover ? tree.nodes[hover.index] : null;
  const hoverDup = hover && scene.dup.groupOf[hover.index]! >= 0 ? scene.dup.groups[scene.dup.groupOf[hover.index]!]!.length : 0;

  return (
    <div className="app">
      <GalaxyCanvas
        ref={galaxy}
        scene={scene}
        links={lensId === "duplicates"}
        homeCamera={homeCamera}
        onHover={setHover}
        onSelect={bump}
        onLayout={redraw}
        onZoom={onZoom}
      />

      {/* barra superior */}
      <header className="topbar glass">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <b>Astrolabe</b>
            <small>Amostra · C: (dados de exemplo)</small>
          </div>
        </div>

        <div className="group" role="group" aria-label="Lente">
          {builtinLenses.map((l) => (
            <button key={l.id} className={`chip ${lensId === l.id ? "on" : ""}`} onClick={() => chooseLens(l.id)} title={l.description}>
              {l.label}
            </button>
          ))}
        </div>

        <div className="group" role="group" aria-label="Escala do tamanho">
          {SCALES.map((s) => (
            <button key={s.id} className={`chip ${scaleMode === s.id ? "on" : ""}`} onClick={() => chooseScale(s.id)} title={s.hint}>
              {s.label}
            </button>
          ))}
        </div>

        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar no mapa… (ex.: contrato, .mp4)" aria-label="Buscar" />
        </form>

        <div className="group">
          <button className="chip" onClick={() => galaxy.current?.flyHome()} title="Voltar ao início">⌂ Início</button>
          <button className="chip" onClick={() => galaxy.current?.fitAll()} title="Ver a galáxia inteira">Tudo</button>
          <button
            className="chip"
            onClick={() => {
              scene.collapseAll(2);
              galaxy.current?.flyHome();
              redraw();
            }}
            title="Fechar as pastas e ver só o topo"
          >
            Colapsar
          </button>
          <button
            className="chip"
            onClick={() => {
              scene.collapseAll(99);
              galaxy.current?.flyHome();
              redraw();
            }}
            title="Abrir todas as pastas"
          >
            Expandir
          </button>
        </div>
      </header>

      {/* painel esquerdo: resumo e categorias */}
      <aside className="panel left glass">
        <h3>Resumo</h3>
        <div className="stats">
          <div><b>{formatBytes(totalBytes)}</b><span>no total</span></div>
          <div><b>{tree.count[rootIdx]!.toLocaleString("pt-BR")}</b><span>arquivos</span></div>
          <div><b>{folderCount.toLocaleString("pt-BR")}</b><span>pastas</span></div>
          <div className="warn"><b>{formatBytes(scene.dup.wastedBytes)}</b><span>em duplicados</span></div>
        </div>

        <h3>Por tipo <small>clique para destacar</small></h3>
        <ul className="bars">
          {cats.map((c) => (
            <li key={c.category}>
              <button className={category === c.category ? "on" : ""} onClick={() => focusCategory(c.category as Category)}>
                <span className="dot" style={{ background: hex(CATEGORY_COLOR[c.category as Category]) }} />
                <span className="name">{CATEGORY_LABEL_PT[c.category as Category]}</span>
                <span className="val">{formatBytes(c.bytes)}</span>
                <span className="bar"><i style={{ width: `${Math.max(2, (c.bytes / maxCat) * 100)}%`, background: hex(CATEGORY_COLOR[c.category as Category]) }} /></span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* painel direito: mais pesados */}
      <aside className="panel right glass">
        <h3>
          Gargalos
          <span className="tabs">
            <button className={topTab === "files" ? "on" : ""} onClick={() => setTopTab("files")}>Arquivos</button>
            <button className={topTab === "folders" ? "on" : ""} onClick={() => setTopTab("folders")}>Pastas</button>
          </span>
        </h3>
        <ol className="top">
          {(topTab === "files" ? heavyFiles : heavyFolders).map((i) => {
            const nd = tree.nodes[i]!;
            const size = nd.kind === "folder" ? tree.total[i]! : nd.size;
            return (
              <li key={i}>
                <button onClick={() => galaxy.current?.flyTo(i, { select: true })} title={nd.path}>
                  <span className="name">{nd.name}</span>
                  <span className="path">{nd.path.split("/").slice(-3, -1).join("/")}</span>
                  <span className="val">{formatBytes(size)}</span>
                  <span className="share" style={{ width: `${Math.max(1.5, (size / totalBytes) * 100 * 3)}%` }} />
                </button>
              </li>
            );
          })}
        </ol>
      </aside>

      {/* legenda */}
      <div className="legend glass">
        <div className="legend-row">
          {lensLegend.map((e, k) => (
            <span key={k} className="lg">
              <i style={{ background: hex(e.color) }} />
              {e.label}
            </span>
          ))}
        </div>
        <div className="legend-row scale">
          <span className="muted">Pasta</span>
          {refs.map((c) => (
            <span key={c.size} className="ref">
              <svg width={c.radius * 2 + 2} height={c.radius * 2 + 2}>
                <circle cx={c.radius + 1} cy={c.radius + 1} r={c.radius} fill="rgba(255,233,184,.18)" stroke="#ffe9b8" strokeWidth="1.2" />
              </svg>
              {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* seleção */}
      {sel.length > 0 && (
        <div className="selection glass">
          <div className="sel-head">
            <b>{sel.length === 1 ? tree.nodes[sel[0]!]!.name : `${sel.length} itens selecionados`}</b>
            <span>{formatBytes(selBytes)}</span>
            <button className="x" onClick={() => { scene.selection.clear(); redraw(); }} aria-label="Limpar seleção">✕</button>
          </div>
          {sel.length === 1 && <div className="sel-path">{tree.nodes[sel[0]!]!.path}</div>}
          <div className="sel-actions">
            <button onClick={() => galaxy.current?.flyTo(sel[0]!)}>Ir até lá</button>
            {sel.length === 1 && tree.nodes[sel[0]!]!.kind === "folder" && (
              <button onClick={() => { scene.toggle(sel[0]!); redraw(); }}>{scene.isOpen(sel[0]!) ? "Colapsar" : "Expandir"}</button>
            )}
          </div>
        </div>
      )}

      {/* tooltip */}
      {hover && hoverNode && (
        <div className="tip glass" style={{ left: Math.min(hover.x + 16, (galaxy.current?.size().w ?? 900) - 300), top: Math.min(hover.y + 16, (galaxy.current?.size().h ?? 600) - 150) }}>
          <b>{hoverNode.name}</b>
          <div className="tip-path">{hoverNode.path}</div>
          <div className="tip-row">
            <span>{formatBytes(hoverNode.kind === "folder" ? tree.total[hover.index]! : hoverNode.size)}</span>
            {hoverNode.kind === "folder" ? (
              <span>{tree.count[hover.index]!.toLocaleString("pt-BR")} arquivos</span>
            ) : (
              <span>{CATEGORY_LABEL_PT[hoverNode.category]}</span>
            )}
          </div>
          <div className="tip-row dim">
            <span>acessado {fmtDate(hoverNode.accessedAt)}</span>
            <span>há {Math.round((scene.now - hoverNode.accessedAt) / DAY)} d</span>
          </div>
          {hoverDup > 0 && <div className="tip-dup">⚠ {hoverDup} cópias idênticas</div>}
        </div>
      )}

      <div className="hud">
        Arraste para mover · roda do mouse para zoom · clique seleciona · duplo clique abre/fecha pasta
        <span>{zoom ? `${zoom >= 1 ? zoom.toFixed(1) : zoom.toFixed(3)}×` : ""}</span>
      </div>

      <AstraDock />
    </div>
  );
}
