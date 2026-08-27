# Development-only data-plane configuration

Compose uses this directory only when `WENYOUSITE_SECRETS_DIR` is unset. It
keeps local development compatible and deliberately does not contain a real
credential. Empty Redis password files keep the development-only `default`
ACL user passwordless; the two `wenyou` PostgreSQL files are local defaults.
Public deployment must point `WENYOUSITE_SECRETS_DIR` at the
root-managed directory created from `ops/secrets/*.example`; the production
preflight rejects this directory.
