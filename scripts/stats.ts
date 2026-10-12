import { buildTree, computeLayout, generateSample, findDuplicates, formatBytes } from "../packages/core/src";
const t0 = performance.now();
const nodes = generateSample();
const t1 = performance.now();
const tree = buildTree(nodes);
const dup = findDuplicates(tree);
const t2 = performance.now();
for (const mode of ["log", "sqrt", "linear"] as const) {
  const t = performance.now();
  const l = computeLayout(tree, { scale: mode, openDepth: 99 });
  console.log(mode, "extent", Math.round(l.extent), "ms", Math.round(performance.now() - t));
}
const folders = nodes.filter((n) => n.kind === "folder").length;
console.log({ nodes: nodes.length, folders, gen: Math.round(t1 - t0), tree: Math.round(t2 - t1), total: formatBytes(tree.total[0]!), dupGroups: dup.groups.length, wasted: formatBytes(dup.wastedBytes) });
