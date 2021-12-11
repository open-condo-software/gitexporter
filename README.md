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

# GITHUB ACTIONS CI EXAMPLE

 1. create a new user: `sync-bot`
 2. add new user ssh keys `SSH_SYNC_BOT_PRIVATE_KEY`: https://github.com/settings/keys
 3. add the user to `org/private` and `org/open` repo
 4. add `SSH_SYNC_BOT_PRIVATE_KEY` to `org/private` repo
 5. add CI files to `org/private` repo:

`.github/workflows/gitexporter.yml`
```yaml
name: gitexporter
on:
  push:
    branches:
      - 'master'

jobs:
  gitexporter:
    name: Gitexporter
    runs-on: self-hosted
    steps:
      - name: Checkout
        uses: actions/checkout@v2
        with:
          ssh-key: ${{ secrets.SSH_SYNC_BOT_PRIVATE_KEY }}
      - name: Checkout org/private
        uses: actions/checkout@v2
        with:
          repository: 'org/private'
          fetch-depth: 0
          submodules: recursive
          ssh-key: ${{ secrets.SSH_SYNC_BOT_PRIVATE_KEY }}
          path: gitexporter.source
          ref: 'master'
      - name: Checkout org/open
        uses: actions/checkout@v2
        with:
          repository: 'org/open'
          fetch-depth: 0
          submodules: recursive
          ssh-key: ${{ secrets.SSH_SYNC_BOT_PRIVATE_KEY }}
          path: gitexporter.target
          ref: 'master'
      - name: gitexporter.sh
        run: |
          bash .github/workflows/gitexporter.sh gitexporter.source gitexporter.target
          cat gitexporter.source.log.json
```
`.github/workflows/gitexporter.sh`
```bash
#!/usr/bin/env bash
set -eo pipefail

if [[ -z "$1" || -z "$2" ]]; then
  echo "use $0 <source-git-repo> <target-git-repo>"
  exit 2
fi

SOURCE_FOLDER=$1
TARGET_FOLDER=$2

echo "[GITEXPORTER]"
cat > ${SOURCE_FOLDER}.config.json <<EOF
{
  "forceReCreateRepo": false,
  "followByNumberOfCommits": true,
  "syncAllFilesOnLastFollowCommit": true,
  "logFilePath": "${SOURCE_FOLDER}.log.json",
  "targetRepoPath": "${TARGET_FOLDER}",
  "sourceRepoPath": "${SOURCE_FOLDER}",
  "allowedPaths": [
    "*"
  ],
  "ignoredPaths": [
    "secret/*"
  ]
}
EOF

npx gitexporter ${SOURCE_FOLDER}.config.json

echo "[TARGET/SETUP]"
cd ${TARGET_FOLDER}
git branch -D master || echo "no branch master"
git checkout -B master $(git rev-parse HEAD)
echo "[TARGET/PUSH]"
git push origin master
cd -
echo "[END]"
```
