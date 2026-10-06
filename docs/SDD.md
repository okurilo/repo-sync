# RepoSync — Software Design Description

## Продуктовая модель

Центральная сущность — Repository Profile. Роль `internal` / `external` принадлежит профилю. Глобального режима среды нет. Два направления: External → Internal из внешнего Git и Internal → External через `.md`. External profile принимает пакет из контура; произвольные Git comparisons не входят в основной UI.

`Profile.sources.internal` хранит локальный Git, `sources.global` — внешний remote для Internal profile. Имена этих двух технических ключей сохранены ради небольшой правки существующих Git API; они не обозначают режим приложения. Профиль хранит одну общую baseline, pending, дату синхронизации, exclusions, максимальный размер части и readable/compact transport. Branch HEAD выбирается автоматически, commit/base selectors отсутствуют.

## Границы процессов

Renderer: React, strict TypeScript, styled-components. Foundation в `renderer/theme` и `renderer/ui`; repositories/settings/security вынесены в `renderer/features`. Верхняя панель, список repositories, focused workflow и Comparison. Renderer получает masked findings и ограниченный code preview исходящего пакета; входящий код показывается без маскирования, findings для него не строятся; произвольных Node/Git/IPC нет. Сериализация foreground и code preview сохранена.

Preload: typed allowlist `window.reposync`, discriminated reply. Main: проверка sender/main frame, foreground busy guard, dialogs и orchestration. Sandbox, context isolation, CSP, запреты navigation/window/permissions и внешней сети renderer сохранены.

Engine: выбор направления, immutable common bytes, diff/scan, tokens, подготовка полного результата, Apply и recovery. infra/git: системный Git без shell, локальный root/HEAD, bare remote cache; свежие refs перед входящим Compare и перед preflight. infra/settings: schemaVersion 4, атомарная запись и миграция старых snapshots, включая recovery settingsBefore.

## Синхронизация

Входящее направление сравнивает common state → external branch HEAD. При отсутствии common state автоматически используется единственный Git merge-base; исходный tree читается из локальной истории без сохранения baseline до Apply. Локальные Git objects импортируются только в приватный bare cache с --no-write-fetch-head, затем merge-base --all отклоняет неоднозначную историю; отсутствие общего коммита оставляет полный snapshot. Исходящее — common state → local branch committed HEAD. Common bytes нужны независимо от доступности чужого commit в локальном Git; поэтому сохраняются по SHA256 в существующей папке cache, отдельно от mutable working tree.

При входящем Apply canonical пакет сначала восстанавливается из common bytes и проверяется по всем target hashes/modes. Затем операции готовятся против текущих local bytes. Independent hunks допускаются при точном и однозначном контексте, конфликт останавливает preflight. Незатронутые файлы не сверяются с внешним inventory и не заменяются. Common state после Apply соответствует canonical отправленной стороне, а не сумме её данных и независимых принимающих изменений.

После Apply выставляется commitRequired: перед следующим исходящим переносом незакоммиченный результат нужно закоммитить. Export сохраняет pending и common bytes; baseline обновляется только при подтверждении применения снаружи. Пока есть pending, другие переносы заблокированы.

## Persistence

```text
userData/settings.json                    # schema v4, без payload/findings
userData/settings.vN.backup.json           # исходные старые настройки
userData/git-cache/<sha256-url>/          # bare external Git
userData/git-cache/sync-bytes/<sha256>     # immutable common/pending bytes
userData/backups/<uuid>/journal.json
userData/backups/<uuid>/<index>.bin
```

Common bytes записываются через temporary file, fsync и rename до публикации соответствующей baseline/pending. В settings хранится inventory, а не payload. Это локальные конфиденциальные данные с приватными правами; автоматической очистки blobs/backups пока нет.

## Apply и recovery

Все результирующие файлы готовятся до записи. После Preview повторяются проверки target root, ветки, bytes и modes. Backup сохраняется до mutation; intent journal обновляется перед каждой операцией. После записи проверяются реальные подготовленные bytes и modes, затем settings и committed marker. Ошибка приводит к touched-only rollback. Посторонние bytes останавливают rollback; startup recovery откатывает незавершённые journals до открытия UI. Это не гарантия при отказе диска/питания.

## Эксплуатация

Production использует bundled file UI. Vite нужен только для разработки. Нет telemetry, метрик, автоматических retries, push, merge UI, cloud слоёв или прямой сети между контурами. Git timeout 120 s и остановка дерева процессов сохранены. На внешней стороне сеть не требуется для основного Import. Старые v1/v2 пакеты импортируются; новые exports — только v3 `.md`.
