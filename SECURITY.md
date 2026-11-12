# Security

Report vulnerabilities [privately on GitHub](https://github.com/Ranklywin/rankly-tweaks/security/advisories/new).
Include the affected version, impact, and steps to reproduce in a test environment.
Do not post secrets or exploit details in public issues.

Security fixes target the latest release. The installer is not yet
Authenticode-signed; checksums verify file integrity and do not replace code
signing. In-app updates install only after their signature is verified with
the public key built into Rankly.
