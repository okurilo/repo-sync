# Синхронизация

## Два направления

Internal profile связывает локальный repository/branch и внешний Git URL/branch. External profile хранит только локальный repository/branch для применения пакетов.

Одна общая sync state содержит canonical inventory, state ID и fingerprint exclusions. Направление определяет target: входящее — внешний HEAD, исходящее — локальный committed HEAD. При наличии baseline строится diff. Для первого входящего получения автоматически ищется единственный Git merge-base локального и внешнего HEAD; при его наличии diff строится от него, без изменения settings до Apply. Если общей истории нет, применяется прежний полный snapshot. Первый исходящий пакет без baseline остаётся snapshot. SHA, baseline и тип пакета пользователь не выбирает.

Не сравнивать целиком актуальный internal tree с актуальным external tree: это смешало бы независимые изменения. В обоих направлениях before bytes читаются из immutable common state, сохранённой локально по SHA256. Добавление exclusions безопасно сужает baseline inventory/scope; примените те же правила на обеих сторонах. Расширение scope (удаление прежних правил) блокирует перенос: верните exclusions обратно или настройте новый профиль для первичного переноса. Исключение конкретного файла в Security Review одновременно фильтрует baseline и меняет scope; принимающая сторона должна иметь те же exclusions.

## External → Internal

Перед Compare проверяются актуальные remote refs, при изменении ветки выполняется fetch в bare cache. Compare → preflight → Preview → Apply, без Security Review и маскирования входящего кода. Перед preflight внешняя ветка проверяется повторно: изменившийся HEAD требует нового Compare.

Сначала canonical пакет проверяется относительно common bytes, включая операции, SHA256, размеры и modes. Затем проверяется направленное применение к текущим локальным файлам. Text MODIFY может сохранять независимые внутренние изменения, если hunk context совпадает без fuzz и однозначен. Неоднозначный контекст, конфликт содержимого, DELETE/RENAME/REPLACE с несовпавшим before или конфликт modes останавливают операцию до backup/mutation. Автоматический conflict merge отсутствует.

ADD допускает отсутствующий путь либо уже существующий точно такой же файл. Первичный полный перенос не заменяет repository целиком; остальные локальные файлы сохраняются. Полный snapshot при уже существующей common state отклоняется.

Рабочая ветка target должна совпадать с профилем. Незакоммиченные данные не экспортируются; если они затрагивают Apply, проходят те же проверки применимости. После успеха common state становится canonical внешним target, независимые внутренние bytes остаются локальными и попадут в следующее исходящее сравнение после commit.

## Internal → External

Committed local HEAD → diff от common state → Security Review → `.md` parts → pending. Незакоммиченные staged/unstaged/untracked показываются как предупреждение. После входящего Apply непустой Git status блокирует вынос: сначала закоммитьте применённый результат обычными Git-инструментами.

Получатель выбирает External profile и любую `.md` часть. Preflight проверяет весь набор и готовит actual local before/after для Comparison. Если у нового получателя ещё нет common state, diff baseline может быть прочитан из исходного коммита в его Git при том же scope; иначе нужен первичный перенос. Имеющаяся baseline должна точно соответствовать sourceState; произвольные source selectors не используются.

Export не меняет baseline. Подтверждать «Подтвердить применение» можно только после успешного применения. Подтверждение сохраняет pending target как common state; отмена сохраняет предыдущую baseline и файлы пакета. Pending блокирует остальные переносы. Точность ручного подтверждения — ответственность пользователя; межконтурного acknowledgment по сети нет.

## Apply / rollback / recovery

Перед mutation повторяются root/branch, applicability, bytes и modes. Изменившийся после Preview файл останавливает Apply. Backup и journal создаются до записи, touched intent — перед каждой операцией. Проверяются actual merged bytes/modes затронутых файлов; независимые local файлы не обязаны совпадать с canonical внешним inventory.

После успеха атомарно сохраняются common state и дата, затем committed marker. При ошибке откатываются затронутые пути и settingsBefore. При посторонних bytes recovery останавливается. Незавершённые journals откатываются при следующем запуске. Backup остаётся локально. Git index, history и commit/push не меняются.

## Миграция

Settings v4 убирает environment и независимые baselines по средам. Старые sources переводятся в role/local/external; SHA/base selectors сбрасываются. Исходный settings JSON сохраняется как `settings.vN.backup.json`. Старые baselines не объявляются общей точкой автоматически: это могло бы смешать направления. Первая новая синхронизация первичная. Старый pending сохраняется для явной отмены/разбора, но подтверждение требует доступных immutable bytes; при их отсутствии отмените ожидание и создайте пакет заново. Recovery snapshots прежних versions проходят ту же миграцию при сохранении.
