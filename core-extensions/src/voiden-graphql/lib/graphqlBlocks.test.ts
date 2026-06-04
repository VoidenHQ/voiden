import { describe, expect, it } from 'vitest';
import { resolveGraphQLBlocks } from './graphqlBlocks';

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

  it('finds variables before the query when listed above it', () => {
    const content = [
      { type: 'gqlvariables', attrs: { body: '{"x":9}' } },
      { type: 'gqlquery', attrs: { uid: 'only' } },
    ];
    const { variablesNode } = resolveGraphQLBlocks(content);
    expect(variablesNode?.attrs?.body).toBe('{"x":9}');
  });
});
