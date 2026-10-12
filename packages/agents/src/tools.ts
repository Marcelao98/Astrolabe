import { z } from "zod";
import {
  CATEGORIES,
  CATEGORY_LABEL_PT,
  MB,
  formatBytes,
  queryNodes,
  sumBytes,
  topFiles,
  topFolders,
  totalsByCategory,
  type NodeQuery,
} from "@astrolabe/core";
import { buildPlan, normalizePath, type StrategyParams } from "@astrolabe/actions";
import type { Classifier } from "./classifier";
import { splitLabels } from "./classifier";
import type { AstraAction, AstraContext } from "./types";

const DAY = 86_400_000;

const QuerySchema = z
  .object({
    kind: z.enum(["file", "folder"]).optional(),
    categories: z.array(z.enum(CATEGORIES)).max(10).optional(),
    min_size_mb: z.number().min(0).max(10_000_000).optional(),
    max_size_mb: z.number().min(0).max(10_000_000).optional(),
    not_accessed_days: z.number().int().min(0).max(36_500).optional(),
    accessed_within_days: z.number().int().min(0).max(36_500).optional(),
    path_contains: z.string().max(200).optional(),
    exts: z.array(z.string().max(12)).max(20).optional(),
    duplicates_only: z.boolean().optional(),
    under_path: z.string().max(500).optional(),
    sort_by: z.enum(["size", "age", "name"]).optional(),
  })
  .describe("Filtro de arquivos/pastas. Todos os campos são opcionais e combinam com E.");

export type QueryInput = z.infer<typeof QuerySchema>;

const Tools = {
  search_files: z.object({ query: QuerySchema, limit: z.number().int().min(1).max(15).default(8) }),
  show_on_map: z.object({ query: QuerySchema, label: z.string().min(1).max(80) }),
  clear_focus: z.object({}),
  set_lens: z.object({ lens: z.enum(["type", "age", "size", "duplicates"]) }),
  set_scale: z.object({ mode: z.enum(["log", "sqrt", "linear"]) }),
  fly_to: z.object({ target: z.string().min(1).max(500) }),
  top_heaviest: z.object({ kind: z.enum(["file", "folder"]), n: z.number().int().min(1).max(20).default(10) }),
  duplicates_report: z.object({}),
  classify: z.object({
    criterion: z.string().min(2).max(200),
    query: QuerySchema.optional(),
    max_items: z.number().int().min(1).max(4000).default(3000),
  }),
  propose_plan: z.object({
    strategy: z.enum(["dedupe", "organize_by_type", "clean_junk", "archive_old", "selection"]),
    folder: z.string().max(500).optional(),
    min_age_days: z.number().int().min(1).max(36_500).optional(),
    min_size_mb: z.number().min(1).max(10_000_000).optional(),
    selection_kind: z.enum(["quarantine", "trash"]).optional(),
  }),
  get_selection: z.object({}),
} as const;

export type ToolName = keyof typeof Tools;

const DESCRIPTIONS: Record<ToolName, string> = {
  search_files: "Busca arquivos/pastas por critérios e devolve contagem, total em bytes e exemplos. Use para responder perguntas com números.",
  show_on_map: "Destaca no mapa os itens que casam com o filtro (o resto esmaece) e leva a câmera até o maior deles.",
  clear_focus: "Remove o destaque do mapa.",
  set_lens: "Muda a cor do mapa: type (tipo), age (idade/último acesso), size (tamanho) ou duplicates (duplicados).",
  set_scale: "Muda como o tamanho vira raio: log, sqrt (raiz) ou linear.",
  fly_to: "Leva a câmera até um arquivo ou pasta, por caminho completo ou nome.",
  top_heaviest: "Lista os maiores arquivos ou pastas.",
  duplicates_report: "Resume os arquivos duplicados (mesmo conteúdo) e quanto espaço desperdiçam, e liga a lente de duplicados.",
  classify: "Aplica um critério em linguagem natural (ex.: 'contratos', 'trabalho e pessoal') aos arquivos e repinta o mapa com as categorias. Vê só metadados.",
  propose_plan:
    "Cria um PLANO revisável (não executa nada). Estratégias: dedupe, organize_by_type (precisa de 'folder'), clean_junk, archive_old, selection (usa a seleção atual). O usuário aprova na interface.",
  get_selection: "Devolve o que o usuário selecionou no mapa.",
};

