import { formatBytes, type Category } from "@astrolabe/core";
import { HeuristicClassifier, type Classifier } from "./classifier";
import { ToolRuntime } from "./tools";
import type { AstraEvent, ChatInput, Provider } from "./types";

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

const CATEGORY_WORDS: [Category, RegExp, string][] = [
  ["video", /(video|filme|gravac)/, "vídeos"],
  ["image", /(imagem|imagens|foto|fotos)/, "imagens"],
  ["audio", /(audio|musica)/, "áudio"],
  ["document", /(documento|pdf|planilha|word|excel|apresentac)/, "documentos"],
  ["code", /(codigo|node_modules)/, "código"],
  ["archive", /(compactad|\bzip\b|\brar\b|\b7z\b)/, "arquivos compactados"],
  ["installer", /(instalador|\bsetup\b|\.exe|\bmsi\b)/, "instaladores"],
];

function parseDays(t: string): number | undefined {
  const m = t.match(/(\d+)\s*(anos?|mes(?:es)?|dias?)/);
  if (!m) return /\b(um|1)\s+ano\b/.test(t) ? 365 : undefined;
  const n = Number(m[1]);
  return m[2]!.startsWith("ano") ? n * 365 : m[2]!.startsWith("mes") ? n * 30 : n;
}

function parseMB(t: string): number | undefined {
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(gb|mb|giga|mega)/);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(",", "."));
  return m[2] === "gb" || m[2] === "giga" ? n * 1024 : n;
}

/**
 * Astra sem IA externa: entende pedidos comuns em português e responde com números reais,
 * usando as MESMAS ferramentas que o modelo usaria. Serve de demonstração e de plano B offline.
 */
export class MockProvider implements Provider {
  readonly name = "mock";
  constructor(private classifier: Classifier = new HeuristicClassifier()) {}

