#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const Git = require('nodegit')
const ignore = require('ignore')
const writeFileAtomic = require('write-file-atomic')

const { Command } = require('commander')
const packageJson = require(path.join(__dirname, './package.json'))

let DEBUG = false

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
    if (DEBUG) console.log('reWriteFilesInRepo()', files.length)

    // NOTE: we need to support rename case! if we rename from Index.js to index.js its equal to create Index.js and remove index.js
    //   And if your FS is ignore case you can create and delete the same file!
    for (const file of files) {
        if (file.type !== -1) continue
        const filePath = path.join(repoPath, file.path)
        if (DEBUG) console.log('reWriteFilesInRepo() delete:', filePath)
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
            if (DEBUG) console.log('reWriteFilesInRepo() write:', filePath, blob.rawsize(), `mode:${file.filemode}`, JSON.stringify(blob.toString().substring(0, 90)))
            await fs.promises.mkdir(dirPath, { recursive: true })
            await writeFile(filePath, buffer, file.filemode)
        } else if (file.type === 1) { // submodule
            // NOTE: just skeep
            // TODO(pahaz): what we really should to do with submodules?
            console.log(`? git submodule: ${filePath} (skip)`)
        } else {
            console.log(`? WTF ? type=${file.type} path=${file.path} (skip)`)
        }
    }
    if (DEBUG) console.log('reWriteFilesInRepo() done')
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
    if (DEBUG) console.log('commitFiles()', files.length)
    const index = await repo.refreshIndex()

    // NOTE: we need to support rename case! if we rename from Index.js to index.js its equal to create Index.js and remove index.js
    //   And if your FS is ignore case you can create and delete the same file!
    for (const file of files) {
        if (file.type !== -1) continue
        if (DEBUG) console.log(`commitFiles() removeByPath: ${file.path}`)
        await index.removeByPath(file.path)
    }

    for (const file of files) {
        if (file.type === -1) { // delete file
            // NOTE: already processed
        } else if (file.type === 3) { // file Type
            if (DEBUG) console.log(`commitFiles() addByPath: ${file.path}`)
            await index.addByPath(file.path)
        } else if (file.type === 1) { // submodule
            // TODO(pahaz): what we really should to do with submodules?
            if (DEBUG) console.log(`commitFiles() ${file.path} (skip)`)
        } else {
            if (DEBUG) console.log(`commitFiles() type=${file.type} path=${file.path} (skip)`)
        }
    }

    if (DEBUG) console.log('commitFiles() index.write()')
    await index.write()

    if (DEBUG) console.log('commitFiles() index.writeTree()')
    const oid = await index.writeTree()

    const parent = await repo.getHeadCommit()
    const commitOid = await repo.createCommit('HEAD', author, committer, message, oid, (parent) ? [parent] : [])
    if (DEBUG) console.log('commitFiles() done')
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
    const isDirectory = (permission & 0o170000) == 0o040000
    const isNormalFile = (permission & 0o170000) == 0o100644
    const isExecutable = (permission & 0o170000) == 0o100755
    const isSymlink = (permission & 0o170000) == 0o120000
    if (DEBUG) console.log('writeFile()', path, (permission & 0o170000).toString(2).substring(0, 4), (permission | 0o170000).toString(2).substring(4), isDirectory, isNormalFile, isExecutable, isSymlink)
    if (isSymlink) {
        await fs.promises.symlink(buffer.toString(), path)
    } else {
        await writeFileAtomic(path, buffer, { mode: permission })
    }
}

function prepareLogData (commits) {
    const result = []
    for (const { date, sha, author, committer, message, processing } of commits) {
        if (!processing) break
        result.push({
            date, sha,
            author: {
                name: author.name(),
                email: author.email(),
            },
            committer: {
                name: committer.name(),
                email: committer.email(),
            },
            message: message.substring(0, 200),
            processing,
        })
    }

    return result
}

async function writeLogData (logFilePath, commits, filePaths, ignoredPaths, allowedPaths, skippedPaths) {
    const processedCommits = prepareLogData(commits)
    const data = JSON.stringify({
        paths: [...filePaths],
        ignoredPaths: [...ignoredPaths],
        allowedPaths: [...allowedPaths],
        skippedPaths: [...skippedPaths],
        commits: processedCommits,
    }, null, 2)
    await writeFileAtomic(logFilePath, data)
}

