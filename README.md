# gitexporter cli tool

You have an open source project with an open and closed part. 
You are developing it in a git mono repository and don't want to use git submodules for closed part.

Use git exporter to create a new git repo from your privat git repo with only allowed public files and dirs.

Example:

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

Just run `gitexporter gitexporter.config.json` and you will get a new git repository with just `apps/service1` directory.

## how it works ?

The `gitexporter` goes through the commit tree and adds only the allowed files there.
