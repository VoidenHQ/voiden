import { assertNoUnresolvedTemplates } from '../unresolvedVariables.js'
import { assertS3PathIsFetchSafe, signAwsRequest, type AwsSigV4Config } from '../awsSigV4.js'
import type { RequestAuth } from '../pipeline/types.js'
import type { SecureAuthApplyContext, SecureAuthApplyResult, SecureAuthProvider } from './types.js'

const AWS_SERVICE_ALIASES: Record<string, string> = {
  cloudwatch: 'monitoring',
}

const SENSITIVE_HEADERS = ['Authorization', 'X-Amz-Security-Token']

async function resolveConfig(
  auth: RequestAuth,
  resolveVar: (text: string) => Promise<string>,
): Promise<AwsSigV4Config> {
  const raw = (auth.config ?? {}) as Record<string, unknown>
  const resolve = async (camelCase: string, snakeCase?: string): Promise<string> => {
    const value = raw[camelCase] ?? (snakeCase ? raw[snakeCase] : undefined) ?? ''
    return resolveVar(String(value))
  }

  const accessKey = (await resolve('accessKey', 'access_key')).trim()
  const secretKey = (await resolve('secretKey', 'secret_key')).trim()
  const sessionToken = (await resolve('sessionToken', 'session_token')).trim()
  const region = (await resolve('region')).trim().toLowerCase()
  const rawService = raw.service ?? raw.signingService ?? raw.signing_service ?? ''
  const requestedService = (await resolveVar(String(rawService))).trim().toLowerCase()
  const service = AWS_SERVICE_ALIASES[requestedService] ?? requestedService

  assertNoUnresolvedTemplates([accessKey, secretKey, sessionToken, region, service])

  const missing = [
    !accessKey && 'access key',
    !secretKey && 'secret key',
    !region && 'region',
    !service && 'signing service',
  ].filter(Boolean)
  if (missing.length > 0) {
    throw new Error(`AWS SigV4 configuration is missing: ${missing.join(', ')}`)
  }
  return { accessKey, secretKey, sessionToken: sessionToken || undefined, region, service }
}

export const awsSigV4Provider: SecureAuthProvider = {
  id: 'AWS SigV4',
  authTypes: ['aws-signature', 'awsSignature'],
  forcesManualRedirect: true,
  supportsMultipartBody: false,
  resolveConfig,
  validateUrl(url, config) {
    assertS3PathIsFetchSafe(url, (config as AwsSigV4Config).service)
  },
  apply(context: SecureAuthApplyContext): SecureAuthApplyResult {
    signAwsRequest({
      method: context.method,
      url: context.url,
      headers: context.headers,
      payload: context.payload,
      config: context.config as AwsSigV4Config,
      now: context.now(),
    })
    return { redirect: 'manual', sensitiveHeaders: SENSITIVE_HEADERS }
  },
}
