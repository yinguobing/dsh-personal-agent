# dsh-personal-agent

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of our team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> We have adapted it for publication, so it is not identical to our internal version or the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented in this prototype.

This fork keeps the prototype's architecture and turns it into a personal agent for one person, published as
`dsh-personal-agent`: https://github.com/yinguobing/dsh-personal-agent. In Chinese it is **搭档** — the person you work
alongside, who keeps the notes and runs the errands, and asks before deciding anything. The package name is the only renamed identifier: plugin ids, the `orchestrator` service and the
`orchestrator_*` tools still carry the prototype's names, so `git diff` against upstream stays readable.

dsh-superagent is a proactive coding agent for one GitHub repository, packaged as a bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/). It listens to GitHub and, optionally, Feishu. When someone allowed asks the agent for work, it opens a work item, works on it in its own agent session and directory, and answers in the original conversation, for example with a pull request. A web panel shows what needs a person.

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** An agent that can act for a whole team can also waste a whole team's attention, so it acts only when asked or when a rule the team wrote allows it, and speaks only when someone must act or can use a result. [docs/000-philosophy.md](docs/000-philosophy.md) explains the principle and what it asks of the operator.

## Install it as a personal agent

This fork turns the prototype into a personal agent for one person: talk to it in the panel or on WeChat, drop material
into a folder it watches, and it opens a work item only when you ask or a rule allows it.

From a clone, one command installs it into its own DSH profile and writes the settings it needs:

```sh
node scripts/install.mjs --profile personal --port 3082
```

From the release tarball, install the package and write that configuration yourself; `examples/profile.cordis.patch.yml`
is the configuration the script would have written:

```sh
dsh plugin --profile personal add \
  https://github.com/yinguobing/dsh-personal-agent/releases/download/v0.3.0/dsh-personal-agent-0.3.0.tgz
```

Installing straight from git is not supported: the build output is not committed, and pnpm asks for a per-commit
approval before it runs the build.

It creates the profile from the shipped web template, installs this bundle and the memory index, writes the settings
the agent needs (including worker permissions that never wait for an approval), and prints the command that starts it
and where its material folder is. Pass `--no-memory` to install without long-term memory. It cannot supply a model key: without `DEEPSEEK_API_KEY` in `<home>/.credentials.yaml` every turn
fails, and the installer says so.

The panel opens on a simple surface for the person — a conversation, the things in flight, and what the agent would
like to do — while the operator's tabs sit behind one toggle. Then read [docs/using.md](docs/using.md) for the first five minutes, [docs/memory.md](docs/memory.md) for how it
remembers things, and [docs/known-gaps.md](docs/known-gaps.md) for what is not yet solid. If something does not work, the gaps list is the honest inventory of where to look first.

## Setup

The rest of this file describes the prototype this fork started from. Its setup has many steps, so an agent does it
with you. Ask your coding agent:

> Read SETUP.md in this repository and set up dsh-superagent with me.

It asks one short question at a time, shows the full plan once, and then installs and configures everything. [SETUP.md](SETUP.md) is what it follows.

## Documentation

Read the numbered documents in order; each builds only on the ones before it.

- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md)
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md): manual setup, configuration, upgrades and troubleshooting
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md): adding a Source

## Development

`pnpm check` runs the typecheck, the tests and the build.

## License

[MIT](LICENSE)
