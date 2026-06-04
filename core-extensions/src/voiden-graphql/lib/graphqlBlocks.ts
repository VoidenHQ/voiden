export interface GraphQLContentNode {
  type?: string;
  attrs?: { body?: string; [key: string]: unknown };
  content?: GraphQLContentNode[];
}

export interface GraphQLBlockPair {
  queryNode: GraphQLContentNode | undefined;
  variablesNode: GraphQLContentNode | undefined;
}

/**
 * Pair gqlvariables with the last gqlquery in the active section.
 */
export function resolveGraphQLBlocks(
  content: GraphQLContentNode[] | undefined,
): GraphQLBlockPair {
  if (!content?.length) {
    return { queryNode: undefined, variablesNode: undefined };
  }

  const queries = content.filter((n) => n.type === 'gqlquery');
  if (queries.length === 0) {
    return { queryNode: undefined, variablesNode: undefined };
  }

  const queryNode = queries[queries.length - 1];
  const qIdx = content.indexOf(queryNode);
  let variablesNode: GraphQLContentNode | undefined;

  for (let i = qIdx + 1; i < content.length; i++) {
    if (content[i].type === 'gqlquery') break;
    if (content[i].type === 'gqlvariables') {
      variablesNode = content[i];
      break;
    }
  }

  if (!variablesNode) {
    for (let i = qIdx - 1; i >= 0; i--) {
      if (content[i].type === 'gqlquery') break;
      if (content[i].type === 'gqlvariables') {
        variablesNode = content[i];
        break;
      }
    }
  }

  return { queryNode, variablesNode };
}

export function parseGraphQLVariablesBody(
  body: string | undefined,
): Record<string, unknown> {
  if (!body?.trim()) return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
