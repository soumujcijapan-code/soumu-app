import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import type { MeetingCycle, Meeting, JciMeetingType, SeatingStrategy } from '../types';

interface CycleDetailsProps {
  cycleId: string;
  onBack: () => void;
  onStartOperation: (meetingId: string) => void;
}

const TYPE_ORDER: Record<JciMeetingType, number> = {
  SEIFUKU_1: 1,
  SEIFUKU_2: 2,
  JOUNIN: 3,
  RIJIKAI: 4,
};

const PART_LABELS: Record<JciMeetingType, string> = {
  SEIFUKU_1: '正副会議 ①',
  SEIFUKU_2: '正副会議 ②',
  JOUNIN: '常任理事会',
  RIJIKAI: '理事会',
};

const STRATEGY_LABELS: Record<SeatingStrategy, string> = {
  STANDARD: 'スタンダード（対面／Zoom）',
  KYOTO_FIXED: '京都会議（座席制）',
  SUMMER_CON: 'サマーカンファレンス（座席＋LOM）',
};

const STRATEGY_COLORS: Record<SeatingStrategy, { bg: string; text: string }> = {
  STANDARD: { bg: '#f1f5f9', text: '#475569' },
  KYOTO_FIXED: { bg: '#e0f2fe', text: '#0369a1' },
  SUMMER_CON: { bg: '#fef3c7', text: '#b45309' },
};

