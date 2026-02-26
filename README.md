# Private DAO Voting MVP

This project demonstrates a simplified DAO voting interface and highlights
the governance issues of transparent voting systems.

## Problem

In traditional DAO voting, votes are often visible or can be inferred before
the final tally. This leads to strategic voting, social pressure, and reduced
decision quality.

## MVP Overview

The current MVP implements:
- A voting interface
- Single-vote enforcement
- Local vote storage
- A basic results page

This implementation intentionally exposes the core privacy problem.

## Arcium Integration

- **Шифрование**: голоса шифруются через Arcium SDK (RescueCipher + x25519 ECDH). Режимы:
  - **Demo** (по умолчанию): тот же cipher, без привязки к MXE (для тестов).
  - **MXE**: задайте `ARCIUM_MXE_PROGRAM_ID` в `.env` — тогда используется реальный публичный ключ MXE с Devnet.
- **Хранение**: зашифрованные голоса сохраняются локально (localStorage); отправка в Arcium/Solana — следующий шаг.
