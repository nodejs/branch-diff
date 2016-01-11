#!/usr/bin/env node

'use strict'

const fs             = require('fs')
    , path           = require('path')
    , commitStream   = require('commit-stream')
    , split2         = require('split2')
    , listStream     = require('list-stream')
    , pkgtoId        = require('pkg-to-id')
    , chalk          = require('chalk')
    , map            = require('map-async')
    , commitToOutput = require('changelog-maker/commit-to-output')
    , collectCommitLabels = require('changelog-maker/collect-commit-labels')
    , groupCommits   = require('changelog-maker/group-commits')
    , gitexec        = require('gitexec')

    , pkgFile        = path.join(process.cwd(), 'package.json')
    , pkgData        = fs.existsSync(pkgFile) ? require(pkgFile) : {}
    , pkgId          = pkgtoId(pkgData)
    , refcmd         = 'git rev-list --max-count=1 {{ref}}'
    , commitdatecmd  = '$(git show -s --format=%cd `{{refcmd}}`)'
    , gitcmd         = 'git log {{startCommit}}..{{branch}} --until="{{untilcmd}}"'
    , ghId           = {
          user: pkgId.user || 'nodejs'
        , name: pkgId.name || 'node'
      }


function replace (s, m) {
  Object.keys(m).forEach(function (k) {
    s = s.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), m[k])
  })
  return s
}


function branchDiff (branch1, branch2, options, callback) {
  if (!branch1 || !branch2)
    return callback(new Error('Must supply two branch names to compare'))

  let repoPath = options.repoPath || process.cwd()

  findMergeBase(repoPath, branch1, branch2, (err, commit) => {
    map(
        [ branch1, branch2 ], (branch, callback) => {
          collect(repoPath, branch, commit, branch == branch2 && options.endRef).pipe(listStream.obj(callback))
        }
      , (err, branchCommits) => diffCollected(options, branchCommits, callback)
    )
  })
}


function findMergeBase (repoPath, branch1, branch2, callback) {
  let gitcmd = `git merge-base ${branch1} ${branch2}`

  gitexec.execCollect(repoPath, gitcmd, (err, data) => {
    if (err)
      return callback(err)

    callback(null, data.substr(0, 10))
  })
}


function diffCollected (options, branchCommits, callback) {
  function isInList (commit) {
    return branchCommits[0].some((c) => {
      if (commit.sha === c.sha)
        return true
      if (commit.summary === c.summary
          //&& equal(commit.description, c.description)
          && commit.prUrl && c.prUrl
          && commit.prUrl === c.prUrl)
        return true
      return false
    })
  }

  let list = branchCommits[1].filter((commit) => !isInList(commit))

  collectCommitLabels(list, (err) => {
    if (err)
      return callback(err)

    if (options.excludeLabels) {
      list = list.filter((commit) => {
        return !commit.labels || !commit.labels.some((label) => {
          return options.excludeLabels.indexOf(label) >= 0
        })
      })
    }

    if (options.group)
      list = groupCommits(list)

    callback(null, list)
  })
}


function applyCommits (list, bail) {
  const cp = require('child_process')

  let i = list.length
  while (i--) {
    const commit = list[i]
    const out = cp.spawnSync('git', ['cherry-pick', commit.sha])

    if (out.status === 0) {
      continue
    }

    const cleanup = cp.spawnSync('git', ['cherry-pick', '--abort'])
    if (cleanup.status !== 0) {
      console.error('Error resetting git, bailing.')
      return
    }

    console.log(`${bail ? 'Bailing' : 'Skipping'}: Could not apply ${commit.sha.slice(0, 7)}... ${commit.summary}`)
    if (bail) return
  }
}


function printCommits (list, simple) {
  list = list.map((commit) => commitToOutput(commit, simple, ghId))

  let out = list.join('\n') + '\n'

  if (!process.stdout.isTTY)
    out = chalk.stripColor(out)

  process.stdout.write(out)
}


function collect (repoPath, branch, startCommit, endRef) {
  let endrefcmd = endRef && replace(refcmd, { ref: endRef })
    , untilcmd  = endRef ? replace(commitdatecmd, { refcmd: endrefcmd }) : ''
    , _gitcmd      = replace(gitcmd, { branch, startCommit, untilcmd })

  return gitexec.exec(repoPath, _gitcmd)
    .pipe(split2())
    .pipe(commitStream(ghId.user, ghId.name))
}


module.exports = branchDiff

if (require.main === module) {
  let argv          = require('minimist')(process.argv.slice(2))
    , branch1       = argv._[0]
    , branch2       = argv._[1]
    , simple        = argv.simple || argv.s
    , group         = argv.group || argv.g
    , endRef        = argv['end-ref']
    , excludeLabels = []
    , options
    , bail          = argv.bail

  if (argv['patch-only'])
    excludeLabels = [ 'semver-minor', 'semver-major' ]
  if (argv['exclude-label']) {
    if (!Array.isArray(argv['exclude-label']))
      argv['exclude-label'] = argv['exclude-label'].split(',')
    excludeLabels = excludeLabels.concat(argv['exclude-label'])
  }

  options = { simple, group, excludeLabels, endRef }

  branchDiff(branch1, branch2, options, (err, list) => {
    if (err)
      throw err

    if (argv.apply) {
      applyCommits(list, bail)
      return
    }

    printCommits(list, simple)
  })
}
