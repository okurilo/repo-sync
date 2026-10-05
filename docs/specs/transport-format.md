# Открытый transport v2

Новый экспорт использует `protocolVersion: 2`, `schemaVersion: 2`. Тексты и unified diff записываются буквально в UTF-8, без Base64, Brotli, архивирования и шифрования. Бинарные файлы записываются рядом исходными bytes с исходным расширением: `<UUID>.binary<номер record>.<extension>`. Переносить нужно все `.md` и бинарные вложения; имена сохраняются. Import начинается с любой `.partNNN.md` и требует эту версию приложения на принимающей стороне.

Каждая Markdown-часть начинается с `# RepoSync transport v2`, открытого форматированного JSON внешнего manifest и разделителя `\n\n---\n`. Manifest содержит версии, packageId, partNumber, totalParts, totalBytes, packageSha256 и partSha256. После разделителя находится буквальный фрагмент документа. SHA256 служит проверке целостности и ничего не скрывает. Части собираются по номеру; пропуск, дубликат, несовпадение manifest или checksum блокирует Import.

Логический документ начинается с форматированного JSON прежнего inventory/records контракта с версиями 2, затем тем же разделителем. Текстовый record имеет encoding RAW, пустой payload в metadata и payloadBytes. Его содержание ниже metadata: `\n## <operation> <path>\n\n`, затем ровно payloadBytes исходного текста и один служебный LF. Разделители внутри текста не имеют специального значения: parser читает по длине. CRLF, BOM, отсутствие final newline, executable mode и Unicode сохраняются. При разбиении не разрывается UTF-8 символ; очень длинная строка может продолжаться в следующей части.

Бинарный record имеет encoding FILE, payload с фиксированным именем вложения, payloadBytes и payloadSha256; текстового блока у него нет. Проверяются имя, размер, hash и regular-file тип; symlink запрещён. Бинарный файл не разбивается и должен укладываться в Maximum part size. Иначе нужно увеличить лимит или исключить файл. Каждый выходной файл ≤ указанного лимита; открытый документ плюс бинарные bytes ≤512 MiB. Неизменившиеся бинарные файлы в Diff не переносятся.

Внутри Main для совместимости с existing encode/decode API бинарные bytes могут временно представляться строкой Base64 в памяти. В файлах нового экспорта нет Base64 или сжатого payload. Reader v2 допускает только RAW/FILE, затем нормализует records для прежнего lossless Apply. Settings schema 3 не менялась.

## Совместимость

Старые пакеты v1 остаются доступными для импорта, включая Base64/Brotli; новые пакеты всегда записываются в v2. Старое приложение v1 не импортирует v2. Старые уже созданные пакеты не преобразуются автоматически: отмените pending и выполните Compare/экспорт заново, если нужен открытый формат.

## Архивное описание v1 (только импорт)


Файл: `<packageId>.part001.md`; последующие части сохраняют UUID и numbering. Номер может иметь больше трёх цифр. Markdown состоит из заголовка `# RepoSync transport v1`, пустой строки и fenced `json` block, final LF.

Outer manifest: `protocolVersion: 1`, UUID `packageId`, `packageType`, `sourceState`, `targetState`, `partNumber` (1-based), `totalParts`, `records` (count), `packageSha256`, `partSha256`, `totalBytes`, `fragment` (canonical BASE64).

`fragment` декодируется в фрагмент UTF-8 bytes логического JSON; SHA256 проверяется отдельно для части и для конкатенации частей в numerical order. Metadata всех частей должна совпадать. Дубликаты или отсутствие parts блокируют import. Остальные части обнаруживаются в той же папке по UUID в имени; переименование всех частей не поддерживается.

Logical JSON:

```text
protocolVersion: 1
schemaVersion: 1
packageId
packageType: snapshot | diff
sourceState: null (snapshot) | baseline state ID (diff)
targetState: commit SHA | content:<inventory SHA256>
scope: SHA256 rules fingerprint
files: [{ path, sha256, size, mode }]
records: [{ path, operation, size, mode, beforeSha256?, afterSha256?, oldPath?, encoding, payload }]
```

`size` — длина результирующего файла, не encoded payload; для DELETE — 0. `mode`: 420 (0644) или 493 (0755). SHA256 lowercase hex.

| Operation | Payload | Before / after |
| --- | --- | --- |
| ADD | Полные bytes нового файла | after |
| MODIFY | UTF-8 unified patch (`a/path`, `b/path`) | before + after |
| REPLACE | Полные bytes бинарного файла | before + after |
| DELETE | Пустая строка | before |
| RENAME | Пустая строка, oldPath / path | одинаковые before + after |

Snapshot содержит ADD для всех included files. Diff inventory описывает полное target included state и должен равняться baseline inventory после указанных операций. Paths операций и inventory не могут конфликтовать, включая case-insensitive aliases. OldPath разрешён только для RENAME.

Encoding: `RAW` — JSON string с lossless UTF-8 bytes; `BASE64` — стандартная base64; `BROTLI_BASE64` — Brotli bytes в base64, quality 4 в прежнем экспорте. RAW используется только когда UTF-8 roundtrip совпадает с исходными bytes. Выбирается минимальная сериализация record encoding/payload. Ни formatter, ни line-ending normalizer не применяется.

Max part MB — целые 1…512, единица фактически MiB (1 048 576 bytes). Каждый выходной `.md` целиком, включая metadata и fences, не превышает заданный размер. Логический JSON и restored inventory ≤512 MiB. Decode и сборка bounded. Protocol/schema других версий отклоняются; миграций до появления версии 2 нет.
