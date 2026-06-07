import { describe, expect, it } from 'vitest';
import {
  getGqlQueryIndexAtPosInSection,
  resolveGraphQLBlocks,
} from './graphqlBlocks';

function mockDoc(
  nodes: Array<{ type: string; nodeSize: number }>,
): Parameters<typeof getGqlQueryIndexAtPosInSection>[0] {
  let offset = 0;
  const entries = nodes.map((node) => {
    const entry = { child: { type: { name: node.type }, nodeSize: node.nodeSize }, offset };
    offset += node.nodeSize;
    return entry;
  });
  return {
    forEach(fn) {
      for (const { child, offset: nodeOffset } of entries) {
        fn(child, nodeOffset);
      }
    },
  };
}

describe('resolveGraphQLBlocks', () => {
  it('pairs variables with the last gqlquery in a multi-request document', () => {
    const content = [
      { type: 'gqlquery', attrs: { uid: 'q1' } },
      { type: 'gqlvariables', attrs: { body: '{"a":1}' } },
      { type: 'request-separator', attrs: {} },
      { type: 'gqlquery', attrs: { uid: 'q2' } },
      { type: 'gqlvariables', attrs: { body: '{"b":2}' } },
      { type: 'request-separator', attrs: {} },
      { type: 'gqlquery', attrs: { uid: 'q3' } },
      { type: 'gqlvariables', attrs: { body: '{"c":3}' } },
    ];

    const { queryNode, variablesNode } = resolveGraphQLBlocks(content);
    expect(queryNode?.attrs?.uid).toBe('q3');
    expect(variablesNode?.attrs?.body).toBe('{"c":3}');
  });

  it('pairs variables with a specific gqlquery when activeQueryIndex is set', () => {
    const content = [
      { type: 'gqlquery', attrs: { uid: 'q1' } },
      { type: 'gqlvariables', attrs: { body: '{"a":1}' } },
      { type: 'gqlquery', attrs: { uid: 'q2' } },
      { type: 'gqlvariables', attrs: { body: '{"b":2}' } },
      { type: 'gqlquery', attrs: { uid: 'q3' } },
      { type: 'gqlvariables', attrs: { body: '{"c":3}' } },
    ];

    const { queryNode, variablesNode } = resolveGraphQLBlocks(content, 1);
    expect(queryNode?.attrs?.uid).toBe('q2');
    expect(variablesNode?.attrs?.body).toBe('{"b":2}');
  });

  it('finds variables before the query when listed above it', () => {
    const content = [
      { type: 'gqlvariables', attrs: { body: '{"x":9}' } },
      { type: 'gqlquery', attrs: { uid: 'only' } },
    ];
    const { variablesNode } = resolveGraphQLBlocks(content);
    expect(variablesNode?.attrs?.body).toBe('{"x":9}');
  });

  it('pairs variables with the middle gqlquery when scoped to that section', () => {
    const content = [
      { type: 'gqlquery', attrs: { uid: 'q2' } },
      { type: 'gqlvariables', attrs: { body: '{"b":2}' } },
    ];

    const { queryNode, variablesNode } = resolveGraphQLBlocks(content);
    expect(queryNode?.attrs?.uid).toBe('q2');
    expect(variablesNode?.attrs?.body).toBe('{"b":2}');
  });

  it('does not pair variables from a different query section', () => {
    const content = [
      { type: 'gqlquery', attrs: { uid: 'q1' } },
      { type: 'gqlvariables', attrs: { body: '{"first":true}' } },
      { type: 'gqlquery', attrs: { uid: 'q2' } },
      { type: 'gqlvariables', attrs: { body: '{"second":true}' } },
    ];

    const { queryNode, variablesNode } = resolveGraphQLBlocks(content);
    expect(queryNode?.attrs?.uid).toBe('q2');
    expect(variablesNode?.attrs?.body).toBe('{"second":true}');
  });

  it('returns the gqlquery index within a section for a cursor position', () => {
    const doc = mockDoc([
      { type: 'gqlquery', nodeSize: 4 },
      { type: 'gqlvariables', nodeSize: 3 },
      { type: 'gqlquery', nodeSize: 4 },
      { type: 'gqlvariables', nodeSize: 3 },
    ]);

    expect(getGqlQueryIndexAtPosInSection(doc, 9, 0)).toBe(1);
    expect(getGqlQueryIndexAtPosInSection(doc, 2, 0)).toBe(0);
    expect(getGqlQueryIndexAtPosInSection(doc, 2, 1)).toBeUndefined();
  });

  it('ignores gqlquery blocks outside the target section', () => {
    const doc = mockDoc([
      { type: 'gqlquery', nodeSize: 4 },
      { type: 'request-separator', nodeSize: 2 },
      { type: 'gqlquery', nodeSize: 4 },
    ]);

    expect(getGqlQueryIndexAtPosInSection(doc, 7, 1)).toBe(0);
    expect(getGqlQueryIndexAtPosInSection(doc, 2, 0)).toBe(0);
  });

  it('pairs the first query in a section when activeQueryIndex is 0', () => {
    const sectionContent = [
      { type: 'gqlquery', attrs: { uid: 'q2' } },
      { type: 'gqlvariables', attrs: { body: '{"b":2}' } },
      { type: 'gqlquery', attrs: { uid: 'q3' } },
      { type: 'gqlvariables', attrs: { body: '{"c":3}' } },
    ];

    const { queryNode, variablesNode } = resolveGraphQLBlocks(sectionContent, 0);
    expect(queryNode?.attrs?.uid).toBe('q2');
    expect(variablesNode?.attrs?.body).toBe('{"b":2}');
  });
});
