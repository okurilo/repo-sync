> Историческое решение с последовательными уточнениями. Текущий outgoing v4 и автоматические проверки определены ADR 0006 и актуальными specs.

# ADR 0004 — Exactly two directional workflows

Статус: принято, 2026-10-06. Заменяет универсальный product workflow ADR 0002/0003; их исторические описания сохранены.

RepoSync supports exactly two directional workflows: External → Internal по внешнему Git и Internal → External через `.md` package. Compare строится от общей canonical sync state. Independent изменения принимающей стороны сохраняются направленным patch; конфликт останавливается без автоматического merge.

Общие bytes сохраняются по SHA256 в существующем cache, поскольку чужого commit может не быть в другой Git history, а mutable local files не являются надёжным baseline. Snapshot/Diff выбирается автоматически. Commit/base selectors и transport-only redaction удалены из product UX. New transport v3 только `.md`, с adaptive compression и multipart binary; v1/v2 импортируются.

Уточнение пользователя 2026-10-06: Security Review нужен только перед исходящим пакетом. Incoming/Import не сканируются и не маскируются. Для первого Incoming общая точка автоматически выводится из единственного Git merge-base, затем сохраняется только после успешного Apply. Исходящие находки показываются списком по файлам с индивидуальным и массовым сохранением; override данных доступа остаётся отдельным. Это заменяет прежний обязательный Incoming Review и одно finding за раз.

Уточнение 2026-10-06: первое Incoming должно сравнивать выбранные локальное и внешнее состояния целиком. Merge-base bootstrap отменён; первоначальный before — локальный HEAD. Удаления локальных-only файлов показываются явно. После Apply прежняя canonical common state продолжает сохранять независимые изменения.
