# RepoSync v1 — техническое задание

## 1. Цель

RepoSync — локальное desktop-приложение для переноса и синхронизации состояния Git-репозиториев между двумя изолированными контурами через текстовые `.md`-пакеты.

Инфраструктурное ограничение:

```text
INTERNAL / корпоративная сеть
        │
        │ прямой передачи наружу нет
        ▼
    RepoSync .md
        │
        │ ручной перенос
        ▼
GLOBAL / внешняя сеть
```

При этом в `Global` доступен внешний Git, например GitHub.

RepoSync должен решать два основных сценария:

1. первый перенос полного состояния репозитория;
2. последующие переносы только фактического diff.

---

## 2. Стек и приложение

Использовать:

- Electron
- React 18
- TypeScript
- Vite
- styled-components

Приложение собирается локально из исходников.

Electron:

```text
Main
├── Git
├── File System
├── RepoSync Engine
├── Security Scanner
└── Settings

Preload
└── typed IPC API

Renderer
└── React + Vite
```

Требования:

```text
nodeIntegration: false
contextIsolation: true
```

Renderer не должен иметь прямого доступа к Git или файловой системе.

Electron не должен поднимать localhost HTTP server без технической необходимости.

---

## 3. Режим среды: Internal / Global

При первом запуске до основного интерфейса показать выбор:

```text
Где запущен RepoSync?

[ Internal ]
Корпоративный контур.
Внешний Git недоступен.

[ Global ]
Есть доступ к внешнему Git.
```

Выбор сохраняется локально.

Текущий режим всегда виден в интерфейсе:

```text
🏢 Internal
```

или:

```text
🌐 Global
```

В Settings режим можно изменить.

### Internal

Доступны:

- Local Git repository;
- создание Snapshot/Diff package;
- импорт `.md`;
- применение package к локальному repository.

Поля Remote Git в этом режиме скрыты.

Приложение не должно самостоятельно пытаться обращаться во внешнюю сеть.

### Global

Доступны:

- Local Git repository;
- Remote Git repository;
- импорт `.md`;
- сравнение с remote branch;
- создание package для переноса в Internal.

---

## 4. Synchronization Profile

Пользователь может создать профиль синхронизации.

Пример:

```text
Name:
Core App

Internal:
D:\Projects\core-app
branch: master

Global:
https://github.com/user/core-app.git
branch: master
```

В Internal показывается только локальная корпоративная сторона.

В Global — внешняя сторона и известная точка состояния корпоративного контура.

Профиль хранит как минимум:

```text
name
environment-specific source
branch
last synchronized state
custom exclusions
max part size
```

---

## 5. Источники Git

RepoSync должен иметь единый слой источников:

```text
LocalGitSource
RemoteGitSource
```

### LocalGitSource

Работает с локальной папкой Git repository.

Должен уметь:

- определить branch / HEAD;
- получить список файлов;
- прочитать файл;
- сравнить состояния;
- получить staged / unstaged / untracked при локальном сценарии;
- использовать Git ignore rules.

### RemoteGitSource

Доступен только в Global.

Пользователь задаёт:

```text
repository URL
branch
```

RepoSync работает через системный Git и служебный локальный cache приложения.

Обычный рабочий checkout пользователю не требуется.

Допустимо использовать partial clone / fetch без checkout и подтягивать содержимое файлов только при необходимости.

Git credentials самостоятельно не хранить.

---

## 6. Snapshot и Diff

RepoSync поддерживает два transport-типа.

### Full Snapshot

Используется:

- при первой синхронизации;
- если baseline потерян;
- при ручном полном переносе.

В Snapshot включённые файлы передаются целиком.

`.git` и Git history не переносятся.

После восстановления каждый файл должен быть byte-to-byte идентичен исходному:

```text
SHA256(source) === SHA256(restored)
```

### Diff

Используется для последующих обновлений.

Поддержать:

```text
MODIFY
ADD
DELETE
RENAME
```

Поведение:

```text
MODIFY → unified Git patch
ADD    → полный payload нового файла
DELETE → metadata без payload
RENAME → oldPath/newPath + необходимые hashes
```

Если rename нельзя надёжно определить, допустимо представить его как:

```text
DELETE + ADD
```

Для бинарного MODIFY допускается `REPLACE` полной новой версией.

---

## 7. Точки синхронизации

Для committed Git states основной идентификатор — commit SHA.

Пример:

```text
lastSyncedCommit = abc123
currentCommit    = def456
```

