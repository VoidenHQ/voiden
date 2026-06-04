import type { JSONContent } from "@tiptap/core";

export interface GraphQLBlockPair {
  queryNode: JSONContent | undefined;
  variablesNode: JSONContent | undefined;
}

/**
 * Resolve the GraphQL query and variables blocks for the active request section.
 * When multiple requests exist in one document, pairs variables with the
 * last gqlquery in the scoped content (the section being executed).
 */
export function resolveGraphQLBlocks(content: JSONContent[] | undefined): GraphQLBlockPair {
  if (!content?.length) {
    return { queryNode: undefined, variablesNode: undefined };
  }

  const queries = content.filter((n) => n.type === "gqlquery");
  if (queries.length === 0) {
    return { queryNode: undefined, variablesNode: undefined };
  }

  const queryNode = queries[queries.length - 1];
  const qIdx = content.indexOf(queryNode);
  let variablesNode: JSONContent | undefined;

  for (let i = qIdx + 1; i < content.length; i++) {
    if (content[i].type === "gqlquery") break;
    if (content[i].type === "gqlvariables") {
      variablesNode = content[i];
      break;
    }
  }

  if (!variablesNode) {
    for (let i = qIdx - 1; i >= 0; i--) {
      if (content[i].type === "gqlquery") break;
      if (content[i].type === "gqlvariables") {
        variablesNode = content[i];
        break;
      }
    }
  }

  return { queryNode, variablesNode };
}

export function parseGraphQLVariablesBody(body: string | undefined): Record<string, unknown> {
  if (!body?.trim()) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
