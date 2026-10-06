# Ручная проверка v1

Дата: 2026-10-05. Автотесты и тестовая инфраструктура не добавлялись. Одноразовые ручные команды выполнялись с временными repository в `/private/tmp`; это не файлы проекта.

## Подтверждено

- TypeScript strict typecheck обоих процессов, Vite production build, компиляция Electron Main/preload.
- Snapshot из committed Local Git: CRLF, tabs, trailing spaces, отсутствие final newline, empty file, random binary 1 200 000 bytes. Все restored SHA256 совпали.
- Git ignored count: `.env` и nested ignored file исключены, tracked inventory передан.
- Max part size 1 MiB: три части по 1 048 567, 1 048 567 и 40 987 bytes. Импорт выбран со второй части, остальной набор найден автоматически.
- Последующий Diff: ADD 1, MODIFY 1, DELETE 1, RENAME 1, REPLACE 1. Все restored SHA256 совпали; DELETE действительно удалён.
- Pending создаётся после записи, baseline продвигается только confirmTransfer; receiving state обновляется после Apply.

## Дополнительные подтверждённые проверки

- Выбор конкретного commit: списки local branches / commits прочитаны, старый commit успешно экспортирован при более новом branch HEAD; bytes совпали с git show выбранного SHA. Settings v1 мигрируют в v2 с branch HEAD по умолчанию.
- Сценарий разных Git histories: Internal Snapshot импортирован в отдельный local baseline repository, Global target выбран из независимого Git repository. Diff создан от восстановленных baseline bytes, затем применён обратно в Internal; итоговые SHA256 совпали. Проверка использовала local источники; real Remote fetch остаётся непроверенным.
- Недостающая часть и испорченный SHA256 части блокируют preflight. Path traversal, symlink parent и замена canonical root symlink отклоняются. Internal remote guard срабатывает до внешней операции.
- Synthetic secret даёт masked blocking finding; export без override заблокирован. Replacement меняет только span в source working file на REPOSYNC_REDACTED.
- Реальная ошибка EACCES на readonly target directory после первых mutation: созданный файл удалён rollback, исходные bytes/хеши и synchronized state восстановлены. В финальной версии отдельно проверено сохранение исходных permissions 0600. Повторный Apply после исправления directory permissions успешен.
- Незавершённый journal моделировался как падение между settings save и committed marker: startup recovery вернул предыдущее состояние; тот же Diff после recovery успешно применён.
- Settings перезагружаются с baseline и pending, без payload/findings.
- npm audit --omit=dev: 0 vulnerabilities.
- Electron 44.5.1 процесс production стартовал без startup error. Dev-команда запустила Electron / loopback Vite; HTTP index и React TSX module вернули 200. После проверки dev остановлен.
- Окончательная macOS arm64 unsigned DMG / ZIP production packaging выполнена после добавления выбора commit; packaged Main/engine/Git/preload/index bytes сверены с итоговым build. Сборка без публикации и без автоматического выбора сертификатов.

## Непроверенные сценарии

- Визуальная проверка и действия через desktop UI заблокированы несовпадением версий Computer Use server/client. Требуется перезапуск Codex для восстановления инструмента; наличие работающего процесса не выдано за проверку UI.
- Реальный Remote Git fetch / authentication не проверен: пользователь не указал разрешённый URL/branch. Guard и validation проверены локально. Пример URL из ТЗ не использован как разрешение на сеть.
- Windows packaging/runtime и macOS x64 требуют соответствующих платформ/сборок.
- Реальные внезапные power loss / отказ диска и все внешние syscall races не заявляются как покрытые.

## UI исправления по скриншотам — 2026-10-05

- `npm run build`: typecheck, renderer и Electron build прошли после исправления карточек, полей и структуры модалок.
- Визуальная проверка нового layout не выполнена: Computer Use возвращает несовпадение версий клиента и сервера. Для ручной проверки: кнопки Internal/Global на одной высоте; поле размера пакета обычной высоты; крестик, Сохранить и Отмена видимы при прокрутке формы; закрытие блокируется во время операции.

## Ветки и история — 2026-10-05

