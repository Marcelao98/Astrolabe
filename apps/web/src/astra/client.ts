import type { FsNode } from "@astrolabe/core";
import { MockProvider, type AstraContext, type AstraEvent, type ChatMessage } from "@astrolabe/agents";

/**
 * Fala com a Astra. Se a API local estiver rodando com ANTHROPIC_API_KEY, usa o Claude;
 * senão responde no próprio navegador com o provedor simulado (sem rede, sem chave).
 */
export class AstraClient {
  private mock = new MockProvider();
  private remote: Promise<boolean> | null = null;

  private isRemote(): Promise<boolean> {
    this.remote ??= fetch("/api/health", { signal: AbortSignal.timeout(900) })
      .then((r) => r.ok ? r.json() : null)
      .then((j: { provider?: string } | null) => j?.provider === "anthropic")
      .catch(() => false);
    return this.remote;
  }

  async mode(): Promise<"claude" | "simulada"> {
    return (await this.isRemote()) ? "claude" : "simulada";
  }

  async *chat(text: string, history: ChatMessage[], ctx: AstraContext): AsyncGenerator<AstraEvent> {
    if (!(await this.isRemote())) {
      yield* this.mock.chat({ text, history, ctx });
      return;
    }
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, history: history.slice(-12), selection: ctx.selection }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k: number;
        while ((k = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, k);
          buf = buf.slice(k + 2);
          if (chunk.startsWith("data: ")) yield JSON.parse(chunk.slice(6)) as AstraEvent;
        }
      }
    } catch {
      // API caiu no meio: volta ao modo simulado em vez de travar a conversa.
      this.remote = Promise.resolve(false);
      yield { kind: "text", text: "Perdi a conexão com o meu cérebro na nuvem; vou continuar no modo simples." };
      yield* this.mock.chat({ text, history, ctx });
    }
  }

  /** Conta à API (se for o Claude) qual mapa o usuário está vendo, para a Astra enxergar o mesmo. */
  async setSource(nodes: FsNode[] | null, label: string, now: number): Promise<void> {
    if (!(await this.isRemote())) return;
    try {
      if (!nodes) await fetch("/api/tree", { method: "DELETE" });
      else
        await fetch("/api/tree", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodes, now, label }),
        });
    } catch {
      /* sem API, a Astra simples continua usando o mapa do navegador */
    }
  }
}
