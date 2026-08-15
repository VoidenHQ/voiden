import { describe, expect, it } from 'vitest'
import { mergeRequestHandlerResult } from '../src/requestComposition.js'

type Handler = (request: Record<string, unknown>) => Record<string, unknown> | null | undefined

function runHandlers(handlers: Handler[]): Record<string, unknown> {
  return handlers.reduce(
    (request, handler) => mergeRequestHandlerResult(request, handler(request)),
    {},
  )
}

const authHandler: Handler = request => ({
  ...request,
  auth: {
    enabled: true,
    type: 'aws-signature',
    config: { region: 'us-east-1', service: 'execute-api' },
  },
})

const restHandlerReturningFreshObject: Handler = () => ({
  method: 'GET',
  url: 'https://example.amazonaws.com/resource',
  headers: [{ key: 'Accept', value: 'application/json' }],
})

describe('request handler composition', () => {
  it.each([
    ['auth then REST', [authHandler, restHandlerReturningFreshObject]],
    ['REST then auth', [restHandlerReturningFreshObject, authHandler]],
  ])('preserves auth in the final request for %s registration order', (_name, handlers) => {
    expect(runHandlers(handlers).auth).toEqual({
      enabled: true,
      type: 'aws-signature',
      config: { region: 'us-east-1', service: 'execute-api' },
    })
  })

  it('uses a declared array contribution without concatenating prior entries', () => {
    const previous = { headers: [{ key: 'First', value: 'one' }], auth: { type: 'aws-signature' } }
    const contribution = { headers: [{ key: 'Final', value: 'two' }] }

    expect(mergeRequestHandlerResult(previous, contribution)).toEqual({
      headers: [{ key: 'Final', value: 'two' }],
      auth: { type: 'aws-signature' },
    })
  })

  it.each([null, undefined])('treats a %s handler result as no contribution', result => {
    const previous = { method: 'GET', auth: { type: 'aws-signature' } }

    expect(mergeRequestHandlerResult(previous, result)).toBe(previous)
  })
})