Diff строится:

```text
abc123 → def456
```

Package содержит обе точки:

```text
sourceState
targetState
```

Первый Snapshot создаёт исходную точку синхронизации.

После успешного Import принимающая сторона сохраняет `targetState` как текущий synchronized state.

После Export package считается `pending`, пока пользователь явно не подтвердит:

```text
[Пакет успешно перенесён]
```

После подтверждения его `targetState` становится локальной точкой синхронизации.

Это предотвращает потерю baseline при неудачной физической передаче файла.

Для локальных незакоммиченных изменений допускается отдельный Local Diff workflow, но committed state остаётся предпочтительным сценарием синхронизации между контурами.

---

## 8. Исключения

Базой exclusion rules являются реальные Git ignore rules:

```text
.gitignore
nested .gitignore
.git/info/exclude
```

Предпочтительно использовать сам Git (`git check-ignore` и связанные команды), а не самостоятельно воспроизводить всю семантику `.gitignore`.

`.git/**` всегда исключается.

Пользователь может добавить RepoSync exclusions:

```text
**/*.test.*
**/*.spec.*
**/__mocks__/**
**/fixtures/**
```

UI показывает итог:

```text
Excluded by Git:      12 410
Excluded by RepoSync:     83
Included:                614
```

Пользователь может вручную вернуть ignored-файл, но должен получить предупреждение, поскольку ignored-файлы часто содержат `.env`, credentials и другие чувствительные данные.

---

## 9. Security / КБ проверка

Перед каждым Export выполняется локальный Security Scan.

Никакие исходники, findings или telemetry не отправляются наружу.

UI явно показывает:

```text
Проверка выполняется локально.
Данные не покидают компьютер.
```

Scanner анализирует только то, что реально попадёт в transport.

### Проверять минимум

Secrets:

```text
password
secret
token
apiKey
accessToken
refreshToken
clientSecret
authorization
private key
.env
*.pem
*.key
```

Персональные данные:

```text
ФИО RU
Names EN
email
phone
```

Повышать confidence при контексте:

```text
firstName
lastName
middleName
fullName
fio
employeeName
customerName
personName
```

и в каталогах:

```text
mock
mocks
fixtures
test-data
seed
demo
```

Поиск ФИО эвристический, поэтому UI формулирует:

```text
Обнаружены потенциально конфиденциальные данные
```

а не утверждает наличие ПДн как факт.

### Что сканировать

Snapshot:

```text
весь included payload
```

ADD:

```text
весь новый файл
```

MODIFY:

```text
реальный diff payload, включая добавляемые и удаляемые строки
```

DELETE без payload сканировать по содержимому не требуется.

---

## 10. Действия по результатам КБ-проверки

Для каждого finding показать:

```text
file
line / location
masked preview
reason
```

Исходное чувствительное значение полностью в UI без необходимости не отображать.

Доступные действия:

```text
[Исключить файл]
[Открыть файл]
[Оставить]
```

Для Local Source дополнительно:

```text
[Предложить замену]
```

Примеры предложений:

```text
Иванов Иван Иванович
→ Тестовый Пользователь

john.smith@company.ru
→ test@example.invalid

actual-secret
→ REPOSYNC_REDACTED
```

Если пользователь применяет замену:

1. показать preview;
2. явно предупредить, что изменится исходный локальный файл;
3. заменить только найденный span;
4. заново выполнить Git analysis;
5. заново выполнить Security Scan.

RepoSync не должен тайно заменять значение только в transport package, иначе destination перестаёт соответствовать source state.

Для Remote Git автоматическая замена недоступна.

В этом случае:

```text
[Исключить файл]
[Открыть источник]
[Оставить]
```

Для private key / очевидного secret экспорт по умолчанию блокируется, пока пользователь не исключит/исправит данные либо явно не подтвердит override.

Найденные секреты и ФИО не сохранять в логах.

---

## 11. Формат transport package

Transport — один логический package из одного или нескольких `.md` файлов:

```text
project.part001.md
project.part002.md
project.part003.md
```

Manifest содержит минимум:

```text
protocolVersion
packageId
packageType
sourceState
targetState
partNumber
totalParts
records
integrity data
```

Для файла/операции хранить:

```text
path
operation
size
beforeSha256 / afterSha256 при необходимости
payload encoding
```

### Encoding

Не создавать собственный whitespace codec.

Использовать:

```text
RAW
BASE64
BROTLI_BASE64
```

