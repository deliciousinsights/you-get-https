/**
 * You-Get-HTTP! -- A configurable HTTPS frontline for local development servers
 * listening as HTTP, using a thin wrapper on top of the devcert tool.
 *
 * © 2020 Christophe Porteneuve & Delicious Insights
 *
 * @see https://github.com/deliciousinsights/you-get-https#readme
 */

const { certificateFor } = require('devcert')
const { readConfig } = require('./config')

run()

async function run() {
  const config = await readConfig()
  const ssl = await certificateFor('assets.premiercadeau.test')
  console.log(ssl)
}
