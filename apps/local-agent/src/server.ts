import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { Executor, normalizePath, type ExecutionLog, type Plan } from "@astrolabe/actions";
import { LocalFsDriver } from "@astrolabe/actions/node";
import { scanDirectory } from "./scanner";

export interface AgentOptions {
  /** Pastas que o usuário liberou ao iniciar o agente. Nada fora delas é lido nem alterado. */
  roots: string[];
  token?: string;
  trashFn?: (p: string) => Promise<void>;
  /** Origens do navegador aceitas (a interface web). */
  origins?: RegExp;
}

const ActionSchema = z.object({
  id: z.string().max(100),
  kind: z.enum(["move", "quarantine", "trash"]),
  nodeId: z.string().max(100),
  from: z.string().max(4000),
  to: z.string().max(4000).optional(),
  bytes: z.number().nonnegative(),
  reason: z.string().max(500),
});
const PlanSchema = z.object({
  id: z.string().max(100),
  strategy: z.string().max(50),
  title: z.string().max(300),
  summary: z.string().max(2000),
  actions: z.array(ActionSchema).max(20_000),
  totalBytes: z.number().nonnegative(),
  createdAt: z.number(),
  warnings: z.array(z.string().max(500)).max(100),
});
const ExecuteBody = z.object({
  plan: PlanSchema,
  approval: z.object({ planId: z.string(), approvedAt: z.number(), onlyActionIds: z.array(z.string()).optional() }),
  dryRun: z.boolean().optional(),
});
const LogSchema = z.object({
  id: z.string(),
  planId: z.string(),
  startedAt: z.number(),
  finishedAt: z.number(),
  dryRun: z.boolean(),
  results: z.array(z.object({ actionId: z.string(), status: z.enum(["done", "failed", "skipped"]), error: z.string().optional(), location: z.string().optional() })),
  undone: z.array(z.string()),
});
const UndoBody = z.object({ plan: PlanSchema, log: LogSchema, actionIds: z.array(z.string()).optional() });
const ScanBody = z.object({ root: z.string().min(1).max(4000), maxNodes: z.number().int().positive().max(1_000_000).optional() });

export function buildAgent(opts: AgentOptions): { app: FastifyInstance; token: string } {
  const roots = opts.roots.map(normalizePath);
  const token = opts.token ?? randomBytes(24).toString("base64url");
  const driver = new LocalFsDriver({ roots, trashFn: opts.trashFn });
  const origins = opts.origins ?? /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  const tokenBuf = Buffer.from(token);

  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin) {
      if (!origins.test(origin)) return reply.code(403).send({ error: "origem não permitida" });
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Headers", "authorization, content-type");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Vary", "Origin");
    }
    if (req.method === "OPTIONS") return reply.code(204).send();
    const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf)) return reply.code(401).send({ error: "token inválido" });
  });

  // A quarentena fica dentro da primeira raiz; cada raiz escaneada tem a sua.
  const executorFor = (rootOfPlan: string) => {
    const root = roots.find((r) => normalizePath(rootOfPlan) === r || normalizePath(rootOfPlan).startsWith(`${r}/`)) ?? roots[0]!;
    return new Executor({ driver, quarantineRoot: `${root}/.astrolabe-quarantine` });
  };

  app.get("/agent/info", async () => ({ ok: true, roots, platform: process.platform }));

  app.post("/agent/scan", async (req, reply) => {
    const p = ScanBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "pedido inválido" });
    const root = normalizePath(p.data.root);
    if (!roots.includes(root)) return reply.code(403).send({ error: "essa pasta não foi liberada ao iniciar o agente" });
    return scanDirectory(p.data.root, { maxNodes: p.data.maxNodes });
  });

  app.post("/agent/execute", async (req, reply) => {
    const p = ExecuteBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "plano inválido" });
    const plan = p.data.plan as Plan;
    const first = plan.actions[0];
    const exec = executorFor(first?.from ?? roots[0]!);
    try {
      const log = await exec.execute(plan, p.data.approval, { dryRun: p.data.dryRun });
      if (!log.dryRun) await persistLog(roots[0]!, log);
      return log;
    } catch (e) {
      return reply.code(409).send({ error: e instanceof Error ? e.message : "falhou" });
    }
  });

  app.post("/agent/undo", async (req, reply) => {
    const p = UndoBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "pedido inválido" });
    const plan = p.data.plan as Plan;
    const exec = executorFor(plan.actions[0]?.from ?? roots[0]!);
    try {
      return await exec.undo(plan, p.data.log as ExecutionLog, p.data.actionIds);
    } catch (e) {
      return reply.code(409).send({ error: e instanceof Error ? e.message : "falhou" });
    }
  });

  return { app, token };
}

async function persistLog(root: string, log: ExecutionLog): Promise<void> {
  try {
    const dir = `${root}/.astrolabe-quarantine/logs`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${log.id}.json`, JSON.stringify(log, null, 2));
  } catch {
    /* o registro em disco é um extra; a interface guarda o log da sessão */
  }
}

