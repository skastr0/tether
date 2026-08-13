// @tether
// @symbol greetTs
// Greeting is a rename of the caller's name, not a template.
export function greetTs(name: string): string {
  // A comment inside a body is not adjacent to greetTs.
  const x = 1
  return name
}
