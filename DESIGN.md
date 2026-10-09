---
name: "RepoSync"
description: "Минеральный атлас выбранных изменений в настольном Git-инструменте"
colors:
  bg: "#f5f7f3"
  surface: "#fafbf8"
  raised: "#edf1ea"
  input: "#ffffff"
  text: "#25362f"
  muted: "#5b6d60"
  line: "#d1dacf"
  accent: "#315d47"
  tint: "#dfe9da"
  success: "#2f603b"
  danger: "#914333"
  warning: "#806017"
  added: "#e2efdd"
  removed: "#f3e5df"
  dark-bg: "#17241f"
  dark-surface: "#1d2c25"
  dark-raised: "#25382e"
  dark-input: "#17251e"
  dark-text: "#edf3ed"
  dark-muted: "#adbfaf"
  dark-line: "#3f5345"
  dark-accent: "#a7ceb5"
  dark-tint: "#304b39"
  dark-success: "#add5b5"
  dark-danger: "#f3b6a8"
  dark-warning: "#e8cc93"
  dark-added: "#294832"
  dark-removed: "#49322b"
  rail: "#163d36"
  rail-text: "#e4eee7"
  rail-active: "#2d554b"
  rail-active-text: "#ffffff"
  rail-focus: "#c4e4d2"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "27px"
    letterSpacing: "-0.8px"
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "18px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "14px"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: "0.2px"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
rounded:
  flat: "0px"
  file: "4px"
  control: "5px"
  switch: "6px"
  status: "8px"
  segmented: "10px"
  dialog: "16px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
  page: "36px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "34px"
  button-danger:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "34px"
  input:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  surface:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.flat}"
    padding: "24px"
  badge:
    textColor: "{colors.muted}"
    rounded: "{rounded.flat}"
    padding: "2px 0"
  navigation:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-text}"
    padding: "24px 8px"
    width: "88px"
  file-selected:
    backgroundColor: "{colors.tint}"
    textColor: "{colors.text}"
    rounded: "{rounded.file}"
    padding: "8px 6px"
---

# Design System: RepoSync

## Overview

**Creative North Star: "Минеральный атлас"**

«Минеральный атлас» — спокойное рабочее пространство с зелёной навигацией, светлыми минеральными поверхностями и точными разделителями. Плотность поддерживает чтение путей и кода; цвет выделяет действие и смысл изменения.

Это React-интерфейс настольного Electron-продукта macOS и Windows. Светлая тема — новый default; ранее сохранённый тёмный выбор в localStorage сохраняется. Обе темы используют одинаковую иерархию. Направление A подтверждено пользователем; документ извлечён из реализованного кода.

**Key Characteristics:**
- Системный sans для интерфейса, моноширинный шрифт для кода и путей.
- Плоские рабочие поверхности, тональные области и тонкие разделители.
- Семантические цвета сопровождаются текстом и знаками изменений.

## Colors

Основной акцент — хвойный зелёный; нейтральные поверхности напоминают светлый минерал. Frontmatter хранит точные значения: ключи без префикса соответствуют light, `dark-*` — dark. Runtime выбирает одну палитру и публикует её как `--bg`, `--surface`, `--accent` и остальные одноимённые CSS-переменные.

### Primary

`accent` обозначает основное действие, активные элементы и фокус; `tint` — мягкую выбранную область. Постоянная зелёная rail имеет собственные цвета текста, активного состояния и фокуса в обеих темах.

### Neutral

`bg` — фон приложения; `surface` — область чтения; `raised` — дерево, панели и вторичные controls; `input` — поле ввода. `text`, `muted` и `line` задают текст, вторичный контекст и разделители.

Семантические `success`, `danger`, `warning`, `added`, `removed` обслуживают состояния и diff. Добавления и удаления дополнены знаками +/− и доступными подписями; цвет не является единственным сигналом.

## Typography

Системный sans следует ОС пользователя; интерфейс не поставляет web-font. Заголовок страницы — `headline`, обычный h2 — `section`, базовый текст — `body`, текстовый статус — `label`. `mono` обслуживает пути, SHA и код. Абзацы имеют line-height (1.6); кнопки — вес (600), line-height (1.35). Размер section (20px) присутствует в исходном tokens.ts, но обычный h2 реально использует (18px): frontmatter отражает используемую роль, а не неиспользуемый резерв. Аналогично неиспользуемый radius.surface (14px) не предписывает форму поверхностей.

