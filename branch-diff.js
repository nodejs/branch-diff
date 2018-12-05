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
    , isReleaseCommit = require('changelog-maker/groups').isReleaseCommit
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
    if (err)
      return callback(err)
    map(
        [ branch1, branch2 ], (branch, callback) => {
          collect(repoPath, branch, commit, branch == branch2 && options.endRef).pipe(listStream.obj(callback))
        }
      , (err, branchCommits) => err ? callback(err) : diffCollected(options, branchCommits, callback)
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
      if (commit.summary === c.summary) {
        if (commit.prUrl && c.prUrl) {
            return commit.prUrl === c.prUrl
        } else if (commit.author.name === c.author.name
                && commit.author.email === c.author.email) {
          if (process.stderr.isTTY)
            console.error(`Note: Commit fell back to author checking: "${commit.summary}" -`, commit.author)
          return true
        }
      }
      return false
    })
  }

  const list = branchCommits[1].filter((commit) => !isInList(commit))
  let start = 0
  const chunkSize = 500
  let end = start + chunkSize
 
  let filtered = []
  let sublist = list.slice(start, end)

  if (sublist) {
    function processCommitChunk () {
      collectCommitLabels(sublist, (err) => {
        if (err)
          return callback(err)
    
        if (options.excludeLabels.length > 0) {
          sublist = sublist.filter((commit) => {
            return !commit.labels || !commit.labels.some((label) => {
              return options.excludeLabels.indexOf(label) >= 0
            })
          })
        }
    
        if (options.requireLabels.length > 0) {
          sublist = sublist.filter((commit) => {
            return commit.labels && commit.labels.some((label) => {
              return options.requireLabels.indexOf(label) >= 0
            })
          })
        }
    
        if (options.group)
          sublist = groupCommits(sublist)
    
        filtered = filtered.concat(sublist)
        start += chunkSize
        end += chunkSize
        
        sublist = list.slice(start, end)
        if (sublist.length !== 0) {
          setTimeout(processCommitChunk, 5000)
        } else {
          callback(null, filtered)
        }
      })
    }
    processCommitChunk()
  } else {
    callback(null, filtered)
  }
}

function printCommits (list, format, reverse) {
  if (format === 'sha') {
    list = list.map((commit) => `${commit.sha.substr(0, 10)}`)
  } else {
    list = list.map((commit) => commitToOutput(commit, format === 'simple', ghId))
  }

  if (reverse) list = list.reverse();

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
    , format        = argv.format
    , reverse       = argv.reverse
    , group         = argv.group || argv.g
    , endRef        = argv['end-ref']
    , excludeLabels = []
    , requireLabels = []
    , options


  if (argv.version || argv.v)
    return console.log(`v ${require('./package.json').version}`)

  if (argv.simple || argv.s)
    format = 'simple'

  if (argv['patch-only'])
    excludeLabels = [ 'semver-minor', 'semver-major' ]

  if (argv['exclude-label']) {
    if (!Array.isArray(argv['exclude-label']))
      argv['exclude-label'] = argv['exclude-label'].split(',')
    excludeLabels = excludeLabels.concat(argv['exclude-label'])
  }

  if (argv['require-label']) {
    if (!Array.isArray(argv['require-label']))
      argv['require-label'] = argv['require-label'].split(',')
    requireLabels = requireLabels.concat(argv['require-label'])
  }

  options = {
    simple: format === 'simple',
    group,
    excludeLabels,
    requireLabels,
    endRef
  }

  branchDiff(branch1, branch2, options, (err, list) => {
    if (err)
      throw err

    if (argv['filter-release'])
      list = list.filter((commit) => !isReleaseCommit(commit.summary))

    printCommits(list, format, reverse)
  })
}
