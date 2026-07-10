import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import type { MeetingCycle, JciMeetingType, SeatingStrategy } from '../types';

interface DashboardProps {
  onSelectCycle: (cycleId: string) => void;
  managementYear: number;
}

const PART_LABELS: Record<JciMeetingType, string> = {
  SEIFUKU_1: '正副会議 ①',
  SEIFUKU_2: '正副会議 ②',
  JOUNIN: '常任理事会',
  RIJIKAI: '理事会',
};

export const Dashboard: React.FC<DashboardProps> = ({ onSelectCycle, managementYear }) => {
  const [cycles, setCycles] = useState<MeetingCycle[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const [targetMonth, setTargetMonth] = useState<number>(new Date().getMonth() + 1);

  // 会議名は「第N回理事会」の形式。基本は「第00回理事会」で、番号は毎回手動で入力する
  // （自動採番はしない）。
  const [boardNumber, setBoardNumber] = useState<string>('00');
  const cycleTitle = `第${boardNumber || '00'}回理事会`;

  // 受付プロトコル（4つの会議すべてに共通適用）
  const [globalStrategy, setGlobalStrategy] = useState<SeatingStrategy>('STANDARD');

  // 4つの会議の初期値
  const [parts, setParts] = useState<Record<JciMeetingType, {
    location_name: string; address: string; phone: string; meeting_date: string;
    soumu_check_date: string; link_check_1_date: string; link_check_2_date: string;
    responsible_person: string;
  }>>({
    SEIFUKU_1: { location_name: 'LOM Office', address: 'Chiba', phone: '043-XXX-XXXX', meeting_date: '', soumu_check_date: '', link_check_1_date: '', link_check_2_date: '', responsible_person: '事務局' },
    SEIFUKU_2: { location_name: 'LOM Office', address: 'Chiba', phone: '043-XXX-XXXX', meeting_date: '', soumu_check_date: '', link_check_1_date: '', link_check_2_date: '', responsible_person: '事務局' },
    JOUNIN: { location_name: 'Civic Center', address: 'Chiba Central', phone: '043-YYY-YYYY', meeting_date: '', soumu_check_date: '', link_check_1_date: '', link_check_2_date: '', responsible_person: '事務局' },
    RIJIKAI: { location_name: 'Grand Hall', address: 'Chiba Port', phone: '043-ZZZ-ZZZZ', meeting_date: '', soumu_check_date: '', link_check_1_date: '', link_check_2_date: '', responsible_person: '事務局' },
  });

  const fetchCycles = async () => {
    const { data, error } = await supabase
      .from('meeting_cycles')
      .select('*')
      .eq('year', managementYear)
      .order('month', { ascending: true });
    if (data && !error) setCycles(data as MeetingCycle[]);
  };

  useEffect(() => {
    fetchCycles();
  }, [managementYear]);

  const handlePartChange = (type: JciMeetingType, field: string, value: string) => {
    setParts(prev => ({
      ...prev,
      [type]: { ...prev[type], [field]: value }
    }));
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

    // 4つの子会議の一括登録
    const meetingsPayload = (Object.keys(parts) as JciMeetingType[]).map(type => {
      const p = parts[type];
      return {
        cycle_id: cycleData.id,
        type: type,
        location_name: p.location_name,
        address: p.address || null,
        phone: p.phone || null,
        responsible_person: p.responsible_person,
        meeting_date: p.meeting_date || new Date().toISOString().split('T')[0],
        soumu_check_date: p.soumu_check_date || null,
        // 理事会にはリンクチェック工程は存在しない
        link_check_1_date: type === 'RIJIKAI' ? null : (p.link_check_1_date || null),
        link_check_2_date: type === 'RIJIKAI' ? null : (p.link_check_2_date || null),
        seating_strategy: globalStrategy,
        is_closed: false
      };
    });

    const { error: meetingsError } = await supabase.from('meetings').insert(meetingsPayload);

    setLoading(false);
    if (meetingsError) {
      alert(`会議の登録に失敗しました： ${meetingsError.message}`);
    } else {
      setShowModal(false);
      setGlobalStrategy('STANDARD');
      setBoardNumber('00');
      fetchCycles();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* HEADER DE SECTION */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 900, color: '#0B1F3A', letterSpacing: '0.3px' }}>会議サイクル管理</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#64748b' }}>総務委員会による会議サイクルの一元管理。</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          style={{ padding: '12px 24px', backgroundColor: '#00A3E0', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', boxShadow: '0 4px 14px rgba(0, 163, 224, 0.3)', letterSpacing: '0.3px' }}
        >
          ＋ 新規サイクル作成
        </button>
      </div>

      {/* GRILLE DES CYCLES */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
        {cycles.map(cycle => (
          <div
            key={cycle.id}
            onClick={() => onSelectCycle(cycle.id)}
            style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', transition: 'transform 0.2s, border-color 0.2s, box-shadow 0.2s' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#00A3E0'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(0, 163, 224, 0.12)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div style={{ display: 'inline-block', padding: '4px 10px', backgroundColor: '#0B1F3A', color: '#F5C842', borderRadius: '6px', fontSize: '11px', fontWeight: '900', letterSpacing: '0.5px' }}>
                {cycle.year}年度
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold' }}>{cycle.month}月</div>
            </div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '19px', fontWeight: '900', color: '#0B1F3A' }}>{cycle.title}</h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>正副会議①②・常任理事会・理事会の4つの会議で構成されています。</p>
            <div style={{ marginTop: '20px', paddingTop: '12px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', fontSize: '13px', color: '#00A3E0', fontWeight: 'bold' }}>
              サイクルを開く →
            </div>
          </div>
        ))}

        {cycles.length === 0 && (
          <div style={{ gridColumn: '1 / -1', backgroundColor: '#fff', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '48px', textAlign: 'center' as any, color: '#94a3b8', fontStyle: 'italic' }}>
            登録されている会議サイクルはまだありません。
          </div>
        )}
      </div>

      {/* MODALE POPUP D'ARMEMENT DES CYCLES */}
      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(11, 31, 58, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '32px', width: '850px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0B1F3A', paddingBottom: '16px', marginBottom: '24px' }}>
              <h3 style={{ margin: 0, color: '#0B1F3A', fontSize: '18px', fontWeight: '900' }}>🏗️ 月次会議サイクルの作成</h3>
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

              {/* Sélecteur global du protocole d'accueil */}
              <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#f0f9ff', borderRadius: '12px', border: '1px solid #bae6fd' }}>
                <label style={{ ...labelStyle, color: '#0369a1' }}>🎫 受付プロトコル（4つの会議に共通適用）</label>
                <select
                  value={globalStrategy}
                  onChange={e => setGlobalStrategy(e.target.value as SeatingStrategy)}
                  style={{ ...inputStyle, borderColor: '#7dd3fc', fontWeight: 'bold', color: '#0369a1' }}
                >
                  <option value="STANDARD">スタンダード（対面／Zoom）</option>
                  <option value="KYOTO_FIXED">京都会議（座席制）</option>
                  <option value="SUMMER_CON">サマーカンファレンス（座席＋LOM）</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '32px' }}>
                <h4 style={{ margin: 0, fontSize: '13px', color: '#00A3E0', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '900' }}>4つの会議の同時設定</h4>

                {(Object.keys(parts) as JciMeetingType[]).map(type => (
                  <div key={type} style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: '900', fontSize: '14px', color: '#0B1F3A', marginBottom: '12px' }}>{PART_LABELS[type]}</div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                      <input type="date" title="開催日" style={inputStyle} onChange={e => handlePartChange(type, 'meeting_date', e.target.value)} required />
                      <input type="text" placeholder="会場名" value={parts[type].location_name} style={inputStyle} onChange={e => handlePartChange(type, 'location_name', e.target.value)} required />
                      <input type="text" placeholder="住所" value={parts[type].address} style={inputStyle} onChange={e => handlePartChange(type, 'address', e.target.value)} />
                      <input type="text" placeholder="電話番号" value={parts[type].phone} style={inputStyle} onChange={e => handlePartChange(type, 'phone', e.target.value)} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                      <div>
                        <span style={miniLabelStyle}>総務チェック</span>
                        <input type="date" style={inputStyle} onChange={e => handlePartChange(type, 'soumu_check_date', e.target.value)} />
                      </div>
                      {type !== 'RIJIKAI' ? (
                        <>
                          <div>
                            <span style={miniLabelStyle}>リンクチェック①</span>
                            <input type="date" style={inputStyle} onChange={e => handlePartChange(type, 'link_check_1_date', e.target.value)} />
                          </div>
                          <div>
                            <span style={miniLabelStyle}>リンクチェック②</span>
                            <input type="date" style={inputStyle} onChange={e => handlePartChange(type, 'link_check_2_date', e.target.value)} />
                          </div>
                        </>
                      ) : (
                        <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#94a3b8', backgroundColor: '#f1f5f9', borderRadius: '6px', border: '1px dashed #cbd5e1' }}>
                          ⚠️ 理事会にはリンクチェック工程はありません
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '20px' }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ padding: '10px 20px', backgroundColor: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                  キャンセル
                </button>
                <button type="submit" disabled={loading} style={{ padding: '10px 24px', backgroundColor: '#0B1F3A', color: '#F5C842', border: 'none', borderRadius: '8px', fontWeight: '900', cursor: 'pointer' }}>
                  {loading ? '登録処理中...' : `⚡ ${cycleTitle} を開始`}
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
