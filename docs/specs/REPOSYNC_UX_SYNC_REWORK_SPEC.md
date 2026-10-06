# RepoSync — ТЗ на переработку UX и сценариев синхронизации

## 1. Цель переработки

Текущая реализация функционально стала слишком универсальной и из-за этого:

- управление неочевидно;
- пользователь вынужден понимать внутреннюю модель RepoSync;
- в интерфейсе слишком много выбора;
- приложение воспринимается как Git/admin utility;
- простые реальные сценарии требуют лишних действий.

Необходимо упростить продукт.

RepoSync решает **только два пользовательских сценария**:

```text
1. EXTERNAL → INTERNAL
   Забрать изменения из внешнего Git во внутренний repository.

2. INTERNAL → EXTERNAL
   Вынести изменения внутреннего repository наружу через .md package.
```

Других пользовательских сценариев в v1 нет.

Не добавлять универсальные режимы вида:

```text
source A
source B
base commit
target commit
custom direction
compare arbitrary commits
```

Такие возможности могут существовать внутри engine или diagnostics, но не должны быть основной пользовательской моделью.

---

## 2. Internal / External относится к repository

Удалить глобальный режим приложения:

```text
Internal / Global
```

из Settings и первого запуска.

Тип задаётся **для конкретного repository/profile**:

```text
Repository type:

○ Internal repository
○ External repository
```

Один RepoSync технически может содержать несколько repository разных типов.

На практике:

```text
корпоративный компьютер
→ обычно Internal repositories

личный компьютер
→ обычно External repositories
```

Но приложение не должно жёстко привязывать всю установку к одному типу.

---

## 3. Модель Repository Profile

### Internal repository

Хранит:

```text
name

local repository path
local branch

external Git URL
external branch

sync baseline/state
exclusions
max package size
transport mode
```

Например:

```text
Core App

Internal
C:\Projects\core-app
develop

External
https://github.com/okurilo/core-app.git
develop
```

### External repository

Хранит:

```text
name

local repository path
branch

sync baseline/state
```

Remote Git URL для внешнего profile может быть сохранён как дополнительная информация, но он не нужен для основного Import workflow.

После применения package пользователь самостоятельно выполняет обычные:

```text
git status
git commit
git push
```

RepoSync не делает автоматический push.

---

## 4. Сценарий №1 — External → Internal

Это основной входящий сценарий на корпоративном компьютере.

Internal profile знает:

```text
локальный internal repository
+
URL внешнего repository
+
external branch
```

Пользователь нажимает одну основную кнопку:

```text
[ Забрать изменения извне ]
```

RepoSync:

```text
External Git
     ↓
fetch
     ↓
сравнение с последней точкой синхронизации
     ↓
только внешние изменения
     ↓
Preview
     ↓
Security / validation
     ↓
Apply
     ↓
Internal local repository
```

### Важно

Internal repository является живым.

В нём могут одновременно появляться собственные изменения:

```text
коллеги работают
git pull
новые internal commits
```

Поэтому запрещено:

```text
reset internal repository к external HEAD
replace repository целиком
```

External changes должны накладываться как направленный patch поверх текущего internal state.

Перед Apply:

```text
preflight
backup
patch applicability check
```

Если internal и external изменили несовместимый участок:

```text
Синхронизация остановлена.

Конфликт:
src/...

Внутренний repository не изменён.
```

Автоматический conflict merge в v1 не делать.

---

## 5. Сценарий №2 — Internal → External

На Internal profile пользователь нажимает:

```text
[ Вынести изменения наружу ]
```

RepoSync вычисляет:

```text
последняя общая sync state
        ↓
текущее committed состояние internal repository
        ↓
только internal changes
```

После Preview и Security Scan создаётся:

```text
reposync-....md
```

или несколько `.md` частей.

Файл вручную переносится на внешний компьютер.

На внешнем компьютере пользователь открывает RepoSync и выбирает:

```text
[ Применить пакет из контура ]
```

RepoSync:

```text
.md
 ↓
validate
 ↓
preview
 ↓
preflight
 ↓
backup
 ↓
apply
 ↓
External local repository
```

После этого RepoSync показывает:

```text
Изменения применены.

Репозиторий готов для обычного Git workflow.

[Открыть repository]
```

Дальше commit/push пользователь делает обычными Git-инструментами.

---

## 6. Baseline должен быть внутренней деталью

RepoSync продолжает хранить synchronization state, но пользователь не должен выбирать её вручную.

Не показывать в основном workflow:

```text
base commit selector
target commit selector
source commit selector
compare arbitrary commits
```

Технические SHA можно отображать мелким текстом в Details.

Главный UI говорит:

```text
Последняя синхронизация
5 октября, 18:42
```

а не:

```text
base: a82f91d
target: f9a2173
```

Engine самостоятельно определяет точку сравнения.

---

## 7. Первый перенос

Пользователь не выбирает:

```text
Snapshot / Diff
```

