# branch-diff

**A tool to list print the commits on one git branch that are not on another using lose comparison**

[![npm](https://nodei.co/npm/changelog-maker.png?downloads=true&downloadRank=true)](https://nodei.co/npm/changelog-maker/)
[![npm](https://nodei.co/npm-dl/changelog-maker.png?months=6&height=3)](https://nodei.co/npm/changelog-maker/)

## Usage

**`$ branch-diff base-branch comparison-branch [--simple]`**

A commit is considered to be in the comparison-branch but not in the base-branch if:

* the commit sha is identical, or
* the commit summary is identical _and_ the commit description is identical _and_ a `PR-URL` exists in the metadata and is identical (in the description but split out by commit-stream)

The output is the same as [changelog-maker](https://github.com/rvagg/changelog-maker/) and you can use `--simple` to simplify it for console output instead of Markdown.

The commit list is very close to running:

`$ git log master..next`

But the comparison isn't quite as strict, generally leading to a shorter list of commits.

## License

**branch-diff** is Copyright (c) 2015 Rod Vagg [@rvagg](https://twitter.com/rvagg) and licenced under the MIT licence. All rights not explicitly granted in the MIT license are reserved. See the included LICENSE.md file for more details.
