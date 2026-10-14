# Transport v6

Новый исходящий экспорт использует protocolVersion/schemaVersion=6 в обоих режимах. Импорт v1–v5 сохранён; старые приложения v6 отклоняют, поэтому принимающую сторону нужно обновить. Settings остаётся v6, её структура не меняется.

## Компактные метаданные

Сохраняются envelope multipart, UUID, sourceState/targetState, scope, part/package SHA256, totalBytes, порядок операций и length-delimited исходный текст. Заголовок части — `# RepoSync transport v6`. Логический JSON содержит protocol/schema, packageId, packageType, sourceState, targetState, scope, readable и records; массива files на диске нет.

Каждый record содержит path/operation/size/mode и применимые oldPath/beforeMode/beforeSha256/afterSha256. ADD/REPLACE/RENAME имеют encoding=RAW либо FILE; DELETE не имеет encoding и не занимает блока содержимого даже в readable. Поля payload/payloadBytes/payloadSha256 отсутствуют. Другие поля record отвергаются.

- RAW: ровно size байтов UTF-8 без NUL; исходный текст не преобразуется. В readable прежний заголовок операции и завершающий newline находятся вне содержимого.
- FILE: имя вложения вычисляется как `${uuid}.binaryNNN${originalExtension}` по исходной позиции record; длина равна size, SHA256 равен afterSha256. Исходные бинарные байты не кодируются.
- DELETE: size сохраняет прежнее описание удаляемого файла, но длина содержимого всегда нулевая. beforeMode/beforeSha256 защищают удаление.

Импортёр разворачивает records в существующую внутреннюю модель; files вычисляется из конечных path/size/mode/afterSha256 всех записей кроме DELETE. Полный состав проходит прежние структурные проверки до исключения отсутствующих вложений. Для доступного содержимого проверяются точные длины и SHA256, для частей — целостность всего логического документа. Лимиты, пути, права, backup/Apply/recovery и запрет продвижения common baseline для полного-file пакета прежние.

## Изображения и неполная передача

«Включать изображения в пакет» — transient выбор исходящей сессии, default=true. Классификация по расширению без учёта регистра: PNG/JPG/JPEG/JFIF/GIF/WebP/AVIF/SVG/SVGZ/ICO/BMP/TIFF/TIF/APNG/HEIC/HEIF. При выключении операция исключается, если любой её path/oldPath является изображением, включая DELETE и RENAME. Это использует прежний selected-path экспорт и Scan; индивидуальные галочки сохраняются для обратного включения. SVG с валидным UTF-8 остаётся RAW.

Все части .md обязательны. Отсутствующий FILE v5/v6 (только ENOENT) отмечается unavailablePaths; связанная операция целиком исключается из применения, локальные файлы не заменяются заглушками, исходный путь RENAME не удаляется. Остальные доступные операции можно применить с прежними guards. Повреждённый или подменённый существующий attachment блокирует загрузку. Отсутствующие ресурсы не означают, что зависимости кода автоматически разрешены.

## Предыдущий формат v5 (импорт и внутренние совместимые fixtures)

V5 exports — UTF-8 `.md` и исходные бинарные вложения, protocolVersion/schemaVersion=5. V1–v4 импортируются прежними путями; v2 требует оригинальные sidecars. Старые клиенты отклоняют v5.

## Контракт полного файла

PackageType=diff сохраняется как обозначение набора изменений, но payload не содержит текстовых патчей. SourceState — SHA внешнего committed HEAD при сравнении; targetState=content:files:<SHA256 выбранного inventory> не является полным состоянием репозитория.

Files содержит только конечные пути выбранных records, кроме DELETE. Каждый файл описан path/sha256/size/mode. Records:

- ADD: полные bytes, afterSha256 и mode; beforeSha256 отсутствует.
- REPLACE: полные bytes изменённого текстового или бинарного файла, beforeSha256/beforeMode и afterSha256/mode. Существующий selected receiving файл заменяется целиком; отсутствующий создаётся.
- RENAME: oldPath → path, полные bytes, одинаковые before/after hashes, beforeMode и конечный mode. Чужой source или занятый destination конфликтует; отсутствующий source/destination допускает создание destination.
- DELETE: пустой payload, beforeSha256/beforeMode; отсутствующий receiving путь — no-op.

MODIFY (patch) в v5 запрещён. BeforeMode обязателен для всех операций кроме ADD, допустимы 0644/0755. Ни source commit, ни baseline bytes для материализации v5 не требуются. Полный payload каждого конечного файла проверяется по size/hash; inventory не может содержать лишние неизменённые файлы. Частичный набор имеет тот же контракт и не продвигает common baseline.

## Представление и лимиты

Часть начинается `# RepoSync transport v5`, затем JSON manifest и delimiter `\n\n---\n`, затем UTF-8 fragment. Manifest: UUID, protocol/schema, partNumber/totalParts, totalBytes, packageSha256/partSha256. JSON minified в обоих режимах.

Логический документ содержит metadata, delimiter и length-delimited payload blocks. Для RAW payload в descriptor пуст, payloadBytes определяет длину блока. Для FILE payload содержит имя вложения, payloadBytes — его размер, payloadSha256 — hash исходных байтов (равен afterSha256); inline-блок и заголовок отсутствуют. Readable=true добавляет перед блоком `\n## OP path\n\n` и после newline; compact не добавляет эти заголовки.

RAW — исходный UTF-8 без NUL. FILE — бинарное вложение `${uuid}.binaryNNN${originalExtension}`; индекс соответствует позиции record, имя вычисляется импортёром, произвольные пути не принимаются. Оба режима сохраняют открытый текст и бинарные байты без Base64/сжатия. Исходный Base64 не преобразуется. Компактность достигается только минифицированным JSON и отсутствием заголовков блоков. Фрагментация `.md` на `${uuid}.partNNN.md` соблюдает UTF-8 границы и лимит каждой части с manifest. Бинарные вложения не делятся: лимит части относится только к `.md`.

Проверяются единые UUID/version/manifest, последовательность, отсутствие дубликатов/пропусков, размеры, part/package hashes, точные длины payload и конечные hash/mode. Пути проходят traversal, symlink, case collision и file/directory guards. 512 MiB — предел суммарного размера документа и вложений, а также восстановленных файлов; не более 10 000 частей/100 000 records. UI задаёт 1–512 MiB на часть.

LF/CRLF/BOM/whitespace/bytes/executable mode сохраняются. Минифицируется только metadata; исходники не форматируются. Transport не зашифрован; cache/backups конфиденциальны.

## Совместимость v1–v4

V1 использует JSON/Base64 envelope; v2 — literal текст и binary sidecars; v3 — такой же length-delimited multipart `.md`, с RAW/BASE64/BROTLI_BASE64. V4 имеет полные выбранные payload и тот же контракт применения, что v5; при чтении поддерживаются прежние Base64/Brotli. V1–v3 snapshot содержит только ADD/sourceState=null; diff содержит MODIFY patches/REPLACE/DELETE/RENAME и полный target inventory. V1–v3 RENAME имеет пустой payload; материализация v1–v3 требует точного исходного состояния. В v4/v5 RENAME содержит полный конечный файл, общий commit не требуется.

Legacy content:partial:<inventory hash> и Pending.partial сохраняют прежний запрет продвижения baseline. Новые v5 pending также используют partial=true для того же запрета; settings schema не меняется.
