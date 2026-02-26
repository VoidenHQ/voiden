import type { YamlEnvNode, YamlEnvTree } from "../hooks/useYamlEnvironments.ts";
import type { EditableEnvNode } from "./EnvironmentNode";

export type EditableEnvTree = Record<string, EditableEnvNode>;

let nextId = 0;
export function genVarId(): string {
  return `var-${Date.now()}-${nextId++}`;
}

/**
 * Generate a unique name that doesn't collide with existing keys.
 * Produces "new-environment", "new-environment-1", "new-environment-2", etc.
 */
export function generateUniqueName(existingKeys: Record<string, unknown>, base = "new-environment"): string {
  let name = base;
  let counter = 1;
  while (name in existingKeys) {
    name = `${base}-${counter++}`;
  }
  return name;
}

/**
 * Rename a key in a record while preserving insertion order.
 */
export function renameKey<T>(record: Record<string, T>, oldKey: string, newKey: string): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, val] of Object.entries(record)) {
    result[key === oldKey ? newKey : key] = val;
  }
  return result;
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

  const intermediate = pubNode?.intermediate || privNode?.intermediate || false;
  const displayName = pubNode?.displayName || privNode?.displayName;

  return {
    variables,
    children,
    ...(intermediate ? { intermediate } : {}),
    ...(displayName ? { displayName } : {}),
  };
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

/**
 * Filter an editable tree by a search term.
 * An env node is included when:
 *   - its name or displayName matches, OR
 *   - it has any variable whose key or value matches, OR
 *   - any descendant matches.
 * When a node is included only because of descendants, its own variables
 * are filtered to those that match (may be empty).
 * When a node itself matches by name, all its variables are kept.
 */
export function filterTree(tree: EditableEnvTree, term: string): EditableEnvTree {
  const lower = term.toLowerCase();
  const result: EditableEnvTree = {};
  for (const [name, node] of Object.entries(tree)) {
    const filtered = filterNode(name, node, lower);
    if (filtered) result[name] = filtered;
  }
  return result;
}

function filterNode(name: string, node: EditableEnvNode, term: string): EditableEnvNode | null {
  const nameMatch = name.toLowerCase().includes(term) ||
    (node.displayName?.toLowerCase().includes(term) ?? false);

  const matchingVars = node.variables.filter(
    (v) => v.key.toLowerCase().includes(term) || v.value.toLowerCase().includes(term)
  );

  // Recurse into children
  const filteredChildren: Record<string, EditableEnvNode> = {};
  for (const [childName, childNode] of Object.entries(node.children)) {
    const filtered = filterNode(childName, childNode, term);
    if (filtered) filteredChildren[childName] = filtered;
  }

  const hasChildMatches = Object.keys(filteredChildren).length > 0;
  const hasVarMatches = matchingVars.length > 0;

  if (!nameMatch && !hasVarMatches && !hasChildMatches) return null;

  return {
    ...node,
    // If the env name itself matches, keep all variables visible; otherwise only matching ones
    variables: nameMatch ? node.variables : matchingVars,
    children: nameMatch ? node.children : filteredChildren,
  };
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

  // Ensure the node exists in at least the public tree for structure.
  // Also force a public node when metadata flags are set so they are persisted.
  const hasMetadata = node.intermediate || node.displayName;
  const pub: YamlEnvNode | null =
    hasPubVars || hasPubChildren || hasMetadata || (!hasPrivVars && !hasPrivChildren)
      ? {
          ...(hasPubVars ? { variables: pubVars } : {}),
          ...(hasPubChildren ? { children: pubChildren } : {}),
          ...(node.intermediate ? { intermediate: true } : {}),
          ...(node.displayName ? { displayName: node.displayName } : {}),
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
