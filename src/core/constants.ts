declare const APP_VERSION: string | undefined

export const CLI_NAME = "tether"
export const CLI_VERSION = typeof APP_VERSION === "string" ? APP_VERSION : "0.1.0"
export const PROTOCOL_VERSION = "agentic-cli-template/v1"
export const TETHER_HOME_ENV = "TETHER_HOME"
export const DEFAULT_TETHER_HOME = "~/.config/tether"
export const USER_AGENT = `${CLI_NAME}/${CLI_VERSION}`

export const DEFAULT_MARKDOWN_ALLOWLIST = [
  "README.md",
  "LICENSE.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SUPPORT.md",
  "CHANGELOG.md",
  "AUTHORS.md",
  "NOTICE.md",
] as const

export const HONORARY_MARKDOWN = ["AGENTS.md", "CLAUDE.md"] as const
