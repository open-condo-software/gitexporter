const path = require('path')
const fs = require('fs')
const util = require('util')
const exec = util.promisify(require('child_process').exec)

const writeFileAtomic = require('write-file-atomic')

async function run (command) {
    const { stdout, stderr } = await exec(command)
    console.log(command, stdout)
    expect(stderr).toBe('')
    return { stdout, stderr }
}

async function prepareGitRepo (folder) {
    const filename = 'test.txt'
    const filepath = path.join(folder, filename)
    const renamedFilename = 'Test.txt'
    const renamedFilepath = path.join(folder, renamedFilename)
    const filename2 = 'sTest.txt'
    const filepath2 = path.join(folder, filename2)
    const text1 = 'Initial text'
    const text2 = 'Changed text'
    await exec(`rm -rf ${folder}`)
    await exec(`mkdir -p ${folder}`)
    await exec(`git -C ${folder} init`)
    await writeFileAtomic(filepath, text1)
    await exec(`git -C ${folder} add ${filename}`)
    await exec(`GIT_COMMITTER_DATE="2010-01-01T22:00:00Z" git -C ${folder} -c user.name="Name2" -c user.email=user2@example.com commit --author='User <user@example.com>' --date "2005-04-07T22:13:13Z" -am 'initial commit'`)
    await writeFileAtomic(filepath, text2)
    await exec(`git -C ${folder} add ${filename}`)
    await exec(`GIT_COMMITTER_DATE="2010-01-01T22:01:00Z" git -C ${folder} -c user.name="Name2" -c user.email=user2@example.com commit --author='User <user@example.com>' --date "2005-05-07T23:13:13Z" -am 'change initial text'`)
    await exec(`git -C ${folder} rm ${filename}`)
    await writeFileAtomic(renamedFilepath, text2)
    await exec(`git -C ${folder} add ${renamedFilename}`)
    await exec(`GIT_COMMITTER_DATE="2010-01-01T22:02:00Z" git -C ${folder} -c user.name="Name2" -c user.email=user2@example.com commit --author='User <user@example.com>' --date "2005-06-07T23:13:13Z" -am 'rename file'`)
    await exec(`ln -s ${renamedFilename} ${renamedFilepath}.link`)
    await exec(`git -C ${folder} add ${renamedFilename}.link`)
    await exec(`GIT_COMMITTER_DATE="2010-01-01T22:03:00Z" git -C ${folder} -c user.name="Name2" -c user.email=user2@example.com commit --author='User <user@example.com>' --date "2005-07-07T23:13:13Z" -am 'create link'`)
    await writeFileAtomic(filepath2, text1)
    await exec(`git -C ${folder} add ${filename2}`)
    await exec(`GIT_COMMITTER_DATE="2010-01-01T22:04:00Z" git -C ${folder} -c user.name="Name2" -c user.email=user2@example.com commit --author='User <user@example.com>' --date "2005-08-07T23:13:13Z" -am 'another file'`)
    await exec(`mkdir -p ${path.join(folder, 'bin')}`)
    await writeFileAtomic(path.join(folder, 'bin', 'script.js'), '#!/usr/bin/env node\nconsole.log(911)\n')
    await exec(`chmod +x ${path.join(folder, 'bin', 'script.js')}`)
    await exec(`git -C ${folder} add ${path.join('bin', 'script.js')}`)
    await exec(`GIT_COMMITTER_DATE="2010-01-01T22:05:00Z" git -C ${folder} -c user.name="Name2" -c user.email=user2@example.com commit --author='User <user@example.com>' --date "2005-09-07T23:13:13Z" -am 'add script!'`)
}

