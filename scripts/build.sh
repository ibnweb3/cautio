. ~/.cargo/env
cd /mnt/c/Users/IBN/Documents/Claude/TenancyVault/contract
export CARGO_TARGET_DIR=$HOME/tv-target
rustup toolchain list | grep -q nightly || rustup toolchain install nightly --profile minimal -c rust-src --target wasm32-unknown-unknown >/dev/null 2>&1
export RUSTFLAGS="--remap-path-prefix=$HOME=/h --remap-path-prefix=/mnt/c/Users/IBN/Documents/Claude/TenancyVault=/src -C target-cpu=mvp -C link-arg=-s"
cargo +nightly build --release --target wasm32-unknown-unknown -Z build-std=std,panic_abort 2>&1 | tail -5
mkdir -p ../build && cp $CARGO_TARGET_DIR/wasm32-unknown-unknown/release/tenancy_vault.wasm ../build/tenancy_vault.wasm
