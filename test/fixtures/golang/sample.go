package sample

// @tether
// @symbol greetGo
// Greeting is a rename of the caller's name, not a template.
func greetGo() {}

func skipInner() {
	// @tether
	// inside a body — must not bind
	_ = 0
}
