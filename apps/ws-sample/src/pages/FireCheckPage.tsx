// astryx 「dashboard」 페이지 템플릿에서 시작: Layout > LayoutContent(6) > VStack(6) > Grid 틀을 유지하고 내용만 바꿈
import {useState, useSyncExternalStore} from 'react';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {Divider} from '@astryxdesign/core/Divider';
import {Field} from '@astryxdesign/core/Field';
import {Grid} from '@astryxdesign/core/Grid';
import {HStack, Layout, LayoutContent, VStack} from '@astryxdesign/core/Layout';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Selector} from '@astryxdesign/core/Selector';
import {Table, proportional, useTableSelection, useTableSelectionState} from '@astryxdesign/core/Table';
import type {TableColumn} from '@astryxdesign/core/Table';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TopNav, TopNavHeading, TopNavItem} from '@astryxdesign/core/TopNav';
import {Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, XAxis, YAxis} from 'recharts';
import {PALETTE, paletteName} from '../design/palette';
import type {PaletteId} from '../design/palette';

const tokenPx = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

type Result = '정상' | '불량' | '미점검';
interface Row extends Record<string, unknown> {
  id: string;
  floor: string;
  place: string;
  color: PaletteId;
  result: Result;
  who: string;
}

// 예시 자료
const FLOORS = ['B1', '1F', '2F', '3F', '4F', '5F', '6F'];
const START = {정상: 142, 불량: 6, 미점검: 38};
const START_FLOORS: Record<string, number> = {B1: 34, '1F': 28, '2F': 24, '3F': 22, '4F': 20, '5F': 12, '6F': 8};
const START_ROWS: Row[] = [
  {id: 'FE-B1-012', floor: 'B1', place: '기계실 앞 복도', color: 'red', result: '불량', who: '김시설'},
  {id: 'FE-1F-004', floor: '1F', place: '중앙 에스컬레이터 옆', color: 'blue', result: '정상', who: '이안전'},
  {id: 'FE-2F-009', floor: '2F', place: '동측 비상계단 앞', color: 'blue', result: '정상', who: '이안전'},
  {id: 'FE-3F-002', floor: '3F', place: '서측 화장실 앞', color: 'green', result: '미점검', who: '배정 전'},
  {id: 'FE-5F-006', floor: '5F', place: '식당가 입구', color: 'orange', result: '정상', who: '박전기'},
];

const BADGE = {불량: 'info', 정상: 'neutral', 미점검: 'warning'} as const;

const columns: TableColumn<Row>[] = [
  {
    key: 'id',
    header: '소화기 번호',
    width: proportional(2),
    renderCell: row => (
      <VStack gap={0}>
        <Text>{row.id}</Text>
        <Text type="supporting" data-narrow-only="">{row.floor} · {row.place}</Text>
      </VStack>
    ),
  },
  {key: 'floor', header: '층', width: proportional(1)},
  {key: 'place', header: '위치', width: proportional(3)},
  {
    key: 'color',
    header: '구역 색',
    width: proportional(1.5),
    renderCell: row => (
      <HStack gap={2} vAlign="center">
        <span className="palette-mark" data-palette={row.color} aria-hidden="true" />
        <Text>{paletteName(row.color)}</Text>
      </HStack>
    ),
  },
  {
    key: 'result',
    header: '결과',
    width: proportional(1.5),
    renderCell: row => <Badge label={row.result} variant={BADGE[row.result]} />,
  },
  {key: 'who', header: '점검자', width: proportional(1.5)},
];

