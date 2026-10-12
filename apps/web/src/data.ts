import { buildTree, generateSample, SAMPLE_NOW } from "@astrolabe/core";
import { GalaxyScene } from "@astrolabe/render";

export function createSampleScene(): GalaxyScene {
  const tree = buildTree(generateSample());
  const scene = new GalaxyScene(tree, SAMPLE_NOW);
  scene.openDepth = 99;
  scene.relayout();
  return scene;
}

/** Sistema inicial: a pasta mais pesada que ainda deixa ver estrutura (não a raiz inteira). */
export function homeIndex(scene: GalaxyScene): number {
  const { tree, layout } = scene;
  let best = tree.roots[0] ?? 0;
  let bestTotal = -1;
  for (const i of scene.visibleFolders) {
    if (tree.depth[i]! < 2) continue;
    if (layout.sys[i]! > layout.extent * 0.62) continue;
    if (tree.total[i]! > bestTotal) {
      bestTotal = tree.total[i]!;
      best = i;
    }
  }
  return best;
}

/** Bytes de uma seleção sem contar duas vezes o que está dentro de uma pasta também selecionada. */
export function selectionBytes(scene: GalaxyScene): number {
  const { tree, selection } = scene;
  let sum = 0;
  for (const i of selection) {
    let covered = false;
    for (let p = tree.parent[i]!; p >= 0; p = tree.parent[p]!) {
      if (selection.has(p)) {
        covered = true;
        break;
      }
    }
    if (!covered) sum += tree.nodes[i]!.kind === "folder" ? tree.total[i]! : tree.nodes[i]!.size;
  }
  return sum;
}
