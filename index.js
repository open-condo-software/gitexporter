#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const Git = require('nodegit')
const ignore = require('ignore')

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

async function getDiffFiles (repo, hash) {
    if (DEBUG) console.log('getDiffFiles()', hash)

    const results = []
    const commit = await repo.getCommit(hash)
    const tree = await commit.getTree()

    const diffList = await commit.getDiff()
    for (const diff of diffList) {
        const patches = await diff.patches()
        for (const patch of patches) {
            const oldFile = patch.oldFile()
            const oldFilePath = oldFile.path()
            const oldFileMode = oldFile.mode()
            const newFile = patch.newFile()
            const newFilePath = newFile.path()
            const newFileMode = newFile.mode()
            const changeMode = newFileMode !== oldFileMode && !patch.isAdded() && !patch.isDeleted()
            const changePath = newFilePath !== oldFilePath
            const status = patch.status()
            const statusString = (status === 1) ? 'C' : (status === 2) ? 'D' : (status === 3) ? 'U' : '?'
            const mode = (patch.isAdded()) ? newFileMode : oldFileMode
            if (changePath || DEBUG) console.log(
                statusString, patch.size(), patch.isAdded(), patch.isModified(), patch.isDeleted(), patch.isRenamed(), patch.isCopied(), patch.isTypeChange(), patch.isConflicted(), patch.isUnreadable(), patch.isIgnored(), patch.isUntracked(), patch.isUnmodified(),
                oldFilePath, mode, changeMode ? newFileMode : '-', changePath ? newFilePath : '-', patch.lineStats(),
            )

            if (status === 1) {
                const entry = await tree.getEntry(newFilePath)
                results.push({
                    filemode: newFileMode,
                    type: entry.type(),
                    path: newFilePath,
                    entry,
                })
            } else if (status === 2) {
                results.push({
                    filemode: 0,
                    type: -1,
                    path: oldFilePath,
                    entry: undefined,
                })
            } else if (status === 3) {
                const entry = await tree.getEntry(newFilePath)
                results.push({
                    filemode: newFileMode,
                    type: entry.type(),
                    path: newFilePath,
                    entry,
                })
            }
        }
    }

    if (DEBUG) console.log('getDiffFiles()', hash, 'done')
    return results
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

function prepareLogData (commits) {
    const result = []
    for (const { date, sha, newSha, author, committer, processing, message } of commits) {
        if (!processing) break
        const { tX, dt, paths, ignoredPaths, allowedPaths, index } = processing
        result.push({
            index,
            date, sha, newSha, tX, dt, paths, ignoredPaths, allowedPaths,
            message: message.substring(0, 200),
            author: {
                name: author.name(),
                email: author.email(),
            },
            committer: {
                name: committer.name(),
                email: committer.email(),
            },
        })
    }

    return result
}

async function writeLogData (logFilePath, commits, filePaths, ignoredPaths) {
    await fs.promises.writeFile(logFilePath, JSON.stringify({
        commits: prepareLogData(commits),
        paths: [...filePaths],
        ignoredPaths: [...ignoredPaths],
    }, null, 2))
}

async function stash (repo) {
    const sig = await Git.Signature.create('GIT EXPORTER JS', 'gitexporter@example.com', 123456789, 60)
    try {
        await Git.Stash.save(repo, sig, 'our stash', 0)
    } catch (e) {
        console.error('stash:', e)
    }
}

async function main () {
    const options = {
        forceReCreateRepo: true,
        targetRepoPath: NEW_REPO,
        sourceRepoPath: '.',
        logFilePath: NEW_REPO + '.log.json',
    }

    const time0 = Date.now()

    if (options.forceReCreateRepo && fs.existsSync(options.targetRepoPath)) {
        console.log('Remove existing repo:', options.targetRepoPath)
        await fs.promises.rmdir(options.targetRepoPath, { recursive: true, force: true })
    }

    const targetRepo = await openOrInitRepo(options.targetRepoPath)
    await stash(targetRepo)

    const sourceRepo = await Git.Repository.open(options.sourceRepoPath)
    const commits = await getCommitHistory(await sourceRepo.getMasterCommit())

    let commitIndex = 0
    const commitLength = commits.length

    let time1 = Date.now()
    let time2 = Date.now()
    for (const commit of commits) {

        console.log(`Processing: ${++commitIndex}/${commitLength}`, commit.sha)

        const files = await getDiffFiles(sourceRepo, commit.sha)
        await reWriteFilesInRepo(NEW_REPO, files)
        const newSha = await commitFiles(targetRepo, commit.author, commit.committer, commit.message, files)

        time1 = time2
        time2 = Date.now()
        commit.newSha = newSha
        commit.processing = {
            t0: time0,
            tX: time2,
            index: commitIndex - 1,
            dt: time2 - time1,
        }

        await writeLogData(options.logFilePath, commits)
    }

    await writeLogData(options.logFilePath, commits)
    console.log(`Finish: total=${Date.now() - time0}ms;`)
}

const program = new Command()
program
    .version(packageJson.version)
    .argument('<config-path>', 'json config path')
    .description(packageJson.description)
    .action(main)
    .parseAsync(process.argv)
