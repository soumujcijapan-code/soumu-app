import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import type { MeetingCycle, SeatingStrategy } from '../types';

interface DashboardProps {
  onSelectCycle: (cycleId: string) => void;
  managementYear: number;
}

type RijikaiForm = {
  location_name: string;
  address: string;
  phone: string;
  meeting_date: string;
  responsible_person: string;
};

const DEFAULT_RIJIKAI: RijikaiForm = {
  location_name: 'Grand Hall',
  address: 'Chiba Port',
  phone: '043-ZZZ-ZZZZ',
  meeting_date: '',
  responsible_person: '事務局',
};

export const Dashboard: React.FC<DashboardProps> = ({ onSelectCycle, managementYear }) => {
  const [cycles, setCycles] = useState<MeetingCycle[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const [targetMonth, setTargetMonth] = useState<number>(new Date().getMonth() + 1);

  // 会議名は「第N回理事会」の形式。番号は毎回手動で入力する（自動採番はしない）。
  const [boardNumber, setBoardNumber] = useState<string>('00');
  const cycleTitle = `第${boardNumber || '00'}回理事会`;

  const [strategy, setStrategy] = useState<SeatingStrategy>('STANDARD');
  const [rijikai, setRijikai] = useState<RijikaiForm>(DEFAULT_RIJIKAI);

  const fetchCycles = async () => {
    const { data, error } = await supabase
      .from('meeting_cycles')
      .select('*, meetings ( id, type, meeting_date, location_name )')
      .eq('year', managementYear)
      .order('month', { ascending: true });
    if (data && !error) setCycles(data as MeetingCycle[]);
  };

  useEffect(() => {
    fetchCycles();
  }, [managementYear]);

  const handleChange = (field: keyof RijikaiForm, value: string) => {
    setRijikai(prev => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setStrategy('STANDARD');
    setBoardNumber('00');
    setRijikai(DEFAULT_RIJIKAI);
  };

  const handleCreateCycle = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data: cycleData, error: cycleError } = await supabase
      .from('meeting_cycles')
      .insert([{ year: managementYear, month: targetMonth, title: cycleTitle }])
      .select()
      .single();

    if (cycleError) {
      alert(`サイクルの作成に失敗しました： ${cycleError.message}`);
      setLoading(false);
      return;
    }

    const { error: meetingError } = await supabase.from('meetings').insert([{
      cycle_id: cycleData.id,
      type: 'RIJIKAI',
      location_name: rijikai.location_name,
      address: rijikai.address || null,
      phone: rijikai.phone || null,
      responsible_person: rijikai.responsible_person,
      meeting_date: rijikai.meeting_date,
      seating_strategy: strategy,
      is_closed: false,
    }]);

    setLoading(false);
    if (meetingError) {
      // サイクルだけが残らないように削除しておく
      await supabase.from('meeting_cycles').delete().eq('id', cycleData.id);
      alert(`理事会の登録に失敗しました： ${meetingError.message}`);
    } else {
      setShowModal(false);
      resetForm();
      fetchCycles();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* HEADER DE SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 900, color: '#0B1F3A', letterSpacing: '0.3px' }}>理事会管理（{managementYear}年度）</h2>
          <p style={{ margin: '6px 0 0 0', fontSize: '14px', color: '#64748b', lineHeight: 1.6 }}>総務委員会による理事会の一元管理。</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: '12px 24px', backgroundColor: '#00A3E0', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0, 163, 224, 0.3)', letterSpacing: '0.3px' }}
        >
          ＋ 新規理事会を作成
        </button>
      </div>

      {/* GRILLE DES CYCLES */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
        {cycles.map(cycle => {
          const rijikaiMeeting = cycle.meetings?.find(m => m.type === 'RIJIKAI');
          return (
            <div
              key={cycle.id}
              onClick={() => onSelectCycle(cycle.id)}
              style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', transition: 'transform 0.2s, border-color 0.2s, box-shadow 0.2s' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#00A3E0'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(0, 163, 224, 0.12)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <div style={{ display: 'inline-block', padding: '4px 10px', backgroundColor: '#eef2ff', color: '#4338ca', borderRadius: '6px', fontSize: '11px', fontWeight: '800', letterSpacing: '0.3px' }}>
                  {cycle.year}年度
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold' }}>{cycle.month}月</div>
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '19px', fontWeight: '900', color: '#0B1F3A' }}>{cycle.title}</h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                {rijikaiMeeting
                  ? ` ${rijikaiMeeting.meeting_date} ・  ${rijikaiMeeting.location_name}`
                  : '理事会が未登録です'}
              </p>
              <div style={{ marginTop: '20px', paddingTop: '12px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', fontSize: '13px', color: '#00A3E0', fontWeight: 'bold' }}>
                開く →
              </div>
            </div>
          );
        })}

        {cycles.length === 0 && (
          <div style={{ gridColumn: '1 / -1', backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '48px', textAlign: 'center' as any, color: '#94a3b8', fontStyle: 'italic' }}>
            {managementYear}年度の理事会はまだ登録されていません。
          </div>
        )}
      </div>

      {/* MODALE DE CRÉATION */}
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(11, 31, 58, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '32px', width: '720px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0B1F3A', paddingBottom: '16px', marginBottom: '24px' }}>
              <h3 style={{ margin: 0, color: '#0B1F3A', fontSize: '18px', fontWeight: '900' }}> 理事会の作成（{managementYear}年度）</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '20px', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={handleCreateCycle}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: '16px', marginBottom: '24px' }}>
                <div>
                  <label style={labelStyle}>対象月</label>
                  <select style={inputStyle} value={targetMonth} onChange={e => setTargetMonth(parseInt(e.target.value))}>
                    {[...Array(12)].map((_, i) => <option key={i+1} value={i+1}>{i+1}月</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>理事会 回数</label>
                  <input type="text" inputMode="numeric" style={inputStyle} value={boardNumber} onChange={e => setBoardNumber(e.target.value)} required />
                </div>
                <div>
                  <label style={{ ...labelStyle, color: '#00A3E0' }}>会議名（自動生成）</label>
                  <div style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #bae6fd', backgroundColor: '#f0f9ff', color: '#0369a1', fontWeight: '900', fontSize: '15px' }}>
                    {cycleTitle}
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f0f9ff', borderRadius: '12px', border: '1px solid #bae6fd' }}>
                <label style={{ ...labelStyle, color: '#0369a1' }}>受付プロトコル</label>
                <select
                  value={strategy}
                  onChange={e => setStrategy(e.target.value as SeatingStrategy)}
                  style={{ ...inputStyle, borderColor: '#7dd3fc', fontWeight: 'bold', color: '#0369a1' }}
                >
                  <option value="STANDARD">スタンダード（対面／Zoom）</option>
                  <option value="KYOTO_FIXED">京都会議（座席制）</option>
                  <option value="SUMMER_CON">サマーカンファレンス（座席＋LOM）</option>
                </select>
              </div>

              <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '32px' }}>
                <div style={{ fontWeight: '900', fontSize: '14px', color: '#0B1F3A', marginBottom: '12px' }}>理事会</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <span style={miniLabelStyle}>開催日</span>
                    <input type="date" style={inputStyle} value={rijikai.meeting_date} onChange={e => handleChange('meeting_date', e.target.value)} required />
                  </div>
                  <div>
                    <span style={miniLabelStyle}>責任者</span>
                    <input type="text" style={inputStyle} value={rijikai.responsible_person} onChange={e => handleChange('responsible_person', e.target.value)} required />
                  </div>
                  <div>
                    <span style={miniLabelStyle}>会場名</span>
                    <input type="text" style={inputStyle} value={rijikai.location_name} onChange={e => handleChange('location_name', e.target.value)} required />
                  </div>
                  <div>
                    <span style={miniLabelStyle}>電話番号</span>
                    <input type="text" style={inputStyle} value={rijikai.phone} onChange={e => handleChange('phone', e.target.value)} />
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={miniLabelStyle}>住所</span>
                    <input type="text" style={inputStyle} value={rijikai.address} onChange={e => handleChange('address', e.target.value)} />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: '10px 20px', backgroundColor: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                  キャンセル
                </button>
                <button type="submit" disabled={loading} style={{ padding: '10px 24px', backgroundColor: '#00A3E0', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0, 163, 224, 0.25)' }}>
                  {loading ? '登録処理中...' : ` ${cycleTitle} を作成`}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};

const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 'bold', color: '#334155', marginBottom: '6px' };
const miniLabelStyle = { display: 'block', fontSize: '11px', color: '#64748b', marginBottom: '2px' };
const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', color: '#334155', fontSize: '13px', boxSizing: 'border-box' as any, outline: 'none' };
