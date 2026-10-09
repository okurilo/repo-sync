# Security Review

SelectExport автоматически запускает Scanner после выбора; при отсутствии findings экран Security Review пропускается. V4 сканирует полные версии только выбранных файлов, включая RENAME payload, а не patch hunks. До выбора analyze не запускает Scanner.

Scanner работает только для исходящего пакета, локально в Main по реально передаваемым records. Incoming Git и Import не запускают КБ-проверку; их код показывается без маскирования. Правила: private key / credential patterns, email, phone, ФИО и контекст полей имени, sensitive filenames. Severity warning/block обозначает потенциальные данные, а не подтверждённый факт. Есть предел 10 000 findings.

Renderer получает ID, path, actual line, причину, severity, replacement proposal и исходный preview/context без маскирования по уточнению пользователя. Контекст ограничен 160 символами по сторонам и в совпадении; служебные value/offset остаются в Main RAM. Code Comparison показывает исходные bytes. Payload, baseline bytes и transport при просмотре не меняются. Findings и полные values не записываются в settings/logs.

Экран показывает список файлов с поиском и все срабатывания выбранного файла. Галочками можно оставить одно значение, все значения файла или все найденные значения сразу; решения можно снять. Доступны исключение файла, замена локального исходника и открытие файла. Для remote вместо локальной замены можно открыть поддерживаемую GitHub/GitLab/Bitbucket ссылку и исправить источник самостоятельно. Исключение фильтрует подготовленный пакет и baseline, атомарно сохраняет exclusions, повторяет Scan/размер в памяти и сбрасывает решения; ошибка до сохранения оставляет прежнюю сессию.

Local replacement ищет единственный exact span в live файле, затем повторно проверяет bytes и symlink guard. Preview показывает исходное значение и предложение замены; подтверждение меняет только исходный span атомарно с сохранением mode. После этого workflow закрывается: пользователь делает Git commit и повторяет синхронизацию. Автоматического commit и замены только в transport нет.

Для Export нужны решения по каждому finding; оставшиеся block findings дополнительно требуют explicit override. Причины disabled показаны в workflow. Incoming Git и `.md` Import проходят integrity/path/applicability validation (baseline требуется только legacy) и Preview без КБ и маскирования. Массовое сохранение находок не включает override автоматически. Scanner не гарантирует обнаружение всех конфиденциальных данных.
