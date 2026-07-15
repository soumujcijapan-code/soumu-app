import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import type { Meeting } from '../types';
import { Download } from 'lucide-react';

interface GiftRow {
  id: string;
  last_name: string;
  first_name: string;
  omiyage_shop: string | null;
  omiyage_item: string | null;
  assigned_seat: string | null;
  loms?: { name: string; sort_priority?: number };
}

interface Props {
  activeMeeting: Meeting | null;
}

// 座席番号を数値として比較する（文字列比較だと "10" が "2" より前に来てしまうため）
const compareSeats = (a: string | null, b: string | null): number => {
  const numA = a ? parseInt(a, 10) : NaN;
  const numB = b ? parseInt(b, 10) : NaN;
  if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
  return (a || '').localeCompare(b || '');
};

export const OmiyageList: React.FC<Props> = ({ activeMeeting }) => {
  const [gifts, setGifts] = useState<GiftRow[]>([]);

  const fetchGifts = async () => {
    if (!activeMeeting) {
      setGifts([]);
      return;
    }

    // has_omiyage / omiyage_shop / omiyage_item ne sont plus sur `participants` :
    // ils vivent dans `attendances`, scoppés à ce meeting_id précis.
    const { data, error } = await supabase
      .from('attendances')
      .select('omiyage_shop, omiyage_item, assigned_seat, participants!inner(id, last_name, first_name, loms(name, sort_priority))')
      .eq('meeting_id', activeMeeting.id)
      .eq('has_omiyage', true);

    if (error || !data) {
      console.error(error);
      setGifts([]);
      return;
    }

    const rows: GiftRow[] = (data as any[]).map(row => {
      const participant = Array.isArray(row.participants) ? row.participants[0] : row.participants;
      return {
        id: participant?.id,
        last_name: participant?.last_name || '',
        first_name: participant?.first_name || '',
        omiyage_shop: row.omiyage_shop,
        omiyage_item: row.omiyage_item,
        assigned_seat: row.assigned_seat,
        loms: Array.isArray(participant?.loms) ? participant?.loms[0] : participant?.loms,
      };
    });

    // 席次順（LOMの優先順位 → 座席番号）に並び替え
    rows.sort((a, b) => {
      const priorA = a.loms?.sort_priority ?? 50;
      const priorB = b.loms?.sort_priority ?? 50;
      if (priorA !== priorB) return priorA - priorB;
      return compareSeats(a.assigned_seat, b.assigned_seat);
    });

    setGifts(rows);
  };

  useEffect(() => {
    fetchGifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeeting]);

  // 他の受付端末での変更（お土産の申告・取消など）をリアルタイムで反映する
  useEffect(() => {
    if (!activeMeeting) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { fetchGifts(); }, 400);
    };
    const channel = supabase
      .channel(`omiyage-${activeMeeting.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances', filter: `meeting_id=eq.${activeMeeting.id}` }, scheduleRefresh)
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeeting?.id]);

  const handleExportExcel = async () => {
    if (gifts.length === 0) {
      alert('出力するお土産がありません。');
      return;
    }
    const XLSX = await import('xlsx');
    const rows = gifts.map(g => ({
      'LOM': g.loms?.name || '',
      '氏名': `${g.last_name} ${g.first_name}`,
      '座席': g.assigned_seat || '',
      'お店': g.omiyage_shop || '',
      '品名': g.omiyage_item || '',
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 8 }, { wch: 20 }, { wch: 24 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'お土産');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `お土産リスト_${dateStr}.xlsx`);
  };

  if (!activeMeeting) {
    return (
      <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#94a3b8', textAlign: 'center', fontStyle: 'italic' }}>
        対象の会議が選択されていません。
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h4 style={{ margin: 0, color: '#0B1F3A', fontSize: '16px' }}>お土産管理簿</h4>
        <button
          onClick={handleExportExcel}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#0B1F3A', color: '#F5C842', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}
        >
          <Download size={15} /> Excelに出力
        </button>
      </div>

      <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', textAlign: 'center', color: '#0f172a' }}>
          {activeMeeting.location_name}（{activeMeeting.meeting_date}） お土産受領一覧
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', color: '#0f172a' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #cbd5e1' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>LOM（所属）</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>氏名</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>お店</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>品名</th>
            </tr>
          </thead>
          <tbody>
            {gifts.map(g => (
              <tr key={g.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '8px' }}>{g.loms?.name}</td>
                <td style={{ padding: '8px', fontWeight: 'bold' }}>{g.last_name} {g.first_name}</td>
                <td style={{ padding: '8px', color: '#b45309' }}>{g.omiyage_shop || '—'}</td>
                <td style={{ padding: '8px' }}>{g.omiyage_item || '—'}</td>
              </tr>
            ))}
            {gifts.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic' }}>現時点で登録されているお土産はありません。</td>
              </tr>
            )}
          </tbody>
        </table>

        {gifts.length > 0 && (
          <p style={{ textAlign: 'center', fontSize: '15px', fontWeight: 'bold', letterSpacing: '0.5px', marginTop: '24px', lineHeight: 2, color: '#0f172a' }}>
            以上となります。<br/>
            ありがとうございました。
          </p>
        )}
      </div>
    </div>
  );
};
