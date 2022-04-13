# branch-diff

**A tool to list print the commits on one git branch that are not on another using loose comparison**

[![npm](https://nodei.co/npm/branch-diff.png?downloads=true&downloadRank=true)](https://nodei.co/npm/branch-diff/)
[![npm](https://nodei.co/npm-dl/branch-diff.png?months=6&height=3)](https://nodei.co/npm/branch-diff/)

## Usage

**`$ branch-diff [--sha] [--plaintext] [--markdown] [--group] [--reverse] [--patch-only] base-branch comparison-branch`**

A commit is considered to be in the comparison-branch but not in the base-branch if:

* the commit sha is identical, or
* the commit summary is identical _and_ the commit description is identical _and_ a `PR-URL` exists in the metadata and is identical (in the description but split out by commit-stream)

The output is the same as [changelog-maker](https://github.com/rvagg/changelog-maker/) and you can use `--simple` to simplify it for console output instead of Markdown.

The commit list is very close to running:

`$ git log main..next`

But the comparison isn't quite as strict, generally leading to a shorter list of commits.

### Options

* `--version`: Only prints branch-diff's package.json version.
* `--group` or `-g`: Group commits by prefix, this uses the part of the commit summary that is usually used in Node.js core to indicate subsystem for example. Groups are made up of numbers, letters, `,` and `-`, followed by a `:`.
* `--exclude-label`: Exclude any commits from the list that come from a GitHub pull request with the given label. Multiple `--exclude-label` options may be provided, they will also be split by `,`. e.g. `--exclude-label=semver-major,meta`.
* `--require-label`: Only include commits in the list that come from a GitHub pull request with the given label. Multiple `--require-label` options may be provided, they will also be split by `,`. e.g. `--require-label=test,doc`.
* `--patch-only`: An alias for `--exclude-label=semver-major,semver-minor`.
* `--format`: Dictates what formatting the output will have. Possible options are: `simple`, `markdown`, `plaintext`, and `sha`. The default is to print a `simple` output suitable for stdout.
  - `simple`: Don't print full markdown output, good for console printing without the additional fluff.
  - `sha`: Print only the 10-character truncated commit hashes. Good for piping though additional tooling, such as `xargs git cherry-pick` for applying commits.
  - `plaintext`: A very simple form, without commit details, implies `--group`.
  - `markdown`: A Markdown formatted from, with links and proper escaping.
* `--sha`: Same as `--format=sha`.
* `--plaintext`: Same as `--format=plaintext`.
* `--markdown`: Same as `--format=markdown`.
* `--filter-release`: Exclude Node-style release commits from the list. e.g. `Working on v1.0.0` or `2015-10-21 Version 2.0.0`.
* `--reverse`: Reverse the results, this is especially useful when piping output to `xargs`.
* `--commit-url`:A URL template which will be used to generate commit URLs for a repository not hosted in GitHub. `{ref}` is the placeholder that will be replaced with the commit, i.e. `--commit-url=https://gitlab.com/myUser/myRepo/commit/{ref}`. `{ghUser}` and `{ghRepo}` are available if they can be derived from package.json (Gitlab and Bitbucket URLs should be understood in package.json).
* `--user`: Override the auto-detected GitHub user/org derived from package.json
* `--repo`: Override the auto-detected GitHub repository name derived from package.json

## License

**branch-diff** is Copyright (c) 2015 Rod Vagg [@rvagg](https://twitter.com/rvagg) and licenced under the MIT licence. All rights not explicitly granted in the MIT license are reserved. See the included LICENSE.md file for more details.
