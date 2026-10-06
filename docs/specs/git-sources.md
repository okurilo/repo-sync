# Git sources

Repository Profile хранит локальный абсолютный root и branch. Internal дополнительно хранит внешний HTTPS/SSH URL и branch. Глобального режима приложения нет. В product UI нет arbitrary commit/base selectors; используются committed HEAD выбранных веток.

Системный Git запускается через spawn с `shell: false`, hooks/fsmonitor отключены, prompt выключен. Timeout 120 s, stdout ≤512 MiB. Timeout/quit останавливает дерево Git/helper процессов. stderr не отображается и не сохраняется; credentials обслуживают системный helper / SSH Agent. Retries, push и submodule recursion отсутствуют.

Локальный tree читается через ls-tree/cat-file без checkout/formatter. Branch разрешается как refs/heads/branch. Незакоммиченные staged/unstaged/untracked показываются, но не экспортируются. Untracked ignored files не входят в product workflow. Tracked files соблюдают обычную Git semantics; пользовательские exclusions — minimatch globs с dot:true. Symlinks/submodules нужно исключить, иначе анализ отклоняется. Apply проверяет реальную текущую ветку target.

Внешний source использует HTTPS без userinfo/password/query/hash либо SSH URL/scp. Bare cache хранится по SHA256 URL в userData/git-cache. Fetch explicit selected branch → отдельный ref, без tags/checkout/origin. file/ext protocols и HTTP redirects запрещены. Список веток кэшируется; внутренние Git helper API могут читать историю, но selectors не показываются в workflow.

Перед входящим Compare и подготовкой Apply проверяются remote refs через ls-remote; изменившаяся выбранная ветка скачивается. Устаревший после Review HEAD требует нового Compare. Ошибка сети останавливает входящую синхронизацию, ранее cached состояние не выдаётся за актуальное. Common before bytes читаются локально из sync-bytes; чужой Git commit или mutable receiving working tree для последующих diff не нужен. Основной External Import не обращается в сеть.

Входящее сравнение по умолчанию использует выбранный внешний коммит и его первый родитель; диапазон — выбранные начальный/конечный SHA. История показывает дату, SHA и название, доступен поиск. Target должен быть предком актуального HEAD выбранной внешней ветки; начало диапазона — предком target. Эти selectors передаются только в IPC/сессии и не сохраняются в Profile. История локального Git не требуется. Полное сравнение двух committed HEAD и нулевое состояние доступны отдельными явными способами. Перед preflight refs обновляются повторно: выбранный SHA остаётся закреплён, floating HEAD должен совпадать с просмотром. Для repositories также проверяется local HEAD.
