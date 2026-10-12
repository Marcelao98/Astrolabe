/** Tipos do ciclo plano → aprovação → execução → desfazer. */

export type ActionKind = "move" | "quarantine" | "trash";

export interface PlannedAction {
  id: string;
  kind: ActionKind;
  /** Id do nó na fonte. */
  nodeId: string;
  from: string;
  /** Destino (só para "move"). */
  to?: string;
  bytes: number;
  reason: string;
}

export interface Plan {
  id: string;
  strategy: string;
  title: string;
  summary: string;
  actions: PlannedAction[];
  totalBytes: number;
  createdAt: number;
  /** Avisos legíveis (itens protegidos ignorados, limites...). */
  warnings: string[];
}

export type ActionStatus = "done" | "failed" | "skipped";

export interface ActionResult {
  actionId: string;
  status: ActionStatus;
  error?: string;
  /** Onde o item foi parar (quarentena, lixeira, destino). */
  location?: string;
}

/** Registro de uma execução: guarda o necessário para desfazer. */
export interface ExecutionLog {
  id: string;
  planId: string;
  startedAt: number;
  finishedAt: number;
  dryRun: boolean;
  results: ActionResult[];
  /** Ações já desfeitas. */
  undone: string[];
}

/** Aprovação explícita do usuário. Só a interface cria isto; a IA nunca. */
export interface Approval {
  planId: string;
  approvedAt: number;
  /** Se definido, só estas ações são executadas. */
  onlyActionIds?: string[];
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
