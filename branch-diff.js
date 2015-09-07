#!/usr/bin/env node

const spawn          = require('child_process').spawn
    , fs             = require('fs')
    , path           = require('path')
    , commitStream   = require('commit-stream')
    , through2       = require('through2')
    , split2         = require('split2')
    , listStream     = require('list-stream')
    , bl             = require('bl')
    , equal          = require('deep-equal')
    , pkgtoId        = require('pkg-to-id')
    , chalk          = require('chalk')
    , argv           = require('minimist')(process.argv.slice(2))
    , map            = require('map-async')
    , commitToOutput = require('changelog-maker/commit-to-output')
    , collectCommitLabels = require('changelog-maker/collect-commit-labels')

    , pkgFile        = path.join(process.cwd(), 'package.json')
    , pkgData        = fs.existsSync(pkgFile) ? require(pkgFile) : {}
    , pkgId          = pkgtoId(pkgData)
    , branch1        = argv._[0]
    , branch2        = argv._[1]
    , simple         = argv.simple || argv.s
    , ghId           = {
          user: pkgId.user || 'nodejs'
        , name: pkgId.name || 'io.js'
      }


if (!branch1 || !branch2)
  throw new Error('Must supply two branch names to compare')


map([ branch1, branch2 ], function (branch, callback) {
  collect(branch).pipe(listStream.obj(callback))
}, onCollected)


function onCollected (err, branchCommits) {
  if (err)
    throw err

  [ branch1, branch2 ].forEach(function (branch, i) {
    console.log(`${branchCommits[i].length} commits on ${branch}...`)
  })

  function isInList (commit) {
    return branchCommits[0].some(function (c) {
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

  var list = branchCommits[1].filter(function filter (commit) {
    return !isInList(commit)
  })
  
  console.log(`${list.length} commits on ${branch2} that are not on ${branch1}:`)

  collectCommitLabels(list, function (err) {
    if (err)
      throw err

    list = list.map(function (commit) {
      return commitToOutput(commit, simple, ghId)
    })

    printCommits(list)
  })
}


function printCommits (list) {
  var out = list.join('\n') + '\n'

  if (!process.stdout.isTTY)
    out = chalk.stripColor(out)

  process.stdout.write(out)
}


function collect (branch) {
  var gitcmd = `git log ${branch}`
    , child  = spawn('bash', [ '-c', gitcmd ])

  child.stderr.pipe(bl(function (err, _data) {
    if (err)
      throw err

    if (_data.length)
      process.stderr.write(_data)
  }))

  child.on('close', function (code) {
    if (code)
      throw new Error('git command [' + gitcmd + '] exited with code ' + code)
  })

  return child.stdout.pipe(split2()).pipe(commitStream())
}
