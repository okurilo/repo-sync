# RepoSync — требования к редизайну UI

В рамках этой задачи одновременно переработать визуальный интерфейс RepoSync.

Не переносить существующий admin-dashboard UI на новую продуктовую модель.

## Визуальное направление

RepoSync должен ощущаться как современный desktop developer tool.

Ориентиры по характеру интерфейса:

- Linear;
- Raycast;
- GitButler;
- Tower / Fork;
- современные native desktop utilities.

Не копировать конкретный продукт один в один.

Не использовать визуальную модель типичной корпоративной админки:

```text
sidebar
+ множество одинаковых белых cards
+ KPI tiles
+ таблицы
+ формы на основном экране
```

---

## 1. Repository — центральная сущность

Главный экран показывает repositories, а не раздел `Profiles`.

Карточка repository должна сразу отвечать:

```text
что это за repository
Internal или External
какая ветка
когда была последняя синхронизация
есть ли изменения
какое основное действие доступно
```

---

## 2. Минимум навигации

Не использовать постоянный большой Sidebar.

Предпочтительно:

```text
compact top bar

RepoSync | Repositories | Import                     ⚙
```

или ещё более компактный desktop shell.

Settings — вторичное действие.

---

## 3. Один главный action на экран

Например для Internal:

```text
[ Забрать изменения извне ]

[ Вынести изменения наружу ]
```

Не показывать рядом множество технических действий одинакового визуального веса.

---

## 4. Progressive disclosure

Технические параметры:

```text
SHA
baseline
scope
package id
transport metadata
advanced exclusions
```

скрывать в:

```text
Details
Advanced
```

Они не должны конкурировать с основным workflow.

---

## 5. Workspace вместо dashboard

После запуска Compare основной экран становится рабочей областью:

```text
Changed files | Diff
```

Текущий `Comparison` использовать как основу, но визуально усилить и сделать центральным элементом интерфейса.

---

## 6. Workflow screens

Для экспортного сценария:

```text
Compare → Security → Package
```

Для импортного:

```text
Package → Preview → Apply
```

Переход между этапами должен ощущаться как последовательный flow, а не набор независимых cards на одной странице.

---

## 7. Security Review

Security Review сделать отдельным focused экраном.

Одно finding — одно понятное решение.

Не показывать весь Security Scanner как большую таблицу.

Пример:

```text
Security review                  2 / 4

Potential personal data

src/mocks/users.ts · line 42

fullName: "Ив•••• И••• И••••••"

[ Исключить файл ]
[ Заменить в исходнике ]
[ Считать безопасным ]
```

---

## 8. Цвет

Основная палитра нейтральная.

Использовать:

```text
1 accent color
neutral surfaces
semantic red / amber / green
```

Не окрашивать большое количество блоков разными цветами.

Цвет должен передавать состояние, а не украшать интерфейс.

---

## 9. Типографика

Сформировать понятную hierarchy:

```text
Page title
Repository title
Section title
Body
Secondary
Technical / monospace
```

Commit SHA, пути и diff использовать monospace.

Не делать техническую информацию главным визуальным акцентом.

---

## 10. Spacing и surfaces

Уменьшить количество borders.

Иерархию строить через:

```text
spacing
background surfaces
typography
grouping
```

а не через рамку вокруг каждого блока.

---

## 11. Иконки

Не использовать emoji как постоянные UI icons:

```text
🏢
🌐
⚙
▤
```

Подключить один единый SVG icon set, например Lucide.

Emoji допустимы только как контент, но не как системная навигация.

---

## 12. Анимации

Анимации короткие и функциональные:

```text
150–250 ms
```

Использовать для:

- появления flow-step;
- открытия sheet/dialog;
- смены состояния;
- progress;
- успешного завершения.

Не добавлять декоративные сложные animations.

Все styled-components анимации оформлять через `css`.

---

## 13. Design tokens

До переработки экранов создать минимальный UI foundation:

```text
theme/
  colors
  spacing
  radius
  typography
  shadows
  motion
```

И набор базовых компонентов:

```text
Button
IconButton
Surface
Badge
Status
Dialog
Sheet
SegmentedControl
EmptyState
StepIndicator
RepositoryCard
```

Не хранить весь design system внутри `App.tsx`.

---

## 14. Рефакторинг renderer

Текущий монолитный `App.tsx` разделить.

Ориентировочно:

```text
renderer/
  app/
    App.tsx
    AppShell.tsx

  features/
    repositories/
    sync/
    comparison/
    security/
    import/
    settings/

  ui/
  theme/
```

Не менять Engine/Main только ради визуального рефакторинга.

---

## 15. Desktop layout

Интерфейс проектировать в первую очередь для desktop Electron window:

```text
minimum ~900 px
comfortable ~1200–1400 px
```

Не требуется полноценный mobile responsive design.

Окно может адаптироваться к уменьшению размера, но desktop UX является основным.

---

## 16. Empty states

Не оставлять пустые технические формы.

Например первый экран:

```text
RepoSync

Переносите изменения между изолированными Git-контурами.

[ Добавить repository ]
```

После добавления repository пользователь сразу должен понимать следующий шаг.

---

## 17. Product feel

Интерфейс должен ощущаться как desktop developer tool, а не admin dashboard.

Предпочтительная модель:

```text
Repository
→ current sync status
→ one clear action
→ focused workflow
```

Не:

```text
menu
→ section
→ card
→ table
→ settings
→ technical mode selector
```

---

# Definition of Done

Редизайн считается завершённым, если новый пользователь без документации понимает:

```text
куда нажать,
чтобы забрать изменения извне;

куда нажать,
чтобы вынести изменения наружу;

куда нажать,
чтобы применить принесённый package.
```

Если интерфейс по-прежнему выглядит как настройка Git-конвейера или admin dashboard — задача выполнена неправильно.
