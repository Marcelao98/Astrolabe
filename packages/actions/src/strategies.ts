import { CATEGORY_LABEL_PT, MB, formatBytes, queryNodes, type DuplicateInfo, type Tree } from "@astrolabe/core";
import { isProtectedPath, normalizePath } from "./safety";
import { newId, type ActionKind, type Plan, type PlannedAction } from "./plan";

export type StrategyId = "dedupe" | "organize_by_type" | "clean_junk" | "archive_old" | "selection";

export interface StrategyParams {
  /** Pasta alvo (id do nó) para "organize_by_type". */
  folderId?: string;
  minAgeDays?: number;
  minSize?: number;
  /** Para "selection". */
  ids?: string[];
  kind?: ActionKind;
  /** Destino para "move" em "selection". */
  destination?: string;
}

export interface PlanContext {
  tree: Tree;
  now: number;
  dup: DuplicateInfo;
}

const MAX_ACTIONS = 5000;

const BACKUP_HINT = /(backup|copia|cópia|celular|pc-antigo|\bold\b|antigo|temp|tmp|download|lixeira)/i;

function action(ctx: PlanContext, i: number, kind: ActionKind, reason: string, to?: string): PlannedAction {
  const nd = ctx.tree.nodes[i]!;
  return {
    id: newId("act"),
    kind,
    nodeId: nd.id,
    from: nd.path,
    to,
    bytes: nd.kind === "folder" ? ctx.tree.total[i]! : nd.size,
    reason,
  };
}

function finish(strategy: string, title: string, actions: PlannedAction[], warnings: string[], skippedProtected: number): Plan {
  let list = actions;
  if (list.length > MAX_ACTIONS) {
    warnings.push(`O plano foi limitado a ${MAX_ACTIONS} ações (havia ${list.length}). Rode de novo depois para o restante.`);
    list = list.slice(0, MAX_ACTIONS);
  }
  if (skippedProtected > 0) warnings.push(`${skippedProtected} itens em pastas do sistema foram ignorados por segurança.`);
  const totalBytes = list.reduce((s, a) => s + a.bytes, 0);
  const kinds = new Set(list.map((a) => a.kind));
  const verb = kinds.size === 1 && kinds.has("move") ? "mover" : "enviar para a quarentena";
  return {
    id: newId("plan"),
    strategy,
    title,
    summary: list.length
      ? `${list.length} ações para ${verb} (${formatBytes(totalBytes)}). Nada é apagado de verdade: tudo pode ser desfeito.`
      : "Nada a fazer com esse critério.",
    actions: list,
    totalBytes,
    createdAt: Date.now(),
    warnings,
  };
}

/** Plano de duplicados: mantém uma cópia de cada grupo, as outras vão para a quarentena. */
function dedupe(ctx: PlanContext): Plan {
  const { tree, dup } = ctx;
  const actions: PlannedAction[] = [];
  let skipped = 0;
  for (const group of dup.groups) {
    const scored = group
      .map((i) => {
        const nd = tree.nodes[i]!;
        const score = (BACKUP_HINT.test(nd.path) ? 1000 : 0) + nd.path.length;
        return { i, score, mod: nd.modifiedAt };
      })
      .sort((a, b) => a.score - b.score || a.mod - b.mod);
    const keeper = tree.nodes[scored[0]!.i]!;
    for (const { i } of scored.slice(1)) {
      if (isProtectedPath(tree.nodes[i]!.path)) {
        skipped++;
        continue;
      }
      actions.push(action(ctx, i, "quarantine", `Cópia idêntica de ${keeper.path}`));
    }
  }
  return finish("dedupe", "Remover cópias duplicadas", actions, [], skipped);
}

/** Organiza os arquivos soltos de uma pasta em subpastas por tipo. */
function organizeByType(ctx: PlanContext, p: StrategyParams): Plan {
  const { tree } = ctx;
  const idx = p.folderId ? tree.index.get(p.folderId) : undefined;
  if (idx === undefined || tree.nodes[idx]!.kind !== "folder") {
    return finish("organize_by_type", "Organizar por tipo", [], ["Escolha uma pasta válida para organizar."], 0);
  }
  const folder = tree.nodes[idx]!;
  const actions: PlannedAction[] = [];
  let skipped = 0;
  if (isProtectedPath(folder.path)) {
    return finish("organize_by_type", `Organizar ${folder.name}`, [], ["Essa pasta é protegida e não pode ser reorganizada."], 1);
  }
  for (const c of tree.children[idx]!) {
    const nd = tree.nodes[c]!;
    if (nd.kind !== "file") continue;
    if (isProtectedPath(nd.path)) {
      skipped++;
      continue;
    }
    const label = CATEGORY_LABEL_PT[nd.category];
    actions.push(action(ctx, c, "move", `Arquivo do tipo ${label}`, normalizePath(`${folder.path}/_Organizado/${label}/${nd.name}`)));
  }
  return finish("organize_by_type", `Organizar ${folder.name} por tipo`, actions, [], skipped);
}

