import type { Approval, ExecutionLog, Plan } from "@astrolabe/actions";
import type { FsNode } from "@astrolabe/core";

/** Conexão com o agente local (roda no PC do usuário, em 127.0.0.1, protegido por token). */
export class AgentConnection {
  readonly demo = false;
  constructor(
    readonly url: string,
    private token: string,
  ) {}

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("Token inválido. Copie de novo o token mostrado no terminal do agente.");
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`);
    return json;
  }

  info() {
    return this.call<{ roots: string[]; platform: string }>("/agent/info");
  }
  scan(root: string) {
    return this.call<{ nodes: FsNode[]; truncated: boolean; errors: number }>("/agent/scan", { root });
  }
  execute(plan: Plan, approval: Approval): Promise<ExecutionLog> {
    return this.call("/agent/execute", { plan, approval });
  }
  undo(plan: Plan, log: ExecutionLog): Promise<ExecutionLog> {
    return this.call("/agent/undo", { plan, log });
  }
}

/** Quem executa planos: o agente (disco real) ou a amostra em memória. */
export interface Runner {
  readonly demo: boolean;
  execute(plan: Plan, approval: Approval): Promise<ExecutionLog>;
  undo(plan: Plan, log: ExecutionLog): Promise<ExecutionLog>;
}
