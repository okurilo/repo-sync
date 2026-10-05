# 0001 — Electron isolation и системный Git

Статус: принято, 2026-10-05.

Системные действия выполняет только Main. Preload раскрывает конечный типизированный allowlist. Один активный IPC request и single-instance lock предотвращают параллельные Apply / изменение настроек во время операций. BrowserWindow sandbox включён, permissions/новые окна/navigation выключены. Renderer не может читать произвольные `file://` или обращаться в сеть.

Local Git читается без remote calls. Remote Git fetch выполняется только в Global по HTTPS/SSH URL пользователя, без checkout, submodule recursion, shell, hook execution, interactive prompt или HTTP redirects. Используется обычный bare cache: partial clone не нужен для минимальной v1 и в ТЗ лишь допускается. Credentials не сохраняются приложением.

«Открыть файл» показывает файл в системной папке: это не запускает потенциально исполняемый payload через file association. Для remote по явному действию открывается HTTPS URL; SSH источник пользователь открывает своим Git-клиентом.

Production работает с локальными bundled assets. Loopback HTTP Vite оправдан только в dev, не является сервисом синхронизации.