export interface ToolSpec {
  name: ToolName;
  description: string;
  input_schema: Record<string, unknown>;
}

export const toolSpecs: ToolSpec[] = (Object.keys(Tools) as ToolName[]).map((name) => {
  const schema = z.toJSONSchema(Tools[name]) as Record<string, unknown>;
  delete schema.$schema;
  return { name, description: DESCRIPTIONS[name], input_schema: schema };
});

/** Resultado enxuto de um item (nomes são dados NÃO confiáveis). */
interface Brief {
  id: string;
  path: string;
  size: number;
  category: string;
  last_accessed_days_ago: number;
}

export class ToolRuntime {
  private actions: AstraAction[] = [];
  private pathIndex: Map<string, number> | null = null;

  constructor(
    readonly ctx: AstraContext,
    private classifier: Classifier,
  ) {}

  /** Entrega (e esvazia) as ações que as ferramentas pediram para a interface. */
  drain(): AstraAction[] {
    const a = this.actions;
    this.actions = [];
    return a;
  }

  private emit(a: AstraAction) {
    this.actions.push(a);
  }

  private paths(): Map<string, number> {
    if (!this.pathIndex) {
      this.pathIndex = new Map();
      this.ctx.tree.nodes.forEach((n, i) => this.pathIndex!.set(normalizePath(n.path).toLowerCase(), i));
    }
    return this.pathIndex;
  }