  async *chat({ text, ctx }: ChatInput): AsyncGenerator<AstraEvent> {
    const rt = new ToolRuntime(ctx, this.classifier);
    const t = strip(text);
    const say = (s: string): AstraEvent => ({ kind: "text", text: s });
    const mood = (m: "neutral" | "happy" | "search" | "alert" | "think"): AstraEvent => ({ kind: "mood", mood: m });
    const flush = function* (): Generator<AstraEvent> {
      for (const a of rt.drain()) yield { kind: "action", action: a };
    };
    const call = async <T,>(name: string, input: unknown): Promise<T> => (await rt.run(name, input)) as T;

    yield mood("think");

    // ---- ajuda / oi ----
    if (/^(oi|ola|e ai|opa|bom dia|boa tarde|boa noite)\b/.test(t) || /(ajuda|o que (voce )?(sabe|pode)|como funciona)/.test(t)) {
      const o = rt.overview();
      yield mood("happy");
      yield say(
        `Oi! Eu sou a Astra ✨ Estou olhando ${o.source}: ${o.total_human} em ${o.files.toLocaleString("pt-BR")} arquivos, e ${o.duplicates_wasted_human} só em cópias duplicadas.\n\n` +
          "Você pode me pedir, por exemplo:\n" +
          "• “o que está ocupando mais espaço?”\n" +
          "• “mostra meus vídeos” ou “fotos parados há mais de 2 anos”\n" +
          "• “quais são os duplicados?”\n" +
          "• “o que parece contrato?”\n" +
          "• “organiza a pasta Downloads por tipo”\n" +
          "• “limpa os temporários”",
      );
      return;
    }

    // ---- escala ----
    if (/escala/.test(t) && /(log|raiz|linear)/.test(t)) {
      const mode = /linear/.test(t) ? "linear" : /raiz|sqrt/.test(t) ? "sqrt" : "log";
      await call("set_scale", { mode });
      yield* flush();
      yield mood("happy");
      yield say(
        mode === "log"
          ? "Pronto: escala logarítmica. Cada 10× de peso vira um degrau de tamanho, então você vê a estrutura toda."
          : mode === "sqrt"
            ? "Escala de raiz quadrada ligada: a área de cada astro é proporcional ao tamanho, e os gigantes ficam bem mais evidentes."
            : "Escala linear: o raio é proporcional ao tamanho. Só os maiores aparecem, o resto vira poeira.",
      );
      return;
    }

    // ---- lente ----
    if (/(cor|lente|colori|pinta|mostr\w* por)/.test(t) && /(tipo|idade|acesso|tamanho|peso|duplicad)/.test(t)) {
      const lens = /duplicad/.test(t) ? "duplicates" : /(idade|acesso|antig)/.test(t) ? "age" : /(tamanho|peso)/.test(t) ? "size" : "type";
      await call("set_lens", { lens });
      yield* flush();
      yield mood("happy");
      const names = { type: "tipo de arquivo", age: "idade (último acesso)", size: "tamanho", duplicates: "duplicados" } as const;
      yield say(`Mapa pintado por ${names[lens]}. A legenda está no canto inferior esquerdo.`);
      return;
    }

    // ---- duplicados ----
    if (/(duplicad|repetid|copias? identic|copia dupla)/.test(t)) {
      yield mood("search");
      const r = await call<{ groups: number; wasted_human: string; biggest_groups: { copies: number; size: number; example_paths: string[] }[] }>("duplicates_report", {});
      yield* flush();
      const big = r.biggest_groups[0];
      let msg = `Achei ${r.groups.toLocaleString("pt-BR")} grupos de arquivos idênticos, que desperdiçam ${r.wasted_human}. Liguei a lente de duplicados: as cópias idênticas brilham da mesma cor e as constelações ligam os pares.`;
      if (big) msg += `\n\nO maior grupo tem ${big.copies} cópias de ${formatBytes(big.size)}, por exemplo em:\n• ${big.example_paths.slice(0, 2).join("\n• ")}`;
      yield mood("alert");
      if (/(limp|remov|apag|tira|exclu|organiz|resolv|livr)/.test(t)) {
        const p = await call<{ title: string; actions: number; total_human: string }>("propose_plan", { strategy: "dedupe" });
        yield* flush();
        msg += `\n\nMontei um plano: ${p.actions} cópias iriam para a quarentena, liberando ${p.total_human}. Nada é apagado de verdade, e você pode desfazer. Revise e aprove no cartão abaixo.`;
      } else {
        msg += "\n\nQuer que eu monte um plano para limpar? É só pedir “limpa os duplicados”.";
      }
      yield say(msg);
      return;
    }

    // ---- temporários / lixo ----
    if (/(lixo|temporari|cache|\btmp\b|\blogs?\b|dump|limp\w* (o )?(pc|disco|computador))/.test(t)) {
      yield mood("search");
      const days = parseDays(t) ?? 30;
      const r = await call<{ actions: number; total_human: string; warnings: string[] }>("propose_plan", { strategy: "clean_junk", min_age_days: days });
      yield* flush();
      yield mood(r.actions ? "alert" : "happy");
      yield say(
        r.actions
          ? `Encontrei ${r.actions.toLocaleString("pt-BR")} arquivos temporários, logs e caches parados há mais de ${days} dias: ${r.total_human} que podem sair. Pastas do sistema ficam de fora. Revise o plano abaixo: vai tudo para a quarentena, e dá para desfazer.`
          : "Não achei temporários ou caches parados com esse critério. Seu disco está limpinho por aí!",
      );
      return;
    }

    // ---- antigo / parado ----
    if (/(antig|parad|velh|esquecid|nao (uso|abro|acesso|mexo)|sem uso)/.test(t)) {
      const days = parseDays(t) ?? 365;
      const minMB = parseMB(t);
      const cat = CATEGORY_WORDS.find(([, re]) => re.test(t));
      yield mood("search");
      const query = { kind: "file" as const, not_accessed_days: days, ...(minMB ? { min_size_mb: minMB } : {}), ...(cat ? { categories: [cat[0]] } : {}), sort_by: "size" as const };
      const r = await call<{ count: number; total_human: string; largest?: { path: string; size: number } }>("show_on_map", { query, label: `Parados há ${days}+ dias` });
      yield* flush();
      if (!r.count) {
        yield mood("happy");
        yield say(`Nada com mais de ${days} dias sem abrir${cat ? ` em ${cat[2]}` : ""}. 👌`);
        return;
      }
      yield mood("alert");
      let msg = `${r.count.toLocaleString("pt-BR")} arquivos${cat ? ` de ${cat[2]}` : ""} não são abertos há mais de ${days} dias, somando ${r.total_human}. Destaquei no mapa (o resto esmaeceu).`;
      if (r.largest) msg += `\nO maior é ${r.largest.path.split("/").pop()} (${formatBytes(r.largest.size)}).`;
      if (/(arquiv|limp|libera|remov|tira)/.test(t)) {
        const p = await call<{ actions: number; total_human: string }>("propose_plan", { strategy: "archive_old", min_age_days: days, ...(minMB ? { min_size_mb: minMB } : { min_size_mb: 50 }) });
        yield* flush();
        if (p.actions) msg += `\n\nMontei um plano para arquivar ${p.actions} arquivos grandes (${p.total_human}) na quarentena. Revise abaixo.`;
      }
      yield say(msg);
      return;
    }

    // ---- gargalos ----
    if (/(mais pesad|maiores?|gargalo|ocupa|ocupando|espaco|pesa mais|grande)/.test(t) && !CATEGORY_WORDS.some(([, re]) => re.test(t))) {
      yield mood("search");
      const files = await call<{ items: { id: string; path: string; size: number }[] }>("top_heaviest", { kind: "file", n: 5 });
      const folders = await call<{ items: { path: string; size: number }[] }>("top_heaviest", { kind: "folder", n: 3 });
      await call("fly_to", { target: files.items[0]!.path });
      yield* flush();
      yield mood("alert");
      yield say(
        `Os maiores gargalos:\n\nPastas\n${folders.items.map((f) => `• ${f.path} — ${formatBytes(f.size)}`).join("\n")}\n\nArquivos\n${files.items.map((f) => `• ${f.path.split("/").pop()} — ${formatBytes(f.size)}`).join("\n")}\n\nLevei a câmera até o maior arquivo. Dica: troque a escala para “raiz” ou “linear” para os gigantes saltarem aos olhos.`,
      );
      return;
    }

    // ---- organizar ----
    if (/(organiz|arruma|separa .* por tipo)/.test(t)) {
      const named = t.match(/(?:pasta|em|de)\s+([\w.\- ]+?)(?:\s+por\s+tipo|\s*$|[?.!,])/);
      const folder = named?.[1]?.trim();
      yield mood("think");
      const r = await call<{ error?: string; actions: number; total_human: string; examples: { to?: string }[] }>("propose_plan", { strategy: "organize_by_type", ...(folder && folder !== "tudo" ? { folder } : {}) });
      yield* flush();
      if (r.error) {
        yield mood("neutral");
        yield say(`${r.error} Exemplo: “organiza a pasta Downloads por tipo”.`);
        return;
      }
      yield mood("happy");
      yield say(`Montei o plano: ${r.actions.toLocaleString("pt-BR")} arquivos soltos iriam para subpastas por tipo (Vídeos, Imagens, Documentos...), dentro de “_Organizado”. Nada sai do lugar sem você aprovar.`);
      return;
    }

    // ---- categoria ----
    const cat = CATEGORY_WORDS.find(([, re]) => re.test(t));
    if (cat && /(mostr|quant|tenho|meus|minhas|ache|achar|ver|destaca|onde|quais)/.test(t)) {
      const days = parseDays(t);
      const minMB = parseMB(t);
      yield mood("search");
      const query = { kind: "file" as const, categories: [cat[0]], ...(days ? { not_accessed_days: days } : {}), ...(minMB ? { min_size_mb: minMB } : {}), sort_by: "size" as const };
      const r = await call<{ count: number; total_human: string; largest?: { path: string; size: number } }>("show_on_map", { query, label: cat[2] });
      yield* flush();
      if (!r.count) {
        yield mood("neutral");
        yield say(`Não achei ${cat[2]} com esse filtro.`);
        return;
      }
      yield mood("happy");
      yield say(`Você tem ${r.count.toLocaleString("pt-BR")} arquivos de ${cat[2]}${days ? ` parados há ${days}+ dias` : ""}, somando ${r.total_human}. Destaquei no mapa.${r.largest ? `\nO maior: ${r.largest.path.split("/").pop()} (${formatBytes(r.largest.size)}).` : ""}`);
      return;
    }

    // ---- classificar por critério ----
    const crit =
      t.match(/(?:o que parece|tudo que (?:parece|e|eh|seja|for)|parece(?:m)?(?: ser)?)\s+(.+)/)?.[1] ??
      t.match(/(?:classific\w+|separ\w+|marc\w+|destac\w+)\s+(?:tudo\s+(?:que\s+(?:e|eh|seja)\s+)?)?(?:o\s+|os\s+|as\s+|a\s+)?(.+)/)?.[1];
    if (crit && crit.length >= 3) {
      yield mood("think");
      const cleaned = crit.replace(/[?!.]+$/, "").trim();
      const r = await call<{ examined: number; matched: number; matched_human: string; by_label: Record<string, number>; examples: { path: string; label: string }[] }>("classify", { criterion: cleaned });
      yield* flush();
      if (!r.matched) {
        yield mood("neutral");
        yield say(`Olhei ${r.examined.toLocaleString("pt-BR")} arquivos e nenhum parece “${cleaned}” só pelo nome e pelo caminho. Pode me dar uma palavra-chave diferente?`);
        return;
      }
      yield mood("happy");
      const labels = Object.entries(r.by_label).map(([l, n]) => `${l}: ${n}`).join(" · ");
      yield say(`Classifiquei ${r.examined.toLocaleString("pt-BR")} arquivos pelo critério “${cleaned}”: ${r.matched.toLocaleString("pt-BR")} combinam (${r.matched_human}). ${labels}\n\nPintei o mapa com essa nova lente — o que não combina esmaeceu. Eu só olho nomes e caminhos, nunca o conteúdo.`);
      return;
    }

    // ---- ação sobre a seleção ----
    if (/(selecion|esses|estes|isso)/.test(t) && /(quarentena|lixeira|apag|exclu|remov|tira|mov)/.test(t)) {
      const kind = /lixeira/.test(t) ? "trash" : "quarantine";
      const r = await call<{ error?: string; actions: number; total_human: string }>("propose_plan", { strategy: "selection", selection_kind: kind });
      yield* flush();
      yield mood(r.error ? "neutral" : "alert");
      yield say(r.error ?? `Plano pronto: ${r.actions} itens (${r.total_human}) para ${kind === "trash" ? "a Lixeira" : "a quarentena"}. Revise e aprove abaixo.`);
      return;
    }

    // ---- ir até algo ----
    const go = t.match(/(?:va|ir|leva|levar|mostra|mostrar|abre|abrir|procura|procurar|acha|achar|encontra|encontrar)\s+(?:para|ate|a|o|na|no)?\s*(?:pasta|arquivo)?\s*(.+)/)?.[1];
    if (go) {
      const target = go.replace(/[?!.]+$/, "").trim();
      const r = await call<{ found: boolean; item?: { path: string; size: number } }>("fly_to", { target });
      yield* flush();
      if (r.found && r.item) {
        yield mood("happy");
        yield say(`Aqui está: ${r.item.path} (${formatBytes(r.item.size)}).`);
        return;
      }
    }

    // ---- não entendi ----
    yield mood("neutral");
    yield say("Hmm, essa eu não peguei. Tente algo como “o que está ocupando mais espaço?”, “mostra meus vídeos”, “quais são os duplicados?”, “o que parece contrato?” ou “limpa os temporários”.");
  }
}
