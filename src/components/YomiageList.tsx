import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import type { Meeting, Participant } from '../types';
import { Download } from 'lucide-react';

interface Props {
  activeMeeting: Meeting | null;
  activeYear: number;
}

interface AttendeeRow extends Participant {
  assigned_seat: string | null;
}

// 座席番号を数値として比較する（文字列比較だと "10" が "2" より前に来てしまうため）
const compareSeats = (a: string | null, b: string | null): number => {
  const numA = a ? parseInt(a, 10) : NaN;
  const numB = b ? parseInt(b, 10) : NaN;
  if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
  return (a || '').localeCompare(b || '');
};

export const YomiageList: React.FC<Props> = ({ activeMeeting, activeYear }) => {
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);

  const fetchAttendees = async () => {
    if (!activeMeeting) return;

    // 1. 対象年度の参加者（氏名・LOM情報）を取得
    const { data: participantsData, error: pError } = await supabase
      .from('participants')
      .select('*, loms(name, name_kana, sort_priority)')
      .eq('mandate_year', activeYear);

    if (pError || !participantsData) {
      console.error(pError);
      setAttendees([]);
      return;
    }

    // 2. この会議で受付済み（checked_in）の参加者IDと座席を取得
    //    checked_in / 座席 / 会議との紐付けは attendances テーブルで管理されている。
    const { data: attData, error: aError } = await supabase
      .from('attendances')
      .select('participant_id, assigned_seat')
      .eq('meeting_id', activeMeeting.id)
      .eq('checked_in', true);

    if (aError) {
      console.error(aError);
      setAttendees([]);
      return;
    }

    const seatMap = new Map((attData || []).map(a => [a.participant_id, a.assigned_seat as string | null]));

    // 3. 席次順（LOMの優先順位 → 座席番号）に並び替え
    const checkedInParticipants = (participantsData as any[])
      .filter(p => seatMap.has(p.id))
      .map(p => ({ ...p, assigned_seat: seatMap.get(p.id) || null }))
      .sort((a, b) => {
        const priorA = a.loms?.sort_priority ?? 50;
        const priorB = b.loms?.sort_priority ?? 50;
        if (priorA !== priorB) return priorA - priorB;
        return compareSeats(a.assigned_seat, b.assigned_seat);
      });

    setAttendees(checkedInParticipants as AttendeeRow[]);
  };

  useEffect(() => {
    fetchAttendees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeeting, activeYear]);

  // 他の受付端末での変更（新しい受付・取消など）をリアルタイムで反映する
  useEffect(() => {
    if (!activeMeeting) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { fetchAttendees(); }, 400);
    };
    const channel = supabase
      .channel(`yomiage-${activeMeeting.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendances', filter: `meeting_id=eq.${activeMeeting.id}` }, scheduleRefresh)
      .subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeeting?.id]);

  const handleExportExcel = async () => {
    if (attendees.length === 0) {
      alert('出力する登録者がいません。');
      return;
    }
    const XLSX = await import('xlsx');
    const rows = attendees.map(p => ({
      'LOM': p.loms?.name || '',
      'LOMふりがな': p.loms?.name_kana || '',
      '氏': p.last_name,
      '名': p.first_name,
      '氏（ふりがな）': p.last_name_kana,
      '名（ふりがな）': p.first_name_kana,
      '座席': p.assigned_seat || '',
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 8 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '読み上げ表');
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `読み上げ表_${dateStr}.xlsx`);
  };

  if (!activeMeeting) {
    return (
      <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#94a3b8', textAlign: 'center', fontStyle: 'italic' }}>
        対象の会議が選択されていません。読み上げ表を作成するには会議を選択してください。
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, color: '#0B1F3A', fontSize: '16px' }}>読み上げ表</h3>
        <button
          onClick={handleExportExcel}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', backgroundColor: '#0B1F3A', color: '#F5C842', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}
        >
          <Download size={15} /> Excelに出力
        </button>
      </div>

      <div style={{ backgroundColor: '#fff', color: '#0f172a', padding: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', fontFamily: "'Meiryo', 'Yu Gothic', sans-serif", lineHeight: 1.8 }}>
        <p style={{ textAlign: 'center', fontSize: '14px', lineHeight: 1.9, marginBottom: '16px' }}>
          それでは、開会までに受付をされましたオブザーブの理事長の皆様をご紹介させていただきます。<br/>
          なお、法人格名の呼称は割愛させていただきます。また、時間の都合上、拍手は最後に一括でお願いいたします。
        </p>

        {attendees.length === 0 ? (
          <p style={{ textAlign: 'center', fontStyle: 'italic', color: '#94a3b8' }}>
            ※ 登録者がまだいません
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '2px solid #000', marginBottom: '32px' }}>
            <tbody>
              {attendees.map((p) => (
                <React.Fragment key={p.id}>
                  <tr style={{ backgroundColor: '#c9daf8', fontSize: '11px' }}>
                    <td style={{ border: '1px solid #000', padding: '4px 8px', textAlign: 'center', width: '35%' }}>{p.loms?.name_kana || ''}</td>
                    <td style={{ border: '1px solid #000', padding: '4px', textAlign: 'center', width: '15%' }}></td>
                    <td style={{ border: '1px solid #000', padding: '4px 12px', textAlign: 'left', width: '40%' }}>{p.last_name_kana} {p.first_name_kana}</td>
                    <td style={{ border: '1px solid #000', padding: '4px', textAlign: 'center', width: '10%' }}></td>
                  </tr>
                  <tr style={{ fontSize: '15px' }}>
                    <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'center', fontWeight: 'bold' }}>{p.loms?.name || '—'}</td>
                    <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'center' }}>理事長</td>
                    <td style={{ border: '1px solid #000', padding: '8px 12px', textAlign: 'left', fontWeight: 'bold' }}>{p.last_name} {p.first_name}</td>
                    <td style={{ border: '1px solid #000', padding: '8px', textAlign: 'center' }}>君</td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}

        <p style={{ textAlign: 'center', fontSize: '15px', fontWeight: 'bold', letterSpacing: '0.5px', marginTop: '24px', lineHeight: 2 }}>
          以上、開会までに受付をお済になられました理事長の皆様のご紹介とさせていただきます。<br/>
          改めましてオブザーブいただきました理事長の皆様に盛大な拍手をお願いいたします。<br/>
          オブザーバー紹介は以上となります。<br/>
          また、お土産も数多くいただいておりますので、ご紹介させていただきます。
        </p>
      </div>
    </div>
  );
};