## Layout

Ритм существующих токенов — small/medium/large/page; page (36px) остаётся резервом, текущая оболочка использует padding (24px 28px), при ширине ≤1100px — (20px), ≤700px — (16px 12px). Rail имеет ширину (88px), ≤700px — (64px), и занимает высоту (100dvh).

Рабочий экран сравнения: расширяемая основная область и инспектор (280px), gap (24px). При ≤1100px инспектор переносится ниже и теряет sticky. Дерево по умолчанию (250px), resize horizontal в диапазоне (190–380px); ≤700px занимает полную ширину, высота ограничена (180px), resize отключён. Это адаптация узкого desktop-окна, не отдельный mobile-продукт. Высота сравнения — `max(460px, calc(100dvh - 225px))`. Обзор профилей — единый список с горизонтальными разделителями. Детальная композиция и Mode: Operate принадлежат `.impeccable/surfaces/src-renderer-app-tsx.md`.

## Elevation & Depth

Рабочие поверхности плоские; глубину задают тон и разделитель. Только диалог получает существующую тень; overlay затемняет фон. Inspector использует raised без тени. Reveal (180ms ease-out) сохраняет opacity 1→1 и не создаёт вступительного движения. Controls меняют фон, border и focus за (160ms ease); active сдвигается вниз на (1px). Skeleton пульсирует (1.4s), busy-полоска движется (1.5s), reduced-motion отключает animation и transition.

## Shapes

Surface, сравнение, inspector и текстовые badge прямоугольные. Controls слегка скруглены; file row и switches имеют собственные малые радиусы. Локальные исключения сохранены: Status (8px), BusyNotice и skeleton (10px), segmented group (10px), Dialog/Sheet (16px). Не превращать наличие этих исключений в общее скругление контейнеров.

## Components

Кнопка primary использует accent/bg; secondary — raised/text; danger меняет текст на danger. Общие padding (8px 12px), min-height (34px), gap (8px), прозрачный border (1px). Hover меняет border на accent и brightness (1.08); active даёт сдвиг; disabled получает opacity (0.48) и not-allowed. IconButton остаётся прозрачным с padding (9px).

Поле имеет border line (1px), padding (8px 10px), placeholder muted. Hover использует muted border; focus — accent border и кольцо `color-mix(in srgb, var(--accent) 15%, transparent)` (3px). Общий focus-visible — accent outline (2px) с offset (3px).

Навигация вертикальна: SVG и короткая подпись, выбранное/hover состояние rail-active; rail-focus заменяет общий outline. Badge — прозрачная текстовая метка без pill, с переносом длинного текста. Surface — фон surface и padding (24px), а профиль использует прозрачный фон и padding (24px 0). Входящий source внутри инспектора также прозрачный и без padding: scoped exception, не новая карточка.

Сравнение использует выбранную file row с tint, две стороны До/После либо единый список, постоянный toolbar и независимую прокрутку. Фильтры — свернутые details; скрытие строк не скрывает выбранные операции. Статусы и ошибки остаются рядом с действием. Dialog/Sheet сохраняют focus trap и возврат фокуса; визуальная система не является заявлением о полной сертификации доступности.

## Do's and Don'ts

### Do:
- **Do** сохранять русскоязычные подписи и фактические пути без декоративной подмены контента.
- **Do** использовать соответствующие семантические переменные текущей темы для состояния, diff и фокуса.
- **Do** сохранять отдельный контрастный focus-visible и отключать движение при prefers-reduced-motion.

### Don't:
- **Don't** превращать обзор профилей в карточочную сетку или текстовые статусы в pill-бейджи.
- **Don't** заменять системную типографику декоративными шрифтами или добавлять декоративные raster-assets без нового решения.
- **Don't** распространять композицию конкретного рабочего экрана на все будущие поверхности: её контракт хранится в surface brief.

Shipping raster-assets не добавлены. `.impeccable/review/*.jpg` — evidence actual Renderer с mock IPC; это не UI-ресурсы и не проверка всех платформ.
