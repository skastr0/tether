# @tether
# @symbol greet
# Greet is a rename of a greeting, not a template.
def greet(name)
  # @tether
  # Inner comment must not bind to greet or to this assignment.
  prefix = "hello"
  "#{prefix} #{name}"
end
