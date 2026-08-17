import type { SecureAuthProvider } from './types.js'

export class SecureAuthProviderRegistry {
  private readonly providers = new Map<string, SecureAuthProvider>()

  register(provider: SecureAuthProvider): void {
    for (const authType of provider.authTypes) {
      const existing = this.providers.get(authType)
      if (existing) {
        throw new Error(
          `Secure auth provider for type "${authType}" is already registered (${existing.id}); cannot register ${provider.id}`,
        )
      }
      this.providers.set(authType, provider)
    }
  }

  getForAuthType(type: string | undefined): SecureAuthProvider | undefined {
    return type ? this.providers.get(type) : undefined
  }
}

/** Process-wide registry. Built-ins are registered as a side effect of importing './index.js'. */
export const secureAuthProviders = new SecureAuthProviderRegistry()