  /** Resolve "C:/Users/x/Videos" ou só "Videos" para um índice. Em empate, o maior. */
  resolve(ref: string): number | undefined {
    const key = normalizePath(ref).toLowerCase();
    const exact = this.paths().get(key);
    if (exact !== undefined) return exact;
    const { tree } = this.ctx;
    let best: number | undefined;
    let bestSize = -1;
    const needle = key.replace(/^.*\//, "");
    for (let i = 0; i < tree.nodes.length; i++) {
      const nd = tree.nodes[i]!;
      const name = nd.name.toLowerCase();
      if (name === needle || (needle.length >= 3 && name.includes(needle))) {
        const size = nd.kind === "folder" ? tree.total[i]! : nd.size;
        const score = name === needle ? size * 1000 : size;
        if (score > bestSize) {
          best = i;
          bestSize = score;
        }
      }
    }
    return best;
  }

  private toQuery(q: QueryInput | undefined): { query: NodeQuery; error?: string } {
    if (!q) return { query: {} };
    const query: NodeQuery = {
      kind: q.kind,
      categories: q.categories,
      minSize: q.min_size_mb !== undefined ? q.min_size_mb * MB : undefined,
      maxSize: q.max_size_mb !== undefined ? q.max_size_mb * MB : undefined,
      notAccessedDays: q.not_accessed_days,
      accessedWithinDays: q.accessed_within_days,
      pathContains: q.path_contains,
      exts: q.exts,
      duplicatesOnly: q.duplicates_only,
      sortBy: q.sort_by,
    };
    if (q.under_path) {
      const i = this.resolve(q.under_path);
      if (i === undefined) return { query, error: `Não achei "${q.under_path}".` };
      query.underNodeId = this.ctx.tree.nodes[i]!.id;
    }
    return { query };
  }

  private brief(i: number): Brief {
    const nd = this.ctx.tree.nodes[i]!;
    return {
      id: nd.id,
      path: nd.path,
      size: nd.kind === "folder" ? this.ctx.tree.total[i]! : nd.size,
      category: nd.kind === "folder" ? "pasta" : nd.category,
      last_accessed_days_ago: Math.max(0, Math.round((this.ctx.now - nd.accessedAt) / DAY)),
    };
  }

  private find(q: QueryInput | undefined): { hits: number[]; query: NodeQuery; error?: string } {
    const { query, error } = this.toQuery(q);
    if (error) return { hits: [], query, error };
    return { hits: queryNodes(this.ctx.tree, query, this.ctx), query };
  }

  private summarize(hits: number[]) {
    const { tree } = this.ctx;
    const files = hits.filter((i) => tree.nodes[i]!.kind === "file");
    return {
      count: hits.length,
      files: files.length,
      total_bytes: sumBytes(tree, files),
      total_human: formatBytes(sumBytes(tree, files)),
    };
  }

  /** Executa uma ferramenta. A entrada vem do modelo, então é SEMPRE validada. */
  async run(name: string, input: unknown): Promise<unknown> {
    if (!(name in Tools)) throw new Error(`Ferramenta desconhecida: ${name}`);
    const tool = name as ToolName;
    const parsed = Tools[tool].safeParse(input ?? {});
    if (!parsed.success) throw new Error(`Entrada inválida para ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    const args = parsed.data as never;
    return this[`tool_${tool}` as const](args);
  }

  private tool_search_files({ query, limit }: z.infer<typeof Tools.search_files>) {
    const { hits, error } = this.find(query);
    if (error) return { error };
    const byCat = new Map<string, number>();
    for (const i of hits) {
      const nd = this.ctx.tree.nodes[i]!;
      if (nd.kind === "file") byCat.set(nd.category, (byCat.get(nd.category) ?? 0) + nd.size);
    }
    const sample = (query.sort_by ? hits : [...hits].sort((a, b) => this.brief(b).size - this.brief(a).size)).slice(0, limit).map((i) => this.brief(i));
    return {
      ...this.summarize(hits),
      by_category_bytes: Object.fromEntries([...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)),
      sample,
    };
  }

  private tool_show_on_map({ query, label }: z.infer<typeof Tools.show_on_map>) {
    const { hits, query: q, error } = this.find(query);
    if (error) return { error };
    if (!hits.length) return { count: 0, note: "Nada encontrado com esse filtro." };
    const { tree } = this.ctx;
    this.emit({ type: "focus", query: q, label, count: hits.length });
    let top = hits[0]!;
    for (const i of hits) if (this.brief(i).size > this.brief(top).size) top = i;
    this.emit({ type: "flyTo", id: tree.nodes[top]!.id });
    return { ...this.summarize(hits), largest: this.brief(top) };
  }

  private tool_clear_focus() {
    this.emit({ type: "clearFocus" });
    return { ok: true };
  }

  private tool_set_lens({ lens }: z.infer<typeof Tools.set_lens>) {
    this.emit({ type: "setLens", lens });
    return { ok: true, lens };
  }

  private tool_set_scale({ mode }: z.infer<typeof Tools.set_scale>) {
    this.emit({ type: "setScale", mode });
    return { ok: true, mode };
  }

  private tool_fly_to({ target }: z.infer<typeof Tools.fly_to>) {
    const i = this.resolve(target);
    if (i === undefined) return { found: false, note: `Não achei "${target}".` };
    this.emit({ type: "flyTo", id: this.ctx.tree.nodes[i]!.id });
    return { found: true, item: this.brief(i) };
  }

  private tool_top_heaviest({ kind, n }: z.infer<typeof Tools.top_heaviest>) {
    const list = kind === "file" ? topFiles(this.ctx.tree, n) : topFolders(this.ctx.tree, n);
    return { items: list.map((i) => this.brief(i)) };
  }

  private tool_duplicates_report() {
    const { dup, tree } = this.ctx;
    this.emit({ type: "setLens", lens: "duplicates" });
    const top = dup.groups.slice(0, 5).map((g) => ({
      copies: g.length,
      size: tree.nodes[g[0]!]!.size,
      wasted: tree.nodes[g[0]!]!.size * (g.length - 1),
      example_paths: g.slice(0, 3).map((i) => tree.nodes[i]!.path),
    }));
    return { groups: dup.groups.length, wasted_bytes: dup.wastedBytes, wasted_human: formatBytes(dup.wastedBytes), biggest_groups: top };
  }

  private async tool_classify({ criterion, query, max_items }: z.infer<typeof Tools.classify>) {
    const { hits, error } = this.find({ ...(query ?? {}), kind: "file", sort_by: query?.sort_by ?? "size" });
    if (error) return { error };
    const { tree } = this.ctx;
    const items = hits.slice(0, max_items).map((i) => ({ i, path: tree.nodes[i]!.path, ext: tree.nodes[i]!.ext, size: tree.nodes[i]!.size }));
    const results = (await this.classifier.classify(criterion, items)).filter((r) => r.confidence >= 0.5);
    const labels = splitLabels(criterion);
    const legend = [...new Set(results.map((r) => r.label))];
    const id = `lens_${Date.now().toString(36)}`;
    this.emit({
      type: "customLens",
      id,
      label: criterion.slice(0, 40),
      description: `Critério: ${criterion}`,
      legend: legend.length ? legend : labels,
      labels: results.map((r) => ({ id: tree.nodes[r.i]!.id, label: r.label, confidence: r.confidence })),
    });
    const bytes = results.reduce((s, r) => s + tree.nodes[r.i]!.size, 0);
    return {
      examined: items.length,
      matched: results.length,
      matched_bytes: bytes,
      matched_human: formatBytes(bytes),
      by_label: Object.fromEntries(legend.map((l) => [l, results.filter((r) => r.label === l).length])),
      examples: results.slice(0, 6).map((r) => ({ ...this.brief(r.i), label: r.label, confidence: r.confidence })),
    };
  }

  private tool_propose_plan(p: z.infer<typeof Tools.propose_plan>) {
    const { tree } = this.ctx;
    const params: StrategyParams = { minAgeDays: p.min_age_days, minSize: p.min_size_mb !== undefined ? p.min_size_mb * MB : undefined };
    if (p.strategy === "organize_by_type") {
      const ref = p.folder ?? this.ctx.selection.map((id) => tree.nodes[tree.index.get(id) ?? -1]).find((n) => n?.kind === "folder")?.path;
      const i = ref ? this.resolve(ref) : undefined;
      if (i === undefined || tree.nodes[i]!.kind !== "folder") return { error: "Diga qual pasta organizar (ou selecione uma no mapa)." };
      params.folderId = tree.nodes[i]!.id;
    }
    if (p.strategy === "selection") {
      if (!this.ctx.selection.length) return { error: "Não há nada selecionado no mapa." };
      params.ids = this.ctx.selection;
      params.kind = p.selection_kind ?? "quarantine";
    }
    const plan = buildPlan(p.strategy, params, this.ctx);
    if (plan.actions.length) this.emit({ type: "plan", plan });
    return {
      plan_id: plan.id,
      title: plan.title,
      actions: plan.actions.length,
      total_bytes: plan.totalBytes,
      total_human: formatBytes(plan.totalBytes),
      warnings: plan.warnings,
      examples: plan.actions.slice(0, 5).map((a) => ({ kind: a.kind, from: a.from, to: a.to, reason: a.reason })),
      note: "O plano só aparece para o usuário aprovar. Você NÃO pode executá-lo.",
    };
  }

  private tool_get_selection() {
    const { tree } = this.ctx;
    const items = this.ctx.selection.map((id) => tree.index.get(id)).filter((i): i is number => i !== undefined);
    return { count: items.length, items: items.slice(0, 15).map((i) => this.brief(i)) };
  }

  /** Visão geral usada no prompt e nas respostas locais. */
  overview() {
    const { tree } = this.ctx;
    const root = tree.roots[0] ?? 0;
    return {
      source: this.ctx.sourceLabel,
      total_bytes: tree.total[root] ?? 0,
      total_human: formatBytes(tree.total[root] ?? 0),
      files: tree.count[root] ?? 0,
      duplicates_wasted_human: formatBytes(this.ctx.dup.wastedBytes),
      by_category: totalsByCategory(tree)
        .slice(0, 6)
        .map((c) => ({ category: CATEGORY_LABEL_PT[c.category as keyof typeof CATEGORY_LABEL_PT] ?? c.category, human: formatBytes(c.bytes) })),
    };
  }
}