const JUNK_EXT = ["tmp", "log", "etl", "dmp"];
const JUNK_PATH = /(\/temp\/|\/cache\/|chromecache|\/\.cache\/|thumbs\.db)/i;

/** Lixo provável: temporários, logs, dumps e caches parados há tempo. */
function cleanJunk(ctx: PlanContext, p: StrategyParams): Plan {
  const days = p.minAgeDays ?? 30;
  const found = queryNodes(ctx.tree, { kind: "file", notAccessedDays: days }, ctx);
  const actions: PlannedAction[] = [];
  let skipped = 0;
  for (const i of found) {
    const nd = ctx.tree.nodes[i]!;
    const byExt = nd.ext && JUNK_EXT.includes(nd.ext);
    const byPath = JUNK_PATH.test(nd.path);
    if (!byExt && !byPath) continue;
    if (isProtectedPath(nd.path)) {
      skipped++;
      continue;
    }
    actions.push(action(ctx, i, "quarantine", byExt ? `Arquivo temporário (.${nd.ext}) parado há mais de ${days} dias` : `Cache parado há mais de ${days} dias`));
  }
  return finish("clean_junk", "Limpar temporários e caches", actions, [], skipped);
}

/** Arquivos grandes que ninguém abre há muito tempo. */
function archiveOld(ctx: PlanContext, p: StrategyParams): Plan {
  const days = p.minAgeDays ?? 365;
  const minSize = p.minSize ?? 100 * MB;
  const found = queryNodes(ctx.tree, { kind: "file", notAccessedDays: days, minSize, sortBy: "size" }, ctx);
  const actions: PlannedAction[] = [];
  let skipped = 0;
  for (const i of found) {
    const nd = ctx.tree.nodes[i]!;
    if (nd.category === "system" || isProtectedPath(nd.path)) {
      skipped++;
      continue;
    }
    actions.push(action(ctx, i, "quarantine", `${formatBytes(nd.size)} sem uso há mais de ${days} dias`));
  }
  return finish("archive_old", "Arquivar o que está parado e pesado", actions, [], skipped);
}

function selection(ctx: PlanContext, p: StrategyParams): Plan {
  const kind = p.kind ?? "quarantine";
  const actions: PlannedAction[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const chosen = new Set((p.ids ?? []).map((id) => ctx.tree.index.get(id)).filter((i): i is number => i !== undefined));
  for (const i of chosen) {
    // não duplica quando a pasta pai também foi escolhida
    let covered = false;
    for (let a = ctx.tree.parent[i]!; a >= 0; a = ctx.tree.parent[a]!) {
      if (chosen.has(a)) {
        covered = true;
        break;
      }
    }
    if (covered) continue;
    const nd = ctx.tree.nodes[i]!;
    if (isProtectedPath(nd.path)) {
      skipped++;
      continue;
    }
    if (kind === "move") {
      if (!p.destination) {
        warnings.push("Informe a pasta de destino para mover.");
        break;
      }
      actions.push(action(ctx, i, "move", "Escolhido por você", normalizePath(`${p.destination}/${nd.name}`)));
    } else {
      actions.push(action(ctx, i, kind, "Escolhido por você"));
    }
  }
  const title = kind === "move" ? "Mover itens selecionados" : kind === "trash" ? "Enviar à lixeira" : "Enviar para a quarentena";
  return finish("selection", title, actions, warnings, skipped);
}

export function buildPlan(strategy: StrategyId, params: StrategyParams, ctx: PlanContext): Plan {
  switch (strategy) {
    case "dedupe":
      return dedupe(ctx);
    case "organize_by_type":
      return organizeByType(ctx, params);
    case "clean_junk":
      return cleanJunk(ctx, params);
    case "archive_old":
      return archiveOld(ctx, params);
    case "selection":
      return selection(ctx, params);
  }
}