async function readLogData (logFilePath) {
    try {
        return JSON.parse(await fs.promises.readFile(logFilePath))
    } catch (e) {
        return { commits: [] }
    }
}

async function hasCommit (repo, hash) {
    try {
        await repo.getCommit(hash)
        return true
    } catch (e) {
        if (e.message.search('object not found') !== -1) return false
        throw e
    }
}

async function checkout (repo, hash) {
    const ref = await Git.Reference.create(repo, 'remote/origin/noname', hash, 1, '')
    await repo.checkoutRef(ref, {
        checkoutStrategy: Git.Checkout.STRATEGY.FORCE,
    })
}

async function stash (repo) {
    const sig = await Git.Signature.create('GIT EXPORTER JS', 'gitexporter@example.com', 123456789, 60)
    try {
        await Git.Stash.save(repo, sig, 'our stash', 0)
    } catch (e) {
        if (e.message.includes('there is nothing to stash') >= 0) return
        console.error('Stash error:', e.message)
    }
}

function requireResolvePaths (paths) {
    for (const path of paths) {
        try {
            require(path)
            return path
        } catch (error) {
            if (DEBUG) console.warn(error)
        }
    }
    return null
}

async function readOptions (config, args) {
    const data = fs.readFileSync(config)
    const options = JSON.parse(data)
    const debug = !!options.debug || false
    const dontShowTiming = !!options.dontShowTiming || false
    const targetRepoPath = options.targetRepoPath || 'ignore.target'
    const sourceRepoPath = options.sourceRepoPath || '.'
    const logFilePath = options.logFilePath || targetRepoPath + '.log.json'
    const forceReCreateRepo = options.forceReCreateRepo || false
    const syncAllFilesOnLastFollowCommit = options.syncAllFilesOnLastFollowCommit || false
    const followByLogFile = (forceReCreateRepo) ? false : options.followByLogFile || true
    const allowedPaths = options.allowedPaths || ['*']
    const ignoredPaths = options.ignoredPaths || []
    let commitTransformer = options.commitTransformer || null
    if (commitTransformer) {
        commitTransformer = requireResolvePaths([
            commitTransformer,
            path.join(config, '..', commitTransformer),
            path.join(process.cwd(), commitTransformer),
        ])
        if (!commitTransformer) exit(`ERROR: can't import "commitTransformer" module. Try to use path related to ${config} file`)
        commitTransformer = require(commitTransformer)
    }
    return {
        debug,
        dontShowTiming,
        forceReCreateRepo,
        followByLogFile,
        syncAllFilesOnLastFollowCommit,
        targetRepoPath,
        sourceRepoPath,
        logFilePath,
        allowedPaths,
        ignoredPaths,
        commitTransformer,
    }
}

function exit (message, code = 1) {
    console.error(message)
    process.exit(code)
}