- Через скомпилированные listBranches/listCommits проверен указанный пользователем ab-prototype: все 5 веток, main — 11 коммитов, codex/liquid-glass — 15. Старый SHA прошёл parseProfile и resolveSource без замены на HEAD.
- Временный локальный репозиторий: все 260 коммитов возвращены (прежний предел 256 снят).
- UI-проверка автозагрузки и выпадающего списка остаётся ручной: инструмент Computer Use недоступен из-за несовпадения версий.

## Прямое сравнение двух commits — 2026-10-05

- Временный Local Git: main → feature даёт ADD/MODIFY/DELETE, reverse — обратные три операции, одинаковые revisions — ноль изменений. Проверены CRLF и binary bytes.
- Diff экспортирован и импортирован без предыдущего baseline через sourceState из принимающего Git; итоговые bytes совпали и DELETE выполнен. Изменение target после preview блокирует Apply.
- Settings v1/v2 мигрируют в v3 без включения base; выбор двух сторон v3 сохраняется после reload.
- Реальный Remote ab-prototype: c986172fb9ed → 7ef925883156 даёт 169 файлов (ADD 58, MODIFY 107, DELETE 4); список совпал с git diff --no-renames --name-only. Fetch main сохранил target branch ref.
- TypeScript и сборка проходят; визуальная проверка новой формы остаётся ручной из-за недоступного Computer Use.

## Панель preview — 2026-10-05

- Временный Git проверен через compiled Engine: список файлов, текст до/после с CRLF, deleted preview, sensitive file/credential masking, binary и 128 KB ограничения, отказ для невыбранного пути и stale token. Настройки до/после preview совпали.
- UI: автоматическое обновление, дерево/поиск, подсветка, resize и номера строк требуют ручного визуального прохода; Computer Use ранее возвращал mismatch клиента/сервера.

## Ширина полей рядом с diff — 2026-10-05

- Форма переведена на вертикальные поля/кнопки и shrinkable controls; исправление CSS не меняет Git/IPC.
- Ручная визуальная проверка: длинная ветка не перекрывает размер пакета; оба списка commits и кнопки занимают отдельные строки; поле URL и SHA остаются внутри левой колонки. Визуальный инструмент недоступен из-за mismatch клиента/сервера.

## Статистика экспорта — 2026-10-05

- Главный счётчик использует entries.length (169 для показанного Diff), target inventory (600) отображается отдельно. Карточки и шкала используют уже рассчитанные counts; Snapshot и пустой Diff имеют явные подписи.
- Проверка TypeScript/build; визуальная проверка остаётся ручной при недоступном Computer Use.

## Security Scan context / source / exclusion — 2026-10-05

- Временный Git Diff: masked context и actual before/after line 2, deep-links на разные pin commits с encoded [ ] в path. Raw secret не попал в public findings.
- Симулирован save failure: старые настройки/preview token сохранились. Успешное исключение выполнено при временно недоступном repository (без Git I/O), новый token отклоняет старый. Финальный экспорт не содержит исключённого файла; повторный Compare учитывает escaped literal exclusion.
- TypeScript/build проходят; открытие реального browser/Finder и визуальный layout требуют ручной проверки при недоступном Computer Use.

- Дополнительно проверен last-sync Diff: исключение обновляет subset inventory/scope, последующий Compare работает; исходные working-tree counts сохраняются.

## Компактные группы Security Scan — 2026-10-05

- UI группирует findings по точному path, выводит имя/полный путь и количество. Индивидуальные решения используют прежние IDs; исключение группы удаляет файл целиком; ссылка строки открывает её собственный finding.
- TypeScript/build; визуальная проверка плотности и переносов остаётся ручной при недоступном Computer Use.

## Исходный текст Security Scan — 2026-10-05

- Проверка синтетического finding: контекст содержит исходный токен и точное совпадение без bullets; encode/decode bytes не изменились. TypeScript/build. Старые проверки отсутствия raw value в public findings отменены явным запросом пользователя для Scan-карточек.

### Кэш Git и ленивый preview — 2026-10-05

