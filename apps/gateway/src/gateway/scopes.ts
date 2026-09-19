import { errors } from '../errors.js';
import type { Principal } from './keyResolver.js';

/**
 * Key scopes. Operators are NOT a key scope: administration uses the separate admin token.
 *
 *  - media   : resolve, download, jobs, usage, account
 *  - keys    : manage this account's keys and create link codes (may grant any customer scope)
 *  - recover : only exchange itself for a new device key (the offline recovery code)
 */
export const CUSTOMER_SCOPES = ['media', 'keys', 'recover'] as const;
export type Scope = (typeof CUSTOMER_SCOPES)[number];

/** What a normal personal device key is allowed to do. */
export const DEVICE_SCOPES: Scope[] = ['media', 'keys'];

export function isScope(value: string): value is Scope {
  return (CUSTOMER_SCOPES as readonly string[]).includes(value);
}

export function requireScope(principal: Principal | null, scope: Scope): void {
  if (!principal) throw errors.unauthorized();
  if (!principal.scopes.includes(scope)) {
    throw errors.forbidden('insufficient_scope', `This key cannot do that: it needs the "${scope}" scope.`);
  }
}
