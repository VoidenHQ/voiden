import {
  Braces,
  Container,
  Database,
  File,
  FileCode,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Hash,
  Image,
  Infinity as InfinityIcon,
  Info,
  Settings2,
} from "lucide-react";

const ICONS_BY_EXT: Record<string, JSX.Element> = {
  void: <InfinityIcon size={14} className="text-accent" />,
  ts: <FileCode size={14} style={{ color: "#3178c6" }} />,
  tsx: <FileCode size={14} style={{ color: "#61dafb" }} />,
  js: <FileCode size={14} style={{ color: "#f7df1e" }} />,
  jsx: <FileCode size={14} style={{ color: "#61dafb" }} />,
  mjs: <FileCode size={14} style={{ color: "#f7df1e" }} />,
  cjs: <FileCode size={14} style={{ color: "#f7df1e" }} />,
  html: <FileCode size={14} style={{ color: "#e34c26" }} />,
  htm: <FileCode size={14} style={{ color: "#e34c26" }} />,
  css: <Hash size={14} style={{ color: "#563d7c" }} />,
  scss: <Hash size={14} style={{ color: "#c6538c" }} />,
  sass: <Hash size={14} style={{ color: "#c6538c" }} />,
  less: <Hash size={14} style={{ color: "#1d365d" }} />,
  json: <Braces size={14} style={{ color: "#cbcb41" }} />,
  yml: <Braces size={14} style={{ color: "#cc3e44" }} />,
  yaml: <Braces size={14} style={{ color: "#cc3e44" }} />,
  toml: <Braces size={14} style={{ color: "#9c4221" }} />,
  xml: <FileCode size={14} style={{ color: "#f4a261" }} />,
  csv: <FileSpreadsheet size={14} style={{ color: "#1e7a1e" }} />,
  sql: <Database size={14} style={{ color: "#e38c00" }} />,
  py: <FileCode size={14} style={{ color: "#3776ab" }} />,
  go: <FileCode size={14} style={{ color: "#00add8" }} />,
  rs: <FileCode size={14} style={{ color: "#dea584" }} />,
  java: <FileCode size={14} style={{ color: "#ea2d2e" }} />,
  rb: <FileCode size={14} style={{ color: "#cc342d" }} />,
  php: <FileCode size={14} style={{ color: "#8892be" }} />,
  swift: <FileCode size={14} style={{ color: "#f05138" }} />,
  kt: <FileCode size={14} style={{ color: "#7f52ff" }} />,
  c: <FileCode size={14} style={{ color: "#a8b9cc" }} />,
  cpp: <FileCode size={14} style={{ color: "#00427b" }} />,
  cc: <FileCode size={14} style={{ color: "#00427b" }} />,
  h: <FileCode size={14} style={{ color: "#a8b9cc" }} />,
  cs: <FileCode size={14} style={{ color: "#9b4f96" }} />,
  lua: <FileCode size={14} style={{ color: "#000080" }} />,
  r: <FileCode size={14} style={{ color: "#276dc3" }} />,
  sh: <FileCode size={14} style={{ color: "#89e051" }} />,
  bash: <FileCode size={14} style={{ color: "#89e051" }} />,
  zsh: <FileCode size={14} style={{ color: "#89e051" }} />,
  fish: <FileCode size={14} style={{ color: "#89e051" }} />,
  md: <FileText size={14} style={{ color: "#519aba" }} />,
  txt: <FileText size={14} style={{ color: "#a0adb8" }} />,
  pdf: <FileText size={14} style={{ color: "#e74c3c" }} />,
  png: <Image size={14} style={{ color: "#a074c4" }} />,
  jpg: <Image size={14} style={{ color: "#a074c4" }} />,
  jpeg: <Image size={14} style={{ color: "#a074c4" }} />,
  gif: <Image size={14} style={{ color: "#a074c4" }} />,
  svg: <Image size={14} style={{ color: "#ffb13b" }} />,
  ico: <Image size={14} style={{ color: "#a074c4" }} />,
  webp: <Image size={14} style={{ color: "#a074c4" }} />,
  lock: <File size={14} style={{ color: "#a0adb8" }} />,
  log: <File size={14} style={{ color: "#a0adb8" }} />,
};

const DEFAULT_FILE_ICON = <File size={14} style={{ color: "#a0adb8" }} />;

export function getFileIcon(name: string, path: string): JSX.Element {
  const lower = name.toLowerCase();

  if (name.startsWith(".env")) return <Settings2 size={14} style={{ color: "#ecd53f" }} />;
  if (lower === ".gitignore" || lower === ".gitattributes")
    return <GitBranch size={14} style={{ color: "#f54d27" }} />;
  if (name.startsWith("Dockerfile") || lower.startsWith("docker-compose"))
    return <Container size={14} style={{ color: "#0db7ed" }} />;
  if (lower === "readme.md") return <Info size={14} style={{ color: "#519aba" }} />;
  if (lower === "package.json" || lower === "package-lock.json")
    return <Braces size={14} style={{ color: "#cc3e44" }} />;
  if (lower === "tsconfig.json" || lower.startsWith("tsconfig."))
    return <Braces size={14} style={{ color: "#3178c6" }} />;

  const extMatch = path.match(/\.([0-9a-z]+)$/i);
  const ext = extMatch?.[1]?.toLowerCase();

  return ICONS_BY_EXT[ext ?? ""] ?? DEFAULT_FILE_ICON;
}
