# @tether
# @symbol greet
# Adjacency binds this comment to greet.
def greet(name: str) -> str:
    # @tether
    # Negative: a marked comment inside a body does not bind.
    x = 1
    return f"hello {name}"
