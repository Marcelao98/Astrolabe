export const CATEGORIES = [
  "video",
  "image",
  "audio",
  "document",
  "code",
  "archive",
  "installer",
  "data",
  "system",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

const EXTENSIONS: Record<Exclude<Category, "other">, string[]> = {
  video: ["mp4", "mkv", "mov", "avi", "wmv", "webm", "m4v", "flv"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "tiff", "svg", "raw", "psd"],
  audio: ["mp3", "flac", "wav", "aac", "ogg", "m4a", "wma"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "odt", "csv", "rtf"],
  code: ["js", "ts", "tsx", "jsx", "py", "java", "c", "cpp", "h", "cs", "go", "rs", "html", "css", "sh", "php", "rb"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"],
  installer: ["exe", "msi", "dmg", "pkg", "deb", "apk", "appx"],
  data: ["json", "xml", "db", "sqlite", "bak", "sql", "log", "tmp", "dmp", "pak", "bin", "dat"],
  system: ["dll", "sys", "ini", "cab", "mui", "lnk", "inf"],
};

const BY_EXT = new Map<string, Category>();
for (const [cat, list] of Object.entries(EXTENSIONS)) {
  for (const ext of list) BY_EXT.set(ext, cat as Category);
}

export function categoryOfExt(ext: string | undefined): Category {
  if (!ext) return "other";
  return BY_EXT.get(ext.toLowerCase().replace(/^\./, "")) ?? "other";
}

export function extOf(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

export const CATEGORY_LABEL_PT: Record<Category, string> = {
  video: "Vídeos",
  image: "Imagens",
  audio: "Áudio",
  document: "Documentos",
  code: "Código",
  archive: "Compactados",
  installer: "Instaladores",
  data: "Dados e logs",
  system: "Sistema",
  other: "Outros",
};

export const CATEGORY_COLOR: Record<Category, number> = {
  video: 0xff4d8d,
  image: 0x38bdf8,
  audio: 0xa78bfa,
  document: 0x5eead4,
  code: 0x86efac,
  archive: 0xfde047,
  installer: 0xf97316,
  data: 0x94a3b8,
  system: 0x64748b,
  other: 0xcbd5e1,
};
