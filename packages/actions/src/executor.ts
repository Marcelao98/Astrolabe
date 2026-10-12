import { isInside, isProtectedPath, isSafeName, normalizePath } from "./safety";
import { newId, type ActionResult, type Approval, type ExecutionLog, type Plan, type PlannedAction } from "./plan";

/** O que uma fonte (disco local, Drive, memória) precisa saber fazer. */
export interface FsDriver {
  /** Raízes dentro das quais qualquer operação é permitida. */
  readonly roots: string[];
  exists(path: string): Promise<boolean>;
  /** Move sem sobrescrever; cria as pastas do destino. */
  move(from: string, to: string): Promise<void>;
  /** Envia à lixeira do sistema. Retorna onde foi parar, se souber. */
  trash(path: string): Promise<string | undefined>;
}

export class ExecutionError extends Error {
  constructor(
    message: string,
    readonly code: "not_approved" | "plan_mismatch" | "invalid_plan",
  ) {
    super(message);
  }
}

export interface ExecutorOptions {
  driver: FsDriver;
  /** Pasta (dentro das raízes) onde a quarentena fica. */
  quarantineRoot: string;
  now?: () => number;
}

/**
 * Executa planos aprovados. Princípios:
 *  1. só executa com uma aprovação do usuário para ESTE plano;
 *  2. valida cada ação antes de tocar em qualquer coisa (preflight);
 *  3. nunca apaga de verdade: quarentena (reversível) ou lixeira do sistema;
 *  4. registra tudo para desfazer.
 */
export class Executor {
  private readonly driver: FsDriver;
  private readonly qRoot: string;
  private readonly now: () => number;

  constructor(opts: ExecutorOptions) {
    this.driver = opts.driver;
    this.qRoot = normalizePath(opts.quarantineRoot);
    this.now = opts.now ?? Date.now;
    if (!this.driver.roots.some((r) => isInside(this.qRoot, r))) {
      throw new Error("A pasta de quarentena precisa ficar dentro de uma raiz permitida.");
    }
  }

  /** Motivo pelo qual uma ação não pode rodar, ou null se está tudo certo. */
  validate(a: PlannedAction): string | null {
    const from = normalizePath(a.from);
    if (!this.driver.roots.some((r) => isInside(from, r))) return "Origem fora das pastas permitidas.";
    if (isProtectedPath(from)) return "Origem em pasta protegida.";
    if (isInside(from, this.qRoot)) return "Esse item já está na quarentena.";
    if (this.driver.roots.some((r) => normalizePath(r) === from)) return "Não é permitido mexer na raiz inteira.";
    if (a.kind === "move") {
      if (!a.to) return "Destino ausente.";
      const to = normalizePath(a.to);
      if (!this.driver.roots.some((r) => isInside(to, r))) return "Destino fora das pastas permitidas.";
      if (isProtectedPath(to)) return "Destino em pasta protegida.";
      if (isInside(to, from)) return "Não dá para mover uma pasta para dentro dela mesma.";
      const name = to.slice(to.lastIndexOf("/") + 1);
      if (!isSafeName(name)) return "Nome de destino inválido.";
    }
    return null;
  }

  async execute(plan: Plan, approval: Approval | null, opts: { dryRun?: boolean } = {}): Promise<ExecutionLog> {
    const dryRun = opts.dryRun ?? false;
    if (!dryRun) {
      if (!approval) throw new ExecutionError("É preciso aprovar o plano antes de executar.", "not_approved");
      if (approval.planId !== plan.id) throw new ExecutionError("A aprovação é de outro plano.", "plan_mismatch");
    }
    const only = approval?.onlyActionIds ? new Set(approval.onlyActionIds) : null;
    const logId = newId("run");
    const startedAt = this.now();
    const results: ActionResult[] = [];

    for (const a of plan.actions) {
      if (only && !only.has(a.id)) {
        results.push({ actionId: a.id, status: "skipped", error: "Não aprovada." });
        continue;
      }
      const problem = this.validate(a);
      if (problem) {
        results.push({ actionId: a.id, status: "failed", error: problem });
        continue;
      }
      const from = normalizePath(a.from);
      const target = this.targetOf(a, logId);
      if (dryRun) {
        results.push({ actionId: a.id, status: "skipped", location: target });
        continue;
      }
      try {
        if (!(await this.driver.exists(from))) {
          results.push({ actionId: a.id, status: "failed", error: "Item não encontrado (mudou desde o escaneamento?)." });
          continue;
        }
        if (a.kind === "trash") {
          const loc = await this.driver.trash(from);
          results.push({ actionId: a.id, status: "done", location: loc ?? "lixeira do sistema" });
        } else {
          if (await this.driver.exists(target)) {
            results.push({ actionId: a.id, status: "failed", error: "Já existe um item no destino." });
            continue;
          }
          await this.driver.move(from, target);
          results.push({ actionId: a.id, status: "done", location: target });
        }
      } catch (e) {
        results.push({ actionId: a.id, status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { id: logId, planId: plan.id, startedAt, finishedAt: this.now(), dryRun, results, undone: [] };
  }

  /** Desfaz o que foi movido/quarentenado. A lixeira do sistema se restaura por lá. */
  async undo(plan: Plan, log: ExecutionLog, actionIds?: string[]): Promise<ExecutionLog> {
    if (log.planId !== plan.id) throw new ExecutionError("O registro é de outro plano.", "plan_mismatch");
    const wanted = actionIds ? new Set(actionIds) : null;
    const byId = new Map(plan.actions.map((a) => [a.id, a]));
    const undone = [...log.undone];
    const results = [...log.results];

    for (let k = results.length - 1; k >= 0; k--) {
      const r = results[k]!;
      if (r.status !== "done" || undone.includes(r.actionId) || (wanted && !wanted.has(r.actionId))) continue;
      const a = byId.get(r.actionId);
      if (!a || a.kind === "trash" || !r.location) continue;
      const from = normalizePath(a.from);
      try {
        if (await this.driver.exists(from)) {
          results[k] = { ...r, error: "O local original foi ocupado por outro item; não restaurei." };
          continue;
        }
        if (!(await this.driver.exists(r.location))) {
          results[k] = { ...r, error: "O item não está mais onde foi deixado." };
          continue;
        }
        await this.driver.move(r.location, from);
        undone.push(r.actionId);
      } catch (e) {
        results[k] = { ...r, error: e instanceof Error ? e.message : String(e) };
      }
    }
    return { ...log, results, undone };
  }

  private targetOf(a: PlannedAction, logId: string): string {
    if (a.kind === "move") return normalizePath(a.to!);
    const name = normalizePath(a.from).split("/").pop()!;
    return normalizePath(`${this.qRoot}/${logId}/${a.id}__${name}`);
  }
}
