#!/usr/bin/env node
/**
 * Installs the personal agent into one DSH profile: a profile from the shipped web template, this bundle, and the
 * settings it needs to run unattended. Prints the one command that starts it.
 *
 * Usage: node scripts/install.mjs [--profile personal] [--port 3082] [--home ~/.dsh] [--bundle <spec>]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1] ?? fallback
}
const profile = option('profile', 'personal')
const port = Number(option('port', '3082'))
const home = resolve(option('home', process.env.DSH_HOME || join(homedir(), '.dsh')))
const bundle = option('bundle', here)
const withMemory = !args.includes('--no-memory')
const MEMORY = 'https://github.com/yinguobing/dsh-memory-index/releases/download/v0.1.0/dsh-memory-index-0.1.0.tgz'
const dsh = process.env.DSH_BIN || 'dsh'
const run = (argv) => execFileSync(dsh, argv, { stdio: 'inherit', env: { ...process.env, DSH_HOME: home } })

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`--port must be a port number, not ${option('port', '')}`)
  process.exit(2)
}

mkdirSync(home, { recursive: true })
const profileDir = join(home, 'profiles', profile)
const patch = join(profileDir, 'cordis.patch.yml')

// 1. A profile with the shipped web app, so the panel and the chat exist before this bundle is added.
if (!existsSync(join(profileDir, 'package.json'))) {
  console.log(`Creating profile ${profile} from the shipped web template...`)
  run(['--profile', profile, '--from-default-profile', 'web', '--dump-config'])
}

// 2. This bundle, as a local package.
// A local directory installs as `file:`; anything else is passed through as a package spec.
const spec = bundle.startsWith('.') || bundle.startsWith('/') ? `file:${resolve(bundle)}` : bundle
console.log(`Installing ${spec} into profile ${profile}...`)
run(['plugin', '--profile', profile, 'add', spec])

// 3. Memory: the agent keeps MEMORY.md and memory/ in its state directory. Until DSH has its own, this plugin is it.
if (withMemory) {
  // The memory plugin resolves its workspace at load time, before the agent creates it.
  mkdirSync(join(home, 'state', 'superagent', 'memory'), { recursive: true })
  console.log('Installing dsh-memory-index for long-term memory...')
  try { run(['plugin', '--profile', profile, 'add', MEMORY]) }
  catch { console.log('Could not install dsh-memory-index; continue without memory (--no-memory to skip next time).') }
}

// 4. The settings the bundle needs: a state directory, the panel port, and worker permissions that do not wait for
//    an approval nobody can give.
const existing = existsSync(patch) ? readFileSync(patch, 'utf8') : ''
const configured = existing.split('\n').some(line => /^\s*-\s+id:\s*dsh-superagent\s*$/.test(line))
// A fresh profile's patch is comments and an empty list; replace that instead of appending a second document.
const comments = existing.split('\n').filter(line => line.trim().startsWith('#')).join('\n')
const body = existing.split('\n').filter(line => line.trim() && !line.trim().startsWith('#')).join('\n').trim()
if (configured) {
  console.log(`\n${patch} already configures dsh-superagent; leaving it alone.`)
} else {
  const text = `${comments ? `${comments}\n` : ''}${body && body !== '[]' ? `${body}\n` : ''}${[
    `- id: webserver`,
    `  config:`,
    `    host: 127.0.0.1`,
    `    port: ${port}`,
    `- id: dsh-superagent`,
    `  config:`,
    `    stateDir: ${JSON.stringify(join(home, 'state', 'superagent'))}`,
    `    digestHour: 8`,
    `- id: memory-index`,
    `  config:`,
    `    workspace: ${JSON.stringify(join(home, 'state', 'superagent'))}`,
    `    writeMode: readwrite`,
    `    autoRecall: startup`,
    `    buildOnStart: true`,
    `    timeZone: ${JSON.stringify(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')}`,
    `- id: dsh-superagent-github`,
    `  disabled: true`,
    `- id: dsh-superagent-feishu`,
    `  disabled: true`,
    `- id: dsh-superagent-weixin`,
    `  disabled: true`,
    `# A worker writes only in its ticket directory, and runs unattended: a refusal is final, not a question.`,
    `- id: permission`,
    `  config:`,
    `    defaultPreset: workspace-write`,
    `    presets:`,
    `      read-only:`,
    `        sandbox: read-only`,
    `        approval: ask`,
    `      workspace-write:`,
    `        sandbox: workspace-write`,
    `        approval: never`,
    `      danger-full-access:`,
    `        sandbox: danger-full-access`,
    `        approval: never`,
  ].join('\n')}\n`
  writeFileSync(patch, text)
  console.log(`Wrote ${patch}.`)
}

// 5. A model provider is the one thing the installer cannot arrange: without a key every turn fails, and the panel
//    shows the question but never the answer.
const credentials = join(home, '.credentials.yaml')
const hasKey = existsSync(credentials) && readFileSync(credentials, 'utf8').includes('DEEPSEEK_API_KEY')
const defaultHome = resolve(process.env.DSH_HOME_DEFAULT || join(homedir(), '.dsh'))
const defaultCredentials = join(defaultHome, '.credentials.yaml')
const copyable = !hasKey && defaultHome !== home && existsSync(defaultCredentials)
  && readFileSync(defaultCredentials, 'utf8').includes('DEEPSEEK_API_KEY')
if (!hasKey) {
  console.log(`
Before it can answer, give it a model key. It looks for DEEPSEEK_API_KEY in ${credentials}, and without one every
turn fails with "no API key for provider route".`)
  console.log(copyable
    ? `This machine already has one for the default profile; copy it over with:\n\n  cp ${defaultCredentials} ${credentials}\n`
    : `Set it once in the web UI (Models), or put it in that file.\n`)
}

console.log(`
Installed. Start it with:

  DSH_HOME=${home} ${dsh} --profile ${profile}

It prints a URL with a token; open it and use the Superagent panel: "Talk to it" is the entry, and its own folder
for material is ${join(home, 'state', 'superagent', 'inbox')}.

To let it reach you on WeChat, add a bot account with dsh-weixin-login, then enable dsh-superagent-weixin in
${patch}. To have it watch a GitHub repository instead, enable dsh-superagent-github and fill its account there.`)
