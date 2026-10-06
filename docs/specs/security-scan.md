# Security Review

Scanner работает локально в Main по реально передаваемым records. Правила: private key / credential patterns, email, phone, ФИО и контекст полей имени, sensitive filenames. Severity warning/block обозначает потенциальные данные, а не подтверждённый факт. Есть предел 10 000 findings.

Renderer получает ID, path, actual source/target line, причину, severity, безопасный replacement proposal и **masked** preview/context. Приватные value/offset остаются в Main RAM. Контекст маскирует все известные spans, включая соседние/перекрывающиеся; ограничен 160 символами по сторонам и в совпадении. Code Comparison также маскируется в Main. Payload, baseline bytes и transport при просмотре не меняются. Findings и полные values не записываются в settings/logs.

Focused экран показывает одно срабатывание за раз. Доступны: исключить файл, заменить локальный исходник, считать безопасным, открыть файл. Для remote вместо локальной замены можно открыть поддерживаемую GitHub/GitLab/Bitbucket ссылку и исправить источник самостоятельно. Исключение фильтрует подготовленный пакет и baseline, атомарно сохраняет exclusions, повторяет Scan/размер в памяти и сбрасывает решения; ошибка до сохранения оставляет прежнюю сессию.

Local replacement ищет единственный exact span в live файле, затем повторно проверяет bytes и symlink guard. Preview маскирован; подтверждение меняет только исходный span атомарно с сохранением mode. После этого workflow закрывается: пользователь делает Git commit и повторяет синхронизацию. Автоматического commit и замены только в transport нет.

Для Export нужны решения по каждому finding; оставшиеся block findings дополнительно требуют explicit override. Причины disabled показаны в workflow. Incoming Git проходит Review перед проверкой применения; `.md` Import проходит integrity/path/baseline/applicability validation и masked Preview. Scanner не гарантирует обнаружение всех конфиденциальных данных.
