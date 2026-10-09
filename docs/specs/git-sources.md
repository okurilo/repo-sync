# Git sources

Repository Profile хранит локальный абсолютный root и branch. Internal дополнительно хранит внешний HTTPS/SSH URL и branch. Глобального режима приложения нет. Основной путь использует committed HEAD выбранных веток; входящие commit/range/base доступны в «Другой способ».

Системный Git запускается через spawn с `shell: false`, hooks/fsmonitor отключены, prompt выключен. Timeout 120 s, stdout ≤512 MiB. Timeout/quit останавливает дерево Git/helper процессов. stderr не отображается и не сохраняется; credentials обслуживают системный helper / SSH Agent. Retries, push и submodule recursion отсутствуют.

Локальный tree читается через ls-tree/cat-file без checkout/formatter. Branch разрешается как refs/heads/branch. Незакоммиченные staged/unstaged/untracked показываются, но не экспортируются. Untracked ignored files не входят в product workflow. Tracked files соблюдают обычную Git semantics; пользовательские exclusions — minimatch globs с dot:true. Symlinks/submodules нужно исключить, иначе анализ отклоняется. Apply проверяет реальную текущую ветку target.

Внешний source использует HTTPS без userinfo/password/query/hash либо SSH URL/scp. Bare cache хранится по SHA256 URL в userData/git-cache. Fetch explicit selected branch → отдельный ref, без tags/checkout/origin. file/ext protocols и HTTP redirects запрещены. Список веток кэшируется; внутренние Git helper API могут читать историю, для дополнительных входящих сравнений.

Перед входящим Compare и подготовкой Apply проверяются remote refs через ls-remote; изменившаяся выбранная ветка скачивается. Устаревший после Review HEAD требует нового Compare. Ошибка сети останавливает входящую синхронизацию, ранее cached состояние не выдаётся за актуальное. Исходящий v5 сравнивает внешний HEAD с локальным committed HEAD, проверяет оба перед экспортом и передаёт полные выбранные файлы без зависимости от common bytes. Legacy common bytes читаются из sync-bytes. Основной External Import не обращается в сеть.

Входящее сравнение по умолчанию использует единственный merge-base основной и выбранной внешних веток → выбранный HEAD. Основа объявляется Git HEAD, иначе выбирается явно. Дополнительные способы: коммит относительно первого родителя, прямой A → B, repositories и zero. Обе границы A/B проверяются на принадлежность выбранной внешней истории; A не обязан быть предком B. Селекторы живут только в IPC/RAM. Перед preflight и Apply refs проверяются повторно; pinned SHA не расширяется, floating HEAD должен совпадать с просмотром. Для branch также проверяется вершина основы, для repositories — local HEAD.
