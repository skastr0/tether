// @tether
// @symbol greetRs
// Say hello.
pub fn greetRs() {
    println!("hi");
}

pub fn skip_inner() {
    // @tether
    // inside a body — must not bind
    let _n = 1;
}