Выбирать наиболее компактное lossless-представление.

После encode/decode исходные bytes должны восстанавливаться без изменений.

Не запускать:

```text
Prettier
ESLint --fix
formatter
```

Должны сохраняться:

```text
spaces
tabs
LF
CRLF
blank lines
trailing spaces
final newline
binary bytes
```

---

## 12. Ограничение размера и chunking

В UI пользователь задаёт:

```text
Maximum part size:
[100] MB
```

Если package больше, он автоматически делится на части.

Каждая часть содержит:

```text
packageId
partNumber
totalParts
```

Если один payload превышает лимит, его можно фрагментировать между несколькими parts.

Размер считается по фактическому размеру выходного `.md`.

Не превышать заданный лимит молча.

---

## 13. Import

Пользователь выбирает `.md` package и target repository.

RepoSync автоматически находит остальные части package.

До любых изменений выполнить полный preflight:

```text
все parts присутствуют
packageId совпадает
checksums корректны
protocol поддерживается
source/baseline совместим
ADD не перезаписывает неожиданный файл
MODIFY/DELETE имеют ожидаемый beforeSha256
patch применим
пути не выходят за пределы repository
нет path traversal / symlink escape
```

После анализа показать preview:

```text
Modified   14
Added       4
Deleted     2
Renamed     1

✓ Integrity
✓ Baseline
✓ Patches
```

Только после этого разрешить:

```text
[Применить]
```

Перед изменениями сохранить backup затрагиваемых файлов.

Flow:

```text
preflight
→ backup
→ apply
→ verify hashes
→ success
```

При ошибке:

```text
rollback from backup
```

После успешного Import сохранить `targetState` как новую synchronized state.

---

## 14. Основные сценарии

### Internal → Global: первый перенос

```text
Local corporate repository
→ Full Snapshot
→ exclusions
→ Security Scan
→ .md
→ ручной перенос
→ Global
```

### Internal → Global: последующие изменения

```text
lastSyncedCommit
→ current commit
→ Diff
→ Security Scan
→ .md
→ ручной перенос
```

### Global → Internal из GitHub

```text
Remote Git URL
→ branch
→ known corporate state
→ current remote state
→ Compare
→ Diff
→ Security Scan
→ .md
→ ручной перенос
→ Internal
→ Import
```

### Global: получение корпоративного package

```text
corp-update.md
→ Analyse
→ Preview
→ Apply к выбранному локальному repository
```

---

## 15. UI

Минимальные разделы:

```text
Profiles
Import
Settings
```

В профиле показывать состояние и доступные действия.

### Internal

```text
RepoSync                         🏢 Internal

Core App
D:\Projects\core-app
master

Last sync     abc123
Current       def456

18 changes

[Compare]
[Create package]
```

### Global

```text
RepoSync                         🌐 Global

Core App
github.com/user/core-app
master

Corporate state   abc123
Remote HEAD       ff921ac

24 changes

[Compare]
[Create package for Internal]
```

Перед Export всегда показывать:

```text
included files / changes
excluded files
estimated transport size
number of parts
Security Scan result
```

---

## 16. Локальные настройки

Сохранять локально:

```text
environment mode
profiles
last used repositories
remote URLs
branches
last synchronized states
custom exclusions
max part size
output directory
```

Не сохранять:

```text
найденные secrets
полные значения ФИО/email/token
source file contents
Git passwords/PAT
```

---

## 17. Не делать в v1

Не реализовывать:

```text
AST
dependency tree
tree shaking
symbol extraction
AST merge
автоматический merge конфликтов
прямую network sync между Internal и Global
automatic Git push
Git server
cloud services
telemetry
auto updater
собственный whitespace codec
```

---

## 18. Готовность v1

Версия считается функционально готовой, когда:

- приложение запускается и собирается локально из исходников;
- работает выбор `Internal / Global`;
- можно создать профиль;
- работает Local Git source;
- в Global работает Remote Git source;
- `.gitignore` автоматически участвует в exclusions;
- работает Full Snapshot;
- работает Diff с `MODIFY / ADD / DELETE / RENAME`;
- package можно разбить по максимальному размеру;
- Snapshot восстанавливает bytes без изменений;
- Import выполняет preflight и integrity checks;
- работает Security Scan и actions по findings;
- есть preview Export/Import;
- актуальны README, SDD, ADR и specs.

Автоматические тесты не входят в scope текущей реализации.
