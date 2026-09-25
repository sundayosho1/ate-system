# Security Baseline

Prompt 1 establishes baseline security rules and repository protections. Full enterprise security,
authentication, RBAC, and production hardening are future scope.

## Secret policy

Never commit, print, log, echo, hard-code, or expose:

- GitHub passwords or tokens;
- MT5 passwords;
- broker credentials;
- database passwords;
- API keys;
- private keys;
- production secrets;
- third-party credentials.

`.env.example` may contain placeholders only. Secret-bearing `.env` files are ignored.

## If a secret is discovered

1. Do not reproduce the value.
2. Identify the affected file safely.
3. Remove the secret where safe within scope.
4. Recommend credential rotation.
5. Add ignore rules or tests to reduce recurrence.

## Repository controls

Prompt 1 adds:

- `.gitignore` rules for common secret/runtime files;
- placeholder-only `.env.example`;
- `npm run security:secrets` tracked-file hygiene scanning;
- documentation forbidding secret logging and frontend exposure.

## Secure configuration principles

Future configuration must:

- distinguish secret from non-secret values;
- avoid exposing secrets in APIs/UI/logs;
- validate before activation;
- support least privilege;
- be auditable for sensitive changes;
- be environment-aware.

## Least privilege

Future services, users, execution nodes, integrations, and API credentials should receive only the
permissions they require.

## Future RBAC expectation

Future prompts must implement authentication and authorization before exposing sensitive controls.
Risk/protection/execution/configuration changes require strong authorization and audit trails.

## Dependency vulnerability approach

Dependencies should be mature, maintained, minimal, versioned, and monitored. Use `npm audit` or an
equivalent tool as the stack evolves. Do not add obscure libraries for safety-critical behavior
without justification.

## No-secret logging standard

Logs may include identifiers, correlation IDs, error categories, and safe metadata. Logs must not
include secrets, credentials, private keys, full tokens, or sensitive account authentication
material.

## Persistence security baseline

Persistence diagnostics and errors must not expose database passwords, raw credential-bearing
connection strings, private keys, tokens, certificates or filesystem secrets.

SQL execution must use parameterized statements or safe bindings. Application modules must not
accept arbitrary untrusted raw SQL as a persistence API.

Future production database roles should follow least privilege. Ordinary runtime operation should
not require unrestricted database superuser access; migration privileges may be separated from
runtime privileges.

Audit and history APIs must not expose ordinary update/delete operations. Retention, archival and
purge policies belong to future governance prompts.

## Security reporting guidance

Security findings should identify affected files/components without reproducing secret values.
Credential exposure should be treated as a rotation event.
