# Security Policy

## Supported Versions

The latest release receives security fixes. Public preview APIs may change before `1.0`.

## Reporting a Vulnerability

Please report security issues privately by emailing the maintainer or by opening a private GitHub security advisory if available for the repository.

Do not open public issues for vulnerabilities involving:

- credential leakage
- container escape or sandbox bypass
- limited-networking bypass
- authentication or token handling flaws
- arbitrary file read/write outside the intended workspace

## Secrets

Provider keys, `OPENCLAW_API_TOKEN`, `OPENCLAW_VAULT_KEY`, GitHub OAuth secrets, and Telegram bot tokens must be treated as secrets. The vault API accepts credential material on write but never returns it from read/list endpoints.