RepoSync определяет это автоматически.

Если synchronization baseline отсутствует:

```text
Первичная синхронизация
```

и создаётся полный пакет.

Если baseline существует:

```text
Обычная синхронизация
```

и создаётся только diff.

В UI допустимо показать:

```text
Первичная синхронизация
Будет передано полное состояние repository.
```

Но не заставлять пользователя выбирать transport type.

---

## 8. Два состояния изменений одновременно

У Internal repository могут одновременно существовать:

```text
external changes
+
internal changes
```

RepoSync должен учитывать направление.

Нельзя просто сравнивать:

```text
текущий internal tree
vs
текущий external tree
```

и считать весь diff одним направлением.

Необходимо хранить последнюю общую synchronization state.

Логика:

```text
             common sync state
              /            \
             /              \
internal changes        external changes
```

### External → Internal

Берётся:

```text
common state
→ external state
```

и только этот patch накладывается на текущий internal repository.

### Internal → External

Берётся:

```text
common state
→ internal state
```

и только этот patch помещается в transport package.

После успешной синхронизации соответствующая synchronization state обновляется.

Эта логика является критически важной.

---

## 9. Главный экран

Убрать ощущение Admin Dashboard.

Не использовать основной layout:

```text
Sidebar
Profiles
Import
Settings
Cards
Stats
```

Главный экран — список repositories.

Пример:

```text
RepoSync                                         ⚙

Repositories

┌───────────────────────────────────────────────────────┐
│ Core App                                      INTERNAL│
│                                                       │
│ C:\Projects\core-app                                  │
│ develop                                               │
│                                                       │
│ External: github.com/okurilo/core-app · develop       │
│                                                       │
│ Последняя синхронизация: 5 октября, 18:42             │
│                                                       │
│ Извне:       7 изменений                              │
│ Изнутри:    12 изменений                              │
│                                                       │
│ [ Забрать изменения извне ]                           │
│ [ Вынести изменения наружу ]                          │
└───────────────────────────────────────────────────────┘

+ Добавить repository
```

Для External:

```text
┌───────────────────────────────────────────────────────┐
│ Core App                                      EXTERNAL│
│                                                       │
│ /Users/oleg/projects/core-app                         │
│ develop                                               │
│                                                       │
│ [ Применить пакет из контура ]                        │
└───────────────────────────────────────────────────────┘
```

Никаких дополнительных режимов на главном экране.

---

## 10. Экран Internal Repository

После открытия Internal repository:

```text
← Repositories

Core App                                     INTERNAL

C:\Projects\core-app
develop

                   Синхронизация

    External                           Internal

github.com/...                     C:\Projects\...
develop                             develop

       7 изменений      ↔       12 изменений


[ Забрать изменения ]        [ Вынести наружу ]
```

Ниже:

```text
Последняя синхронизация
5 октября · 18:42

External state
актуален / есть изменения

Internal state
актуален / есть изменения
```

SHA и технические сведения убрать в:

```text
Details
```

---

## 11. Flow вместо admin-форм

После действия пользователь проходит линейный workflow.

### External → Internal

```text
Compare
   ↓
Preview
   ↓
Apply
   ↓
Done
```

### Internal → External

```text
Compare
   ↓
Security
   ↓
Package
   ↓
Done
```

В верхней части экрана допустим компактный step indicator:

```text
Compare  ───  Security  ───  Package
  ✓              ●              ○
```

Security не должен выглядеть как ещё одна большая dashboard card.

---

## 12. Diff Preview

Текущий `Comparison` сохранить концептуально, но сделать его центральной частью workflow.

Layout:

```text
┌──────────────────┬───────────────────────────────────┐
│ Changed files    │ src/App.tsx                       │
│                  │                                   │
│ + Search.tsx     │ - old code                        │
│ ~ App.tsx        │ + new code                        │
│ - Legacy.ts      │                                   │
│                  │                                   │
└──────────────────┴───────────────────────────────────┘
```

Вверху компактно:

```text
12 files changed
+84  -31
```

Не использовать несколько KPI cards.

---

## 13. Security Review

Security Scan оставить, но переделать UX.

Каждое срабатывание рассматривается как отдельное решение:

```text
Security review                     2 / 4

⚠ Potential personal data

src/mocks/users.ts · line 42

fullName: "Ив•••• И••• И••••••"

Причина:
поле fullName + значение похоже на ФИО

[ Исключить файл ]
[ Заменить в исходнике ]
[ Считать безопасным ]
```

Чувствительное значение должно быть замаскировано в Renderer.

Полное значение остаётся только в Main process.

Удалить действие:

```text
[Заменить на *** только в пакете]
```

Такой режим нарушает соответствие source/destination state.

---

## 14. Transport должен снова быть только `.md`

Текущую схему:

```text
.md
+
.binary001.png
+
.binary002.bin
```

убрать.

Через границу должен передаваться только текстовый transport:

