# ADR 0005 — Environment role belongs to Repository Profile

Статус: принято, 2026-10-06.

Environment role belongs to Repository Profile, not application. Internal profile хранит local Git и external URL; External profile хранит local Git для Import. Несколько ролей могут сосуществовать в одной установке. Глобальный Internal/Global переключатель удалён из settings/UI/IPC.

Settings v4 мигрирует прежние sources, снимает explicit commits/base и сохраняет исходный JSON. Старые независимые baselines нельзя безопасно объявить общей sync state, поэтому новая модель начинает первичную синхронизацию. Незавершённый pending сохраняется для явного разбора. Старые recovery settings snapshots нормализуются тем же parser при сохранении.

Технические source keys internal/global сохраняются внутри Git helpers для небольшого diff; они не являются application mode. Renderer foundation и focused workflow разделены на небольшие feature/UI файлы без изменения process isolation.
