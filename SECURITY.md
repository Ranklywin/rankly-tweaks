# Security

Security fixes target the latest public release. Rankly can modify Windows settings
with administrator access, so allowlists, support checks, IPC boundaries, and
recovery validation are security-sensitive.

Use the repository's **Security → Report a vulnerability** private reporting option
when available. If it is unavailable, open an issue asking the maintainer for a
private reporting channel without including exploit details. Do not post secrets,
personal system reports, recovery journals, or working privilege-escalation
payloads in a public issue.

Include affected versions, impact, reproduction steps using a disposable VM or
isolated fixture, and suggested mitigations. Do not test against other people's
systems. There is no guaranteed response time or bug bounty.

Release executables are currently unsigned. SHA-256 checksums identify release
files but do not replace code signing or establish that a program is safe.