export const CycleDetails: React.FC<CycleDetailsProps> = ({ cycleId, onBack, onStartOperation }) => {
  const [cycle, setCycle] = useState<MeetingCycle | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  // Gestion de l'édition par ligne
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Meeting>>({});

  const fetchCycleDetails = async () => {
    setLoading(true);

    // 1. Récupération du parent
    const { data: cycleData, error: cycleError } = await supabase
      .from('meeting_cycles')
      .select('*')
      .eq('id', cycleId)
      .single();

    if (cycleError) {
      alert("サイクルが見つかりませんでした。");
      onBack();
      return;
    }
    setCycle(cycleData);

    // 2. Récupération des enfants
    const { data: meetingsData } = await supabase
      .from('meetings')
      .select('*')
      .eq('cycle_id', cycleId);

    if (meetingsData) {
      // Tri protocolaire : Seifuku 1 -> Seifuku 2 -> Jounin -> Rijikai
      const sorted = meetingsData.sort((a, b) => TYPE_ORDER[a.type as JciMeetingType] - TYPE_ORDER[b.type as JciMeetingType]);
      setMeetings(sorted as Meeting[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCycleDetails();
  }, [cycleId]);

  const handleDeleteCycle = async () => {
    const confirm = window.confirm(`⚠️ 「${cycle?.title}」とその4つの会議をすべて削除します。この操作は取り消せません。よろしいですか？`);
    if (!confirm) return;

    const { error } = await supabase
      .from('meeting_cycles')
      .delete()
      .eq('id', cycleId);

    if (error) {
      alert(`削除に失敗しました： ${error.message}`);
    } else {
      onBack();
    }
  };

  const handleEditClick = (m: Meeting) => {
    setEditingId(m.id);
    setEditForm(m);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    const payload = { ...editForm };
    if (payload.type === 'RIJIKAI') {
      payload.link_check_1_date = null;
      payload.link_check_2_date = null;
    }

    const { error } = await supabase
      .from('meetings')
      .update(payload)
      .eq('id', editingId);

    if (error) {
      alert(`更新に失敗しました： ${error.message}`);
    } else {
      setEditingId(null);
      fetchCycleDetails();
    }
  };

  if (loading || !cycle) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>読み込み中...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* BANDEAU SUPÉRIEUR */}
      <div style={{ backgroundColor: '#fff', padding: '24px', borderRadius: '16px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', borderTop: '3px solid #0B1F3A' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#00A3E0', cursor: 'pointer', fontWeight: 'bold', marginBottom: '8px', fontSize: '13px' }}>
            ← ダッシュボードに戻る
          </button>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 900, color: '#0B1F3A' }}>{cycle.title}</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>{cycle.year}年度 • {cycle.month}月</p>
        </div>
        <button
          onClick={handleDeleteCycle}
          style={{ padding: '10px 16px', backgroundColor: '#fff', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', cursor: 'pointer' }}
        >
          🗑️ このサイクルを削除
        </button>
      </div>

      {/* LISTE DES 4 SOUS-ÉVÉNEMENTS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', color: '#334155', fontWeight: 'bold' }}>予定されている会議（{meetings.length}/4）</h3>

        {meetings.map(m => {
          const isEditing = editingId === m.id;
          const strategyColor = STRATEGY_COLORS[m.seating_strategy];
          return (
            <div key={m.id} style={{ backgroundColor: '#fff', borderRadius: '12px', border: isEditing ? '2px solid #00A3E0' : '1px solid #e2e8f0', padding: '20px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: '24px', transition: 'border-color 0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>

              {/* ZONE GAUCHE : DONNÉES & ÉDITION */}
              <div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'inline-block', padding: '4px 10px', backgroundColor: m.type === 'RIJIKAI' ? '#0B1F3A' : '#f1f5f9', color: m.type === 'RIJIKAI' ? '#F5C842' : '#475569', borderRadius: '6px', fontSize: '11px', fontWeight: '900' }}>
                    {PART_LABELS[m.type]}
                  </div>
                  <div style={{ display: 'inline-block', padding: '4px 10px', backgroundColor: strategyColor.bg, color: strategyColor.text, borderRadius: '6px', fontSize: '11px', fontWeight: 'bold' }}>
                    🎫 {STRATEGY_LABELS[m.seating_strategy]}
                  </div>
                </div>

                {isEditing ? (
                  <div style={{ display: 'grid', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>受付プロトコル</label>
                      <select
                        style={inputStyle}
                        value={editForm.seating_strategy || 'STANDARD'}
                        onChange={e => setEditForm({...editForm, seating_strategy: e.target.value as SeatingStrategy})}
                      >
                        <option value="STANDARD">スタンダード（対面／Zoom）</option>
                        <option value="KYOTO_FIXED">京都会議（座席制）</option>
                        <option value="SUMMER_CON">サマーカンファレンス（座席＋LOM）</option>
                      </select>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                      <input type="text" placeholder="会場名" style={inputStyle} value={editForm.location_name || ''} onChange={e => setEditForm({...editForm, location_name: e.target.value})} />
                      <input type="text" placeholder="住所" style={inputStyle} value={editForm.address || ''} onChange={e => setEditForm({...editForm, address: e.target.value})} />
                      <input type="text" placeholder="電話番号" style={inputStyle} value={editForm.phone || ''} onChange={e => setEditForm({...editForm, phone: e.target.value})} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                      <label style={labelStyle}>開催日 <input type="date" style={inputStyle} value={editForm.meeting_date || ''} onChange={e => setEditForm({...editForm, meeting_date: e.target.value})} /></label>
                      <label style={labelStyle}>責任者 <input type="text" style={inputStyle} value={editForm.responsible_person || ''} onChange={e => setEditForm({...editForm, responsible_person: e.target.value})} /></label>
                      <label style={labelStyle}>総務チェック <input type="date" style={inputStyle} value={editForm.soumu_check_date || ''} onChange={e => setEditForm({...editForm, soumu_check_date: e.target.value})} /></label>
                    </div>
                    {m.type !== 'RIJIKAI' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                         <label style={labelStyle}>リンクチェック① <input type="date" style={inputStyle} value={editForm.link_check_1_date || ''} onChange={e => setEditForm({...editForm, link_check_1_date: e.target.value})} /></label>
                         <label style={labelStyle}>リンクチェック② <input type="date" style={inputStyle} value={editForm.link_check_2_date || ''} onChange={e => setEditForm({...editForm, link_check_2_date: e.target.value})} /></label>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <button onClick={handleSaveEdit} style={{ padding: '8px 16px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>保存</button>
                      <button onClick={() => setEditingId(null)} style={{ padding: '8px 16px', backgroundColor: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>キャンセル</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    <div style={{ fontSize: '15px', color: '#0B1F3A', fontWeight: 'bold' }}>{m.location_name} <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 'normal' }}>（{m.meeting_date}）</span></div>
                    <div style={{ fontSize: '13px', color: '#475569' }}>📍 {m.address || '未設定'} | 📞 {m.phone || '—'}</div>
                    <div style={{ fontSize: '13px', color: '#475569' }}>👑 責任者：{m.responsible_person}</div>

                    <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '12px', color: '#64748b', backgroundColor: '#f8fafc', padding: '8px 12px', borderRadius: '6px' }}>
                      <span><strong>総務チェック：</strong>{m.soumu_check_date || '—'}</span>
                      {m.type !== 'RIJIKAI' && (
                        <>
                          <span><strong>リンクチェック①：</strong>{m.link_check_1_date || '—'}</span>
                          <span><strong>リンクチェック②：</strong>{m.link_check_2_date || '—'}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* ZONE DROITE : ACTIONS */}
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '12px', borderLeft: '1px solid #e2e8f0', paddingLeft: '24px' }}>
                {!isEditing && (
                  <button
                    onClick={() => handleEditClick(m)}
                    style={{ padding: '8px', backgroundColor: '#fff', border: '1px solid #cbd5e1', color: '#475569', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', transition: 'background-color 0.2s' }}
                    onMouseOver={e=>e.currentTarget.style.backgroundColor='#f8fafc'}
                    onMouseOut={e=>e.currentTarget.style.backgroundColor='#fff'}
                  >
                    ✏️ 設定を編集
                  </button>
                )}

                {m.type === 'RIJIKAI' && (
                  <button
                    onClick={() => onStartOperation(m.id)}
                    style={{ padding: '16px 12px', backgroundColor: '#0B1F3A', color: '#F5C842', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '900', cursor: 'pointer', boxShadow: '0 4px 12px rgba(11, 31, 58, 0.25)', transition: 'transform 0.1s' }}
                    onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
                    onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    ▶️ 受付を開始
                  </button>
                )}
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
};

const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', color: '#334155', fontSize: '13px', boxSizing: 'border-box' as any, outline: 'none' };
const labelStyle = { display: 'flex', flexDirection: 'column' as any, gap: '4px', fontSize: '11px', color: '#64748b', fontWeight: 'bold' };
