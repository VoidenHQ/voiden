export interface GraphQLContentNode {
  type?: string;
  text?: string;
  attrs?: { body?: string; [key: string]: unknown };
  content?: GraphQLContentNode[];
}

export interface GraphQLBlockPair {
  queryNode: GraphQLContentNode | undefined;
  variablesNode: GraphQLContentNode | undefined;
  /** 0-based index among gqlvariables blocks in content */
  variablesOrdinal?: number;
}

/**
 * Pair gqlvariables with a specific gqlquery in the active request context.
 *
 * When activeQueryIndex is provided, selects that gqlquery (0-based among all
 * gqlquery blocks in content). Otherwise uses the last gqlquery — the typical
 * target when multiple queries share a section without separators.
 */
export function resolveGraphQLBlocks(
  content: GraphQLContentNode[] | undefined,
  activeQueryIndex?: number,
): GraphQLBlockPair {
  if (!content?.length) {
    return { queryNode: undefined, variablesNode: undefined };
  }

  const queryIndices: number[] = [];
  content.forEach((node, index) => {
    if (node.type === 'gqlquery') {
      queryIndices.push(index);
    }
  });

  if (queryIndices.length === 0) {
    return { queryNode: undefined, variablesNode: undefined };
  }

  let contentIndex: number;
  if (
    activeQueryIndex !== undefined &&
    activeQueryIndex >= 0 &&
    activeQueryIndex < queryIndices.length
  ) {
    contentIndex = queryIndices[activeQueryIndex];
  } else {
    contentIndex = queryIndices[queryIndices.length - 1];
  }

  const queryNode = content[contentIndex];
  let variablesNode: GraphQLContentNode | undefined;

  for (let i = contentIndex + 1; i < content.length; i++) {
    if (content[i].type === 'gqlquery') break;
    if (content[i].type === 'gqlvariables') {
      variablesNode = content[i];
      break;
    }
  }

  if (!variablesNode) {
    for (let i = contentIndex - 1; i >= 0; i--) {
      if (content[i].type === 'gqlquery') break;
      if (content[i].type === 'gqlvariables') {
        variablesNode = content[i];
        break;
      }
    }
  }

  let variablesOrdinal: number | undefined;
  if (variablesNode) {
    let ordinal = 0;
    for (const node of content) {
      if (node.type === 'gqlvariables') {
        if (node === variablesNode) {
          variablesOrdinal = ordinal;
          break;
        }
        ordinal++;
      }
    }
  }

  return { queryNode, variablesNode, variablesOrdinal };
}

/**
 * Return the 0-based index of the gqlquery block containing doc position `pos`.
 */
export function getGqlQueryIndexAtPos(
  doc: { forEach: (fn: (child: { type: { name: string }; nodeSize: number }, offset: number) => void) => void },
  pos: number,
): number | undefined {
  let queryIndex = 0;
  let activeIndex: number | undefined;

  doc.forEach((child, offset) => {
    if (child.type.name !== 'gqlquery') return;

    const nodeStart = offset + 1;
    const nodeEnd = nodeStart + child.nodeSize;
    if (pos >= nodeStart && pos < nodeEnd) {
      activeIndex = queryIndex;
    }
    queryIndex++;
  });

  return activeIndex;
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
