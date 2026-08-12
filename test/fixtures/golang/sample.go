package sample

// @tether
// @symbol RefreshSession
// Refresh is a rename of session state, not an in-place patch.
func RefreshSession() {}

func skipInner() {
	// @tether
	// inside a body — must not bind
	_ = 0
}