```text
*.md
```

Binary payload кодируется внутрь `.md`.

Поддержать:

```text
RAW
BASE64
BROTLI_BASE64
```

Никаких sidecar binary files.

---

## 15. Компактный transport

Сейчас пакет может получаться слишком большим.

Пример текущего результата:

```text
~77 000 строк
~1.6 MB
```

Добавить пользователю настройку:

```text
Формат transport

○ Читаемый
● Компактный
```

По умолчанию:

```text
Компактный
```

### Читаемый

Предназначен для анализа человеком.

Текстовые payload могут храниться непосредственно в Markdown.

### Компактный

Предназначен для реального переноса.

Использовать:

- minified transport metadata;
- отсутствие декоративных Markdown sections;
- отсутствие pretty-print JSON;
- Brotli для payload, если он уменьшает размер;
- Base64 для бинарного результата;
- adaptive выбор RAW / BASE64 / BROTLI_BASE64.

Важно:

Минификация касается только transport representation.

После Import:

```text
SHA256(original bytes)
===
SHA256(restored bytes)
```

Исходники нельзя:

- форматировать;
- менять whitespace;
- менять LF/CRLF;
- запускать Prettier;
- удалять комментарии;
- минифицировать как JavaScript.

---

## 16. Maximum part size

Сохранить:

```text
Maximum package part size
```

Если пакет превышает лимит:

```text
part001.md
part002.md
...
```

Любой payload, включая binary, должен уметь фрагментироваться между `.md` parts.

Не должно быть ошибки:

```text
binary больше Maximum part size
```

если его можно корректно разбить по transport chunks.

---

## 17. Git workflow

Основной RepoSync workflow использует committed состояние выбранной локальной ветки.

Если repository dirty:

```text
Есть незакоммиченные изменения:

staged: ...
unstaged: ...
untracked: ...
```

Показать предупреждение:

```text
Незакоммиченные изменения не входят в синхронизацию.
```

Не добавлять в основной интерфейс возможность выбора staged / unstaged / arbitrary commit.

Для текущего продукта это лишнее.

---

## 18. Настройка Internal repository

Форма должна быть короткой.

```text
Название
[ Core App ]

Тип
[ Internal ]

Локальный repository
[ C:\Projects\core-app ] [Выбрать]

Локальная ветка
[ develop ]

Внешний Git
[ https://github.com/okurilo/core-app.git ]

Внешняя ветка
[ develop ]

Дополнительно ▼
```

В `Дополнительно`:

```text
Exclusions
Maximum part size
Readable / Compact transport
```

Commit selectors убрать из обычной формы.

---

## 19. Настройка External repository

```text
Название
[ Core App ]

Тип
[ External ]

Local repository
[ /Users/oleg/projects/core-app ] [Выбрать]

Branch
[ develop ]
```

Этого достаточно для основного сценария.

---

## 20. Исправления текущей реализации

### Удалить

```text
глобальный Internal/Global mode
arbitrary commit comparison из основного UI
source/base/target selectors из обычного workflow
transport-only "***" replacement
binary sidecar files
обязательное ручное Snapshot/Diff переключение
admin-dashboard layout
```

### Сохранить

Текущие сильные части:

```text
Electron Main / Preload isolation
typed IPC
Git validation
Remote Git cache
Security Scanner
path validation
Import preflight
SHA256 integrity
backup
rollback
recovery journal
Comparison code viewer
pending transfer concept
```

Engine не переписывать без необходимости.

---

## 21. Документация

После изменения обязательно привести к новой продуктовой модели:

```text
SDD
ADR
synchronization.md
transport-format.md
security-scan.md
README
```

Добавить ADR о решении:

```text
RepoSync supports exactly two directional workflows
```

и ADR:

```text
Environment role belongs to Repository Profile, not application
```

Документация должна перестать описывать старый универсальный workflow.

---

## 22. Что не делать

Не добавлять:

```text
новые режимы Git comparison
advanced Git client
commit manager
automatic Git push
merge UI
branch management
network sync между контурами
AST
dependency tree
новые transport форматы
```

Главное правило:

> Если функция не помогает напрямую либо забрать внешние изменения внутрь, либо вынести внутренние изменения наружу — её не должно быть в основном UX RepoSync.

---

# Definition of Done

Пользователь без знания внутренней архитектуры RepoSync должен уметь выполнить:

### External → Internal

```text
Открыть Internal repository
→ Забрать изменения извне
→ увидеть diff
→ Apply
```

### Internal → External

```text
Открыть Internal repository
→ Вынести наружу
→ проверить diff
→ Security Review
→ получить компактный .md
```

### На внешнем компьютере

```text
Открыть External repository
→ Применить пакет из контура
→ выбрать .md
→ Preview
→ Apply
```

Если для любого из этих трёх действий пользователь должен вручную выбирать baseline, Snapshot/Diff, source commit или направление сравнения — UX всё ещё реализован неправильно.