test('prepareGitRepo()', async () => {
    const folder = 'ignore.prepare-git-repo'
    await prepareGitRepo(folder)

    {
        const {
            stdout,
            stderr,
        } = await exec(`git -C ${folder} log --pretty='format:%H %aI "%an" <%ae> %cI "%cn" <%ce> %s'`)
        expect(stderr).toBe('')
        expect(stdout).toBe([
            '43a8998c57a1885fb9bb4ae8342b2e8a9285f002 2005-09-07T23:13:13+00:00 "User" <user@example.com> 2010-01-01T22:05:00+00:00 "Name2" <user2@example.com> add script!',
            'a9384415955e78b0adfd00e5fb95b99eff97138c 2005-08-07T23:13:13+00:00 "User" <user@example.com> 2010-01-01T22:04:00+00:00 "Name2" <user2@example.com> another file',
            'dded478c4d2bf21367a88d7e9bb2b6ea18eb3c50 2005-07-07T23:13:13+00:00 "User" <user@example.com> 2010-01-01T22:03:00+00:00 "Name2" <user2@example.com> create link',
            'ee01df4e6cc73e4210e87c94b853a96103ca02c2 2005-06-07T23:13:13+00:00 "User" <user@example.com> 2010-01-01T22:02:00+00:00 "Name2" <user2@example.com> rename file',
            'd0dc86bea4f548db93905b71da1c6915594bfd5b 2005-05-07T23:13:13+00:00 "User" <user@example.com> 2010-01-01T22:01:00+00:00 "Name2" <user2@example.com> change initial text',
            'c731fd997376f68806c5cbe100edc7000acb75db 2005-04-07T22:13:13+00:00 "User" <user@example.com> 2010-01-01T22:00:00+00:00 "Name2" <user2@example.com> initial commit',
        ].join('\n'))
    }
    {
        const { stdout, stderr } = await exec(`git -C ${folder} log -p`)
        expect(stderr).toBe('')
        expect(stdout).toBe(`commit 43a8998c57a1885fb9bb4ae8342b2e8a9285f002
Author: User <user@example.com>
Date:   Wed Sep 7 23:13:13 2005 +0000

    add script!

diff --git a/bin/script.js b/bin/script.js
new file mode 100755
index 0000000..ca29b27
--- /dev/null
+++ b/bin/script.js
@@ -0,0 +1,2 @@
+#!/usr/bin/env node
+console.log(911)

commit a9384415955e78b0adfd00e5fb95b99eff97138c
Author: User <user@example.com>
Date:   Sun Aug 7 23:13:13 2005 +0000

    another file

diff --git a/sTest.txt b/sTest.txt
new file mode 100644
index 0000000..6dbb898
--- /dev/null
+++ b/sTest.txt
@@ -0,0 +1 @@
+Initial text
\\ No newline at end of file

commit dded478c4d2bf21367a88d7e9bb2b6ea18eb3c50
Author: User <user@example.com>
Date:   Thu Jul 7 23:13:13 2005 +0000

    create link

diff --git a/Test.txt.link b/Test.txt.link
new file mode 120000
index 0000000..d7da186
--- /dev/null
+++ b/Test.txt.link
@@ -0,0 +1 @@
+Test.txt
\\ No newline at end of file

commit ee01df4e6cc73e4210e87c94b853a96103ca02c2
Author: User <user@example.com>
Date:   Tue Jun 7 23:13:13 2005 +0000

    rename file

diff --git a/test.txt b/Test.txt
similarity index 100%
rename from test.txt
rename to Test.txt

commit d0dc86bea4f548db93905b71da1c6915594bfd5b
Author: User <user@example.com>
Date:   Sat May 7 23:13:13 2005 +0000

    change initial text

diff --git a/test.txt b/test.txt
index 6dbb898..41c4a21 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-Initial text
\\ No newline at end of file
+Changed text
\\ No newline at end of file

commit c731fd997376f68806c5cbe100edc7000acb75db
Author: User <user@example.com>
Date:   Thu Apr 7 22:13:13 2005 +0000

    initial commit

diff --git a/test.txt b/test.txt
new file mode 100644
index 0000000..6dbb898
--- /dev/null
+++ b/test.txt
@@ -0,0 +1 @@
+Initial text
\\ No newline at end of file
`)
    }
})

test('gitexporter config.json', async () => {
    await exec(`rm -rf  ignore.default`)
    await exec(`rm -rf  ignore.default.log.json`)
    await run(`node --unhandled-rejections=strict index.js config.json`)
    const file1 = fs.readFileSync('index.js', { encoding: 'utf-8' })
    const file2 = fs.readFileSync('ignore.default/index.js', { encoding: 'utf-8' })
    expect(file1).toBe(file2)
})