async function main (config, args) {
    const options = await readOptions(config, args)
    if (options.debug) DEBUG = true

    const time0 = Date.now()
    const ig = ignore().add(options.ignoredPaths)
    const al = ignore().add(options.allowedPaths)

    const existingLogState = await readLogData(options.logFilePath)
    const isFollowByLogFileFeatureEnabled = options.followByLogFile && !options.forceReCreateRepo && existingLogState.commits.length
    if (isFollowByLogFileFeatureEnabled) {
        console.log('Follow target repo state by log file:', existingLogState.commits.length, 'commits')
    }

    if (options.forceReCreateRepo && fs.existsSync(options.targetRepoPath)) {
        console.log('Remove existing repo:', options.targetRepoPath)
        await fs.promises.rmdir(options.targetRepoPath, { recursive: true, force: true })
    } else {
        if (!isFollowByLogFileFeatureEnabled && fs.existsSync(options.targetRepoPath)) {
            // We have some existing repo! with commits! it's unpredictable to add new commits is such case!
            exit('ERROR: Target repository already exists and we does not have an export log file! The behavior will be non-deterministic. You can use `forceReCreateRepo` or remove existing target repo', 5)
        }
    }

    const targetRepo = await openOrInitRepo(options.targetRepoPath)
    await stash(targetRepo)

    const sourceRepo = await Git.Repository.open(options.sourceRepoPath)
    const commits = await getCommitHistory(await sourceRepo.getMasterCommit())

    let commitIndex = 0
    const commitLength = commits.length

    let time1 = Date.now()
    let time2 = Date.now()
    let pathsLength = 0
    let ignoredPathsLength = 0
    let allowedPathsLength = 0
    let isFollowLogOk = true
    let lastFollowCommit = null
    let syncTreeCommitIndex = -1
    const filePaths = new Set()
    const ignoredPaths = new Set()
    const allowedPaths = new Set()
    const skippedPaths = new Set()
    for (const commit of commits) {

        console.log(`Processing: ${++commitIndex}/${commitLength}`, commit.sha, (options.dontShowTiming) ? '' : `~${Math.round((time2 - time0) / commitIndex)}ms; ${(time2 - time1)}ms`)

        if (isFollowLogOk && isFollowByLogFileFeatureEnabled) {
            const existingCommit = existingLogState.commits[commitIndex - 1]
            if (existingCommit && existingCommit.processing) {
                const sha = existingCommit.sha
                const newSha = existingCommit.processing.newSha
                const hasTargetCommit = await hasCommit(targetRepo, newSha)
                const hasSourceCommit = await hasCommit(sourceRepo, sha)
                if (hasTargetCommit && hasSourceCommit) {
                    lastFollowCommit = newSha
                    // we also need to update commit.processing data
                    commit.processing = existingCommit.processing
                    continue
                } else {
                    isFollowLogOk = false
                    if (!lastFollowCommit) exit('ERROR: Does not find any log commit! Try to use `forceReCreateRepo` mode or remove wrong log file!', 2)
                    await checkout(targetRepo, lastFollowCommit)
                    if (options.syncAllFilesOnLastFollowCommit) syncTreeCommitIndex = commitIndex
                    console.log(`Follow log stopped! last commit ${commitIndex}/${commitLength} ${lastFollowCommit}`)
                }
            } else {
                isFollowLogOk = false
                if (!lastFollowCommit) exit('ERROR: Does not find any log commit! Try to use `forceReCreateRepo` mode or remove wrong log file!', 2)
                await checkout(targetRepo, lastFollowCommit)
                if (options.syncAllFilesOnLastFollowCommit) syncTreeCommitIndex = commitIndex
                console.log(`Follow log stopped! last commit ${commitIndex}/${commitLength} ${lastFollowCommit}`)
            }
        }

        pathsLength = 0
        ignoredPathsLength = 0
        allowedPathsLength = 0
        const files = ((commitIndex === syncTreeCommitIndex) ? await getTreeFiles(sourceRepo, commit.sha) : await getDiffFiles(sourceRepo, commit.sha))
            .filter(({ path }) => {
                let isOk = true
                pathsLength++
                filePaths.add(path)
                if (ig.ignores(path)) {
                    if (isOk) isOk = false
                    ignoredPathsLength++
                    ignoredPaths.add(path)
                }
                if (al.ignores(path)) {
                    allowedPathsLength++
                    allowedPaths.add(path)
                } else {
                    if (isOk) {
                        skippedPaths.add(path)
                        isOk = false
                    }
                }
                return isOk
            })

        if (options.commitTransformer) await options.commitTransformer(commit, files)

        await reWriteFilesInRepo(options.targetRepoPath, files)
        const newSha = await commitFiles(targetRepo, commit.author, commit.committer, commit.message, files)

        time1 = time2
        time2 = Date.now()
        commit.processing = {
            newSha,
            index: `${commitIndex}/${commitLength}`,
            t0: time0,
            tX: time2,
            dt: time2 - time1,
            paths: pathsLength,
            ignoredPaths: ignoredPathsLength,
            allowedPaths: allowedPathsLength,
        }

        if (commitIndex % 50 === 0) {
            await writeLogData(options.logFilePath, commits, filePaths, ignoredPaths, allowedPaths, skippedPaths)
            console.log(`Saved export state: ${commitIndex}/${commitLength}`)
        }
    }

    await writeLogData(options.logFilePath, commits, filePaths, ignoredPaths, allowedPaths, skippedPaths)
    if (isFollowLogOk && isFollowByLogFileFeatureEnabled) console.log('Follow log stopped! last commit', commitIndex, lastFollowCommit)
    console.log((options.dontShowTiming) ? 'Finish' : `Finish: total=${Date.now() - time0}ms;`)
}

const program = new Command()
program
    .version(packageJson.version)
    .argument('<config-path>', 'json config path')
    .description(packageJson.description)
    .action(main)
    .parseAsync(process.argv)
