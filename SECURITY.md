# Security Policy

## Supported versions

Security fixes are applied to the **latest release on `master`** (and the matching GitHub Release tag). Older tags are not backported unless a critical issue warrants an exceptional patch.

| Version | Supported |
|---------|-----------|
| Latest `master` / newest Release | Yes |
| Older tags | No |

## Scope

Style Grid is a **local WebUI extension**: it runs inside your Stable Diffusion host process (Forge / reForge / A1111) and serves its UI from that same origin. By design it has **no network authentication**, no cloud account, and no remote admin API. Typical data stays on the local machine (`data/`, style CSVs, thumbnails).

Reports that assume a multi-tenant SaaS threat model (account takeover, OAuth, etc.) are out of scope unless they demonstrate impact on this local-tool architecture (for example, cross-origin message abuse against the Gradio origin, or path traversal that escapes the extension’s intended directories).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately via one of:

1. **GitHub Security Advisories** — [Report a vulnerability](https://github.com/KazeKaze93/sd-webui-style-organizer/security/advisories/new) on this repository (preferred).
2. **Email** — contact the repository owner through the address listed on their [GitHub profile](https://github.com/KazeKaze93).

Include:

- Affected extension version (git tag or commit) and host build (Forge / reForge / A1111 + version)
- Impact and a minimal reproduction
- Whether a fix or workaround is already known

You should receive an acknowledgement within a few days. Please give a reasonable window before any public disclosure.
