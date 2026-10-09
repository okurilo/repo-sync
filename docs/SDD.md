# RepoSync — Spec-Driven Development

Требования в docs/specs, фактические проверки в docs/manual-qa.md. Последующие уточнения пользователя заменяют исходные ТЗ.

## Продуктовая модель

Repository Profile имеет роль internal/external. Internal связывает локальный root/branch и внешний URL/branch; External принимает `.md` в локальную рабочую копию. Два сценария: External → Internal через Git и Internal → External через пакет. Приём пакета снаружи завершает второй сценарий. Глобального режима среды нет.

Incoming default — изменения внешней ветки относительно единственного merge-base с основой. Ветка и основа видны; остальные сравнения раскрываются в «Другой способ». Подготовка применения автоматическая после выбора; просмотр показывает локальные before и проверенные canonical after. Selected MODIFY/REPLACE целиком заменяют файл; другие пути сохраняются. Применение требует одного подтверждения.

Outgoing — внешний committed HEAD → внутренний committed HEAD независимо от общей истории. Scanner и размер вычисляются автоматически для selected records. Findings пусты → «Создать пакет» в Comparison; иначе отдельный Review с решениями и explicit secret override. Папка выбирается один раз. Новый v5 содержит полные версии только выбранных изменённых файлов; патчей и полного project inventory нет.

Pending блокирует новые переносы до ручного подтверждения/отмены. V4 confirmation и Apply не объявляют полную общую точку; следующий outgoing снова сравнивает актуальные HEAD. Common baseline оставлена для legacy import/pending и прежних входящих full/zero режимов.

## Границы процессов

Renderer: React/strict TypeScript/styled-components, theme/ui foundation и features. Code preview ограничен 128 КБ на сторону, binary guard. Значения показаны без маскирования по уточнению пользователя. Foreground/preview IPC сериализованы; актуальность automatic preparation проверяется по profile/direction/source token/selected paths. Errors не запускают автоматические retries. Главный экран без KPI tiles и фонового сканирования.

Preload: typed allowlist API. Main: sender/main frame validation, foreground busy guard, dialogs/orchestration. Sandbox, context isolation, CSP, запреты renderer network/navigation/windows/permissions сохранены.

Engine: выбранные immutable Git trees, compare/full-file records, selected scan, tokens, prepare, Apply/recovery. Infra/git запускает системный Git без shell; timeout 120 s/kill tree, hooks/fsmonitor/prompts/redirects отключены, credentials системные. Private bare cache обновляет только выбранные external refs. Нового Git client, retries, telemetry или прямой сети между контурами нет.

## Контракты и persistence

Transport v5: diff package с минимальным files inventory, полными ADD/REPLACE/RENAME payload, DELETE intent и before hash/mode. Multipart UTF-8 `.md` с исходным текстом и RAW/FILE, бинарные вложения в исходных байтах; минифицируются только метаданные, exact bytes/EOL/отступы/modes сохраняются. Экспорт без Base64/Brotli. Legacy v1–v4 читаются своим прежним путём; v2 требует sidecars. V5 требует обновления обеих сторон.

Settings остаются schemaVersion=5, структура не расширена. V4 Pending.partial=true запрещает продвижение common state даже при выборе всех операций. Profile хранит sources, exclusions, part size/format, legacy baseline, pending, syncedAt/commitRequired. Git selectors живут только в RAM/IPC.

```text
userData/settings.json
userData/settings.vN.backup.json
userData/git-cache/<sha256-url>/
userData/git-cache/sync-bytes/<sha256>
userData/backups/<uuid>/journal.json
userData/backups/<uuid>/<index>.bin
```

Cache stores immutable bytes; запись temporary/fsync/rename предшествует publication. Settings сохраняются атомарно; findings/payload не записываются туда. Автоочистка cache/backups отсутствует.

## Применение и эксплуатация

V4 load проверяет все части/payload до выбора; applicability — только выбранные операции. Apply повторяет root/branch/bytes/modes/prepared paths, создаёт backup/journal до mutation, проверяет exact результат и сохраняет settings/committed marker. Ошибка откатывает touched paths/settingsBefore; посторонние bytes останавливают rollback. Startup recovery обрабатывает незавершённые journals. Это не гарантия при отказе диска/питания.

Index/history/commit/push не меняются. После непустого Apply требуется ручной commit перед outgoing. Main/infra recovery, migration, legacy baseline guards переиспользованы. Нет auto updater/cloud/метрик/фоновой синхронизации. Production использует bundled UI; build исходников не обновляет ранее установленную `.app`.
