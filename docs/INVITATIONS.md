# Invitations — Magic Links & QR-паспорта

Мы сознательно уходим от «логин-пароль-подтверди-email». Путь в
государство — одна ссылка, одно касание.

---

## Поток

```
Суверен ──► krwn invite --node <id>  ──► token + url + qr
                                 │
                                 ▼
           https://<state>/invite/<token>
                                 │
                                 ▼
              Passkey / Wallet challenge
                                 │
                                 ▼
     POST /api/invite/<token>/accept
                                 │
                                 ▼
        Membership создан в targetNodeId
                                 │
                                 ▼
           Dynamic UI собран под роль
```

---

## Хранение

- В БД хранится только **SHA-256(token)** (`Invitation.tokenHash`).
  Plaintext-токен показывается один раз при создании.
- Дополнительно выдаётся короткий код вида `KRWN-7HX2-9KQ4`
  (Crockford alphabet, 8 символов, без двусмысленных `0/O`, `1/I`).
  Используется для офлайн-обмена и QR.
- Поля: `targetNodeId`, `maxUses`, `usesCount`, `expiresAt`,
  `status: active|consumed|revoked|expired`, `label`.

---

## Безопасность

- **Rate limiting:** /invite/{token}/accept должен быть rate-limited
  по IP и по user-agent (TODO: middleware).
- **Single-use by default:** `maxUses = 1`, если явно не указано иное.
- **TTL:** максимум 1 год; CLI не принимает больше.
- **Revocation:** `krwn invite revoke <id>` (или UI) мгновенно
  переключает статус.
- **Enumeration resistance:** токен — 256 бит энтропии base64url,
  `code` — 40 бит (достаточно для UX, но основная защита — `token`).

---

## Passkey / Wallet challenge

После открытия `/invite/<token>`:

1. Если у пользователя нет аккаунта — создаётся shell-учётка.
2. `CredentialProvider` соответствующего `kind` запускает
   `beginLogin()` → возвращает WebAuthn options / SIWE message.
3. Клиент подписывает, отправляет обратно — `completeLogin()`
   возвращает `UserRef`.
4. `InvitationsService.consume(token, user)` создаёт `Membership`.

Провайдеры регистрируются в `credentialsRegistry` при bootstrap.
Ядро ничего не знает про `@simplewebauthn/server` или `siwe` — только
контракт `CredentialProvider`.

---

## QR-паспорт

QR кодирует **полный URL** (не только код), чтобы сканирование любым
стандартным приложением сразу вело в браузер. `code` — это fallback
для ручного ввода в киоске или на ивенте.

Рекомендуемая компоновка для оффлайн-печати (tier 3 features):

```
┌─────────────────────────────┐
│ Приглашение в «Clan X»      │
│ Роль: Recruit               │
│                             │
│     ▓▓▓▓   ▓▓▓▓ ▓▓          │
│     ▓▓ ▓   ▓ ▓  ▓▓▓   QR    │
│     ▓▓ ▓   ▓ ▓▓ ▓ ▓         │
│                             │
│ code: KRWN-7HX2-9KQ4        │
│ exp:  2026-04-25            │
└─────────────────────────────┘
```

QR можно сгенерировать на стороне сервера (pure-JS библиотека)
и отдать data URI в поле `IssuedInvitation.qr` (см. kernel types).
