type RequestRow = Record<string, unknown>
type EnvironmentOverrideRequest = Record<string, unknown> & {
  url?: unknown
  body?: unknown
  headers?: unknown
  params?: unknown
  path_params?: unknown
  binary?: unknown
  body_params?: unknown
  auth?: unknown
}

/**
 * Apply scenario-specific environment values to a built request.
 *
 * This operates only on the override map already supplied to the renderer; it
 * never reads the secure active environment. Auth values remain inside the
 * request and are passed directly to the secure executor without logging.
 */
export function applyEnvironmentOverrideToRequest(
  request: EnvironmentOverrideRequest,
  environment: Record<string, string>,
): EnvironmentOverrideRequest {
  const substitute = (text: string): string =>
    text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const key = varName.trim()
      return Object.prototype.hasOwnProperty.call(environment, key) ? environment[key] : match
    })
  const replaceRows = (rows: unknown, replaceKey = false): unknown =>
    Array.isArray(rows)
      ? rows.map((row: RequestRow) => ({
          ...row,
          ...(replaceKey && typeof row.key === 'string' ? { key: substitute(row.key) } : {}),
          value: typeof row.value === 'string' ? substitute(row.value) : row.value,
        }))
      : rows

  if (typeof request.url === 'string') request.url = substitute(request.url)
  if (typeof request.body === 'string') request.body = substitute(request.body)
  if (request.headers !== undefined) request.headers = replaceRows(request.headers, true)
  if (request.params !== undefined) request.params = replaceRows(request.params, true)
  if (request.path_params !== undefined) request.path_params = replaceRows(request.path_params, true)
  if (request.body_params !== undefined) request.body_params = replaceRows(request.body_params, true)

  if (typeof request.binary === 'string') {
    request.binary = substitute(request.binary)
  } else if (Array.isArray(request.binary)) {
    request.binary = request.binary.map((value: unknown) =>
      typeof value === 'string' ? substitute(value) : value,
    )
  }

  if (request.auth && typeof request.auth === 'object') {
    const auth = request.auth as Record<string, unknown>
    if (auth.config && typeof auth.config === 'object') {
      request.auth = {
        ...auth,
        config: Object.fromEntries(
          Object.entries(auth.config).map(([key, value]) => [
            key,
            typeof value === 'string' ? substitute(value) : value,
          ]),
        ),
      }
    }
  }

  return request
}
