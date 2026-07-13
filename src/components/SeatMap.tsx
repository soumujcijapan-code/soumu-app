import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import type { Meeting, Participant, Attendance, SeatPlanRule } from '../types';
import { Users2 } from 'lucide-react';

interface Props {
  activeMeeting: Meeting | null;
  activeYear: number;
}

type CellStatus = 'empty' | 'block-locked' | 'lom-reserved' | 'checked-in' | 'member-zone' | 'member-confirmed';

interface SeatCell {
  num: number;
  status: CellStatus;
  label: string;
  participant?: Participant;
}

interface MemberZone {
  lomName: string;
  range: string;
  count: number;
  status: 'block' | 'reserved' | 'confirmed'; // block = ブロック確保（個人非紐付け）、reserved = LOM予約中、confirmed = 受付済み
}

const STATUS_STYLES: Record<CellStatus, { bg: string; text: string; border: string }> = {
  'empty': { bg: '#ffffff', text: '#cbd5e1', border: '1px dashed #cbd5e1' },
  'block-locked': { bg: '#e2e8f0', text: '#475569', border: '1px solid #cbd5e1' },
  'lom-reserved': { bg: '#fef3c7', text: '#92400e', border: '1px solid transparent' },
  'checked-in': { bg: '#d1fae5', text: '#047857', border: '1px solid transparent' },
  'member-zone': { bg: '#dbeafe', text: '#1d4ed8', border: '1px solid transparent' },
  'member-confirmed': { bg: '#1e3a8a', text: '#ffffff', border: '1px solid transparent' },
};

const STATUS_LABELS: Record<CellStatus, string> = {
  'empty': '空席（予約なし・当日飛び入り用）',
  'block-locked': 'ブロック／地区確保（個人未定）',
  'lom-reserved': '個人予約（未受付）',
  'checked-in': '受付済み',
  'member-zone': 'メンバーエリア（予約中）',
  'member-confirmed': 'メンバー席確定（受付済み）',
};

const computeMemberRangeDisplay = (rawRange: string | null, count: number): string => {
  if (!rawRange) return '';
  const startToken = rawRange.split('~')[0].trim();
  const start = parseInt(startToken, 10);
  if (isNaN(start) || !count) return rawRange;
  return `${start} ~ ${start + count - 1}`;
};

// "119 ~ 123" や "119, 120, 124" のような文字列を数値の配列に展開する
const parseComputedRangeToNums = (rangeStr: string): number[] => {
  if (rangeStr.includes(',')) {
    return rangeStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  }
  const parts = rangeStr.split('~').map(s => s.trim());
  const start = parseInt(parts[0], 10);
  if (isNaN(start)) return [];
  const end = parts[1] ? parseInt(parts[1], 10) : start;
  if (isNaN(end) || end < start) return [start];
  const nums: number[] = [];
  for (let i = start; i <= end; i++) nums.push(i);
  return nums;
};

// 座席範囲を数値の配列に展開する（例："119"〜"166" → [119, 120, ..., 166]）
const expandRange = (start: string, end: string | null): number[] => {
  const s = parseInt(start, 10);
  if (isNaN(s)) return [];
  const e = end ? parseInt(end, 10) : s;
  if (isNaN(e) || e < s) return [s];
  const nums: number[] = [];
  for (let i = s; i <= e; i++) nums.push(i);
  return nums;
};

