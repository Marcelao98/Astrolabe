import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { buildTree, findDuplicates, generateSample, SAMPLE_NOW, type DuplicateInfo, type Tree } from "@astrolabe/core";
import { LlmClassifier, LlmProvider, MockProvider, type AstraContext, type LlmClient, type Provider } from "@astrolabe/agents";

const ChatBody = z.object({
  text: z.string().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(40).default([]),
  selection: z.array(z.string().max(300)).max(5000).default([]),
});

export interface AppOptions {
  /** Cliente LLM; sem ele a Astra usa o provedor simulado. */
  llm?: LlmClient;
  tree?: Tree;
  /** Máx. de mensagens por minuto por IP. */
  rateLimit?: number;
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 512 * 1024 });
  const tree = opts.tree ?? buildTree(generateSample());
  const dup: DuplicateInfo = findDuplicates(tree);
  const provider: Provider = opts.llm ? new LlmProvider(opts.llm, new LlmClassifier(opts.llm)) : new MockProvider();
  const limit = opts.rateLimit ?? 30;
  const hits = new Map<string, { n: number; reset: number }>();

  // Só aceita pedidos vindos da própria máquina/origem local (a API mexe com arquivos).
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return reply.code(403).send({ error: "origem não permitida" });
    }
    reply.header("X-Content-Type-Options", "nosniff");
  });

  app.get("/api/health", async () => ({ ok: true, provider: opts.llm ? "anthropic" : "mock", nodes: tree.nodes.length }));

  app.post("/api/chat", async (req, reply) => {
    const now = Date.now();
    const h = hits.get(req.ip);
    if (!h || h.reset < now) hits.set(req.ip, { n: 1, reset: now + 60_000 });
    else if (++h.n > limit) return reply.code(429).send({ error: "muitas mensagens; espere um pouco" });

    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "pedido inválido" });
    const { text, history, selection } = parsed.data;
    const known = new Set(tree.index.keys());
    const ctx: AstraContext = { tree, now: SAMPLE_NOW, dup, selection: selection.filter((id) => known.has(id)), sourceLabel: "Amostra" };

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      for await (const ev of provider.chat({ text, history, ctx })) send(ev);
    } catch (e) {
      send({ kind: "text", text: "Tive um problema para pensar nisso agora. Tente de novo em instantes." });
      app.log.error(e);
    }
    send({ kind: "done" });
    reply.raw.end();
    return reply;
  });

  return app;
}
