# @tether
# @symbol greetPy
# Adjacency binds this comment to greetPy.
def greetPy(name: str) -> str:
    # @tether
    # Negative: a marked comment inside a body does not bind.
    x = 1
    return f"hello {name}"
