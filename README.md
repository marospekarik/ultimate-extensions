# Ultimate extensions

Personal extensions for [Ultimate](https://github.com/HazAT/ultimate), each installable on its own. They are user
extensions built on Ultimate's public extension API (facets, documents, actions, services and the `@/sdk`); none
changes Ultimate itself.

| Extension                         | What it does                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| [project-rail](project-rail)      | A rail of tiles at the window's left edge, one per running Ultimate project, grouped by machine.   |
| [pull-requests](pull-requests)    | Review and merge the project's open GitHub pull requests without leaving Ultimate.                 |
| [subscriptions](subscriptions)    | Claude, Ollama Cloud and Codex subscription usage in the Agent sidebar's Plans block.              |

Each extension's README lists what it needs and its settings. `pull-requests` needs the `gh` CLI logged in;
`subscriptions` reads usage through the providers' own logins and keys, which never leave the machine.

## Install

```shell
git clone https://github.com/marospekarik/ultimate-extensions ~/ultimate-extensions
mkdir -p ~/.ultimate/extensions
ln -s ~/ultimate-extensions/<name> ~/.ultimate/extensions/<name>
```

Ultimate loads a new user extension within seconds, in every project; no restart. Uninstall with
`rm ~/.ultimate/extensions/<name>` (it removes the link, not the clone).

## Update

```shell
git -C ~/ultimate-extensions pull
```

No restart: Ultimate reloads an extension when its files change.

## Licence

[Apache 2.0](LICENSE). Provided as is, without warranty.