export const SeatMap: React.FC<Props> = ({ activeMeeting, activeYear }) => {
  const [seatCells, setSeatCells] = useState<SeatCell[]>([]);
  const [memberZones, setMemberZones] = useState<MemberZone[]>([]);
  const [selected, setSelected] = useState<SeatCell | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    if (!activeMeeting) return;
    setLoading(true);

    const [{ data: participantsData }, { data: attData }, { data: planData }] = await Promise.all([
      supabase.from('participants').select('*, loms(name, name_kana, sort_priority)').eq('mandate_year', activeYear),
      supabase.from('attendances').select('*').eq('meeting_id', activeMeeting.id),
      supabase.from('seat_plan_rules').select('*').eq('meeting_id', activeMeeting.id),
    ]);

    setLoading(false);

    const participantsMap = new Map((participantsData || []).map((p: any) => [p.id, p]));

    // 1. 座席プラン（CSVの生ルール）から基本状態を構築 — 誰も割り当てられていなくても表示する
    const cellMap = new Map<number, SeatCell>();
    (planData as SeatPlanRule[] || []).forEach(rule => {
      const nums = expandRange(rule.start_seat, rule.end_seat);
      nums.forEach(num => {
        if (rule.role === 'MEMBER') {
          cellMap.set(num, { num, status: 'member-zone', label: rule.target_name || '共有エリア' });
        } else if (rule.target_type === 'NONE') {
          cellMap.set(num, { num, status: 'empty', label: '予約なし（当日飛び入り用）' });
        } else if (rule.target_type === 'BLOCK_DISTRICT') {
          cellMap.set(num, { num, status: 'block-locked', label: `${rule.target_name}（ブロック確保・個人未定）` });
        } else {
          cellMap.set(num, { num, status: 'lom-reserved', label: rule.target_name || '' });
        }
      });
    });

    // 1b. ブロック／地区指定のメンバーエリアは特定のLOMに紐付かないので、
    //     座席プラン（seat_plan_rules）から直接、ルールごとに1件だけ表示する。
    const zones: MemberZone[] = (planData as SeatPlanRule[] || [])
      .filter(rule => rule.role === 'MEMBER' && rule.target_type === 'BLOCK_DISTRICT')
      .map(rule => ({
        lomName: `${rule.target_name}（ブロック／地区）`,
        range: rule.end_seat ? `${rule.start_seat} ~ ${rule.end_seat}` : rule.start_seat,
        count: 0,
        status: 'block' as const,
      }));

    // 2. 実際の受付データ（attendances）で上書き — 個人の氏名・受付状況を反映
    (attData as Attendance[] || []).forEach(a => {
      const p = participantsMap.get(a.participant_id) as Participant | undefined;
      if (!p) return;

      if (a.assigned_seat && a.assigned_seat !== 'Distanciel') {
        const num = parseInt(a.assigned_seat, 10);
        if (!isNaN(num)) {
          cellMap.set(num, {
            num,
            status: a.checked_in ? 'checked-in' : 'lom-reserved',
            label: `${p.loms?.name || ''} ${p.last_name} ${p.first_name}`,
            participant: p,
          });
        }
      }

      if (a.member_seat_range) {
        const hasCount = !!a.lom_members_count && a.lom_members_count > 0;
        const displayRange = hasCount ? computeMemberRangeDisplay(a.member_seat_range, a.lom_members_count as number) : a.member_seat_range;
        zones.push({
          lomName: p.loms?.name || '—',
          range: displayRange,
          count: a.lom_members_count || 0,
          status: a.checked_in ? 'confirmed' : 'reserved',
        });

        // 受付済み・人数確定済みなら、実際に使われる座席番号を個別に濃い青で塗る
        if (a.checked_in && hasCount) {
          parseComputedRangeToNums(displayRange).forEach(num => {
            cellMap.set(num, {
              num,
              status: 'member-confirmed',
              label: `${p.loms?.name || ''}（メンバー・受付済み）`,
            });
          });
        }
      }
    });

    setSeatCells(Array.from(cellMap.values()).sort((x, y) => x.num - y.num));
    setMemberZones(zones);
    setSelected(null);
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeeting?.id, activeYear]);

  // 他の受付端末の変更をリアルタイムで反映
  useEffect(() => {
    if (!activeMeeting) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { fetchData(); }, 400);
    };
    const channel = supabase
      .channel(`seatmap-${activeMeeting.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances', filter: `meeting_id=eq.${activeMeeting.id}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seat_plan_rules', filter: `meeting_id=eq.${activeMeeting.id}` }, scheduleRefresh)
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeeting?.id]);

  // 100番台ごとにグループ化し、各グループの中で「理事長」と「メンバー」を分けて保持する
  const groups = useMemo(() => {
    const map = new Map<number, { president: SeatCell[]; member: SeatCell[] }>();
    seatCells.forEach(cell => {
      const bucket = Math.floor(cell.num / 100) * 100;
      if (!map.has(bucket)) map.set(bucket, { president: [], member: [] });
      if (cell.status === 'member-zone') {
        map.get(bucket)!.member.push(cell);
      } else {
        map.get(bucket)!.president.push(cell);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [seatCells]);

  const stats = useMemo(() => {
    const checkedIn = seatCells.filter(c => c.status === 'checked-in' || c.status === 'member-confirmed').length;
    const reserved = seatCells.filter(c => c.status === 'lom-reserved' || c.status === 'block-locked').length;
    const empty = seatCells.filter(c => c.status === 'empty').length;
    return { checkedIn, reserved, empty, total: seatCells.length };
  }, [seatCells]);

  if (!activeMeeting) {
    return (
      <div style={{ backgroundColor: '#fff', padding: '48px', borderRadius: '16px', border: '1px solid #e5e9f0', textAlign: 'center', color: '#94a3b8' }}>
        会議が選択されていません。
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* 凡例 */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', backgroundColor: '#fff', padding: '14px 20px', borderRadius: '14px', border: '1px solid #e5e9f0' }}>
        {(Object.keys(STATUS_STYLES) as CellStatus[]).map(status => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#475569' }}>
            <span style={{ width: '16px', height: '16px', borderRadius: '4px', backgroundColor: STATUS_STYLES[status].bg, border: STATUS_STYLES[status].border, display: 'inline-block' }} />
            {STATUS_LABELS[status]}
          </div>
        ))}
      </div>

      {/* 統計 */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <SummaryCard label="登録座席数" value={stats.total} tint="#eef2ff" text="#4338ca" />
        <SummaryCard label="受付済み" value={stats.checkedIn} tint="#ecfdf5" text="#059669" />
        <SummaryCard label="予約済み（未受付）" value={stats.reserved} tint="#fffbeb" text="#b45309" />
        <SummaryCard label="空席（当日飛び入り用）" value={stats.empty} tint="#f8fafc" text="#64748b" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 280px' : '1fr', gap: '20px' }}>

        {/* 座席グリッド（100番台ごと） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {groups.length === 0 ? (
            <div style={{ backgroundColor: '#fff', padding: '48px', borderRadius: '16px', border: '1px solid #e5e9f0', textAlign: 'center', color: '#94a3b8' }}>
              {loading ? '読み込み中...' : '座席プランがまだアップロードされていません。'}
            </div>
          ) : (
            groups.map(([bucket, group]) => {
              const total = group.president.length + group.member.length;
              return (
                <div key={bucket} style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '16px', border: '1px solid #e5e9f0' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#64748b', fontWeight: 700 }}>
                    {bucket === 0 ? '1 〜 99' : `${bucket} 番台`}（{total}席）
                  </h4>

                  {group.president.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: '6px' }}>
                      {group.president.map(cell => (
                        <SeatButton key={cell.num} cell={cell} selected={selected?.num === cell.num} onClick={() => setSelected(cell)} />
                      ))}
                    </div>
                  )}

                  {group.member.length > 0 && (
                    <>
                      <div style={{ height: '20px' }} />
                      <div style={{ fontSize: '11px', color: '#1d4ed8', fontWeight: 700, marginBottom: '8px', paddingTop: '12px', borderTop: '1px dashed #e2e8f0' }}>
                        メンバーエリア
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: '6px' }}>
                        {group.member.map(cell => (
                          <SeatButton key={cell.num} cell={cell} selected={selected?.num === cell.num} onClick={() => setSelected(cell)} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* 選択した座席の詳細 */}
        {selected && (
          <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e5e9f0', height: 'fit-content' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, marginBottom: '4px' }}>座席 {selected.num}</div>
            {selected.participant ? (
              <>
                <div style={{ fontSize: '18px', fontWeight: 800, color: '#1e293b', marginBottom: '8px' }}>
                  {selected.participant.last_name} {selected.participant.first_name}
                </div>
                <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>{selected.participant.loms?.name}</div>
              </>
            ) : (
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#1e293b', marginBottom: '16px' }}>{selected.label}</div>
            )}
            <span style={{
              display: 'inline-block', padding: '6px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 700,
              backgroundColor: STATUS_STYLES[selected.status].bg,
              color: STATUS_STYLES[selected.status].text,
              border: STATUS_STYLES[selected.status].border,
            }}>
              {STATUS_LABELS[selected.status]}
            </span>
            <button onClick={() => setSelected(null)} style={{ display: 'block', marginTop: '16px', padding: '8px 14px', backgroundColor: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
              閉じる
            </button>
          </div>
        )}
      </div>

      {/* メンバーエリア一覧 */}
      {memberZones.length > 0 && (
        <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e5e9f0' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#1e293b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users2 size={16} color="#0ea5e9" /> メンバーエリア一覧
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {memberZones.map((z, i) => {
              const badge = z.status === 'block'
                ? { bg: '#e2e8f0', text: '#475569', label: 'ブロック確保' }
                : z.status === 'confirmed'
                  ? { bg: '#d1fae5', text: '#047857', label: '受付済み' }
                  : { bg: '#fef3c7', text: '#92400e', label: '予約中' };
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', backgroundColor: '#f8fafc', borderRadius: '10px', fontSize: '13px' }}>
                  <span style={{ fontWeight: 700, color: '#1e293b' }}>{z.lomName}</span>
                  <span style={{ color: '#0ea5e9', fontWeight: 700 }}>{z.range}</span>
                  <span style={{ color: '#94a3b8' }}>{z.count > 0 ? `${z.count}名` : '人数未確定'}</span>
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', backgroundColor: badge.bg, color: badge.text }}>
                    {badge.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const SeatButton: React.FC<{ cell: SeatCell; selected: boolean; onClick: () => void }> = ({ cell, selected, onClick }) => {
  const style = STATUS_STYLES[cell.status];
  return (
    <button
      onClick={onClick}
      title={cell.label}
      style={{
        padding: '8px 2px',
        borderRadius: '8px',
        border: selected ? '2px solid #0ea5e9' : style.border,
        backgroundColor: style.bg,
        color: style.text,
        fontWeight: 700,
        fontSize: '12px',
        cursor: 'pointer',
        textAlign: 'center',
      }}
    >
      {cell.num}
    </button>
  );
};

const SummaryCard: React.FC<{ label: string; value: number; tint: string; text: string }> = ({ label, value, tint, text }) => (
  <div style={{ backgroundColor: tint, padding: '16px 24px', borderRadius: '14px', minWidth: '140px' }}>
    <div style={{ fontSize: '12px', color: text, fontWeight: 600, opacity: 0.85 }}>{label}</div>
    <div style={{ fontSize: '28px', fontWeight: 800, color: text, marginTop: '4px' }}>{value}</div>
  </div>
);
