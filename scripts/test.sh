. ~/.cargo/env
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contract"
export CARGO_TARGET_DIR=$HOME/tv-target
cargo test 2>&1 | tail -40
