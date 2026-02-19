#!/usr/bin/env bash
# Локальные тесты Arcium: обход проблемы, когда node не стартует из-за --warp-slot.
# Использование: скопировать в корень проекта arcium_hello на VPS и запускать:
#   chmod +x run_test.sh
#   ./run_test.sh
# Вместо: arcium test
# См. docs/PRIVATE-VOTING-STEPS.md, раздел «Ошибки при запуске arcium test», пункт 3.

set -euo pipefail
REAL_SOLANA_TEST_VALIDATOR="$(command -v solana-test-validator)"
WRAP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WRAP_DIR"
}
trap cleanup EXIT
cat > "$WRAP_DIR/solana-test-validator" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REAL_SOLANA_TEST_VALIDATOR="${REAL_SOLANA_TEST_VALIDATOR:?REAL_SOLANA_TEST_VALIDATOR is not set}"
filtered_args=()
while (($#)); do
  if [[ "$1" == "--warp-slot" ]]; then
    shift 2
    continue
  fi
  filtered_args+=("$1")
  shift
done
exec "$REAL_SOLANA_TEST_VALIDATOR" "${filtered_args[@]}"
EOF
chmod +x "$WRAP_DIR/solana-test-validator"
# Увеличить стек для Rust unit-тестов (обход Stack offset exceeded в arcium_client)
export RUST_MIN_STACK="${RUST_MIN_STACK:-33554432}"
REAL_SOLANA_TEST_VALIDATOR="$REAL_SOLANA_TEST_VALIDATOR" PATH="$WRAP_DIR:$PATH" arcium test "$@"
