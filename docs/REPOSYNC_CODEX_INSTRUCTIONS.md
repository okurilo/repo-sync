# RepoSync — инструкция для Codex

Реализуй RepoSync строго по приложенному ТЗ. Не расширяй scope самостоятельно и не добавляй функции, явно вынесенные за пределы v1.

## Стек

- Electron
- React 18
- TypeScript
- Vite
- styled-components

Styled-components писать через object syntax:

```ts
const Container = styled('div')({
  display: 'flex',
  flexDirection: 'column',
});
```

## Архитектурные правила

- `nodeIntegration: false`
- `contextIsolation: true`
- Renderer не получает прямой доступ к Node.js, Git, File System или shell.
- Системные операции выполняются в Electron Main и доступны renderer только через типизированный `preload` API.
- Никакой telemetry, облачных API и внешней аналитики.
- В режиме `Internal` не выполнять попыток доступа к внешним Git-серверам.
- В режиме `Global` сеть используется только для Remote Git, явно указанного пользователем.
- Git credentials самостоятельно не хранить; использовать системный Git / SSH / SSH Agent / Git Credential Manager.

## Документация

Разработка должна сопровождаться живой документацией в репозитории:

```text
docs/
├── SDD.md
├── ADR/
│   ├── README.md
│   └── 0001-....md
└── specs/
    ├── transport-format.md
    ├── synchronization.md
    ├── git-sources.md
    └── security-scan.md
```

Правило:

- `SDD.md` — текущее устройство системы и основные потоки.
- `ADR` — только существенные архитектурные решения и причины их принятия.
- `specs` — фактические контракты механизмов и форматов.

Если реализация меняется, документация должна обновляться вместе с кодом.

Если обнаружено противоречие в ТЗ:
1. выбрать минимальное технически корректное решение;
2. зафиксировать его в ADR/spec;
3. не менять пользовательский сценарий молча.

Если изменение существенно влияет на смысл продукта — остановиться и вынести вопрос пользователю.

## Тесты

Автоматические тесты в текущей итерации **не писать**.

Не подключать специально Jest/Vitest/Playwright и не создавать тестовую инфраструктуру.

После крупных этапов выполнять:
- TypeScript typecheck;
- lint, если уже настроен;
- Vite build;
- Electron build;
- минимальную ручную проверку основного сценария.

## Приоритет реализации

1. Electron + React/Vite + preload.
2. Выбор `Internal / Global`.
3. Local Git source + exclusions.
4. Snapshot export/import.
5. Diff export/import.
6. Remote Git source для Global.
7. Security Scan.
8. Chunking, preview, ошибки и UI polish.

Не пытайся реализовать весь продукт одним большим изменением.

## Не делать в v1

Не реализовывать без отдельного требования:

- AST;
- dependency tree;
- tree shaking;
- symbol extraction;
- автоматический merge конфликтов;
- прямую сеть между Internal и Global;
- автоматический Git push;
- Git server;
- cloud services;
- telemetry;
- auto updater;
- собственный whitespace codec;
- полноценную систему автоматических тестов.

## README

Добавь `README.md` с:

```bash
npm install
npm run dev
```

и командами production build из исходников для Windows/macOS.

Главный критерий: после реализации код, SDD, ADR и specs должны описывать одну и ту же фактически работающую систему.
