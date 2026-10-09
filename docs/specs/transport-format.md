# Transport v4

Новые exports — UTF-8 `.md`, protocolVersion/schemaVersion=4. Binary sidecars не создаются. V1–v3 импортируются; v2 требует оригинальные sidecars. Старые клиенты отклоняют v4.

## Контракт полного файла

PackageType=diff сохраняется как обозначение набора изменений, но payload не содержит текстовых патчей. SourceState — SHA внешнего committed HEAD при сравнении; targetState=content:files:<SHA256 выбранного inventory> не является полным состоянием репозитория.

Files содержит только конечные пути выбранных records, кроме DELETE. Каждый файл описан path/sha256/size/mode. Records:

- ADD: полные bytes, afterSha256 и mode; beforeSha256 отсутствует.
- REPLACE: полные bytes изменённого текстового или бинарного файла, beforeSha256/beforeMode и afterSha256/mode. Существующий selected receiving файл заменяется целиком; отсутствующий создаётся.
- RENAME: oldPath → path, полные bytes, одинаковые before/after hashes, beforeMode и конечный mode. Чужой source или занятый destination конфликтует; отсутствующий source/destination допускает создание destination.
- DELETE: пустой payload, beforeSha256/beforeMode; отсутствующий receiving путь — no-op.

MODIFY (patch) в v4 запрещён. BeforeMode обязателен для всех операций кроме ADD, допустимы 0644/0755. Ни source commit, ни baseline bytes для материализации v4 не требуются. Полный payload каждого конечного файла проверяется по size/hash; inventory не может содержать лишние неизменённые файлы. Частичный набор имеет тот же контракт и не продвигает common baseline.

## Представление и лимиты

Часть начинается `# RepoSync transport v4`, затем JSON manifest и delimiter `\n\n---\n`, затем UTF-8 fragment. Manifest: UUID, protocol/schema, partNumber/totalParts, totalBytes, packageSha256/partSha256. JSON minified в обоих режимах.

Логический документ содержит metadata, delimiter и length-delimited payload blocks. Payload в descriptor пуст, encoding/payloadBytes определяют representation. Readable=true добавляет перед блоком `\n## OP path\n\n` и после newline; compact не добавляет эти заголовки.

RAW — UTF-8 без NUL; BASE64 — binary; compact использует Brotli quality 4 + Base64 только при меньшем размере. Readable сохраняет RAW/BASE64. Фрагментация документа на `${uuid}.partNNN.md` соблюдает UTF-8 границы и максимальный размер каждой части с manifest. Binary также пересекает части.

Проверяются единые UUID/version/manifest, последовательность, отсутствие дубликатов/пропусков, размеры, part/package hashes, точные длины payload и конечные hash/mode. Пути проходят traversal, symlink, case collision и file/directory guards. 512 MiB — предел документа и восстановленных файлов; Brotli bounded, не более 10 000 частей/100 000 records. UI задаёт 1–512 MiB на часть.

LF/CRLF/BOM/whitespace/bytes/executable mode сохраняются. Минифицируется только metadata; исходники не форматируются. Transport не зашифрован; cache/backups конфиденциальны.

## Legacy v1–v3

V1 использует JSON/Base64 envelope; v2 — literal текст и binary sidecars; v3 — такой же length-delimited multipart `.md`, как v4. Legacy snapshot содержит только ADD/sourceState=null; diff содержит MODIFY patches/REPLACE/DELETE/RENAME и полный target inventory. Legacy RENAME имеет пустой payload. Материализация требует точного исходного состояния, которого нет в новом v4.

Legacy content:partial:<inventory hash> и Pending.partial сохраняют прежний запрет продвижения baseline. Новые v4 pending также используют partial=true для того же запрета; settings schema не меняется.