Проверено временным локальным Git fixture с подменой только сетевого URL в QA: офлайн-выбор загруженных веток и истории без fetch; неизменившаяся вершина без fetch; force amend обновляет историю; закреплённый SHA остаётся после GC; пакетное чтение сохраняет CRLF и baseline hashes; Internal отклоняет remote refresh. Повторно пройдены cross-branch/reverse/equal Diff, lossless import и отказ при изменении target после preview, миграции settings. Typecheck и production build проходят. Нативная визуальная проверка недоступна из-за ошибки Computer Use server/client mismatch.

Дополнительно: lazy/cached preview совпадает с Diff fixture, CRLF до/после сохранены, binary и устаревшие tokens отклонены; весь набор этих preview-проверок на маленьком fixture занял 48 ms (не benchmark пользовательского репозитория).

### Явная замена в пакете — 2026-10-05

Временный fixture: две последовательные замены email в MODIFY, устаревший token отвергнут, source bytes не изменены; после исключения другого файла экспорт и импорт сохраняют `***`, CRLF, inventory hashes и нетронутый исключённый файл. Cross-branch/reverse/equal Diff и проверки import повторно прошли. Typecheck/build проходят. Визуальная проверка нативного приложения остаётся недоступной из-за Computer Use mismatch.

### Открытый transport v2 — 2026-10-05

Временный fixture: несколько частей по 4096 bytes, Unicode/emoji/CRLF/BOM/Markdown fences и разделители восстановлены byte-exact; binary sidecar соответствует исходным bytes; в md нет BASE64/BROTLI_BASE64. Повреждённые/недостающие части, повреждённый binary, symlink и oversized binary отклонены. Импорт прежнего v1 с Brotli/Base64 успешен. Cross-branch/reverse/equal Diff, import interference и явная redaction повторно пройдены с v2. Typecheck/production build успешны. Нативная визуальная проверка недоступна (Computer Use mismatch).

### Дизайн — 2026-10-05

Проверены временным SSR fixture обе темы, отображение причин disabled и bulk actions, автоматический fallback выбранного файла после удаления, unified/split diff с подсветкой и указанием пути, генерация CSS reduced-motion. Найден и исправлен runtime throw от интерполяции styled keyframes в object string: animation names задаются global object @keyframes. Typecheck/build проходят. Computer Use вернул client/server mismatch; нативная визуальная проверка ширины, resize и эффектов не выполнена.

### Выбор веток — 2026-10-06

SSR fixture на 500 ветках: поиск последней ветки, пустой результат, сохранённая cached branch, size=8 и height=224px. Проверки обеих тем/unified/split и production build прошли. Нативный wheel/trackpad пока визуально не проверен (Computer Use mismatch); прокрутка реализована встроенным listbox вместо OS popup.

### Focus профиля — 2026-10-06

Проверены typecheck/build и прежние SSR сценарии. Временный deferred-IPC fixture: изменение draft во время незавершённого preview не запускает второй IPC, старый результат отбрасывается, следующий запускается после завершения. Нативный ввод/фокус не проверен визуально из-за Computer Use mismatch; форма больше не получает disabled от previewBusy.

## Направленные workflow и desktop redesign — 2026-10-06

Текущая модель отменяет исторические проверки universal comparisons, raw Scan values, transport-only redaction и новых v2 sidecars выше.

Проверено на временных локальных Git fixtures через compiled Engine; автоматические тесты и новая test infrastructure в проект не добавлялись:

- Первичный External → Internal, далее одновременные внутренние/внешние изменения, включая отдельные hunks одного CRLF файла и собственные файлы обоих контуров. Incoming сохраняет internal bytes; исходящий пакет содержит только internal изменения. После Apply/commit/confirm следующий Compare в обоих направлениях пустой.
- Незакоммиченный Apply блокирует исходящий перенос до ручного commit; staged/unstaged/untracked считаются отдельно. Перекрывающийся hunk останавливает preflight без mutation. Изменение target после Preview и смена ветки при одинаковых файлах блокируют Apply.
- Incoming повторно проверяет refs; новый внешний commit после Review отвергает stale token. Сеть в fixture заменялась только отображением synthetic remote URL в локальный Git; реальная авторизация/fetch текущим проходом не проверены.
- Compact/Readable v3: Unicode, emoji, BOM, CRLF, fences и delimiter внутри payload, пустой файл; random binary 30 KB при part limit 4096 bytes разделяется на .md и восстанавливается byte-exact. Все части ≤limit, повреждённая/недостающая часть отклоняется. Legacy v1 encoded package и v2 native binary sidecar читаются.
- Все известные чувствительные значения, включая соседние/перекрывающиеся findings, отсутствуют в public preview/context. Payload не маскируется при передаче.
- Инъекция ошибки второго target rename откатывает первую mutation и settings. Успешный Apply с simulated unfinished committed marker откатывается startup recovery. Исходные файлы и отсутствие созданного файла восстановлены.
- Settings v1/v2/v3 → v4: role/local source, снятие explicit commit, отсутствие выдуманной common baseline, original settings backup и reload. Current baseline переживает reload.
- `npm run build` проходит: strict typecheck, Vite renderer и Electron compilation. `git diff --check` проходит.

