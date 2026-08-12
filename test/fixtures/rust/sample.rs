// @tether
// @symbol greet
// Say hello.
pub fn greet() {
    println!("hi");
}

pub fn skip_inner() {
    // @tether
    // inside a body — must not bind
    let _n = 1;
}