// 좁은 화면(휴대폰)에서는 표 칸을 줄임
function useNarrow() {
  const query = `(max-width: ${tokenPx('--col-min') * 2}px)`;
  return useSyncExternalStore(
    notify => {
      const media = matchMedia(query);
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => matchMedia(query).matches,
  );
}

function Stat({label, value}: {label: string; value: number}) {
  return (
    <VStack gap={1}>
      <Text type="supporting">{label}</Text>
      <Text type="display-1" color="accent" weight="semibold">{value}대</Text>
    </VStack>
  );
}

function PaletteField({value, onChange}: {value: PaletteId; onChange: (id: PaletteId) => void}) {
  return (
    <Field label="구역 표시 색" inputID="palette" labelID="palette-label" isGroupLabel description={`고른 색: ${paletteName(value)}`}>
      <HStack gap={3} wrap="wrap" role="radiogroup" aria-labelledby="palette-label">
        {PALETTE.map(p => (
          <button
            key={p.id}
            type="button"
            role="radio"
            className="palette-swatch"
            data-palette={p.id}
            aria-checked={value === p.id}
            aria-label={p.name}
            onClick={() => onChange(p.id)}
          />
        ))}
      </HStack>
    </Field>
  );
}

export default function FireCheckPage() {
  const [rows, setRows] = useState(START_ROWS);
  const [counts, setCounts] = useState(START);
  const [floors, setFloors] = useState(START_FLOORS);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set(['FE-1F-004']));
  const [no, setNo] = useState('');
  const [floor, setFloor] = useState('B1');
  const [result, setResult] = useState<'정상' | '불량'>('정상');
  const [color, setColor] = useState<PaletteId>('blue');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const {selectionConfig} = useTableSelectionState<Row>({data: rows, idKey: 'id', selectedKeys, setSelectedKeys});
  const selection = useTableSelection<Row>(selectionConfig);
  const chart = FLOORS.map(f => ({floor: f, count: floors[f]}));
  const narrow = useNarrow();
  const shown = narrow ? columns.filter(c => ['id', 'color', 'result'].includes(String(c.key))) : columns;
  const statMin = tokenPx('--stat-min');
  const tick = {fill: 'var(--text-sub)', fontSize: tokenPx('--size-s')};

  const reset = () => {
    setNo('');
    setError('');
    setSaved('');
  };
  const save = () => {
    const id = no.trim();
    setSaved('');
    if (!id) return setError('소화기 번호를 입력해 주세요.');
    if (rows.some(r => r.id === id)) return setError('이미 목록에 있는 번호입니다.');
    setRows([{id, floor, place: '새로 입력한 위치', color, result, who: '나'}, ...rows]);
    setCounts({...counts, [result]: counts[result] + 1, 미점검: Math.max(0, counts.미점검 - 1)});
    setFloors({...floors, [floor]: floors[floor] + 1});
    setNo('');
    setError('');
    setSaved(`${id} 점검 결과를 저장했습니다.`);
  };

  return (
    <AppShell
      height="auto"
      variant="section"
      mobileNav={false}
      topNav={
        <TopNav
          label="업무지원 메뉴"
          heading={<TopNavHeading heading="업무지원" />}
          startContent={
            <>
              <TopNavItem label="서류작업" href="#docs" />
              <TopNavItem label="점검" href="#inspect" isSelected />
              <TopNavItem label="시방서" href="#spec" />
              <TopNavItem label="지도" href="#map" />
            </>
          }
        />
      }>
      <Layout
        content={
          <LayoutContent padding={6}>
            <VStack gap={6}>
              <VStack gap={1}>
                <Heading level={1}>소화기 점검</Heading>
                <Text type="supporting">잠실점 에비뉴엘 · 11월 점검 · 예시 자료입니다</Text>
              </VStack>
              <Divider />

              <Grid columns={{minWidth: statMin, repeat: 'fit'}} gap={6}>
                <Stat label="전체" value={counts.정상 + counts.불량 + counts.미점검} />
                <Stat label="정상" value={counts.정상} />
                <Stat label="불량" value={counts.불량} />
                <Stat label="미점검" value={counts.미점검} />
              </Grid>
              <Divider />

              <Grid columns={{minWidth: tokenPx('--col-min'), repeat: 'fit'}} gap={8}>
                <VStack gap={4}>
                  <Heading level={2}>층별 점검 대수</Heading>
                  <ResponsiveContainer width="100%" height={tokenPx('--chart-h')}>
                    <BarChart data={chart} margin={{top: tokenPx('--sp-6'), right: 0, bottom: 0, left: 0}}>
                      <CartesianGrid vertical={false} stroke="var(--line)" />
                      <XAxis dataKey="floor" axisLine={{stroke: 'var(--line)'}} tickLine={false} tick={tick} />
                      <YAxis width={tokenPx('--sp-8')} axisLine={false} tickLine={false} tick={tick} />
                      <Bar dataKey="count" name="점검 대수" fill="var(--navy)" maxBarSize={tokenPx('--sp-12')} radius={[tokenPx('--radius'), tokenPx('--radius'), 0, 0]} isAnimationActive={false}>
                        <LabelList dataKey="count" position="top" fill="var(--navy)" fontSize={tokenPx('--size-s')} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </VStack>

                <VStack gap={4}>
                  <Heading level={2}>점검 결과 입력</Heading>
                  <TextInput
                    label="소화기 번호"
                    placeholder="예: FE-2F-010"
                    value={no}
                    onChange={v => {
                      setNo(v);
                      setError('');
                    }}
                    status={error ? {type: 'error', message: error} : undefined}
                    statusVariant="detached"
                  />
                  <Grid columns={{minWidth: statMin, repeat: 'fit'}} gap={4}>
                    <Selector label="층" value={floor} onChange={v => setFloor(v ?? 'B1')} options={FLOORS} />
                    <Field label="결과" inputID="result" isGroupLabel>
                      <SegmentedControl label="결과" layout="fill" value={result} onChange={v => setResult(v as '정상' | '불량')}>
                        <SegmentedControlItem value="정상" label="정상" />
                        <SegmentedControlItem value="불량" label="불량" />
                      </SegmentedControl>
                    </Field>
                  </Grid>
                  <PaletteField value={color} onChange={setColor} />
                  <HStack gap={3} vAlign="center" wrap="wrap">
                    <Button label="저장" variant="primary" onClick={save} />
                    <Button label="지우기" variant="secondary" onClick={reset} />
                    <Text type="supporting" role="status">{saved}</Text>
                  </HStack>
                </VStack>
              </Grid>
              <Divider />

              <VStack gap={4}>
                <Heading level={2}>점검 목록</Heading>
                <Table data={rows} columns={shown} idKey="id" dividers="rows" plugins={{selection}} />
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
    </AppShell>
  );
}
