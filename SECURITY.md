# Security policy

## Supported version

Security fixes are applied to the latest release.

## Reporting

Do not open a public issue containing a vulnerability, token, vault excerpt, or
deployment URL. Use GitHub’s private vulnerability reporting for this
repository.

Include the affected version, impact, reproduction steps using synthetic data,
and a suggested mitigation if available.

## Deployment warning

This is a single-user application. Do not treat its bearer token as a
multi-tenant authorization system. Use TLS and an identity-aware proxy for
internet-facing deployments.
