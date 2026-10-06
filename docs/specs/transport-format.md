# Transport v3

Новые exports содержат только UTF-8 `.md` части. Binary sidecars не создаются. protocolVersion/schemaVersion = 3; v1/v2 остаются read-only совместимостью. Для v2 импорт всё ещё требует его оригинальные sidecars.

## Представление

Часть начинается с `# RepoSync transport v3`, далее JSON part manifest и delimiter `\n\n---\n`, затем literal UTF-8 fragment. Manifest содержит UUID, partNumber/totalParts, totalBytes, packageSha256 и partSha256. В компактном представлении JSON minified; в читаемом — отступы.

Логический документ: JSON transport metadata с file inventory, operations и record descriptors, тот же delimiter и последовательность payload blocks. В descriptor payload пуст, encoding и payloadBytes задают точную длину UTF-8 representation. В читаемом варианте `readable: true`, перед каждым payload расположен заголовок `\n## OP path\n\n`, после — newline. Компактный вариант не добавляет заголовки или разделы между payload blocks. Length delimiting исключает влияние Markdown fences/разделителей внутри исходника.

RAW хранит валидный UTF-8 без NUL. BASE64 хранит binary bytes. В compact Brotli quality 4 + Base64 выбирается, если короче RAW/BASE64. Readable использует RAW для текста и BASE64 для binary. Минификация касается только metadata; исходники не форматируются и не минифицируются.

Документ фрагментируется по UTF-8 границам на `${uuid}.partNNN.md`; encoded binary может пересекать любые части. Размер каждого артефакта с manifest не превышает заданный лимит. Все части переносить вместе с исходными именами; можно выбрать любую из них.

## Проверки

Part SHA256 проверяется до сборки. UUID, protocol/schema, общий manifest и длина должны совпадать; дубли, пропуски и повреждения отклоняются. После сборки проверяются package SHA256 и record lengths. Paths проходят traversal, symlink, case collision и file/directory guards. Canonical результат проверяется относительно baseline и полного target inventory с hashes/sizes/modes. При направленном Apply независимые локальные изменения отдельно проверяются и сохраняются; результат canonical payload и local merged result различаются явно.

512 MiB — предел логического документа и canonical восстановленного inventory; Brotli decode bounded, сумма decoded records ограничена. Не более 10 000 частей / 100 000 records. Maximum part size 1–512 MiB в UI. Snapshot — только ADD, sourceState null; Diff — операции от общей sourceState. RENAME не содержит payload и требует одинаковых before/after hashes. DELETE не содержит payload.

SHA256(original canonical bytes) = SHA256(restored canonical bytes). LF/CRLF/BOM/whitespace сохраняются. Transport не является шифрованием; `.md`, cache и backups конфиденциальны.
