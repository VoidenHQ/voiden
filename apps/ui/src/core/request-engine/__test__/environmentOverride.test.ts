import { describe, expect, it } from 'vitest'
import { applyEnvironmentOverrideToRequest } from '../environmentOverride'

describe('request orchestrator environment override', () => {
  it('substitutes AWS auth config without exposing it through headers or logs', () => {
    const request = {
      url: 'https://{{HOST}}/resource',
      auth: {
        enabled: true,
        type: 'aws-signature',
        config: {
          accessKey: '{{AWS_ACCESS_KEY}}',
          secretKey: '{{AWS_SECRET_KEY}}',
          sessionToken: '{{AWS_SESSION_TOKEN}}',
          region: '{{AWS_REGION}}',
          service: '{{AWS_SERVICE}}',
          nonStringOption: true,
        },
      },
    }

    applyEnvironmentOverrideToRequest(request, {
      HOST: 'example.amazonaws.com',
      AWS_ACCESS_KEY: 'access-key',
      AWS_SECRET_KEY: 'secret-key',
      AWS_SESSION_TOKEN: 'session-token',
      AWS_REGION: 'us-east-1',
      AWS_SERVICE: 'execute-api',
    })

    expect(request).toEqual({
      url: 'https://example.amazonaws.com/resource',
      auth: {
        enabled: true,
        type: 'aws-signature',
        config: {
          accessKey: 'access-key',
          secretKey: 'secret-key',
          sessionToken: 'session-token',
          region: 'us-east-1',
          service: 'execute-api',
          nonStringOption: true,
        },
      },
    })
  })
})
