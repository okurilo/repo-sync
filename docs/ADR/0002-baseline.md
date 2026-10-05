# 0002 — Выбранный commit и последнее синхронизированное состояние

Статус: принято после уточнения пользователя, 2026-10-05.

SHA commit — идентификатор Git состояния. Он отличается от SHA256 файла, который проверяет точность переноса bytes. Пользователь выбирает repository, branch и конкретный target commit отдельно для Internal / Global. Пустой selected commit означает последний commit выбранной ветки. В UI загружаются ветки и последние 256 commits; более старый можно указать полным SHA. Выбранный commit должен принадлежать ветке.

По умолчанию Diff строится от последнего подтверждённого synchronized state к выбранному target commit. Baseline хранит state ID, included inventory и scope digest. Before bytes читаются из этого commit в выбранном Git source.

Git history не передаётся, поэтому corporate commit может отсутствовать во внешнем Git. Это вопрос корректного сравнения, а не киберзащита. Import сохраняет optional localRepository — путь target, в который восстановлены baseline файлы. Если source Git не содержит commit, before bytes читаются оттуда и проверяются по inventory hashes. Нет отдельной базы исходников, автоматического commit mapping или проверки общего ancestry между контурами. Если baseline bytes уже изменены/недоступны, нужен Snapshot.

Версии с manually included ignored bytes идентифицируются content inventory digest; localRepository указывает их working tree. Scope fingerprint меняется вместе с exclusions / ignored opt-ins и требует Snapshot для нового scope.

После Export baseline не меняется до явного подтверждения переноса. Отмена pending не продвигает его. После Import synchronized state становится targetState. Ни Import, ни span replacement не коммитят и не меняют index автоматически.

Settings schemaVersion 2; v1 мигрирует с выбором branch HEAD по умолчанию. Transport schemaVersion 1 не изменена.
