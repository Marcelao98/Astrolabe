import { resolve } from "node:path";
import { buildAgent } from "./server";

const args = process.argv.slice(2);
const roots = args.filter((a) => !a.startsWith("--")).map((a) => resolve(a));
const portArg = args.find((a) => a.startsWith("--port="));
const port = portArg ? Number(portArg.split("=")[1]) : 8788;

if (roots.length === 0) {
  console.log("Uso: pnpm dev:agent <pasta-ou-disco> [outra-pasta...] [--port=8788]\nEx.: pnpm dev:agent D:\\ E:\\Fotos");
  process.exit(1);
}

const { app, token } = buildAgent({ roots, token: process.env.ASTROLABE_TOKEN });
await app.listen({ port, host: "127.0.0.1" });
console.log(`
  Astrolabe · agente local em http://127.0.0.1:${port}
  Pastas liberadas: ${roots.join(", ")}
  Token (cole na interface): ${token}

  Itens apagados vão para a Lixeira do sistema; "quarentena" fica em <pasta>/.astrolabe-quarantine e dá para desfazer.
  Feche esta janela para encerrar o agente.
`);
