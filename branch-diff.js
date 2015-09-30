#!/usr/bin/env node

'use strict'

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
    , groupCommits   = require('changelog-maker/group-commits')

    , pkgFile        = path.join(process.cwd(), 'package.json')
    , pkgData        = fs.existsSync(pkgFile) ? require(pkgFile) : {}
    , pkgId          = pkgtoId(pkgData)
    , branch1        = argv._[0]
    , branch2        = argv._[1]
    , simple         = argv.simple || argv.s
    , ghId           = {
          user: pkgId.user || 'nodejs'
        , name: pkgId.name || 'node'
      }


if (!branch1 || !branch2)
  throw new Error('Must supply two branch names to compare')


function findMergeBase (callback) {
  const gitcmd = `git merge-base ${branch1} ${branch2}`
  rungit(gitcmd).pipe(bl((err, data) => {
    if (err)
      return callback(err)

    callback(null, data.toString().substr(0, 10))
  }))
}


findMergeBase((err, commit) => {
  console.log(`Merge base of ${branch1} and ${branch2} is ${commit}`)

  map([ branch1, branch2 ], (branch, callback) => {
    collect(branch, commit).pipe(listStream.obj(callback))
  }, onCollected)
})

function onCollected (err, branchCommits) {
  if (err)
    throw err

  [ branch1, branch2 ].forEach((branch, i) => {
    console.log(`${branchCommits[i].length} commits on ${branch}...`)
  })

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
  
  console.log(`${list.length} commits on ${branch2} that are not on ${branch1}:`)

  collectCommitLabels(list, (err) => {
    if (err)
      throw err

    if (argv.group)
      list = groupCommits(list)

    list = list.map((commit) => commitToOutput(commit, simple, ghId))

    printCommits(list)
  })
}


function printCommits (list) {
  let out = list.join('\n') + '\n'

  if (!process.stdout.isTTY)
    out = chalk.stripColor(out)

  process.stdout.write(out)
}


function collect (branch, startCommit) {
  const gitcmd = `git log ${startCommit}..${branch}`
  return rungit(gitcmd)
    .pipe(split2())
    .pipe(commitStream(ghId.user, ghId.name))
}


function rungit (gitcmd) {
  const child = spawn('bash', [ '-c', gitcmd ])

  child.stderr.pipe(bl((err, _data) => {
    if (err)
      throw err

    if (_data.length)
      process.stderr.write(_data)
  }))

  child.on('close', (code) => {
    if (code)
      throw new Error('git command [' + gitcmd + '] exited with code ' + code)
  })

  return child.stdout
}
