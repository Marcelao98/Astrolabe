import { AnthropicClient } from "./anthropic";
import { buildApp } from "./app";

const key = process.env.ANTHROPIC_API_KEY;
const app = buildApp({ llm: key ? new AnthropicClient(key, process.env.ASTRA_MODEL) : undefined });
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "127.0.0.1" });
console.log(`Astrolabe API em http://127.0.0.1:${port} · Astra: ${key ? "Claude" : "modo simulado (defina ANTHROPIC_API_KEY)"}`);
