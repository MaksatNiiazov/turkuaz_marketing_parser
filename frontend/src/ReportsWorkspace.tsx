import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@turkuaz/ui';
import { fetchDataQuality, fetchRunComparison } from './lib/api';
import type {
  ComparisonItem,
  DataQualityReport,
  ParserCategory,
  ParserRun,
  ReportSection,
  RunComparisonReport,
} from './lib/types';

type Props = {
  section: ReportSection | 'quality';
  sourceId: number | null;
  categories: ParserCategory[];
  runs: ParserRun[];
};

const sectionMeta: Record<ReportSection, { title: string; description: string; events: string[] }> = {
  overview: {
    title: 'Обзор изменений',
    description: 'Главные изменения между двумя завершенными запусками.',
    events: [],
  },
  assortment: {
    title: 'Изменения ассортимента',
    description: 'Новые и исчезнувшие товары с учетом успешно обработанных категорий.',
    events: ['new_product', 'disappeared_product'],
  },
  prices: {
    title: 'Изменения цен',
    description: 'Сравнение базовых и эффективных цен сопоставимых товаров.',
    events: ['price_increased', 'price_decreased'],
  },
  promotions: {
    title: 'Промо и скидки',
    description: 'Начавшиеся и завершившиеся акции между выбранными запусками.',
    events: ['promotion_started', 'promotion_ended'],
  },
  availability: {
    title: 'Изменения наличия',
    description: 'Возвраты и подтвержденные переходы товаров в отсутствие.',
    events: ['became_available', 'became_unavailable'],
  },
};

export function ReportsWorkspace({ section, sourceId, categories, runs }: Props) {
  if (section === 'quality') {
    return <QualityView sourceId={sourceId} />;
  }
  return <ComparisonView section={section} sourceId={sourceId} categories={categories} runs={runs} />;
}

