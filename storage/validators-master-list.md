# Validators Master List

**Signature**: `(value: unknown, errors: ErrorType) => void`
**Factory signature**: `(config, error?) => (value: unknown, errors: ErrorType) => void`

Existing: `min(n, error?)`, `max(n, error?)`, `range(min, max, error?)`

---

## String — Format

### email

| Validator | Description |
|-----------|-------------|
| `email` | General email format |
| `email.rfc5322` | Strict RFC 5322 |
| `email.html5` | Browser-compatible (HTML5 spec) |
| `email.unicode` | Allows Unicode characters |

### url

| Validator | Description |
|-----------|-------------|
| `url` | Any URL |
| `url.http` | HTTP URLs only |
| `url.https` | HTTPS URLs only |

### uuid

| Validator | Description |
|-----------|-------------|
| `uuid` | Any UUID version |
| `uuid.v1` | UUID version 1 (timestamp) |
| `uuid.v2` | UUID version 2 (DCE) |
| `uuid.v3` | UUID version 3 (MD5 namespace) |
| `uuid.v4` | UUID version 4 (random) |
| `uuid.v5` | UUID version 5 (SHA-1 namespace) |
| `uuid.v6` | UUID version 6 (reordered timestamp) |
| `uuid.v7` | UUID version 7 (Unix epoch timestamp) |
| `uuid.v8` | UUID version 8 (custom) |

### ip

| Validator | Description |
|-----------|-------------|
| `ip` | IPv4 or IPv6 |
| `ip.v4` | IPv4 address |
| `ip.v6` | IPv6 address |
| `ip.v4.cidr` | IPv4 CIDR block |
| `ip.v6.cidr` | IPv6 CIDR block |

### base64

| Validator | Description |
|-----------|-------------|
| `base64` | Standard Base64 |
| `base64.url` | URL-safe Base64 |

### hex

| Validator | Description |
|-----------|-------------|
| `hex` | Hexadecimal string |
| `hex.color` | Hex color (#RGB / #RRGGBB / #RRGGBBAA) |

### iso

| Validator | Description |
|-----------|-------------|
| `iso.date` | ISO 8601 date (YYYY-MM-DD) |
| `iso.time` | ISO 8601 time (HH:mm:ss) |
| `iso.dateTime` | ISO 8601 datetime (YYYY-MM-DDTHH:mm:ss) |
| `iso.duration` | ISO 8601 duration (P1Y2M3DT4H5M6S) |
| `iso.timestamp` | ISO datetime with timezone offset |
| `iso.week` | ISO week (YYYY-Www) |

### mac

| Validator | Description |
|-----------|-------------|
| `mac` | Any MAC address |
| `mac.v48` | 48-bit MAC (AA:BB:CC:DD:EE:FF) |
| `mac.v64` | 64-bit MAC (EUI-64) |

### hash

| Validator | Description |
|-----------|-------------|
| `hash.md5` | MD5 hash (32 hex chars) |
| `hash.sha1` | SHA-1 hash (40 hex chars) |
| `hash.sha256` | SHA-256 hash (64 hex chars) |
| `hash.sha384` | SHA-384 hash (96 hex chars) |
| `hash.sha512` | SHA-512 hash (128 hex chars) |

### Standalone Format Validators

| Validator | Description |
|-----------|-------------|
| `alpha` | Letters only (a-zA-Z) |
| `alphanumeric` | Letters and digits only |
| `cc` | Credit card number (Luhn check) |
| `cuid` | CUID format |
| `cuid2` | CUID2 format |
| `date` | Parseable date string (loose) |
| `domain` | Domain name |
| `emoji` | Emoji character(s) |
| `epoch` | Unix timestamp string |
| `hostname` | Hostname format |
| `json` | Valid JSON string |
| `jwt` | JSON Web Token structure |
| `mime` | MIME type (e.g., `text/html`) |
| `nanoid` | Nanoid format (21 chars) |
| `numeric` | Digits only (0-9) |
| `octal` | Octal string (0-7) |
| `phone` | E.164 international phone (+1234567890) |
| `semver` | Semantic version (1.2.3) |
| `slug` | URL-friendly slug (a-z, 0-9, hyphens) |
| `ulid` | ULID format (26 chars, Crockford Base32) |
| `bic` | BIC/SWIFT code |
| `isbn` | ISBN-10 or ISBN-13 |
| `imei` | IMEI device identifier |

---

## String — Constraints

### bytes

Factory: `bytes(n, error?)`, `bytes.min(n, error?)`, `bytes.max(n, error?)`

| Validator | Description |
|-----------|-------------|
| `bytes(n)` | Exact byte length |
| `bytes.min(n)` | Minimum byte length |
| `bytes.max(n)` | Maximum byte length |

### words

Factory: `words(n, error?)`, `words.min(n, error?)`, `words.max(n, error?)`

| Validator | Description |
|-----------|-------------|
| `words(n)` | Exact word count |
| `words.min(n)` | Minimum word count |
| `words.max(n)` | Maximum word count |

### graphemes

Factory: `graphemes(n, error?)`, `graphemes.min(n, error?)`, `graphemes.max(n, error?)`

| Validator | Description |
|-----------|-------------|
| `graphemes(n)` | Exact grapheme cluster count |
| `graphemes.min(n)` | Minimum grapheme count |
| `graphemes.max(n)` | Maximum grapheme count |

### Other String Constraints

Factory: `(config, error?) => ValidatorFunction`

| Validator | Description |
|-----------|-------------|
| `length(n)` | Exact string length |
| `startsWith(str)` | Must start with substring |
| `endsWith(str)` | Must end with substring |
| `includes(str)` | Must contain substring |
| `excludes(str)` | Must not contain substring |
| `matches(regex)` | Must match regex |

---

## BigInt — Constraints

No dedicated bigint validators. `min(n)`, `max(n)`, `range(min, max)` add `typeof value === 'bigint'` branch alongside number/string/array.

---

## Date — Constraints

| Validator | Description | Type |
|-----------|-------------|------|
| `date.min(d)` | On or after date | Factory |
| `date.max(d)` | On or before date | Factory |
| `date.past` | Before now | Direct |
| `date.future` | After now | Direct |
| `date.valid` | Not Invalid Date | Direct |

---

## Array — Constraints

Existing: `min(n)`, `max(n)`, `range(min, max)` work on arrays.

| Validator | Description | Type |
|-----------|-------------|------|
| `unique` | All items must be unique | Direct |

---

## String — Transforms

Transforms mutate value in-place during validation. Same signature but modify the validated output.

| Validator | Description |
|-----------|-------------|
| `trim` | Remove leading/trailing whitespace |
| `trim.start` | Remove leading whitespace only |
| `trim.end` | Remove trailing whitespace only |
| `normalize` | Unicode NFC normalization |
| `normalize.nfd` | NFD normalization |
| `normalize.nfkc` | NFKC normalization |
| `normalize.nfkd` | NFKD normalization |