import type { Analysis, CodeComparison, Direction, Finding, ImportPreview, Profile, Settings } from '../../shared/types';
import { Icon } from '../Appearance';
import { Comparison } from '../Comparison';
import { SecurityReview } from './SecurityReview';
import { Button, EmptyState, Muted, Row, Status, StepIndicator, Surface } from '../ui/components';
export type SyncStep = 'compare' | 'security' | 'package' | 'apply' | 'done';
interface Props {
  profile: Profile; settings: Settings; direction: Direction; step: SyncStep;
  analysis: Analysis | null; importPreview: ImportPreview | null; comparison: CodeComparison | null;
  kept: string[]; override: boolean; exported: string[]; busy: boolean; locked: boolean;
  pending: React.MutableRefObject<Promise<void> | null>; setPreviewBusy: (busy: boolean) => void;
  setStep: (step: SyncStep) => void; setOverride: (override: boolean) => void;
  close: () => void; keep: (id: string) => void; exclude: (finding: Finding) => void;
  replace: (finding: Finding) => void; showFinding: (finding: Finding) => void;
  completeReview: () => void; chooseOutput: () => void; exportPackage: () => void;
  apply: () => void; openRepository: () => void;
}
export function SyncWorkflow({ profile, settings, direction, step, analysis, importPreview, comparison, kept, override, exported, busy, locked, pending, setPreviewBusy, setStep, setOverride, close, keep, exclude, replace, showFinding, completeReview, chooseOutput, exportPackage, apply, openRepository }: Props): React.JSX.Element {
  const working = analysis?.workingChanges ?? importPreview?.workingChanges;
  const undecided = analysis?.findings.filter(finding => !kept.includes(finding.id)).length ?? 0;
  return <>
        <Row style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>{direction === 'outgoing' ? 'Подготовка пакета изменений' : 'Входящие изменения'}</h2><Button disabled={locked} onClick={close}>{step === 'done' ? 'К репозиторию' : 'Закрыть'}</Button></Row>
        <StepIndicator steps={direction === 'outgoing' ? ['Сравнение', 'Проверка данных', 'Пакет', 'Готово'] : profile.role === 'external' ? ['Пакет', 'Просмотр', 'Применение', 'Готово'] : ['Сравнение', 'Проверка данных', 'Применение', 'Готово']} current={step === 'compare' ? 0 : step === 'security' ? 1 : step === 'done' ? 3 : 2} />
        {analysis && <>{analysis.packageType === 'snapshot' && <Status>Первичная синхронизация: будут учтены все файлы выбранной ветки, сохранённые в коммите, кроме исключённых.</Status>}</>}
        {working && working.staged + working.unstaged + working.untracked > 0 && <Status>Изменения без коммита не участвуют в синхронизации. В индексе — {working.staged}, вне индекса — {working.unstaged}, новых файлов — {working.untracked}.</Status>}
        {(step === 'compare' || step === 'apply') && comparison && <Comparison comparison={comparison} busy={busy} onBusy={setPreviewBusy} request={pending} />}
        {step === 'compare' && <Row style={{ justifyContent: 'flex-end', marginTop: 20 }}><Button $primary disabled={locked || !analysis?.entries.length} onClick={() => setStep('security')}>Проверить данные <Icon name="arrow" /></Button>{analysis?.entries.length === 0 && <small>Новых изменений нет.</small>}</Row>}
        {step === 'security' && analysis && <><SecurityReview analysis={analysis} kept={kept} keep={id => keep(id)} exclude={exclude} replace={replace} open={showFinding} busy={locked} />{direction === 'outgoing' && analysis.findings.some(finding => finding.severity === 'block') && <label style={{ display: 'flex', alignItems: 'center', margin: '16px 0', gap: 10 }}><input type="checkbox" disabled={locked} checked={override} onChange={e => setOverride(e.target.checked)} />Разрешаю включить в пакет оставшиеся возможные пароли, токены и ключи.</label>}<Row style={{ justifyContent: 'space-between', marginTop: 20 }}><Button disabled={locked} onClick={() => setStep('compare')}>К сравнению</Button><Row>{undecided > 0 && <small>Осталось проверить: {undecided}</small>}<Button $primary disabled={locked || undecided > 0 || (direction === 'outgoing' && analysis.findings.some(finding => finding.severity === 'block') && !override)} onClick={completeReview}>{direction === 'outgoing' ? 'Перейти к пакету' : 'Проверить применение'}</Button></Row></Row></>}
        {step === 'package' && analysis && <Surface><h2>Создание пакета</h2><Muted>Файлов: {analysis.entries.length} · Частей .md: {analysis.parts} · {(analysis.estimatedBytes / 1024).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} КБ · {profile.transportMode === 'compact' ? 'Компактный' : 'Читаемый'}</Muted><p><code>{settings.outputDirectory || 'Папка для пакетов не выбрана'}</code></p><Row><Button disabled={locked} onClick={chooseOutput}>Выбрать папку</Button><Button $primary disabled={locked || !settings.outputDirectory} onClick={exportPackage}>Создать пакет</Button></Row><small style={{ display: 'block', marginTop: 20 }}>Все части нужно передать вместе, сохранив имена. Состояние синхронизации обновится после подтверждения применения пакета.</small></Surface>}
        {step === 'apply' && importPreview && <><Status>Проверка пройдена. RepoSync создаст резервную копию и повторно проверит файлы перед применением показанных изменений.</Status><Row style={{ justifyContent: 'flex-end' }}><Button $primary disabled={locked} onClick={apply}>Применить изменения</Button></Row></>}
        {step === 'done' && <EmptyState title={exported.length ? 'Пакет создан' : 'Изменения применены'}><Muted>{exported.length ? 'Передайте все части .md на внешний компьютер. После успешного применения пакета вернитесь сюда и подтвердите применение.' : 'Изменения записаны в локальные файлы. Проверьте результат и создайте коммит своими Git-инструментами. Отправку в Git выполните самостоятельно.'}</Muted>{exported.map(file => <p key={file}><code>{file}</code></p>)}<Button disabled={locked} onClick={openRepository}><Icon name="folder" />Открыть папку</Button></EmptyState>}
  </>;
}
