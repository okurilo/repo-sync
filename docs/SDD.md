# RepoSync — Software Design Description

## Границы процесса

**Renderer**: React 18, TypeScript, styled-components object syntax. Только UI и типизированный `window.reposync`. Ни Node, ни Git, ни произвольного shell / IPC.

**Preload**: замкнутый allowlist методов, общий discriminated reply. Не раскрывает `ipcRenderer`.

**Main**: разрешённые IPC команды, проверка главного frame, один выполняющийся request, системные dialogs и orchestration. BrowserWindow использует `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. Navigation, новые окна, permissions и renderer requests за пределы локального UI запрещены.

**Engine**: экспорт и импорт, in-memory preview tokens, committed baseline, применение и recovery. Tokens становятся недействительны после изменения профиля/среды и mutation.

**infra/git**: `spawn('git', args)` без shell; git credentials остаются в системных механизмах. Local tree — выбранные branch и commit. Remote tree — explicit fetch в bare cache. **infra/settings**: локальный schemaVersion 2 с миграцией v1, атомарная запись файла. Transport и scanner не обращаются в сеть.

## Поток экспорта

Профиль → разрешённый source → branch commit → included inventory → Snapshot либо Diff от baseline → scan реально передаваемого payload → preview → решения findings → повторная проверка source → запись всех parts → pending. Явное подтверждение передачи переносит pending target в baseline. Отмена pending сохраняет предыдущий baseline и не удаляет пакет.

Крупные bytes живут в Main RAM. Renderer получает только счётчики, пути операций и masked findings. Настройки не содержат file payload. Bare Git cache remote и резервные копии — локальные системные артефакты, а не поля настроек.

## Поток импорта

Выбранная часть → обнаружение остальных по package UUID в именах → целостность внешнего и внутреннего manifest → baseline и path checks → декодирование и подготовка всех результирующих bytes → preview. После подтверждения весь preflight выполняется повторно. Backup сохраняется до любых изменений. Каждая запись имеет journal intent. Все итоговые hashes, удаления и executable modes проверяются до обновления synchronized state.

При ошибке — rollback только затронутых путей из backup. При посторонних bytes автоматическое восстановление останавливается. На старте незавершённые journals откатываются до открытия UI. Backup после успеха остаётся в папке данных приложения.

## Persistence

`app.getPath('userData')`:

```text
settings.json
git-cache/<sha256-url>/      # bare remote repository
backups/<operation-uuid>/
  journal.json
  <index>.bin
```

Settings: среда, профили, source по средам, branches/selected commits, inventory/state/scope/localRepository baseline, pending paths/target, exclusions, ignored opt-ins, max part MB, output directory, recent import repositories. Credentials, findings и payload в настройки не записываются.

## Эксплуатация

Production загружает bundled UI через `file://`, сервер не запускается. `npm run dev` использует только loopback Vite для разработки; Main компилируется перед запуском, для изменения Main/preload требуется перезапуск dev. Нет telemetry, cloud services, updater, push, Git server или межконтурной сети. Нет метрик. Remote source в Global загружается при первом выборе; при открытых настройках вершины выбранных веток проверяются в фоне раз в минуту. Кэш доступен без сети; в Internal remote операции запрещены.

Требования, ограничения и подтверждённые проверки: `specs/`, `manual-qa.md`.

Модальные окна используют непрокручиваемые заголовок с кнопкой закрытия и footer действий; прокручивается только содержимое. При выполнении операции закрытие и действия блокируются существующим busy. Карточки выбора контура выравнивают кнопки по нижнему краю.

Выбор Git: открытие сохранённого профиля и завершение ввода нового источника загружают ветки и историю последовательно. Выбор ветки обновляет полный список commits без ограничения 256; действуют общие Git timeout и предел вывода. Повторный выбор той же ветки не сбрасывает выбранный SHA. При отсутствии списков остаётся ручной ввод; ошибки доступны в форме, обновление можно повторить кнопкой.

Settings v3: optional source.base выбирает исходную сторону прямого сравнения коммитов отдельно по контурам; старые v1/v2 мигрируют без изменения прежнего режима. Transport остаётся v1. В Remote cache fetch каждой ветки обновляет отдельный refs/heads/<branch>, а export повторно проверяет целевой ref. Для импорта Diff без сохранённого совпадающего baseline исходный inventory восстанавливается из локального Git commit и проходит прежние проверки before bytes/modes и recovery.

Настройки содержат Comparison справа от формы (на узком окне ниже). Изменение revisions/exclusions запускает readonly preview через 500 ms после завершения существующей операции; результаты отменённого UI запроса игнорируются. Main хранит один preview token с inventory/bytes, выдаёт allowlisted file после ограничений 128 KB и UTF-8/binary проверки и явного display masking. Preview не меняет профиль, baseline, pending и export session; все Git операции остаются в существующем IPC busy guard. Unified code diff строится renderer с timeout 1 s, контекстом и максимумом 2000 строк. Поиск дерева работает по всем entries, DOM ограничен 1000 совпадениями.
