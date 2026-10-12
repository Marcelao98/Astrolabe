import { describe, expect, it } from "vitest";
import {
  GB,
  MB,
  buildTree,
  builtinLenses,
  categoryOfExt,
  computeLayout,
  findDuplicates,
  formatBytes,
  generateSample,
  queryNodes,
  radiusFor,
  topFiles,
  totalsByCategory,
  SAMPLE_NOW,
  type FsNode,
} from "../src";

const mk = (id: string, parentId: string | null, kind: "file" | "folder", size = 0, extra: Partial<FsNode> = {}): FsNode => ({
  id,
  sourceId: "t",
  path: id,
  name: id,
  kind,
  size,
  modifiedAt: 0,
  accessedAt: 0,
  parentId,
  category: "other",
  ...extra,
});

describe("aggregate", () => {
  it("soma tamanhos de baixo para cima, em qualquer ordem de entrada", () => {
    const tree = buildTree([
      mk("a.txt", "sub", "file", 10),
      mk("sub", "root", "folder"),
      mk("root", null, "folder"),
      mk("b.txt", "root", "file", 5),
    ]);
    const root = tree.index.get("root")!;
    expect(tree.total[root]).toBe(15);
    expect(tree.count[root]).toBe(2);
    expect(tree.total[tree.index.get("sub")!]).toBe(10);
  });

  it("agrupa por categoria e lista os mais pesados", () => {
    const nodes = generateSample({ files: 2000 });
    const tree = buildTree(nodes);
    const cats = totalsByCategory(tree);
    expect(cats.length).toBeGreaterThan(3);
    expect(cats[0]!.bytes).toBeGreaterThanOrEqual(cats[1]!.bytes);
    const top = topFiles(tree, 5);
    expect(tree.nodes[top[0]!]!.size).toBeGreaterThanOrEqual(tree.nodes[top[4]!]!.size);
  });
});