Renderer визуально проверен в локальном in-app browser на synthetic API: тёмная/светлая тема, список repositories с прямыми действиями, Internal detail с двумя направлениями, unified/split diff, отдельный masked Security Review, settings sheet с Advanced и fixed footer при 900×700 и 1200×840. Непрерывный ввод не запускает background preview; Escape закрывает форму. Это проверка реального renderer, а не нативных Electron dialogs.

Нативные computer-use surfaces недоступны: server/client version mismatch. Windows runtime/packaging, actual remote credentials, OS file dialogs и power loss остаются непроверенными. Backup/common bytes пока не очищаются автоматически; они локальны и конфиденциальны. Одновременное изменение Git/файлов внешними процессами между отдельными syscall не объявляется полностью покрытым.

Дополнительно проверены: masked replacement preview, смена ветки и symlink родителя между preview/заменой (отказ), точная замена source span; согласованное добавление exclusions на обеих сторонах с сохранением общего state ID и нетронутого исключённого local файла. Browser console после исправления вложенного Details в Comparison не содержит React warnings/errors. Временный preview и QA HTML убраны.

## 2026-10-06 — редактура текстов

- Реальный renderer на временном synthetic API в in-app browser, 900×700: пустой список, настройки внутреннего/внешнего репозитория и дополнительные поля, отсутствие изменений, первичная синхронизация, проверка данных с найденным значением и без совпадений, замена исходника, создание/просмотр/применение пакета, ожидание, отмена и подтверждение. Кнопки и подсказки доступны, тексты переносятся без горизонтального переполнения; console warnings/errors отсутствуют.
- Временные QA сценарии предыдущей реализации повторены с новыми ожидаемыми текстами: конфликт до записи, устаревший просмотр, коммит перед экспортом, смена внешней ветки, повреждённые/недостающие части, rollback при ошибке I/O, startup recovery, смена ветки/символическая ссылка при замене, legacy import и migration. Успешны; production проверки и правила не менялись.
- Сообщения Git/timeout, native dialogs и незавершённого восстановления проверены по фактическим веткам кода. Нативное управление приложением недоступно из-за version mismatch; эти диалоги визуально не проверены.
- Финальная `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac` завершилась успешно: strict typecheck, renderer/Electron и arm64 .app/DMG/ZIP. Все 10 packaged dist-файлов совпали с текущим dist; финальные подписи подтверждены в app.asar. `git diff --check` проходит. Временный QA HTML удалён.

## 2026-10-06 — выбор веток

В in-app browser на реальном renderer и synthetic API при 900×700 проверены: недоступный выбор без папки/URL с объяснением, загрузка при открытии, список 43 веток с поиском и прокруткой, выбор мышью и сохранение выбранной ветки, стрелки/Enter/Escape, отсутствие совпадений без сброса выбора, отсутствующая выбранная ветка, пустой ответ, ошибка и повторная попытка, сброс при смене источника. Ошибка callback App не превращается в успешный пустой ответ. Console warnings/errors отсутствуют. Native listbox используется вместо macOS popup; реальные OS dialogs/remote credentials в этой проверке не запускались.

`CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac` успешна: typecheck, renderer/Main и macOS arm64 .app/DMG/ZIP. Все 10 файлов dist в app.asar совпали с актуальным dist; статусы BranchPicker присутствуют в упакованном renderer. `git diff --check` проходит. Временный QA HTML удалён.
