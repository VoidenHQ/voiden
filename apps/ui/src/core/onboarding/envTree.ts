import { getQueryClient } from "@/main";

export type EnvNode = { variables?: Record<string, string>; children?: Record<string, EnvNode>; displayName?: string };
export type EnvTree = Record<string, EnvNode>;
export type EnvTrees = { public: EnvTree; private: EnvTree };

export function getNode(tree: EnvTree, segments: string[]): EnvNode | undefined {
  let level: Record<string, EnvNode> | undefined = tree;
  let node: EnvNode | undefined;
  for (const seg of segments) {
    node = level?.[seg];
    if (!node) return undefined;
    level = node.children;
  }
  return node;
}

export function getOrCreateNode(tree: EnvTree, segments: string[]): EnvNode {
  let level = tree;
  let node: EnvNode = {};
  for (const seg of segments) {
    level[seg] ??= {};
    node = level[seg];
    if (seg !== segments[segments.length - 1]) {
      node.children ??= {};
      level = node.children;
    }
  }
  return node;
}

export type EnvTarget = {
  segments: string[];
  label: string;
  /** No such node yet; it gets a "Default" display name. */
  createEnv: boolean;
  /** The target env isn't the active one yet (no env selected, or a legacy .env file is). */
  needsActivate: boolean;
  /** Variables the target env already resolves to. */
  existing: Record<string, string>;
};

/** Where new variables go: the active YAML environment, else a "default" one. */
export function resolveEnvTarget(env: any, trees: EnvTrees | undefined): EnvTarget {
  const rawActive: string | null = env?.activeEnv ?? null;
  const isYaml = (name: string) => !!(getNode(trees?.public ?? {}, name.split(".")) || getNode(trees?.private ?? {}, name.split(".")));
  const activeEnv = rawActive && isYaml(rawActive) ? rawActive : null;
  const segments = activeEnv ? activeEnv.split(".") : ["default"];
  return {
    segments,
    label: activeEnv ? env?.displayNames?.[activeEnv] || activeEnv : "Default",
    createEnv: !activeEnv && !getNode(trees?.public ?? {}, segments),
    needsActivate: !activeEnv,
    existing: env?.data?.[segments.join(".")] ?? {},
  };
}

/**
 * Add variables to the active project's environment files (public → env-public.yaml,
 * secret → git-ignored env-private.yaml) and select that environment if none is.
 * `plan` sees the target first, so callers can pick names that don't clash.
 */
export async function addEnvVariables(
  plan: (target: EnvTarget) => { publicVars: Record<string, string>; privateVars: Record<string, string> },
) {
  const env = await window.electron?.env.load();
  const profile: string | undefined = env?.activeProfile || undefined;
  const trees = ((await window.electron?.env.getYamlTrees(profile)) as EnvTrees | undefined) ?? { public: {}, private: {} };
  const target = resolveEnvTarget(env, trees);
  const { publicVars, privateVars } = plan(target);

  const publicTree: EnvTree = structuredClone(trees.public ?? {});
  const privateTree: EnvTree = structuredClone(trees.private ?? {});
  const pub = getOrCreateNode(publicTree, target.segments);
  if (target.createEnv) pub.displayName = "Default";
  pub.variables = { ...pub.variables, ...publicVars };
  if (Object.keys(privateVars).length) {
    const priv = getOrCreateNode(privateTree, target.segments);
    priv.variables = { ...priv.variables, ...privateVars };
  }
  await window.electron?.env.saveYamlTrees(publicTree, privateTree, profile);
  if (target.needsActivate) await window.electron?.env.setActive(target.segments.join("."));

  const queryClient = getQueryClient();
  await Promise.all(
    [["environments"], ["env"], ["environment-keys"], ["yaml-environments"]].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
  return target;
}
