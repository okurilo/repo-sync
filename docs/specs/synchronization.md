# Synchronization contract

Settings schemaVersion 3 добавляет optional source.base. Версии 1/2 мигрируют без включения произвольного сравнения; прежние источники, baseline и pending сохраняются. Версия 1 использует branch HEAD по умолчанию. Каждый профиль хранит source/baseline/pending отдельно для Internal и Global. Exclusions, ignored opt-ins и max part MB общие. Baseline содержит state, inventory, scope digest и optional localRepository.

## Export

Source branch и selected commit читаются как commit tree; пустой выбор commit означает branch HEAD. Snapshot передаёт все included files. Diff сравнивает baseline bytes с target bytes: unchanged не передаются; text modifications → patch; binary → REPLACE; exact-content moves → RENAME; остальные изменения → ADD/DELETE/MODIFY. Mode changes включаются в records.

Scope digest = SHA256 JSON `{exclusions, includeIgnored}`; ignored opt-ins сортируются. Exclusions меняют scope: старый baseline нельзя использовать для Diff. Before bytes читаются из lastSyncedCommit в выбранном Git source. При отсутствии этого commit они читаются из localRepository baseline, сохранённого после Import. Если bytes не совпадают с baseline hashes, нужен Snapshot. При ручном возвращении ignored bytes state становится content inventory digest и сохраняется ссылка на working tree.

Compare создаёт in-memory token, inventory, scan findings и оценку real transport bytes/part count. Export требует решений по всем findings и explicit override для blocking findings. Перед записью branch и included bytes проверяются повторно. Части создаются без overwrite; ошибка удаляет созданные этой операцией части. Все части записаны → сохраняется pending. Подтверждение передачи продвигает baseline; отмена pending его сохраняет. Никакого commit/push.

## Import preflight

1. Полный набор parts / protocol / UUID / SHA256 / согласованный manifest.
2. Paths: relative slash paths, no traversal, no `.git` и платформенных aliases, no incompatible Windows names/control/bidi/invisible characters, NFC. Canonical root не должен измениться; existing parents не symlink. Только regular files.
3. Target — корень существующего local Git repository.
4. Для Diff: используется совпадающий profile baseline либо inventory исходного Git commit в принимающем repository при совпадении scope. Во втором случае наличие SHA проверяется через cat-file; все исходные files на target должны иметь ожидаемые hashes/modes. Если SHA отсутствует, требуется сначала Snapshot исходного состояния.
5. ADD не перезаписывает другие bytes; RENAME destination отсутствует; MODIFY/DELETE/REPLACE имеют before SHA.
6. Inventory действительно получается применением операций к baseline. Декодирование bounded, patch fuzz=0, EOL conversion выключена; hashes/size всех подготовленных result bytes совпадают.

Preview показывает операции и проверки. Apply повторяет весь preflight, сравнивает с preview и лишь затем создаёт backup. Import не меняет Git index или history. Snapshot не удаляет непереданные target files и не перезаписывает чужие файлы: для новой копии нужен empty `git init` repository.

## Apply / rollback / recovery

Оригинальные bytes/modes записываются в `backups/<uuid>/`, после этого journal сохраняет target, settingsBefore, entries и intent. Перед mutation — повторная проверка live bytes и сохранение touched intent. Записи выполняются через временный файл в том же каталоге и rename, затем chmod. Созданные каталоги/temporary paths отмечаются в journal.

После Apply проверяются весь target inventory, hashes, executable bits (кроме Windows) и отсутствующие удалённые пути. Settings baseline обновляется только затем. Journal становится committed; backup сохраняется локально.

Failure: touched entries восстанавливаются из backup, созданные файлы удаляются, пустые созданные каталоги очищаются, settingsBefore восстанавливается. Если live bytes не соответствуют ни before, ни prepared after, rollback останавливается, чтобы не удалить чужие изменения. Дальнейшие engine операции блокируются. Backup/journal оставляются для восстановления. На следующем запуске uncommitted journals автоматически проходят такой же rollback до открытия UI.

Пользователь должен остановить процессы, изменяющие target. Между syscall проверкой и записью возможна внешняя гонка: приложение не предоставляет OS lock на весь repository. Внезапный сбой диска/питания не равнозначен поддерживаемому process crash recovery.

## Произвольное сравнение

При source.base исходное дерево читается из указанной ветки/коммита с теми же exclusions; buildDiff сравнивает его напрямую с целевым деревом. Не используется merge-base; порядок сторон имеет значение, одинаковые commits дают пустой Diff. Last sync не меняется при Compare. Ignored opt-ins недоступны в этом режиме, поскольку относятся к working tree. Snapshot игнорирует source.base. Transport protocol/schema остаются v1: sourceState/targetState уже описывают оба commits. Перед Apply исходный inventory повторно проверяется без предварительного изменения сохранённого baseline; успешный Import сохраняет target baseline обычным путём.

Текущий export использует открытый transport v2; импорт поддерживает v1/v2. Pending.paths и rollback охватывают и `.md` части, и отдельные native binary вложения. Весь набор переносится в одну папку. Settings schema 3 не менялась.
