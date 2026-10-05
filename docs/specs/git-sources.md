# Git source contract

Нужен установленный системный Git. Все команды запускаются аргументами через spawn, `shell: false`. Git timeout 120 s, stdout ≤512 MiB. Timeout / закрытие приложения останавливает дерево Git и helper процессов: process group на macOS/Linux, taskkill /t на Windows. Git hooks и fsmonitor отключены. stderr не показывается и не сохраняется, чтобы не раскрыть credentials. Prompt выключен; helper/SSH Agent работают по системной конфигурации. Автоматических retries, push и submodule recursion нет.

## Local

Source = `{kind: local, location: absolute path, branch, commit?}`. Repository root определяется через rev-parse. Branch — `refs/heads/<branch>`. Commit можно выбрать из полной истории ветки или указать полным SHA; отсутствие selected commit означает branch HEAD. Выбранный SHA должен существовать в репозитории; после rebase он может отсутствовать в текущей истории ветки. Tree читается ls-tree/cat-file, а не formatter/checkout. SHA идентифицирует stored Git bytes; `core.autocrlf` working tree не влияет на этот committed payload.

`.git` всегда исключён. Tracked files включаются независимо от `.gitignore`, согласно Git semantics. Untracked ignored files считаются через `git ls-files --others --ignored --exclude-standard`, включая nested .gitignore и .git/info/exclude. Рабочие staged/unstaged/untracked counts доступны через porcelain status. Незакоммиченные tracked/untracked изменения не входят в основной transport.

RepoSync exclusions — minimatch globs с `dot: true` поверх committed paths. Ignored opt-in — точный путь existing ignored regular file из working tree, с предупреждением перед добавлением; читает actual bytes и проходит Scan. Один и тот же ignored path не должен повторяться. Symlink / submodule нужно исключить, иначе source analysis отклоняется.

## Remote

Только Global, guard проверяется в Main независимо от UI. HTTPS URL без userinfo/password/query/hash либо SSH URL/scp `git@host:path`. Не использовать PAT в URL. Branch задаётся пользователем. Cache — bare Git repository в userData/git-cache/<SHA256 URL>.

Fetch использует explicit URL / refs/heads/branch → refs/heads/branch в bare cache, без сохранённого origin, tags и checkout. File/ext transport и HTTP redirects запрещены. В Internal `resolveSource(remote)` завершается до cache creation/fetch. Credentials не сохраняются RepoSync. Network вызывается при открытии настроек Remote profile, завершении ввода источника, выборе ветки, явном обновлении списков или Compare; baseline remote objects читаются локально.

Remote также поддерживает выбор конкретного commit, а не только branch HEAD. Загрузка веток — explicit ls-remote, загрузка commits — explicit fetch branch и log локального cache. Если lastSyncedCommit отсутствует в source Git, before bytes читаются из local repository последнего Import этого профиля. Если его файлы изменены, нужен Snapshot.

Source может содержать `base: {branch, commit?}` — независимый исходный Git revision для Diff. Обе стороны принадлежат одному repository и могут быть из разных веток. Ветки cache хранятся в отдельных refs, поэтому fetch исходной ветки не подменяет целевую. Каждый выбранный commit проверяется на принадлежность своей ветке; отсутствие SHA независимо означает HEAD соответствующей ветки.

### Локальный кэш и обновление веток

Загруженные remote ветки и commits открываются без ожидания сети. На macOS постоянный Git-кэш расположен в `~/Library/Application Support/RepoSync/git-cache/`: bare repositories по хэшу URL и атомарно сохранённые списки веток. История, метаданные деревьев и выбранный код кэшируются в памяти. При открытых настройках вершины проверяются в фоне через 1,5 секунды и затем раз в минуту; изменившаяся выбранная ветка скачивается. Кнопка обновления запускает явную проверку. При недоступной сети доступен ранее загруженный кэш.

SHA коммита неизменяем; rebase меняет вершину ветки на другой SHA. Выбранный конкретный SHA сохраняется и закрепляется в Git-кэше, даже если больше не принадлежит текущей истории ветки. Выбор последнего коммита обновляется вслед за веткой. Preview получает список файлов по метаданным Git, код читает только для выбранного файла. Экспорт проверяет актуальность исходной и целевой вершин перед записью пакета.
