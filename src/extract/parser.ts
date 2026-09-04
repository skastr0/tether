import { Schema } from "effect"
import { extname } from "node:path"
import {
  Language,
  LANGUAGE_VERSION,
  MIN_COMPATIBLE_VERSION,
  Parser,
  type Tree,
} from "web-tree-sitter"

import {
  golang,
  javascript,
  python,
  ruby,
  rust,
  tsx,
  typescript,
  type LanguageId,
  type LanguageProfile,
} from "./languages"
import { resolveRuntimeWasm, resolveWasmAsset } from "./assets"

export class ExtractParserError extends Schema.TaggedError<ExtractParserError>()(
  "ExtractParserError",
  {
    message: Schema.String,
  },
) {}

const PROFILES = {
  javascript,
  typescript,
  tsx,
  rust,
  golang,
  ruby,
  python,
} as const satisfies Record<LanguageId, LanguageProfile>

const extensionToLanguage = new Map<string, LanguageId>()
for (const profile of Object.values(PROFILES)) {
  for (const extension of profile.extensions) {
    extensionToLanguage.set(extension, profile.id)
  }
}

let initPromise: Promise<void> | undefined
const languageCache = new Map<LanguageId, Promise<Language>>()
const missingGrammars = new Set<LanguageId>()

export const profileForLanguage = (id: LanguageId): LanguageProfile => {
  const profile = PROFILES[id]
  if (profile === undefined) {
    throw new ExtractParserError({ message: `unsupported language: ${id}` })
  }
  return profile
}

export const languageForPath = (filePath: string): LanguageId | undefined => {
  const extension = extname(filePath)
  if (extension.length < 2) {
    return undefined
  }
  return extensionToLanguage.get(extension.slice(1))
}

export const resolveGrammarWasm = (id: LanguageId): string => {
  const profile = profileForLanguage(id)
  try {
    return resolveWasmAsset(profile.grammar)
  } catch {
    throw new ExtractParserError({ message: `grammar wasm not found: ${profile.grammar}` })
  }
}

export const initParser = (): Promise<void> => {
  initPromise ??= Parser.init({
    locateFile: (scriptName: string) => {
      if (scriptName === "tree-sitter.wasm") {
        return resolveRuntimeWasm()
      }
      return scriptName
    },
  })
  return initPromise
}

export const loadLanguage = (id: LanguageId): Promise<Language> => {
  let pending = languageCache.get(id)
  if (pending === undefined) {
    pending = loadLanguageUncached(id).catch((error: unknown) => {
      languageCache.delete(id)
      throw error
    })
    languageCache.set(id, pending)
  }
  return pending
}

// Missing wasm is cached; callers skip instead of throwing.
export const languageReady = async (id: LanguageId): Promise<boolean> => {
  if (missingGrammars.has(id)) {
    return false
  }
  try {
    await loadLanguage(id)
    return true
  } catch (error) {
    if (error instanceof ExtractParserError && error.message.includes("grammar wasm not found")) {
      missingGrammars.add(id)
      return false
    }
    throw error
  }
}

const loadLanguageUncached = async (id: LanguageId): Promise<Language> => {
  await initParser()
  const wasmPath = resolveGrammarWasm(id)
  let language: Language
  try {
    language = await Language.load(wasmPath)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new ExtractParserError({
      message: `failed to load grammar wasm ${profileForLanguage(id).grammar}: ${detail}`,
    })
  }

  const abi = language.abiVersion
  if (abi < MIN_COMPATIBLE_VERSION || abi > LANGUAGE_VERSION) {
    throw new ExtractParserError({
      message: `grammar ${profileForLanguage(id).grammar} abi ${abi} is outside runtime ${MIN_COMPATIBLE_VERSION}-${LANGUAGE_VERSION}`,
    })
  }

  return language
}

export const parseSource = async (id: LanguageId, source: string): Promise<Tree> => {
  const language = await loadLanguage(id)
  const parser = new Parser()
  try {
    parser.setLanguage(language)
    const tree = parser.parse(source)
    if (tree === null) {
      throw new ExtractParserError({ message: `tree-sitter failed to parse ${id} source` })
    }
    return tree
  } finally {
    parser.delete()
  }
}

