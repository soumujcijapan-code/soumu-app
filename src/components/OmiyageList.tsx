import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import type { Meeting } from '../types';

interface GiftRow {
  id: string;
  last_name: string;
  first_name: string;
  omiyage_shop: string | null;
  omiyage_item: string | null;
  loms?: { name: string };
}

interface Props {
  activeMeeting: Meeting | null;
}

export const OmiyageList: React.FC<Props> = ({ activeMeeting }) => {
  const [gifts, setGifts] = useState<GiftRow[]>([]);

  useEffect(() => {
    const fetchGifts = async () => {
      if (!activeMeeting) {
        setGifts([]);
        return;
      }

      // has_omiyage / omiyage_shop / omiyage_item ne sont plus sur `participants` :
      // ils vivent dans `attendances`, scoppés à ce meeting_id précis.
      const { data, error } = await supabase
        .from('attendances')
        .select('omiyage_shop, omiyage_item, participants!inner(id, last_name, first_name, loms(name))')
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
          loms: Array.isArray(participant?.loms) ? participant?.loms[0] : participant?.loms,
        };
      });

      setGifts(rows);
    };

    fetchGifts();
  }, [activeMeeting]);

  if (!activeMeeting) {
    return (
      <div style={{ backgroundColor: '#1e293b', padding: '24px', borderRadius: '12px', border: '1px solid #334155', color: '#64748b', textAlign: 'center', fontStyle: 'italic' }}>
        対象の会議が選択されていません。
      </div>
    );
  }

  return (
    <div style={{ color: '#fff' }}>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h4 style={{ margin: 0, color: '#f59e0b' }}>🎁 お土産管理簿</h4>
        <button onClick={() => window.print()} style={{ padding: '6px 12px', backgroundColor: '#f59e0b', border: 'none', borderRadius: '4px', color: '#0f172a', fontWeight: 'bold', cursor: 'pointer' }}>🖨️ 一覧を印刷</button>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; color: #000 !important; background: #fff !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="print-area" style={{ backgroundColor: '#0f172a', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', textAlign: 'center' }}>
          {activeMeeting.location_name}（{activeMeeting.meeting_date}） お土産受領一覧
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #475569' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>LOM（所属）</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>氏名</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>お店</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>品名</th>
            </tr>
          </thead>
          <tbody>
            {gifts.map(g => (
              <tr key={g.id} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px' }}>{g.loms?.name}</td>
                <td style={{ padding: '8px', fontWeight: 'bold' }}>{g.last_name} {g.first_name}</td>
                <td style={{ padding: '8px', color: '#f59e0b' }}>{g.omiyage_shop || '—'}</td>
                <td style={{ padding: '8px' }}>{g.omiyage_item || '—'}</td>
              </tr>
            ))}
            {gifts.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontStyle: 'italic' }}>現時点で登録されているお土産はありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
