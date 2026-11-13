# Reproducible build. Run inside Linux or WSL. Toolchain used for the published hash is printed at the end.
# Needs: rustup nightly with rust-src + wasm32-unknown-unknown, and binaryen's wasm-opt (npm "binaryen" in $WASM_OPT_DIR or on PATH).
. ~/.cargo/env
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contract"
export CARGO_TARGET_DIR=$HOME/tv-target
rustup toolchain list | grep -q nightly || rustup toolchain install nightly --profile minimal -c rust-src --target wasm32-unknown-unknown >/dev/null 2>&1
# --cfg near makes panics use the on-chain host functions, so failures show their real message instead of "unreachable".
export RUSTFLAGS="--cfg near --remap-path-prefix=$HOME=/h --remap-path-prefix=$ROOT=/src -C target-cpu=mvp -C link-arg=-s"
cargo +nightly build --release --target wasm32-unknown-unknown -Z build-std=std,panic_abort 2>&1 | tail -5
mkdir -p "$ROOT/build" && cp $CARGO_TARGET_DIR/wasm32-unknown-unknown/release/tenancy_vault.wasm "$ROOT/build/tenancy_vault.wasm"
WASM_OPT="${WASM_OPT:-$HOME/tools/node_modules/.bin/wasm-opt}"
[ -x "$WASM_OPT" ] || WASM_OPT=wasm-opt
"$WASM_OPT" --mvp-features -Oz "$ROOT/build/tenancy_vault.wasm" -o "$ROOT/build/opt.wasm"
echo "rustc: $(rustc +nightly --version)"; echo "wasm-opt: $("$WASM_OPT" --version)"
sha256sum "$ROOT/build/opt.wasm"; wc -c "$ROOT/build/opt.wasm"
