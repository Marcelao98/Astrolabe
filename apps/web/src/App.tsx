import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import {
  generateSample,
  SAMPLE_NOW,
  customLens,
  subtreeOf,
  type FsNode,
  type Lens,
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
import { createScene, homeIndex, selectionBytes } from "./data";
import { AstraClient } from "./astra/client";
import { AgentConnection, type Runner } from "./astra/agent";
import { ConnectDialog } from "./components/ConnectDialog";
import { PlanCard, type PlanPhase } from "./components/PlanCard";
import { applyResults, createDemoExecutor } from "./astra/fsdemo";
import { buildPlan, type ExecutionLog, type Plan } from "@astrolabe/actions";
import type { AstraAction, AstraContext } from "@astrolabe/agents";

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const DAY = 86_400_000;
const fmtDate = (t: number) => new Date(t).toLocaleDateString("pt-BR", { year: "numeric", month: "short", day: "numeric" });

const SCALES: { id: ScaleMode; label: string; hint: string }[] = [
  { id: "log", label: "Log", hint: "Cada 10× de peso vira um degrau de tamanho: enxerga toda a estrutura" },
  { id: "sqrt", label: "Raiz", hint: "A área do círculo é proporcional ao tamanho: o gargalo aparece" },
  { id: "linear", label: "Linear", hint: "Raio proporcional ao tamanho: os gigantes dominam" },
];

export function App() {
  const nodesRef = useRef<FsNode[] | null>(null);
  nodesRef.current ??= generateSample();
  const [scene, setScene] = useState(() => createScene(nodesRef.current!));
  const executor = useRef<ReturnType<typeof createDemoExecutor> | null>(null);
  executor.current ??= createDemoExecutor(nodesRef.current);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [phase, setPhase] = useState<PlanPhase>("review");
  const [runLog, setRunLog] = useState<ExecutionLog | null>(null);
  const baseNodes = useRef<FsNode[]>([]);
  const [customLensState, setCustomLens] = useState<Lens | null>(null);
  const astra = useMemo(() => new AstraClient(), []);
  const [source, setSource] = useState<{ label: string; conn: AgentConnection | null }>({ label: "Amostra · C: (dados de exemplo)", conn: null });
  const [connectOpen, setConnectOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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

  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast((c) => (c === t ? null : c)), 3500);
  };

  const getContext = (): AstraContext => ({
    tree: scene.tree,
    now: scene.now,
    dup: scene.dup,
    selection: [...scene.selection].map((i) => scene.tree.nodes[i]!.id),
    sourceLabel: source.label,
  });

  const runner = (): Runner =>
    source.conn
      ? { demo: false, execute: (p, ap) => source.conn!.execute(p, ap), undo: (p, l) => source.conn!.undo(p, l) }
      : { demo: true, execute: (p, ap) => executor.current!.execute(p, ap), undo: (p, l) => executor.current!.undo(p, l) };

  const loadSource = (conn: AgentConnection | null, label: string, nodes: FsNode[], now: number) => {
    setPlan(null);
    setSource({ label, conn });
    if (!conn) executor.current = createDemoExecutor(nodes);
    rebuild(nodes, now, true);
    void astra.setSource(conn ? nodes : null, label, now);
  };

  const rebuild = (nodes: FsNode[], now: number = scene.now, fresh = false) => {
    nodesRef.current = nodes;
    const next = createScene(nodes, now);
    next.setScale(fresh ? "log" : scene.scale);
    if (fresh) setScaleMode("log");
    const lens = builtinLenses.find((l) => l.id === lensId) ?? builtinLenses[0]!;
    next.setLens(lens);
    if (!builtinLenses.some((l) => l.id === lensId)) {
      setLensId("type");
      setCustomLens(null);
    }
    setScene(next);
    setTimeout(() => (fresh ? galaxy.current?.flyHome() : galaxy.current?.redraw()), 0);
  };

  const showPlan = (p: Plan) => {
    setPlan(p);
    setPhase("review");
    setRunLog(null);
  };

  const previewPlan = (ids: string[]) => {
    if (!plan) return;
    const want = new Set(ids);
    const hit = new Set<number>();
    for (const a of plan.actions) {
      const i = tree.index.get(a.nodeId);
      if (i === undefined || !want.has(a.id)) continue;
      for (const j of subtreeOf(tree, i)) hit.add(j);
    }
    scene.setFocus([...hit]);
    const first = plan.actions.find((a) => want.has(a.id));
    const fi = first && tree.index.get(first.nodeId);
    if (fi !== undefined) galaxy.current?.flyTo(fi);
    redraw();
  };

  const approvePlan = async (ids: string[]) => {
    if (!plan) return;
    setPhase("running");
    // A aprovação nasce aqui, num clique do usuário; a Astra não tem como criá-la.
    let log: ExecutionLog;
    try {
      log = await runner().execute(plan, { planId: plan.id, approvedAt: Date.now(), onlyActionIds: ids });
    } catch (e) {
      setPhase("review");
      say(e instanceof Error ? e.message : "Não consegui executar");
      return;
    }
    baseNodes.current = nodesRef.current!;
    setRunLog(log);
    setPhase("done");
    rebuild(applyResults(nodesRef.current!, plan, log));
    say(`${log.results.filter((r) => r.status === "done").length} ações concluídas`);
  };

  const undoPlan = async () => {
    if (!plan || !runLog) return;
    let undone: ExecutionLog;
    try {
      undone = await runner().undo(plan, runLog);
    } catch (e) {
      say(e instanceof Error ? e.message : "Não consegui desfazer");
      return;
    }
    setRunLog(undone);
    rebuild(applyResults(baseNodes.current, plan, undone));
    say("Desfeito: tudo voltou ao lugar");
  };

  const closePlan = () => {
    setPlan(null);
    scene.setFocus(null);
    setCategory(null);
    redraw();
  };

  const quickPlan = (kind: "quarantine" | "trash") => {
    const ids = [...scene.selection].map((i) => tree.nodes[i]!.id);
    const p = buildPlan("selection", { ids, kind }, { tree, now: scene.now, dup: scene.dup });
    showPlan(p);
  };

  const onAstra = (a: AstraAction) => {
    switch (a.type) {
      case "setLens":
        chooseLens(a.lens);
        break;
      case "setScale":
        chooseScale(a.mode);
        break;
      case "focus": {
        const found = queryNodes(tree, a.query, { now: scene.now, dup: scene.dup });
        scene.setFocus(found.flatMap((i) => (tree.nodes[i]!.kind === "folder" ? subtreeOf(tree, i) : [i])));
        setCategory(null);
        redraw();
        break;
      }
      case "clearFocus":
        scene.setFocus(null);
        redraw();
        break;
      case "flyTo": {
        const i = tree.index.get(a.id);
        if (i !== undefined) galaxy.current?.flyTo(i, { select: true });
        break;
      }
      case "select": {
        scene.selection = new Set(a.ids.map((id) => tree.index.get(id)).filter((i): i is number => i !== undefined));
        redraw();
        break;
      }
      case "customLens": {
        const lens = customLens(a.id, a.label, a.description, a.legend);
        const labels = new Map<number, { label: string; confidence: number }>();
        for (const l of a.labels) {
          const i = tree.index.get(l.id);
          if (i !== undefined) labels.set(i, { label: l.label, confidence: l.confidence });
        }
        scene.setFocus(null);
        scene.setLens(lens, labels);
        setCustomLens(lens);
        setLensId(lens.id);
        redraw();
        break;
      }
      case "plan":
        showPlan(a.plan);
        break;
    }
  };

  const chooseLens = (id: string) => {
    const lens = builtinLenses.find((l) => l.id === id);
    if (!lens) return;
    setLensId(id);
    setCustomLens(null);
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
            <small>{source.label}</small>
          </div>
        </div>

        <div className="group" role="group" aria-label="Lente">
          {[...builtinLenses, ...(customLensState ? [customLensState] : [])].map((l) => (
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
          <button className="chip" onClick={() => setConnectOpen(true)} title="Ver o seu disco de verdade, com o agente local">Conectar PC</button>
          {source.conn && <button className="chip" onClick={() => loadSource(null, "Amostra · C: (dados de exemplo)", generateSample(), SAMPLE_NOW)} title="Voltar aos dados de exemplo">Amostra</button>}
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
            <button onClick={() => quickPlan("quarantine")} title="Reversível: vai para a quarentena e dá para desfazer">Quarentena…</button>
            <button className="danger" onClick={() => quickPlan("trash")} title="Envia à lixeira do sistema">Lixeira…</button>
          </div>
        </div>
      )}

      {plan && <PlanCard plan={plan} demo={!source.conn} phase={phase} log={runLog} onPreview={previewPlan} onApprove={(ids) => void approvePlan(ids)} onUndo={() => void undoPlan()} onClose={closePlan} />}
      {connectOpen && (
        <ConnectDialog
          onClose={() => setConnectOpen(false)}
          onLoaded={(conn, root, nodes, note) => {
            setConnectOpen(false);
            loadSource(conn, root, nodes, Date.now());
            say(note);
          }}
        />
      )}
      {toast && <div className="toast glass">{toast}</div>}

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

      <AstraDock client={astra} getContext={getContext} onAction={onAstra} />
    </div>
  );
}
