import type { YamlEnvNode, YamlEnvTree } from "../hooks/useYamlEnvironments.ts";
import type { EditableEnvNode } from "./EnvironmentNode";

export type EditableEnvTree = Record<string, EditableEnvNode>;

let nextId = 0;
export function genVarId(): string {
  return `var-${Date.now()}-${nextId++}`;
}

/**
 * Merge public and private JSON trees into a single editable tree.
 * Public variables get isPrivate=false, private variables get isPrivate=true.
 */
export function mergeToEditable(publicTree: YamlEnvTree, privateTree: YamlEnvTree): EditableEnvTree {
  const allKeys = new Set([...Object.keys(publicTree), ...Object.keys(privateTree)]);
  const result: EditableEnvTree = {};

  for (const key of allKeys) {
    result[key] = mergeNode(publicTree[key], privateTree[key]);
  }

  return result;
}

function mergeNode(pubNode?: YamlEnvNode, privNode?: YamlEnvNode): EditableEnvNode {
  const variables: EditableEnvNode["variables"] = [];

  if (pubNode?.variables) {
    for (const [k, v] of Object.entries(pubNode.variables)) {
      variables.push({ id: genVarId(), key: k, value: v, isPrivate: false });
    }
  }
  if (privNode?.variables) {
    for (const [k, v] of Object.entries(privNode.variables)) {
      const existing = variables.find((vr) => vr.key === k);
      if (existing) {
        // Private takes precedence when key exists in both
        existing.value = v;
        existing.isPrivate = true;
      } else {
        variables.push({ id: genVarId(), key: k, value: v, isPrivate: true });
      }
    }
  }

  const childKeys = new Set([
    ...Object.keys(pubNode?.children || {}),
    ...Object.keys(privNode?.children || {}),
  ]);
  const children: Record<string, EditableEnvNode> = {};
  for (const ck of childKeys) {
    children[ck] = mergeNode(pubNode?.children?.[ck], privNode?.children?.[ck]);
  }

  return { variables, children };
}

/**
 * Split editable tree back into separate public/private JSON trees.
 */
export function splitFromEditable(tree: EditableEnvTree): { publicTree: YamlEnvTree; privateTree: YamlEnvTree } {
  const publicTree: YamlEnvTree = {};
  const privateTree: YamlEnvTree = {};

  for (const [key, node] of Object.entries(tree)) {
    const { pub, priv } = splitNode(node);
    if (pub) publicTree[key] = pub;
    if (priv) privateTree[key] = priv;
  }

  return { publicTree, privateTree };
}

function splitNode(node: EditableEnvNode): { pub: YamlEnvNode | null; priv: YamlEnvNode | null } {
  const pubVars: Record<string, string> = {};
  const privVars: Record<string, string> = {};

  for (const v of node.variables) {
    if (!v.key.trim()) continue; // skip empty keys
    if (v.isPrivate) {
      privVars[v.key] = v.value;
    } else {
      pubVars[v.key] = v.value;
    }
  }

  const pubChildren: Record<string, YamlEnvNode> = {};
  const privChildren: Record<string, YamlEnvNode> = {};

  for (const [ck, cn] of Object.entries(node.children)) {
    const { pub, priv } = splitNode(cn);
    if (pub) pubChildren[ck] = pub;
    if (priv) privChildren[ck] = priv;
  }

  const hasPubVars = Object.keys(pubVars).length > 0;
  const hasPubChildren = Object.keys(pubChildren).length > 0;
  const hasPrivVars = Object.keys(privVars).length > 0;
  const hasPrivChildren = Object.keys(privChildren).length > 0;

  // Ensure the node exists in at least the public tree for structure
  const pub: YamlEnvNode | null =
    hasPubVars || hasPubChildren || (!hasPrivVars && !hasPrivChildren)
      ? {
          ...(hasPubVars ? { variables: pubVars } : {}),
          ...(hasPubChildren ? { children: pubChildren } : {}),
        }
      : null;

  const priv: YamlEnvNode | null =
    hasPrivVars || hasPrivChildren
      ? {
          ...(hasPrivVars ? { variables: privVars } : {}),
          ...(hasPrivChildren ? { children: privChildren } : {}),
        }
      : null;

  return { pub, priv };
}
