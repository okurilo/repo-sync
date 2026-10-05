# 0003 — Lossless transport и безопасный import

Статус: принято, 2026-10-05.

Transport — JSON logical package, разделённый на BASE64 fragments внутри Markdown parts. Record payload выбирает RAW / BASE64 / BROTLI_BASE64 по размеру сериализации. Это стандартные lossless encodings, не собственный whitespace codec. Outer fragmenting допускает деление любого payload, actual bytes каждой `.md` части проверяются относительно лимита.

Text MODIFY — unified patch, подготовленный `diff` и проверенный на exact bytes; fuzz отключён, EOL не конвертируются. Invalid UTF-8 или NUL → binary REPLACE. Rename только при одинаковом content hash, иначе DELETE + ADD либо MODIFY.

Import сначала готовит всё состояние в RAM. Нельзя записывать файлы до checksum, baseline, before hashes и применимости patches. Backup + touched intent journal обеспечивают rollback / startup recovery. Чужие bytes при recovery не перезаписываются; операции останавливаются для ручного восстановления. Внезапный отказ диска/питания не покрывается гарантией process recovery.

ТЗ не описывает формат symlink/submodule, безопасную смену file↔directory и платформенно неоднозначные пути. Минимальное корректное решение — отклонять такие случаи явно. Включённые regular files и executable bit поддерживаются. Snapshot ADD допускает уже существующий файл только с точным after hash. Другие файлы target сохраняются, Snapshot не делает скрытой очистки repository.

Защитные границы v1: 512 MB logical JSON и decoded state, 100 000 inventory/records, 10 000 parts/findings. Это уменьшает риск неограниченной распаковки и расхода памяти; большие состояния пользователь должен сузить exclusions. Memory footprint может превышать payload в несколько раз из-за JSON/BASE64 и backup preparation.

SHA256 обеспечивает integrity, а не аутентичность отправителя. Подписи/encryption вне заявленного v1; передавать пакеты нужно через доверенный пользовательский процесс.
