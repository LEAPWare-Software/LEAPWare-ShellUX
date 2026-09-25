# LEAPWare ShellUX

**New session? Read [HANDOFF.md](HANDOFF.md) first.**

ShellUX is a desktop shell for LEAPWare's operators, and its mission is to be **the
best-in-class interface for hosting application plugins**. An operator keeps one
window open for a shift. Plugins supply the work (inventory, mail, shipments,
anything else); the shell owns every pixel around it: three resizable panes, a
command palette that drives everything from the keyboard, and one consistent way of
showing state. The host owns zero business logic.

"Best in class" is a bar, not an adjective. It is measured against VS Code, Linear,
Raycast and Outlook/Teams, and the measurements are listed in
[`docs/plans/v1-production.md`](docs/plans/v1-production.md). Until they are met and
measured, this README does not claim them.

License: [Apache-2.0](LICENSE), with a [`NOTICE`](NOTICE) (decision D-42).

**Pre-release**, version `0.1.0`, no tag. Screen-reader support is **not done** and
is a 1.1 item (D-37). The full status table is in
[`docs/readme-body.md`](docs/readme-body.md).

## Installing

Packaging and install steps for an operator are in
[`docs/INSTALL.md`](docs/INSTALL.md) (Step 7). There is no release yet — see
[`docs/readme-body.md`](docs/readme-body.md) for the current pre-release status.

## Developing

```bash
npm ci && npm run verify
```

That is the gate; see [`CONTRIBUTING.md`](CONTRIBUTING.md) for what it runs.

The full status table, the shell diagram and the detailed getting-started steps
that used to live directly in this README are now in
[`docs/readme-body.md`](docs/readme-body.md).

## Documentation

| Question | Read |
|---|---|
| What is decided, and what is still open | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| The plan to 1.0, and the bar "best in class" is measured against | [`docs/plans/v1-production.md`](docs/plans/v1-production.md) |
| How work moves from design to release, under BuildCraft | [`docs/sdlc.md`](docs/sdlc.md) |
| Who this is for and what it must not look like | [`PRODUCT.md`](PRODUCT.md) |
| The visual system: type, colour, planes, components | [`DESIGN.md`](DESIGN.md) |
| Writing a plugin | [`DEVELOPER.md`](DEVELOPER.md), then `plugins/hello/src/HelloExtension.tsx` |
| What the shell does, in detail | [`docs/overview.md`](docs/overview.md) |
| What is and is not a security control here | [`docs/security-posture.md`](docs/security-posture.md) and [`SECURITY.md`](SECURITY.md) |
| Accessibility, and what is not done | [`docs/accessibility.md`](docs/accessibility.md) |
| Testing, coverage and the browser lane | [`docs/testing.md`](docs/testing.md) |
| Performance targets (unmeasured) | [`docs/performance.md`](docs/performance.md) |
| Cutting a release | [`docs/RELEASE.md`](docs/RELEASE.md) |
| Installing the packaged app as an operator (per-user, SmartScreen, logs, updates) | [`docs/INSTALL.md`](docs/INSTALL.md) |
| Why it is built this way | [`docs/adr/`](docs/adr/) |
| What changed, and what made each defect possible | [`CHANGELOG.md`](CHANGELOG.md) |
| This README before 2026-09-18 | [`docs/history/readme-status-2026-08.md`](docs/history/readme-status-2026-08.md) |
| The old README's full status table, diagram and getting-started detail | [`docs/readme-body.md`](docs/readme-body.md) |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Every change states what it did not do,
lands its documentation in the same commit, and is reviewed adversarially before it
merges.

## Security

Report a vulnerability as [`SECURITY.md`](SECURITY.md) describes. Do not open a
public issue for one.
