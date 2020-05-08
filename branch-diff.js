#!/usr/bin/env node

'use strict'

const fs             = require('fs')
    , path           = require('path')
    , commitStream   = require('commit-stream')
    , split2         = require('split2')
    , listStream     = require('list-stream')
    , pkgtoId        = require('pkg-to-id')
    , stripAnsi      = require('strip-ansi')
    , map            = require('map-async')
    , { commitToOutput } = require('changelog-maker/commit-to-output')
    , collectCommitLabels = require('changelog-maker/collect-commit-labels')
    , groupCommits   = require('changelog-maker/group-commits')
    , { isReleaseCommit, toGroups } = require('changelog-maker/groups')
    , gitexec        = require('gitexec')

    , pkgFile        = path.join(process.cwd(), 'package.json')
    , pkgData        = fs.existsSync(pkgFile) ? require(pkgFile) : {}
    , pkgId          = pkgtoId(pkgData)
    , refcmd         = 'git rev-list --max-count=1 {{ref}}'
    , commitdatecmd  = '$(git show -s --format=%cd `{{refcmd}}`)'
    , gitcmd         = 'git log {{startCommit}}..{{branch}} --until="{{untilcmd}}"'
    , ghId           = {
          user: pkgId.user || 'nodejs'
        , repo: pkgId.name || 'node'
      }
    , defaultCommitUrl = 'https://github.com/{ghUser}/{ghRepo}/commit/{ref}'

const formatType = {
  PLAINTEXT: 'plaintext',
  MARKDOWN: 'markdown',
  SIMPLE: 'simple',
  SHA: 'sha'
}

const getFormat = (argv) => {
  if (argv.format && Object.values(formatType).includes(argv.format)) {
    return argv.format
  } else if (argv.simple || argv.s) {
    return formatType.SIMPLE
  }
  return formatType.MARKDOWN
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

  let list = branchCommits[1].filter((commit) => !isInList(commit))

  collectCommitLabels(list, (err) => {
    if (err)
      return callback(err)

    if (options.excludeLabels.length > 0) {
      list = list.filter((commit) => {
        return !commit.labels || !commit.labels.some((label) => {
          return options.excludeLabels.indexOf(label) >= 0
        })
      })
    }

    if (options.requireLabels.length > 0) {
      list = list.filter((commit) => {
        return commit.labels && commit.labels.some((label) => {
          return options.requireLabels.indexOf(label) >= 0
        })
      })
    }

    if (options.group)
      list = groupCommits(list)

    callback(null, list)
  })
}

function printCommits (list, format, reverse, commitUrl) {
  if (format === formatType.SHA) {
    list = list.map((commit) => `${commit.sha.substr(0, 10)}`)
  } else if (format === formatType.SIMPLE) {
    list = list.map((commit) => commitToOutput(commit, formatType.SIMPLE, ghId, commitUrl))
  } else if (format === formatType.PLAINTEXT) {
    // Plaintext format implies grouping.
    list = groupCommits(list)

    const formatted = []
    let currentGroup
    for (const commit of list) {
      const commitGroup = toGroups(commit.summary)
      if (currentGroup !== commitGroup) {
        formatted.push(`${commitGroup}:`)
        currentGroup = commitGroup
      }
      formatted.push(commitToOutput(commit, formatType.PLAINTEXT, ghId, commitUrl))
    }
    list = formatted
  } else {
    list = list.map((commit) => commitToOutput(commit, formatType.MARKDOWN, ghId, commitUrl))
  }

  if (reverse)
    list = list.reverse()

  let out = list.join('\n') + '\n'

  if (!process.stdout.isTTY)
    out = stripAnsi(out)

  process.stdout.write(out)
}


function collect (repoPath, branch, startCommit, endRef) {
  let endrefcmd = endRef && replace(refcmd, { ref: endRef })
    , untilcmd  = endRef ? replace(commitdatecmd, { refcmd: endrefcmd }) : ''
    , _gitcmd      = replace(gitcmd, { branch, startCommit, untilcmd })

  return gitexec.exec(repoPath, _gitcmd)
    .pipe(split2())
    .pipe(commitStream(ghId.user, ghId.repo))
}


module.exports = branchDiff

if (require.main === module) {
  let minimistConfig = {
        boolean: [ 'version', 'group', 'patch-only', 'simple', 'filter-release', 'reverse' ]
      }
    , argv          = require('minimist')(process.argv.slice(2), minimistConfig)
    , branch1       = argv._[0]
    , branch2       = argv._[1]
    , reverse       = argv.reverse
    , group         = argv.group || argv.g
    , endRef        = argv['end-ref']
    , commitUrl     = argv['commit-url'] || defaultCommitUrl
    , excludeLabels = []
    , requireLabels = []
    , options

  const format = getFormat(argv)

  if (argv.version || argv.v)
    return console.log(`v ${require('./package.json').version}`)

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

    printCommits(list, format, reverse, commitUrl)
  })
}
