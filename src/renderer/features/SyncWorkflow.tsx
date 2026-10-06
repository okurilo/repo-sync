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
  error: string; retryComparison: () => void;
  pending: React.MutableRefObject<Promise<void> | null>; setPreviewBusy: (busy: boolean) => void;
  setStep: (step: SyncStep) => void; setOverride: (override: boolean) => void;
  close: () => void; keep: (ids: string[], retained: boolean) => void; exclude: (finding: Finding) => void;
  replace: (finding: Finding) => void; showFinding: (finding: Finding) => void;
  completeReview: () => void; chooseOutput: () => void; exportPackage: () => void;
  apply: () => void; openRepository: () => void;
}
export function SyncWorkflow({ profile, settings, direction, step, analysis, importPreview, comparison, kept, override, exported, busy, locked, error, retryComparison, pending, setPreviewBusy, setStep, setOverride, close, keep, exclude, replace, showFinding, completeReview, chooseOutput, exportPackage, apply, openRepository }: Props): React.JSX.Element {
  const working = analysis?.workingChanges ?? importPreview?.workingChanges;
  const steps = direction === 'outgoing' ? ['Сравнение', 'Проверка данных', 'Пакет', 'Готово'] : profile.role === 'external' ? ['Пакет', 'Просмотр', 'Применение', 'Готово'] : ['Изменения', 'Применение', 'Готово'];
  const current = step === 'done' ? steps.length - 1 : direction === 'outgoing' ? step === 'compare' ? 0 : step === 'security' ? 1 : 2 : step === 'compare' ? 0 : profile.role === 'external' && busy ? 2 : 1;
  const undecided = analysis?.findings.filter(finding => !kept.includes(finding.id)).length ?? 0;
  return <>
        <Row style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>{direction === 'outgoing' ? 'Подготовка пакета изменений' : 'Входящие изменения'}</h2><Button disabled={locked} onClick={close}>{step === 'done' ? 'К репозиторию' : 'Закрыть'}</Button></Row>
        <StepIndicator steps={steps} current={current} />
        {analysis && direction === 'incoming' && !profile.baseline && <Status>Первое сравнение: локальная ветка → внешняя ветка. Совпадающие файлы не показаны. Файлы, которые есть только в локальной ветке, отмечены для удаления — проверьте их перед применением.</Status>}
        {analysis?.packageType === 'snapshot' && direction === 'outgoing' && <Status>Первый пакет содержит полное состояние выбранной ветки, кроме исключённых файлов.</Status>}
        {working && working.staged + working.unstaged + working.untracked > 0 && <Status>Изменения без коммита не участвуют в синхронизации. В индексе — {working.staged}, вне индекса — {working.unstaged}, новых файлов — {working.untracked}.</Status>}
        {(step === 'compare' || step === 'apply') && comparison && <Comparison comparison={comparison} busy={busy} onBusy={setPreviewBusy} request={pending} />}
        {error && <Status $error role="alert">{error}{direction === 'incoming' && (step === 'compare' || step === 'apply') && <p><Button disabled={locked} onClick={retryComparison}>{profile.role === 'external' ? 'Выбрать пакет заново' : 'Обновить сравнение'}</Button></p>}</Status>}
        {busy && direction === 'incoming' && step === 'compare' && <Status role="status">Проверка применения… Дождитесь результата.</Status>}
        {step === 'compare' && <Row style={{ justifyContent: 'flex-end', marginTop: 20 }}><Button $primary disabled={locked || (direction === 'incoming' && !!error) || !analysis || (!analysis.entries.length && (direction === 'outgoing' || !!profile.baseline))} onClick={() => direction === 'incoming' ? completeReview() : setStep('security')}>{direction === 'incoming' ? analysis?.entries.length ? 'Проверить применение' : 'Сохранить точку синхронизации' : 'Проверить данные'} <Icon name="arrow" /></Button>{analysis?.entries.length === 0 && <small>Новых изменений нет.</small>}</Row>}
        {direction === 'outgoing' && step === 'security' && analysis && <><SecurityReview analysis={analysis} kept={kept} keep={keep} exclude={exclude} replace={replace} open={showFinding} busy={locked} />{direction === 'outgoing' && analysis.findings.some(finding => finding.severity === 'block') && <label style={{ display: 'flex', alignItems: 'center', margin: '16px 0', gap: 10 }}><input type="checkbox" disabled={locked} checked={override} onChange={e => setOverride(e.target.checked)} />Разрешаю включить в пакет оставшиеся возможные пароли, токены и ключи.</label>}<Row style={{ justifyContent: 'space-between', marginTop: 20 }}><Button disabled={locked} onClick={() => setStep('compare')}>К сравнению</Button><Row>{undecided > 0 && <small>Осталось проверить: {undecided}</small>}<Button $primary disabled={locked || undecided > 0 || (direction === 'outgoing' && analysis.findings.some(finding => finding.severity === 'block') && !override)} onClick={completeReview}>{direction === 'outgoing' ? 'Перейти к пакету' : 'Проверить применение'}</Button></Row></Row></>}
        {step === 'package' && analysis && <Surface><h2>Создание пакета</h2><Muted>Файлов: {analysis.entries.length} · Частей .md: {analysis.parts} · {(analysis.estimatedBytes / 1024).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} КБ · {profile.transportMode === 'compact' ? 'Компактный' : 'Читаемый'}</Muted><p><code>{settings.outputDirectory || 'Папка для пакетов не выбрана'}</code></p><Row><Button disabled={locked} onClick={chooseOutput}>Выбрать папку</Button><Button $primary disabled={locked || !settings.outputDirectory} onClick={exportPackage}>Создать пакет</Button></Row><small style={{ display: 'block', marginTop: 20 }}>Все части нужно передать вместе, сохранив имена. Состояние синхронизации обновится после подтверждения применения пакета.</small></Surface>}
        {step === 'apply' && importPreview && <><Status>Изменения готовы к применению. RepoSync создаст резервную копию и повторно проверит файлы перед применением показанных изменений.</Status><Row style={{ justifyContent: 'flex-end' }}><Button $primary disabled={locked || !!error} onClick={apply}>{importPreview.entries.length ? 'Применить изменения' : 'Сохранить точку синхронизации'}</Button></Row></>}
        {step === 'done' && <EmptyState title={exported.length ? 'Пакет создан' : importPreview?.entries.length === 0 ? 'Синхронизация настроена' : 'Изменения применены'}><Muted>{exported.length ? 'Передайте все части .md на внешний компьютер. После успешного применения пакета вернитесь сюда и подтвердите применение.' : importPreview?.entries.length === 0 ? 'Общее состояние сохранено. Новых внешних изменений нет.' : 'Изменения записаны в локальные файлы. Проверьте результат и создайте коммит своими Git-инструментами. Отправку в Git выполните самостоятельно.'}</Muted>{exported.map(file => <p key={file}><code>{file}</code></p>)}<Button disabled={locked} onClick={openRepository}><Icon name="folder" />Открыть папку</Button></EmptyState>}
  </>;
}
