export type { SecureAuthProvider, SecureAuthApplyContext, SecureAuthApplyResult } from './types.js'
export { SecureAuthProviderRegistry, secureAuthProviders } from './registry.js'

import { secureAuthProviders } from './registry.js'
import { awsSigV4Provider } from './awsSigV4Provider.js'

secureAuthProviders.register(awsSigV4Provider)
