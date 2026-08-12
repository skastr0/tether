import { Schema } from "effect"

export class ConfigurationError extends Schema.TaggedError<ConfigurationError>()(
  "ConfigurationError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export class JsonInputError extends Schema.TaggedError<JsonInputError>()(
  "JsonInputError",
  {
    source: Schema.String,
    reason: Schema.String,
    message: Schema.String,
  },
) {}

export class CommandInputError extends Schema.TaggedError<CommandInputError>()(
  "CommandInputError",
  {
    field: Schema.String,
    message: Schema.String,
  },
) {}

export class GitNotFoundError extends Schema.TaggedError<GitNotFoundError>()(
  "GitNotFoundError",
  {
    message: Schema.String,
  },
) {}

export class NotAGitRepositoryError extends Schema.TaggedError<NotAGitRepositoryError>()(
  "NotAGitRepositoryError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class GitCommandError extends Schema.TaggedError<GitCommandError>()(
  "GitCommandError",
  {
    args: Schema.Array(Schema.String),
    message: Schema.String,
    exitCode: Schema.optional(Schema.NullOr(Schema.Number)),
    stderr: Schema.optional(Schema.String),
  },
) {}

export class HomeDirectoryError extends Schema.TaggedError<HomeDirectoryError>()(
  "HomeDirectoryError",
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

export type AppError =
  | ConfigurationError
  | JsonInputError
  | CommandInputError
  | GitNotFoundError
  | NotAGitRepositoryError
  | GitCommandError
  | HomeDirectoryError

export type GitRequiredError = GitNotFoundError | NotAGitRepositoryError | GitCommandError
