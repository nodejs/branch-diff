#!/usr/bin/env node

import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import process from 'process'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import commitStream from 'commit-stream'
import split2 from 'split2'
import pkgtoId from 'pkg-to-id'
import minimist from 'minimist'
import { isReleaseCommit } from 'changelog-maker/groups'
import { processCommits } from 'changelog-maker/process-commits'
import { collectCommitLabels } from 'changelog-maker/collect-commit-labels'
import gitexec from 'gitexec'

const pkgFile = path.join(process.cwd(), 'package.json')
const require = createRequire(import.meta.url)
const pkgData = fs.existsSync(pkgFile) ? require(pkgFile) : {}
const pkgId = pkgtoId(pkgData)
const refcmd = 'git rev-list --max-count=1 {{ref}}'
const commitdatecmd = '$(git show -s --format=%cd `{{refcmd}}`)'
const gitcmd = 'git log {{startCommit}}..{{branch}} --until="{{untilcmd}}"'
const ghId = {
  user: pkgId.user || 'nodejs',
  repo: pkgId.name || 'node'
}

function replace (s, m) {
  Object.keys(m).forEach(function (k) {
    s = s.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), m[k])
  })
  return s
}

export async function branchDiff (branch1, branch2, options) {
  if (!branch1 || !branch2) {
    throw new Error('Must supply two branch names to compare')
  }

  const repoPath = options.repoPath || process.cwd()
  const commit = await findMergeBase(repoPath, branch1, branch2)
  const branchCommits = await Promise.all([branch1, branch2].map(async (branch) => {
    return collect(repoPath, branch, commit, branch === branch2 && options.endRef)
  }))
  return await diffCollected(options, branchCommits)
}

async function findMergeBase (repoPath, branch1, branch2) {
  const gitcmd = `git merge-base ${branch1} ${branch2}`
  const data = await promisify(gitexec.execCollect)(repoPath, gitcmd)
  return data.substr(0, 10)
}

function normalizeIfTrailingSlash (commit) {
  if (commit.prUrl.at(-1) === '/') {
    commit.prUrl = commit.prUrl.slice(0, -1)
  }
}

async function diffCollected (options, branchCommits) {
  function isInList (commit) {
    normalizeIfTrailingSlash(commit)
    return branchCommits[0].some((c) => {
      if (commit.sha === c.sha) { return true }
      if (commit.summary === c.summary) {
        normalizeIfTrailingSlash(c)
        if (commit.prUrl && c.prUrl) {
          return commit.prUrl === c.prUrl
        } else if (commit.author.name === c.author.name &&
                commit.author.email === c.author.email) {
          if (process.stderr.isTTY) {
            console.error(`Note: Commit fell back to author checking: "${commit.summary}" -`, commit.author)
          }
          return true
        }
      }
      return false
    })
  }

  let list = branchCommits[1].filter((commit) => !isInList(commit))

  await collectCommitLabels(list)

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

  return list
}

async function collect (repoPath, branch, startCommit, endRef) {
  const endrefcmd = endRef && replace(refcmd, { ref: endRef })
  const untilcmd = endRef ? replace(commitdatecmd, { refcmd: endrefcmd }) : ''
  const _gitcmd = replace(gitcmd, { branch, startCommit, untilcmd })

  const commitList = []
  await pipeline(
    gitexec.exec(repoPath, _gitcmd),
    split2(),
    commitStream(ghId.user, ghId.repo),
    async function * (source) {
      for await (const commit of source) {
        commitList.push(commit)
      }
    })
  return commitList
}

async function main () {
  const minimistConfig = {
    boolean: ['version', 'group', 'patch-only', 'simple', 'filter-release', 'reverse']
  }
  const argv = minimist(process.argv.slice(2), minimistConfig)
  const branch1 = argv._[0]
  const branch2 = argv._[1]
  const group = argv.group || argv.g
  const endRef = argv['end-ref']
  let excludeLabels = []
  let requireLabels = []

  if (argv.version || argv.v) {
    return console.log(`v ${require('./package.json').version}`)
  }

  if (argv['patch-only']) {
    excludeLabels = ['semver-minor', 'semver-major']
  }

  if (argv['exclude-label']) {
    if (!Array.isArray(argv['exclude-label'])) {
      argv['exclude-label'] = argv['exclude-label'].split(',')
    }
    excludeLabels = excludeLabels.concat(argv['exclude-label'])
  }

  if (argv['require-label']) {
    if (!Array.isArray(argv['require-label'])) {
      argv['require-label'] = argv['require-label'].split(',')
    }
    requireLabels = requireLabels.concat(argv['require-label'])
  }

  if (argv.user) {
    ghId.user = argv.user
  }

  if (argv.repo) {
    ghId.repo = argv.repo
  }

  const options = {
    group,
    excludeLabels,
    requireLabels,
    endRef
  }

  let list = await branchDiff(branch1, branch2, options)
  if (argv['filter-release']) {
    list = list.filter((commit) => !isReleaseCommit(commit.summary))
  }

  await processCommits(argv, ghId, list)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