test('gitexporter allowed paths', async () => {
    const config = `{
  "forceReCreateRepo": true,
  "targetRepoPath": "ignore.allowed-paths-target",
  "sourceRepoPath": "ignore.allowed-paths",
  "allowedPaths": ["test.txt"]
}`
    await run('rm -rf ignore.allowed-paths*')
    await prepareGitRepo('ignore.allowed-paths')
    await writeFileAtomic('ignore.allowed-paths.config.json', config)
    await run(`node --unhandled-rejections=strict index.js ignore.allowed-paths.config.json`)

    const { stdout, stderr } = await exec(`ls -a ignore.allowed-paths-target`)
    expect(stderr).toBe('')
    expect(stdout).toBe(`.
..
.git
Test.txt
`)

    const logs = JSON.parse(fs.readFileSync('ignore.allowed-paths-target.log.json', { encoding: 'utf-8' }))
    expect(logs.paths).toEqual([
        'test.txt',
        'Test.txt',
        'Test.txt.link',
        'sTest.txt',
        'bin/script.js',
    ])
    expect(logs.ignoredPaths).toEqual([])
    expect(logs.allowedPaths).toEqual([
        'test.txt',
        'Test.txt',
    ])
})

test('gitexporter ignored paths', async () => {
    const config = `{
  "forceReCreateRepo": true,
  "targetRepoPath": "ignore.ignored-paths-target",
  "sourceRepoPath": "ignore.ignored-paths",
  "ignoredPaths": ["test.txt"]
}`

    await run('rm -rf ignore.ignored-paths*')
    await prepareGitRepo('ignore.ignored-paths')
    await writeFileAtomic('ignore.ignored-paths.config.json', config)
    await run(`node --unhandled-rejections=strict index.js ignore.ignored-paths.config.json`)

    const { stdout, stderr } = await exec(`ls -a ignore.ignored-paths-target`)
    expect(stderr).toBe('')
    expect(stdout).toBe(`.
..
.git
Test.txt.link
bin
sTest.txt
`)

    const logs = JSON.parse(fs.readFileSync('ignore.ignored-paths-target.log.json', { encoding: 'utf-8' }))
    expect(logs.paths).toEqual([
        'test.txt',
        'Test.txt',
        'Test.txt.link',
        'sTest.txt',
        'bin/script.js',
    ])
    expect(logs.ignoredPaths).toEqual([
        'test.txt',
        'Test.txt',
    ])
    expect(logs.allowedPaths).toEqual([
        'test.txt',
        'Test.txt',
        'Test.txt.link',
        'sTest.txt',
        'bin/script.js',
    ])
})

test('gitexporter ignored and allowed paths', async () => {
    const config = `{
  "forceReCreateRepo": true,
  "targetRepoPath": "ignore.ignored-allowed-paths-target",
  "sourceRepoPath": "ignore.ignored-allowed-paths",
  "ignoredPaths": ["*.txt"],
  "allowedPaths": ["*.js"]
}`

    await run('rm -rf ignore.ignored-allowed-paths*')
    await prepareGitRepo('ignore.ignored-allowed-paths')
    await writeFileAtomic('ignore.ignored-allowed-paths.config.json', config)
    await run(`node --unhandled-rejections=strict index.js ignore.ignored-allowed-paths.config.json`)

    const { stdout, stderr } = await exec(`ls -a ignore.ignored-allowed-paths-target`)
    expect(stderr).toBe('')
    expect(stdout).toBe(`.
..
.git
bin
`)

    const logs = JSON.parse(fs.readFileSync('ignore.ignored-allowed-paths-target.log.json', { encoding: 'utf-8' }))
    expect(logs.paths).toEqual([
        'test.txt',
        'Test.txt',
        'Test.txt.link',
        'sTest.txt',
        'bin/script.js',
    ])
    expect(logs.ignoredPaths).toEqual([
        'test.txt',
        'Test.txt',
        'sTest.txt',
    ])
    expect(logs.allowedPaths).toEqual([
        'bin/script.js',
    ])
})
