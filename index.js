#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const Git = require('nodegit')

const { Command } = require('commander')
const packageJson = require(path.join(__dirname, './package.json'))

const NEW_REPO = path.resolve(__dirname, './ignore.test')
const SOURCE_REPO = '.'
const DEBUG = false

async function openOrInitRepo (repoPath) {
    if (DEBUG) console.log('openOrInitRepo()', repoPath)
    let repo
    if (!fs.existsSync(repoPath)) {
        if (DEBUG) console.log('openOrInitRepo() create repo', repoPath)
        await fs.promises.mkdir(repoPath, { recursive: true })
        repo = await Git.Repository.init(repoPath, 0)
    } else {
        if (DEBUG) console.log('openOrInitRepo() open existing repo', repoPath)
        repo = await Git.Repository.open(repoPath)
    }
    if (DEBUG) console.log('openOrInitRepo()', repoPath, 'done')
    return repo
}

async function reWriteFilesInRepo (repoPath, files) {
    if (DEBUG) console.log('reWriteFilesInRepo()', repoPath, files.length)

    // NOTE: we need to support rename case! if we rename from Index.js to index.js its equal to create Index.js and remove index.js
    //   And if your FS is ignore case you can create and delete the same file!
    const deleteFiles = files.filter(f => f.type === -1)
    for (const file of deleteFiles) {
        const filePath = path.join(repoPath, file.path)
        if (DEBUG) console.log('delete:', filePath)
        await fs.promises.rm(filePath, { force: true })
    }

    for (const file of files) {
        const filePath = path.join(repoPath, file.path)

        if (file.type === -1) { // delete file
            // NOTE: already processed
        } else if (file.type === 3) { // file Type
            const dirPath = path.dirname(filePath)
            const blob = await file.entry.getBlob()
            const buffer = blob.content()
            if (DEBUG) console.log('write:', filePath, blob.rawsize(), `mode:${file.filemode}`, JSON.stringify(blob.toString().substring(0, 90)))
            await fs.promises.mkdir(dirPath, { recursive: true })
            await writeFile(filePath, buffer, file.filemode)
        } else if (file.type === 1) { // submodule
            // NOTE: just skeep
            // TODO(pahaz): what we really should to do with submodules?
        } else {
            console.log('?', file.type, file.path)
        }
    }
    if (DEBUG) console.log('reWriteFilesInRepo()', repoPath, files.length, 'done')
}

async function getCommitHistory (repo) {
    const history = repo.history(Git.Revwalk.SORT.REVERSE)
    const result = []
    return new Promise((res, rej) => {
        history.on('commit', function (commit) {
            result.push({
                sha: commit.sha(),
                author: commit.author(),
                committer: commit.committer(),
                date: commit.date(),
                offset: commit.timeOffset(),
                message: commit.message(),
            })
        })

        history.on('end', function () {
            res(result)
        })

        history.on('error', function (error) {
            rej(error)
        })

        history.start()
    })
}

async function commitFiles (repo, author, committer, message, files) {
    const index = await repo.refreshIndex()

    for (const file of files) {
        if (file.type === 3) await index.addByPath(file.path)
        else if (file.type === -1) await index.removeByPath(file.path)
    }

    await index.write()

    const oid = await index.writeTree()

    const parent = await repo.getHeadCommit()
    const commitOid = await repo.createCommit('HEAD', author, committer, message, oid, (parent) ? [parent] : [])
    return commitOid.toString()
}

async function getTreeFiles (repo, hash, { withSubmodules, withDirectories } = {}) {
    if (DEBUG) console.log('getTreeFiles()', hash)

    const results = []
    const commit = await repo.getCommit(hash)
    const tree = await commit.getTree()

    function dfs (tree) {
        const promises = []

        for (const entry of tree.entries()) {
            if (entry.isDirectory()) {
                promises.push(entry.getTree().then(dfs))
                if (DEBUG && withDirectories) console.log('getTreeFiles() dir =', entry.path())
                if (withDirectories) results.push({
                    filemode: entry.filemode(),
                    type: entry.type(),
                    path: entry.path(),
                    entry,
                })
            } else if (entry.isFile()) {
                if (DEBUG) console.log('getTreeFiles() file =', entry.path())
                results.push({
                    filemode: entry.filemode(), // NOTE: '-rw-r--r--' = 33188
                    type: entry.type(),
                    path: entry.path(),
                    entry,
                })
            } else if (entry.isSubmodule()) {
                if (DEBUG && withSubmodules) console.log('getTreeFiles() submodule =', entry.path())
                if (withSubmodules) results.push({
                    filemode: entry.filemode(),
                    type: entry.type(),
                    path: entry.path(),
                    entry,
                })
            } else {
                console.log('WTF?', entry.type())
            }
        }

        return Promise.all(promises)
    }

    await dfs(tree)

    if (DEBUG) console.log('getTreeFiles()', hash, 'done')
    return results
}

async function writeFile (path, buffer, permission) {
    let fileDescriptor

    try {
        fileDescriptor = await fs.promises.open(path, 'w', permission)
    } catch (e) {
        console.error(e)
        await fs.promises.chmod(path, 33188)
        fileDescriptor = await fs.promises.open(path, 'w', permission)
    }

    if (fileDescriptor) {
        await fileDescriptor.write(buffer, 0, buffer.length, 0)
        await fileDescriptor.chmod(permission)
        await fileDescriptor.close()
    } else {
        throw new Error(`can't write file: ${path}`)
    }
}

async function main (config) {
    const options = {
        forceReCreateRepo: true,
        targetRepoPath: NEW_REPO,
        sourceRepoPath: SOURCE_REPO,
    }

    if (options.forceReCreateRepo && fs.existsSync(options.targetRepoPath)) {
        console.log('Remove existing repo:', options.targetRepoPath)
        await fs.promises.rmdir(options.targetRepoPath, { recursive: true, force: true })
    }

    const targetRepo = await openOrInitRepo(options.targetRepoPath)
    const sourceRepo = await Git.Repository.open(options.sourceRepoPath)
    const commits = await getCommitHistory(await sourceRepo.getMasterCommit())

    let commitIndex = 0
    const commitLength = commits.length

    for (const commit of commits) {

        console.log(`Processing: ${++commitIndex}/${commitLength}`, commit.sha)

        const files = await getTreeFiles(sourceRepo, commit.sha)
        await reWriteFilesInRepo(NEW_REPO, files)
        await commitFiles(targetRepo, commit.author, commit.committer, commit.message, files)

    }
}

const program = new Command()
program
    .version(packageJson.version)
    .argument('<config-path>', 'json config path')
    .description(packageJson.description)
    .action(main)
    .parseAsync(process.argv)
