// @tether
// @symbol refreshSession
// Refresh is a rename of session state, not an in-place patch.
func refreshSession() {}

func ignoreInner() {
    // @tether
    // Inner comment must not bind to ignoreInner.
    print("no")
}