function ComparisonView({ section, sourceId, categories, runs }: Omit<Props, 'section'> & { section: ReportSection }) {
  const finishedRuns = useMemo(
    () => runs.filter((run) => run.status === 'success' || run.status === 'partial'),
    [runs],
  );
  const [baseRunId, setBaseRunId] = useState<number | null>(null);
  const [compareRunId, setCompareRunId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [report, setReport] = useState<RunComparisonReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = sectionMeta[section];

  useEffect(() => {
    setCompareRunId((value) => value && finishedRuns.some((run) => run.id === value) ? value : finishedRuns[0]?.id ?? null);
    setBaseRunId((value) => value && finishedRuns.some((run) => run.id === value) ? value : finishedRuns[1]?.id ?? null);
  }, [finishedRuns]);

  useEffect(() => {
    if (!sourceId || !baseRunId || !compareRunId || baseRunId === compareRunId) {
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    void fetchRunComparison({
      source_id: sourceId,
      base_run_id: baseRunId,
      compare_run_id: compareRunId,
      category_id: categoryId ?? undefined,
      limit: 500,
    })
      .then(setReport)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [sourceId, baseRunId, compareRunId, categoryId]);

  const items = report?.items.filter(
    (item) => !meta.events.length || item.event_types.some((event) => meta.events.includes(event)),
  ) ?? [];

  return (
    <section className="report-workspace">
      <div className="panel report-workspace-head">
        <div>
          <h2>{meta.title}</h2>
          <p>{meta.description}</p>
        </div>
        <div className="comparison-filters">
          <RunSelect label="Базовый запуск" value={baseRunId} runs={finishedRuns} onChange={setBaseRunId} />
          <RunSelect label="Сравниваемый" value={compareRunId} runs={finishedRuns} onChange={setCompareRunId} />
          <label>
            <span>Категория</span>
            <select value={categoryId ?? ''} onChange={(event) => setCategoryId(event.target.value ? Number(event.target.value) : null)}>
              <option value="">Все категории</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      {finishedRuns.length < 2 ? <Empty text="Для аналитики нужны минимум два завершенных запуска." /> : null}
      {baseRunId === compareRunId && baseRunId ? <div className="notice">Выберите два разных запуска.</div> : null}
      {error ? <div className="notice">{error}</div> : null}
      {loading ? <div className="panel analytics-loading">Сравниваем запуски…</div> : null}
      {report ? <SummaryCards report={report} section={section} /> : null}
      {report && section === 'overview' ? <OverviewSignals report={report} /> : null}
      {report && section !== 'overview' ? <EventsTable items={items} section={section} /> : null}
    </section>
  );
}

function SummaryCards({ report, section }: { report: RunComparisonReport; section: ReportSection }) {
  const summary = report.summary;
  const cards = section === 'overview'
    ? [
        ['Ассортимент', summary.current_products, `${signed(summary.current_products - summary.base_products)} товаров`],
        ['Новые', summary.new_products, 'появились в новом запуске'],
        ['Исчезли', summary.disappeared_products, 'только в обработанных категориях'],
        ['Изменили цену', summary.price_increased + summary.price_decreased, `среднее ${percent(summary.average_price_change_percent)}`],
        ['Новые акции', summary.promotions_started, `${summary.promotions_ended} завершились`],
        ['Нет в наличии', summary.unavailable_products, `${summary.unknown_availability} неизвестно`],
      ]
    : section === 'assortment'
      ? [['Было', summary.base_products, 'товаров'], ['Стало', summary.current_products, 'товаров'], ['Новые', summary.new_products, 'товаров'], ['Исчезли', summary.disappeared_products, 'товаров']]
      : section === 'prices'
        ? [['Подорожали', summary.price_increased, 'товаров'], ['Подешевели', summary.price_decreased, 'товаров'], ['Без изменений', summary.price_unchanged, 'товаров'], ['Среднее изменение', percent(summary.average_price_change_percent), 'по сопоставимым товарам']]
        : section === 'promotions'
          ? [['Начались', summary.promotions_started, 'акций'], ['Завершились', summary.promotions_ended, 'акций'], ['Товаров сейчас', summary.current_products, 'в сравнении']]
          : [['В наличии', summary.available_products, 'товаров'], ['Нет в наличии', summary.unavailable_products, 'товаров'], ['Вернулись', summary.became_available, 'товаров'], ['Пропали', summary.became_unavailable, 'товаров'], ['Неизвестно', summary.unknown_availability, 'товаров']];
  return (
    <div className="analytics-kpis">
      {cards.map(([label, value, hint]) => <div className="panel analytics-kpi" key={String(label)}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}
    </div>
  );
}

function OverviewSignals({ report }: { report: RunComparisonReport }) {
  const rows = [
    ['Рост цены', report.summary.price_increased, 'price_increased'],
    ['Снижение цены', report.summary.price_decreased, 'price_decreased'],
    ['Начало акции', report.summary.promotions_started, 'promotion_started'],
    ['Завершение акции', report.summary.promotions_ended, 'promotion_ended'],
    ['Пропали из наличия', report.summary.became_unavailable, 'became_unavailable'],
  ];
  const maximum = Math.max(1, ...rows.map((row) => Number(row[1])));
  return <div className="panel analytics-signals"><div className="panel-header"><div><h2>Сигналы последнего сравнения</h2><p>Количество событий по типам.</p></div></div>{rows.map(([label, value, code]) => <div className="analytics-signal" key={String(code)}><span>{label}</span><div><i style={{ width: `${Number(value) * 100 / maximum}%` }} /></div><strong>{value}</strong></div>)}</div>;
}

function EventsTable({ items, section }: { items: ComparisonItem[]; section: ReportSection }) {
  return (
    <div className="panel analytics-table-panel">
      <div className="panel-header"><div><h2>Детализация</h2><p>{items.length} событий в загруженном сравнении</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Товар</th><th>Категория</th><th>Событие</th>{section === 'prices' ? <><th>Было</th><th>Стало</th><th>Изменение</th></> : null}{section === 'promotions' ? <><th>Скидка была</th><th>Скидка стала</th></> : null}{section === 'availability' ? <><th>Было</th><th>Стало</th></> : null}</tr></thead><tbody>
        {items.map((item) => <tr key={`${item.product_id}-${item.event_types.join('-')}`}><td><strong>{item.name}</strong><small>{item.sku || 'Без SKU'}</small></td><td>{item.category_name || 'Без категории'}</td><td>{item.event_types.map(eventLabel).join(', ')}</td>{section === 'prices' ? <><td>{money(item.old_price)}</td><td>{money(item.new_price)}</td><td className={Number(item.price_change_percent) > 0 ? 'value-up' : 'value-down'}>{percent(item.price_change_percent)}</td></> : null}{section === 'promotions' ? <><td>{percent(item.old_discount_percent)}</td><td>{percent(item.new_discount_percent)}</td></> : null}{section === 'availability' ? <><td>{availability(item.old_availability)}</td><td>{availability(item.new_availability)}</td></> : null}</tr>)}
      </tbody></table></div>
      {!items.length ? <Empty text="Событий выбранного типа нет." /> : null}
    </div>
  );
}

function QualityView({ sourceId }: { sourceId: number | null }) {
  const [report, setReport] = useState<DataQualityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!sourceId) return;
    void fetchDataQuality(sourceId).then(setReport).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [sourceId]);
  return <section className="report-workspace"><div className="panel report-workspace-head"><div><h2>Контроль данных</h2><p>Ошибки сбора, полнота карточек и свежесть категорий.</p></div></div>{error ? <div className="notice">{error}</div> : null}<div className="quality-grid">{report?.issues.map((issue) => <div className={`panel quality-card ${issue.severity}`} key={issue.code}><Icon name={issue.severity === 'ok' ? 'shield' : 'activity'} size={20} /><span>{issue.label}</span><strong>{issue.count}</strong><small>{issue.severity === 'ok' ? 'Проблем не найдено' : severityLabel(issue.severity)}</small></div>)}</div>{!report && !error ? <div className="panel analytics-loading">Проверяем данные…</div> : null}</section>;
}

function RunSelect({ label, value, runs, onChange }: { label: string; value: number | null; runs: ParserRun[]; onChange: (value: number) => void }) {
  return <label><span>{label}</span><select value={value ?? ''} onChange={(event) => onChange(Number(event.target.value))}>{runs.map((run) => <option key={run.id} value={run.id}>#{run.id} · {date(run.finished_at || run.created_at)}</option>)}</select></label>;
}

function Empty({ text }: { text: string }) { return <div className="panel analytics-empty">{text}</div>; }
function signed(value: number) { return value > 0 ? `+${value}` : String(value); }
function money(value: string | number | null) { return value === null ? '—' : `${Number(value).toLocaleString('ru-RU')} сом`; }
function percent(value: string | number | null) { return value === null ? '—' : `${Number(value).toLocaleString('ru-RU')}%`; }
function date(value: string | null) { return value ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'; }
function availability(value: boolean | null) { return value === true ? 'В наличии' : value === false ? 'Нет в наличии' : 'Неизвестно'; }
function severityLabel(value: string) { return value === 'critical' ? 'Требует внимания' : value === 'warning' ? 'Проверьте данные' : 'Информация'; }
function eventLabel(value: string) { return ({ new_product: 'Новый товар', disappeared_product: 'Исчез', price_increased: 'Цена выросла', price_decreased: 'Цена снизилась', promotion_started: 'Акция началась', promotion_ended: 'Акция завершилась', became_available: 'Вернулся в наличие', became_unavailable: 'Пропал из наличия' } as Record<string, string>)[value] || value; }
