# @tether
# @symbol greet
# Adjacency binds this comment to greet.
def greet(name: str) -> str:
    # @tether
    # Negative: a marked comment inside a body does not bind.
    return f"hello {name}"
