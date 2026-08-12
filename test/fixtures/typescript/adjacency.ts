// @tether
// @symbol greet
// Greeting is a rename of the caller's name, not a template.
export function greet(name: string): string {
  // @tether
  // A comment inside a body is not adjacent to greet.
  const x = 1
  return name
}
