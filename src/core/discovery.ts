import { JSONSchema, Schema } from "effect"

export type CommandCategory = "workflow" | "diagnostic" | "discovery"

export interface CommandSchemaContract {
  readonly command_id: string
  readonly command: string
  readonly schema_id: string
  readonly description: string
  readonly schema: Schema.Schema.AnyNoContext
  readonly accepts_batch?: boolean
  readonly input_modes?: readonly string[]
}

export interface CommandExample {
  readonly command_id: string
  readonly command: string
  readonly name: string
  readonly description?: string
  readonly args?: readonly string[]
  readonly input?: unknown
}

export interface CommandCapability {
  readonly command_id: string
  readonly command: string
  readonly category: CommandCategory
  readonly description: string
  readonly schemas?: readonly CommandSchemaContract[]
  readonly examples?: readonly CommandExample[]
  readonly batch?: {
    readonly accepts_batch: boolean
    readonly default_concurrency: number
    readonly supports_concurrency_option: boolean
  }
}

export const renderSchemaContract = (contract: CommandSchemaContract) => ({
  command_id: contract.command_id,
  command: contract.command,
  schema_id: contract.schema_id,
  description: contract.description,
  accepts_batch: contract.accepts_batch ?? false,
  input_modes: contract.input_modes ?? ["inline-json", "@file", "stdin"],
  schema: JSONSchema.make(contract.schema),
})