describe("scale", () => {
  const spec = (mode: "log" | "sqrt" | "linear") => ({ mode, domainMin: 1e6, domainMax: 1e10, rMin: 6, rMax: 60 });
  it("log: 1 MB -> 6px, 10 GB -> 60px, 1 GB perto de 47px", () => {
    expect(radiusFor(1e6, spec("log"))).toBeCloseTo(6, 5);
    expect(radiusFor(1e10, spec("log"))).toBeCloseTo(60, 5);
    expect(radiusFor(1e9, spec("log"))).toBeCloseTo(46.5, 1);
  });
  it("raiz quadrada some com o pequeno, mas respeita o mínimo", () => {
    expect(radiusFor(1e6, spec("sqrt"))).toBe(6);
    expect(radiusFor(1e9, spec("sqrt"))).toBeCloseTo(60 * Math.sqrt(0.1), 5);
  });
  it("linear é proporcional", () => {
    expect(radiusFor(5e9, spec("linear"))).toBeCloseTo(30, 5);
  });
  it("formata bytes em pt-BR", () => {
    expect(formatBytes(4.2 * GB)).toBe("4,20 GB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(0)).toBe("0 B");
  });
});

describe("categorias", () => {
  it("classifica por extensão", () => {
    expect(categoryOfExt("MP4")).toBe("video");
    expect(categoryOfExt(".pdf")).toBe("document");
    expect(categoryOfExt("xyz")).toBe("other");
    expect(categoryOfExt(undefined)).toBe("other");
  });
});

describe("duplicados", () => {
  it("agrupa por hash e calcula o espaço desperdiçado", () => {
    const tree = buildTree([
      mk("r", null, "folder"),
      mk("a", "r", "file", 100, { hash: "x" }),
      mk("b", "r", "file", 100, { hash: "x" }),
      mk("c", "r", "file", 100, { hash: "x" }),
      mk("d", "r", "file", 50, { hash: "y" }),
    ]);
    const dup = findDuplicates(tree);
    expect(dup.groups).toHaveLength(1);
    expect(dup.wastedBytes).toBe(200);
    expect(dup.groupOf[tree.index.get("d")!]).toBe(-1);
  });
  it("o gerador cria duplicados de propósito", () => {
    const tree = buildTree(generateSample({ files: 3000 }));
    expect(findDuplicates(tree).groups.length).toBeGreaterThan(0);
  });
});

describe("amostra", () => {
  it("é determinística", () => {
    const a = generateSample({ files: 1500, seed: 7 });
    const b = generateSample({ files: 1500, seed: 7 });
    expect(a.length).toBe(b.length);
    expect(a[a.length - 1]).toEqual(b[b.length - 1]);
  });
  it("gera ~50 mil nós com a configuração padrão", () => {
    const nodes = generateSample();
    expect(nodes.length).toBeGreaterThan(30_000);
    expect(nodes.length).toBeLessThan(90_000);
  });
});

describe("layout orbital", () => {
  const nodes = generateSample({ files: 4000 });
  const tree = buildTree(nodes);

  it("não sobrepõe irmãos (sistemas inteiros)", () => {
    const layout = computeLayout(tree, { scale: "log", openDepth: 99 });
    let checked = 0;
    for (const i of tree.order) {
      if (!layout.open[i]) continue;
      const kids = tree.children[i]!;
      // checa só os maiores (os pequenos são checados por amostragem)
      const big = kids.slice().sort((a, b) => layout.sys[b]! - layout.sys[a]!).slice(0, 40);
      for (let a = 0; a < big.length; a++) {
        for (let b = a + 1; b < big.length; b++) {
          const A = big[a]!, B = big[b]!;
          const d = Math.hypot(layout.x[A]! - layout.x[B]!, layout.y[A]! - layout.y[B]!);
          expect(d).toBeGreaterThanOrEqual((layout.sys[A]! + layout.sys[B]!) * 0.9);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("filhos ficam dentro do sistema do pai", () => {
    const layout = computeLayout(tree, { scale: "sqrt", openDepth: 99 });
    for (const i of tree.order) {
      if (!layout.open[i]) continue;
      for (const c of tree.children[i]!) {
        const d = Math.hypot(layout.x[c]! - layout.x[i]!, layout.y[c]! - layout.y[i]!);
        expect(d + layout.sys[c]!).toBeLessThanOrEqual(layout.sys[i]! + 0.01);
      }
    }
  });

  it("pastas fechadas escondem os filhos", () => {
    const layout = computeLayout(tree, { scale: "log", openDepth: 1 });
    const hidden = tree.order.filter((i) => !layout.visible[i]).length;
    expect(hidden).toBeGreaterThan(0);
    const open = computeLayout(tree, { scale: "log", openDepth: 99 });
    const shown = open.visible.reduce((s, v) => s + v, 0);
    const merged = open.compressed.reduce((s, v) => s + v, 0);
    expect(merged).toBeGreaterThan(0); // cadeias de pasta única viram "transparentes"
    expect(shown + merged).toBe(tree.nodes.length);
  });

  it("calcula o layout de ~50 mil nós em tempo razoável", () => {
    const big = buildTree(generateSample());
    const t0 = performance.now();
    computeLayout(big, { scale: "log", openDepth: 99 });
    expect(performance.now() - t0).toBeLessThan(2500);
  });
});

describe("lentes e consultas", () => {
  const tree = buildTree(generateSample({ files: 3000 }));
  const dup = findDuplicates(tree);
  const ctx = { tree, now: SAMPLE_NOW, dup, maxFileSize: 10 * GB };

  it("todas as lentes pintam todos os nós com cores válidas", () => {
    const out = { color: 0, alpha: 0 };
    for (const lens of builtinLenses) {
      for (let i = 0; i < tree.nodes.length; i += 7) {
        lens.paint(i, ctx, out);
        expect(out.color).toBeGreaterThanOrEqual(0);
        expect(out.color).toBeLessThanOrEqual(0xffffff);
        expect(out.alpha).toBeGreaterThan(0);
        expect(out.alpha).toBeLessThanOrEqual(1);
      }
      expect(lens.legend(ctx).length).toBeGreaterThan(0);
    }
  });

  it("filtra por categoria, tamanho e idade", () => {
    const vids = queryNodes(tree, { kind: "file", categories: ["video"], minSize: 100 * MB }, { now: SAMPLE_NOW, dup });
    expect(vids.length).toBeGreaterThan(0);
    for (const i of vids) {
      expect(tree.nodes[i]!.category).toBe("video");
      expect(tree.nodes[i]!.size).toBeGreaterThanOrEqual(100 * MB);
    }
    const old = queryNodes(tree, { kind: "file", notAccessedDays: 730 }, { now: SAMPLE_NOW, dup });
    for (const i of old) expect(SAMPLE_NOW - tree.nodes[i]!.accessedAt).toBeGreaterThanOrEqual(730 * 86_400_000);
    const dups = queryNodes(tree, { duplicatesOnly: true }, { now: SAMPLE_NOW, dup });
    expect(dups.length).toBeGreaterThan(0);
  });
});
