import type { Category } from "./categories";

export type NodeKind = "folder" | "file";

/** Um item de qualquer fonte (disco local, HD externo, Drive). */
export interface FsNode {
  id: string;
  sourceId: string;
  /** Caminho normalizado com "/" (ex.: "C:/Users/marcelo/Videos/a.mp4"). */
  path: string;
  name: string;
  kind: NodeKind;
  /** Bytes do próprio item. Para pastas costuma ser 0; o total vem de buildTree(). */
  size: number;
  /** Epoch em milissegundos. */
  modifiedAt: number;
  accessedAt: number;
  parentId: string | null;
  /** No Drive um arquivo pode ter mais de um pai. */
  extraParentIds?: string[];
  hash?: string;
  ext?: string;
  category: Category;
  categoryConfidence?: number;
}

export type ScaleMode = "log" | "sqrt" | "linear";

export interface SourceInfo {
  id: string;
  kind: "sample" | "local" | "drive";
  label: string;
  rootPath?: string;
}
