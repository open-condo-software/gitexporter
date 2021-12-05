#!/usr/bin/env bash

VERSION=$(node index.js --version)

git tag -a v${VERSION} -m "Publish ${VERSION}"
npm publish
git push --tags origin master
