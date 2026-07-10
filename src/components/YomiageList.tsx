import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import type { Meeting, Participant } from '../types';

interface Props {
  activeMeeting: Meeting | null;
  activeYear: number;
}

export const YomiageList: React.FC<Props> = ({ activeMeeting, activeYear }) => {
  const [attendees, setAttendees] = useState<Participant[]>([]);

  useEffect(() => {
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

    fetchAttendees();
  }, [activeMeeting, activeYear]);

  if (!activeMeeting) {
    return (
      <div style={{ backgroundColor: '#1e293b', padding: '24px', borderRadius: '12px', border: '1px solid #334155', color: '#64748b', textAlign: 'center', fontStyle: 'italic' }}>
        対象の会議が選択されていません。読み上げ表を作成するには会議を選択してください。
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: '#1e293b', padding: '24px', borderRadius: '12px', border: '1px solid #334155', maxWidth: '800px', margin: '0 auto' }}>

      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #334155', paddingBottom: '16px' }}>
        <h3 style={{ margin: 0, color: '#fff' }}>📜 読み上げ表</h3>
        <button
          onClick={() => window.print()}
          style={{ padding: '12px 24px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
        >
          🖨️ 印刷する
        </button>
      </div>

      {/* LE DOCUMENT IMPRIMABLE (Dissimule l'interface web lors de l'impression) */}
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
              background: #fff !important;
              color: #000 !important;
              padding: 20px;
            }
            .no-print { display: none !important; }
            .page-break { page-break-inside: avoid; }
          }
          .print-document {
            background-color: #f8fafc;
            color: #0f172a;
            padding: 40px;
            border-radius: 8px;
            font-family: "Yu Mincho", "MS Mincho", serif;
            line-height: 1.8;
          }
          .intro-text {
            font-size: 18px;
            margin-bottom: 40px;
          }
          .participant-block {
            margin-bottom: 32px;
          }
          .furigana {
            font-size: 12px;
            letter-spacing: 2px;
            color: #475569;
            margin-bottom: 2px;
            margin-left: 16px;
          }
          .name-line {
            font-size: 22px;
            font-weight: bold;
            margin-left: 16px;
            margin-bottom: 8px;
          }
          .lom-line {
            font-size: 16px;
          }
        `}</style>

        <div className="intro-text">
          <p>続きまして、日頃より、日本青年会議所の運動に多大なるご尽力を頂戴しております、<br/>
          皆様をご紹介させて頂きます。まずは、</p>
        </div>

        {attendees.length === 0 ? (
          <p style={{ textAlign: 'center', fontStyle: 'italic', color: '#94a3b8', fontFamily: 'sans-serif' }}>
            ※ 登録者がまだいません
          </p>
        ) : (
          attendees.map((p) => (
            <div key={p.id} className="participant-block page-break">
              <div className="furigana">{p.last_name_kana} {p.first_name_kana}</div>
              <div className="name-line">{p.last_name} {p.first_name} 様</div>
              <div className="lom-line">
                をはじめといたします、 {p.loms?.name} の皆様です。
              </div>
            </div>
          ))
        )}

        <div className="intro-text" style={{ marginTop: '60px' }}>
          <p>以上、ご紹介とさせていただきます。</p>
        </div>
      </div>
    </div>
  );
};
