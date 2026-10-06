# RepoSync — Spec-Driven Development

SDD означает разработку на основе спецификаций: требования и сценарии фиксируются в `docs/specs`, реализация проверяется по ним, а фактические результаты — в `docs/manual-qa.md`. Уточнения пользователя имеют приоритет над исходными ТЗ; изменённый контракт сначала отражается в спецификации. Ниже описаны действующие решения, обеспечивающие этот контракт.

## Продуктовая модель

Центральная сущность — Repository Profile. Роль `internal` / `external` принадлежит профилю. Глобального режима среды нет. Два направления: External → Internal из внешнего Git и Internal → External через `.md`. External profile принимает пакет из контура; произвольные Git comparisons не входят в основной UI.

`Profile.sources.internal` хранит локальный Git, `sources.global` — внешний remote для Internal profile. Имена этих двух технических ключей сохранены ради небольшой правки существующих Git API; они не обозначают режим приложения. Профиль хранит одну общую baseline, pending, дату синхронизации, exclusions, максимальный размер части и readable/compact transport. Входящий workflow выбирает commit/range/repositories/zero; selectors хранятся только в IPC/сессии. Persisted source selectors по-прежнему отсутствуют.

## Границы процессов

Renderer: React, strict TypeScript, styled-components. Foundation в `renderer/theme` и `renderer/ui`; repositories/settings/security вынесены в `renderer/features`. Верхняя панель, список repositories, focused workflow и Comparison. Renderer получает masked findings и ограниченный code preview исходящего пакета; входящий код показывается без маскирования, findings для него не строятся; произвольных Node/Git/IPC нет. Сериализация foreground и code preview сохранена.

Preload: typed allowlist `window.reposync`, discriminated reply. Main: проверка sender/main frame, foreground busy guard, dialogs и orchestration. Sandbox, context isolation, CSP, запреты navigation/window/permissions и внешней сети renderer сохранены.

Engine: выбор направления, immutable common bytes, diff/scan, tokens, подготовка полного результата, Apply и recovery. infra/git: системный Git без shell, локальный root/HEAD, bare remote cache; свежие refs перед входящим Compare и перед preflight. infra/settings: schemaVersion 4, атомарная запись и миграция старых snapshots, включая recovery settingsBefore.

## Синхронизация

Входящий workflow по умолчанию переносит diff выбранного внешнего коммита относительно первого родителя; range — суммарный diff выбранных состояний. Repositories и zero — отдельные явные способы. Перед preflight проверяется актуальность floating HEAD; закреплённый выбранный SHA не расширяется при продвижении ветки. Исходящее направление использует common state → local committed HEAD.

Canonical transport восстанавливается из immutable выбранных before bytes. Входящий MODIFY заменяет весь соответствующий локальный файл проверенным содержимым внешнего target; прочие receiving-файлы остаются без изменений. Apply готовит только выбранные records и повторяет проверку этого же списка перед записью. Commit/range не обновляют common baseline, поскольку частичный diff не означает полного совпадения inventory; Repositories/zero продвигают baseline только при полном выборе. Чужие before bytes сохраняются в existing sync-bytes для повторной проверки Apply; они не обязаны быть доступны в локальной Git-истории.

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
