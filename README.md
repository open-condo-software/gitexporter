[![npm status](https://img.shields.io/npm/v/gitexporter?color=%2332c954&label=gitexporter&logo=gitexporter&logoColor=%23414851)](https://www.npmjs.com/package/gitexporter) [![gitexporter test status](https://github.com/open-condo-software/gitexporter/actions/workflows/node.js.yml/badge.svg?branch=master)](https://github.com/open-condo-software/gitexporter)

# gitexporter cli tool

You're in the right place if:

 - Do you have an **open-source** project with an **open** and **closed part** and you want to **work in one git repo** without git submodules?
 - Do you want to **public** some **private** GitHub **repo directories**?
 - You want to **keep** the **authorship** and **history** of the **comments**
 - You don't want to use git submodules

Others cases:

 - You are developing in a git mono repository and want to open-source some directories
 - You are developing some OpenSource project and want to disallow open some secret files

# how it works ?

`gitexporter` create a new git repo from your existing repository with only allowed public files and dirs.

The `gitexporter` goes through the git commit tree and adds to a new repo only the allowed files.

# Example

 - `/` -- monorepository root
 - `/apps/service1` -- it's open source
 - `/apps/optional-secure-service2` -- it's closed source
 - `/gitexporter.config.json` -- git exporter config file

`gitexporter.config.json`
```
{
    "forceReCreateRepo": true,
    "targetRepoPath": "my-open-source-repo",
    "sourceRepoPath": ".",
    "allowedPaths": ["apps/service1/*"],
    "ignoredPaths": ["apps/service1/.env", "apps/optional-secure-service2", "gitexporter.config.json"]
}
```

Just run `npx gitexporter gitexporter.config.json` and you will get a new git repository with just `apps/service1` directory.
