import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import type { Meeting, Participant } from '../types';

interface Props {
  activeMeeting: Meeting | null;
  activeYear: number;
}

export const YomiageList: React.FC<Props> = ({ activeMeeting, activeYear }) => {
  const [attendees, setAttendees] = useState<Participant[]>([]);

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

    // 2. この会議で受付済み（checked_in）の参加者IDを取得
    //    checked_in / 会議との紐付けは attendances テーブルで管理されている。
    const { data: attData, error: aError } = await supabase
      .from('attendances')
      .select('participant_id')
      .eq('meeting_id', activeMeeting.id)
      .eq('checked_in', true);

    if (aError) {
      console.error(aError);
      setAttendees([]);
      return;
    }

    const checkedInIds = new Set((attData || []).map(a => a.participant_id));

    // 3. 席次順（LOMの優先順位 → 認証番号）に並び替え
    const checkedInParticipants = (participantsData as any[])
      .filter(p => checkedInIds.has(p.id))
      .sort((a, b) => {
        const priorA = a.loms?.sort_priority ?? 50;
        const priorB = b.loms?.sort_priority ?? 50;
        if (priorA !== priorB) return priorA - priorB;
        return (a.auth_id || '').localeCompare(b.auth_id || '');
      });

    setAttendees(checkedInParticipants as Participant[]);
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

  if (!activeMeeting) {
    return (
      <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', color: '#94a3b8', textAlign: 'center', fontStyle: 'italic' }}>
        対象の会議が選択されていません。読み上げ表を作成するには会議を選択してください。
      </div>
    );
  }

  return (
    <div>

      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, color: '#0B1F3A', fontSize: '16px' }}>読み上げ表</h3>
        <button
          onClick={() => window.print()}
          style={{ padding: '10px 20px', backgroundColor: '#00A3E0', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}
        >
          印刷する
        </button>
      </div>

      {/* この画面表示は印刷結果とまったく同じ見た目にしてある（別デザインを持たない） */}
      <div className="print-document">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .print-document, .print-document * { visibility: visible; }
            .print-document {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
              max-width: none;
              padding: 20px;
            }
            .no-print { display: none !important; }
            table, tr, td {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
          .print-document {
            background-color: #fff;
            color: #0f172a;
            padding: 40px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            font-family: 'Meiryo', 'Yu Gothic', sans-serif;
            line-height: 1.8;
          }
          .intro-text {
            font-size: 15px;
            font-weight: bold;
            letter-spacing: 0.5px;
            text-align: center;
            margin-top: 24px;
          }
          .doc-title {
            text-align: center;
            font-size: 20px;
            margin-bottom: 20px;
          }
        `}</style>

        <h1 className="doc-title">登録者・オブザーバーリスト</h1>

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

        <p className="intro-text">改めましてオブザーブいただきました理事長の皆様に盛大な拍手をお願いいたします。</p>
      </div>
    </div>
  );
};
