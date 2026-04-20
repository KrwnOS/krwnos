export function printHelp() {
  process.stdout.write(`\
krwn — пульт управления KrwnOS (Community OS)

USAGE
  krwn <command> [options]

COMMANDS
  login               Save host + token into a profile
  module <sub>        install | validate | uninstall | list
  vertical <sub>      add | list | remove
  invite              Issue a magic-link invitation (QR-ready)
  backup              Create or list full State snapshots
  token <sub>         rotate — mint new token, revoke current one
  status              Tunnel / health / version info
  help, -h            Show this help
  --version, -v       Print CLI version

EXAMPLES
  krwn login --host https://my.krwnos.app --token kt_xxx --profile home
  krwn module install finance
  krwn module validate ./packages/my-module
  krwn vertical add "Ministry of Defense" --parent ver_abc --type department
  krwn invite --node ver_recruit --label "Recruit 2026" --ttl 7d --max-uses 25
  krwn backup --out ./krwn-backup.json
  krwn token rotate --label "daily-ops"

GLOBAL
  KRWN_DEBUG=1        Print full stack traces on error

Config file:
  $XDG_CONFIG_HOME/krwnos/config.json
  (~/.config/krwnos/config.json)
`);
}
