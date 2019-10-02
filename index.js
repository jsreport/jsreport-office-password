const main = require('./lib/main.js')
const config = require('./jsreport.config.js')

module.exports = function (options) {
  const newConfig = Object.assign({}, config)

  newConfig.options = options
  newConfig.main = main
  newConfig.directory = __dirname

  return newConfig
}
