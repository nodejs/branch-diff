const spawn    = require('child_process').spawn
    , bl       = require('bl')


function exec (repoPath, gitcmd) {
  const child = spawn('bash', [ '-c', gitcmd ], { env: process.env, cwd: repoPath })

  child.stderr.pipe(bl((err, _data) => {
    if (err)
      return child.stdout.emit('error', err)

    if (_data.length)
      process.stderr.write(_data)
  }))

  child.on('close', (code) => {
    if (!code)
      return
    child.stdout.emit(
        'error'
      , new Error('git command [' + gitcmd + '] exited with code ' + code)
    )
  })

  return child.stdout
}


function execCollect (repoPath, gitcmd, callback) {
  exec(repoPath, gitcmd).pipe(bl((err, _data) => {
    if (err)
      return callback(err)

    callback(null, _data.toString())
  }))
}


module.exports.exec        = exec
module.exports.execCollect = execCollect
